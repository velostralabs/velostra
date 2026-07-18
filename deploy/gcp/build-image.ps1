param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('server', 'web')]
  [string]$Component,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$Release,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$ApiUrl,
  [string]$EscrowAddress,
  [string]$SettlementTokenAddress,
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
$repository = [string]$config.gcp.artifactRepository
if ($region -ne 'us-east4') { throw 'Image builds are locked to us-east4' }

if ($Component -eq 'web') {
  if ([string]::IsNullOrWhiteSpace($ApiUrl) -or
      [string]::IsNullOrWhiteSpace($EscrowAddress) -or
      [string]::IsNullOrWhiteSpace($SettlementTokenAddress)) {
    throw 'Web build requires ApiUrl, EscrowAddress, and SettlementTokenAddress'
  }
  $parsedApiUrl = [Uri]$ApiUrl
  if ($parsedApiUrl.Scheme -ne 'https' -or $parsedApiUrl.UserInfo) {
    throw 'ApiUrl must be credential-free HTTPS'
  }
  foreach ($address in @($EscrowAddress, $SettlementTokenAddress)) {
    if ($address -notmatch '^0x[0-9a-fA-F]{40}$' -or
        $address -eq '0x0000000000000000000000000000000000000000') {
      throw 'Web contract addresses must be non-zero EVM addresses'
    }
  }
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

function Invoke-GcloudChecked {
  param(
    [Parameter(Mandatory)]
    [string[]]$CommandArgs,
    [Parameter(Mandatory)]
    [string]$FailureMessage
  )
  $previousErrorActionPreference = $ErrorActionPreference
  $output = $null
  $exitCode = $null
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $script:gcloud @CommandArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) { throw $FailureMessage }
  foreach ($line in @($output)) {
    Write-Output ([string]$line)
  }
}

function Get-GcloudTextChecked {
  param(
    [Parameter(Mandatory)]
    [string[]]$CommandArgs,
    [Parameter(Mandatory)]
    [string]$FailureMessage
  )
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $script:gcloud @CommandArgs 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) { throw $FailureMessage }
  return ($output | Out-String).Trim()
}

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$head = (& git -C $repositoryRoot rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the repository commit' }
if ($head -ne $Release.ToLowerInvariant()) {
  throw 'Release must equal the current full commit SHA'
}
if ($Apply) {
  $dirty = (& git -C $repositoryRoot status --porcelain | Out-String).Trim()
  if ($dirty) { throw 'Image builds require a clean worktree' }
}

$imageTag = $region + '-docker.pkg.dev/' + $ProjectId + '/' +
  $repository + '/' + $Component + ':' + $Release.ToLowerInvariant()
$buildServiceAccount = 'projects/' + $ProjectId +
  '/serviceAccounts/velostra-builder@' + $ProjectId + '.iam.gserviceaccount.com'
if (-not $Apply) {
  Write-Output ('PLAN  immutable image: ' + $imageTag)
  Write-Output ('PLAN  Cloud Build identity: ' + $buildServiceAccount)
  Write-Output (
    'PLAN  gcloud builds submit ' + $Component +
    ' --service-account=' + $buildServiceAccount +
    ' --default-buckets-behavior=regional-user-owned-bucket --region=' + $region
  )
  if ($Component -eq 'web') {
    Write-Output ('PLAN  Cloud Build web image with API ' + $ApiUrl)
  }
  return
}

if ($Component -eq 'server') {
  $substitutions = '_IMAGE=' + $imageTag
  $buildArgs = @(
    'builds', 'submit', (Join-Path $repositoryRoot 'server'),
    ('--config=' + (Join-Path $PSScriptRoot 'cloudbuild-server.yaml')),
    ('--substitutions=' + $substitutions)
  )
} else {
  $substitutions = '_IMAGE=' + $imageTag +
    ',_PUBLIC_API_URL=' + $ApiUrl +
    ',_PUBLIC_ESCROW_ADDRESS=' + $EscrowAddress +
    ',_PUBLIC_SETTLEMENT_TOKEN_ADDRESS=' + $SettlementTokenAddress
  $buildArgs = @(
    'builds', 'submit', $repositoryRoot,
    ('--config=' + (Join-Path $PSScriptRoot 'cloudbuild-web.yaml')),
    ('--substitutions=' + $substitutions)
  )
}
$buildArgs += @(
  ('--service-account=' + $buildServiceAccount),
  '--default-buckets-behavior=regional-user-owned-bucket',
  ('--region=' + $region),
  ('--project=' + $ProjectId)
)
Invoke-GcloudChecked -CommandArgs $buildArgs -FailureMessage 'Cloud Build failed'

$describeArgs = @(
  'artifacts', 'docker', 'images', 'describe', $imageTag,
  ('--project=' + $ProjectId),
  '--format=value(image_summary.digest)'
)
$digest = Get-GcloudTextChecked -CommandArgs $describeArgs -FailureMessage 'Artifact Registry image lookup failed'
if ($digest -notmatch '^sha256:[0-9a-f]{64}$') {
  throw 'Artifact Registry did not return an immutable image digest'
}
$immutableImage = $region + '-docker.pkg.dev/' + $ProjectId + '/' +
  $repository + '/' + $Component + '@' + $digest
$artifactDirectory = Join-Path $repositoryRoot 'artifacts\staging'
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
$record = [ordered]@{
  schemaVersion = 1
  kind = 'velostra-staging-container-image'
  component = $Component
  release = $Release.ToLowerInvariant()
  region = $region
  tag = $imageTag
  digest = $digest
  immutableImage = $immutableImage
  capturedAt = [DateTime]::UtcNow.ToString('o')
}
$recordPath = Join-Path $artifactDirectory ($Component + '-image.json')
[System.IO.File]::WriteAllText(
  $recordPath,
  ($record | ConvertTo-Json) + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Output ($record | ConvertTo-Json)
