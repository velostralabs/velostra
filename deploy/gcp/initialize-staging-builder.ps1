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
$WalletPath = Join-Path $ArtifactsRoot 'staging\evidence\private\reconciliation-wallet.dpapi.json'

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory)][scriptblock]$Command,
    [Parameter(Mandatory)][string]$FailureMessage
  )
  $previous = $ErrorActionPreference
  $output = @()
  $exitCode = -1
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $Command 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($exitCode -ne 0) { throw $FailureMessage }
  return @($output)
}

function Get-ManagedSecret([string]$Name) {
  $value = (Invoke-NativeChecked -FailureMessage ('Unable to access managed secret ' + $Name) -Command {
    & $script:Gcloud 'secrets' 'versions' 'access' 'latest' ('--secret=' + $Name) ('--project=' + $ProjectId)
  } | Out-String).Trim()
  if (-not $value) { throw 'Managed secret was empty' }
  return $value
}

function Unprotect-Wallet {
  $record = Get-Content -Raw -LiteralPath $WalletPath | ConvertFrom-Json
  if (
    $record.kind -ne 'velostra-testnet-dpapi-key' -or
    $record.purpose -ne 'staging-reconciliation-evidence' -or
    $record.productionEligible -ne $false -or
    $record.encryption -ne 'DPAPI-CurrentUser'
  ) { throw 'Unsafe encrypted staging wallet record' }
  $protected = [Convert]::FromBase64String([string]$record.ciphertext)
  $entropy = [Text.Encoding]::UTF8.GetBytes('Velostra:staging-evidence:v1:reconciliation-wallet')
  try {
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $protected, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    if ($bytes.Length -ne 32) { throw 'Invalid encrypted staging wallet key' }
    return $bytes
  } finally {
    [Array]::Clear($protected, 0, $protected.Length)
    [Array]::Clear($entropy, 0, $entropy.Length)
  }
}

if (-not $Apply) {
  Write-Output 'PLAN verify the encrypted evidence wallet owns the approved synthetic builder'
  Write-Output 'PLAN initialize that builder once on Robinhood testnet while paid writes remain disabled'
  Write-Output 'PLAN store only redacted readiness evidence; never print wallet, key, or transaction hash'
  Write-Output 'No transaction sent. Pass -Apply after explicit approval.'
  exit 0
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
) { throw 'Managed staging artifacts failed builder-initialization guardrails' }

$dirty = (& git -C $RepositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked worktree must be clean before builder initialization' }

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
  $RpcUrl = Get-ManagedSecret 'primary-rpc-url'
  $DatabaseUrl = Get-ManagedSecret 'database-url'
  $env:VELOSTRA_BUILDER_INITIALIZATION_APPROVAL = 'isolated-staging-builder-initialization-approved'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:PHASE3_PAID_WRITES_MODE = 'disabled'
  $env:ROBINHOOD_RPC_URL = $RpcUrl
  $env:DATABASE_URL = $DatabaseUrl
  $env:VELOSTRA_ESCROW_ADDRESS = [string]$Deployment.escrow.address
  $env:EVIDENCE_WALLET_PRIVATE_KEY = '0x' + (($WalletBytes | ForEach-Object { $_.ToString('x2') }) -join '')

  Push-Location $RepositoryRoot
  try {
    Invoke-NativeChecked -FailureMessage 'Staging builder initialization failed' -Command {
      & npm '--silent' '--prefix' 'server' 'run' 'staging:initialize-builder'
    } | Out-Null
  } finally { Pop-Location }
  Write-Output 'PASS synthetic staging builder is initialized onchain with paid writes disabled'
} finally {
  foreach ($name in @(
    'VELOSTRA_BUILDER_INITIALIZATION_APPROVAL','VELOSTRA_ENVIRONMENT','ROBINHOOD_CHAIN_ID',
    'PHASE3_PAID_WRITES_MODE','ROBINHOOD_RPC_URL','DATABASE_URL','VELOSTRA_ESCROW_ADDRESS',
    'EVIDENCE_WALLET_PRIVATE_KEY'
  )) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  if ($WalletBytes) { [Array]::Clear($WalletBytes, 0, $WalletBytes.Length) }
  $RpcUrl = $null
  $DatabaseUrl = $null
}
