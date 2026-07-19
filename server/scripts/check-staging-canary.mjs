import { Pool } from 'pg'
import { createPublicClient, getAddress, http, isAddress, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

if (required('VELOSTRA_ENVIRONMENT') !== 'staging') {
  throw new Error('Canary status is restricted to staging')
}
if (required('PHASE3_PAID_WRITES_MODE') !== 'disabled') {
  throw new Error('Canary status requires paid writes to be disabled')
}
if (required('CANARY_STATUS_APPROVAL') !== 'read-only-staging-canary-status') {
  throw new Error('Explicit read-only canary status approval is required')
}
if (Number(required('ROBINHOOD_CHAIN_ID')) !== 46630) {
  throw new Error('Canary status is restricted to Robinhood Chain testnet')
}

const privateKey = required('EVIDENCE_WALLET_PRIVATE_KEY')
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('Encrypted staging wallet material is malformed')
}

const account = privateKeyToAccount(privateKey)
const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 1 })

try {
  const result = await pool.query(
    `select ac.status,
            ac.onchain_call_id,
            ac.output is not null as output_present,
            ac.price_charged::text,
            sa.status as settlement_status,
            sa.builder_address,
            sa.tx_hash is not null as settlement_tx_present,
            rca.status as admission_status,
            (select count(*)::int from transactions t
              where t.agent_call_id = ac.id) as tx_count
       from users u
       join agent_calls ac on ac.user_id = u.id
       join agents ag on ag.id = ac.agent_id
       left join settlement_attempts sa on sa.agent_call_id = ac.id
       left join release_canary_admissions rca on rca.agent_call_id = ac.id
      where lower(u.wallet_address) = lower($1)
        and ag.slug = 'phase2-synthetic-agent'
        and ac.input = 'Phase 2 isolated-staging wallet verification'
      order by ac.created_at desc
      limit 1`,
    [account.address]
  )
  const row = result.rows[0]
  const escrowAddress = required('VELOSTRA_ESCROW_ADDRESS')
  if (!/^0x[0-9a-fA-F]{40}$/.test(escrowAddress)) {
    throw new Error('Staging escrow address is malformed')
  }
  const publicClient = createPublicClient({
    transport: http(required('ROBINHOOD_RPC_URL')),
  })
  const onchainSettled = /^0x[0-9a-fA-F]{64}$/.test(row?.onchain_call_id ?? '')
    ? await publicClient.readContract({
        address: escrowAddress,
        abi: [{
          type: 'function',
          name: 'settledCallIds',
          stateMutability: 'view',
          inputs: [{ name: '', type: 'bytes32' }],
          outputs: [{ name: '', type: 'bool' }],
        }],
        functionName: 'settledCallIds',
        args: [row.onchain_call_id],
      })
    : false
  const builderAddress = row?.builder_address
  const signerAddress = required('SETTLEMENT_SIGNER_ADDRESS')
  if (!isAddress(builderAddress ?? '') || !isAddress(signerAddress)) {
    throw new Error('Canary settlement addresses are malformed')
  }
  const [builderState, paused, successor, solvent, signerAuthorized] = await Promise.all([
    publicClient.readContract({
      address: escrowAddress,
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
      args: [getAddress(builderAddress)],
    }),
    publicClient.readContract({
      address: escrowAddress,
      abi: [{ type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] }],
      functionName: 'paused',
    }),
    publicClient.readContract({
      address: escrowAddress,
      abi: [{ type: 'function', name: 'successorEscrow', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }],
      functionName: 'successorEscrow',
    }),
    publicClient.readContract({
      address: escrowAddress,
      abi: [{ type: 'function', name: 'isSolvent', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] }],
      functionName: 'isSolvent',
    }),
    publicClient.readContract({
      address: escrowAddress,
      abi: [{ type: 'function', name: 'hasRole', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] }],
      functionName: 'hasRole',
      args: [keccak256(toBytes('SETTLER_ROLE')), getAddress(signerAddress)],
    }),
  ])
  console.info(JSON.stringify({
    callFound: Boolean(row),
    callSettled: row?.status === 'SUCCESS',
    stillProcessing: row?.status === 'PROCESSING',
    outputPresent: row?.output_present === true,
    financialAmountCorrect: Number(row?.price_charged) === 1.2,
    builderMatchesEvidenceWallet: getAddress(builderAddress) === account.address,
    builderInitialized: builderState[3] === true,
    contractUnpaused: paused === false,
    contractActive: /^0x0{40}$/i.test(successor),
    contractSolvent: solvent === true,
    signerAuthorized: signerAuthorized === true,
    onchainSettled,
    outboxPrepared: row?.settlement_status === 'PREPARED',
    outboxReady: row?.settlement_status === 'READY',
    outboxSubmitted: row?.settlement_status === 'SUBMITTED',
    outboxAmbiguous: row?.settlement_status === 'AMBIGUOUS',
    outboxConfirmed: row?.settlement_status === 'CONFIRMED',
    outboxApplied: row?.settlement_status === 'APPLIED',
    outboxFailed: row?.settlement_status === 'FAILED',
    settlementTxPresent: row?.settlement_tx_present === true,
    admissionSettled: row?.admission_status === 'SETTLED',
    singleLedgerTransaction: Number(row?.tx_count) === 1,
  }))
} finally {
  await pool.end()
}
