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
$publicTestnetControlText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'set-public-testnet.ps1')
$paidCanaryRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'run-paid-canary.ps1')
$stagingCanaryBindingText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\src\scripts\create-staging-canary-binding.ts')

$builderInitializerText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\scripts\initialize-staging-builder.mjs')
$builderInitializerRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'initialize-staging-builder.ps1')
$signerIntentDiagnosticText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\scripts\check-staging-signer-intent.mjs')
$signerIntentRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'check-staging-signer-intent.ps1')
$signerFundingText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\scripts\fund-staging-signer.mjs')
$signerFundingRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'fund-staging-signer.ps1')
$faucetRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'fund-staging-wallet.ps1')
$faucetBrowserText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'scripts\run-testnet-faucet.mjs')
$claimStatusDiagnosticText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\scripts\check-staging-claim.mjs')
$claimStatusRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'check-staging-claim.ps1')
$alertLifecycleDiagnosticText = Get-Content -Raw -LiteralPath (
  Join-Path $repositoryRoot 'server\scripts\capture-staging-alert-lifecycle.mjs')
$alertLifecycleRunnerText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'capture-alert-lifecycle.ps1')
$controlReadinessText = Get-Content -Raw -LiteralPath (
  Join-Path $PSScriptRoot 'capture-control-readiness.ps1')
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


Require-Match $runtimeScriptText '\$apiEnv\.SETTLEMENT_SIGNER_TIMEOUT_MS = 30000' `
  'API signer timeout must tolerate managed cold starts'
Require-Match $runtimeScriptText '\$reconcileEnv\.SETTLEMENT_SIGNER_TIMEOUT_MS = 30000' `
  'Reconciliation signer timeout must tolerate managed cold starts'
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
Require-Match $publicTestnetControlText "ValidateSet\('Plan', 'Open', 'Close', 'Status'\)" 'Public testnet control must expose explicit lifecycle actions'
Require-Match $publicTestnetControlText "PUBLIC_TESTNET_APPROVAL = 'owner-approved-public-testnet'" 'Public testnet opening must carry the explicit owner approval sentinel'
Require-Match $publicTestnetControlText 'if \(\$head -ne \$Release\)' 'Public testnet must bind the exact deployed release'
Require-Match $publicTestnetControlText 'Assert-FreshSignerEvidence' 'Public testnet must require fresh signer gas evidence'
Require-Match $publicTestnetControlText 'Wait-ApiReady' 'Public testnet must verify dependency readiness before opening'
Require-Match $publicTestnetControlText "PUBLIC_TESTNET_MAX_GROSS_PER_CALL_MINOR = '5000000'" 'Public testnet must cap every paid call'
Require-Match $publicTestnetControlText "PUBLIC_TESTNET_PAID_CALLS_PER_WALLET_DAY = '10'" 'Public testnet must cap daily wallet calls'
Require-Match $publicTestnetControlText "PUBLIC_TESTNET_PAID_CALLS_GLOBAL_DAY = '1000'" 'Public testnet must cap global daily calls'
Require-Match $publicTestnetControlText "PHASE3_PAID_WRITES_MODE = 'disabled'" 'Public testnet rollback must fail closed'
Require-Match $publicTestnetControlText 'automatic close also failed' 'Public testnet opening must attempt an automatic close on failure'
Reject-Match $publicTestnetControlText 'Write-Output.*(?:databaseUrl|manifestB64|ApiUrl|ProjectId)' 'Public testnet control must not print credentials or provider identity'
Require-Match $paidCanaryRunnerText 'finally' 'Paid canary runner must protect cleanup with finally'
Require-Match $paidCanaryRunnerText 'CanaryControl -Action Close' 'Paid canary runner must close the paid-write window'
Require-Match $paidCanaryRunnerText "PHASE2_WALLET_TOPUP_AMOUNT = '2[.]00'" 'Paid canary runner must cap the top-up'
Require-Match $paidCanaryRunnerText "PHASE2_WALLET_CLAIM_AMOUNT = '1[.]00'" 'Paid canary runner must cap the claim'
Require-Match $paidCanaryRunnerText "PHASE2_WALLET_AGENT_SLUG = 'phase2-synthetic-agent'" 'Paid canary runner must use the managed synthetic agent'
Require-Match $paidCanaryRunnerText 'paidWritesClosed = [[]bool[]][$]Closed' 'Paid canary evidence must report the observed close result'
Require-Match $paidCanaryRunnerText "PHASE2_WALLET_CLAIM_ONLY = 'isolated-staging-claim-only'" 'Claim-only canary must require a distinct approval sentinel'
Require-Match $paidCanaryRunnerText 'if [(][$]ClaimOnly[)]' 'Claim-only execution must be isolated from the paid-write branch'
Require-Match $paidCanaryRunnerText 'claim-canary[.]json' 'Claim-only evidence must not overwrite the full paid-canary artifact'
Reject-Match $paidCanaryRunnerText 'Write-Output.*(?:PRIVATE_KEY|PASSWORD|ExpectedAddress)' 'Paid canary runner must not print credentials or wallet identity'
Require-Match $paidCanaryRunnerText 'velostra-reconciliation' 'Claim-only runner must execute managed reconciliation'
Require-Match $paidCanaryRunnerText 'ClaimStatus -ProjectId' 'Claim-only runner must execute the exact-once verifier'
Require-Match $paidCanaryRunnerText 'claimVerified = [[]bool[]][$]ClaimVerified' 'Claim evidence must report exact-once verification'
Require-Match $claimStatusDiagnosticText 'exact_claim_count' 'Claim verifier must count the exact completed database claim'
Require-Match $claimStatusDiagnosticText 'getTransactionReceipt' 'Claim verifier must bind the database transaction to a chain receipt'
Require-Match $claimStatusDiagnosticText 'databaseMatchesChainEvent' 'Claim verifier must correlate the database row with the chain event'
Require-Match $claimStatusRunnerText 'DPAPI-CurrentUser' 'Claim verifier wallet material must remain encrypted for the current operator'
Require-Match $claimStatusRunnerText "Get-ManagedSecret 'database-url'" 'Claim verifier must load the managed database secret ephemerally'
Reject-Match $claimStatusRunnerText 'Write-Output.*(?:PRIVATE_KEY|DATABASE_URL|RpcUrl|DatabaseUrl)' 'Claim verifier must not print credentials'
Require-Match $claimStatusRunnerText 'claim-reconciliation-verification[.]json' 'Claim verifier must retain redacted exact-once evidence'
Require-Match $alertLifecycleDiagnosticText "rule = 'backup_stale'" 'Alert evidence must target the injected backup-stale lifecycle'
Require-Match $alertLifecycleDiagnosticText 'last_notified_at' 'Alert evidence must prove successful operator delivery'
Require-Match $alertLifecycleDiagnosticText 'acknowledged_at' 'Alert evidence must prove operator acknowledgement'
Require-Match $alertLifecycleDiagnosticText 'resolved_at' 'Alert evidence must prove monitor resolution'
Require-Match $alertLifecycleDiagnosticText "service_name = 'backup'" 'Alert resolution must be bound to the backup heartbeat'
Require-Match $alertLifecycleRunnerText "Get-ManagedSecret 'database-url'" 'Alert evidence must load the managed database secret ephemerally'
Require-Match $alertLifecycleRunnerText 'alert-lifecycle[.]json' 'Alert lifecycle must persist a redacted evidence artifact'
Reject-Match $alertLifecycleRunnerText 'Write-Output.*(?:DATABASE_URL|DatabaseUrl)' 'Alert evidence wrapper must not print credentials'
Require-Match $controlReadinessText 'check-testnet-authorities[.]ps1' 'Control readiness must refresh live Safe state'
Require-Match $controlReadinessText "paidWritesDisabled = .*paidWritesMode -eq 'disabled'" 'Control readiness must remain fail-closed'
Require-Match $controlReadinessText 'authorityRotationExecuted = [$]false' 'Control readiness must not fabricate a live authority mutation'
Require-Match $controlReadinessText 'pauseUnpauseExecuted = [$]false' 'Control readiness must not mutate the deployed escrow'
Require-Match $controlReadinessText 'requiresSeparateMultiOperatorApproval = [$]true' 'Custody mutations require separate operator approval'
Reject-Match $controlReadinessText 'Write-Output.*(?:address|ProjectId|contractAddress)' 'Control readiness output must remain identity-redacted'
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
Require-Match $builderInitializerText "ROBINHOOD_CHAIN_ID.*String[(]CHAIN_ID[)]" 'Builder initialization must remain testnet-only'
Require-Match $builderInitializerText "PHASE3_PAID_WRITES_MODE.*disabled" 'Builder initialization must require disabled paid writes'
Require-Match $builderInitializerText "slug = 'phase2-synthetic-agent'" 'Builder initialization must bind to the approved synthetic agent'
Require-Match $builderInitializerText "functionName: 'initializeBuilder'" 'Builder initialization must call only the contract initialization method'
Reject-Match $builderInitializerText 'console[.](?:info|error).*hash' 'Builder initialization must not print transaction hashes'
Require-Match $builderInitializerRunnerText 'DPAPI-CurrentUser' 'Builder initializer must use the encrypted evidence wallet'
Require-Match $builderInitializerRunnerText "paidWritesMode -ne 'disabled'" 'Builder initializer must fail closed unless paid writes are disabled'
Reject-Match $builderInitializerRunnerText 'Write-Output.*(?:PRIVATE_KEY|WalletBytes|RpcUrl|DatabaseUrl)' 'Builder initializer must not print credentials'
Require-Match $signerIntentDiagnosticText "PHASE3_PAID_WRITES_MODE.*disabled" 'Signer intent diagnostic must require disabled paid writes'
Require-Match $signerIntentDiagnosticText "and sa.status = 'AMBIGUOUS'" 'Signer intent diagnostic must inspect only ambiguous canary attempts'
Require-Match $signerIntentDiagnosticText 'recoverTransactionAddress' 'Signer intent diagnostic must verify signature recovery'
Reject-Match $signerIntentDiagnosticText 'console[.](?:info|error).*rawTransaction' 'Signer diagnostic must not print raw transactions'
Require-Match $signerIntentRunnerText "paidWritesMode -ne 'disabled'" 'Signer diagnostic runner must fail closed unless paid writes are disabled'
Reject-Match $signerIntentRunnerText 'Write-Output.*(?:RpcUrl|DatabaseUrl|RedisUrl)' 'Signer diagnostic runner must not print managed secrets'
Require-Match $signerFundingText "PHASE3_PAID_WRITES_MODE.*disabled" 'Signer funding must require disabled paid writes'
Require-Match $signerFundingText "TARGET_BALANCE = parseEther[(]'0[.]01'[)]" 'Signer funding target must remain bounded'
Require-Match $signerFundingText "SOURCE_RESERVE = parseEther[(]'0[.]001'[)]" 'Signer funding must preserve source reserves'
Reject-Match $signerFundingText 'console[.](?:info|error).*hash' 'Signer funding must not print transaction hashes'
Require-Match $signerFundingRunnerText 'DPAPI-CurrentUser' 'Signer funding must use encrypted testnet sources'
Require-Match $signerFundingRunnerText "paidWritesMode -ne 'disabled'" 'Signer funding runner must fail closed unless paid writes are disabled'
Reject-Match $signerFundingRunnerText 'Write-Output.*(?:PRIVATE_KEY|Bytes|RpcUrl)' 'Signer funding runner must not print credentials'
Require-Match $faucetRunnerText "ValidateSet\('EvidenceWallet', 'SettlementSigner'\)" 'Faucet helper must support a separately selected signer recipient'
Require-Match $faucetRunnerText 'FAUCET_RECIPIENT_ADDRESS' 'Faucet helper must pass the selected recipient ephemerally'
Require-Match $faucetBrowserText 'connectedAccount === expectedAddress' 'Faucet helper must distinguish the evidence wallet without exposing another isolated account'
Require-Match $faucetBrowserText 'recipientAddress' 'Faucet delivery must support a role-specific recipient'
Reject-Match ($faucetRunnerText + $faucetBrowserText) 'Write-Output.*(?:recipientAddress|expectedAddress)' 'Faucet helper must not print staging identities'
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
