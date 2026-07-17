# US-only managed staging

This directory is the executable policy for the low-cost Velostra staging stack.
It is intentionally isolated from Robinhood mainnet and from every non-US region.

## Fixed policy

- Robinhood testnet only: chain \`46630\`;
- GCP Cloud Run, Scheduler, KMS, Secret Manager, and Artifact Registry:
  \`us-east4\` (Northern Virginia);
- Neon: AWS \`us-east-1\` (N. Virginia);
- Upstash: GCP \`us-east4\` (Virginia), one primary and no paid read replicas;
- Alchemy Free primary RPC and the Robinhood public testnet RPC fallback;
- no mainnet value and no paid RPC;
- USD 35 total monthly envelope.

The envelope is allocated as USD 20 GCP budget alerts, a USD 5 Upstash hard
cap, USD 5 for Neon usage during the PITR evidence window, and USD 5
contingency. A Google Cloud budget is an alert, not a hard spending cap, so the
Cloud Run instance limits, scale-to-zero policy, one-task jobs, provider caps,
and 15-minute schedules are the actual cost controls.

Cloud KMS now supports \`ec-sign-secp256k1-sha256\` with SOFTWARE protection.
That costs roughly USD 0.06 per active key version per month, so staging does
not need the roughly USD 2.50/month HSM key. Mainnet key protection remains a
separate release decision and is not authorized here.

## Validate locally

\`\`\`powershell
powershell -NoProfile -File deploy/gcp/test-staging-policy.ps1
powershell -NoProfile -File deploy/gcp/bootstrap-staging.ps1 -ProjectId velostra-staging-us
\`\`\`

The bootstrap command is plan-only by default. It mutates Google Cloud only
when \`-Apply\` and a billing account ID are explicitly supplied.

## Current external blocker

The authenticated Google account has no visible project or Cloud Billing
account. Activate Cloud Billing in the Google Cloud console first. Do not apply
the bootstrap until the billing account exists and the policy test passes.
