param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimePath = Join-Path $RepositoryRoot 'artifacts\staging\runtime.json'
$DeploymentPath = Join-Path $RepositoryRoot 'artifacts\staging\robinhood-testnet-deployment.json'

function Invoke-NativeChecked {
  param([scriptblock]$Command, [string]$FailureMessage)
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $Command 2>&1
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0) { throw $FailureMessage }
  return @($output)
}

function Get-ManagedSecret([string]$Name) {
  $value = (Invoke-NativeChecked -FailureMessage 'Managed secret access failed' -Command {
    & $script:Gcloud 'secrets' 'versions' 'access' 'latest' ('--secret=' + $Name) ('--project=' + $ProjectId)
  } | Out-String).Trim()
  if (-not $value) { throw 'Managed secret was empty' }
  return $value
}

foreach ($path in @($RuntimePath, $DeploymentPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw 'Required ignored staging artifact is missing' }
}
$Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
$Deployment = Get-Content -Raw -LiteralPath $DeploymentPath | ConvertFrom-Json
if (
  [string]$Runtime.kind -ne 'velostra-us-staging-runtime' -or
  [string]$Runtime.region -ne 'us-east4' -or
  [int64]$Runtime.chainId -ne 46630 -or
  [string]$Runtime.paidWritesMode -ne 'disabled' -or
  [int64]$Deployment.chainId -ne 46630 -or
  [string]$Deployment.environment -ne 'staging'
) { throw 'Managed staging artifacts failed signer diagnostic guardrails' }

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$script:Gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $script:Gcloud) { throw 'Google Cloud CLI is required' }

$RpcUrl = $null
$DatabaseUrl = $null
$RedisUrl = $null
try {
  $RpcUrl = Get-ManagedSecret 'primary-rpc-url'
  $DatabaseUrl = Get-ManagedSecret 'database-url'
  $RedisUrl = Get-ManagedSecret 'redis-url'
  $env:VELOSTRA_SIGNER_INTENT_APPROVAL = 'read-only-staging-signer-intent'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:PHASE3_PAID_WRITES_MODE = 'disabled'
  $env:ROBINHOOD_RPC_URL = $RpcUrl
  $env:DATABASE_URL = $DatabaseUrl
  $env:REDIS_URL = $RedisUrl
  $env:VELOSTRA_ESCROW_ADDRESS = [string]$Deployment.escrow.address
  $env:SETTLEMENT_SIGNER_ADDRESS = [string]$Deployment.escrow.roles.settler
  Push-Location $RepositoryRoot
  try {
    $output = Invoke-NativeChecked -FailureMessage 'Signer intent diagnostic failed' -Command {
      & npm '--silent' '--prefix' 'server' 'run' 'staging:signer-intent'
    }
  } finally { Pop-Location }
  $json = @($output | Where-Object { [string]$_ -match '^\{' })[-1]
  if (-not $json) { throw 'Signer intent diagnostic returned no bounded result' }
  Write-Output $json
} finally {
  foreach ($name in @(
    'VELOSTRA_SIGNER_INTENT_APPROVAL','VELOSTRA_ENVIRONMENT','ROBINHOOD_CHAIN_ID',
    'PHASE3_PAID_WRITES_MODE','ROBINHOOD_RPC_URL','DATABASE_URL','REDIS_URL',
    'VELOSTRA_ESCROW_ADDRESS','SETTLEMENT_SIGNER_ADDRESS'
  )) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  $RpcUrl = $null
  $DatabaseUrl = $null
  $RedisUrl = $null
}
