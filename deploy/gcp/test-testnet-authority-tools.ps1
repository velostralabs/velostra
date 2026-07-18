param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$artifactsRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'artifacts'))
$testDirectory = [IO.Path]::GetFullPath(
  (Join-Path $artifactsRoot 'staging\authority-tool-test')
)
if (-not $testDirectory.StartsWith(
  $artifactsRoot + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase
)) {
  throw 'Authority test output escaped artifacts/'
}

$preparePath = Join-Path $PSScriptRoot 'prepare-testnet-authorities.ps1'
$deployPath = Join-Path $PSScriptRoot 'deploy-testnet-authorities.ps1'
$checkPath = Join-Path $PSScriptRoot 'check-testnet-authorities.ps1'
$contractPath = Join-Path $PSScriptRoot 'deploy-testnet-contract.ps1'
$prepareText = Get-Content -Raw -LiteralPath $preparePath
$deployText = Get-Content -Raw -LiteralPath $deployPath
$checkText = Get-Content -Raw -LiteralPath $checkPath
$contractText = Get-Content -Raw -LiteralPath $contractPath
[void][scriptblock]::Create($prepareText)
[void][scriptblock]::Create($deployText)
[void][scriptblock]::Create($checkText)
[void][scriptblock]::Create($contractText)

function Require-Match {
  param([string]$Text, [string]$Pattern, [string]$Message)
  if ($Text -notmatch $Pattern) { throw $Message }
}
function Reject-Match {
  param([string]$Text, [string]$Pattern, [string]$Message)
  if ($Text -match $Pattern) { throw $Message }
}

Require-Match $prepareText 'ProtectedData[]]::Protect' 'Authority keys must be DPAPI encrypted'
Require-Match $prepareText 'DataProtectionScope[]]::CurrentUser' 'Authority keys must be bound to the current Windows user'
Require-Match $prepareText 'productionEligible = [$]false' 'Authority custody must be testnet-only'
Require-Match $prepareText 'RandomNumberGenerator[]]::Create' 'Authority keys must use a cryptographic RNG'
Reject-Match $prepareText 'Write-Output.*[$]privateKey' 'Authority helper must never print a private key'
Require-Match $deployText 'ProtectedData[]]::Unprotect' 'Deployment must decrypt only at runtime'
Require-Match $deployText 'status --porcelain --untracked-files=no' 'Authority broadcast must require a clean worktree'
Require-Match $deployText 'secrets.*versions.*access' 'RPC must come from managed Secret Manager'
Require-Match $deployText 'Remove-Item Env:TESTNET_DEPLOYER_PRIVATE_KEY' 'Deployer environment cleanup is mandatory'
Require-Match $deployText 'if [(]-not [$]Apply[)]' 'Authority command must be plan-only by default'
Reject-Match ($prepareText + $deployText) '(?i)mainnet.*broadcast' 'Authority tooling must not authorize mainnet broadcast'
Require-Match $checkText 'secrets.*versions.*access' 'Readiness RPC must come from managed Secret Manager'
Require-Match $checkText 'TESTNET_DEPLOYER_ADDRESS' 'Readiness must check the isolated deployer'
Reject-Match $checkText 'ProtectedData[]]::Unprotect' 'Readiness must not decrypt private keys'
Require-Match $contractText 'ProtectedData[]]::Unprotect' 'Contract deploy must decrypt only at runtime'
Require-Match $contractText 'robinhood-testnet-authorities[.]json' 'Contract deploy must consume verified Safe authorities'
Require-Match $contractText 'run deploy:robinhood-testnet -- --broadcast' 'Guarded escrow broadcast is missing'
Require-Match $contractText 'run verify:robinhood-testnet' 'Escrow verification must follow deployment'
Require-Match $contractText 'status --porcelain --untracked-files=no' 'Contract broadcast must require a clean worktree'
Reject-Match $contractText 'Write-Output.*[$]privateKey' 'Contract deploy must not print a private key'

if (Test-Path -LiteralPath $testDirectory) {
  throw 'Authority tooling test directory already exists; inspect it manually'
}
try {
  & $preparePath -OutputDirectory 'artifacts/staging/authority-tool-test'
  if ($LASTEXITCODE -ne 0) { throw 'Authority preparation helper failed' }
  $planPath = Join-Path $testDirectory 'testnet-authority-plan.json'
  $privateDirectory = Join-Path $testDirectory 'private'
  $privateFiles = @(Get-ChildItem -LiteralPath $privateDirectory -Filter '*.dpapi.json')
  if ($privateFiles.Count -ne 10) {
    throw 'Authority custody must contain one deployer and nine owner records'
  }
  foreach ($file in $privateFiles) {
    $recordText = Get-Content -Raw -LiteralPath $file.FullName
    $record = $recordText | ConvertFrom-Json
    if (
      $record.kind -ne 'velostra-testnet-dpapi-key' -or
      $record.productionEligible -ne $false -or
      $record.encryption -ne 'DPAPI-CurrentUser' -or
      [string]::IsNullOrWhiteSpace([string]$record.ciphertext) -or
      [string]$record.address -notmatch '^0x[0-9a-fA-F]{40}$'
    ) {
      throw 'Generated authority custody record failed validation'
    }
    if ($recordText -match '(?i)privateKey') {
      throw 'Generated authority custody leaked a plaintext private-key field'
    }
  }
  $deployer = Get-Content -Raw -LiteralPath (
    Join-Path $privateDirectory 'deployer.dpapi.json') | ConvertFrom-Json
  $protected = [Convert]::FromBase64String([string]$deployer.ciphertext)
  $entropy = [Text.Encoding]::UTF8.GetBytes(
    'Velostra:testnet-authority:v1:testnet-deployer'
  )
  $plain = $null
  try {
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
      $protected,
      $entropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    if ($plain.Length -ne 32) { throw 'DPAPI test round trip failed' }
  } finally {
    if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
    [Array]::Clear($protected, 0, $protected.Length)
    [Array]::Clear($entropy, 0, $entropy.Length)
  }
  $validateCode = @'
const fs = require('fs')
const policy = require('./contracts/scripts/lib/testnet-authority-policy')
policy.validateAuthorityPlan(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')))
'@
  & node -e $validateCode $planPath
  if ($LASTEXITCODE -ne 0) { throw 'Generated authority plan failed Node policy validation' }
} finally {
  if (Test-Path -LiteralPath $testDirectory) {
    $resolvedTestDirectory = [IO.Path]::GetFullPath($testDirectory)
    if (-not $resolvedTestDirectory.StartsWith(
      $artifactsRoot + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase
    )) {
      throw 'Refusing to clean authority test output outside artifacts/'
    }
    Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force
  }
}

Write-Output 'Testnet authority custody tooling: PASS'
