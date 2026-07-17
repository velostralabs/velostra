param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-staging-us'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$release = (& git -C $repositoryRoot rev-parse HEAD | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $release -notmatch '^[0-9a-f]{40}$') {
  throw 'Unable to resolve a full release SHA'
}
$serverImage = 'us-east4-docker.pkg.dev/' + $ProjectId +
  '/velostra/server@sha256:' + ('a' * 64)
$webImage = 'us-east4-docker.pkg.dev/' + $ProjectId +
  '/velostra/web@sha256:' + ('b' * 64)

$runtimeParameters = @{
  Release = $release
  ProjectId = $ProjectId
  ServerImage = $serverImage
  EscrowAddress = '0x1111111111111111111111111111111111111111'
  DeploymentBlock = 1
  SignerAddress = '0x2222222222222222222222222222222222222222'
  AdminWallet = '0x3333333333333333333333333333333333333333'
}
$runtime = & (Join-Path $PSScriptRoot 'deploy-runtime.ps1') @runtimeParameters
if ($LASTEXITCODE -ne 0) { throw 'Runtime plan failed' }
$web = & (Join-Path $PSScriptRoot 'deploy-web.ps1') -Release $release -WebImage $webImage -ProjectId $ProjectId
if ($LASTEXITCODE -ne 0) { throw 'Web plan failed' }
$bootstrap = & (Join-Path $PSScriptRoot 'bootstrap-staging.ps1') -ProjectId $ProjectId
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap plan failed' }
$existingBudgetBootstrap = & (Join-Path $PSScriptRoot 'bootstrap-staging.ps1') -ProjectId $ProjectId -UseExistingBillingBudget
if ($LASTEXITCODE -ne 0) { throw 'Existing-budget bootstrap plan failed' }
$serverBuildParameters = @{
  Component = 'server'
  Release = $release
  ProjectId = $ProjectId
}
$serverBuild = & (Join-Path $PSScriptRoot 'build-image.ps1') @serverBuildParameters
if ($LASTEXITCODE -ne 0) { throw 'Server image plan failed' }
$webBuildParameters = @{
  Component = 'web'
  Release = $release
  ProjectId = $ProjectId
  ApiUrl = 'https://velostra-api.example.invalid'
  EscrowAddress = '0x1111111111111111111111111111111111111111'
  SettlementTokenAddress = '0x4444444444444444444444444444444444444444'
}
$webBuild = & (Join-Path $PSScriptRoot 'build-image.ps1') @webBuildParameters
if ($LASTEXITCODE -ne 0) { throw 'Web image plan failed' }

$runtimeText = $runtime -join [Environment]::NewLine
$webText = $web -join [Environment]::NewLine
$bootstrapText = $bootstrap -join [Environment]::NewLine
$existingBudgetBootstrapText = $existingBudgetBootstrap -join [Environment]::NewLine
$buildText = ($serverBuild + $webBuild) -join [Environment]::NewLine
$all = $runtimeText + [Environment]::NewLine + $webText +
  [Environment]::NewLine + $bootstrapText + [Environment]::NewLine + $buildText

function Require-Match {
  param([string]$Text, [string]$Pattern, [string]$Message)
  if ($Text -notmatch $Pattern) { throw $Message }
}
function Reject-Match {
  param([string]$Text, [string]$Pattern, [string]$Message)
  if ($Text -match $Pattern) { throw $Message }
}

Require-Match $all '(?i)us-east4' 'Deployment plan must use us-east4'
$regionMentions = [regex]::Matches(
  $all,
  '(?i)(?:--(?:region|location)(?:=|\s+)|/locations/)([a-z0-9-]+)'
)
foreach ($regionMention in $regionMentions) {
  if ($regionMention.Groups[1].Value -ne 'us-east4') {
    throw 'Deployment plan escaped the approved US region'
  }
}
Reject-Match $all '(?m)^APPLY ' 'Plan validation must never mutate resources'
Require-Match $bootstrapText 'service-accounts create velostra-web' 'Bootstrap must create the unprivileged web identity'
Require-Match $bootstrapText 'service-accounts create velostra-builder' 'Bootstrap must create a dedicated build identity'
Require-Match $bootstrapText 'service-accounts create velostra-api' 'Bootstrap must create the API identity'
Require-Match $bootstrapText 'service-accounts create velostra-signer' 'Bootstrap must create the signer identity'
Require-Match $bootstrapText 'service-accounts create velostra-jobs' 'Bootstrap must create the jobs identity'
Require-Match $bootstrapText 'service-accounts create velostra-scheduler' 'Bootstrap must create the scheduler identity'
Require-Match $bootstrapText 'billingbudgets[.]googleapis[.]com' 'Bootstrap must enable the API used to create its billing budget'
Require-Match $bootstrapText 'ec-sign-secp256k1-sha256 .*--protection-level=hsm' 'EVM signing must use supported multi-tenant HSM protection'
Require-Match $bootstrapText 'repositories add-iam-policy-binding velostra .*velostra-builder@.*roles/artifactregistry.writer' 'Builder must receive repository-scoped image write access'
Require-Match $existingBudgetBootstrapText 'verify an existing billing-account budget' 'Existing-budget mode must verify its prerequisite'
Reject-Match $existingBudgetBootstrapText 'billing budgets create' 'Existing-budget mode must not create a duplicate budget'
Require-Match $bootstrapText 'roles/logging.logWriter' 'Builder must receive Cloud Logging write access'
Require-Match $bootstrapText 'roles/storage.objectViewer' 'Builder must receive source object read access'
Require-Match $buildText 'velostra-builder@.*--default-buckets-behavior=regional-user-owned-bucket --region=us-east4' 'Builds must use the dedicated identity and regional user-owned bucket behavior'
Require-Match $runtimeText 'run deploy velostra-signer .*--max-instances=1 .*--command=node --args=dist/signer/index[.]js --no-allow-unauthenticated' 'Signer must be private, bounded, and use its dedicated entrypoint'
Require-Match $runtimeText 'run deploy velostra-api .*--max-instances=2 .*PHASE3_PAID_WRITES_MODE=disabled.*--allow-unauthenticated' 'API must be public, bounded, and keep paid writes disabled'
Require-Match $runtimeText 'run jobs deploy velostra-reconciliation ' 'Reconciliation job is missing'
Require-Match $runtimeText 'run jobs deploy velostra-webhooks ' 'Webhook job is missing'
Require-Match $runtimeText 'run jobs deploy velostra-monitor ' 'Monitor job is missing'
Require-Match $runtimeText 'scheduler jobs create http velostra-reconciliation-every-15m .*--schedule=[*]/15 [*] [*] [*] [*]' 'Reconciliation schedule is not every 15 minutes'
Require-Match $runtimeText 'scheduler jobs create http velostra-webhooks-every-15m .*--schedule=2-59/15 [*] [*] [*] [*]' 'Webhook schedule is not staggered'
Require-Match $runtimeText 'scheduler jobs create http velostra-monitor-every-15m .*--schedule=5-59/15 [*] [*] [*] [*]' 'Monitor schedule is not staggered'
Reject-Match $runtimeText 'run jobs execute velostra-migration' 'Migration execution must require explicit opt-in'
Require-Match $webText 'run deploy velostra-web .*--service-account=velostra-web@.*--min-instances=0 --max-instances=2 .*--allow-unauthenticated' 'Web service policy is incomplete'
Require-Match $runtimeText ([regex]::Escape('--image=' + $serverImage)) 'Runtime must use the immutable server digest'
Require-Match $webText ([regex]::Escape('--image=' + $webImage)) 'Web must use the immutable web digest'

Write-Output 'US staging deployment plan: PASS'
