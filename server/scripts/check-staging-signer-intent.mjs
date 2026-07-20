import { Pool } from 'pg'
import Redis from 'ioredis'
import { createPublicClient, decodeFunctionData, defineChain, getAddress, http, isAddress, keccak256, parseTransaction, recoverTransactionAddress } from 'viem'

const CHAIN_ID = 46630
const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

if (
  required('VELOSTRA_SIGNER_INTENT_APPROVAL') !== 'read-only-staging-signer-intent' ||
  required('VELOSTRA_ENVIRONMENT') !== 'staging' ||
  required('ROBINHOOD_CHAIN_ID') !== String(CHAIN_ID) ||
  required('PHASE3_PAID_WRITES_MODE') !== 'disabled'
) throw new Error('Signer intent diagnostics are locked to write-disabled staging')

const escrowAddress = required('VELOSTRA_ESCROW_ADDRESS')
const signerAddress = required('SETTLEMENT_SIGNER_ADDRESS')
if (!isAddress(escrowAddress) || !isAddress(signerAddress)) throw new Error('Signer intent addresses are malformed')
const rpcUrl = required('ROBINHOOD_RPC_URL')
const chain = defineChain({ id: CHAIN_ID, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } })
const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 10_000, retryCount: 2 }) })
const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 })
const redisUrl = required('REDIS_URL')
if (new URL(redisUrl).protocol !== 'rediss:') throw new Error('Signer diagnostics require TLS Redis')
const redis = new Redis(redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2_000,
  commandTimeout: 2_000,
})
const settlementAbi = [{ type: 'function', name: 'creditBuilderEarnings', stateMutability: 'nonpayable', inputs: [{ name: 'builder', type: 'address' }, { name: 'grossAmount', type: 'uint256' }, { name: 'callId', type: 'bytes32' }], outputs: [] }]

try {
  const result = await pool.query(
    `select sa.onchain_call_id, sa.builder_address, sa.gross_amount::text
       from settlement_attempts sa
       join agent_calls ac on ac.id = sa.agent_call_id
       join agents a on a.id = ac.agent_id
      where a.slug = 'phase2-synthetic-agent'
        and ac.input = 'Phase 2 isolated-staging wallet verification'
        and sa.status = 'AMBIGUOUS'
      order by sa.created_at desc limit 1`
  )
  const row = result.rows[0]
  if (redis.status === 'wait') await redis.connect()
  const stored = row
    ? await redis.get('velostra:restricted-signer:intent:' + row.onchain_call_id.toLowerCase())
    : null
  const intent = stored
    ? (typeof stored === 'string' ? JSON.parse(stored) : stored)
    : undefined
  const intentShapeValid =
    typeof intent?.rawTransaction === 'string' &&
    typeof intent?.transactionHash === 'string' &&
    typeof intent?.signerAddress === 'string' &&
    typeof intent?.nonce === 'string'
  if (!row || !intent) {
    console.info(JSON.stringify({ callFound: Boolean(row), intentFound: Boolean(intent) }))
  } else if (!intentShapeValid) {
    console.info(JSON.stringify({
      callFound: true,
      intentFound: true,
      intentShapeValid: false,
      hasRawTransaction: typeof intent.rawTransaction === 'string',
      hasTransactionHash: typeof intent.transactionHash === 'string',
      hasSignerAddress: typeof intent.signerAddress === 'string',
      hasNonce: typeof intent.nonce === 'string',
    }))
  } else {
    const parsed = parseTransaction(intent.rawTransaction)
    const recovered = await recoverTransactionAddress({ serializedTransaction: intent.rawTransaction })
    const [knownTransaction, latestNonce, pendingNonce, balance, latestBlock] = await Promise.all([
      publicClient.getTransaction({ hash: intent.transactionHash }).catch(() => undefined),
      publicClient.getTransactionCount({ address: getAddress(signerAddress), blockTag: 'latest' }),
      publicClient.getTransactionCount({ address: getAddress(signerAddress), blockTag: 'pending' }),
      publicClient.getBalance({ address: getAddress(signerAddress) }),
      publicClient.getBlock({ blockTag: 'latest' }),
    ])
    let decoded
    try { decoded = decodeFunctionData({ abi: settlementAbi, data: parsed.data }) } catch { decoded = undefined }
    const args = decoded?.args ?? []
    const maxFeePerGas = parsed.maxFeePerGas ?? 0n
    const gas = parsed.gas ?? 0n
    console.info(JSON.stringify({
      callFound: true,
      intentFound: true,
      intentShapeValid: true,
      storedHashValid: keccak256(intent.rawTransaction) === intent.transactionHash,
      recoveredSignerMatches: getAddress(recovered) === getAddress(signerAddress),
      storedSignerMatches: getAddress(intent.signerAddress) === getAddress(signerAddress),
      chainIdMatches: Number(parsed.chainId) === CHAIN_ID,
      destinationMatches: getAddress(parsed.to) === getAddress(escrowAddress),
      transactionTypeEip1559: parsed.type === 'eip1559',
      calldataMethodMatches: decoded?.functionName === 'creditBuilderEarnings',
      calldataBuilderMatches: args[0] !== undefined && getAddress(args[0]) === getAddress(row.builder_address),
      calldataGrossMatches: args[1] !== undefined && args[1] === BigInt(Math.round(Number(row.gross_amount) * 1_000_000)),
      calldataCorrelationMatches: args[2] !== undefined && args[2].toLowerCase() === row.onchain_call_id.toLowerCase(),
      alreadyKnownOnPrimary: Boolean(knownTransaction),
      nonceAlreadyConsumed: parsed.nonce < latestNonce,
      nonceMatchesLatest: parsed.nonce === latestNonce,
      nonceAheadOfPending: parsed.nonce > pendingNonce,
      signerFundedForMaxCost: balance >= gas * maxFeePerGas,
      feeCoversCurrentBase: maxFeePerGas >= (latestBlock.baseFeePerGas ?? 0n),
      gasLimitPresent: gas > 0n,
    }))
  }
}
finally {
  if (redis.status !== 'end') await redis.quit().catch(() => redis.disconnect())
  await pool.end()
}
