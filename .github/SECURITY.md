# Security policy

Velostra is pre-mainnet software. Please do not open public issues for suspected
vulnerabilities or include secrets, wallet keys, personal data, or exploit details
in public discussions.

Report security issues privately through GitHub's **Report a vulnerability** flow
for this repository. Include the affected component, reproducible impact, and a
minimal proof of concept. The Velostra maintainers will acknowledge valid reports,
triage severity, and coordinate disclosure after a fix is available.

The `main` branch is the only supported development line. No deployment in this
repository should be treated as audited or production-ready unless a tagged
release explicitly says so.

The verified Phase 1 baseline and evidence live in
[docs/PHASE_1_HANDOFF.md](../docs/PHASE_1_HANDOFF.md); the external review scope
lives in [docs/AUDIT_READINESS.md](../docs/AUDIT_READINESS.md). Phase 2 is the next
active workstream, but local/CI passing tests are not an independent audit.
