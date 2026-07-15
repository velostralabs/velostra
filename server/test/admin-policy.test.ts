import { rolesAllow } from '../src/lib/admin.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('FAILED: ' + message)
  console.log('✅', message)
}

async function main(): Promise<void> {
  assert(rolesAllow(['SUPER_ADMIN'], 'rbac:manage'), 'super admin can manage RBAC')
  assert(rolesAllow(['SUPER_ADMIN'], 'report:resolve'), 'super admin can resolve reports')
  assert(rolesAllow(['AGENT_REVIEWER'], 'agent:decide'), 'agent reviewer can decide agents')
  assert(!rolesAllow(['AGENT_REVIEWER'], 'report:read'), 'agent reviewer cannot read reports')
  assert(rolesAllow(['REPORT_MODERATOR'], 'report:resolve'), 'report moderator can resolve reports')
  assert(!rolesAllow(['REPORT_MODERATOR'], 'agent:decide'), 'report moderator cannot decide agents')
  assert(rolesAllow(['FINANCE_VIEWER'], 'stats:read'), 'finance viewer can read platform stats')
assert(rolesAllow(['SUPER_ADMIN'], 'webhook:operate'), 'super admin is the webhook operator')
assert(rolesAllow(['SUPER_ADMIN'], 'privacy:operate'), 'super admin can complete privacy requests')
assert(rolesAllow(['SUPER_ADMIN'], 'telemetry:manage'), 'super admin controls telemetry policy')
assert(!rolesAllow(['AUDITOR'], 'webhook:operate'), 'auditor cannot mutate webhook state')
assert(!rolesAllow(['REPORT_MODERATOR'], 'privacy:operate'), 'report moderator cannot process privacy requests')
  assert(!rolesAllow(['FINANCE_VIEWER'], 'audit:read'), 'finance viewer cannot read audit logs')
  assert(rolesAllow(['AUDITOR'], 'audit:read'), 'auditor can read immutable audit logs')
  assert(rolesAllow(['AUDITOR'], 'agent:read'), 'auditor can inspect agent review state')
  assert(!rolesAllow(['AUDITOR'], 'agent:decide'), 'auditor cannot mutate agent decisions')
  assert(!rolesAllow([], 'stats:read'), 'user with no active role has no admin authority')
  console.log('\n🎉 ADMIN RBAC POLICY VERIFIED\n')
}

main().catch((error) => {
  console.error('💥', error)
  process.exit(1)
})