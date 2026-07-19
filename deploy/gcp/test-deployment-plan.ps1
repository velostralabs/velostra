param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production'
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
$telegramHelperText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'configure-telegram-alerts.ps1')
$buildScriptText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'build-image.ps1')
$runtimeScriptText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'deploy-runtime.ps1')
$webScriptText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'deploy-web.ps1')
$reconciliationEvidenceRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\scripts\capture-staging-reconciliation.mjs')
$reconciliationEvidenceScriptText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'run-reconciliation-evidence.ps1')
$syntheticServiceText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\src\synthetic-agent\index.ts')
$syntheticProvisionScriptText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'provision-synthetic-agent.ps1')
$syntheticSeedText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\src\scripts\provision-staging-agent.ts')
$stagingCanaryScriptText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'set-staging-paid-canary.ps1')
$paidCanaryRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'run-paid-canary.ps1')
$stagingCanaryBindingText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\src\scripts\create-staging-canary-binding.ts')

function Require-Match {
  param([string]$Text, [string]$Pattern, [string]$Message)
  if ($Text -notmatch $Pattern) { throw $Message }
}
function Reject-Match {
  param([string]$Text, [string]$Pattern, [string]$Message)
  if ($Text -match $Pattern) { throw $Message }
}
$webDockerText = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot 'Dockerfile')
$webCloudBuildText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'cloudbuild-web.yaml')
$frontendChainText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'src\lib\chain.ts')


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
Require-Match $bootstrapText ('projects remove-iam-policy-binding ' + [regex]::Escape($ProjectId) + ' .*compute@developer[.]gserviceaccount[.]com --role=roles/editor') 'Bootstrap must remove the broad default Compute Editor grant'
Reject-Match $bootstrapText 'managed-by=codex' 'Cloud labels must not expose tool identity'
Require-Match $bootstrapText 'repositories update velostra .*managed-by=velostra' 'Repository labels must remain Velostra-owned'
Require-Match $bootstrapText 'kms keys update settlement-signer .*managed-by=velostra' 'Signer key labels must remain Velostra-owned'
Require-Match $bootstrapText 'secrets update database-url .*managed-by=velostra' 'Secret labels must remain Velostra-owned'
Require-Match $bootstrapText 'ec-sign-secp256k1-sha256 .*--protection-level=hsm' 'EVM signing must use supported multi-tenant HSM protection'
Require-Match $bootstrapText 'repositories add-iam-policy-binding velostra .*velostra-builder@.*roles/artifactregistry.writer' 'Builder must receive repository-scoped image write access'
Require-Match $existingBudgetBootstrapText 'verify an existing billing-account budget' 'Existing-budget mode must verify its prerequisite'
Reject-Match $existingBudgetBootstrapText 'billing budgets create' 'Existing-budget mode must not create a duplicate budget'
Require-Match $bootstrapText 'roles/logging.logWriter' 'Builder must receive Cloud Logging write access'
Require-Match $bootstrapText 'roles/storage.objectViewer' 'Builder must receive source object read access'
Require-Match $buildText 'velostra-builder@.*--default-buckets-behavior=regional-user-owned-bucket --region=us-east4' 'Builds must use the dedicated identity and regional user-owned bucket behavior'
Require-Match $buildScriptText 'function Invoke-GcloudChecked' 'Cloud Build must use checked native command handling'
Require-Match $buildScriptText 'function Get-GcloudTextChecked' 'Artifact lookup must use checked native command handling'
Require-Match $buildScriptText "ErrorActionPreference = 'Continue'" 'Native gcloud progress must not bypass exit-code handling'
Require-Match $runtimeScriptText 'function Invoke-Gcloud' 'Runtime mutations must use checked native command handling'
Require-Match $runtimeScriptText 'function Get-GcloudValue' 'Runtime queries must use checked native command handling'
Require-Match $runtimeScriptText "ErrorActionPreference = 'Continue'" 'Runtime gcloud progress must not bypass exit-code handling'
Require-Match $webScriptText 'function Invoke-GcloudChecked' 'Web deployment must use checked native command handling'
Require-Match $webScriptText 'function Get-GcloudTextChecked' 'Web URL lookup must use checked native command handling'
Require-Match $webScriptText "ErrorActionPreference = 'Continue'" 'Web gcloud progress must not bypass exit-code handling'
Require-Match $runtimeText 'run deploy velostra-signer .*--max-instances=1 .*--command=node --args=dist/signer/index[.]js --no-allow-unauthenticated' 'Signer must be private, bounded, and use its dedicated entrypoint'
Require-Match $runtimeText 'serviceAccount:velostra-api@.*roles/run[.]invoker' 'API identity must invoke the private signer'
Require-Match $runtimeText 'serviceAccount:velostra-jobs@.*roles/run[.]invoker' 'Jobs identity must invoke the private signer'
Require-Match $runtimeText 'run deploy velostra-api .*--max-instances=2 .*PHASE3_PAID_WRITES_MODE=disabled.*--allow-unauthenticated' 'API must be public, bounded, and keep paid writes disabled'
Require-Match $runtimeText 'run deploy velostra-synthetic-agent .*--max-instances=1 .*SYNTHETIC_AGENT_ENABLED=true.*--command=node --args=dist/synthetic-agent/index[.]js --allow-unauthenticated' 'Synthetic agent must be public, bounded, staging-only, and use its dedicated entrypoint'
Require-Match $runtimeScriptText "syntheticEnv[.]SYNTHETIC_AGENT_ENABLED = 'true'" 'Synthetic agent must be explicitly enabled only in the staging runtime'
Require-Match $runtimeScriptText "syntheticAgentUrl" 'Runtime artifact must record the synthetic agent endpoint'
Require-Match $syntheticServiceText "VELOSTRA_ENVIRONMENT !== 'staging'" 'Synthetic endpoint must fail outside staging'
Require-Match $webDockerText 'VITE_CHAIN_ID=.*[$][{]PUBLIC_CHAIN_ID[}]' 'Web image must bind its public chain at build time'
Require-Match $webCloudBuildText 'PUBLIC_CHAIN_ID=.*[$][{]_PUBLIC_CHAIN_ID[}]' 'Cloud Build must pass the public chain explicitly'
Require-Match $buildScriptText '_PUBLIC_CHAIN_ID=.*config[.]network[.]chainId' 'Staging image build must source chain ID from the guarded config'
Require-Match $frontendChainText 'ROBINHOOD_CHAIN_ID !== 4663.*ROBINHOOD_CHAIN_ID !== 46630' 'Frontend must reject unsupported chain IDs'
Require-Match $frontendChainText "ROBINHOOD_IS_TESTNET = ROBINHOOD_CHAIN_ID === 46630" 'Frontend testnet selection must be explicit'
Require-Match $frontendChainText 'rpc[.]testnet[.]chain[.]robinhood[.]com' 'Frontend must use the official credential-free testnet RPC fallback'
Require-Match $frontendChainText 'explorer[.]testnet[.]chain[.]robinhood[.]com' 'Frontend must use the testnet explorer'

Require-Match $syntheticServiceText "ROBINHOOD_CHAIN_ID !== '46630'" 'Synthetic endpoint must fail outside Robinhood testnet'
Require-Match $syntheticServiceText 'input[.]length > 10_000' 'Synthetic endpoint must enforce a bounded input'
Reject-Match $syntheticServiceText '(?:db/client|REDIS_URL|DATABASE_URL)' 'Synthetic endpoint must remain stateless and unprivileged'
Require-Match $syntheticProvisionScriptText 'isolated-staging-agent-approved' 'Synthetic seed job must require its explicit approval sentinel'
Require-Match $syntheticProvisionScriptText '[(].*--set-env-vars=.*[+] [\$]BuilderWallet[)]' 'Synthetic seed environment must remain one native CLI argument'
Require-Match $syntheticProvisionScriptText 'staging[.]config[.]json' 'Synthetic seed job must validate the US staging policy'
Require-Match $syntheticProvisionScriptText 'paidWritesMode.*-ne ''disabled''' 'Synthetic seed must bind to a disabled-write runtime artifact'
Require-Match $syntheticProvisionScriptText 'Invoke-RestMethod .*[/]health' 'Synthetic seed must health-check the deployed endpoint before database mutation'
Require-Match $syntheticSeedText "status: 'APPROVED'" 'Synthetic agent must be explicitly approved for staging discovery'
Require-Match $syntheticSeedText 'free-tier exhausted' 'Synthetic seed must force the next call through the paid path'
Require-Match $stagingCanaryScriptText 'ValidateSet\(''Plan'', ''Open'', ''Close'', ''Status''\)' 'Staging canary control must expose explicit open/close/status actions'
Require-Match $stagingCanaryScriptText "PHASE2_STAGING_CANARY_APPROVAL.*isolated-staging-paid-canary" 'Staging canary must require a distinct approval sentinel'
Require-Match $stagingCanaryScriptText "PHASE3_PAID_WRITES_MODE = 'disabled'" 'Staging canary close must fail closed'
Require-Match $stagingCanaryScriptText 'PHASE3_CANARY_POLICY_B64' 'Staging canary must bind the policy without a repository file'
Require-Match $stagingCanaryScriptText 'maxGrossMinor -ne ''1200000''' 'Staging canary must cap the exact synthetic USDG 1.20 gross'
Require-Match $stagingCanaryScriptText 'Wait-ApiHealth' 'Staging canary must verify the expected immutable API after mutation'
Reject-Match $stagingCanaryScriptText 'Write-Output.*(?:databaseUrl|policyB64|manifestB64)' 'Staging canary control must not print database or policy credentials'
Require-Match $paidCanaryRunnerText 'finally' 'Paid canary runner must protect cleanup with finally'
Require-Match $paidCanaryRunnerText 'CanaryControl -Action Close' 'Paid canary runner must close the paid-write window'
Require-Match $paidCanaryRunnerText "PHASE2_WALLET_TOPUP_AMOUNT = '2[.]00'" 'Paid canary runner must cap the top-up'
Require-Match $paidCanaryRunnerText "PHASE2_WALLET_CLAIM_AMOUNT = '1[.]00'" 'Paid canary runner must cap the claim'
Require-Match $paidCanaryRunnerText "PHASE2_WALLET_AGENT_SLUG = 'phase2-synthetic-agent'" 'Paid canary runner must use the managed synthetic agent'
Require-Match $paidCanaryRunnerText 'paidWritesClosed = [[]bool[]][$]Closed' 'Paid canary evidence must report the observed close result'
Reject-Match $paidCanaryRunnerText 'Write-Output.*(?:PRIVATE_KEY|PASSWORD|ExpectedAddress)' 'Paid canary runner must not print credentials or wallet identity'
Require-Match $stagingCanaryBindingText 'sha256:' 'Staging canary subject policy must use hashed identities'
Require-Match $stagingCanaryBindingText 'chainId: 46630' 'Staging canary binding must remain on Robinhood testnet'
Require-Match $stagingCanaryBindingText 'maxCalls: 1' 'Staging canary binding must permit one call only'
Require-Match $stagingCanaryBindingText 'PRICE_MINOR = ''1200000''' 'Staging canary binding must cap gross at USDG 1.20'
Reject-Match $syntheticProvisionScriptText 'Write-Output.*(?:BuilderWallet|SyntheticAgentUrl)' 'Synthetic provisioning must not print wallet or endpoint identity'
Require-Match $runtimeText 'run jobs deploy velostra-reconciliation ' 'Reconciliation job is missing'
Require-Match $runtimeText 'run jobs deploy velostra-webhooks ' 'Webhook job is missing'
Require-Match $runtimeScriptText '[.]WEBHOOK_INTERVAL_MS = 300000' 'Webhook interval must stay within the worker validation bound'
Require-Match $runtimeText 'run jobs deploy velostra-monitor ' 'Monitor job is missing'
Require-Match $runtimeText 'ALERT_TRANSPORT=telegram' 'Monitor must use the private Telegram transport'
Require-Match $runtimeText 'TELEGRAM_BOT_TOKEN=telegram-bot-token:latest' 'Monitor must inject the Telegram bot token from Secret Manager'
Require-Match $runtimeText 'TELEGRAM_CHAT_ID=telegram-chat-id:latest' 'Monitor must inject the private Telegram channel ID from Secret Manager'
Require-Match $telegramHelperText 'Add-Type -AssemblyName System[.]Net[.]Http' 'Telegram helper must load HttpClient in Windows PowerShell'
Require-Match $telegramHelperText 'Read-Host .* -AsSecureString' 'Telegram helper must use a secure token prompt'
Require-Match $telegramHelperText 'secure[.]Dispose[(][)]' 'Telegram helper must dispose the secure token prompt'
Require-Match $telegramHelperText 'chat[.]type -ne ''channel''' 'Telegram helper must reject non-channel destinations'
Require-Match $telegramHelperText 'hasPublicUsername' 'Telegram helper must reject public channels'
Reject-Match $telegramHelperText 'Write-Output.*(?:botToken|chatId)' 'Telegram helper must not print credentials or channel identity'
Require-Match $runtimeText 'scheduler jobs create http velostra-reconciliation-every-15m .*--schedule=[*]/15 [*] [*] [*] [*]' 'Reconciliation schedule is not every 15 minutes'
Require-Match $runtimeText 'scheduler jobs create http velostra-webhooks-every-15m .*--schedule=2-59/15 [*] [*] [*] [*]' 'Webhook schedule is not staggered'
Require-Match $runtimeText 'scheduler jobs create http velostra-monitor-every-15m .*--schedule=5-59/15 [*] [*] [*] [*]' 'Monitor schedule is not staggered'
Reject-Match $runtimeText 'run jobs execute velostra-migration' 'Migration execution must require explicit opt-in'
Require-Match $webText 'run deploy velostra-web .*--service-account=velostra-web@.*--min-instances=0 --max-instances=2 .*--allow-unauthenticated' 'Web service policy is incomplete'
Require-Match $runtimeText ([regex]::Escape('--image=' + $serverImage)) 'Runtime must use the immutable server digest'
Require-Match $webText ([regex]::Escape('--image=' + $webImage)) 'Web must use the immutable web digest'
Require-Match $reconciliationEvidenceRunnerText 'const CHAIN_ID = 46630' 'Evidence runner must remain testnet-only'
Require-Match $reconciliationEvidenceRunnerText "PHASE3_PAID_WRITES_MODE.*disabled" 'Evidence runner must require disabled paid writes'
Reject-Match $reconciliationEvidenceRunnerText '/api/dashboard/topup' 'Skipped-report evidence must not call the top-up report endpoint'
Require-Match $reconciliationEvidenceRunnerText "functionName: 'MIN_TOPUP'" 'Evidence runner must read the deployed minimum top-up'
Require-Match $reconciliationEvidenceScriptText 'DPAPI-CurrentUser' 'Evidence wallet must remain encrypted for the current operator'
Require-Match $reconciliationEvidenceScriptText "scheduler.*jobs.*pause.*velostra-reconciliation-every-15m" 'Evidence fault injection must pause reconciliation scheduling'
Require-Match $reconciliationEvidenceScriptText "scheduler.*jobs.*resume.*velostra-reconciliation-every-15m" 'Evidence cleanup must resume reconciliation scheduling'
Require-Match $reconciliationEvidenceScriptText 'finally' 'Evidence cleanup must be protected by finally'
Reject-Match $reconciliationEvidenceScriptText 'PHASE3_PAID_WRITES_MODE = ''(?:canary|public)''' 'Evidence orchestration must never enable paid writes'

Write-Output 'US staging deployment plan: PASS'
