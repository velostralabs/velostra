import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import type { Address, Hash, Hex } from 'viem'

export interface SignerIntent {
  schemaVersion: 1
  fingerprint: Hash
  rawTransaction: Hex
  transactionHash: Hash
  signerAddress: Address
  nonce: string
  createdAt: string
}

export interface SignerIntentStore {
  get(idempotencyKey: Hash): Promise<SignerIntent | undefined>
  putIfAbsent(
    idempotencyKey: Hash,
    intent: SignerIntent,
    ttlSeconds: number
  ): Promise<boolean>
  acquireNonceLock(ttlMs: number): Promise<string | undefined>
  releaseNonceLock(token: string): Promise<void>
  ping(): Promise<void>
  close(): Promise<void>
}

export class RedisSignerIntentStore implements SignerIntentStore {
  private readonly redis: Redis
  private readonly prefix: string

  constructor(redisUrl: string, options: { prefix?: string; connectTimeoutMs?: number } = {}) {
    const parsed = new URL(redisUrl)
    if (parsed.protocol !== 'rediss:') {
      throw new Error('Signer REDIS_URL must use rediss TLS')
    }
    this.prefix = options.prefix ?? 'velostra:restricted-signer'
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: options.connectTimeoutMs ?? 2_000,
      commandTimeout: options.connectTimeoutMs ?? 2_000,
      tls: {},
    })
  }

  private intentKey(idempotencyKey: Hash): string {
    return this.prefix + ':intent:' + idempotencyKey.toLowerCase()
  }

  private lockKey(): string {
    return this.prefix + ':nonce-lock'
  }

  private async connected(): Promise<Redis> {
    if (this.redis.status === 'wait') await this.redis.connect()
    return this.redis
  }

  async get(idempotencyKey: Hash): Promise<SignerIntent | undefined> {
    const value = await (await this.connected()).get(this.intentKey(idempotencyKey))
    if (!value) return undefined
    const parsed = JSON.parse(value) as SignerIntent
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.fingerprint !== 'string' ||
      typeof parsed.rawTransaction !== 'string' ||
      typeof parsed.transactionHash !== 'string' ||
      typeof parsed.signerAddress !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.createdAt !== 'string'
    ) {
      throw new Error('Stored signer intent is malformed')
    }
    return parsed
  }

  async putIfAbsent(
    idempotencyKey: Hash,
    intent: SignerIntent,
    ttlSeconds: number
  ): Promise<boolean> {
    const result = await (await this.connected()).set(
      this.intentKey(idempotencyKey),
      JSON.stringify(intent),
      'EX',
      ttlSeconds,
      'NX'
    )
    return result === 'OK'
  }

  async acquireNonceLock(ttlMs: number): Promise<string | undefined> {
    const token = randomUUID()
    const result = await (await this.connected()).set(
      this.lockKey(),
      token,
      'PX',
      ttlMs,
      'NX'
    )
    return result === 'OK' ? token : undefined
  }

  async releaseNonceLock(token: string): Promise<void> {
    const script =
      "if redis.call('get', KEYS[1]) == ARGV[1] then " +
      "return redis.call('del', KEYS[1]) else return 0 end"
    await (await this.connected()).eval(script, 1, this.lockKey(), token)
  }

  async ping(): Promise<void> {
    const result = await (await this.connected()).ping()
    if (result !== 'PONG') throw new Error('Signer Redis ping failed')
  }

  async close(): Promise<void> {
    if (this.redis.status === 'end') return
    await this.redis.quit().catch(() => this.redis.disconnect())
  }
}