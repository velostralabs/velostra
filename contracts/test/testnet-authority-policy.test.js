const assert = require('assert')
const {
  SAFE_VERSION,
  classifyPredictedSafeCode,
  getCanonicalProxyFactoryAddress,
  validateInspectedAuthoritySet,
  validateAuthorityPlan,
  validateSafeDescriptor,
  validateSafeState,
} = require('../scripts/lib/testnet-authority-policy')

const address = (value) => '0x' + value.toString(16).padStart(40, '0')
const descriptor = (start, salt) => ({
  owners: [address(start), address(start + 1), address(start + 2)],
  threshold: 2,
  saltNonce: '0x' + salt.repeat(64),
})
const plan = {
  schemaVersion: 1,
  kind: 'velostra-testnet-safe-authority-plan',
  environment: 'staging',
  region: 'us-east4',
  network: 'robinhood-testnet',
  chainId: 46630,
  roles: {
    governance: descriptor(1, '1'),
    treasury: descriptor(4, '2'),
    pauseGuardian: descriptor(7, '3'),
  },
}

const roles = validateAuthorityPlan(plan)
assert.match(getCanonicalProxyFactoryAddress(), /^0x[0-9A-Fa-f]{40}$/)
assert.deepEqual(classifyPredictedSafeCode('0x6000', '0x6000'), {
  deployed: true,
  factoryReady: true,
  deploymentTransactionRequired: false,
})
assert.deepEqual(classifyPredictedSafeCode('0x', '0x6000'), {
  deployed: false,
  factoryReady: true,
  deploymentTransactionRequired: true,
})
assert.equal(roles.governance.threshold, 2)
assert.equal(roles.treasury.owners.length, 3)
assert.equal(
  validateSafeState(
    {
      code: '0x6000',
      owners: plan.roles.governance.owners,
      threshold: 2n,
      version: SAFE_VERSION,
    },
    'governance Safe',
    plan.roles.governance.owners
  ).version,
  SAFE_VERSION
)
const onchainAuthorities = Object.fromEntries(
  ['governance', 'treasury', 'pauseGuardian'].map((name) => [
    name,
    validateSafeState(
      {
        code: '0x6000',
        owners: plan.roles[name].owners,
        threshold: 2,
        version: SAFE_VERSION,
      },
      name + ' Safe'
    ),
  ])
)
assert.equal(
  validateInspectedAuthoritySet(onchainAuthorities, '0x').treasury.threshold,
  2
)
assert.throws(
  () =>
    validateInspectedAuthoritySet(
      {
        ...onchainAuthorities,
        treasury: onchainAuthorities.governance,
      },
      '0x'
    ),
  /disjoint/
)
assert.throws(
  () => validateInspectedAuthoritySet(onchainAuthorities, '0x6000'),
  /isolated/
)

assert.throws(
  () => validateSafeDescriptor({ ...plan.roles.governance, threshold: 1 }, 'safe'),
  /threshold/
)
assert.throws(
  () =>
    validateSafeDescriptor(
      { ...plan.roles.governance, owners: plan.roles.governance.owners.slice(0, 2) },
      'safe'
    ),
  /exactly 3/
)
assert.throws(
  () =>
    validateAuthorityPlan({
      ...plan,
      roles: {
        ...plan.roles,
        treasury: {
          ...plan.roles.treasury,
          owners: [
            plan.roles.governance.owners[0],
            ...plan.roles.treasury.owners.slice(1),
          ],
        },
      },
    }),
  /disjoint/
)
assert.throws(
  () =>
    validateSafeState(
      {
        code: '0x',
        owners: plan.roles.governance.owners,
        threshold: 2,
        version: SAFE_VERSION,
      },
      'safe'
    ),
  /deployed contract/
)
assert.throws(
  () =>
    validateSafeState(
      {
        code: '0x6000',
        owners: plan.roles.governance.owners,
        threshold: 1,
        version: SAFE_VERSION,
      },
      'safe'
    ),
  /threshold/
)

console.log('ROBINHOOD TESTNET SAFE AUTHORITY POLICY VERIFIED')
