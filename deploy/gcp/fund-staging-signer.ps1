param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactsRoot = Join-Path $RepositoryRoot 'artifacts'
$RuntimePath = Join-Path $ArtifactsRoot 'staging\runtime.json'
$DeploymentPath = Join-Path $ArtifactsRoot 'staging\robinhood-testnet-deployment.json'
$DeployerPath = Join-Path $ArtifactsRoot 'staging\authority\private\deployer.dpapi.json'
$WalletPath = Join-Path $ArtifactsRoot 'staging\evidence\private\reconciliation-wallet.dpapi.json'

function Invoke-NativeChecked {
  param([scriptblock]$Command, [string]$FailureMessage)
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $output = & $Command 2>&1; $exitCode = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0) {
    $diagnostic = @($output | Where-Object { [string]$_ -match '^\{.*\}$' } | Select-Object -Last 1)
    if ($diagnostic.Count -eq 1) {
      throw ($FailureMessage + ': ' + [string]$diagnostic[0])
    }
    throw $FailureMessage
  }
  return @($output)
}

function Unprotect-Key([string]$Path, [string]$Purpose, [string]$EntropyText) {
  $record = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if ($record.kind -ne 'velostra-testnet-dpapi-key' -or $record.purpose -ne $Purpose -or $record.productionEligible -ne $false -or $record.encryption -ne 'DPAPI-CurrentUser') {
    throw 'Unsafe encrypted staging key record'
  }
  $protected = [Convert]::FromBase64String([string]$record.ciphertext)
  $entropy = [Text.Encoding]::UTF8.GetBytes($EntropyText)
  try {
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ($bytes.Length -ne 32) { throw 'Invalid encrypted staging key' }
    return $bytes
  } finally { [Array]::Clear($protected, 0, $protected.Length); [Array]::Clear($entropy, 0, $entropy.Length) }
}

if (-not $Apply) {
  Write-Output 'PLAN top up only the restricted staging signer to a bounded 0.01 test-ETH target'
  Write-Output 'PLAN preserve a 0.001 test-ETH reserve in every encrypted source used'
  Write-Output 'PLAN keep paid writes disabled and never print keys, addresses, balances, or hashes'
  Write-Output 'No transaction sent. Pass -Apply after explicit approval.'
  exit 0
}

foreach ($path in @($RuntimePath, $DeploymentPath, $DeployerPath, $WalletPath)) { if (-not (Test-Path -LiteralPath $path)) { throw 'Required ignored staging artifact is missing' } }
$Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
$Deployment = Get-Content -Raw -LiteralPath $DeploymentPath | ConvertFrom-Json
if ([string]$Runtime.region -ne 'us-east4' -or [int64]$Runtime.chainId -ne 46630 -or [string]$Runtime.paidWritesMode -ne 'disabled' -or [int64]$Deployment.chainId -ne 46630 -or [string]$Deployment.environment -ne 'staging') {
  throw 'Managed staging artifacts failed signer-funding guardrails'
}
$dirty = (& git -C $RepositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked worktree must be clean before signer funding' }

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$script:Gcloud = @((Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'), (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'), (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $script:Gcloud) { throw 'Google Cloud CLI is required' }

$DeployerBytes = $null; $WalletBytes = $null; $RpcUrl = $null
try {
  $DeployerBytes = Unprotect-Key $DeployerPath 'testnet-deployer' 'Velostra:testnet-authority:v1:testnet-deployer'
  $WalletBytes = Unprotect-Key $WalletPath 'staging-reconciliation-evidence' 'Velostra:staging-evidence:v1:reconciliation-wallet'
  $RpcUrl = (Invoke-NativeChecked -FailureMessage 'Managed primary RPC access failed' -Command { & $script:Gcloud 'secrets' 'versions' 'access' 'latest' '--secret=primary-rpc-url' ('--project=' + $ProjectId) } | Out-String).Trim()
  if (-not $RpcUrl) { throw 'Managed primary RPC was empty' }
  $env:VELOSTRA_SIGNER_FUNDING_APPROVAL = 'bounded-staging-signer-funding-approved'
  $env:VELOSTRA_ENVIRONMENT = 'staging'; $env:ROBINHOOD_CHAIN_ID = '46630'; $env:PHASE3_PAID_WRITES_MODE = 'disabled'
  $env:ROBINHOOD_RPC_URL = $RpcUrl; $env:SETTLEMENT_SIGNER_ADDRESS = [string]$Deployment.escrow.roles.settler
  $env:TESTNET_DEPLOYER_PRIVATE_KEY = '0x' + (($DeployerBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  $env:EVIDENCE_WALLET_PRIVATE_KEY = '0x' + (($WalletBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  Push-Location $RepositoryRoot
  try { Invoke-NativeChecked -FailureMessage 'Bounded signer funding failed' -Command { & node 'server/scripts/fund-staging-signer.mjs' } | Out-Null } finally { Pop-Location }
  Write-Output 'PASS restricted staging signer reached the bounded gas target with paid writes disabled'
} finally {
  foreach ($name in @('VELOSTRA_SIGNER_FUNDING_APPROVAL','VELOSTRA_ENVIRONMENT','ROBINHOOD_CHAIN_ID','PHASE3_PAID_WRITES_MODE','ROBINHOOD_RPC_URL','SETTLEMENT_SIGNER_ADDRESS','TESTNET_DEPLOYER_PRIVATE_KEY','EVIDENCE_WALLET_PRIVATE_KEY')) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  foreach ($bytes in @($DeployerBytes, $WalletBytes)) { if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) } }
  $RpcUrl = $null
}
