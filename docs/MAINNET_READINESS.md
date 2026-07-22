# Mainnet readiness packet

> Current decision: **NO_GO**. This packet is preparation-only. It cannot authorize
> a mainnet broadcast, a paid canary, expansion, or real-value use.

Velostra's public testnet is complete and remains the operational proof surface. The
mainnet readiness packet is the deterministic handoff between that checkpoint and a
future, separately governed production release. It hash-binds the reviewed Git commit,
contract source and bytecode, dependency lockfiles, authority/custody plan, deployment
and rollback plan, environment-isolation contract, audit evidence, operational drills,
and bounded canary policy.

Mainnet preparation is not allowed to repurpose the public-testnet stack. The packet
now hash-binds a US-only isolation plan requiring separate cloud project, API runtime,
database, Redis, signer, scheduler, secret namespace, service accounts, and evidence
store. Testnet must remain available at `https://velostra.xyz/testnet`; preparation may
only perform its three declared read-only health checks.

## Decisions and authority boundary

The packet has only two decisions:

- `NO_GO`: one or more external production prerequisites remain open;
- `READY_FOR_SIGNING`: every readiness input is complete and internally consistent.

`READY_FOR_SIGNING` is not permission to deploy. Every preparation packet always
contains:

```json
{
  "mainnetBroadcast": false,
  "canaryExecution": false,
  "expansion": false
}
```

The validator rejects any packet that changes one of those values. A later
two-person `broadcast-approved` Phase 3 manifest, followed by a separately approved
low-value canary, remains mandatory.

## Current blockers

The tracked example intentionally produces `NO_GO` because:

1. independent contract/backend review is incomplete;
2. production Safe principals, disjoint hardware-wallet owners, restricted settler,
   custody recovery, and rotation drills are not assigned or complete;
3. production restore, signer recovery, alert delivery, incident ownership, and
   runbook gates are incomplete;
4. the distinct security and operations approval roles are not assigned.

No mainnet address, transaction hash, owner identity, credential, provider identifier,
or real-value authority is recorded in the tracked templates.

## Files

| File | Role |
|---|---|
| `config/mainnet-readiness-input.example.json` | Audit, operations, approval, network, and plan inputs. |
| `config/mainnet-environment-isolation.example.json` | US runtime boundary, separate-resource requirements, and immutable testnet-continuity rules. |
| `config/mainnet-authority-plan.example.json` | Three 2-of-3 Safe groups, disjoint ownership policy, restricted settler, custody, and recovery. |
| `config/mainnet-deployment-plan.example.json` | Plan-only deploy/readiness ordering and forward-repair rollback. |
| `config/mainnet-canary-policy.example.json` | Disabled, empty-allowlist, low-exposure canary definition with zero-drift stop rules. |
| `config/mainnet-readiness-packet.schema.json` | Public packet envelope and immutable false authorization flags. |
| `scripts/lib/mainnet-readiness.mjs` | Deterministic generator, validators, hash binding, and decision logic. |

Generated packets live under ignored `artifacts/mainnet/`. Independent audit reports
can remain ignored/private; only their repository-relative reference and SHA-256 are
included in a locally generated packet. Never put credentials, private keys, owner
identity, personal paths, or raw provider metadata in tracked templates.

## Commands

From a clean reviewed commit with the deterministic contract artifact built:

```bash
npm run test:mainnet-readiness
npm run mainnet:prepare
npm run mainnet:validate
```

`mainnet:prepare` writes `artifacts/mainnet/readiness-packet.json`. The ordinary
validator accepts a structurally valid `NO_GO` packet so operators can inspect its
blockers. The release gate is stricter:

```bash
npm run mainnet:gate
```

That command must fail until the decision becomes `READY_FOR_SIGNING`. Dirty-tree
bypass is development-test-only and must never be used for a real packet:

```powershell
$env:MAINNET_READINESS_ALLOW_DIRTY = 'development-only'
npm run mainnet:prepare
```

## Closing a blocker

1. Freeze the candidate commit and audit scope.
2. Store the independent report outside tracked public files, set its ignored relative
   path in the local input, and record zero open Critical/High plus explicit Medium
   disposition.
3. Replace pending authority placeholders in a private release input with actual
   production principals and three genuinely disjoint owner sets; complete rotation
   and recovery drills.
4. Complete the production restore, signer recovery, alert delivery, incident-owner,
   and runbook gates.
5. Assign distinct security and operations approver roles.
6. Regenerate on a clean tree, validate the packet, and require `mainnet:gate` to pass.
7. Only then create the separate two-person broadcast-approved deployment manifest.

Any contract, bytecode, lockfile, plan, audit report, or readiness-tool change alters
the packet hash and requires regeneration and affected-scope review.

## Deployment and canary boundary

The recorded deployment sequence keeps paid writes disabled through deploy, migration,
contract verification, worker startup, and read-only readiness. Rollback means stop
new risk, retain claims and reconciliation, restore the previous immutable runtime
image when appropriate, and forward-repair state; it never blindly replays a mainnet
transaction.

The canary remains disabled with empty allowlists in this packet. Enabling it requires
a separate signed decision that supplies the allowed wallet, agent, and builder,
preserves the fixed exposure caps, and stops on any failed call, non-zero drift, stale
reconciliation, or readiness failure. Expansion requires another decision after the
canary; it is never inherited from readiness.
