# US-only managed staging

This directory is the executable deployment policy for the low-cost Velostra
staging stack. It is isolated from Robinhood mainnet and rejects every non-US
region.

Deployment truth as of 2026-07-19: the separate static protocol preview remains live
on Netlify at `velostra.xyz` and is not connected to staging. The US foundation,
managed Neon/Upstash/Alchemy data plane, twelve scoped secrets, HSM settler, and
private-Telegram transport are active. Three disjoint canonical Safe 1.4.1 2-of-3
authorities, a synthetic 6-decimal token, and VelostraEscrow are deployed and
live-verified on Robinhood testnet. Immutable signer/API/web services, migration,
reconciliation/webhook/monitor jobs, and staggered Scheduler triggers are deployed in
us-east4. The isolated web origin is bound, deep readiness passes, the signer rejects
anonymous access, and paid writes remain disabled.

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

## 5. Deploy and verify testnet authorities and escrow

Node.js 22 is required. Prepare the synthetic testnet custody once; the helper creates
one isolated deployer and three disjoint Safe 1.4.1 owner sets, each 2-of-3. Every
private key is encrypted with Windows DPAPI CurrentUser below ignored artifacts and
is never printed or written in plaintext. This single-operator synthetic custody is
testnet-only and cannot satisfy mainnet governance.

    npm --prefix contracts test
    npm run test:testnet-authorities
    powershell -NoProfile -File deploy/gcp/prepare-testnet-authorities.ps1
    powershell -NoProfile -File deploy/gcp/check-testnet-authorities.ps1

The readiness command is read-only and does not decrypt keys. It verifies chain 46630,
canonical Safe factory code, three unique predicted accounts, an isolated KMS settler,
and deployer gas. If gas is absent, copy only the public deployer address and fund it
with valueless Robinhood testnet ETH from the
[official faucet](https://faucet.testnet.chain.robinhood.com/):

    powershell -NoProfile -File deploy/gcp/prepare-testnet-authorities.ps1 -CopyDeployerAddress

After funding, rerun readiness. Both mutation commands are plan-only without Apply:

    powershell -NoProfile -File deploy/gcp/deploy-testnet-authorities.ps1
    powershell -NoProfile -File deploy/gcp/deploy-testnet-authorities.ps1 -Apply
    powershell -NoProfile -File deploy/gcp/deploy-testnet-contract.ps1
    powershell -NoProfile -File deploy/gcp/deploy-testnet-contract.ps1 -Apply

The first Apply is idempotent and verifies every Safe owner, threshold, version, and
disjoint owner set. The second consumes only that verified authority record, deploys
a synthetic 6-decimal token plus VelostraEscrow, and immediately runs the bytecode,
receipt, role, solvency, token, and Safe-authority verifier. Secret Manager supplies
the RPC only in process memory; DPAPI decrypts the deployer only for each child
process; cleanup removes every sensitive environment value. All records remain below
ignored artifacts/staging.

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

Rerun the runtime command with the exact webUrl from web-runtime.json as the isolated
staging WebOrigin. RunMigration may be retained because the migration runner is
idempotent; the deployment record must still state that migration executed. This
creates the final CORS and wallet-auth binding for the evidence environment. Do not
leave staging.velostra.invalid configured, and do not bind `velostra.xyz` until a
separate review explicitly connects the public Netlify build to the verified staging
API.

After the second pass, verify that runtime.json contains the final web origin
and that API readiness, reconciliation, webhook, and monitor jobs are healthy.

## 9. Evidence gates

The stack is not considered staging-ready until all of these are captured:

- contract deployment verification passes;
- API health and readiness pass;
- a real wallet can authenticate on Robinhood testnet;
- top-up, paid call, builder credit, and claim complete on testnet;
- reconciliation repairs intentionally skipped database reports (managed synthetic
  direct-deposit proof passed on 2026-07-19; rerun with the guarded command below);
- webhook retry and dead-letter behavior is observed;
- alert delivery is observed;
- a Neon point-in-time recovery drill succeeds;
- a 72-hour soak shows bounded drift, no stuck outbox, and acceptable RPC
  catch-up.

Repository tests prove the implementation and deployment policy. They do not
substitute for these external runtime evidence gates.

## Current managed checkpoint

The US foundation, data plane, twelve scoped secrets, HSM settler, private Telegram
transport, three testnet Safe authorities, synthetic token, escrow, immutable runtime
services, workers, Scheduler triggers, migration, and isolated web origin are live.
API deep readiness passes and all scheduled worker entrypoints have completed at least
one manual verification run. The public Netlify preview remains intentionally
separate and paid writes remain disabled.

Remaining gates are external evidence rather than missing deployment: real MetaMask
money-loop, alert failure/acknowledgement/resolution, secret/authority/pause/compromise
drills, one-hour outage catch-up, provider-native PITR, minimum 72-hour soak,
independent review, and accountable release approval.

To reproduce the managed skipped-report proof without enabling paid writes:

    powershell -NoProfile -File deploy/gcp/run-reconciliation-evidence.ps1 -Apply

The runner uses only synthetic chain value, pauses Scheduler during the deliberate
missing-report window, validates the backfill and safe cursor, and resumes Scheduler
in cleanup. Its evidence remains below ignored `artifacts/staging`.
