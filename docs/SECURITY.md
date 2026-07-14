# Security

> Last verified against the workspace: 2026-07-14.
>
> Current posture: development/local-EVM ready, not approved for mainnet funds.

## Trust boundaries

Velostra menerima input dari wallet, browser, builder-controlled HTTP endpoint,
EVM RPC, Redis, dan Postgres. Yang paling sensitif adalah backend settlement key,
contract owner authority, builder endpoint egress, financial ledger writes, dan
chain-to-database reconciliation.

## Wallet auth dan session

Implemented:

- EIP-191 `personal_sign` verification dengan viem;
- challenge wallet-specific;
- nonce one-time dan expiry 5 menit;
- JWT HS256 expiry 24 jam;
- httpOnly, `sameSite: lax` cookie;
- spoofed signature dan replay test.

Gaps:

- nonce disimpan dalam in-memory `Map`; restart menghapus challenge dan beberapa
  API instance tidak berbagi consume state;
- cookie belum memakai `secure: true` atau environment-aware config;
- single symmetric JWT key, tanpa key ID/rotation overlap;
- belum ada login abuse/IP control atau anti-Sybil free-tier defense.

Before production: Redis-backed atomic nonce consume, TLS-only secure cookie,
explicit proxy/CORS setup, request-size limit, security headers, and session/key
rotation runbook.

## Admin dan privileged authority

Backend admin adalah satu address dari `ADMIN_WALLET`. Tidak ada role roster,
grant/revoke, approval quorum, atau structured audit log. Contract lebih sensitif:
`onlyOwner` saat ini bisa settle earnings, mengubah fee, dan menarik treasury.

Sebelum mainnet, pisahkan backend `SETTLER_ROLE` dari multisig admin/treasury dan
buat emergency revoke/rotation path. Jangan menyimpan deployer key di long-running
service.

## Backend signer

`BACKEND_SIGNER_PRIVATE_KEY` menandatangani `creditBuilderEarnings`. Satu process
menserialisasi writes dengan promise queue, tetapi beberapa process tidak
berkoordinasi. Key compromise dapat membuat arbitrary earnings credit selama
contract tetap memakai `onlyOwner`.

Controls yang dibutuhkan:

- KMS/HSM atau restricted signer service;
- role paling minimum dan spend/operation policy;
- gas balance + nonce monitoring;
- key rotation/revocation drill;
- multi-instance nonce coordination;
- alert untuk unknown builder/call ID dan abnormal volume.

## Builder endpoint dan SSRF

`endpoint_url` saat ini hanya divalidasi sebagai URL. Backend lalu melakukan
server-side `fetch`, termasuk redirect behavior default. Malicious builder dapat
mengarahkan request ke loopback, private network, link-local/cloud metadata, DNS
rebinding target, atau response yang sangat besar.

Ini blocker mainnet. Minimum fix:

- hanya `https` (allow explicit local exception untuk test);
- resolve semua A/AAAA dan blokir private, loopback, link-local, multicast,
  documentation, dan metadata ranges;
- validasi ulang setiap redirect dan batasi redirect count;
- port allowlist dan egress firewall/proxy;
- connect/read timeout, response-size cap, content-type policy;
- DNS rebinding-safe connection strategy;
- adversarial SSRF integration suite.

## HMAC builder protocol

Outbound request ditandatangani per-agent secret dengan HMAC-SHA256 atas
`timestamp.rawBody`. Builder harus memverifikasi raw bytes, timestamp freshness,
dan signature memakai timing-safe comparison.

`agents.secret_key` masih plaintext di Postgres dan tidak memiliki rotation API.
Database compromise membuka semua agent secret. Enkripsi envelope/KMS dan
rotation/revoke flow wajib sebelum builder eksternal.

`GATEWAY_HMAC_SECRET` dipakai helper callback verification, tetapi tidak ada route
callback yang menggunakannya saat ini.

## Financial integrity dan replay

Implemented defenses:

- receipt status + destination contract verification;
- authenticated sender dan exact event amount verification untuk top-up/claim;
- unique top-up/settlement/claim hashes;
- unique raw event `(tx_hash, log_index)`;
- unique `onchain_call_id` dan onchain `settledCallIds`;
- Postgres row locks untuk changing balances;
- durable PROCESSING intent sebelum external side effects;
- conditional `PROCESSING -> SUCCESS` ownership claim di live path dan worker;
- confirmation delay, pending-event retry, and drift comparison.

Remaining risks:

- JS `number` dipakai setelah `numeric(20,6)` conversion;
- onchain/offchain spending invariant belum formal;
- no reorg rollback, hanya confirmation delay;
- tx hash baru diekspos setelah receipt wait; post-broadcast RPC ambiguity dapat
  salah menandai call FAILED sampai durable settlement-attempt/outbox dibuat;
- manual high `--from-block` dapat memajukan cursor jika dioperasikan salah;
- negative recovered credit balance perlu dedicated alert;
- no distributed worker lease or cross-instance signer lock.

## Redis behavior

Rate limit fail-open ketika Redis down. Ini menjaga availability, tetapi membuka
abuse window. Free-tier memiliki Postgres fallback. Production perlu memilih policy
per operation: public browsing boleh fail-open, sedangkan costly execution mungkin
memerlukan conservative local fallback/circuit breaker.

## Data dan privacy

Agent input/output disimpan di `agent_calls`; dapat berisi data sensitif. Belum ada
retention, encryption policy, deletion/export flow, redaction, atau telemetry
classification. Logs dan metrics tidak boleh merekam raw prompt/output, secrets,
JWT, signature, atau private key.

## Smart contract risks

- belum audit;
- single owner;
- no pause;
- no solvency check;
- immutable token, no migration path;
- 6-decimal minimum assumption.

Detail ada di [SMART_CONTRACT.md](./SMART_CONTRACT.md).

## Dependency dan supply chain

GitHub Actions menjalankan lockfile installs, frontend lint/build, backend
auth/build, contract local-EVM tests, serta full money-loop reconciliation. Web dan
backend production dependencies juga melewati `npm audit --omit=dev` pada CI.

Audit 2026-07-14 menunjukkan zero production advisories pada backend. Full dev
scans tetap melaporkan transitive advisories dari Ganache, legacy crypto packages,
Drizzle Kit tooling, dan `solc`; tooling itu tidak masuk runtime API image, tetapi
harus tetap dipantau atau diganti saat upstream menyediakan jalur upgrade yang
valid. Belum ada dedicated secret-scan workflow, SBOM, license automation, atau
Dependabot/Renovate policy.

## Mainnet security gate

Tidak boleh mainnet dengan real value sebelum:

- contract/backend independent review selesai tanpa open Critical/High;
- roles dipisah dan signer diproteksi;
- SSRF suite lolos;
- secrets encrypted/managed dan rotation tested;
- versioned migrations + backup/restore tested;
- browser wallet, load, reorg, RPC throttle, and one-hour outage drills lolos;
- cursor lag, pending event, drift, abnormal volume, key gas, dan error alerts
  benar-benar sampai operator;
- incident, pause/revoke, rollback, and contract migration runbooks tersedia.

Urutan implementasi ada di [ROADMAP.md](./ROADMAP.md).