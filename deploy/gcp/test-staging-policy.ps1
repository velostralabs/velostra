param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'staging.config.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
if ($config.schemaVersion -ne 1) { throw 'Unsupported staging policy schema' }
if ($config.environment -ne 'staging') { throw 'Environment must be staging' }
if ($config.network.chainId -ne 46630 -or $config.network.mainnetAllowed) {
  throw 'Staging must be testnet-only on chain 46630'
}
if ($config.residency.policy -ne 'US_ONLY') { throw 'Residency must be US_ONLY' }
if ($config.residency.gcpRegion -ne 'us-east4') { throw 'GCP must stay in US Virginia' }
if ($config.residency.neonRegion -ne 'aws-us-east-1') { throw 'Neon must stay in US Virginia' }
if ($config.residency.upstashRegion -ne 'us-east4') { throw 'Upstash must stay in US Virginia' }

$allocated = [decimal]$config.cost.gcpBudgetAlert +
  [decimal]$config.cost.upstashHardCap +
  [decimal]$config.cost.neonAllowance +
  [decimal]$config.cost.contingency
if ($allocated -gt [decimal]$config.cost.totalMonthlyEnvelope) {
  throw "Allocated provider budgets exceed total monthly envelope"
}
if ($config.cost.totalMonthlyEnvelope -gt 35) {
  throw 'Monthly staging envelope cannot exceed USD 35'
}
if ($config.providers.redis.hardBudgetCapUsd -ne $config.cost.upstashHardCap) {
  throw 'Redis hard cap and budget allocation differ'
}
if ($config.providers.redis.globalReplication) {
  throw 'Staging Redis must not create paid read replicas'
}
if ($config.providers.rpc.paidRpcAllowed) {
  throw 'Paid RPC is not authorized for staging'
}
if (-not $config.providers.postgres.scaleToZero) {
  throw 'Neon scale-to-zero must remain enabled'
}
if ([decimal]$config.providers.postgres.maxComputeUnits -gt 0.25) {
  throw 'Neon staging compute is above the approved ceiling'
}

$kms = $config.gcp.kms
if ($kms.algorithm -ne 'ec-sign-secp256k1-sha256') {
  throw 'KMS algorithm must be EVM-compatible secp256k1'
}
if ($kms.protectionLevel -ne 'software') {
  throw 'Low-cost staging KMS must use managed software protection'
}

foreach ($service in $config.gcp.cloudRun.services.psobject.Properties) {
  if ($service.Value.minInstances -ne 0) {
    throw "$($service.Name) must scale to zero"
  }
  if ($service.Value.maxInstances -gt 2) {
    throw "$($service.Name) exceeds the staging instance ceiling"
  }
}
foreach ($job in $config.gcp.cloudRun.jobs.psobject.Properties) {
  if ($job.Value.tasks -ne 1 -or $job.Value.maxRetries -gt 1) {
    throw "$($job.Name) exceeds the scheduled job cost guard"
  }
  if ($job.Value.schedule -notmatch '/15') {
    throw "$($job.Name) must use the approved 15-minute cadence"
  }
}

Write-Output 'US-ONLY STAGING RESIDENCY AND USD 35 COST POLICY VERIFIED'
