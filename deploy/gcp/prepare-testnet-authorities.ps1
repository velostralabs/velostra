param(
  [string]$OutputDirectory = 'artifacts/staging/authority',
  [switch]$Force,
  [switch]$CopyDeployerAddress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'artifacts'))
$outputPath = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
  [IO.Path]::GetFullPath($OutputDirectory)
} else {
  [IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputDirectory))
}
$relativeOutput = $outputPath.Substring($artifactsRoot.Length).TrimStart('\', '/')
if (
  -not $outputPath.StartsWith(
    $artifactsRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  ) -or
  [string]::IsNullOrWhiteSpace($relativeOutput)
) {
  throw 'Authority output must stay below artifacts/'
}

$privateDirectory = Join-Path $outputPath 'private'
$planPath = Join-Path $outputPath 'testnet-authority-plan.json'
$deriveScript = Join-Path $repositoryRoot 'contracts\scripts\derive-address-from-private-key.js'
$utf8 = [Text.UTF8Encoding]::new($false)

function Write-JsonFile {
  param([string]$Path, [object]$Value)
  [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
  [IO.File]::WriteAllText(
    $Path,
    ($Value | ConvertTo-Json -Depth 10) + [Environment]::NewLine,
    $utf8
  )
}

function New-RandomBytes {
  param([int]$Count)
  $bytes = [byte[]]::new($Count)
  $rng.GetBytes($bytes)
  return $bytes
}

function ConvertTo-Hex {
  param([byte[]]$Bytes)
  return (($Bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function New-ProtectedKey {
  param([string]$Purpose, [string]$FileName)
  $keyBytes = New-RandomBytes -Count 32
  $privateKey = $null
  $entropy = $null
  $protectedBytes = $null
  try {
    $privateKey = '0x' + (ConvertTo-Hex -Bytes $keyBytes)
    $address = ($privateKey | & node $deriveScript | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $address -notmatch '^0x[0-9a-fA-F]{40}$') {
      throw 'Unable to derive a public address for ' + $Purpose
    }
    $entropy = [Text.Encoding]::UTF8.GetBytes(
      'Velostra:testnet-authority:v1:' + $Purpose
    )
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
      $keyBytes,
      $entropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $record = [ordered]@{
      schemaVersion = 1
      kind = 'velostra-testnet-dpapi-key'
      purpose = $Purpose
      network = 'robinhood-testnet'
      chainId = 46630
      productionEligible = $false
      encryption = 'DPAPI-CurrentUser'
      address = $address
      ciphertext = [Convert]::ToBase64String($protectedBytes)
      createdAt = [DateTime]::UtcNow.ToString('o')
    }
    Write-JsonFile -Path (Join-Path $privateDirectory $FileName) -Value $record
    return $address
  } finally {
    if ($keyBytes) { [Array]::Clear($keyBytes, 0, $keyBytes.Length) }
    if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
    if ($protectedBytes) {
      [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
    }
    $privateKey = $null
  }
}

$expectedPrivateFiles = @(
  'deployer.dpapi.json',
  'governance-owner-1.dpapi.json',
  'governance-owner-2.dpapi.json',
  'governance-owner-3.dpapi.json',
  'treasury-owner-1.dpapi.json',
  'treasury-owner-2.dpapi.json',
  'treasury-owner-3.dpapi.json',
  'pause-guardian-owner-1.dpapi.json',
  'pause-guardian-owner-2.dpapi.json',
  'pause-guardian-owner-3.dpapi.json'
)
if ((Test-Path -LiteralPath $planPath) -and -not $Force) {
  foreach ($file in $expectedPrivateFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $privateDirectory $file))) {
      throw 'Existing authority custody is incomplete; inspect it before using -Force'
    }
  }
  $existing = Get-Content -Raw -LiteralPath $planPath | ConvertFrom-Json
  if ($existing.kind -ne 'velostra-testnet-safe-authority-plan') {
    throw 'Existing authority plan has an unexpected schema'
  }
  if ($CopyDeployerAddress) {
    $deployer = Get-Content -Raw -LiteralPath (
      Join-Path $privateDirectory 'deployer.dpapi.json') | ConvertFrom-Json
    Set-Clipboard -Value ([string]$deployer.address)
    Write-Output 'Isolated testnet deployer address copied to the clipboard.'
  }
  Write-Output 'Encrypted testnet authority custody already exists; nothing changed.'
  exit 0
}
if ((Test-Path -LiteralPath $outputPath) -and $Force) {
  $resolved = [IO.Path]::GetFullPath($outputPath)
  if (-not $resolved.StartsWith(
    $artifactsRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw 'Refusing to replace authority custody outside artifacts/'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

[IO.Directory]::CreateDirectory($privateDirectory) | Out-Null
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $deployerAddress = New-ProtectedKey -Purpose 'testnet-deployer' -FileName 'deployer.dpapi.json'
  $roles = [ordered]@{}
  foreach ($role in @('governance', 'treasury', 'pauseGuardian')) {
    $filePrefix = if ($role -eq 'pauseGuardian') { 'pause-guardian' } else { $role }
    $owners = @()
    foreach ($ownerIndex in 1..3) {
      $owners += New-ProtectedKey -Purpose ($filePrefix + '-owner-' + $ownerIndex) -FileName ($filePrefix + '-owner-' + $ownerIndex + '.dpapi.json')
    }
    $saltBytes = New-RandomBytes -Count 32
    try {
      $saltNonce = '0x' + (ConvertTo-Hex -Bytes $saltBytes)
    } finally {
      [Array]::Clear($saltBytes, 0, $saltBytes.Length)
    }
    $roles[$role] = [ordered]@{
      owners = $owners
      threshold = 2
      saltNonce = $saltNonce
    }
  }
  $plan = [ordered]@{
    schemaVersion = 1
    kind = 'velostra-testnet-safe-authority-plan'
    environment = 'staging'
    region = 'us-east4'
    network = 'robinhood-testnet'
    chainId = 46630
    productionEligible = $false
    custody = 'DPAPI-CurrentUser'
    generatedAt = [DateTime]::UtcNow.ToString('o')
    roles = $roles
  }
  Write-JsonFile -Path $planPath -Value $plan
  if ($CopyDeployerAddress) {
    Set-Clipboard -Value $deployerAddress
    Write-Output 'Isolated testnet deployer address copied to the clipboard.'
  }
  Write-Output 'Created three disjoint Safe 2-of-3 authority sets with encrypted testnet-only custody.'
  Write-Output 'No private key was printed or written in plaintext.'
} finally {
  $rng.Dispose()
  $deployerAddress = $null
}
