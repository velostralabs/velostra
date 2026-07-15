import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { validateCanaryPolicy } from './phase3-policy.mjs'

export const PHASE3_SCHEMA_VERSION = 1
export const PHASE3_CHAIN_ID = 4663
export const PHASE3_MANIFEST_KIND = 'velostra-phase3-release'
export const PHASE3_STAGES = new Set(['preparation', 'broadcast-approved', 'deployed'])

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const TX_HASH = /^0x[a-f0-9]{64}$/i
const FULL_COMMIT = /^[a-f0-9]{40}$/i
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/

const LOCKFILE_PATHS = [
  'package-lock.json',
  'server/package-lock.json',
  'contracts/package-lock.json',
]
const RELEASE_TOOL_PATHS = [
  'scripts/lib/phase3-release.mjs',
  'scripts/lib/phase3-policy.mjs',
  'scripts/prepare-phase3-release.mjs',
  'scripts/validate-phase3-release.mjs',
  'scripts/lib/phase3-deployment.mjs',
  'scripts/plan-phase3-deployment.mjs',
  'scripts/finalize-phase3-deployment.mjs',
  'scripts/lib/phase3-gates.mjs',
  'scripts/evaluate-phase3-readiness.mjs',
  'scripts/evaluate-phase3-canary.mjs',
  'config/phase3-release-manifest.schema.json',
]

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        throw new TypeError('Canonical JSON rejects undefined at ' + key)
      }
      result[key] = canonicalValue(value[key])
    }
    return result
  }
  throw new TypeError('Canonical JSON rejects ' + typeof value)
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value), null, 2) + '\n'
}

export function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value)))
}

export function sealManifest(value) {
  const { integrity: _integrity, ...body } = value
  return {
    ...body,
    integrity: {
      algorithm: 'sha256',
      manifestSha256: sha256Canonical(body),
    },
  }
}

export function repositoryPath(repositoryRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Repository path must be non-empty and relative: ' + relativePath)
  }
  const resolved = path.resolve(repositoryRoot, relativePath)
  const relative = path.relative(repositoryRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Repository path escapes root: ' + relativePath)
  }
  return resolved
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

export async function fileEntry(repositoryRoot, relativePath) {
  const bytes = await fs.readFile(repositoryPath(repositoryRoot, relativePath))
  return {
    path: relativePath.replaceAll('\\', '/'),
    sha256: sha256Bytes(bytes),
  }
}

function readGitHead(repositoryRoot) {
  const gitDirectory = path.join(repositoryRoot, '.git')
  const head = readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim()
  if (FULL_COMMIT.test(head)) return head
  if (!head.startsWith('ref: ')) throw new Error('Unsupported Git HEAD format')
  const reference = head.slice(5)
  const looseReference = path.join(gitDirectory, ...reference.split('/'))
  if (existsSync(looseReference)) return readFileSync(looseReference, 'utf8').trim()
  const packedReferences = path.join(gitDirectory, 'packed-refs')
  if (existsSync(packedReferences)) {
    const match = readFileSync(packedReferences, 'utf8')
      .split(/\r?\n/)
      .find((line) => line.endsWith(' ' + reference))
    if (match) return match.slice(0, 40)
  }
  throw new Error('Git HEAD reference cannot be resolved')
}

export function gitHead(repositoryRoot) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  } catch {
    return readGitHead(repositoryRoot)
  }
}

export function gitStatus(repositoryRoot) {
  return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
}

export function validAddress(value) {
  return typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value)
}

function check(condition, failures, message) {
  if (!condition) failures.push(message)
}
const AUTHORITY_ROLES = [
  'DEFAULT_ADMIN',
  'PAUSER',
  'FEE_MANAGER',
  'SETTLER',
  'TREASURY',
]

export function validateReleaseAuthorityPolicy(policy, context = {}) {
  const failures = []
  const checkPolicy = (condition, message) => {
    if (!condition) failures.push(message)
  }
  checkPolicy(policy?.policy_version === 1, 'authority policy version must be 1')
  checkPolicy(
    typeof policy?.environment === 'string' &&
      /^[a-z0-9][a-z0-9-]{1,31}$/.test(policy.environment),
    'authority policy environment is invalid'
  )
  checkPolicy(
    typeof policy?.change_ticket === 'string' &&
      policy.change_ticket.length >= 3 &&
      policy.change_ticket.length <= 128,
    'authority policy change ticket is invalid'
  )
  const roles = Array.isArray(policy?.roles) ? policy.roles : []
  checkPolicy(roles.length === AUTHORITY_ROLES.length, 'authority policy must contain five roles')
  const byRole = new Map()
  for (const entry of roles) {
    checkPolicy(AUTHORITY_ROLES.includes(entry?.role), 'authority policy contains an unknown role')
    checkPolicy(!byRole.has(entry?.role), 'authority policy contains a duplicate role')
    if (entry?.role) byRole.set(entry.role, entry)
    checkPolicy(validAddress(entry?.principal), 'authority principal is invalid for ' + entry?.role)
    checkPolicy(Boolean(entry?.owner && entry.owner.length >= 3), 'authority owner is invalid for ' + entry?.role)
    checkPolicy(Boolean(entry?.escalation && entry.escalation.length >= 3), 'authority escalation is invalid for ' + entry?.role)
    if (entry?.role === 'SETTLER') {
      checkPolicy(entry?.principal_type === 'restricted-signer', 'SETTLER must use a restricted signer')
      checkPolicy(entry?.approval_threshold === 1, 'SETTLER approval threshold must be one')
    } else {
      checkPolicy(entry?.principal_type === 'multisig', entry?.role + ' must use a multisig')
      checkPolicy(
        Number.isInteger(entry?.approval_threshold) && entry.approval_threshold >= 2,
        entry?.role + ' multisig threshold must be at least two'
      )
    }
  }
  for (const role of AUTHORITY_ROLES) {
    checkPolicy(byRole.has(role), 'authority policy is missing ' + role)
  }

  if (context.stage !== undefined && context.stage !== 'preparation') {
    checkPolicy(
      policy?.environment === context.environment,
      'authority policy environment differs from release environment'
    )
    checkPolicy(
      policy?.change_ticket === context.changeTicket,
      'authority policy ticket differs from release authorization'
    )
    const expected = {
      DEFAULT_ADMIN: context.constructor?.roles?.admin,
      FEE_MANAGER: context.constructor?.roles?.admin,
      SETTLER: context.constructor?.roles?.settler,
      TREASURY: context.constructor?.roles?.treasury,
      PAUSER: context.constructor?.roles?.pauseGuardian,
    }
    for (const [role, principal] of Object.entries(expected)) {
      checkPolicy(
        addressLower(byRole.get(role)?.principal) === addressLower(principal),
        'authority principal differs from contract constructor for ' + role
      )
    }
  }
  return { passed: failures.length === 0, failures }
}

function addressLower(value) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}
function validateConstructor(constructor, failures) {
  check(
    validAddress(constructor?.settlementToken),
    failures,
    'settlement token must be a non-zero address'
  )
  check(
    Number.isInteger(constructor?.platformFeeBps) &&
      constructor.platformFeeBps >= 0 &&
      constructor.platformFeeBps <= 5_000,
    failures,
    'platformFeeBps must be an integer between 0 and 5000'
  )
  const roles = constructor?.roles ?? {}
  for (const role of ['admin', 'settler', 'treasury', 'pauseGuardian']) {
    check(validAddress(roles[role]), failures, role + ' must be a non-zero address')
  }
  const principals = Object.values(roles).map((value) => String(value).toLowerCase())
  check(new Set(principals).size === 4, failures, 'contract role principals must be distinct')
}

async function collectMigrations(repositoryRoot) {
  const migrationDirectory = repositoryPath(repositoryRoot, 'server/drizzle')
  const names = (await fs.readdir(migrationDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
  const journal = await readJson(
    repositoryPath(repositoryRoot, 'server/drizzle/meta/_journal.json')
  )
  const journalNames = (journal.entries ?? []).map((entry) => entry.tag + '.sql')
  if (JSON.stringify(names) !== JSON.stringify(journalNames)) {
    throw new Error('Migration SQL files and Drizzle journal entries differ')
  }
  return Promise.all(
    names.map((name) => fileEntry(repositoryRoot, 'server/drizzle/' + name))
  )
}

async function optionalEntry(repositoryRoot, descriptor) {
  if (descriptor === null || descriptor === undefined) return null
  const relativePath = typeof descriptor === 'string' ? descriptor : descriptor.path
  return fileEntry(repositoryRoot, relativePath)
}

export async function createPhase3Manifest({
  repositoryRoot,
  input,
  generatedAt = new Date().toISOString(),
  allowDirty = false,
}) {
  const failures = []
  check(input?.schemaVersion === PHASE3_SCHEMA_VERSION, failures, 'input schemaVersion must be 1')
  check(input?.kind === 'velostra-phase3-release-input', failures, 'input kind is invalid')
  check(PHASE3_STAGES.has(input?.stage), failures, 'input stage is invalid')
  check(input?.chain?.id === PHASE3_CHAIN_ID, failures, 'input chain id must be 4663')
  for (const name of ['maxBlockRange', 'rpcRetries', 'retryBaseMs']) {
    check(Number.isInteger(input?.reconciliation?.[name]) && input.reconciliation[name] > 0, failures, 'reconciliation ' + name + ' must be positive')
  }
  check(
    Number.isInteger(input?.chain?.confirmations) && input.chain.confirmations > 0,
    failures,
    'confirmations must be positive'
  )
  validateConstructor(input?.contract?.constructor, failures)
  check(validAddress(input?.contract?.deployer), failures, 'deployment-only deployer must be a non-zero address')
  if (failures.length) {
    throw new Error('Invalid Phase 3 release input:\n- ' + failures.join('\n- '))
  }

  const release = input.release === 'git-head' ? gitHead(repositoryRoot) : input.release
  if (!FULL_COMMIT.test(release ?? '')) {
    throw new Error('Release must resolve to a full commit SHA')
  }
  let status
  try {
    status = gitStatus(repositoryRoot)
  } catch (error) {
    if (!allowDirty) throw error
    status = 'git-status-unavailable-in-development-override'
  }
  if (status && !allowDirty) {
    throw new Error('Release preparation requires a clean worktree')
  }

  const artifactPath = input.contract.artifact ?? 'contracts/build/VelostraEscrow.json'
  const artifact = await readJson(repositoryPath(repositoryRoot, artifactPath))
  if (!Array.isArray(artifact.abi) || !/^0x[a-f0-9]+$/i.test(artifact.bytecode ?? '')) {
    throw new Error('VelostraEscrow build artifact is missing ABI or bytecode')
  }
  const [canaryPolicyValue, authorityPolicyValue] = await Promise.all([
    readJson(repositoryPath(repositoryRoot, input.policies.canary)),
    readJson(repositoryPath(repositoryRoot, input.policies.authority)),
  ])
  const authorityPolicyResult = validateReleaseAuthorityPolicy(
    authorityPolicyValue,
    {
      stage: input.stage,
      environment: input.environment,
      changeTicket: input.authorization?.changeTicket,
      constructor: input.contract.constructor,
    }
  )
  if (!authorityPolicyResult.passed) {
    throw new Error(
      'Invalid Phase 3 authority policy:\n- ' + authorityPolicyResult.failures.join('\n- ')
    )
  }
  const canaryPolicyResult = validateCanaryPolicy(
    canaryPolicyValue,
    input.stage,
    input.environment
  )
  if (!canaryPolicyResult.passed) {
    throw new Error(
      'Invalid Phase 3 canary policy:\n- ' + canaryPolicyResult.failures.join('\n- ')
    )
  }

  const [
    source,
    contractArtifact,
    journal,
    authorityPolicy,
    canaryPolicy,
    migrations,
  ] = await Promise.all([
    fileEntry(repositoryRoot, input.contract.source ?? 'contracts/VelostraEscrow.sol'),
    fileEntry(repositoryRoot, artifactPath),
    fileEntry(repositoryRoot, 'server/drizzle/meta/_journal.json'),
    fileEntry(repositoryRoot, input.policies.authority),
    fileEntry(repositoryRoot, input.policies.canary),
    collectMigrations(repositoryRoot),
  ])

  const lockfiles = await Promise.all(
    LOCKFILE_PATHS.map((entry) => fileEntry(repositoryRoot, entry))
  )
  const releaseTools = await Promise.all(
    RELEASE_TOOL_PATHS.map((entry) => fileEntry(repositoryRoot, entry))
  )
  const externalEvidence = {
    phase2: await optionalEntry(repositoryRoot, input.externalEvidence?.phase2),
    independentReview: await optionalEntry(
      repositoryRoot,
      input.externalEvidence?.independentReview
    ),
  }

  return sealManifest({
    schemaVersion: PHASE3_SCHEMA_VERSION,
    kind: PHASE3_MANIFEST_KIND,
    stage: input.stage,
    environment: input.environment,
    release,
    generatedAt,
    repository: {
      cleanAtPreparation: status.length === 0,
      source,
      contractArtifact,
      contractAbiSha256: sha256Canonical(artifact.abi),
      contractBytecodeSha256: sha256Bytes(
        Buffer.from(artifact.bytecode.slice(2), 'hex')
      ),
      drizzleJournal: journal,
      migrations,
      lockfiles,
      releaseTools,
    },
    chain: {
      id: input.chain.id,
      name: input.chain.name ?? 'Robinhood Chain',
      confirmations: input.chain.confirmations,
    },
    reconciliation: input.reconciliation,
    contract: {
      source: source.path,
      artifact: contractArtifact.path,
      deployer: input.contract.deployer,
      constructor: input.contract.constructor,
      address: input.contract.address ?? null,
      deploymentBlock: input.contract.deploymentBlock ?? null,
      deploymentTxHash: input.contract.deploymentTxHash ?? null,
    },
    images: input.images,
    policies: {
      authority: authorityPolicy,
      canary: canaryPolicy,
    },
    externalEvidence,
    authorization: input.authorization,
  })
}

async function validateFileEntry(
  repositoryRoot,
  entry,
  failures,
  label,
  required = true
) {
  if (!entry) {
    if (required) failures.push(label + ' file entry is required')
    return
  }
  if (typeof entry.path !== 'string' || !SHA256.test(entry.sha256 ?? '')) {
    failures.push(label + ' file entry is malformed')
    return
  }
  try {
    const current = await fileEntry(repositoryRoot, entry.path)
    check(current.sha256 === entry.sha256, failures, label + ' hash mismatch')
  } catch (error) {
    failures.push(
      label + ' cannot be read: ' + (error instanceof Error ? error.message : error)
    )
  }
}

function validateApproval(authorization, failures) {
  check(
    authorization?.mainnetApproved === true,
    failures,
    'mainnetApproved must be true'
  )
  check(
    typeof authorization?.changeTicket === 'string' &&
      authorization.changeTicket.length >= 8,
    failures,
    'authorization changeTicket is required'
  )
  const approvals = authorization?.approvals
  check(
    Array.isArray(approvals) && approvals.length >= 2,
    failures,
    'two operator approvals are required'
  )
  const approvalEntries = Array.isArray(approvals) ? approvals : []
  const names = new Set()
  for (const [index, approval] of approvalEntries.entries()) {
    check(
      approval?.decision === 'approve',
      failures,
      'approval ' + (index + 1) + ' must approve'
    )
    check(
      Boolean(approval?.name && approval?.role),
      failures,
      'approval ' + (index + 1) + ' identity is incomplete'
    )
    check(
      !Number.isNaN(Date.parse(approval?.approvedAt ?? '')),
      failures,
      'approval ' + (index + 1) + ' timestamp is invalid'
    )
    if (approval?.name) names.add(approval.name.toLowerCase())
  }
  check(
    names.size === approvalEntries.length,
    failures,
    'operator approvals must be from distinct people'
  )
}

export async function validatePhase3Manifest({
  repositoryRoot,
  manifest,
  mode = 'preparation',
  expectedHead,
  requireClean = true,
}) {
  const failures = []
  check(
    manifest?.schemaVersion === PHASE3_SCHEMA_VERSION,
    failures,
    'schemaVersion must be 1'
  )
  check(manifest?.kind === PHASE3_MANIFEST_KIND, failures, 'manifest kind is invalid')
  check(PHASE3_STAGES.has(manifest?.stage), failures, 'manifest stage is invalid')
  check(FULL_COMMIT.test(manifest?.release ?? ''), failures, 'release must be a full commit SHA')
  check(
    !Number.isNaN(Date.parse(manifest?.generatedAt ?? '')),
    failures,
    'generatedAt is invalid'
  )
  check(manifest?.chain?.id === PHASE3_CHAIN_ID, failures, 'chain id must be 4663')
  for (const name of ['maxBlockRange', 'rpcRetries', 'retryBaseMs']) {
    check(Number.isInteger(manifest?.reconciliation?.[name]) && manifest.reconciliation[name] > 0, failures, 'reconciliation ' + name + ' must be positive')
  }
  check(
    Number.isInteger(manifest?.chain?.confirmations) &&
      manifest.chain.confirmations > 0,
    failures,
    'confirmations must be positive'
  )
  validateConstructor(manifest?.contract?.constructor, failures)
  check(validAddress(manifest?.contract?.deployer), failures, 'deployment-only deployer must be a non-zero address')
  check(
    manifest?.contract?.source === manifest?.repository?.source?.path,
    failures,
    'contract source path differs from repository source entry'
  )
  check(
    manifest?.contract?.artifact === manifest?.repository?.contractArtifact?.path,
    failures,
    'contract artifact path differs from repository artifact entry'
  )

  const { integrity: _integrity, ...body } = manifest ?? {}
  check(
    manifest?.integrity?.algorithm === 'sha256',
    failures,
    'integrity algorithm must be sha256'
  )
  check(
    SHA256.test(manifest?.integrity?.manifestSha256 ?? '') &&
      manifest.integrity.manifestSha256 === sha256Canonical(body),
    failures,
    'manifest integrity hash mismatch'
  )

  if (expectedHead) {
    check(
      manifest?.release === expectedHead,
      failures,
      'manifest release differs from expected HEAD'
    )
  }
  if (requireClean) {
    check(
      manifest?.repository?.cleanAtPreparation === true,
      failures,
      'manifest was prepared from a dirty worktree'
    )
    check(gitStatus(repositoryRoot) === '', failures, 'current worktree is dirty')
  }

  await validateFileEntry(
    repositoryRoot,
    manifest?.repository?.source,
    failures,
    'contract source'
  )
  await validateFileEntry(
    repositoryRoot,
    manifest?.repository?.contractArtifact,
    failures,
    'contract artifact'
  )
  await validateFileEntry(
    repositoryRoot,
    manifest?.repository?.drizzleJournal,
    failures,
    'Drizzle journal'
  )
  await validateFileEntry(
    repositoryRoot,
    manifest?.policies?.authority,
    failures,
    'authority policy'
  )
  try {
    const authorityPolicy = await readJson(
      repositoryPath(repositoryRoot, manifest?.policies?.authority?.path)
    )
    const authorityPolicyResult = validateReleaseAuthorityPolicy(
      authorityPolicy,
      {
        stage: manifest?.stage,
        environment: manifest?.environment,
        changeTicket: manifest?.authorization?.changeTicket,
        constructor: manifest?.contract?.constructor,
      }
    )
    for (const failure of authorityPolicyResult.failures) {
      failures.push('authority policy: ' + failure)
    }
  } catch (error) {
    failures.push(
      'authority policy content is invalid: ' +
        (error instanceof Error ? error.message : String(error))
    )
  }
  await validateFileEntry(
    repositoryRoot,
    manifest?.policies?.canary,
    failures,
    'canary policy'
  )
  try {
    const canaryPolicy = await readJson(
      repositoryPath(repositoryRoot, manifest?.policies?.canary?.path)
    )
    const canaryPolicyResult = validateCanaryPolicy(
      canaryPolicy,
      manifest?.stage,
      manifest?.environment
    )
    for (const failure of canaryPolicyResult.failures) {
      failures.push('canary policy: ' + failure)
    }
  } catch (error) {
    failures.push(
      'canary policy content is invalid: ' +
        (error instanceof Error ? error.message : String(error))
    )
  }
  for (const [index, entry] of (manifest?.repository?.migrations ?? []).entries()) {
    await validateFileEntry(
      repositoryRoot,
      entry,
      failures,
      'migration ' + (index + 1)
    )
  }
  for (const [index, entry] of (manifest?.repository?.lockfiles ?? []).entries()) {
    await validateFileEntry(repositoryRoot, entry, failures, 'lockfile ' + (index + 1))
  }
  for (const [index, entry] of (manifest?.repository?.releaseTools ?? []).entries()) {
    await validateFileEntry(
      repositoryRoot,
      entry,
      failures,
      'release tool ' + (index + 1)
    )
  }

  try {
    const artifact = await readJson(
      repositoryPath(repositoryRoot, manifest?.contract?.artifact)
    )
    check(
      sha256Canonical(artifact.abi) === manifest?.repository?.contractAbiSha256,
      failures,
      'contract ABI hash mismatch'
    )
    const bytecodeHash = sha256Bytes(
      Buffer.from((artifact.bytecode ?? '').slice(2), 'hex')
    )
    check(
      bytecodeHash === manifest?.repository?.contractBytecodeSha256,
      failures,
      'contract bytecode hash mismatch'
    )
  } catch (error) {
    failures.push(
      'contract artifact content is invalid: ' +
        (error instanceof Error ? error.message : error)
    )
  }

  const expectedMigrations = await collectMigrations(repositoryRoot).catch((error) => {
    failures.push(error instanceof Error ? error.message : String(error))
    return []
  })
  check(
    JSON.stringify(manifest?.repository?.migrations ?? []) ===
      JSON.stringify(expectedMigrations),
    failures,
    'manifest migration set differs from repository journal'
  )
  const expectedLockfiles = await Promise.all(
    LOCKFILE_PATHS.map((entry) => fileEntry(repositoryRoot, entry))
  ).catch((error) => {
    failures.push(error instanceof Error ? error.message : String(error))
    return []
  })
  check(
    JSON.stringify(manifest?.repository?.lockfiles ?? []) ===
      JSON.stringify(expectedLockfiles),
    failures,
    'manifest lockfile set differs from required release lockfiles'
  )
  const expectedReleaseTools = await Promise.all(
    RELEASE_TOOL_PATHS.map((entry) => fileEntry(repositoryRoot, entry))
  ).catch((error) => {
    failures.push(error instanceof Error ? error.message : String(error))
    return []
  })
  check(
    JSON.stringify(manifest?.repository?.releaseTools ?? []) ===
      JSON.stringify(expectedReleaseTools),
    failures,
    'manifest release-tool set differs from required release tools'
  )

  if (mode === 'preparation') {
    check(
      manifest?.stage === 'preparation',
      failures,
      'preparation validation requires preparation stage'
    )
    check(
      manifest?.authorization?.mainnetApproved === false,
      failures,
      'preparation must not authorize mainnet'
    )
    check(
      manifest?.contract?.address === null,
      failures,
      'preparation contract address must be null'
    )
    check(
      manifest?.contract?.deploymentBlock === null,
      failures,
      'preparation deployment block must be null'
    )
    check(
      manifest?.contract?.deploymentTxHash === null,
      failures,
      'preparation transaction hash must be null'
    )
  } else if (mode === 'broadcast' || mode === 'deployed') {
    const expectedStage = mode === 'broadcast' ? 'broadcast-approved' : 'deployed'
    check(
      manifest?.stage === expectedStage,
      failures,
      mode + ' validation requires ' + expectedStage + ' stage'
    )
    check(
      /(^|-)mainnet($|-)|^production$/.test(manifest?.environment ?? ''),
      failures,
      'mainnet environment is required'
    )
    validateApproval(manifest?.authorization, failures)
    await validateFileEntry(
      repositoryRoot,
      manifest?.externalEvidence?.phase2,
      failures,
      'Phase 2 evidence'
    )
    await validateFileEntry(
      repositoryRoot,
      manifest?.externalEvidence?.independentReview,
      failures,
      'independent review'
    )
    for (const name of ['web', 'server']) {
      check(
        IMAGE_DIGEST.test(manifest?.images?.[name]?.digest ?? ''),
        failures,
        name + ' image digest is required'
      )
    }
    if (mode === 'broadcast') {
      check(
        manifest?.contract?.address === null,
        failures,
        'broadcast-approved contract address must be null'
      )
      check(
        manifest?.contract?.deploymentBlock === null,
        failures,
        'broadcast-approved deployment block must be null'
      )
      check(
        manifest?.contract?.deploymentTxHash === null,
        failures,
        'broadcast-approved transaction hash must be null'
      )
    } else {
      check(
        validAddress(manifest?.contract?.address),
        failures,
        'deployed contract address is invalid'
      )
      check(
        Number.isInteger(manifest?.contract?.deploymentBlock) &&
          manifest.contract.deploymentBlock > 0,
        failures,
        'deployment block is invalid'
      )
      check(
        TX_HASH.test(manifest?.contract?.deploymentTxHash ?? ''),
        failures,
        'deployment transaction hash is invalid'
      )
    }
  } else {
    failures.push('Unknown validation mode: ' + mode)
  }

  return { passed: failures.length === 0, failures }
}
