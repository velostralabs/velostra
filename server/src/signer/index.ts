import { GoogleCloudKmsDigestSigner } from './kms.js'
import {
  createConfiguredSignerRpc,
  createRestrictedSignerApp,
  loadRestrictedSignerConfig,
  RestrictedSettlementSigner,
} from './service.js'
import { RedisSignerIntentStore } from './store.js'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required for the restricted signer')
  return value
}

async function main(): Promise<void> {
  if (required('VELOSTRA_SECRET_PROVIDER') !== 'managed-injection') {
    throw new Error('Restricted signer requires managed secret injection')
  }
  const config = loadRestrictedSignerConfig()
  const store = new RedisSignerIntentStore(required('REDIS_URL'), {
    connectTimeoutMs: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 2_000),
  })
  const kms = new GoogleCloudKmsDigestSigner({
    keyVersion: required('GOOGLE_CLOUD_KMS_KEY_VERSION'),
    expectedRegion: config.region,
  })
  const service = new RestrictedSettlementSigner(
    config,
    kms,
    store,
    createConfiguredSignerRpc(config)
  )
  await service.health()

  const port = Number(process.env.PORT ?? 8080)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('PORT must be a valid TCP port')
  }
  const server = createRestrictedSignerApp(service).listen(port, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'restricted_signer_started',
        port,
        environment: config.environment,
        region: config.region,
        chain_id: config.chainId,
        signer_address: config.signerAddress,
      })
    )
  })

  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ level: 'info', event: 'restricted_signer_stopping', signal }))
    server.close()
    await store.close()
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'fatal',
      event: 'restricted_signer_start_failed',
      message: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
})