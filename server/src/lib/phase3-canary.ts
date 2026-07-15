import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

const SHA256 = /^[a-f0-9]{64}$/
const FULL_COMMIT = /^[a-f0-9]{40}$/i
const ADDRESS = /^0x[a-f0-9]{40}$/i
const MONEY = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/

export type Phase3PaidWriteMode = 'disabled' | 'canary' | 'public'

interface Phase3CanaryPolicy {
  schemaVersion: number
  kind: string
  environment: string
  enabled: boolean
  allowlists: {
    wallets: string[]
    agents: string[]
    builders: string[]
  }
  limits: {
    durationSeconds: number
    maxCalls: number
    maxGrossPerCallMinor: string
    maxGrossPerWalletMinor: string
    maxGrossTotalMinor: string
  }
  thresholds: {
    maxUnexplainedDriftMinor: string
    maxCursorLagBlocks: number
    maxRecoverableOutboxAgeSeconds: number
    maxErrorRate: number
    maxWorkerAgeSeconds: number
    maxBackupAgeSeconds: number
    minSignerBalanceWei: string
    maxUnacknowledgedCriticalAlerts: number
    maxPendingChainEvents: number
  }
  requiredFlow: string[]
  stopActions: string[]
  rollback: {
    destructiveDatabaseRollbackAllowed: boolean
    strategy: string
    preserveClaims: boolean
    preserveReconciliation: boolean
  }
}

interface Phase3ReleaseManifest {
  schemaVersion: number
  kind: string
  stage: string
  environment: string
  release: string
  chain: { id: number }
  policies: {
    canary: { path: string; sha256: string }
  }
  integrity: { algorithm: string; manifestSha256: string }
}

export interface Phase3CanaryAdmission {
  mode: 'canary'
  release: string
  manifestSha256: string
  policySha256: string
  walletAddress: string
  agentId: string
  builderAddress: string
  grossMinor: bigint
  policy: Phase3CanaryPolicy
}

export interface Phase3PublicAdmission {
  mode: 'public'
}

export type Phase3PaidCallAdmission = Phase3CanaryAdmission | Phase3PublicAdmission

export class Phase3AdmissionError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(code: string, message: string, statusCode: number) {
    super(message)
    this.name = 'Phase3AdmissionError'
    this.code = code
    this.statusCode = statusCode
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('Production ' + name + ' is required')
  return value
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(input).sort()) {
      if (input[key] === undefined) throw new TypeError('Canonical JSON rejects undefined at ' + key)
      result[key] = canonicalValue(input[key])
    }
    return result
  }
  throw new TypeError('Canonical JSON rejects ' + typeof value)
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value), null, 2) + '\n'
}

function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function parseJsonFile(path: string, label: string): { raw: Buffer; value: unknown } {
  try {
    const raw = readFileSync(path)
    return { raw, value: JSON.parse(raw.toString('utf8')) }
  } catch (error) {
    throw new Error(
      'Production ' + label + ' cannot be read: ' +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

function mainnetLike(environment: string): boolean {
  return environment === 'production' || /(^|-)mainnet($|-)/.test(environment)
}

function assertSha(name: string, value: string): string {
  if (!SHA256.test(value)) throw new Error('Production ' + name + ' must be a lowercase SHA-256')
  return value
}

function asPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error('Phase 3 canary policy ' + label + ' must be a positive integer')
  }
  return Number(value)
}

function asPositiveMinor(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error('Phase 3 canary policy ' + label + ' must be a positive minor-unit integer')
  }
  return BigInt(value)
}

export function moneyToMinor(value: string): bigint {
  const match = MONEY.exec(value)
  if (!match) throw new Error('Paid-call gross amount must have at most six decimals')
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'))
}

export function phase3PaidWriteMode(environment = process.env.VELOSTRA_ENVIRONMENT ?? 'local'): Phase3PaidWriteMode {
  const configured = process.env.PHASE3_PAID_WRITES_MODE?.trim()
  const mode = configured || (mainnetLike(environment) ? 'disabled' : 'public')
  if (mode !== 'disabled' && mode !== 'canary' && mode !== 'public') {
    throw new Error('Production PHASE3_PAID_WRITES_MODE must be disabled, canary, or public')
  }
  return mode
}

export function loadPhase3ReleaseBinding(
  role: string,
  environment: string,
  release: string
): Phase3ReleaseManifest | null {
  if (!mainnetLike(environment) && !process.env.PHASE3_RELEASE_MANIFEST?.trim()) return null

  const path = required('PHASE3_RELEASE_MANIFEST')
  const expectedHash = assertSha(
    'PHASE3_RELEASE_MANIFEST_SHA256',
    required('PHASE3_RELEASE_MANIFEST_SHA256')
  )
  const { value } = parseJsonFile(path, 'PHASE3_RELEASE_MANIFEST')
  const manifest = value as Phase3ReleaseManifest
  const { integrity: _integrity, ...body } = manifest
  const actualHash = sha256(canonicalJson(body))

  if (manifest.kind !== 'velostra-phase3-release' || manifest.schemaVersion !== 1) {
    throw new Error('Production Phase 3 release manifest identity is invalid')
  }
  if (manifest.integrity?.algorithm !== 'sha256' ||
      manifest.integrity?.manifestSha256 !== actualHash ||
      actualHash !== expectedHash) {
    throw new Error('Production Phase 3 release manifest hash mismatch')
  }
  if (!FULL_COMMIT.test(manifest.release) || manifest.release.toLowerCase() !== release.toLowerCase()) {
    throw new Error('Production Phase 3 release manifest commit differs from VELOSTRA_RELEASE')
  }
  if (manifest.environment !== environment) {
    throw new Error('Production Phase 3 release manifest environment differs')
  }
  if (manifest.chain?.id !== 4663) {
    throw new Error('Production Phase 3 release manifest chain must be 4663')
  }
  const validStages = role === 'migration'
    ? new Set(['broadcast-approved', 'deployed'])
    : new Set(['deployed'])
  if (!validStages.has(manifest.stage)) {
    throw new Error('Production Phase 3 release manifest stage is not valid for ' + role)
  }
  return manifest
}

function validateCanaryPolicy(
  value: unknown,
  manifest: Phase3ReleaseManifest,
  expectedHash: string,
  raw: Buffer
): Phase3CanaryPolicy {
  const policy = value as Phase3CanaryPolicy
  if (
    policy.kind !== 'velostra-phase3-canary-policy' ||
    policy.schemaVersion !== 1 ||
    policy.enabled !== true
  ) {
    throw new Error('Production Phase 3 canary policy must be an enabled version 1 policy')
  }
  if (policy.environment !== manifest.environment) {
    throw new Error('Production Phase 3 canary policy environment differs from manifest')
  }
  if (sha256(raw) !== expectedHash || manifest.policies?.canary?.sha256 !== expectedHash) {
    throw new Error('Production Phase 3 canary policy hash differs from immutable manifest')
  }
  for (const name of ['wallets', 'agents', 'builders'] as const) {
    const entries = policy.allowlists?.[name]
    if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new Error('Production Phase 3 canary ' + name + ' allowlist is empty or invalid')
    }
  }
  if (policy.allowlists.wallets.some((entry) => !ADDRESS.test(entry) || /^0x0{40}$/i.test(entry)) ||
      policy.allowlists.builders.some((entry) => !ADDRESS.test(entry) || /^0x0{40}$/i.test(entry))) {
    throw new Error('Production Phase 3 canary address allowlist is invalid')
  }
  asPositiveInteger(policy.limits?.durationSeconds, 'durationSeconds')
  asPositiveInteger(policy.limits?.maxCalls, 'maxCalls')
  const perCall = asPositiveMinor(policy.limits?.maxGrossPerCallMinor, 'maxGrossPerCallMinor')
  const perWallet = asPositiveMinor(policy.limits?.maxGrossPerWalletMinor, 'maxGrossPerWalletMinor')
  const total = asPositiveMinor(policy.limits?.maxGrossTotalMinor, 'maxGrossTotalMinor')
  if (perCall > perWallet || perWallet > total) {
    throw new Error('Production Phase 3 canary monetary limits are not monotonic')
  }
  const thresholds = policy.thresholds
  if (
    thresholds?.maxUnexplainedDriftMinor !== '0' ||
    !Number.isInteger(thresholds?.maxCursorLagBlocks) ||
    thresholds.maxCursorLagBlocks < 0 ||
    !Number.isInteger(thresholds?.maxRecoverableOutboxAgeSeconds) ||
    thresholds.maxRecoverableOutboxAgeSeconds <= 0 ||
    typeof thresholds?.maxErrorRate !== 'number' ||
    thresholds.maxErrorRate < 0 ||
    thresholds.maxErrorRate > 1 ||
    !Number.isInteger(thresholds?.maxWorkerAgeSeconds) ||
    thresholds.maxWorkerAgeSeconds <= 0 ||
    !Number.isInteger(thresholds?.maxBackupAgeSeconds) ||
    thresholds.maxBackupAgeSeconds <= 0 ||
    !/^\d+$/.test(thresholds?.minSignerBalanceWei ?? '') ||
    thresholds?.maxUnacknowledgedCriticalAlerts !== 0 ||
    thresholds?.maxPendingChainEvents !== 0
  ) {
    throw new Error('Production Phase 3 canary safety thresholds are invalid')
  }
  for (const flow of [
    'deposit',
    'paid-call',
    'earnings-credit',
    'reconciliation',
    'builder-claim',
    'platform-revenue',
    'zero-drift',
  ]) {
    if (!policy.requiredFlow?.includes(flow)) {
      throw new Error('Production Phase 3 canary required flow is missing: ' + flow)
    }
  }
  if (
    policy.rollback?.destructiveDatabaseRollbackAllowed !== false ||
    policy.rollback?.strategy !== 'pause-new-risk-and-forward-repair' ||
    policy.rollback?.preserveClaims !== true ||
    policy.rollback?.preserveReconciliation !== true
  ) {
    throw new Error('Production Phase 3 canary rollback must preserve claims and reconciliation')
  }
  for (const action of [
    'disable-paid-writes',
    'preserve-builder-claims',
    'keep-reconciliation-running',
    'page-incident-owner',
  ]) {
    if (!policy.stopActions?.includes(action)) {
      throw new Error('Production Phase 3 canary stop actions omit ' + action)
    }
  }
  return policy
}

function assertCanaryWindow(policy: Phase3CanaryPolicy, now = Date.now()): void {
  const startedAt = Date.parse(required('PHASE3_CANARY_STARTED_AT'))
  if (!Number.isFinite(startedAt) || startedAt > now) {
    throw new Error('Production PHASE3_CANARY_STARTED_AT must be a started RFC3339 window')
  }
  if (now - startedAt > policy.limits.durationSeconds * 1_000) {
    throw new Error('Production Phase 3 canary window has expired')
  }
}

function loadCanaryPolicy(manifest: Phase3ReleaseManifest): {
  policy: Phase3CanaryPolicy
  policySha256: string
} {
  const policySha256 = assertSha(
    'PHASE3_CANARY_POLICY_SHA256',
    required('PHASE3_CANARY_POLICY_SHA256')
  )
  const { raw, value } = parseJsonFile(
    required('PHASE3_CANARY_POLICY_PATH'),
    'PHASE3_CANARY_POLICY_PATH'
  )
  return {
    policy: validateCanaryPolicy(value, manifest, policySha256, raw),
    policySha256,
  }
}

function assertCanaryExit(manifest: Phase3ReleaseManifest): void {
  if (process.env.PHASE3_CANARY_EXIT_APPROVAL !== 'explicitly-approved') {
    throw new Error('Production public paid writes require explicit Phase 3 canary exit approval')
  }
  const expected = assertSha(
    'PHASE3_CANARY_EXIT_EVIDENCE_SHA256',
    required('PHASE3_CANARY_EXIT_EVIDENCE_SHA256')
  )
  const { raw, value } = parseJsonFile(
    required('PHASE3_CANARY_EXIT_EVIDENCE'),
    'PHASE3_CANARY_EXIT_EVIDENCE'
  )
  const evidence = value as {
    kind?: string
    decision?: string
    release?: string
    sourceManifestSha256?: string
  }
  if (sha256(raw) !== expected ||
      evidence.kind !== 'velostra-phase3-canary-decision' ||
      evidence.decision !== 'PASS_AWAITING_OPERATOR' ||
      evidence.release?.toLowerCase() !== manifest.release.toLowerCase() ||
      evidence.sourceManifestSha256 !== manifest.integrity.manifestSha256) {
    throw new Error('Production Phase 3 canary exit evidence is invalid or belongs to another release')
  }
}

export function assertPhase3RuntimeConfiguration(
  role: string,
  environment: string,
  release: string
): void {
  if (!mainnetLike(environment)) return
  if (process.env.PHASE3_MAINNET_STARTUP_APPROVAL !== 'explicitly-approved') {
    throw new Error('Phase 3 blocks production/mainnet startup without explicit release approval')
  }
  const manifest = loadPhase3ReleaseBinding(role, environment, release)
  if (!manifest) throw new Error('Production Phase 3 release manifest is required')
  if (role !== 'api') return

  const mode = phase3PaidWriteMode(environment)
  if (mode === 'canary') {
    const { policy } = loadCanaryPolicy(manifest)
    assertCanaryWindow(policy)
  }
  if (mode === 'public') assertCanaryExit(manifest)
}

export function resolvePhase3PaidCallAdmission(input: {
  walletAddress: string
  agentId: string
  builderAddress: string
  gross: string
}): Phase3PaidCallAdmission {
  const environment = process.env.VELOSTRA_ENVIRONMENT ?? 'local'
  const mode = phase3PaidWriteMode(environment)
  if (mode === 'disabled') {
    throw new Phase3AdmissionError(
      'PHASE3_PAID_WRITES_DISABLED',
      'Paid calls are temporarily disabled while Phase 3 safety gates are evaluated',
      503
    )
  }
  if (mode === 'public') return { mode: 'public' }

  try {
    const release = required('VELOSTRA_RELEASE')
    const manifest = loadPhase3ReleaseBinding('api', environment, release)
    if (!manifest) throw new Error('Phase 3 canary requires a release manifest')
    const { policy, policySha256 } = loadCanaryPolicy(manifest)
    assertCanaryWindow(policy)
    const wallet = input.walletAddress.toLowerCase()
    const builder = input.builderAddress.toLowerCase()
    const walletAllowed = policy.allowlists.wallets.some((value) => value.toLowerCase() === wallet)
    const builderAllowed = policy.allowlists.builders.some((value) => value.toLowerCase() === builder)
    if (!walletAllowed || !policy.allowlists.agents.includes(input.agentId) || !builderAllowed) {
      throw new Phase3AdmissionError(
        'PHASE3_CANARY_SUBJECT_NOT_ALLOWED',
        'This paid call is outside the active Phase 3 canary allowlist',
        403
      )
    }
    const grossMinor = moneyToMinor(input.gross)
    if (grossMinor > asPositiveMinor(policy.limits.maxGrossPerCallMinor, 'maxGrossPerCallMinor')) {
      throw new Phase3AdmissionError(
        'PHASE3_CANARY_PER_CALL_CAP',
        'This paid call exceeds the active Phase 3 canary per-call cap',
        429
      )
    }
    return {
      mode: 'canary',
      release,
      manifestSha256: manifest.integrity.manifestSha256,
      policySha256,
      walletAddress: wallet,
      agentId: input.agentId,
      builderAddress: builder,
      grossMinor,
      policy,
    }
  } catch (error) {
    if (error instanceof Phase3AdmissionError) throw error
    console.error('[phase3-canary] paid-call admission configuration failed closed', error)
    throw new Phase3AdmissionError(
      'PHASE3_CANARY_CONFIGURATION_INVALID',
      'Paid calls are unavailable because the active Phase 3 canary binding is invalid',
      503
    )
  }
}

export function assertPhase3CanaryCapacity(
  admission: Phase3CanaryAdmission,
  usage: {
    callCount: number
    grossTotalMinor: bigint
    grossWalletMinor: bigint
  }
): void {
  const limits = admission.policy.limits
  if (!Number.isInteger(usage.callCount) || usage.callCount < 0 ||
      usage.grossTotalMinor < 0n || usage.grossWalletMinor < 0n) {
    throw new Phase3AdmissionError(
      'PHASE3_CANARY_USAGE_INVALID',
      'Phase 3 canary usage could not be evaluated safely',
      503
    )
  }
  if (usage.callCount + 1 > limits.maxCalls) {
    throw new Phase3AdmissionError(
      'PHASE3_CANARY_CALL_CAP',
      'The active Phase 3 canary call cap has been reached',
      429
    )
  }
  if (usage.grossTotalMinor + admission.grossMinor > BigInt(limits.maxGrossTotalMinor)) {
    throw new Phase3AdmissionError(
      'PHASE3_CANARY_TOTAL_CAP',
      'The active Phase 3 canary total exposure cap has been reached',
      429
    )
  }
  if (usage.grossWalletMinor + admission.grossMinor > BigInt(limits.maxGrossPerWalletMinor)) {
    throw new Phase3AdmissionError(
      'PHASE3_CANARY_WALLET_CAP',
      'This wallet has reached the active Phase 3 canary exposure cap',
      429
    )
  }
}
