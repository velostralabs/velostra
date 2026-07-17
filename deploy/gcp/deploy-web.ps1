param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$Release,
  [Parameter(Mandatory = $true)]
  [string]$WebImage,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$ConfigPath,
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $PSScriptRoot 'staging.config.json'
}
& (Join-Path $PSScriptRoot 'test-staging-policy.ps1') -ConfigPath $ConfigPath
$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
$region = [string]$config.residency.gcpRegion
$servicePolicy = $config.gcp.cloudRun.services.web
if ($region -ne 'us-east4') { throw 'Web deployment is locked to us-east4' }

$imagePattern = '^' + $region + '-docker[.]pkg[.]dev/' +
  [regex]::Escape($ProjectId) + '/velostra/web@sha256:[0-9a-f]{64}$'
if ($WebImage -notmatch $imagePattern) {
  throw 'WebImage must be an immutable US Artifact Registry digest'
}

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$head = (& git -C $repositoryRoot rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the repository commit' }
if ($head -ne $Release.ToLowerInvariant()) {
  throw 'Release must equal the current full commit SHA'
}
if ($Apply) {
  $dirty = (& git -C $repositoryRoot status --porcelain | Out-String).Trim()
  if ($dirty) { throw 'Web deployment requires a clean worktree' }
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

$commandArgs = @(
  'run', 'deploy', 'velostra-web',
  ('--image=' + $WebImage),
  ('--region=' + $region),
  ('--project=' + $ProjectId),
  ('--service-account=velostra-web@' + $ProjectId + '.iam.gserviceaccount.com'),
  ('--cpu=' + [int]$servicePolicy.cpu),
  ('--memory=' + [string]$servicePolicy.memory),
  ('--min-instances=' + [int]$servicePolicy.minInstances),
  ('--max-instances=' + [int]$servicePolicy.maxInstances),
  ('--concurrency=' + [int]$servicePolicy.concurrency),
  '--port=8080',
  '--timeout=60s',
  '--ingress=all',
  '--allow-unauthenticated',
  '--labels=application=velostra,environment=staging,residency=us-only'
)
$formatted = 'gcloud ' + (($commandArgs | ForEach-Object {
  if ($_ -match '\s') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
}) -join ' ')
Write-Output ($(if ($Apply) { 'APPLY ' } else { 'PLAN  ' }) + $formatted)
if (-not $Apply) {
  Write-Output ''
  Write-Output 'Plan-only. No Cloud Run web service was changed.'
  exit 0
}

& $gcloud @commandArgs
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run web deployment failed' }
$urlArgs = @(
  'run', 'services', 'describe', 'velostra-web',
  ('--region=' + $region),
  ('--project=' + $ProjectId),
  '--format=value(status.url)'
)
$webUrl = (& $gcloud @urlArgs | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $webUrl -notmatch '^https://') {
  throw 'Cloud Run did not return a valid HTTPS web URL'
}

$artifactDirectory = Join-Path $repositoryRoot 'artifacts\staging'
[IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
$record = [ordered]@{
  schemaVersion = 1
  kind = 'velostra-us-staging-web-runtime'
  projectId = $ProjectId
  region = $region
  release = $Release.ToLowerInvariant()
  webImage = $WebImage
  webUrl = $webUrl
  capturedAt = [DateTime]::UtcNow.ToString('o')
}
[IO.File]::WriteAllText(
  (Join-Path $artifactDirectory 'web-runtime.json'),
  ($record | ConvertTo-Json -Depth 5) + [Environment]::NewLine,
  [Text.UTF8Encoding]::new($false)
)
Write-Output ($record | ConvertTo-Json -Depth 5)
