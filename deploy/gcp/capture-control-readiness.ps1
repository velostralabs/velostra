param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimePath = Join-Path $RepositoryRoot 'artifacts\staging\runtime.json'
$AuthorityPath = Join-Path $RepositoryRoot 'artifacts\staging\authority\testnet-authority-readiness.json'
$ContractPath = Join-Path $RepositoryRoot 'artifacts\staging\robinhood-testnet-verification.json'
$AlertPath = Join-Path $RepositoryRoot 'artifacts\staging\evidence\alert-lifecycle.json'
$EvidencePath = Join-Path $RepositoryRoot 'artifacts\staging\evidence\operator-control-readiness.json'

foreach ($requiredPath in @($RuntimePath, $ContractPath, $AlertPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw 'Required managed-staging evidence is missing'
  }
}

& (Join-Path $PSScriptRoot 'check-testnet-authorities.ps1') -ProjectId $ProjectId | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $AuthorityPath)) {
  throw 'Live authority readiness refresh failed'
}

$Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
$Authority = Get-Content -Raw -LiteralPath $AuthorityPath | ConvertFrom-Json
$Contract = Get-Content -Raw -LiteralPath $ContractPath | ConvertFrom-Json
$Alert = Get-Content -Raw -LiteralPath $AlertPath | ConvertFrom-Json
$AuthorityEntries = @($Authority.predictions.PSObject.Properties.Value)

$Checks = [ordered]@{
  runtimeIsStaging = [string]$Runtime.kind -eq 'velostra-us-staging-runtime'
  regionIsApprovedUs = [string]$Runtime.region -eq 'us-east4'
  chainIsRobinhoodTestnet = [int64]$Runtime.chainId -eq 46630
  paidWritesDisabled = [string]$Runtime.paidWritesMode -eq 'disabled'
  authorityEvidenceCurrent = [string]$Authority.environment -eq 'staging'
  canonicalSafeVersion = [string]$Authority.safeVersion -eq '1.4.1'
  allThreeSafesDeployed = [int]$Authority.deployedCount -eq 3 -and
    $AuthorityEntries.Count -eq 3 -and
    -not ($AuthorityEntries.deployed -contains $false)
  safeThresholdsAreTwo = -not ($AuthorityEntries.threshold -contains 1) -and
    -not ($AuthorityEntries.threshold -contains 3) -and
    -not ($AuthorityEntries.threshold -contains $null)
  canonicalFactoriesReady = -not ($AuthorityEntries.factoryReady -contains $false)
  authorityPolicyVerified = $Contract.checks.authority_policy_recorded -eq $true
  ownerSetsDisjoint = $Contract.checks.authority_owner_sets_disjoint -eq $true
  settlementSignerIsolated = $Contract.checks.settler_isolated -eq $true
  contractUnpaused = $Contract.checks.contract_unpaused -eq $true
  contractSolvent = $Contract.checks.contract_solvent -eq $true
  contractRolesVerified =
    $Contract.checks.default_admin -eq $true -and
    $Contract.checks.settler_role -eq $true -and
    $Contract.checks.treasury_role -eq $true -and
    $Contract.checks.pauser_role -eq $true -and
    $Contract.checks.fee_manager_role -eq $true
  contractVerificationPassed = $Contract.passed -eq $true -and @($Contract.failures).Count -eq 0
  alertLifecyclePassed = $Alert.passed -eq $true
}

$Evidence = [ordered]@{
  schemaVersion = 1
  kind = 'velostra-staging-operator-control-readiness'
  environment = 'staging'
  region = 'us-east4'
  capturedAt = [DateTime]::UtcNow.ToString('o')
  checks = $Checks
  liveMutations = [ordered]@{
    secretRotationExecuted = $false
    authorityRotationExecuted = $false
    pauseUnpauseExecuted = $false
    compromiseRecoveryExecuted = $false
    requiresSeparateMultiOperatorApproval = $true
  }
  readinessPassed = -not ($Checks.Values -contains $false)
}

$EvidenceDirectory = Split-Path -Parent $EvidencePath
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$TemporaryPath = $EvidencePath + '.tmp'
$Evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $TemporaryPath -Encoding utf8
Move-Item -Force -LiteralPath $TemporaryPath -Destination $EvidencePath

Write-Output ($Evidence | ConvertTo-Json -Depth 6 -Compress)
if ($Evidence.readinessPassed -ne $true) { throw 'Operator control readiness checks did not pass' }
