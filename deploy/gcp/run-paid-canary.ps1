param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [ValidatePattern('^(?:metamask-canary-profile|metamask-dedicated-profile-v[2-9][0-9]*)$')]
  [string]$ProfileName = 'metamask-dedicated-profile-v6',
  [switch]$PreflightOnly,
  [switch]$ClaimOnly,
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ArtifactsRoot = Join-Path $RepositoryRoot 'artifacts\staging'
$RuntimePath = Join-Path $ArtifactsRoot 'runtime.json'
$ReadinessPath = Join-Path $ArtifactsRoot 'evidence\canary-wallet-readiness.json'
$EvidencePath = Join-Path $ArtifactsRoot ('evidence\' + $(if ($ClaimOnly) { 'claim-canary.json' } else { 'paid-canary.json' }))
$PrivateRoot = Join-Path $ArtifactsRoot 'evidence\private'
$WalletPath = Join-Path $PrivateRoot 'reconciliation-wallet.dpapi.json'
$VaultPath = Join-Path $PrivateRoot 'metamask-vault.dpapi.json'
$ExtensionPath = Join-Path $PrivateRoot 'metamask-extension'
$ProfilePath = Join-Path $PrivateRoot $ProfileName
$CanaryControl = Join-Path $PSScriptRoot 'set-staging-paid-canary.ps1'
$ClaimStatus = Join-Path $PSScriptRoot 'check-staging-claim.ps1'

function Unprotect-Record([string]$Path, [string]$Purpose, [string]$EntropyText) {
  if (-not (Test-Path -LiteralPath $Path)) { throw ('Missing encrypted ' + $Purpose + ' record') }
  $record = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if (
    [string]$record.kind -ne 'velostra-testnet-dpapi-key' -or
    [string]$record.purpose -ne $Purpose -or
    $record.productionEligible -ne $false -or
    [string]$record.encryption -ne 'DPAPI-CurrentUser'
  ) { throw ('Unsafe encrypted ' + $Purpose + ' record') }
  $protected = [Convert]::FromBase64String([string]$record.ciphertext)
  $entropy = [Text.Encoding]::UTF8.GetBytes($EntropyText)
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

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory)][scriptblock]$Command,
    [Parameter(Mandatory)][string]$FailureMessage
  )
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Command
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw $FailureMessage }
}

if ($PreflightOnly -and $ClaimOnly) { throw 'PreflightOnly and ClaimOnly are mutually exclusive' }

if (-not $Apply) {
  if ($ClaimOnly) {
    Write-Output 'PLAN keep paid writes disabled and run one isolated MetaMask USDG 1.00 builder claim'
    Write-Output 'PLAN persist only a redacted pass/fail claim artifact'
  } else {
    Write-Output 'PLAN open one hashed-subject USDG 1.20 staging canary'
    Write-Output 'PLAN run one MetaMask top-up, one synthetic paid call, and one USDG 1.00 claim'
    Write-Output 'PLAN close paid writes in finally and persist only a redacted pass/fail artifact'
  }
  Write-Output 'No chain action sent. Pass -Apply after explicit approval.'
  exit 0
}

foreach ($path in @($RuntimePath, $ReadinessPath, $WalletPath, $VaultPath, $ExtensionPath, $ProfilePath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw 'Required ignored staging artifact is missing' }
}
$Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
$Readiness = Get-Content -Raw -LiteralPath $ReadinessPath | ConvertFrom-Json
if (
  [string]$Runtime.kind -ne 'velostra-us-staging-runtime' -or
  [string]$Runtime.region -ne 'us-east4' -or
  [int64]$Runtime.chainId -ne 46630 -or
  [string]$Runtime.paidWritesMode -ne 'disabled' -or
  [string]$Readiness.kind -ne 'velostra-staging-canary-wallet-readiness' -or
  $Readiness.nativeGasReady -ne $true -or
  $Readiness.settlementTokenReady -ne $true -or
  $Readiness.passed -ne $true
) { throw 'Managed staging artifacts failed paid-canary guardrails' }
foreach ($origin in @([string]$Runtime.webOrigin, [string]$Runtime.apiUrl)) {
  if (-not [Uri]::IsWellFormedUriString($origin, [UriKind]::Absolute) -or ([Uri]$origin).Scheme -ne 'https') {
    throw 'Paid canary requires managed HTTPS web and API origins'
  }
}
$dirty = (& git -C $RepositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked worktree must be clean before the paid canary' }

$WalletBytes = $null
$VaultBytes = $null
$ClaimVerified = $false
$Opened = $false
$Closed = $true
$Passed = $false
$Failure = $null
try {
  $WalletBytes = Unprotect-Record $WalletPath 'staging-reconciliation-evidence' 'Velostra:staging-evidence:v1:reconciliation-wallet'
  $VaultBytes = Unprotect-Record $VaultPath 'staging-metamask-vault' 'Velostra:staging-evidence:v1:metamask-vault'
  if ($WalletBytes.Length -ne 32 -or $VaultBytes.Length -lt 12) { throw 'Encrypted staging material is malformed' }

  $env:EVIDENCE_WALLET_PRIVATE_KEY = '0x' + (($WalletBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  $ExpectedAddress = (& node --input-type=module --eval "import { privateKeyToAccount } from 'viem/accounts'; process.stdout.write(privateKeyToAccount(process.env.EVIDENCE_WALLET_PRIVATE_KEY).address.toLowerCase())" 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $ExpectedAddress -notmatch '^0x[0-9a-f]{40}$') {
    throw 'Unable to derive the isolated staging address'
  }
  Remove-Item Env:EVIDENCE_WALLET_PRIVATE_KEY -ErrorAction SilentlyContinue

  $env:PHASE2_WALLET_E2E_APPROVED = 'isolated-staging-only'
  $env:PHASE2_WALLET_EXPECTED_ADDRESS = $ExpectedAddress
  $env:PHASE2_WALLET_TOPUP_AMOUNT = '2.00'
  $env:PHASE2_WALLET_CLAIM_AMOUNT = '1.00'
  $env:PHASE2_WALLET_AGENT_SLUG = 'phase2-synthetic-agent'
  $env:METAMASK_VAULT_PASSWORD = [Text.Encoding]::UTF8.GetString($VaultBytes)
  $env:METAMASK_EXTENSION_PATH = $ExtensionPath
  $env:METAMASK_USER_DATA_DIR = $ProfilePath
  $env:PLAYWRIGHT_BASE_URL = [string]$Runtime.webOrigin
  $env:PHASE2_WALLET_API_URL = [string]$Runtime.apiUrl
  $env:PHASE2_WALLET_PREFLIGHT = 'isolated-staging-preflight'

  Push-Location $RepositoryRoot
  try {
    Invoke-NativeChecked -FailureMessage 'MetaMask preflight failed before opening paid writes' -Command {
      & npm run test:wallet:metamask
    }
  } finally { Pop-Location }
  Remove-Item Env:PHASE2_WALLET_PREFLIGHT -ErrorAction SilentlyContinue

  if ($ClaimOnly) {
    $env:PHASE2_WALLET_CLAIM_ONLY = 'isolated-staging-claim-only'
    Push-Location $RepositoryRoot
    try {
      Invoke-NativeChecked -FailureMessage 'Isolated MetaMask claim canary failed' -Command {
        & npm run test:wallet:metamask
      }
    } finally { Pop-Location }
    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    $gcloud = @(
      (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
      (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
      (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $gcloud) { throw 'Google Cloud CLI is required for claim reconciliation' }

    $claimRecoveryFailure = $null
    foreach ($attempt in 1..3) {
      try {
        $null = Invoke-NativeChecked -FailureMessage 'Managed claim reconciliation failed' -Command {
          & $gcloud 'run' 'jobs' 'execute' 'velostra-reconciliation' '--region=us-east4' `
            ('--project=' + $ProjectId) '--wait' '--quiet'
        }
        $null = & $ClaimStatus -ProjectId $ProjectId
        if ($LASTEXITCODE -ne 0) { throw 'Claim exact-once verification failed' }
        $ClaimVerified = $true
        break
      } catch {
        $claimRecoveryFailure = $_.Exception.Message
        if ($attempt -lt 3) { Start-Sleep -Seconds 15 }
      }
    }
    if (-not $ClaimVerified) {
      throw ('Claim reconciliation did not converge: ' + $claimRecoveryFailure)
    }
  } elseif (-not $PreflightOnly) {
    $Closed = $false
    & $CanaryControl -Action Open -ProjectId $ProjectId -Apply
    if ($LASTEXITCODE -ne 0) { throw 'Unable to open the bounded staging canary' }
    $Opened = $true
    $env:PHASE2_WALLET_PAID_WRITES_APPROVED = 'isolated-staging-canary'

    Push-Location $RepositoryRoot
    try {
      Invoke-NativeChecked -FailureMessage 'Bounded MetaMask paid canary failed' -Command {
        & npm run test:wallet:metamask
      }
    } finally { Pop-Location }
    }
  $Passed = $true
} catch {
  $Failure = $_.Exception.Message
} finally {
  foreach ($name in @(
    'EVIDENCE_WALLET_PRIVATE_KEY','PHASE2_WALLET_E2E_APPROVED',
    'PHASE2_WALLET_PREFLIGHT','PHASE2_WALLET_CLAIM_ONLY',
    'PHASE2_WALLET_PAID_WRITES_APPROVED','PHASE2_WALLET_EXPECTED_ADDRESS',
    'PHASE2_WALLET_TOPUP_AMOUNT','PHASE2_WALLET_CLAIM_AMOUNT',
    'PHASE2_WALLET_AGENT_SLUG','METAMASK_VAULT_PASSWORD',
    'METAMASK_EXTENSION_PATH','METAMASK_USER_DATA_DIR','PLAYWRIGHT_BASE_URL',
    'PHASE2_WALLET_API_URL'
  )) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  $ExpectedAddress = $null
  if ($WalletBytes) { [Array]::Clear($WalletBytes, 0, $WalletBytes.Length) }
  if ($VaultBytes) { [Array]::Clear($VaultBytes, 0, $VaultBytes.Length) }
  if ($Opened) {
    try {
      & $CanaryControl -Action Close -ProjectId $ProjectId -Apply
      if ($LASTEXITCODE -ne 0) { throw 'Canary close command failed' }
      $Closed = $true
    } catch {
      $Passed = $false
      $Failure = 'CRITICAL: paid canary did not close cleanly'
    }
  }
  $evidence = [ordered]@{
    schemaVersion = 1
    kind = $(if ($ClaimOnly) { 'velostra-staging-claim-canary' } else { 'velostra-staging-paid-canary' })
    environment = 'staging'
    region = 'us-east4'
    chainId = 46630
    topupGross = $(if ($ClaimOnly) { '0.00' } else { '2.00' })
    paidCallGross = $(if ($ClaimOnly) { '0.00' } else { '1.20' })
    claimGross = '1.00'
    preflightOnly = [bool]$PreflightOnly
    claimOnly = [bool]$ClaimOnly
    claimVerified = [bool]$ClaimVerified
    paidWritesClosed = [bool]$Closed
    passed = [bool]$Passed
    completedAt = [DateTime]::UtcNow.ToString('o')
  }
  [System.IO.File]::WriteAllText(
    $EvidencePath,
    ($evidence | ConvertTo-Json -Depth 5) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
}

if (-not $Passed) { throw $Failure }
if ($PreflightOnly) {
  Write-Output 'PASS isolated MetaMask staging preflight completed with paid writes disabled'
} elseif ($ClaimOnly) {
  Write-Output 'PASS one isolated MetaMask builder claim completed with paid writes disabled'
} else {
  Write-Output 'PASS one bounded MetaMask paid canary completed and paid writes are disabled'
}
