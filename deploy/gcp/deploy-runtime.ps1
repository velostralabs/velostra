param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$Release,
  [Parameter(Mandatory = $true)]
  [string]$ServerImage,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^0x[0-9a-fA-F]{40}$')]
  [string]$EscrowAddress,
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, [long]::MaxValue)]
  [long]$DeploymentBlock,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^0x[0-9a-fA-F]{40}$')]
  [string]$SignerAddress,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^0x[0-9a-fA-F]{40}$')]
  [string]$AdminWallet,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [string]$WebOrigin = 'https://staging.velostra.invalid',
  [string]$AlertRunbookBaseUrl = 'https://github.com/velostralabs/velostra/blob/main/docs/OPERATIONS.md',
  [string]$ConfigPath,
  [switch]$RunMigration,
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
$chainId = [int]$config.network.chainId
if ($region -ne 'us-east4' -or $chainId -ne 46630) {
  throw 'Runtime deployment is locked to US Robinhood testnet'
}
$imagePattern = '^' + $region + '-docker[.]pkg[.]dev/' +
  [regex]::Escape($ProjectId) + '/velostra/server@sha256:[0-9a-f]{64}$'
if ($ServerImage -notmatch $imagePattern) {
  throw 'ServerImage must be an immutable US Artifact Registry digest'
}
foreach ($address in @($EscrowAddress, $SignerAddress, $AdminWallet)) {
  if ($address -eq '0x0000000000000000000000000000000000000000') {
    throw 'Runtime addresses must be non-zero'
  }
}
$origin = [Uri]$WebOrigin
if ($origin.Scheme -ne 'https' -or $origin.UserInfo -or
    $origin.AbsoluteUri.TrimEnd('/') -ne $origin.GetLeftPart([UriPartial]::Authority)) {
  throw 'WebOrigin must be a canonical credential-free HTTPS origin'
}
$runbook = [Uri]$AlertRunbookBaseUrl
if ($runbook.Scheme -ne 'https' -or $runbook.UserInfo) {
  throw 'AlertRunbookBaseUrl must be credential-free HTTPS'
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

function Format-Command {
  param([string[]]$CommandArgs)
  return 'gcloud ' + (($CommandArgs | ForEach-Object {
    if ($_ -match '\s') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
  }) -join ' ')
}
function Invoke-Gcloud {
  param([string[]]$CommandArgs)
  Write-Output ($(if ($Apply) { 'APPLY ' } else { 'PLAN  ' }) + (Format-Command $CommandArgs))
  if (-not $Apply) { return }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $script:gcloud @CommandArgs 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw 'gcloud failed: ' + (Format-Command $CommandArgs)
  }
  foreach ($line in @($output)) {
    Write-Output ([string]$line)
  }
}
function Get-GcloudValue {
  param([string[]]$CommandArgs)
  if (-not $Apply) { return '' }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $value = & $script:gcloud @CommandArgs 2>$null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw 'gcloud query failed: ' + (Format-Command $CommandArgs)
  }
  return ($value | Out-String).Trim()
}
function Test-GcloudResource {
  param([string[]]$CommandArgs)
  if (-not $Apply) { return $false }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $script:gcloud @CommandArgs *> $null
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  return $exitCode -eq 0
}
function Join-Environment {
  param([System.Collections.IDictionary]$Values)
  foreach ($entry in $Values.GetEnumerator()) {
    if ([string]$entry.Value -match ',') { throw 'Runtime environment values cannot contain commas' }
  }
  return (($Values.GetEnumerator() | ForEach-Object {
    [string]$_.Key + '=' + [string]$_.Value
  }) -join ',')
}
function New-Environment {
  param([string]$Role)
  return [ordered]@{
    NODE_ENV = 'production'
    VELOSTRA_SECRET_PROVIDER = 'managed-injection'
    VELOSTRA_ENVIRONMENT = 'staging'
    VELOSTRA_RELEASE = $Release.ToLowerInvariant()
    VELOSTRA_PROCESS_ROLE = $Role
    DATABASE_POOL_MAX = 5
    DATABASE_CONNECTION_TIMEOUT_MS = 5000
    DATABASE_IDLE_TIMEOUT_MS = 30000
  }
}
function Add-ChainEnvironment {
  param([System.Collections.IDictionary]$Values)
  $Values.ROBINHOOD_CHAIN_ID = $chainId
  $Values.VELOSTRA_ESCROW_ADDRESS = $EscrowAddress
  $Values.VELOSTRA_DEPLOYMENT_BLOCK = $DeploymentBlock
  $Values.ONCHAIN_SETTLEMENT_MODE = 'required'
  $Values.SETTLEMENT_TOKEN_DECIMALS = 6
  $Values.ROBINHOOD_RPC_TIMEOUT_MS = 10000
  $Values.SETTLEMENT_SIGNER_MODE = 'remote'
  $Values.SETTLEMENT_SIGNER_ADDRESS = $SignerAddress
}
function Deploy-Service {
  param(
    [string]$Name,
    [string]$Identity,
    [System.Collections.IDictionary]$Environment,
    [string]$Secrets,
    [int]$MaxInstances,
    [int]$Concurrency,
    [string]$Memory,
    [bool]$Public,
    [string]$EntryPoint = ''
  )
  $commandArgs = @(
    'run', 'deploy', $Name,
    ('--image=' + $ServerImage),
    ('--region=' + $region),
    ('--project=' + $ProjectId),
    ('--service-account=' + $Identity + '@' + $ProjectId + '.iam.gserviceaccount.com'),
    '--cpu=1', ('--memory=' + $Memory), '--min-instances=0',
    ('--max-instances=' + $MaxInstances), ('--concurrency=' + $Concurrency),
    '--port=8080', '--timeout=60s', '--ingress=all',
    ('--set-env-vars=' + (Join-Environment $Environment)),
    '--labels=application=velostra,environment=staging,residency=us-only'
  )
  if ($Secrets) {
    $commandArgs += ('--set-secrets=' + $Secrets)
  }
  if ($EntryPoint) {
    $commandArgs += @('--command=node', ('--args=' + $EntryPoint))
  }
  $commandArgs += $(if ($Public) { '--allow-unauthenticated' } else { '--no-allow-unauthenticated' })
  Invoke-Gcloud $commandArgs
}
function Deploy-Job {
  param(
    [string]$Name,
    [System.Collections.IDictionary]$Environment,
    [string]$Secrets,
    [string]$EntryPoint,
    [int]$TimeoutSeconds,
    [int]$MaxRetries
  )
  Invoke-Gcloud @(
    'run', 'jobs', 'deploy', $Name,
    ('--image=' + $ServerImage), ('--region=' + $region), ('--project=' + $ProjectId),
    ('--service-account=velostra-jobs@' + $ProjectId + '.iam.gserviceaccount.com'),
    '--cpu=1', '--memory=512Mi', '--tasks=1', ('--max-retries=' + $MaxRetries),
    ('--task-timeout=' + $TimeoutSeconds + 's'), '--command=node',
    ('--args=' + $EntryPoint), ('--set-env-vars=' + (Join-Environment $Environment)),
    ('--set-secrets=' + $Secrets),
    '--labels=application=velostra,environment=staging,residency=us-only'
  )
}

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$head = (& git -C $repositoryRoot rev-parse HEAD | Out-String).Trim()
if ($head -ne $Release.ToLowerInvariant()) { throw 'Release must equal the current full commit SHA' }
if ($Apply) {
  $dirty = (& git -C $repositoryRoot status --porcelain | Out-String).Trim()
  if ($dirty) { throw 'Runtime deployment requires a clean worktree' }
  foreach ($secret in @(
    'database-url', 'redis-url', 'jwt-secret', 'gateway-hmac-secret',
    'platform-cursor-secret', 'agent-secret-encryption-key', 'metrics-auth-token',
    'signer-auth-token', 'primary-rpc-url', 'fallback-rpc-urls',
    'telegram-bot-token', 'telegram-chat-id'
  )) {
    $state = Get-GcloudValue @(
      'secrets', 'versions', 'describe', 'latest', ('--secret=' + $secret),
      ('--project=' + $ProjectId), '--format=value(state)'
    )
    if ($state -ne 'ENABLED') { throw 'Secret has no enabled latest version: ' + $secret }
  }
}

$kmsVersion = 'projects/' + $ProjectId + '/locations/' + $region +
  '/keyRings/' + $config.gcp.kms.keyRing + '/cryptoKeys/' +
  $config.gcp.kms.key + '/cryptoKeyVersions/' + $config.gcp.kms.version
$signerEnv = [ordered]@{
  NODE_ENV = 'production'
  VELOSTRA_SECRET_PROVIDER = 'managed-injection'
  VELOSTRA_ENVIRONMENT = 'staging'
  VELOSTRA_RELEASE = $Release.ToLowerInvariant()
  VELOSTRA_REGION = $region
  ROBINHOOD_CHAIN_ID = $chainId
  VELOSTRA_ESCROW_ADDRESS = $EscrowAddress
  SETTLEMENT_SIGNER_ADDRESS = $SignerAddress
  GOOGLE_CLOUD_KMS_KEY_VERSION = $kmsVersion
  REDIS_CONNECT_TIMEOUT_MS = 2000
  SIGNER_INTENT_TTL_SECONDS = 2592000
  SIGNER_NONCE_LOCK_MS = 30000
  SIGNER_LOCK_WAIT_MS = 5000
  SIGNER_MAX_GAS = 500000
  SIGNER_MAX_FEE_PER_GAS_WEI = 10000000000
}
Deploy-Service 'velostra-signer' 'velostra-signer' $signerEnv 'REDIS_URL=redis-url:latest,ROBINHOOD_RPC_URL=primary-rpc-url:latest,SETTLEMENT_SIGNER_AUTH_TOKEN=signer-auth-token:latest' 1 4 '256Mi' $false 'dist/signer/index.js'
$signerUrl = if ($Apply) {
  Get-GcloudValue @(
    'run', 'services', 'describe', 'velostra-signer',
    ('--region=' + $region), ('--project=' + $ProjectId), '--format=value(status.url)'
  )
} else { 'https://velostra-signer.example.invalid' }
foreach ($caller in @('velostra-api', 'velostra-jobs')) {
  Invoke-Gcloud @(
    'run', 'services', 'add-iam-policy-binding', 'velostra-signer',
    ('--region=' + $region), ('--project=' + $ProjectId),
    ('--member=serviceAccount:' + $caller + '@' + $ProjectId + '.iam.gserviceaccount.com'),
    '--role=roles/run.invoker'
  )
}

$apiEnv = New-Environment 'api'
Add-ChainEnvironment $apiEnv
$apiEnv.TRUST_PROXY = 1
$apiEnv.WEB_ORIGIN = $origin.GetLeftPart([UriPartial]::Authority)
$apiEnv.AUTH_PUBLIC_URI = $origin.GetLeftPart([UriPartial]::Authority)
$apiEnv.JSON_BODY_LIMIT = '64kb'
$apiEnv.ADMIN_BOOTSTRAP_WALLETS = $AdminWallet
$apiEnv.AUTH_NONCE_STORE = 'redis'
$apiEnv.REDIS_CONNECT_TIMEOUT_MS = 2000
$apiEnv.REDIS_FAILURE_MODE = 'closed'
$apiEnv.SETTLEMENT_SIGNER_URL = $signerUrl + '/v1/transactions'
$apiEnv.SETTLEMENT_SIGNER_ID_TOKEN_AUDIENCE = $signerUrl
$apiEnv.SETTLEMENT_SIGNER_TIMEOUT_MS = 10000
$apiEnv.SETTLEMENT_SIGNER_MAX_RESPONSE_BYTES = 16384
$apiEnv.AGENT_SECRET_ENCRYPTION_KEY_ID = 'staging-primary'
$apiEnv.AGENT_TIMEOUT_MS = 30000
$apiEnv.AGENT_ALLOWED_PORTS = 443
$apiEnv.AGENT_MAX_REDIRECTS = 2
$apiEnv.AGENT_MAX_RESPONSE_BYTES = 1048576
$apiEnv.FREE_TIER_CALLS_PER_MONTH = 10
$apiEnv.RECONCILE_CONFIRMATIONS = 12
$apiEnv.RECONCILE_DRIFT_THRESHOLD = '0.000001'
$apiEnv.OBSERVABILITY_INTERVAL_MS = 15000
$apiEnv.READINESS_REQUIRE_WORKER = 'true'
$apiEnv.READINESS_REQUIRE_WEBHOOK_WORKER = 'true'
$apiEnv.READINESS_WORKER_MAX_AGE_MS = 1200000
$apiEnv.READINESS_WEBHOOK_WORKER_MAX_AGE_MS = 1200000
$apiEnv.PHASE3_PAID_WRITES_MODE = 'disabled'
$apiEnv.PHASE3_CANARY_EXIT_APPROVAL = 'not-approved'
$apiSecrets = 'DATABASE_URL=database-url:latest,REDIS_URL=redis-url:latest,JWT_SECRET=jwt-secret:latest,GATEWAY_HMAC_SECRET=gateway-hmac-secret:latest,PLATFORM_CURSOR_SECRET=platform-cursor-secret:latest,AGENT_SECRET_ENCRYPTION_KEY=agent-secret-encryption-key:latest,METRICS_AUTH_TOKEN=metrics-auth-token:latest,SETTLEMENT_SIGNER_AUTH_TOKEN=signer-auth-token:latest,ROBINHOOD_RPC_URL=primary-rpc-url:latest,ROBINHOOD_RPC_FALLBACK_URLS=fallback-rpc-urls:latest'
Deploy-Service 'velostra-api' 'velostra-api' $apiEnv $apiSecrets 2 40 '512Mi' $true
$apiUrl = if ($Apply) {
  Get-GcloudValue @(
    'run', 'services', 'describe', 'velostra-api',
    ('--region=' + $region), ('--project=' + $ProjectId), '--format=value(status.url)'
  )
} else { 'https://velostra-api.example.invalid' }

# Public, stateless staging-only endpoint used by the synthetic agent seed.
# It has no database or secret access and is bounded to a single instance.
$syntheticEnv = New-Environment 'synthetic-agent'
$syntheticEnv.SYNTHETIC_AGENT_ENABLED = 'true'
$syntheticEnv.ROBINHOOD_CHAIN_ID = $chainId
Deploy-Service 'velostra-synthetic-agent' 'velostra-web' $syntheticEnv '' 1 20 '256Mi' $true 'dist/synthetic-agent/index.js'
$syntheticAgentUrl = if ($Apply) {
  Get-GcloudValue @(
    'run', 'services', 'describe', 'velostra-synthetic-agent',
    ('--region=' + $region), ('--project=' + $ProjectId), '--format=value(status.url)'
  )
} else { 'https://velostra-synthetic-agent.example.invalid' }

$migrationEnv = New-Environment 'migration'
Deploy-Job 'velostra-migration' $migrationEnv 'DATABASE_URL=database-url:latest' 'dist/scripts/migrate.js' 600 0
if ($RunMigration) {
  Invoke-Gcloud @(
    'run', 'jobs', 'execute', 'velostra-migration',
    ('--region=' + $region), ('--project=' + $ProjectId), '--wait'
  )
}

$reconcileEnv = New-Environment 'reconciliation-worker'
Add-ChainEnvironment $reconcileEnv
$reconcileEnv.SETTLEMENT_SIGNER_URL = $signerUrl + '/v1/transactions'
$reconcileEnv.SETTLEMENT_SIGNER_ID_TOKEN_AUDIENCE = $signerUrl
$reconcileEnv.SETTLEMENT_SIGNER_TIMEOUT_MS = 10000
$reconcileEnv.SETTLEMENT_SIGNER_MAX_RESPONSE_BYTES = 16384
$reconcileEnv.RECONCILE_INTERVAL_MS = 900000
$reconcileEnv.RECONCILE_OUTBOX_GRACE_MS = 120000
$reconcileEnv.RECONCILE_MAX_BLOCK_RANGE = 2000
$reconcileEnv.RECONCILE_CONFIRMATIONS = 12
$reconcileEnv.RECONCILE_RPC_RETRIES = 3
$reconcileEnv.RECONCILE_RPC_RETRY_BASE_MS = 1000
$reconcileEnv.RECONCILE_DRIFT_THRESHOLD = '0.000001'
$reconcileSecrets = 'DATABASE_URL=database-url:latest,SETTLEMENT_SIGNER_AUTH_TOKEN=signer-auth-token:latest,ROBINHOOD_RPC_URL=primary-rpc-url:latest,ROBINHOOD_RPC_FALLBACK_URLS=fallback-rpc-urls:latest'
Deploy-Job 'velostra-reconciliation' $reconcileEnv $reconcileSecrets 'dist/jobs/reconcile.js' ([int]$config.gcp.cloudRun.jobs.reconciliation.timeoutSeconds) ([int]$config.gcp.cloudRun.jobs.reconciliation.maxRetries)

$webhookEnv = New-Environment 'webhook-worker'
$webhookEnv.AGENT_SECRET_ENCRYPTION_KEY_ID = 'staging-primary'
$webhookEnv.AGENT_ALLOWED_PORTS = 443
$webhookEnv.AGENT_MAX_REDIRECTS = 2
$webhookEnv.AGENT_TIMEOUT_MS = 10000
$webhookEnv.AGENT_MAX_RESPONSE_BYTES = 65536
$webhookEnv.WEBHOOK_BATCH_SIZE = 25
$webhookEnv.WEBHOOK_MAX_ATTEMPTS = 8
$webhookEnv.WEBHOOK_RETRY_BASE_MS = 1000
$webhookEnv.WEBHOOK_RETRY_MAX_MS = 3600000
$webhookEnv.WEBHOOK_LOCK_MS = 60000
$webhookEnv.WEBHOOK_INTERVAL_MS = 300000
Deploy-Job 'velostra-webhooks' $webhookEnv 'DATABASE_URL=database-url:latest,AGENT_SECRET_ENCRYPTION_KEY=agent-secret-encryption-key:latest' 'dist/jobs/webhooks.js' ([int]$config.gcp.cloudRun.jobs.webhooks.timeoutSeconds) ([int]$config.gcp.cloudRun.jobs.webhooks.maxRetries)

$monitorEnv = New-Environment 'operational-monitor'
Add-ChainEnvironment $monitorEnv
$monitorEnv.REDIS_CONNECT_TIMEOUT_MS = 2000
$monitorEnv.REDIS_FAILURE_MODE = 'closed'
$monitorEnv.RECONCILE_CONFIRMATIONS = 12
$monitorEnv.RECONCILE_DRIFT_THRESHOLD = '0.000001'
$monitorEnv.MONITOR_INTERVAL_MS = 900000
$monitorEnv.ALERT_TRANSPORT = [string]$config.alerts.transport
$monitorEnv.ALERT_RUNBOOK_BASE_URL = $runbook.AbsoluteUri
$monitorEnv.ALERT_REPEAT_SECONDS = 1800
$monitorEnv.ALERT_WORKER_MAX_AGE_SECONDS = 1200
$monitorEnv.ALERT_REQUIRE_WEBHOOK_HEARTBEAT = 'true'
$monitorEnv.ALERT_WEBHOOK_WORKER_MAX_AGE_SECONDS = 1200
$monitorEnv.ALERT_WEBHOOK_MAX_PENDING_AGE_SECONDS = 1800
$monitorEnv.ALERT_CURSOR_LAG_BLOCKS = 2000
$monitorEnv.ALERT_OUTBOX_MAX_AGE_SECONDS = 1800
$monitorEnv.ALERT_SIGNER_MIN_BALANCE_WEI = 10000000000000000
$monitorEnv.ALERT_REQUIRE_BACKUP_HEARTBEAT = 'true'
$monitorEnv.ALERT_BACKUP_MAX_AGE_SECONDS = 86400
$monitorSecrets = 'DATABASE_URL=database-url:latest,REDIS_URL=redis-url:latest,ROBINHOOD_RPC_URL=primary-rpc-url:latest,ROBINHOOD_RPC_FALLBACK_URLS=fallback-rpc-urls:latest,TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_CHAT_ID=telegram-chat-id:latest'
Deploy-Job 'velostra-monitor' $monitorEnv $monitorSecrets 'dist/jobs/monitor.js' ([int]$config.gcp.cloudRun.jobs.monitor.timeoutSeconds) ([int]$config.gcp.cloudRun.jobs.monitor.maxRetries)

$schedules = @(
  @{ Job = 'velostra-reconciliation'; Scheduler = 'velostra-reconciliation-every-15m'; Cron = [string]$config.gcp.cloudRun.jobs.reconciliation.schedule },
  @{ Job = 'velostra-webhooks'; Scheduler = 'velostra-webhooks-every-15m'; Cron = [string]$config.gcp.cloudRun.jobs.webhooks.schedule },
  @{ Job = 'velostra-monitor'; Scheduler = 'velostra-monitor-every-15m'; Cron = [string]$config.gcp.cloudRun.jobs.monitor.schedule }
)
foreach ($schedule in $schedules) {
  Invoke-Gcloud @(
    'run', 'jobs', 'add-iam-policy-binding', $schedule.Job,
    ('--region=' + $region), ('--project=' + $ProjectId),
    ('--member=serviceAccount:velostra-scheduler@' + $ProjectId + '.iam.gserviceaccount.com'),
    '--role=roles/run.invoker'
  )
  $exists = Test-GcloudResource @(
    'scheduler', 'jobs', 'describe', $schedule.Scheduler,
    ('--location=' + $region), ('--project=' + $ProjectId)
  )
  $operation = if ($exists) { 'update' } else { 'create' }
  $jobUri = 'https://run.googleapis.com/v2/projects/' + $ProjectId +
    '/locations/' + $region + '/jobs/' + $schedule.Job + ':run'
  Invoke-Gcloud @(
    'scheduler', 'jobs', $operation, 'http', $schedule.Scheduler,
    ('--location=' + $region), ('--project=' + $ProjectId),
    ('--schedule=' + $schedule.Cron), '--time-zone=Etc/UTC',
    ('--uri=' + $jobUri), '--http-method=POST',
    ('--oauth-service-account-email=velostra-scheduler@' + $ProjectId + '.iam.gserviceaccount.com'),
    '--attempt-deadline=300s'
  )
}

if ($Apply) {
  $artifactDirectory = Join-Path $repositoryRoot 'artifacts\staging'
  [System.IO.Directory]::CreateDirectory($artifactDirectory) | Out-Null
  $record = [ordered]@{
    schemaVersion = 1
    kind = 'velostra-us-staging-runtime'
    projectId = $ProjectId
    region = $region
    chainId = $chainId
    release = $Release.ToLowerInvariant()
    serverImage = $ServerImage
    signerUrl = $signerUrl
    apiUrl = $apiUrl
    syntheticAgentUrl = $syntheticAgentUrl
    webOrigin = $origin.GetLeftPart([UriPartial]::Authority)
    escrowAddress = $EscrowAddress
    deploymentBlock = $DeploymentBlock
    signerAddress = $SignerAddress
    paidWritesMode = 'disabled'
    migrationExecuted = [bool]$RunMigration
    capturedAt = [DateTime]::UtcNow.ToString('o')
  }
  $recordPath = Join-Path $artifactDirectory 'runtime.json'
  [System.IO.File]::WriteAllText(
    $recordPath,
    ($record | ConvertTo-Json -Depth 5) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Output ($record | ConvertTo-Json -Depth 5)
} else {
  Write-Output ''
  Write-Output 'Plan-only. No Cloud Run service, job, scheduler, IAM, or migration was changed.'
}
