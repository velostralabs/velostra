param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimePath = Join-Path $RepositoryRoot 'artifacts\staging\runtime.json'
$EvidencePath = Join-Path $RepositoryRoot 'artifacts\staging\evidence\alert-lifecycle.json'

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

if (-not (Test-Path -LiteralPath $RuntimePath)) { throw 'Managed staging runtime artifact is missing' }
$Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
if (
  [string]$Runtime.kind -ne 'velostra-us-staging-runtime' -or
  [string]$Runtime.region -ne 'us-east4' -or
  [int64]$Runtime.chainId -ne 46630 -or
  [string]$Runtime.paidWritesMode -ne 'disabled'
) { throw 'Managed staging artifact failed alert evidence guardrails' }

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$script:Gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $script:Gcloud) { throw 'Google Cloud CLI is required' }

$DatabaseUrl = $null
try {
  $DatabaseUrl = Get-ManagedSecret 'database-url'
  $env:VELOSTRA_ALERT_EVIDENCE_APPROVAL = 'read-only-staging-alert-evidence'
  $env:VELOSTRA_ENVIRONMENT = 'staging'
  $env:PHASE3_PAID_WRITES_MODE = 'disabled'
  $env:DATABASE_URL = $DatabaseUrl
  $env:ALERT_EVIDENCE_OUTPUT = $EvidencePath
  Push-Location $RepositoryRoot
  try {
    $output = Invoke-NativeChecked -FailureMessage 'Alert lifecycle evidence failed' -Command {
      & npm '--silent' '--prefix' 'server' 'run' 'staging:alert-evidence'
    }
  } finally { Pop-Location }
  $json = @($output | Where-Object { [string]$_ -match '^\{' })[-1]
  if (-not $json) { throw 'Alert lifecycle collector returned no bounded result' }
  Write-Output $json
  $result = $json | ConvertFrom-Json
  if ($result.passed -ne $true) { throw 'Alert lifecycle invariants did not pass' }
} finally {
  foreach ($name in @(
    'VELOSTRA_ALERT_EVIDENCE_APPROVAL','VELOSTRA_ENVIRONMENT',
    'PHASE3_PAID_WRITES_MODE','DATABASE_URL','ALERT_EVIDENCE_OUTPUT'
  )) { Remove-Item ('Env:' + $name) -ErrorAction SilentlyContinue }
  $DatabaseUrl = $null
}
