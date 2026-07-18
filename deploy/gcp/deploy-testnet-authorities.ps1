param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$AuthorityDirectory = 'artifacts/staging/authority',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$authorityPath = [IO.Path]::GetFullPath((Join-Path $repositoryRoot $AuthorityDirectory))
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'artifacts'))
if (-not $authorityPath.StartsWith(
  $artifactsRoot + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw 'Authority directory must stay below artifacts/'
}
$planPath = Join-Path $authorityPath 'testnet-authority-plan.json'
$deployerPath = Join-Path $authorityPath 'private\deployer.dpapi.json'
if (-not (Test-Path -LiteralPath $planPath)) {
  throw 'Run prepare-testnet-authorities.ps1 before this command'
}
if (-not (Test-Path -LiteralPath $deployerPath)) {
  throw 'Encrypted testnet deployer custody is missing'
}

if (-not $Apply) {
  Write-Output 'PLAN deploy three canonical Safe 2-of-3 accounts on Robinhood testnet'
  Write-Output 'PLAN verify Safe version, owners, thresholds, disjoint custody, chain, and US staging policy'
  Write-Output 'No transaction sent. Pass -Apply only after funding the isolated testnet deployer.'
  exit 0
}

$dirty = (& git -C $repositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree' }
if ($dirty) { throw 'Tracked worktree must be clean before authority deployment' }
& npm --silent --prefix (Join-Path $repositoryRoot 'contracts') run test:testnet-policy
if ($LASTEXITCODE -ne 0) { throw 'Testnet authority policy tests failed' }

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

$record = Get-Content -Raw -LiteralPath $deployerPath | ConvertFrom-Json
if (
  $record.kind -ne 'velostra-testnet-dpapi-key' -or
  $record.purpose -ne 'testnet-deployer' -or
  $record.productionEligible -ne $false -or
  $record.encryption -ne 'DPAPI-CurrentUser'
) {
  throw 'Encrypted deployer record failed its custody policy'
}
$protectedBytes = [Convert]::FromBase64String([string]$record.ciphertext)
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

  $env:VELOSTRA_TESTNET_AUTHORITY_BROADCAST = 'isolated-authority-staging-approved'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:VELOSTRA_DEPLOY_REGION = 'us-east4'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:ROBINHOOD_TESTNET_RPC_URL = $rpcUrl
  $env:TESTNET_DEPLOYER_PRIVATE_KEY = $privateKey
  $env:TESTNET_AUTHORITY_PLAN = 'artifacts/staging/authority/testnet-authority-plan.json'
  $env:TESTNET_AUTHORITY_OUTPUT = 'artifacts/staging/authority/robinhood-testnet-authorities.json'
  & npm --silent --prefix (Join-Path $repositoryRoot 'contracts') run deploy:robinhood-testnet-authorities -- --broadcast
  if ($LASTEXITCODE -ne 0) { throw 'Testnet authority deployment failed' }
} finally {
  Remove-Item Env:VELOSTRA_TESTNET_AUTHORITY_BROADCAST -ErrorAction SilentlyContinue
  Remove-Item Env:VELOSTRA_ENVIRONMENT -ErrorAction SilentlyContinue
  Remove-Item Env:VELOSTRA_DEPLOY_REGION -ErrorAction SilentlyContinue
  Remove-Item Env:ROBINHOOD_CHAIN_ID -ErrorAction SilentlyContinue
  Remove-Item Env:ROBINHOOD_TESTNET_RPC_URL -ErrorAction SilentlyContinue
  Remove-Item Env:TESTNET_DEPLOYER_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TESTNET_AUTHORITY_PLAN -ErrorAction SilentlyContinue
  Remove-Item Env:TESTNET_AUTHORITY_OUTPUT -ErrorAction SilentlyContinue
  if ($keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
  if ($protectedBytes) {
    [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
  }
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
  $privateKey = $null
  $rpcUrl = $null
}
