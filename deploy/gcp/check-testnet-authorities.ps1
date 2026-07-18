param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$AuthorityDirectory = 'artifacts/staging/authority'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
$signerPath = Join-Path $artifactsRoot 'staging\kms-settlement-signer.json'
foreach ($requiredPath in @($planPath, $deployerPath, $signerPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw 'Required ignored staging artifact is missing'
  }
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

$deployer = Get-Content -Raw -LiteralPath $deployerPath | ConvertFrom-Json
$signer = Get-Content -Raw -LiteralPath $signerPath | ConvertFrom-Json
if (
  $deployer.kind -ne 'velostra-testnet-dpapi-key' -or
  $deployer.purpose -ne 'testnet-deployer' -or
  $deployer.productionEligible -ne $false -or
  [string]$deployer.address -notmatch '^0x[0-9a-fA-F]{40}$'
) {
  throw 'Testnet deployer custody record failed validation'
}
if (
  $signer.kind -ne 'velostra-staging-kms-signer' -or
  $signer.region -ne 'us-east4' -or
  [string]$signer.address -notmatch '^0x[0-9a-fA-F]{40}$'
) {
  throw 'Restricted settlement signer record failed validation'
}

$rpcArgs = @(
  'secrets', 'versions', 'access', 'latest',
  '--secret=primary-rpc-url',
  ('--project=' + $ProjectId)
)
$rpcUrl = $null
try {
  $rpcUrl = (& $gcloud @rpcArgs | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $rpcUrl -notmatch '^https://') {
    throw 'Unable to load the managed Robinhood testnet RPC endpoint'
  }
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:VELOSTRA_DEPLOY_REGION = 'us-east4'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:ROBINHOOD_TESTNET_RPC_URL = $rpcUrl
  $env:TESTNET_DEPLOYER_ADDRESS = [string]$deployer.address
  $env:SETTLER_ADDRESS = [string]$signer.address
  $env:TESTNET_AUTHORITY_PLAN = 'artifacts/staging/authority/testnet-authority-plan.json'
  $env:TESTNET_AUTHORITY_READINESS_OUTPUT = 'artifacts/staging/authority/testnet-authority-readiness.json'
  & npm --silent --prefix (Join-Path $repositoryRoot 'contracts') run check:robinhood-testnet-authorities
  if ($LASTEXITCODE -ne 0) { throw 'Testnet authority readiness check failed' }
} finally {
  Remove-Item Env:VELOSTRA_ENVIRONMENT -ErrorAction SilentlyContinue
  Remove-Item Env:VELOSTRA_DEPLOY_REGION -ErrorAction SilentlyContinue
  Remove-Item Env:ROBINHOOD_CHAIN_ID -ErrorAction SilentlyContinue
  Remove-Item Env:ROBINHOOD_TESTNET_RPC_URL -ErrorAction SilentlyContinue
  Remove-Item Env:TESTNET_DEPLOYER_ADDRESS -ErrorAction SilentlyContinue
  Remove-Item Env:SETTLER_ADDRESS -ErrorAction SilentlyContinue
  Remove-Item Env:TESTNET_AUTHORITY_PLAN -ErrorAction SilentlyContinue
  Remove-Item Env:TESTNET_AUTHORITY_READINESS_OUTPUT -ErrorAction SilentlyContinue
  $rpcUrl = $null
}
