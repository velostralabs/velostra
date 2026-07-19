param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$EvidenceOutput = 'artifacts/staging/evidence/reconciliation-skipped-report.json',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

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
  if ($exitCode -ne 0) {
    $rendered = ($output | Out-String)
    $stage = [regex]::Match($rendered, '"stage":"([a-z-]+)"')
    if ($stage.Success) {
      throw ($FailureMessage + ' (stage: ' + $stage.Groups[1].Value + ')')
    }
    throw $FailureMessage
  }
  return @($output)
}

function Get-ManagedSecret {
  param([string]$Name)
  $output = Invoke-NativeChecked -FailureMessage ('Unable to access managed secret ' + $Name) -Command {
    & $script:Gcloud 'secrets' 'versions' 'access' 'latest' ('--secret=' + $Name) ('--project=' + $ProjectId)
  }
  $value = ($output | Out-String).Trim()
  if (-not $value) { throw 'Managed secret was empty' }
  return $value
}

function Unprotect-Key {
  param([pscustomobject]$Record, [string]$ExpectedPurpose, [string]$EntropyText)
  if (
    $Record.kind -ne 'velostra-testnet-dpapi-key' -or
    $Record.purpose -ne $ExpectedPurpose -or
    $Record.productionEligible -ne $false -or
    $Record.encryption -ne 'DPAPI-CurrentUser'
  ) { throw 'Encrypted testnet key record failed validation' }
  $protected = [Convert]::FromBase64String([string]$Record.ciphertext)
  $entropy = [Text.Encoding]::UTF8.GetBytes($EntropyText)
  try {
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $protected, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    if ($bytes.Length -ne 32) { throw 'Decrypted testnet key is invalid' }
    return $bytes
  } finally {
    [Array]::Clear($protected, 0, $protected.Length)
    [Array]::Clear($entropy, 0, $entropy.Length)
  }
}

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactsRoot = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'artifacts'))
$EvidencePath = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot $EvidenceOutput))
if (-not $EvidencePath.StartsWith(
  $ArtifactsRoot + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase
)) { throw 'Evidence output must stay below artifacts/' }

$RuntimePath = Join-Path $ArtifactsRoot 'staging\runtime.json'
$DeploymentPath = Join-Path $ArtifactsRoot 'staging\robinhood-testnet-deployment.json'
$DeployerPath = Join-Path $ArtifactsRoot 'staging\authority\private\deployer.dpapi.json'
$WalletPath = Join-Path $ArtifactsRoot 'staging\evidence\private\reconciliation-wallet.dpapi.json'
foreach ($path in @($RuntimePath, $DeploymentPath, $DeployerPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw 'Required ignored staging artifact is missing' }
}

$Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
$Deployment = Get-Content -Raw -LiteralPath $DeploymentPath | ConvertFrom-Json
$RuntimeFields = @($Runtime.PSObject.Properties.Name)
$PaidWritesDisabled = (($RuntimeFields -contains 'paidWritesMode') -and ([string]$Runtime.paidWritesMode -eq 'disabled')) -or (($RuntimeFields -contains 'paidWritesEnabled') -and (-not [bool]$Runtime.paidWritesEnabled))
if (
  $Runtime.chainId -ne 46630 -or $Runtime.region -ne 'us-east4' -or
  -not $PaidWritesDisabled -or
  $Deployment.chainId -ne 46630 -or $Deployment.environment -ne 'staging' -or
  [uri]$Runtime.apiUrl -notmatch '^https://'
) { throw 'Managed staging records failed the reconciliation evidence guardrails' }

if (-not $Apply) {
  Push-Location $RepositoryRoot
  try {
    Invoke-NativeChecked -FailureMessage 'Evidence runner plan failed' -Command {
      & npm '--silent' '--prefix' 'server' 'run' 'staging:reconciliation-evidence' '--' '--plan'
    } | Out-Null
  } finally { Pop-Location }
  Write-Output 'PLAN create one DPAPI-encrypted, testnet-only evidence wallet'
  Write-Output 'PLAN pause only the reconciliation scheduler during skipped-report fault injection'
  Write-Output 'PLAN keep paid writes disabled, execute the worker, verify exact-once Postgres repair, and resume scheduling'
  Write-Output 'No transaction sent. Pass -Apply for the isolated staging evidence run.'
  exit 0
}

$dirty = (& git -C $RepositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked worktree must be clean before evidence broadcast' }

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$script:Gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $script:Gcloud) { throw 'Google Cloud CLI is required' }

if (-not (Test-Path -LiteralPath $WalletPath)) {
  $walletBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($walletBytes) }
  finally { $rng.Dispose() }
  $entropy = [Text.Encoding]::UTF8.GetBytes('Velostra:staging-evidence:v1:reconciliation-wallet')
  $ciphertext = $null
  try {
    $ciphertext = [Security.Cryptography.ProtectedData]::Protect(
      $walletBytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $record = [ordered]@{
      schemaVersion = 1
      kind = 'velostra-testnet-dpapi-key'
      purpose = 'staging-reconciliation-evidence'
      productionEligible = $false
      encryption = 'DPAPI-CurrentUser'
      ciphertext = [Convert]::ToBase64String($ciphertext)
      createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($WalletPath)) | Out-Null
    [IO.File]::WriteAllText($WalletPath, (($record | ConvertTo-Json -Depth 4) + [Environment]::NewLine))
  } finally {
    [Array]::Clear($walletBytes, 0, $walletBytes.Length)
    [Array]::Clear($entropy, 0, $entropy.Length)
    if ($ciphertext) { [Array]::Clear($ciphertext, 0, $ciphertext.Length) }
  }
}

$DeployerRecord = Get-Content -Raw -LiteralPath $DeployerPath | ConvertFrom-Json
$WalletRecord = Get-Content -Raw -LiteralPath $WalletPath | ConvertFrom-Json
$DeployerBytes = $null
$WalletBytes = $null
$RpcUrl = $null
$DatabaseUrl = $null
$SchedulerWasEnabled = $false
$SchedulerPaused = $false
try {
  $DeployerBytes = Unprotect-Key $DeployerRecord 'testnet-deployer' 'Velostra:testnet-authority:v1:testnet-deployer'
  $WalletBytes = Unprotect-Key $WalletRecord 'staging-reconciliation-evidence' 'Velostra:staging-evidence:v1:reconciliation-wallet'
  $RpcUrl = Get-ManagedSecret 'primary-rpc-url'
  $DatabaseUrl = Get-ManagedSecret 'database-url'

  $env:VELOSTRA_EVIDENCE_APPROVAL = 'isolated-staging-reconciliation-approved'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:PHASE3_PAID_WRITES_MODE = 'disabled'
  $env:ROBINHOOD_RPC_URL = $RpcUrl
  $env:DATABASE_URL = $DatabaseUrl
  $env:API_URL = [string]$Runtime.apiUrl
  $env:VELOSTRA_ESCROW_ADDRESS = [string]$Deployment.escrow.address
  $env:SETTLEMENT_TOKEN_ADDRESS = [string]$Deployment.settlementToken.address
  $env:EVIDENCE_WALLET_PRIVATE_KEY = '0x' + (($WalletBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  $env:TESTNET_DEPLOYER_PRIVATE_KEY = '0x' + (($DeployerBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  $env:EVIDENCE_DEPOSIT_AMOUNT = '0.02'
  $env:EVIDENCE_OUTPUT = $EvidenceOutput.Replace('\', '/')

  $stateOutput = Invoke-NativeChecked -FailureMessage 'Unable to inspect reconciliation scheduler' -Command {
    & $script:Gcloud 'scheduler' 'jobs' 'describe' 'velostra-reconciliation-every-15m' '--location=us-east4' ('--project=' + $ProjectId) '--format=value(state)'
  }
  $SchedulerWasEnabled = (($stateOutput | Out-String).Trim() -eq 'ENABLED')
  if ($SchedulerWasEnabled) {
    Invoke-NativeChecked -FailureMessage 'Unable to pause reconciliation scheduler' -Command {
      & $script:Gcloud 'scheduler' 'jobs' 'pause' 'velostra-reconciliation-every-15m' '--location=us-east4' ('--project=' + $ProjectId) '--quiet'
    } | Out-Null
    $SchedulerPaused = $true
  }

  Push-Location $RepositoryRoot
  try {
    if (-not (Test-Path -LiteralPath $EvidencePath)) {
      Invoke-NativeChecked -FailureMessage 'Skipped-report evidence broadcast failed' -Command {
        & npm '--silent' '--prefix' 'server' 'run' 'staging:reconciliation-evidence' '--' '--broadcast'
      } | Out-Null
    }
    Invoke-NativeChecked -FailureMessage 'Managed reconciliation job failed' -Command {
      & $script:Gcloud 'run' 'jobs' 'execute' 'velostra-reconciliation' '--region=us-east4' ('--project=' + $ProjectId) '--wait' '--quiet'
    } | Out-Null
    Invoke-NativeChecked -FailureMessage 'Managed reconciliation verification failed' -Command {
      & npm '--silent' '--prefix' 'server' 'run' 'staging:reconciliation-evidence' '--' '--verify'
    } | Out-Null
  } finally { Pop-Location }
  Write-Output 'PASS managed skipped-report reconciliation evidence captured with paid writes disabled'
} finally {
  if ($SchedulerPaused -and $SchedulerWasEnabled) {
    try {
      Invoke-NativeChecked -FailureMessage 'Unable to resume reconciliation scheduler' -Command {
        & $script:Gcloud 'scheduler' 'jobs' 'resume' 'velostra-reconciliation-every-15m' '--location=us-east4' ('--project=' + $ProjectId) '--quiet'
      } | Out-Null
    } catch { Write-Error 'Reconciliation scheduler requires immediate operator recovery'; throw }
  }
  foreach ($name in @(
    'VELOSTRA_EVIDENCE_APPROVAL','VELOSTRA_ENVIRONMENT','ROBINHOOD_CHAIN_ID',
    'PHASE3_PAID_WRITES_MODE','ROBINHOOD_RPC_URL','DATABASE_URL','API_URL',
    'VELOSTRA_ESCROW_ADDRESS','SETTLEMENT_TOKEN_ADDRESS','EVIDENCE_WALLET_PRIVATE_KEY',
    'TESTNET_DEPLOYER_PRIVATE_KEY','EVIDENCE_DEPOSIT_AMOUNT','EVIDENCE_OUTPUT'
  )) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  foreach ($bytes in @($DeployerBytes, $WalletBytes)) {
    if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
  }
  $RpcUrl = $null
  $DatabaseUrl = $null
}
