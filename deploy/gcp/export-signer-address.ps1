param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-staging-us',
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'staging.config.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'test-staging-policy.ps1') -ConfigPath $ConfigPath
$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
$region = [string]$config.residency.gcpRegion
$keyRing = [string]$config.gcp.kms.keyRing
$key = [string]$config.gcp.kms.key
$version = [string]$config.gcp.kms.version

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

$describeArgs = @(
  'kms', 'keys', 'versions', 'describe', $version,
  ('--key=' + $key),
  ('--keyring=' + $keyRing),
  ('--location=' + $region),
  ('--project=' + $ProjectId),
  '--format=json'
)
$keyVersion = (& $gcloud @describeArgs | Out-String) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Unable to describe the KMS key version' }
if ($keyVersion.name -notmatch ('/locations/' + [regex]::Escape($region) + '/')) {
  throw 'KMS key version is outside the approved US region'
}
if ($keyVersion.algorithm -ne 'EC_SIGN_SECP256K1_SHA256') {
  throw 'KMS key version does not use secp256k1'
}
if ($keyVersion.protectionLevel -ne 'SOFTWARE') {
  throw 'KMS key version does not use the approved staging protection level'
}
if ($keyVersion.state -ne 'ENABLED') { throw 'KMS key version is not enabled' }

$artifactDirectory = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) 'artifacts\staging'
[System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
$pemPath = Join-Path $artifactDirectory 'kms-settlement-signer-public.pem'
$getPublicKeyArgs = @(
  'kms', 'keys', 'versions', 'get-public-key', $version,
  ('--key=' + $key),
  ('--keyring=' + $keyRing),
  ('--location=' + $region),
  ('--project=' + $ProjectId),
  ('--output-file=' + $pemPath)
)
& $gcloud @getPublicKeyArgs
if ($LASTEXITCODE -ne 0) { throw 'Unable to export KMS public key' }

$serverDirectory = Resolve-Path (Join-Path $PSScriptRoot '..\..\server')
$derivedJson = (& npm --silent --prefix $serverDirectory run kms:address -- $pemPath | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to derive the EVM signer address' }
$derived = $derivedJson | ConvertFrom-Json
if ($derived.address -notmatch '^0x[0-9a-fA-F]{40}$') {
  throw 'Derived signer address is invalid'
}

$record = [ordered]@{
  schemaVersion = 1
  kind = 'velostra-staging-kms-signer'
  projectId = $ProjectId
  region = $region
  keyVersion = $keyVersion.name
  algorithm = $keyVersion.algorithm
  protectionLevel = $keyVersion.protectionLevel
  state = $keyVersion.state
  address = $derived.address
  publicKeySha256 = $derived.pemSha256
  capturedAt = [DateTime]::UtcNow.ToString('o')
}
$recordPath = Join-Path $artifactDirectory 'kms-settlement-signer.json'
[System.IO.File]::WriteAllText(
  $recordPath,
  ($record | ConvertTo-Json -Depth 5) + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Output ($record | ConvertTo-Json -Depth 5)
