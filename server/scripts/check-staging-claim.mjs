import { Pool } from 'pg'
import { createPublicClient, decodeEventLog, getAddress, http, isAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const CHAIN_ID = 46630
const CLAIM_AMOUNT = 1_000_000n
const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

if (
  required('VELOSTRA_CLAIM_STATUS_APPROVAL') !== 'read-only-staging-claim-status' ||
  required('VELOSTRA_ENVIRONMENT') !== 'staging' ||
  required('PHASE3_PAID_WRITES_MODE') !== 'disabled' ||
  Number(required('ROBINHOOD_CHAIN_ID')) !== CHAIN_ID
) throw new Error('Claim status is locked to write-disabled chain-46630 staging')

const privateKey = required('EVIDENCE_WALLET_PRIVATE_KEY')
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('Encrypted staging wallet material is malformed')
}
const escrowAddress = required('VELOSTRA_ESCROW_ADDRESS')
if (!isAddress(escrowAddress)) throw new Error('Staging escrow address is malformed')
const account = privateKeyToAccount(privateKey)
const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 })
const publicClient = createPublicClient({
  transport: http(required('ROBINHOOD_RPC_URL'), { timeout: 30_000, retryCount: 2 }),
})

try {
  if (await publicClient.getChainId() !== CHAIN_ID) throw new Error('Claim status RPC chain mismatch')
  const result = await pool.query(
    `select be.total_earned::text,
            be.available::text,
            be.total_claimed::text,
            (select count(*)::int
               from earnings_claims ec
              where ec.builder_id = b.id
                and ec.amount = 1.000000
                and ec.status = 'COMPLETED'
                and ec.chain_id = $2
                and lower(ec.contract_address) = lower($3)) as exact_claim_count,
            (select ec.tx_hash
               from earnings_claims ec
              where ec.builder_id = b.id
                and ec.amount = 1.000000
                and ec.status = 'COMPLETED'
                and ec.chain_id = $2
                and lower(ec.contract_address) = lower($3)
              order by ec.created_at desc
              limit 1) as claim_tx_hash
       from builders b
       join builder_earnings be on be.builder_id = b.id
      where lower(b.wallet_address) = lower($1)
      limit 1`,
    [account.address, CHAIN_ID, escrowAddress]
  )
  const row = result.rows[0]
  const dbTx = String(row?.claim_tx_hash ?? '').toLowerCase()
  const [builderState, receipt] = await Promise.all([
    publicClient.readContract({
      address: getAddress(escrowAddress),
      abi: [{
        type: 'function',
        name: 'builders',
        stateMutability: 'view',
        inputs: [{ name: '', type: 'address' }],
        outputs: [
          { name: 'totalEarned', type: 'uint256' },
          { name: 'availableToClaim', type: 'uint256' },
          { name: 'totalClaimed', type: 'uint256' },
          { name: 'initialized', type: 'bool' },
        ],
      }],
      functionName: 'builders',
      args: [account.address],
    }),
    /^0x[0-9a-f]{64}$/.test(dbTx)
      ? publicClient.getTransactionReceipt({ hash: dbTx })
      : Promise.resolve(null),
  ])
  const claimedEvent = {
    type: 'event',
    name: 'Claimed',
    inputs: [
      { name: 'builder', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  }
  const exactLogs = (receipt?.logs ?? []).flatMap((log) => {
    if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return []
    try {
      const decoded = decodeEventLog({ abi: [claimedEvent], data: log.data, topics: log.topics })
      return decoded.eventName === 'Claimed' &&
        decoded.args.builder.toLowerCase() === account.address.toLowerCase() &&
        decoded.args.amount === CLAIM_AMOUNT
        ? [decoded]
        : []
    } catch {
      return []
    }
  })
  const resultFlags = {
    builderFound: Boolean(row),
    dbTotalEarnedCorrect: Number(row?.total_earned) === 1.08,
    dbAvailableCorrect: Number(row?.available) === 0.08,
    dbTotalClaimedCorrect: Number(row?.total_claimed) === 1,
    dbSingleExactClaim: Number(row?.exact_claim_count) === 1,
    dbClaimTxPresent: /^0x[0-9a-f]{64}$/.test(dbTx),
    chainBuilderInitialized: builderState[3] === true,
    chainTotalEarnedCorrect: builderState[0] === 1_080_000n,
    chainAvailableCorrect: builderState[1] === 80_000n,
    chainTotalClaimedCorrect: builderState[2] === CLAIM_AMOUNT,
    chainClaimReceiptSucceeded: receipt?.status === 'success',
    chainSingleExactClaim: exactLogs.length === 1,
    databaseMatchesChainEvent: exactLogs.length === 1,
  }
  console.info(JSON.stringify({
    ...resultFlags,
    paidWritesDisabled: true,
    passed: Object.values(resultFlags).every(Boolean),
  }))
} finally {
  await pool.end()
}
