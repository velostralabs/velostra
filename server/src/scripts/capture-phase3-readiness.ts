import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getAddress, keccak256, toBytes, zeroAddress, type Address } from 'viem'
import { pool } from '../db/client.js'
import {
  getVelostraEscrowAddress,
  getVelostraPublicClient,
  velostraChainId,
  velostraEscrowAbi,
  velostraRpcTimeoutMs,
  velostraRpcUrls,
} from '../lib/gateway/onchain.js'
import { getRemoteSettlementSignerAddress } from '../lib/gateway/signer.js'
import { moneyToMinor } from '../lib/money.js'
import { collectOperationalSnapshot } from '../lib/observability/operations.js'
import { closeRedis } from '../lib/redis.js'
import { loadPhase3ReleaseBinding } from '../lib/phase3-canary.js'

interface ReleaseManifest {
  release: string
  stage: string
  environment: string
  integrity: { manifestSha256: string }
  repository: {
    drizzleJournal: { sha256: string }
    migrations: unknown[]
  }
  chain: { confirmations: number }
  contract: {
    address: Address
    deploymentBlock: number
    constructor: {
      settlementToken: Address
      platformFeeBps: number
      roles: {
        admin: Address
        settler: Address
        treasury: Address
        pauseGuardian: Address
      }
    }
  }
}

interface RpcProbe {
  ok: boolean
  latencyMs: number
  chainId?: number
  blockNumber?: bigint
  error?: string
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function evidenceFlag(name: string): boolean {
  return process.env[name] === 'verified'
}

async function rpcRequest(url: string, method: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(velostraRpcTimeoutMs),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: [],
    }),
  })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  const payload = (await response.json()) as {
    result?: string
    error?: { message?: string }
  }
  if (!payload.result || payload.error) {
    throw new Error(payload.error?.message ?? 'RPC result missing')
  }
  return payload.result
}

async function probeRpc(url: string): Promise<RpcProbe> {
  const started = performance.now()
  try {
    const [chainHex, blockHex] = await Promise.all([
      rpcRequest(url, 'eth_chainId'),
      rpcRequest(url, 'eth_blockNumber'),
    ])
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
      chainId: Number(BigInt(chainHex)),
      blockNumber: BigInt(blockHex),
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.name : 'UnknownError',
    }
  }
}

async function deploymentVerified(
  manifest: ReleaseManifest
): Promise<boolean> {
  const configured = process.env.PHASE3_DEPLOYMENT_VERIFICATION?.trim()
  if (!configured) return false
  try {
    const verification = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), configured), 'utf8')
    ) as {
      passed?: boolean
      release?: string
      manifestSha256?: string
      contractAddress?: string
      deploymentBlock?: number
    }
    return (
      verification.passed === true &&
      verification.release === manifest.release &&
      verification.manifestSha256 === manifest.integrity.manifestSha256 &&
      getAddress(verification.contractAddress as Address) ===
        getAddress(manifest.contract.address) &&
      verification.deploymentBlock === manifest.contract.deploymentBlock
    )
  } catch {
    return false
  }
}

function absoluteMinorDrift(values: Record<string, string>): bigint {
  return Object.values(values).reduce((total, value) => {
    const minor = moneyToMinor(value)
    return total + (minor < 0n ? -minor : minor)
  }, 0n)
}

export async function capturePhase3ReadinessSnapshot(): Promise<Record<string, unknown>> {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Phase 3 readiness snapshot requires NODE_ENV=production')
  }
  const environment = required('VELOSTRA_ENVIRONMENT')
  const release = required('VELOSTRA_RELEASE')
  const manifest = loadPhase3ReleaseBinding(
    'api',
    environment,
    release
  ) as ReleaseManifest | null
  if (!manifest || manifest.stage !== 'deployed') {
    throw new Error('Phase 3 readiness snapshot requires a deployed manifest')
  }

  const operational = await collectOperationalSnapshot()
  const primaryProbePromise = probeRpc(velostraRpcUrls[0])
  const fallbackProbePromise = Promise.all(
    velostraRpcUrls.slice(1).map((url) => probeRpc(url))
  )
  const [primaryProbe, fallbackProbes] = await Promise.all([
    primaryProbePromise,
    fallbackProbePromise,
  ])
  const allRpcProbes = [primaryProbe, ...fallbackProbes]
  const rpcAgreement =
    allRpcProbes.length >= 2 &&
    allRpcProbes.every(
      (probe) => probe.ok && probe.chainId === velostraChainId
    ) &&
    (() => {
      const blocks = allRpcProbes
        .map((probe) => probe.blockNumber)
        .filter((block): block is bigint => block !== undefined)
      return (
        blocks.length === allRpcProbes.length &&
        blocks.reduce((max, block) => (block > max ? block : max), blocks[0]) -
          blocks.reduce((min, block) => (block < min ? block : min), blocks[0]) <=
          BigInt(manifest.chain.confirmations)
      )
    })()

  const client = getVelostraPublicClient()
  const escrowAddress = getVelostraEscrowAddress()
  const expected = manifest.contract.constructor
  const roles = expected.roles
  const roleIds = {
    settler: keccak256(toBytes('SETTLER_ROLE')),
    treasury: keccak256(toBytes('TREASURY_ROLE')),
    pauseGuardian: keccak256(toBytes('PAUSER_ROLE')),
  } as const
  const [
    settlementToken,
    platformFeeBps,
    paused,
    successorEscrow,
    defaultAdmin,
    settlerRole,
    treasuryRole,
    pauseGuardianRole,
    migrationRows,
    criticalAlertRows,
    verifiedDeployment,
  ] = await Promise.all([
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'settlementToken',
    }),
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'platformFeeBps',
    }),
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'paused',
    }),
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'successorEscrow',
    }),
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'defaultAdmin',
    }),
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'hasRole',
      args: [roleIds.settler, roles.settler],
    }),
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'hasRole',
      args: [roleIds.treasury, roles.treasury],
    }),
    client.readContract({
      address: escrowAddress,
      abi: velostraEscrowAbi,
      functionName: 'hasRole',
      args: [roleIds.pauseGuardian, roles.pauseGuardian],
    }),
    pool.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations'
    ),
    pool.query<{ count: number }>(
      "select count(*)::int as count from operational_alerts where severity = 'critical' and status = 'OPEN'"
    ),
    deploymentVerified(manifest),
  ])

  const latestBlock = primaryProbe.blockNumber
  const safeHead =
    latestBlock === undefined
      ? undefined
      : latestBlock > BigInt(manifest.chain.confirmations)
        ? latestBlock - BigInt(manifest.chain.confirmations)
        : 0n
  const cursor = operational.chain.cursorBlock
  const lag =
    safeHead !== undefined && cursor !== undefined && safeHead > cursor
      ? safeHead - cursor
      : 0n
  const fallbackOk =
    fallbackProbes.length > 0 && fallbackProbes.every((probe) => probe.ok)
  const signerAddress = getRemoteSettlementSignerAddress()

  return {
    schemaVersion: 1,
    kind: 'velostra-phase3-operational-snapshot',
    release: manifest.release,
    environment: manifest.environment,
    sourceManifestSha256: manifest.integrity.manifestSha256,
    capturedAt: new Date().toISOString(),
    dependencies: {
      postgres: operational.dependencies.postgres,
      redis: operational.dependencies.redis,
      primaryRpc: primaryProbe,
      fallbackRpc: {
        ok: fallbackOk,
        latencyMs:
          fallbackProbes.length > 0
            ? Math.max(...fallbackProbes.map((probe) => probe.latencyMs))
            : 0,
        ...(!fallbackOk ? { error: 'FallbackRpcUnavailable' } : {}),
      },
      signer: {
        ok:
          operational.signer.address !== undefined &&
          operational.signer.balanceWei !== undefined,
        latencyMs: operational.dependencies.signer?.latencyMs ?? 0,
      },
      contract: operational.dependencies.contract,
      operationalState: operational.dependencies.operational_state,
    },
    chain: {
      chainId: primaryProbe.chainId,
      rpcAgreement,
      latestBlock,
      safeHeadBlock: safeHead,
      cursorBlock: cursor,
      lagBlocks: lag,
      pendingEvents: operational.chain.pendingEvents,
    },
    contract: {
      address: escrowAddress,
      deploymentVerified: verifiedDeployment,
      deploymentBlock: manifest.contract.deploymentBlock,
      settlementToken,
      platformFeeBps: Number(platformFeeBps),
      paused,
      solvent: operational.chain.solvent,
      successorEscrow:
        getAddress(successorEscrow) === zeroAddress ? null : successorEscrow,
      roles: {
        admin:
          getAddress(defaultAdmin) === getAddress(roles.admin)
            ? roles.admin
            : null,
        settler: settlerRole ? roles.settler : null,
        treasury: treasuryRole ? roles.treasury : null,
        pauseGuardian: pauseGuardianRole ? roles.pauseGuardian : null,
      },
    },
    database: {
      journalSha256: manifest.repository.drizzleJournal.sha256,
      appliedMigrations: migrationRows.rows[0]?.count ?? 0,
      managedPitrVerified: evidenceFlag('PHASE3_MANAGED_PITR_VERIFIED'),
    },
    images: {
      verified: evidenceFlag('PHASE3_IMAGES_VERIFIED'),
    },
    paidWritesDisabled: evidenceFlag('PHASE3_PAID_WRITES_DISABLED'),
    signer: {
      address: signerAddress,
      balanceWei: operational.signer.balanceWei,
    },
    worker: operational.worker,
    backup: operational.backup,
    outbox: {
      byStatus: operational.outbox.byStatus,
      oldestRecoverableAgeSeconds:
        operational.outbox.oldestRecoverableAgeSeconds ?? null,
    },
    drift: {
      exceedsThreshold: operational.drift.exceedsThreshold,
      unexplainedMinor: absoluteMinorDrift(operational.drift.values),
    },
    alerts: {
      unacknowledgedCritical: criticalAlertRows.rows[0]?.count ?? 0,
      operatorDeliveryVerified: evidenceFlag(
        'PHASE3_ALERT_DELIVERY_VERIFIED'
      ),
    },
  }
}

async function main(): Promise<void> {
  const snapshot = await capturePhase3ReadinessSnapshot()
  const json =
    JSON.stringify(
      snapshot,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    ) + '\n'
  const outputPath = process.env.PHASE3_READINESS_SNAPSHOT_OUTPUT?.trim()
  if (outputPath) {
    const resolved = path.resolve(process.cwd(), outputPath)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, json)
  }
  process.stdout.write(json)
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === invokedPath) {
  main()
    .catch((error) => {
      console.error(
        'Phase 3 readiness snapshot failed:',
        error instanceof Error ? error.message : error
      )
      process.exitCode = 1
    })
    .finally(async () => {
      await closeRedis().catch(() => undefined)
      await pool.end().catch(() => undefined)
    })
}
