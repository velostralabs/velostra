param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$AuthorityDirectory = 'artifacts/staging/authority',
  [ValidateRange(0, 5000)]
  [int]$PlatformFeeBps = 1000,
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Invoke-NpmChecked {
  param(
    [Parameter(Mandatory)]
    [string[]]$Arguments,
    [Parameter(Mandatory)]
    [string]$FailureMessage
  )
  $previousErrorActionPreference = $ErrorActionPreference
  $output = $null
  $exitCode = $null
  try {
    $ErrorActionPreference = 'Continue'
    $output = & npm @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) { throw $FailureMessage }
  foreach ($line in @($output)) {
    Write-Output ([string]$line)
  }
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'artifacts'))
$authorityPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot $AuthorityDirectory))
if (-not $authorityPath.StartsWith(
  $artifactsRoot + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw 'Authority directory must stay below artifacts/'
}
$authorityRecordPath = Join-Path $authorityPath 'robinhood-testnet-authorities.json'
$deployerPath = Join-Path $authorityPath 'private\deployer.dpapi.json'
$signerPath = Join-Path $artifactsRoot 'staging\kms-settlement-signer.json'
foreach ($requiredPath in @($authorityRecordPath, $deployerPath, $signerPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw 'Required ignored staging artifact is missing'
  }
}

$authorities = Get-Content -Raw -LiteralPath $authorityRecordPath | ConvertFrom-Json
$deployer = Get-Content -Raw -LiteralPath $deployerPath | ConvertFrom-Json
$signer = Get-Content -Raw -LiteralPath $signerPath | ConvertFrom-Json
if (
  $authorities.kind -ne 'velostra-robinhood-testnet-safe-authorities' -or
  $authorities.environment -ne 'staging' -or
  $authorities.region -ne 'us-east4' -or
  $authorities.chainId -ne 46630
) {
  throw 'Safe authority deployment record failed validation'
}
foreach ($name in @('governance', 'treasury', 'pauseGuardian')) {
  $role = $authorities.roles.$name
  if (
    [string]$role.address -notmatch '^0x[0-9a-fA-F]{40}$' -or
    $role.threshold -ne 2 -or
    @($role.owners).Count -ne 3 -or
    $role.safeVersion -ne '1.4.1'
  ) {
    throw 'Safe authority record is incomplete'
  }
}
if (
  $deployer.kind -ne 'velostra-testnet-dpapi-key' -or
  $deployer.purpose -ne 'testnet-deployer' -or
  $deployer.productionEligible -ne $false -or
  $deployer.encryption -ne 'DPAPI-CurrentUser'
) {
  throw 'Encrypted deployer record failed its custody policy'
}
if (
  $signer.kind -ne 'velostra-staging-kms-signer' -or
  $signer.region -ne 'us-east4' -or
  [string]$signer.address -notmatch '^0x[0-9a-fA-F]{40}$'
) {
  throw 'Restricted settlement signer record failed validation'
}

if (-not $Apply) {
  Write-Output 'PLAN deploy a synthetic 6-decimal token and VelostraEscrow on Robinhood testnet'
  Write-Output 'PLAN bind verified Safe 2-of-3 authorities plus the isolated KMS settler'
  Write-Output 'No transaction sent. Pass -Apply only after Safe authority deployment is verified.'
  exit 0
}
$dirty = (& git -C $repositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree' }
if ($dirty) { throw 'Tracked worktree must be clean before contract deployment' }
$contractsPath = Join-Path $repositoryRoot 'contracts'
Invoke-NpmChecked -Arguments @('--silent', '--prefix', $contractsPath, 'test') -FailureMessage 'Contract tests failed before deployment'
Invoke-NpmChecked -Arguments @('--silent', '--prefix', $contractsPath, 'run', 'test:testnet-policy') -FailureMessage 'Testnet deployment policy tests failed'

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

$protectedBytes = [Convert]::FromBase64String([string]$deployer.ciphertext)
$entropy = [Text.Encoding]::UTF8.GetBytes(
  'Velostra:testnet-authority:v1:testnet-deployer'
)
$keyBytes = $null
$privateKey = $null
$rpcUrl = $null
try {
  $keyBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  if ($keyBytes.Length -ne 32) { throw 'Decrypted testnet deployer key is invalid' }
  $privateKey = '0x' + (($keyBytes | ForEach-Object {
    $_.ToString('x2')
  }) -join '')
  $rpcArgs = @(
    'secrets', 'versions', 'access', 'latest',
    '--secret=primary-rpc-url',
    ('--project=' + $ProjectId)
  )
  $rpcUrl = (& $gcloud @rpcArgs | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $rpcUrl -notmatch '^https://') {
    throw 'Unable to load the managed Robinhood testnet RPC endpoint'
  }

  $env:VELOSTRA_TESTNET_BROADCAST = 'isolated-staging-approved'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:VELOSTRA_DEPLOY_REGION = 'us-east4'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE = 'deploy-mock-usd'
  $env:ROBINHOOD_TESTNET_RPC_URL = $rpcUrl
  $env:TESTNET_DEPLOYER_PRIVATE_KEY = $privateKey
  $env:PLATFORM_FEE_BPS = [string]$PlatformFeeBps
  $env:ADMIN_ADDRESS = [string]$authorities.roles.governance.address
  $env:SETTLER_ADDRESS = [string]$signer.address
  $env:TREASURY_ADDRESS = [string]$authorities.roles.treasury.address
  $env:PAUSE_GUARDIAN_ADDRESS = [string]$authorities.roles.pauseGuardian.address
  $env:TESTNET_DEPLOYMENT_OUTPUT = 'artifacts/staging/robinhood-testnet-deployment.json'
  Invoke-NpmChecked -Arguments @('--silent', '--prefix', $contractsPath, 'run', 'deploy:robinhood-testnet', '--', '--broadcast') -FailureMessage 'Testnet escrow deployment failed'

  $env:TESTNET_DEPLOYMENT_RECORD = 'artifacts/staging/robinhood-testnet-deployment.json'
  $env:TESTNET_VERIFICATION_OUTPUT = 'artifacts/staging/robinhood-testnet-verification.json'
  Invoke-NpmChecked -Arguments @('--silent', '--prefix', $contractsPath, 'run', 'verify:robinhood-testnet') -FailureMessage 'Testnet escrow verification failed'
} finally {
  foreach ($name in @(
    'VELOSTRA_TESTNET_BROADCAST',
    'VELOSTRA_ENVIRONMENT',
    'VELOSTRA_DEPLOY_REGION',
    'ROBINHOOD_CHAIN_ID',
    'VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE',
    'ROBINHOOD_TESTNET_RPC_URL',
    'TESTNET_DEPLOYER_PRIVATE_KEY',
    'PLATFORM_FEE_BPS',
    'ADMIN_ADDRESS',
    'SETTLER_ADDRESS',
    'TREASURY_ADDRESS',
    'PAUSE_GUARDIAN_ADDRESS',
    'TESTNET_DEPLOYMENT_OUTPUT',
    'TESTNET_DEPLOYMENT_RECORD',
    'TESTNET_VERIFICATION_OUTPUT'
  )) {
    Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue
  }
  if ($keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
  if ($protectedBytes) {
    [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
  }
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
  $privateKey = $null
  $rpcUrl = $null
}
