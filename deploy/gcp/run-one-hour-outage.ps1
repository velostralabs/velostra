param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [ValidateRange(3600, 7200)]
  [int]$DurationSeconds = 3600,
  [string]$EvidenceOutput = 'artifacts/staging/evidence/one-hour-outage.json',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimePath = Join-Path $RepositoryRoot 'artifacts\staging\runtime.json'
$DeploymentPath = Join-Path $RepositoryRoot 'artifacts\staging\robinhood-testnet-deployment.json'

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
  $output = Invoke-NativeChecked -FailureMessage ('Unable to access managed secret ' + $Name) -Command {
    & $script:Gcloud 'secrets' 'versions' 'access' 'latest' ('--secret=' + $Name) ('--project=' + $ProjectId)
  }
  $value = ($output | Out-String).Trim()
  if (-not $value) { throw 'Managed secret was empty' }
  return $value
}

if (-not $Apply) {
  Write-Output 'PLAN pause only the managed reconciliation Scheduler for at least 3600 seconds'
  Write-Output 'PLAN retain write-disabled staging, capture the safe-head target, run normal catch-up, and prove zero drift/duplicates'
  Write-Output 'PLAN always resume the Scheduler in finally'
  Write-Output 'No managed resource changed. Pass -Apply after explicit approval.'
  exit 0
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
  [int64]$Deployment.chainId -ne 46630
) { throw 'Managed staging artifacts failed the outage guardrails' }

$dirty = (& git -C $RepositoryRoot status --porcelain --untracked-files=no | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked worktree must be clean before outage evidence' }

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$script:Gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $script:Gcloud) { throw 'Google Cloud CLI is required' }

$RpcUrl = $null
$DatabaseUrl = $null
$SchedulerPaused = $false
try {
  $RpcUrl = Get-ManagedSecret 'primary-rpc-url'
  $DatabaseUrl = Get-ManagedSecret 'database-url'
  $env:VELOSTRA_DRILL_APPROVAL = 'isolated-staging-one-hour-outage-approved'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:VELOSTRA_RELEASE = [string]$Runtime.release
  $env:ROBINHOOD_CHAIN_ID = '46630'
  $env:PHASE3_PAID_WRITES_MODE = 'disabled'
  $env:ROBINHOOD_RPC_URL = $RpcUrl
  $env:DATABASE_URL = $DatabaseUrl
  $env:VELOSTRA_ESCROW_ADDRESS = [string]$Deployment.escrow.address
  $env:RECONCILE_CONFIRMATIONS = '12'
  $env:ROBINHOOD_RPC_TIMEOUT_MS = '10000'
  $env:OUTAGE_EVIDENCE_OUTPUT = $EvidenceOutput.Replace('\', '/')

  Push-Location $RepositoryRoot
  try {
    Invoke-NativeChecked -FailureMessage 'Server build failed before outage drill' -Command {
      & npm '--silent' '--prefix' 'server' 'run' 'build'
    } | Out-Null
    Invoke-NativeChecked -FailureMessage 'Unable to capture outage baseline' -Command {
      & node 'server/scripts/capture-staging-outage.mjs' '--before'
    } | Out-Null
  } finally {
    Pop-Location
  }

  $state = (Invoke-NativeChecked -FailureMessage 'Unable to inspect reconciliation Scheduler' -Command {
    & $script:Gcloud 'scheduler' 'jobs' 'describe' 'velostra-reconciliation-every-15m' '--location=us-east4' ('--project=' + $ProjectId) '--format=value(state)'
  } | Out-String).Trim()
  if ($state -ne 'ENABLED') { throw 'Reconciliation Scheduler must be enabled before the outage drill' }

  Invoke-NativeChecked -FailureMessage 'Unable to pause reconciliation Scheduler' -Command {
    & $script:Gcloud 'scheduler' 'jobs' 'pause' 'velostra-reconciliation-every-15m' '--location=us-east4' ('--project=' + $ProjectId) '--quiet'
  } | Out-Null
  $SchedulerPaused = $true
  Write-Output 'OUTAGE_WINDOW_STARTED'

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($DurationSeconds)
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    $remaining = [int][Math]::Ceiling(($deadline - [DateTimeOffset]::UtcNow).TotalSeconds)
    Start-Sleep -Seconds ([Math]::Min(45, [Math]::Max(1, $remaining)))
  }

  Push-Location $RepositoryRoot
  try {
    Invoke-NativeChecked -FailureMessage 'Unable to capture outage safe-head target' -Command {
      & node 'server/scripts/capture-staging-outage.mjs' '--mark-end'
    } | Out-Null
  } finally {
    Pop-Location
  }

  Invoke-NativeChecked -FailureMessage 'Managed reconciliation catch-up failed' -Command {
    & $script:Gcloud 'run' 'jobs' 'execute' 'velostra-reconciliation' '--region=us-east4' ('--project=' + $ProjectId) '--wait' '--quiet'
  } | Out-Null

  Push-Location $RepositoryRoot
  try {
    Invoke-NativeChecked -FailureMessage 'Managed outage verification failed' -Command {
      & node 'server/scripts/capture-staging-outage.mjs' '--verify'
    } | Out-Null
  } finally {
    Pop-Location
  }
  Write-Output 'PASS one-hour managed reconciliation outage caught up without drift or duplicates'
} finally {
  if ($SchedulerPaused) {
    try {
      Invoke-NativeChecked -FailureMessage 'Unable to resume reconciliation Scheduler' -Command {
        & $script:Gcloud 'scheduler' 'jobs' 'resume' 'velostra-reconciliation-every-15m' '--location=us-east4' ('--project=' + $ProjectId) '--quiet'
      } | Out-Null
      Write-Output 'RECONCILIATION_SCHEDULER_RESUMED'
    } catch {
      Write-Error $_
    }
  }
  foreach ($name in @(
    'VELOSTRA_DRILL_APPROVAL','VELOSTRA_ENVIRONMENT','VELOSTRA_RELEASE',
    'ROBINHOOD_CHAIN_ID','PHASE3_PAID_WRITES_MODE','ROBINHOOD_RPC_URL',
    'DATABASE_URL','VELOSTRA_ESCROW_ADDRESS','RECONCILE_CONFIRMATIONS',
    'ROBINHOOD_RPC_TIMEOUT_MS','OUTAGE_EVIDENCE_OUTPUT'
  )) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  $RpcUrl = $null
  $DatabaseUrl = $null
}
