import Redis from 'ioredis'
import { DependencyUnavailableError } from './errors.js'

let redis: Redis | null = null

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 2_000),
      retryStrategy: () => null,
    })
    redis.on('error', (error) => {
      console.error('[redis] connection error:', error.message)
    })
  }
  return redis
}

export async function ensureRedisConnected(): Promise<Redis> {
  const client = getRedis()
  if (client.status === 'wait') await client.connect()
  if (client.status !== 'ready' && client.status !== 'connecting' && client.status !== 'connect') {
    throw new DependencyUnavailableError('Redis')
  }
  return client
}

export function redisFailureMode(): 'open' | 'closed' {
  const configured = process.env.REDIS_FAILURE_MODE
  if (configured === 'open' || configured === 'closed') return configured
  return process.env.NODE_ENV === 'production' ? 'closed' : 'open'
}

export function failForRedisOutage(cause?: unknown): never {
  throw new DependencyUnavailableError('Redis', cause)
}

export async function closeRedis(): Promise<void> {
  if (!redis) return
  const client = redis
  redis = null
  if (client.status === 'ready') await client.quit()
  else client.disconnect()
}