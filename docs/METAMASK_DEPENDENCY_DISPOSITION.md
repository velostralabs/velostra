# MetaMask dependency advisory disposition

Date: 2026-07-15

Last revalidated: 2026-07-20

Owner: Velostra Security

Review expiry: 2026-10-15

Advisory: `GHSA-w5hq-g745-h8pq`

## Decision

The six npm Moderate findings are one transitive advisory propagated through
`@metamask/connect-evm`, `@metamask/connect-multichain`,
`@metamask/mobile-wallet-protocol-dapp-client`, `@metamask/rpc-errors`, and two
installed copies of `@metamask/utils`. npm currently reports no supported upgrade
that removes both affected `uuid@9.0.1` copies.

The vulnerable `uuid` behavior requires a caller-controlled buffer passed to UUID
v3, v5, or v6. Both installed MetaMask utility implementations import `uuid` only
inside their Node-oriented filesystem helper and call `uuid.v4()` without a caller
buffer. Velostra does not import `uuid` directly and does not expose the utility
filesystem helper to browser input. The reviewed application path is therefore not
reachable under the current dependency graph.

This is a time-bounded Moderate risk acceptance, not a claim that the vulnerable
package is absent. Production dependency audit remains a gate at High/Critical;
Moderate count and reachability are monitored separately.

## Controls and invalidation conditions

- `npm run audit:metamask` fails if either installed MetaMask utility begins calling
  UUID v3, v5, or v6.
- Browser wallet automation covers rejected connection, reconnect, wrong-chain
  recovery, message signing, and transaction requests.
- Re-review immediately if the lockfile changes any MetaMask/UUID version, the
  filesystem helper becomes browser-reachable, npm publishes a non-breaking fix,
  or the advisory scope changes.
- Remove this acceptance instead of extending it when a supported upstream release
  resolves the dependency tree.

## Evidence commands

```bash
npm audit --omit=dev --json
npm explain uuid
npm run audit:metamask
```
