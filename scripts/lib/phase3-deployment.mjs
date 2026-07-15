import { encodeDeployData, getAddress, keccak256 } from 'viem'
import { sealManifest, sha256Canonical, validAddress } from './phase3-release.mjs'
import { validateCanaryPolicy } from './phase3-policy.mjs'

export { validateCanaryPolicy }

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

export function createDeploymentPlan({
  manifest,
  artifact,
  canaryPolicy,
  generatedAt = new Date().toISOString(),
}) {
  const policyResult = validateCanaryPolicy(canaryPolicy, manifest.stage, manifest.environment)
  if (!policyResult.passed) {
    throw new Error('Invalid canary policy:\n- ' + policyResult.failures.join('\n- '))
  }
  assert(Array.isArray(artifact?.abi), 'Contract ABI is required')
  assert(/^0x[a-f0-9]+$/i.test(artifact?.bytecode ?? ''), 'Contract bytecode is required')

  const constructor = manifest.contract.constructor
  const roles = constructor.roles
  const args = [
    getAddress(constructor.settlementToken),
    constructor.platformFeeBps,
    getAddress(roles.admin),
    getAddress(roles.settler),
    getAddress(roles.treasury),
    getAddress(roles.pauseGuardian),
  ]
  const initCode = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  })
  const broadcastEligible =
    manifest.stage === 'broadcast-approved' &&
    manifest.authorization?.mainnetApproved === true

  return sealManifest({
    schemaVersion: 1,
    kind: 'velostra-phase3-deployment-plan',
    release: manifest.release,
    environment: manifest.environment,
    stage: manifest.stage,
    generatedAt,
    sourceManifestSha256: manifest.integrity.manifestSha256,
    broadcastPerformed: false,
    broadcastEligible,
    transaction: {
      chainId: manifest.chain.id,
      from: getAddress(manifest.contract.deployer),
      to: null,
      valueWei: '0',
      initCodeKeccak256: keccak256(initCode),
      initCodeBytes: (initCode.length - 2) / 2,
      constructorArguments: {
        settlementToken: args[0],
        platformFeeBps: args[1],
        roles: {
          admin: args[2],
          settler: args[3],
          treasury: args[4],
          pauseGuardian: args[5],
        },
      },
    },
    database: {
      journalSha256: manifest.repository.drizzleJournal.sha256,
      migrations: manifest.repository.migrations,
      destructiveRollbackAllowed: false,
      orderedSteps: [
        'verify-managed-backup-and-pitr',
        'run-db-check',
        'apply-reviewed-migrations',
        'verify-schema-and-critical-constraints',
      ],
    },
    rollout: {
      paidWritesInitiallyEnabled: false,
      exactDeploymentBlock:
        manifest.contract.deploymentBlock ?? 'set-from-confirmed-deployment-receipt',
      orderedSteps: [
        'deploy-and-confirm-contract',
        'verify-runtime-bytecode-and-constructor-state',
        'record-exact-deployment-block',
        'start-api-with-paid-writes-disabled',
        'start-reconciliation-worker-from-deployment-block',
        'wait-for-confirmed-safe-head-catch-up',
        'require-zero-drift-go-no-go',
        'enable-allowlisted-canary-only',
      ],
    },
    stopConditions: [
      'non-zero-financial-drift',
      'contract-insolvent',
      'worker-lag-above-policy',
      'recoverable-outbox-above-policy',
      'rpc-chain-disagreement',
      'unexpected-role-or-fee-change',
      'signer-below-policy',
      'unacknowledged-critical-alert',
    ],
    rollback: {
      strategy: canaryPolicy.rollback.strategy,
      orderedActions: [
        'disable-paid-writes',
        'preserve-builder-claims',
        'keep-reconciliation-running',
        'page-incident-owner',
        'pause-new-contract-risk-if-authorized',
        'restore-previous-api-and-web-images',
        'revoke-or-rotate-settler-if-compromised',
        'use-forward-database-repair',
        'use-successor-and-liquidity-migration-for-permanent-contract-replacement',
      ],
      destructiveDatabaseRollbackAllowed: false,
    },
    canary: {
      policySha256: manifest.policies.canary.sha256,
      enabledAtPlanTime: canaryPolicy.enabled,
      allowlistCounts: {
        wallets: canaryPolicy.allowlists.wallets.length,
        agents: canaryPolicy.allowlists.agents.length,
        builders: canaryPolicy.allowlists.builders.length,
      },
      limits: canaryPolicy.limits,
    },
  })
}

export function finalizeDeploymentManifest(manifest, deployment) {
  assert(
    manifest?.stage === 'broadcast-approved',
    'Only a broadcast-approved manifest can be finalized'
  )
  assert(
    deployment?.release === manifest.release,
    'Deployment release differs from manifest'
  )
  assert(
    deployment?.sourceManifestSha256 === manifest.integrity.manifestSha256,
    'Deployment source manifest hash differs'
  )
  assert(validAddress(deployment?.address), 'Deployment address is invalid')
  assert(positiveInteger(deployment?.deploymentBlock), 'Deployment block is invalid')
  assert(/^0x[a-f0-9]{64}$/i.test(deployment?.transactionHash ?? ''), 'Deployment transaction hash is invalid')
  assert(deployment?.chainId === manifest.chain.id, 'Deployment chain id differs')

  return sealManifest({
    ...manifest,
    integrity: undefined,
    stage: 'deployed',
    contract: {
      ...manifest.contract,
      address: getAddress(deployment.address),
      deploymentBlock: deployment.deploymentBlock,
      deploymentTxHash: deployment.transactionHash,
    },
    deploymentRecord: {
      confirmedAt: deployment.confirmedAt,
      sourceManifestSha256: deployment.sourceManifestSha256,
      verificationRequired: true,
    },
  })
}

export function deploymentPlanDigest(plan) {
  const { integrity: _integrity, ...body } = plan
  return sha256Canonical(body)
}
