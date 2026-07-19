param(
  [ValidateSet('Plan', 'Open', 'Close', 'Status')]
  [string]$Action = 'Plan',
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$configPath = Join-Path $PSScriptRoot 'staging.config.json'
& (Join-Path $PSScriptRoot 'test-staging-policy.ps1') -ConfigPath $configPath
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$region = [string]$config.residency.gcpRegion
if ($region -ne 'us-east4' -or [int]$config.network.chainId -ne 46630) {
  throw 'Paid canary control is locked to US Robinhood testnet staging'
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1'),
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

function Get-GcloudText {
  param([Parameter(Mandatory)][string[]]$CommandArgs, [Parameter(Mandatory)][string]$Failure)
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $script:gcloud @CommandArgs 2>$null
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
    & $script:gcloud @CommandArgs *> $null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw $Failure }
}

function Get-ServiceEnvironment {
  $raw = Get-GcloudText @(
    'run', 'services', 'describe', 'velostra-api',
    ('--region=' + $region), ('--project=' + $ProjectId), '--format=json'
  ) 'Unable to inspect the staging API'
  $service = $raw | ConvertFrom-Json
  $result = @{}
  foreach ($entry in @($service.spec.template.spec.containers[0].env)) {
    if ($entry.name -and $entry.PSObject.Properties.Name -contains 'value' -and $null -ne $entry.value) { $result[[string]$entry.name] = [string]$entry.value }
  }
  return $result
}

function Wait-ApiHealth {
  param([Parameter(Mandatory)][string]$ApiUrl, [Parameter(Mandatory)][string]$Release)
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
      $health = Invoke-RestMethod -Method Get -Uri ($ApiUrl.TrimEnd('/') + '/health') -TimeoutSec 15
      if (
        [string]$health.status -eq 'ok' -and
        [string]$health.service -eq 'velostra-api' -and
        [string]$health.environment -eq 'staging' -and
        [int]$health.chainId -eq 46630 -and
        [string]$health.release -eq $Release
      ) { return }
    } catch {}
    Start-Sleep -Seconds 5
  }
  throw 'Staging API did not become healthy on the expected release'
}

$runtimePath = Join-Path $repositoryRoot 'artifacts\staging\runtime.json'
if (-not (Test-Path -LiteralPath $runtimePath)) {
  throw 'Managed staging runtime artifact is missing'
}
$runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
if (
  [string]$runtime.region -ne 'us-east4' -or
  [int]$runtime.chainId -ne 46630 -or
  [string]$runtime.projectId -ne $ProjectId
) { throw 'Runtime artifact is not the approved US testnet stack' }
$apiUrl = [string]$runtime.apiUrl
if (-not [Uri]::IsWellFormedUriString($apiUrl, [UriKind]::Absolute) -or ([Uri]$apiUrl).Scheme -ne 'https') {
  throw 'Runtime API URL is invalid'
}

if ($Action -eq 'Plan') {
  Write-Output 'PLAN open one hashed-subject, one-call, USDG 1.20, one-hour staging canary'
  Write-Output 'PLAN run only the separately approved MetaMask evidence harness'
  Write-Output 'PLAN close paid writes in a finally block and preserve claims/reconciliation'
  exit 0
}

$environment = Get-ServiceEnvironment
$currentMode = if ($environment.ContainsKey('PHASE3_PAID_WRITES_MODE')) {
  [string]$environment.PHASE3_PAID_WRITES_MODE
} else { 'disabled' }

if ($Action -eq 'Status') {
  $bindingPresent =
    $environment.ContainsKey('PHASE3_RELEASE_MANIFEST_B64') -and
    $environment.ContainsKey('PHASE3_CANARY_POLICY_B64') -and
    $environment.ContainsKey('PHASE3_CANARY_STARTED_AT')
  Write-Output ('staging paid-write mode: ' + $currentMode)
  Write-Output ('bounded canary binding present: ' + [bool]$bindingPresent)
  exit 0
}

if (-not $Apply) { throw 'Open/Close requires -Apply' }

if ($Action -eq 'Close') {
  Invoke-GcloudQuiet @(
    'run', 'services', 'update', 'velostra-api',
    ('--region=' + $region), ('--project=' + $ProjectId),
    '--update-env-vars=PHASE3_PAID_WRITES_MODE=disabled,PHASE3_CANARY_EXIT_APPROVAL=not-approved',
    '--remove-env-vars=@PHASE3_PAID_WRITES_MODE,PHASE2_STAGING_CANARY_APPROVAL,PHASE3_RELEASE_MANIFEST_B64,PHASE3_RELEASE_MANIFEST_SHA256,PHASE3_CANARY_POLICY_B64,PHASE3_CANARY_POLICY_SHA256,PHASE3_CANARY_STARTED_AT',
    '--quiet'
  ) 'Failed to close the staging paid canary'
  Wait-ApiHealth $apiUrl ([string]$runtime.release)
  $runtime.paidWritesMode = 'disabled'
  foreach ($name in @('canaryStartedAt', 'canaryPolicySha256')) {
    if ($runtime.PSObject.Properties.Name -contains $name) {
      $runtime.PSObject.Properties.Remove($name)
    }
  }
  [System.IO.File]::WriteAllText(
    $runtimePath,
    ($runtime | ConvertTo-Json -Depth 8) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Output 'PASS staging paid writes are disabled; claims and reconciliation remain available'
  exit 0
}

$head = (& git -C $repositoryRoot rev-parse HEAD | Out-String).Trim().ToLowerInvariant()
$deployedRelease = ([string]$runtime.release).Trim().ToLowerInvariant()
if (
  $LASTEXITCODE -ne 0 -or
  $head -notmatch '^[0-9a-f]{40}$' -or
  $deployedRelease -notmatch '^[0-9a-f]{40}$'
) {
  throw 'Unable to resolve the immutable operator or deployed release'
}
& git -C $repositoryRoot merge-base --is-ancestor $deployedRelease $head
if ($LASTEXITCODE -ne 0) {
  throw 'Deployed release must be an ancestor of the clean operator scripts'
}
$dirty = (& git -C $repositoryRoot status --porcelain | Out-String).Trim()
if ($dirty) { throw 'Opening the staging canary requires a clean worktree' }
if ($currentMode -ne 'disabled') {
  throw 'Staging API must be disabled before opening a new canary'
}

& npm --prefix (Join-Path $repositoryRoot 'server') run build *> $null
if ($LASTEXITCODE -ne 0) { throw 'Server build failed before canary binding generation' }

$databaseUrl = Get-GcloudText @(
  'secrets', 'versions', 'access', 'latest', '--secret=database-url',
  ('--project=' + $ProjectId)
) 'Unable to load the managed staging database binding'
$previousValues = @{}
foreach ($name in @(
  'DATABASE_URL', 'VELOSTRA_ENVIRONMENT', 'VELOSTRA_RELEASE',
  'VELOSTRA_PROCESS_ROLE', 'ROBINHOOD_CHAIN_ID', 'PHASE2_STAGING_CANARY_APPROVAL'
)) {
  $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $env:DATABASE_URL = $databaseUrl
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:VELOSTRA_RELEASE = $deployedRelease
  $env:VELOSTRA_PROCESS_ROLE = 'staging-canary-binding'
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:PHASE2_STAGING_CANARY_APPROVAL = 'isolated-staging-paid-canary'
  $rawBinding = & node (Join-Path $repositoryRoot 'server\dist\scripts\create-staging-canary-binding.js') 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create the private staging canary binding' }
} finally {
  $databaseUrl = $null
  Remove-Variable databaseUrl -ErrorAction SilentlyContinue
  foreach ($name in $previousValues.Keys) {
    [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process')
  }
}
$binding = (($rawBinding | Select-Object -Last 1) | Out-String).Trim() | ConvertFrom-Json
if (
  [string]$binding.kind -ne 'velostra-staging-canary-binding' -or
  [string]$binding.release -ne $deployedRelease -or
  [int]$binding.chainId -ne 46630 -or
  [int]$binding.durationSeconds -ne 3600 -or
  [int]$binding.maxCalls -ne 1 -or
  [string]$binding.maxGrossMinor -ne '1200000' -or
  [string]$binding.policySha256 -notmatch '^[a-f0-9]{64}$' -or
  [string]$binding.manifestSha256 -notmatch '^[a-f0-9]{64}$'
) { throw 'Generated staging canary binding failed validation' }

$startedAt = [DateTime]::UtcNow.ToString('o')
$updated = '^@^' + (@(
  'PHASE3_PAID_WRITES_MODE=canary',
  'PHASE2_STAGING_CANARY_APPROVAL=isolated-staging-paid-canary',
  'PHASE3_RELEASE_MANIFEST_B64=' + [string]$binding.manifestB64,
  'PHASE3_RELEASE_MANIFEST_SHA256=' + [string]$binding.manifestSha256,
  'PHASE3_CANARY_POLICY_B64=' + [string]$binding.policyB64,
  'PHASE3_CANARY_POLICY_SHA256=' + [string]$binding.policySha256,
  'PHASE3_CANARY_STARTED_AT=' + $startedAt,
  'PHASE3_CANARY_EXIT_APPROVAL=not-approved'
) -join '@')
Invoke-GcloudQuiet @(
  'run', 'services', 'update', 'velostra-api',
  ('--region=' + $region), ('--project=' + $ProjectId),
  ('--update-env-vars=' + $updated),
  '--remove-env-vars=@PHASE3_PAID_WRITES_MODE,PHASE3_RELEASE_MANIFEST,PHASE3_CANARY_POLICY_PATH,PHASE3_CANARY_EXIT_EVIDENCE,PHASE3_CANARY_EXIT_EVIDENCE_SHA256',
  '--quiet'
) 'Failed to open the bounded staging paid canary'
Wait-ApiHealth $apiUrl $deployedRelease

$verified = Get-ServiceEnvironment
if (
  [string]$verified.PHASE3_PAID_WRITES_MODE -ne 'canary' -or
  [string]$verified.PHASE2_STAGING_CANARY_APPROVAL -ne 'isolated-staging-paid-canary' -or
  -not $verified.ContainsKey('PHASE3_RELEASE_MANIFEST_B64') -or
  -not $verified.ContainsKey('PHASE3_CANARY_POLICY_B64')
) {
  throw 'Staging API canary environment did not verify after deployment'
}
$runtime.paidWritesMode = 'canary'
$runtime | Add-Member -NotePropertyName canaryStartedAt -NotePropertyValue $startedAt -Force
$runtime | Add-Member -NotePropertyName canaryPolicySha256 -NotePropertyValue ([string]$binding.policySha256) -Force
[System.IO.File]::WriteAllText(
  $runtimePath,
  ($runtime | ConvertTo-Json -Depth 8) + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Output 'PASS one-call USDG 1.20 staging canary is open for hashed subjects only'
