# US-only managed staging

This directory is the executable deployment policy for the low-cost Velostra
staging stack. It is isolated from Robinhood mainnet and rejects every non-US
region.

Deployment truth as of 2026-07-18: the separate static protocol preview is live on
Netlify at `velostra.xyz`. It has no managed API or contract build values and is not
the staging stack described here. Project `velostra-production` contains the applied
us-east4 foundation, namespaced identities, one multi-tenant HSM key, managed Neon/
Upstash/Alchemy endpoints, and all twelve enabled scoped secret values. The registry
remains empty; direct delivery to a private Telegram bot/channel is verified. No
runtime workload, scheduler trigger, runtime alert lifecycle, or contract is deployed.

## Fixed policy

- Robinhood testnet only: chain 46630.
- GCP Cloud Run, Scheduler, KMS, Secret Manager, and Artifact Registry:
  us-east4 (Northern Virginia).
- Neon: AWS us-east-1 (N. Virginia).
- Upstash: Free on GCP us-east4 (Virginia), one primary and no paid read replicas.
- Alchemy Free primary RPC with the Robinhood public testnet RPC as fallback.
- Operator alerts: private Telegram bot/channel with direct redacted delivery.
- No mainnet value, no paid RPC, and paid API writes disabled.
- USD 35 total monthly envelope.

The envelope is allocated as a USD 20 GCP alert budget, USD 0 for Upstash Free,
USD 5 for Neon usage during the recovery evidence window, and USD 10 contingency.
A GCP budget is an alert rather than a spending cap. Scale to
zero, bounded instances, one-task jobs, provider caps, and 15-minute schedules
are the actual cost controls.

Staging uses a multi-tenant Cloud HSM secp256k1 key in us-east4. The single
active EC key version is budgeted at the current list price of about USD 2.50
per month, plus bounded signing operations. Mainnet key protection is a separate
release decision and is not authorized by these scripts.

## Safety model

Every mutating PowerShell command in this directory is plan-only unless Apply
is supplied. Runtime and image deployment additionally require:

- the current full Git commit SHA;
- a clean worktree;
- immutable Artifact Registry image digests;
- chain 46630 and us-east4;
- non-zero contract and operational addresses;
- a dedicated Cloud Build identity with repository-scoped Artifact Registry write,
  Cloud Logging write, source-object read, and regional user-owned bucket behavior.

Generated deployment evidence is written below artifacts/staging, which is
ignored by Git. Secret values are accepted only through an interactive hidden
prompt and streamed to Secret Manager without a command-line value or local
secret file.

## Prerequisites outside the repository

Create the following provider resources before applying the GCP runtime:

1. Neon Postgres in aws-us-east-1. Start on Free, enable the Launch recovery
   window only for the PITR evidence drill, cap compute at 0.25 CU, and retain
   the pooled TLS connection URL.
2. Upstash Redis Free on GCP us-east4 with no paid read replicas. Retain the
   rediss TLS URL and upgrade only after a separately approved capacity decision.
3. Alchemy Robinhood Testnet Free endpoint. Retain the HTTPS endpoint and use
   the official Robinhood public testnet endpoint as the fallback.
4. A dedicated Telegram bot added as an administrator to a private operator channel.
5. An active Google Cloud Billing account.

Do not place provider URLs, tokens, wallet private keys, or deployment
artifacts in tracked files.

## 1. Validate the complete plan

    powershell -NoProfile -File deploy/gcp/test-staging-policy.ps1
    powershell -NoProfile -File deploy/gcp/test-deployment-plan.ps1
    powershell -NoProfile -File deploy/gcp/bootstrap-staging.ps1 -ProjectId velostra-production

All three commands are read-only. The last command prints the intended GCP
changes.

## 2. Bootstrap GCP

After Cloud Billing is active:

    powershell -NoProfile -File deploy/gcp/bootstrap-staging.ps1 -ProjectId velostra-production -BillingAccount XXXXXX-XXXXXX-XXXXXX -Apply

This creates only US resources, dedicated least-privilege runtime/build identities,
the restricted KMS signer key, secret containers, and the USD 20 GCP budget
alerts. It removes the auto-created default Compute Editor grant and keeps managed
resource labels owned by Velostra. Because Cloud Billing budgets must use the billing
account currency,
operators with a stricter account-native budget already configured must instead
verify and reuse it without recording its currency in the repository:

    powershell -NoProfile -File deploy/gcp/bootstrap-staging.ps1 -ProjectId velostra-production -BillingAccount XXXXXX-XXXXXX-XXXXXX -UseExistingBillingBudget -Apply

## 3. Add secret versions

Run the helper once for every secret container printed by the bootstrap:

    powershell -NoProfile -File deploy/gcp/set-secret-version.ps1 -ProjectId velostra-production -Name database-url

Repeat for redis-url, jwt-secret, gateway-hmac-secret,
platform-cursor-secret, agent-secret-encryption-key, metrics-auth-token,
signer-auth-token, primary-rpc-url, and fallback-rpc-urls.

For Telegram, make the dedicated bot a channel administrator, publish one fresh
channel post, then run the combined helper. It discovers only a numeric private
channel with no public username, sends a harmless connection message, and stores
both values without printing them:

    powershell -NoProfile -File deploy/gcp/configure-telegram-alerts.ps1 -ProjectId velostra-production

Requirements:

- database-url must be a TLS Neon Postgres URL with sslmode=require or stronger;
- redis-url must use rediss;
- JWT, HMAC, cursor, metrics, and signer service tokens must be at least 32
  random characters;
- telegram-bot-token must match the token issued by BotFather;
- telegram-chat-id must be the numeric ID of the private channel, normally beginning
  with -100; never use a personal username or public channel handle;
- agent-secret-encryption-key must encode exactly 32 random bytes in hex or
  base64;
- both RPC values must use HTTPS; the Telegram API origin is fixed in the monitor
  implementation and cannot be supplied through configuration.

## 4. Derive the restricted signer address

    powershell -NoProfile -File deploy/gcp/export-signer-address.ps1 -ProjectId velostra-production

The command exports only the public key, validates the KMS algorithm and
location, and records the derived EVM address under artifacts/staging.

## 5. Deploy and verify the testnet contract

Build contracts first. Then run the guarded Robinhood testnet deployment with
four distinct operational wallets. The KMS-derived address is the settler.
The deployer key remains local and must contain testnet gas only.

    npm --prefix contracts test
    npm --prefix contracts run test:testnet-policy

    $env:VELOSTRA_TESTNET_BROADCAST = 'isolated-staging-approved'
    $env:VELOSTRA_ENVIRONMENT = 'staging'
    $env:VELOSTRA_DEPLOY_REGION = 'us-east4'
    $env:ROBINHOOD_CHAIN_ID = '46630'
    $env:VELOSTRA_TESTNET_SETTLEMENT_TOKEN_MODE = 'deploy-mock-usd'
    $env:ROBINHOOD_TESTNET_RPC_URL = '<testnet-rpc>'
    $env:TESTNET_DEPLOYER_PRIVATE_KEY = '<ephemeral-testnet-key>'
    $env:PLATFORM_FEE_BPS = '1000'
    $env:ADMIN_ADDRESS = '<admin-wallet>'
    $env:SETTLER_ADDRESS = '<kms-derived-address>'
    $env:TREASURY_ADDRESS = '<treasury-wallet>'
    $env:PAUSE_GUARDIAN_ADDRESS = '<pause-guardian-wallet>'
    npm --prefix contracts run deploy:robinhood-testnet -- --broadcast

Verify the resulting artifact before using its address or block:

    $env:TESTNET_DEPLOYMENT_RECORD = 'artifacts/staging/robinhood-testnet-deployment.json'
    $env:TESTNET_VERIFICATION_OUTPUT = 'artifacts/staging/robinhood-testnet-verification.json'
    npm --prefix contracts run verify:robinhood-testnet

Clear TESTNET_DEPLOYER_PRIVATE_KEY from the shell immediately after deployment.

## 6. Build and deploy the server runtime

Use the current clean commit as Release. The image helper records the immutable
digest under artifacts/staging/server-image.json.

    $release = (git rev-parse HEAD).Trim()
    powershell -NoProfile -File deploy/gcp/build-image.ps1 -Component server -Release $release -ProjectId velostra-production -Apply

Deploy the private signer, public API, migration definition, scheduled workers,
and Scheduler triggers. The first pass uses a temporary canonical HTTPS origin
because the web service does not have a Cloud Run URL yet. RunMigration is an
explicit, first-deployment-only action.

    powershell -NoProfile -File deploy/gcp/deploy-runtime.ps1 -ProjectId velostra-production -Release $release -ServerImage '<server immutableImage from artifact>' -EscrowAddress '<verified escrow address>' -DeploymentBlock <verified deployment block> -SignerAddress '<kms-derived address>' -AdminWallet '<admin wallet>' -WebOrigin 'https://staging.velostra.invalid' -RunMigration -Apply

Paid writes remain disabled. The command records the generated API and signer
URLs in artifacts/staging/runtime.json.

## 7. Build and deploy the isolated staging web service

Build the web image against the generated API URL and verified contract
addresses:

    powershell -NoProfile -File deploy/gcp/build-image.ps1 -Component web -Release $release -ProjectId velostra-production -ApiUrl '<apiUrl from runtime.json>' -EscrowAddress '<verified escrow address>' -SettlementTokenAddress '<verified token address>' -Apply

Deploy the immutable web digest:

    powershell -NoProfile -File deploy/gcp/deploy-web.ps1 -Release $release -WebImage '<web immutableImage from artifact>' -ProjectId velostra-production -Apply

The Cloud Run web URL is recorded in artifacts/staging/web-runtime.json.
It is a staging evidence origin, not the current public Netlify origin.

## 8. Bind the canonical web origin

Rerun the runtime command without RunMigration and use the exact webUrl from
web-runtime.json as the isolated staging WebOrigin. This creates the final CORS and
wallet-auth binding for the evidence environment. Do not leave
staging.velostra.invalid configured, and do not bind `velostra.xyz` until a separate
review explicitly connects the public Netlify build to the verified staging API.

After the second pass, verify that runtime.json contains the final web origin
and that API readiness, reconciliation, webhook, and monitor jobs are healthy.

## 9. Evidence gates

The stack is not considered staging-ready until all of these are captured:

- contract deployment verification passes;
- API health and readiness pass;
- a real wallet can authenticate on Robinhood testnet;
- top-up, paid call, builder credit, and claim complete on testnet;
- reconciliation repairs intentionally skipped database reports;
- webhook retry and dead-letter behavior is observed;
- alert delivery is observed;
- a Neon point-in-time recovery drill succeeds;
- a 72-hour soak shows bounded drift, no stuck outbox, and acceptable RPC
  catch-up.

Repository tests prove the implementation and deployment policy. They do not
substitute for these external runtime evidence gates.

## Current external blockers

Google Cloud Billing, the account-native alert budget, regional registry, identities,
and multi-tenant HSM key are active. Neon Free is provisioned in aws-us-east-1 with
the nine migrations/30 tables applied; Upstash Free is provisioned on GCP us-east4;
Alchemy Free is restricted to Robinhood Testnet and the official public fallback is
verified. All twelve scoped secret containers have enabled values, and direct
private-Telegram connection delivery is verified. The public Netlify preview remains
separate. No application workload, Scheduler trigger, runtime alert-lifecycle
evidence, or contract exists.
