param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-staging-us',
  [ValidatePattern('^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$')]
  [string]$BillingAccount,
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'staging.config.json'),
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'test-staging-policy.ps1') -ConfigPath $ConfigPath
$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
$region = [string]$config.residency.gcpRegion
$budgetUsd = [decimal]$config.cost.gcpBudgetAlert
$repository = [string]$config.gcp.artifactRepository
$keyRing = [string]$config.gcp.kms.keyRing
$keyName = [string]$config.gcp.kms.key
if ($region -ne 'us-east4') { throw 'Bootstrap is locked to us-east4' }
if ($budgetUsd -gt 20) { throw 'GCP budget exceeds the approved USD 20 allocation' }
if ($Apply -and [string]::IsNullOrWhiteSpace($BillingAccount)) {
  throw 'BillingAccount is required with -Apply'
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloudCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
)
$gcloud = $gcloudCandidates |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (-not $gcloud) {
  $command = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($command) { $gcloud = $command.Source }
}
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

function Format-Command {
  param([string[]]$CommandArgs)
  return 'gcloud ' + (($CommandArgs | ForEach-Object {
    if ($_ -match '\s') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
  }) -join ' ')
}

function Invoke-Gcloud {
  param([string[]]$CommandArgs)
  Write-Output ($(if ($Apply) { 'APPLY ' } else { 'PLAN  ' }) + (Format-Command $CommandArgs))
  if (-not $Apply) { return }
  & $script:gcloud @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw 'gcloud failed: ' + (Format-Command $CommandArgs)
  }
}

function Test-GcloudResource {
  param([string[]]$CommandArgs)
  if (-not $Apply) { return $false }
  & $script:gcloud @CommandArgs *> $null
  return $LASTEXITCODE -eq 0
}

function Get-GcloudValue {
  param([string[]]$CommandArgs)
  if (-not $Apply) { return '' }
  $value = & $script:gcloud @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw 'gcloud query failed: ' + (Format-Command $CommandArgs)
  }
  return ($value | Out-String).Trim()
}

if ($Apply) {
  $account = Get-GcloudValue @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)')
  if ([string]::IsNullOrWhiteSpace($account)) {
    throw 'No active gcloud account; run gcloud auth login first'
  }
}

$labels = 'application=velostra,environment=staging,residency=us-only,managed-by=codex'
if (-not (Test-GcloudResource @('projects', 'describe', $ProjectId))) {
  Invoke-Gcloud @(
    'projects', 'create', $ProjectId,
    '--name=Velostra Staging US',
    ('--labels=' + $labels)
  )
}
if ($Apply) {
  Invoke-Gcloud @(
    'billing', 'projects', 'link', $ProjectId,
    ('--billing-account=' + $BillingAccount)
  )
}
Invoke-Gcloud @('config', 'set', 'project', $ProjectId)
Invoke-Gcloud @('config', 'set', 'run/region', $region)

$apis = @(
  'artifactregistry.googleapis.com',
  'cloudbilling.googleapis.com',
  'cloudbuild.googleapis.com',
  'cloudkms.googleapis.com',
  'cloudscheduler.googleapis.com',
  'iam.googleapis.com',
  'iamcredentials.googleapis.com',
  'logging.googleapis.com',
  'monitoring.googleapis.com',
  'run.googleapis.com',
  'secretmanager.googleapis.com'
)
Invoke-Gcloud (@('services', 'enable') + $apis + @(('--project=' + $ProjectId)))

if (-not (Test-GcloudResource @(
  'artifacts', 'repositories', 'describe', $repository,
  ('--location=' + $region),
  ('--project=' + $ProjectId)
))) {
  Invoke-Gcloud @(
    'artifacts', 'repositories', 'create', $repository,
    '--repository-format=docker',
    ('--location=' + $region),
    '--description=Velostra immutable staging images',
    ('--labels=' + $labels),
    ('--project=' + $ProjectId)
  )
}

$serviceAccounts = [ordered]@{
  api = 'Velostra staging API'
  signer = 'Velostra restricted settlement signer'
  jobs = 'Velostra scheduled operational jobs'
  scheduler = 'Velostra Cloud Scheduler invoker'
}
foreach ($entry in $serviceAccounts.GetEnumerator()) {
  $email = $entry.Key + '@' + $ProjectId + '.iam.gserviceaccount.com'
  if (-not (Test-GcloudResource @(
    'iam', 'service-accounts', 'describe', $email,
    ('--project=' + $ProjectId)
  ))) {
    Invoke-Gcloud @(
      'iam', 'service-accounts', 'create', $entry.Key,
      ('--display-name=' + $entry.Value),
      ('--project=' + $ProjectId)
    )
  }
}

if (-not (Test-GcloudResource @(
  'kms', 'keyrings', 'describe', $keyRing,
  ('--location=' + $region),
  ('--project=' + $ProjectId)
))) {
  Invoke-Gcloud @(
    'kms', 'keyrings', 'create', $keyRing,
    ('--location=' + $region),
    ('--project=' + $ProjectId)
  )
}
if (-not (Test-GcloudResource @(
  'kms', 'keys', 'describe', $keyName,
  ('--keyring=' + $keyRing),
  ('--location=' + $region),
  ('--project=' + $ProjectId)
))) {
  Invoke-Gcloud @(
    'kms', 'keys', 'create', $keyName,
    ('--keyring=' + $keyRing),
    ('--location=' + $region),
    ('--purpose=' + $config.gcp.kms.purpose),
    ('--default-algorithm=' + $config.gcp.kms.algorithm),
    ('--protection-level=' + $config.gcp.kms.protectionLevel),
    ('--labels=' + $labels),
    ('--project=' + $ProjectId)
  )
}
Invoke-Gcloud @(
  'kms', 'keys', 'add-iam-policy-binding', $keyName,
  ('--keyring=' + $keyRing),
  ('--location=' + $region),
  ('--member=serviceAccount:signer@' + $ProjectId + '.iam.gserviceaccount.com'),
  '--role=roles/cloudkms.signerVerifier',
  ('--project=' + $ProjectId)
)

$secretAccess = [ordered]@{
  'database-url' = @('api', 'jobs')
  'redis-url' = @('api', 'signer', 'jobs')
  'jwt-secret' = @('api')
  'gateway-hmac-secret' = @('api')
  'platform-cursor-secret' = @('api')
  'agent-secret-encryption-key' = @('api', 'jobs')
  'metrics-auth-token' = @('api')
  'signer-auth-token' = @('api', 'signer', 'jobs')
  'primary-rpc-url' = @('api', 'signer', 'jobs')
  'fallback-rpc-urls' = @('api', 'jobs')
  'alert-webhook-url' = @('jobs')
  'alert-webhook-token' = @('jobs')
}
foreach ($entry in $secretAccess.GetEnumerator()) {
  if (-not (Test-GcloudResource @(
    'secrets', 'describe', $entry.Key,
    ('--project=' + $ProjectId)
  ))) {
    Invoke-Gcloud @(
      'secrets', 'create', $entry.Key,
      '--replication-policy=user-managed',
      ('--locations=' + $region),
      ('--labels=' + $labels),
      ('--project=' + $ProjectId)
    )
  }
  foreach ($serviceAccount in $entry.Value) {
    Invoke-Gcloud @(
      'secrets', 'add-iam-policy-binding', $entry.Key,
      ('--member=serviceAccount:' + $serviceAccount + '@' + $ProjectId + '.iam.gserviceaccount.com'),
      '--role=roles/secretmanager.secretAccessor',
      ('--project=' + $ProjectId)
    )
  }
}


$projectNumber = if ($Apply) {
  Get-GcloudValue @(
    'projects', 'describe', $ProjectId,
    '--format=value(projectNumber)'
  )
} else {
  '<project-number>'
}
$budgetDisplayName = 'Velostra Staging US - USD ' + $budgetUsd
$budgetExists = $false
if ($Apply) {
  $existingBudget = Get-GcloudValue @(
    'billing', 'budgets', 'list',
    ('--billing-account=' + $BillingAccount),
    ('--filter=displayName=' + $budgetDisplayName),
    '--format=value(name)'
  )
  $budgetExists = -not [string]::IsNullOrWhiteSpace($existingBudget)
}
if (-not $budgetExists) {
  Invoke-Gcloud @(
    'billing', 'budgets', 'create',
    ('--billing-account=' + $(if ($Apply) { $BillingAccount } else { '<billing-account>' })),
    ('--display-name=' + $budgetDisplayName),
    ('--budget-amount=' + $budgetUsd + 'USD'),
    ('--filter-projects=projects/' + $projectNumber),
    '--threshold-rule=percent=0.5',
    '--threshold-rule=percent=0.8',
    '--threshold-rule=percent=1.0'
  )
}

Write-Output ''
Write-Output 'Bootstrap scope complete.'
Write-Output ('Region: ' + $region + ' (US only)')
Write-Output ('GCP alert budget: USD ' + $budgetUsd + '; total cross-provider envelope: USD ' + $config.cost.totalMonthlyEnvelope)
Write-Output ('KMS key version: projects/' + $ProjectId + '/locations/' + $region + '/keyRings/' + $keyRing + '/cryptoKeys/' + $keyName + '/cryptoKeyVersions/1')
if (-not $Apply) {
  Write-Output 'Plan-only: rerun with -Apply -BillingAccount XXXXXX-XXXXXX-XXXXXX after Cloud Billing is active.'
}
