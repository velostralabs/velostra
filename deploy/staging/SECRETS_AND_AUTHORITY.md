# Staging secrets and authority runbook

This runbook is for isolated managed staging and Phase 3 release preparation. It
does not authorize a production or mainnet rollout.

## Secret delivery

Set VELOSTRA_SECRET_PROVIDER to managed-injection. The deployment platform resolves
database, Redis, RPC, JWT, gateway HMAC, agent-envelope, signer-auth, and alert
credentials from its managed secret store immediately before process start. Values
must not be baked into an image, checked into Git, exposed through frontend variables,
or printed by a release command.

Use distinct service identities for the API, reconciliation worker, migration job,
and restricted signer. Limit each identity to the exact secret references it needs.
The API and worker may call the signer, but neither receives its private key.

## Restricted signer contract

Production-mode configuration requires SETTLEMENT_SIGNER_MODE=remote and rejects a
BACKEND_SIGNER_PRIVATE_KEY. The configured HTTPS endpoint receives:

- a bearer token delivered by the managed secret store;
- an Idempotency-Key containing the bytes32 callId;
- chain ID, escrow address, zero value, and encoded
  creditBuilderEarnings(builder,grossAmount,callId) calldata.

The signer must validate the chain and escrow allowlist, enforce the function
selector, serialize nonce allocation, treat callId as an idempotency key, sign through
KMS/restricted custody, broadcast, and return the transaction hash plus its configured
signer address. It must reject arbitrary destinations, calldata, value, or callers.

## Authority ownership

Copy authority-policy.example.json to protected deployment configuration, replace
every synthetic principal/owner, and link the approved change ticket. Verify it with:

    npm run authority:validate --prefix server -- deploy/staging/authority-policy.json

DEFAULT_ADMIN, PAUSER, FEE_MANAGER, and TREASURY must be separately owned multisig
principals with a threshold of at least two. SETTLER must be the restricted signer and
must have no treasury, fee, pause, or admin authority.

## Required staging drills

Record timestamps, operators, transaction hashes, alert evidence, and rollback:

1. rotate JWT and gateway HMAC secrets with an overlap window, then revoke the old
   versions and prove old credentials fail;
2. add a new envelope key, re-encrypt every agent secret, scan for the old key ID,
   remove the old decrypt key, and rerun the secret suite;
3. rotate/revoke an agent HMAC secret and prove the previous version is rejected;
4. grant SETTLER_ROLE to a replacement restricted signer, send one synthetic paid
   call, revoke the old signer, and prove the old signer can no longer settle;
5. pause with the guardian, prove deposits/new settlement stop while claims remain
   possible, then require governance to unpause;
6. simulate signer compromise: pause new paid risk, revoke signer access/token/role,
   preserve claims and reconciliation, rotate the signer, and reconcile to zero drift.

Never mark a drill complete from unit tests alone. Mainnet release evidence requires
that the same procedure pass against managed staging services and a staging contract.

## Phase 3 binding

Every release process must receive the same canonical manifest SHA-256, full Git
commit, chain ID, contract address, image digests, approval ticket, and distinct
approver identities. Mainnet-like API, worker, monitor, and migration startup fails
closed on a missing or mismatched binding. The immutable input directory is
read-only; collectors write readiness and canary snapshots only to the evidence
directory.

Canary mode additionally requires a manifest-bound policy, explicit wallet/agent
allowlists, monotonic call/value/time ceilings, and non-destructive STOP actions.
Claims and reconciliation remain live when paid-call admission stops. Public mode is
not an automatic canary outcome: it requires a separate explicit exit approval and a
passing decision file bound to the same manifest and policy hashes.
