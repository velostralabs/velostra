import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const CHAIN_ID = 46630
const APPROVAL = 'isolated-staging-reconciliation-approved'
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifactsRoot = path.join(repositoryRoot, 'artifacts')

const tokenAbi = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [
    { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' },
  ], outputs: [] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [
    { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' },
  ], outputs: [{ name: '', type: 'bool' }] },
]
const escrowAbi = [
  { type: 'function', name: 'depositCredits', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
]

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(name + ' is required')
  return value
}

function address(name) {
  const value = required(name)
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(name + ' must be a non-zero EVM address')
  }
  return value
}

function privateKey(name) {
  const value = required(name)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(name + ' must be an exact 32-byte hex private key')
  }
  return value
}

function outputPath() {
  const resolved = path.resolve(repositoryRoot, required('EVIDENCE_OUTPUT'))
  const relative = path.relative(artifactsRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('EVIDENCE_OUTPUT must stay below artifacts/')
  }
  return resolved
}

function assertGuards() {
  if (process.env.VELOSTRA_EVIDENCE_APPROVAL !== APPROVAL) {
    throw new Error('Explicit isolated-staging evidence approval is required')
  }
  if (process.env.VELOSTRA_ENVIRONMENT !== 'staging') {
    throw new Error('VELOSTRA_ENVIRONMENT must equal staging')
  }
  if (Number(process.env.ROBINHOOD_CHAIN_ID) !== CHAIN_ID) {
    throw new Error('ROBINHOOD_CHAIN_ID must equal 46630')
  }
  if (process.env.PHASE3_PAID_WRITES_MODE !== 'disabled') {
    throw new Error('Reconciliation evidence must keep paid writes disabled')
  }
}

function evidenceChain(rpcUrl) {
  return defineChain({
    id: CHAIN_ID,
    name: 'Robinhood Chain Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
}

async function authenticate(apiUrl, account) {
  const base = apiUrl.replace(/\/$/, '')
  const nonceResponse = await fetch(base + '/api/auth/nonce', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: account.address }),
  })
  if (!nonceResponse.ok) throw new Error('Staging wallet nonce request failed')
  const { message } = await nonceResponse.json()
  if (!message) throw new Error('Staging wallet nonce response omitted its message')
  const signature = await account.signMessage({ message })
  const loginResponse = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: account.address, signature }),
  })
  if (!loginResponse.ok) throw new Error('Staging wallet login failed')
}

async function waitForSafeHead(publicClient, depositBlock) {
  const requiredHead = depositBlock + 12n
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    if (await publicClient.getBlockNumber() >= requiredHead) return
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error('Testnet did not reach the 12-confirmation safe head in time')
}

async function capture() {
  assertGuards()
  const output = outputPath()
  if (fs.existsSync(output)) throw new Error('Evidence output already exists')
  const rpcUrl = required('ROBINHOOD_RPC_URL')
  const apiUrl = new URL(required('API_URL'))
  if (apiUrl.protocol !== 'https:') throw new Error('API_URL must use HTTPS')
  const account = privateKeyToAccount(privateKey('EVIDENCE_WALLET_PRIVATE_KEY'))
  const deployer = privateKeyToAccount(privateKey('TESTNET_DEPLOYER_PRIVATE_KEY'))
  const targetAmount = required('EVIDENCE_DEPOSIT_AMOUNT')
  if (!/^0\.0[1-9]$/.test(targetAmount)) throw new Error('Deposit must be 0.01 through 0.09')
  const amount = parseUnits(targetAmount, 6)
  const network = evidenceChain(rpcUrl)
  const publicClient = createPublicClient({ chain: network, transport: http(rpcUrl) })
  if (await publicClient.getChainId() !== CHAIN_ID) throw new Error('RPC chain mismatch')
  const wallet = createWalletClient({ account, chain: network, transport: http(rpcUrl) })
  const funder = createWalletClient({ account: deployer, chain: network, transport: http(rpcUrl) })
  const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 2 })
  try {
    if (await publicClient.getBalance({ address: account.address }) < parseEther('0.005')) {
      const hash = await funder.sendTransaction({ to: account.address, value: parseEther('0.01') })
      await publicClient.waitForTransactionReceipt({ hash })
    }
    await authenticate(apiUrl.toString(), account)
    const before = await pool.query(
      `select coalesce(cb.balance_usd, 0)::text as balance,
              (select count(*) from transactions t where lower(t.wallet_address) = lower($1))::text as tx_count
         from users u left join credit_balances cb on cb.user_id = u.id
        where lower(u.wallet_address) = lower($1)`, [account.address])
    if (!before.rows[0] || Number(before.rows[0].balance) !== 0 || Number(before.rows[0].tx_count) !== 0) {
      throw new Error('Evidence wallet is not fresh')
    }
    const token = address('SETTLEMENT_TOKEN_ADDRESS')
    const escrow = address('VELOSTRA_ESCROW_ADDRESS')
    let hash = await wallet.writeContract({ address: token, abi: tokenAbi,
      functionName: 'mint', args: [account.address, amount] })
    await publicClient.waitForTransactionReceipt({ hash })
    hash = await wallet.writeContract({ address: token, abi: tokenAbi,
      functionName: 'approve', args: [escrow, amount] })
    await publicClient.waitForTransactionReceipt({ hash })
    const depositHash = await wallet.writeContract({ address: escrow, abi: escrowAbi,
      functionName: 'depositCredits', args: [amount] })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash })
    if (receipt.status !== 'success') throw new Error('Evidence deposit was not confirmed')
    const absent = await pool.query(
      `select (select count(*) from transactions where tx_hash = $1)::text as count,
              coalesce((select cb.balance_usd from credit_balances cb join users u on u.id = cb.user_id
                where lower(u.wallet_address) = lower($2)), 0)::text as balance`,
      [depositHash, account.address])
    if (Number(absent.rows[0]?.count) !== 0 || Number(absent.rows[0]?.balance) !== 0) {
      throw new Error('Deposit was already reported; skipped-report evidence is invalid')
    }
    const record = {
      schemaVersion: 1, kind: 'velostra-staging-reconciliation-evidence',
      environment: 'staging', chainId: CHAIN_ID, walletAddress: account.address,
      depositTxHash: depositHash, depositBlock: receipt.blockNumber.toString(),
      amount: targetAmount, reportEndpointCalled: false, capturedAt: new Date().toISOString(),
      preReconciliation: { userAuthenticated: true, transactionAbsent: true, balanceZero: true },
    }
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
    await waitForSafeHead(publicClient, receipt.blockNumber)
    console.log(JSON.stringify({ passed: true, stage: 'broadcast', reportSkipped: true,
      databaseRecordAbsent: true, safeHeadReached: true }))
  } finally { await pool.end() }
}

async function verify() {
  assertGuards()
  const output = outputPath()
  const record = JSON.parse(fs.readFileSync(output, 'utf8'))
  if (record.kind !== 'velostra-staging-reconciliation-evidence' ||
      record.environment !== 'staging' || record.chainId !== CHAIN_ID ||
      record.reportEndpointCalled !== false) throw new Error('Evidence record identity is invalid')
  const pool = new Pool({ connectionString: required('DATABASE_URL'), max: 2 })
  try {
    const result = await pool.query(
      `select t.type, t.status, t.amount::text, cb.balance_usd::text as balance,
              ce.reconciled, css.last_processed_block::text
         from users u left join credit_balances cb on cb.user_id = u.id
         left join transactions t on t.credit_balance_id = cb.id and t.tx_hash = $1
         left join chain_events ce on ce.tx_hash = $1 and ce.event_type = 'DEPOSIT'
         left join chain_sync_state css on css.id = ce.sync_state_id
        where lower(u.wallet_address) = lower($2)`, [record.depositTxHash, record.walletAddress])
    const row = result.rows[0]
    const checks = {
      transactionBackfilled: row?.type === 'TOPUP' && row.status === 'CONFIRMED' &&
        Number(row.amount) === Number(record.amount),
      balanceBackfilledOnce: Number(row?.balance) === Number(record.amount),
      chainEventReconciled: row?.reconciled === true,
      cursorAdvanced: BigInt(row?.last_processed_block ?? '0') >= BigInt(record.depositBlock),
    }
    const passed = Object.values(checks).every(Boolean)
    record.verification = { verifiedAt: new Date().toISOString(), ...checks, passed }
    fs.writeFileSync(output, JSON.stringify(record, null, 2) + '\n')
    if (!passed) throw new Error('Managed reconciliation did not restore every record')
    console.log(JSON.stringify({ passed: true, stage: 'verified', ...checks,
      reportEndpointCalled: false }))
  } finally { await pool.end() }
}

if (process.argv.includes('--plan')) {
  console.log(JSON.stringify({ passed: true, broadcast: false, chainId: CHAIN_ID,
    paidWritesRequired: false }))
} else {
  const operation = process.argv.includes('--broadcast') ? capture
    : process.argv.includes('--verify') ? verify : null
  if (!operation) throw new Error('Use --plan, --broadcast, or --verify')
  operation().catch((error) => {
    console.error('[staging-reconciliation-evidence] failed:', error instanceof Error ? error.message : 'unknown')
    process.exit(1)
  })
}
