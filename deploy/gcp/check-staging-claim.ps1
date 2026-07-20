param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$EvidenceOutput = 'artifacts/staging/evidence/claim-reconciliation-verification.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactsRoot = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'artifacts'))
$EvidencePath = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot $EvidenceOutput))
if (-not $EvidencePath.StartsWith(
  $ArtifactsRoot + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw 'Claim evidence output must stay below artifacts/'
}
$RuntimePath = Join-Path $RepositoryRoot 'artifacts\staging\runtime.json'
$DeploymentPath = Join-Path $RepositoryRoot 'artifacts\staging\robinhood-testnet-deployment.json'
$WalletPath = Join-Path $RepositoryRoot 'artifacts\staging\evidence\private\reconciliation-wallet.dpapi.json'

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

function Unprotect-Wallet {
  $record = Get-Content -Raw -LiteralPath $WalletPath | ConvertFrom-Json
  if (
    [string]$record.kind -ne 'velostra-testnet-dpapi-key' -or
    [string]$record.purpose -ne 'staging-reconciliation-evidence' -or
    $record.productionEligible -ne $false -or
    [string]$record.encryption -ne 'DPAPI-CurrentUser'
  ) { throw 'Unsafe encrypted staging wallet record' }
  $protected = [Convert]::FromBase64String([string]$record.ciphertext)
  $entropy = [Text.Encoding]::UTF8.GetBytes('Velostra:staging-evidence:v1:reconciliation-wallet')
  try {
    return [Security.Cryptography.ProtectedData]::Unprotect(
      $protected,
      $entropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
  } finally {
    [Array]::Clear($protected, 0, $protected.Length)
    [Array]::Clear($entropy, 0, $entropy.Length)
  }
}

foreach ($path in @($RuntimePath, $DeploymentPath, $WalletPath)) {
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
) { throw 'Managed staging artifacts failed claim diagnostic guardrails' }

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$script:Gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $script:Gcloud) { throw 'Google Cloud CLI is required' }

$WalletBytes = $null
$RpcUrl = $null
$DatabaseUrl = $null
try {
  $WalletBytes = Unprotect-Wallet
  if ($WalletBytes.Length -ne 32) { throw 'Encrypted staging wallet material is malformed' }
  $RpcUrl = Get-ManagedSecret 'primary-rpc-url'
  $DatabaseUrl = Get-ManagedSecret 'database-url'
  $env:EVIDENCE_WALLET_PRIVATE_KEY = '0x' + (($WalletBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  $env:VELOSTRA_CLAIM_STATUS_APPROVAL = 'read-only-staging-claim-status'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:PHASE3_PAID_WRITES_MODE = 'disabled'
  $env:ROBINHOOD_RPC_URL = $RpcUrl
  $env:DATABASE_URL = $DatabaseUrl
  $env:VELOSTRA_ESCROW_ADDRESS = [string]$Deployment.escrow.address
  $env:VELOSTRA_DEPLOYMENT_BLOCK = [string]$Deployment.escrow.deploymentBlock
  Push-Location $RepositoryRoot
  try {
    $output = Invoke-NativeChecked -FailureMessage 'Claim status diagnostic failed' -Command {
      & npm '--silent' '--prefix' 'server' 'run' 'staging:claim-status'
    }
  } finally { Pop-Location }
  $json = @($output | Where-Object { [string]$_ -match '^\{' })[-1]
  if (-not $json) { throw 'Claim status diagnostic returned no bounded result' }
  $EvidenceDirectory = Split-Path -Parent $EvidencePath
  New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
  $TemporaryPath = $EvidencePath + '.tmp'
  Set-Content -LiteralPath $TemporaryPath -Value $json -Encoding utf8
  Move-Item -Force -LiteralPath $TemporaryPath -Destination $EvidencePath
  Write-Output $json
  $result = $json | ConvertFrom-Json
  if ($result.passed -ne $true) { throw 'Claim status did not satisfy exact-once invariants' }
} finally {
  foreach ($name in @(
    'EVIDENCE_WALLET_PRIVATE_KEY','VELOSTRA_CLAIM_STATUS_APPROVAL','VELOSTRA_ENVIRONMENT',
    'ROBINHOOD_CHAIN_ID','PHASE3_PAID_WRITES_MODE','ROBINHOOD_RPC_URL','DATABASE_URL',
    'VELOSTRA_ESCROW_ADDRESS','VELOSTRA_DEPLOYMENT_BLOCK'
  )) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  if ($WalletBytes) { [Array]::Clear($WalletBytes, 0, $WalletBytes.Length) }
  $RpcUrl = $null
  $DatabaseUrl = $null
}
