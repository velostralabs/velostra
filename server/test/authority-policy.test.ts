import assert from 'node:assert/strict'
import { validateAuthorityPolicy } from '../src/lib/authority-policy.js'

const roles = [
  ['DEFAULT_ADMIN', 'multisig', '0x1111111111111111111111111111111111111111', 2],
  ['PAUSER', 'multisig', '0x2222222222222222222222222222222222222222', 2],
  ['FEE_MANAGER', 'multisig', '0x3333333333333333333333333333333333333333', 2],
  ['SETTLER', 'restricted-signer', '0x4444444444444444444444444444444444444444', 1],
  ['TREASURY', 'multisig', '0x5555555555555555555555555555555555555555', 2],
].map(([role, principalType, principal, threshold]) => ({
  role,
  principal_type: principalType,
  principal,
  owner: 'staging-owner',
  approval_threshold: threshold,
  escalation: 'staging-on-call',
}))

const valid = {
  policy_version: 1,
  environment: 'staging',
  change_ticket: 'phase2-test',
  roles,
}

assert.equal(validateAuthorityPolicy(valid).roles.length, 5)
assert.equal(
  validateAuthorityPolicy({ ...valid, environment: 'robinhood-mainnet' }).environment,
  'robinhood-mainnet'
)
assert.throws(
  () => validateAuthorityPolicy({ ...valid, roles: roles.slice(1) }),
  /exactly 5 element|every required role/
)
assert.throws(
  () =>
    validateAuthorityPolicy({
      ...valid,
      roles: roles.map((entry) =>
        entry.role === 'DEFAULT_ADMIN' ? { ...entry, approval_threshold: 1 } : entry
      ),
    }),
  /approval_threshold/
)
assert.throws(
  () =>
    validateAuthorityPolicy({
      ...valid,
      roles: roles.map((entry) =>
        entry.role === 'SETTLER' ? { ...entry, principal_type: 'multisig' } : entry
      ),
    }),
  /SETTLER must use/
)
assert.throws(
  () =>
    validateAuthorityPolicy({
      ...valid,
      roles: roles.map((entry) =>
        entry.role === 'SETTLER' ? { ...entry, approval_threshold: 2 } : entry
      ),
    }),
  /SETTLER approval_threshold must be exactly 1/
)

console.log('AUTHORITY OWNERSHIP POLICY VERIFIED')
