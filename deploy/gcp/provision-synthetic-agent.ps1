param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$Release,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^us-east4-docker[.]pkg[.]dev/.+/velostra/server@sha256:[0-9a-f]{64}$')]
  [string]$ServerImage,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://[^/?#]+/execute$')]
  [string]$SyntheticAgentUrl,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^0x[0-9a-fA-F]{40}$')]
  [string]$BuilderWallet,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId = 'velostra-production',
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$configPath = Join-Path $PSScriptRoot 'staging.config.json'
& (Join-Path $PSScriptRoot 'test-staging-policy.ps1') -ConfigPath $configPath
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
if ([int]$config.network.chainId -ne 46630 -or [string]$config.residency.gcpRegion -ne 'us-east4') {
  throw 'Synthetic provisioning is locked to US Robinhood testnet staging'
}
if ($BuilderWallet -eq '0x0000000000000000000000000000000000000000') { throw 'Builder wallet must be non-zero' }
$endpoint = [Uri]$SyntheticAgentUrl
if ($endpoint.Scheme -ne 'https' -or $endpoint.UserInfo -or $endpoint.AbsolutePath -ne '/execute' -or $endpoint.Query -or $endpoint.Fragment) {
  throw 'Synthetic endpoint must be credential-free HTTPS /execute'
}
$head = (& git -C $repositoryRoot rev-parse HEAD | Out-String).Trim()
& git -C $repositoryRoot cat-file -e ($Release + '^{commit}') 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Release must identify a local commit' }
& git -C $repositoryRoot merge-base --is-ancestor $Release.ToLowerInvariant() $head
if ($LASTEXITCODE -ne 0) { throw 'Deployed release must be an ancestor of the operator scripts' }
if ($Apply) {
  $dirty = (& git -C $repositoryRoot status --porcelain | Out-String).Trim()
  if ($dirty) { throw 'Synthetic provisioning requires a clean worktree' }
}

$runtimePath = Join-Path $repositoryRoot 'artifacts\staging\runtime.json'
if ($Apply) {
  if (-not (Test-Path -LiteralPath $runtimePath)) { throw 'Managed staging runtime artifact is missing' }
  $runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
  if (
    [int]$runtime.chainId -ne 46630 -or
    [string]$runtime.region -ne 'us-east4' -or
    [string]$runtime.release -ne $Release.ToLowerInvariant() -or
    [string]$runtime.serverImage -ne $ServerImage -or
    [string]$runtime.paidWritesMode -ne 'disabled' -or
    ([string]$runtime.syntheticAgentUrl).TrimEnd('/') + '/execute' -ne $SyntheticAgentUrl
  ) { throw 'Synthetic provisioning parameters do not match the disabled-write staging runtime' }

  try {
    $health = Invoke-RestMethod -Method Get -Uri (([string]$runtime.syntheticAgentUrl).TrimEnd('/') + '/health') -TimeoutSec 20
  } catch { throw 'Synthetic agent health check failed' }
  if (
    [string]$health.status -ne 'ok' -or
    [string]$health.service -ne 'velostra-synthetic-agent' -or
    [string]$health.environment -ne 'staging' -or
    [int]$health.chain_id -ne 46630
  ) { throw 'Synthetic agent health response failed staging validation' }
}

$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
$gcloud = @(
  (Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $env:ProgramFiles 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'),
  (Join-Path $programFilesX86 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $gcloud) { throw 'Google Cloud CLI is required' }

$job = @(
  'run', 'jobs', 'deploy', 'velostra-synthetic-agent-seed',
  ('--image=' + $ServerImage), '--region=us-east4', ('--project=' + $ProjectId),
  ('--service-account=velostra-jobs@' + $ProjectId + '.iam.gserviceaccount.com'),
  '--cpu=1', '--memory=512Mi', '--tasks=1', '--max-retries=0', '--task-timeout=300s',
  '--command=node', '--args=dist/scripts/provision-staging-agent.js',
  ('--set-env-vars=NODE_ENV=production,VELOSTRA_ENVIRONMENT=staging,VELOSTRA_RELEASE=' + $Release.ToLowerInvariant() + ',VELOSTRA_PROCESS_ROLE=synthetic-seed,ROBINHOOD_CHAIN_ID=46630,PHASE2_SYNTHETIC_AGENT_APPROVAL=isolated-staging-agent-approved,AGENT_SECRET_ENCRYPTION_KEY_ID=staging-primary,SYNTHETIC_AGENT_ENDPOINT_URL=' + $SyntheticAgentUrl + ',SYNTHETIC_AGENT_BUILDER_WALLET=' + $BuilderWallet),
  '--set-secrets=DATABASE_URL=database-url:latest,REDIS_URL=redis-url:latest,AGENT_SECRET_ENCRYPTION_KEY=agent-secret-encryption-key:latest',
  '--labels=application=velostra,environment=staging,residency=us-only'
)
if (-not $Apply) {
  Write-Output 'PLAN deploy and execute the idempotent synthetic-agent seed job (staging-only; endpoint and wallet redacted)'
  Write-Output 'PLAN free-tier counter will be exhausted so the next isolated call follows the paid settlement path'
  exit 0
}

$previous = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  & $gcloud @job *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic seed job deployment failed' }
  & $gcloud 'run' 'jobs' 'execute' 'velostra-synthetic-agent-seed' '--region=us-east4' ('--project=' + $ProjectId) '--wait' '--quiet' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic seed job execution failed' }
} finally { $ErrorActionPreference = $previous }
Write-Output 'PASS staging synthetic-agent service seeded idempotently; no production or mainnet writes performed'
