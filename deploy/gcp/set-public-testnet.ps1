param(
  [ValidateSet('Plan', 'Open', 'Close', 'Status')]
  [string]$Action = 'Plan',
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimePath = Join-Path $RepositoryRoot 'artifacts\staging\runtime.json'
$SignerEvidencePath = Join-Path $RepositoryRoot 'artifacts\staging\evidence\signer-gas-readiness.json'
$Region = 'us-east4'
$ChainId = 46630

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$script:Gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $script:Gcloud) { throw 'Google Cloud CLI is required' }

function Get-GcloudText {
  param([Parameter(Mandatory)][string[]]$CommandArgs, [Parameter(Mandatory)][string]$Failure)
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $script:Gcloud @CommandArgs 2>$null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw $Failure }
  return ($output | Out-String).Trim()
}

function Invoke-GcloudQuiet {
  param([Parameter(Mandatory)][string[]]$CommandArgs, [Parameter(Mandatory)][string]$Failure)
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $script:Gcloud @CommandArgs *> $null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw $Failure }
}

function Get-ServiceEnvironment {
  $raw = Get-GcloudText @(
    'run', 'services', 'describe', 'velostra-api',
    ('--region=' + $Region), ('--project=' + $ProjectId), '--format=json'
  ) 'Unable to inspect the staging API'
  $service = $raw | ConvertFrom-Json
  $result = @{}
  foreach ($entry in @($service.spec.template.spec.containers[0].env)) {
    if ($entry.name -and $entry.PSObject.Properties.Name -contains 'value' -and $null -ne $entry.value) {
      $result[[string]$entry.name] = [string]$entry.value
    }
  }
  return $result
}

function Set-ServiceEnvironment {
  param(
    [Parameter(Mandatory)][hashtable]$Update,
    [Parameter(Mandatory)][string[]]$Remove,
    [Parameter(Mandatory)][string]$Failure
  )
  $privateDirectory = Join-Path $RepositoryRoot 'artifacts\staging\evidence\private'
  [IO.Directory]::CreateDirectory($privateDirectory) | Out-Null
  $flagsPath = Join-Path $privateDirectory ('public-testnet-flags-' + [Guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText(
      $flagsPath,
      ([ordered]@{ '--update-env-vars' = $Update; '--remove-env-vars' = $Remove } | ConvertTo-Json -Depth 6),
      [Text.UTF8Encoding]::new($false)
    )
    Invoke-GcloudQuiet @(
      'run', 'services', 'update', 'velostra-api',
      ('--region=' + $Region), ('--project=' + $ProjectId),
      ('--flags-file=' + $flagsPath), '--quiet'
    ) $Failure
  } finally {
    if (Test-Path -LiteralPath $flagsPath) { Remove-Item -LiteralPath $flagsPath -Force }
  }
}

function Wait-ApiState {
  param(
    [Parameter(Mandatory)][string]$ApiUrl,
    [Parameter(Mandatory)][string]$Release,
    [Parameter(Mandatory)][ValidateSet('enabled', 'disabled')][string]$PaidWrites
  )
  for ($attempt = 1; $attempt -le 18; $attempt++) {
    try {
      $health = Invoke-RestMethod -Method Get -Uri ($ApiUrl.TrimEnd('/') + '/health') -TimeoutSec 15
      if (
        [string]$health.status -eq 'ok' -and
        [string]$health.environment -eq 'staging' -and
        [int]$health.chainId -eq $ChainId -and
        [string]$health.release -eq $Release -and
        [string]$health.paidWrites -eq $PaidWrites -and
        [bool]$health.publicTestnet -eq ($PaidWrites -eq 'enabled')
      ) { return }
    } catch {}
    Start-Sleep -Seconds 5
  }
  throw ('Staging API did not reach the expected ' + $PaidWrites + ' state')
}

function Wait-ApiReady {
  param([Parameter(Mandatory)][string]$ApiUrl, [Parameter(Mandatory)][string]$Release)
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
      $ready = Invoke-RestMethod -Method Get -Uri ($ApiUrl.TrimEnd('/') + '/ready') -TimeoutSec 15
      if ([string]$ready.status -eq 'ready' -and [string]$ready.release -eq $Release -and [bool]$ready.ready) {
        return
      }
    } catch {}
    Start-Sleep -Seconds 5
  }
  throw 'Staging API dependencies did not pass readiness before public access'
}

function Assert-FreshSignerEvidence {
  if (-not (Test-Path -LiteralPath $SignerEvidencePath)) {
    throw 'Fresh signer gas readiness evidence is required before public access'
  }
  $evidence = Get-Content -Raw -LiteralPath $SignerEvidencePath | ConvertFrom-Json
  $capturedAt = [DateTimeOffset]::Parse([string]$evidence.capturedAt)
  if (
    [string]$evidence.kind -ne 'velostra-staging-signer-gas-readiness' -or
    [string]$evidence.environment -ne 'staging' -or
    [int]$evidence.chainId -ne $ChainId -or
    [bool]$evidence.paidWritesDisabled -ne $true -or
    [bool]$evidence.signerGasReady -ne $true -or
    [bool]$evidence.passed -ne $true -or
    [DateTimeOffset]::UtcNow.Subtract($capturedAt).TotalHours -gt 2
  ) { throw 'Signer gas readiness evidence is invalid or stale' }
}

function New-ReleaseBinding {
  param([Parameter(Mandatory)][string]$Release)
  & npm --prefix (Join-Path $RepositoryRoot 'server') run build *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Server build failed before public release binding' }
  $databaseUrl = Get-GcloudText @(
    'secrets', 'versions', 'access', 'latest', '--secret=database-url',
    ('--project=' + $ProjectId)
  ) 'Unable to load the managed staging database binding'
  $previous = @{}
  foreach ($name in @('DATABASE_URL','VELOSTRA_ENVIRONMENT','VELOSTRA_RELEASE','VELOSTRA_PROCESS_ROLE','ROBINHOOD_CHAIN_ID','PHASE2_STAGING_CANARY_APPROVAL')) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  try {
    $env:DATABASE_URL = $databaseUrl
    $env:VELOSTRA_ENVIRONMENT = 'staging'
    $env:VELOSTRA_RELEASE = $Release
    $env:VELOSTRA_PROCESS_ROLE = 'staging-public-binding'
    $env:ROBINHOOD_CHAIN_ID = [string]$ChainId
    $env:PHASE2_STAGING_CANARY_APPROVAL = 'isolated-staging-paid-canary'
    $raw = & node (Join-Path $RepositoryRoot 'server\dist\scripts\create-staging-canary-binding.js') 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the private public-testnet release binding' }
    return (($raw | Select-Object -Last 1) | Out-String).Trim() | ConvertFrom-Json
  } finally {
    $databaseUrl = $null
    Remove-Variable databaseUrl -ErrorAction SilentlyContinue
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
  }
}

if (-not (Test-Path -LiteralPath $RuntimePath)) { throw 'Managed staging runtime artifact is missing' }
$Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
if ([string]$Runtime.region -ne $Region -or [int]$Runtime.chainId -ne $ChainId -or [string]$Runtime.projectId -ne $ProjectId) {
  throw 'Runtime artifact is not the approved US Robinhood testnet stack'
}
$ApiUrl = [string]$Runtime.apiUrl
$Release = ([string]$Runtime.release).ToLowerInvariant()
if (-not [Uri]::IsWellFormedUriString($ApiUrl, [UriKind]::Absolute) -or ([Uri]$ApiUrl).Scheme -ne 'https' -or $Release -notmatch '^[0-9a-f]{40}$') {
  throw 'Runtime API or immutable release is invalid'
}

if ($Action -eq 'Plan') {
  Write-Output 'PLAN expose the US Robinhood testnet with per-call, per-wallet, global, top-up, and action-rate caps'
  Write-Output 'PLAN require exact immutable release, healthy dependencies, fresh signer gas evidence, and owner approval'
  Write-Output 'PLAN roll back to disabled automatically if the public health transition fails'
  exit 0
}

$environment = Get-ServiceEnvironment
$currentMode = if ($environment.ContainsKey('PHASE3_PAID_WRITES_MODE')) { [string]$environment.PHASE3_PAID_WRITES_MODE } else { 'disabled' }
if ($Action -eq 'Status') {
  $bound = $environment.ContainsKey('PHASE3_RELEASE_MANIFEST_B64') -and $environment.ContainsKey('PUBLIC_TESTNET_APPROVAL')
  Write-Output ('public testnet paid-write mode: ' + $currentMode)
  Write-Output ('immutable public guardrail binding present: ' + [bool]$bound)
  exit 0
}
if (-not $Apply) { throw 'Open/Close requires -Apply' }

$removePublic = @(
  '@PHASE3_PAID_WRITES_MODE',
  'PUBLIC_TESTNET_APPROVAL',
  'PUBLIC_TESTNET_MAX_GROSS_PER_CALL_MINOR',
  'PUBLIC_TESTNET_PAID_CALLS_PER_WALLET_DAY',
  'PUBLIC_TESTNET_PAID_CALLS_GLOBAL_DAY',
  'PUBLIC_TESTNET_MAX_TOPUP_USD',
  'SENSITIVE_ACTION_RATE_LIMIT_PER_MINUTE',
  'PHASE3_RELEASE_MANIFEST_B64',
  'PHASE3_RELEASE_MANIFEST_SHA256',
  'PHASE3_CANARY_POLICY_B64',
  'PHASE3_CANARY_POLICY_SHA256',
  'PHASE3_CANARY_STARTED_AT'
)
if ($Action -eq 'Close') {
  Set-ServiceEnvironment -Update @{
    PHASE3_PAID_WRITES_MODE = 'disabled'
    PHASE3_CANARY_EXIT_APPROVAL = 'not-approved'
  } -Remove $removePublic -Failure 'Failed to close public testnet paid writes'
  Wait-ApiState $ApiUrl $Release 'disabled'
  $Runtime.paidWritesMode = 'disabled'
  [IO.File]::WriteAllText($RuntimePath, ($Runtime | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  Write-Output 'PASS public paid writes are disabled; claims, indexing, and reconciliation remain active'
  exit 0
}

$head = (& git -C $RepositoryRoot rev-parse HEAD | Out-String).Trim().ToLowerInvariant()
$dirty = (& git -C $RepositoryRoot status --porcelain | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$' -or $dirty) { throw 'Public opening requires a clean immutable worktree' }
if ($head -ne $Release) { throw 'Public opening requires the deployed release to equal the operator release' }
if ($currentMode -ne 'disabled') { throw 'Public opening requires paid writes to start disabled' }
Assert-FreshSignerEvidence
Wait-ApiState $ApiUrl $Release 'disabled'
Wait-ApiReady $ApiUrl $Release
$binding = New-ReleaseBinding $Release
if ([string]$binding.release -ne $Release -or [int]$binding.chainId -ne $ChainId -or [string]$binding.manifestSha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'Generated public-testnet release binding failed validation'
}
try {
  Set-ServiceEnvironment -Update @{
    PHASE3_PAID_WRITES_MODE = 'public'
    PUBLIC_TESTNET_APPROVAL = 'owner-approved-public-testnet'
    PUBLIC_TESTNET_MAX_GROSS_PER_CALL_MINOR = '5000000'
    PUBLIC_TESTNET_PAID_CALLS_PER_WALLET_DAY = '10'
    PUBLIC_TESTNET_PAID_CALLS_GLOBAL_DAY = '1000'
    PUBLIC_TESTNET_MAX_TOPUP_USD = '100'
    SENSITIVE_ACTION_RATE_LIMIT_PER_MINUTE = '5'
    PHASE3_RELEASE_MANIFEST_B64 = [string]$binding.manifestB64
    PHASE3_RELEASE_MANIFEST_SHA256 = [string]$binding.manifestSha256
    PHASE3_CANARY_EXIT_APPROVAL = 'not-approved'
  } -Remove @(
    '@PHASE3_PAID_WRITES_MODE',
    'PHASE2_STAGING_CANARY_APPROVAL',
    'PHASE3_CANARY_POLICY_B64',
    'PHASE3_CANARY_POLICY_SHA256',
    'PHASE3_CANARY_STARTED_AT'
  ) -Failure 'Failed to open bounded public testnet paid writes'
  Wait-ApiState $ApiUrl $Release 'enabled'
} catch {
  Set-ServiceEnvironment -Update @{
    PHASE3_PAID_WRITES_MODE = 'disabled'
    PHASE3_CANARY_EXIT_APPROVAL = 'not-approved'
  } -Remove $removePublic -Failure 'Public opening failed and automatic close also failed'
  Wait-ApiState $ApiUrl $Release 'disabled'
  throw
}
$Runtime.paidWritesMode = 'public'
$Runtime | Add-Member -NotePropertyName publicTestnetOpenedAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
[IO.File]::WriteAllText($RuntimePath, ($Runtime | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output 'PASS bounded public testnet paid writes are enabled on the immutable US staging release'