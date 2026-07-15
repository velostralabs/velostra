import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { spawn } from 'node:child_process'
import pg from 'pg'
const { Client } = pg
import Ganache from 'ganache'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http as viemHttp,
  keccak256,
  parseUnits,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const API_PORT = 8791
const MOCK_PORT = 9099
const RPC_PORT = 8546
const BASE = `http://127.0.0.1:${API_PORT}`
const RPC = `http://127.0.0.1:${RPC_PORT}`

if (!process.env.DATABASE_URL) {
  throw new Error('Set DATABASE_URL to a disposable Postgres database and run npm run db:push first')
}

function assert(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message)
  console.log('PASS', message)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function makeClient() {
  let cookie = ''
  return async (path, options = {}) => {
    const response = await fetch(BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.headers || {}),
      },
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    const body = await response.json().catch(() => ({}))
    return { status: response.status, body }
  }
}

async function signIn(client, account) {
  const challenge = await client('/api/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: account.address }),
  })
  const signature = await account.signMessage({ message: challenge.body.message })
  const login = await client('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ walletAddress: account.address, signature }),
  })
  assert(login.status === 200, `wallet ${account.address} signs in`)
  return login.body.user
}

async function waitForBackend(child, logs) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) {
      throw new Error('Backend exited before health check:\n' + logs.join(''))
    }
    try {
      const response = await fetch(BASE + '/health')
      if (response.ok) return
    } catch {
      // Still starting.
    }
    await delay(100)
  }
  throw new Error('Backend did not become healthy:\n' + logs.join(''))
}


async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill()
  })
}

async function runReconcile(env, fromBlock, toBlock) {
  return new Promise((resolve, reject) => {
    const args = [
      '--import',
      'tsx',
      'src/jobs/reconcile.ts',
      '--once',
      '--from-block=' + fromBlock,
      '--to-block=' + toBlock,
    ]
    const child = spawn(process.execPath, args, {
      cwd: new URL('..', import.meta.url),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk.toString()))
    child.stderr.on('data', (chunk) => (output += chunk.toString()))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error('Reconciliation worker failed:\n' + output))
    })
  })
}

async function attemptLateTerminalRegression(env, callId, txHash) {
  const code = [
    "const settlement = await import('./src/lib/gateway/settlement.ts')",
    "const database = await import('./src/db/client.ts')",
    "await settlement.markSettlementAmbiguous(process.env.TEST_CALL_ID, new Error('late timeout'))",
    "await settlement.markSettlementConfirmed(process.env.TEST_CALL_ID, process.env.TEST_TX_HASH, 1n)",
    "await database.pool.end()",
  ].join(';')

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], {
      cwd: new URL('..', import.meta.url),
      env: { ...env, TEST_CALL_ID: callId, TEST_TX_HASH: txHash },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk.toString()))
    child.stderr.on('data', (chunk) => (output += chunk.toString()))
    child.once('error', reject)
    child.once('exit', (exitCode) => {
      if (exitCode === 0) resolve()
      else reject(new Error('Late terminal-state regression probe failed:\n' + output))
    })
  })
}

async function main() {
  let expectedAgentSecret = ''
  let hmacVerified = false
  const mockServer = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const timestamp = String(request.headers['x-velostra-timestamp'] || '')
      const signature = String(request.headers['x-velostra-signature'] || '')
      const expected = crypto
        .createHmac('sha256', expectedAgentSecret)
        .update(`${timestamp}.${body}`)
        .digest('hex')
      hmacVerified =
        Boolean(expectedAgentSecret) &&
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))

      response.writeHead(hmacVerified ? 200 : 401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(hmacVerified ? { echoed: JSON.parse(body) } : { error: 'bad signature' }))
    })
  })

  const evm = Ganache.server({
    chain: { chainId: 4663 },
    wallet: { totalAccounts: 6, defaultBalance: 1_000 },
    logging: { quiet: true },
  })

  let backend
  try {
    await listen(mockServer, MOCK_PORT)
    await evm.listen(RPC_PORT, '127.0.0.1')

    const initial = evm.provider.getInitialAccounts()
    const keys = Object.values(initial).map((entry) => entry.secretKey)
    const admin = privateKeyToAccount(keys[0])
    const builder = privateKeyToAccount(keys[1])
    const user = privateKeyToAccount(keys[2])
    const recoveryUser = privateKeyToAccount(keys[3])

    const chain = defineChain({
      id: 4663,
      name: 'Velostra local EVM',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [RPC] } },
    })
    const publicClient = createPublicClient({ chain, transport: viemHttp(RPC) })
    const adminWallet = createWalletClient({ account: admin, chain, transport: viemHttp(RPC) })
    const builderWallet = createWalletClient({ account: builder, chain, transport: viemHttp(RPC) })
    const userWallet = createWalletClient({ account: user, chain, transport: viemHttp(RPC) })
    const recoveryWallet = createWalletClient({
      account: recoveryUser,
      chain,
      transport: viemHttp(RPC),
    })

    const escrowArtifact = JSON.parse(
      fs.readFileSync(new URL('../../contracts/build/VelostraEscrow.json', import.meta.url), 'utf8')
    )
    const tokenArtifact = JSON.parse(
      fs.readFileSync(new URL('../../contracts/build/MockUSD.json', import.meta.url), 'utf8')
    )

    const tokenDeployHash = await adminWallet.deployContract({
      abi: tokenArtifact.abi,
      bytecode: tokenArtifact.bytecode,
    })
    const tokenDeployReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenDeployHash })
    const tokenAddress = tokenDeployReceipt.contractAddress
    if (!tokenAddress) throw new Error('MockUSD deployment did not return a contract address')

    const escrowDeployHash = await adminWallet.deployContract({
      abi: escrowArtifact.abi,
      bytecode: escrowArtifact.bytecode,
      args: [tokenAddress, 1000, admin.address, admin.address, admin.address, admin.address],
    })
    const escrowDeployReceipt = await publicClient.waitForTransactionReceipt({ hash: escrowDeployHash })
    const escrowAddress = escrowDeployReceipt.contractAddress
    if (!escrowAddress) throw new Error('Escrow deployment did not return a contract address')

    const fundHash = await adminWallet.writeContract({
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: 'transfer',
      args: [user.address, parseUnits('20', 6)],
    })
    await publicClient.waitForTransactionReceipt({ hash: fundHash })

    const recoveryFundHash = await adminWallet.writeContract({
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: 'transfer',
      args: [recoveryUser.address, parseUnits('5', 6)],
    })
    await publicClient.waitForTransactionReceipt({ hash: recoveryFundHash })

    const backendLogs = []
    const runtimeEnv = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(API_PORT),
      WEB_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'money-loop-test-secret',
      ADMIN_WALLET: admin.address,
      GATEWAY_HMAC_SECRET: 'unused-in-this-flow',
      AGENT_SECRET_ENCRYPTION_KEY: '11'.repeat(32),
      AGENT_SECRET_ENCRYPTION_KEY_ID: 'test',
      REDIS_URL: 'redis://127.0.0.1:6399',
      REDIS_FAILURE_MODE: 'open',
      VELOSTRA_ESCROW_ADDRESS: escrowAddress,
      BACKEND_SIGNER_PRIVATE_KEY: keys[0],
      SETTLEMENT_TOKEN_DECIMALS: '6',
      ROBINHOOD_RPC_URL: RPC,
      ROBINHOOD_CHAIN_ID: '4663',
      ONCHAIN_SETTLEMENT_MODE: 'required',
      FREE_TIER_CALLS_PER_MONTH: '0',
      AGENT_TIMEOUT_MS: '5000',
      AGENT_ALLOWED_PORTS: '80,443,9099',
      AGENT_SSRF_TEST_ALLOW_LOOPBACK: 'true',
      VELOSTRA_DEPLOYMENT_BLOCK: String(escrowDeployReceipt.blockNumber),
      RECONCILE_CONFIRMATIONS: '0',
      RECONCILE_MAX_BLOCK_RANGE: '3',
      RECONCILE_RPC_RETRIES: '2',
      RECONCILE_TEST_FAIL_AFTER_SETTLEMENT_INPUT: 'force post-settlement rollback',
      RECONCILE_TEST_PAUSE_AFTER_SETTLEMENT_INPUT: 'race live request and worker',
      RECONCILE_TEST_PAUSE_AFTER_SETTLEMENT_MS: '2500',
      RECONCILE_TEST_AMBIGUOUS_RECEIPT_INPUT: 'force ambiguous receipt recovery',
      RECONCILE_TEST_AMBIGUOUS_BROADCAST_INPUT: 'force unknown broadcast recovery',
    }
    backend = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: new URL('..', import.meta.url),
      env: runtimeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    backend.stdout.on('data', (chunk) => backendLogs.push(chunk.toString()))
    backend.stderr.on('data', (chunk) => backendLogs.push(chunk.toString()))
    await waitForBackend(backend, backendLogs)

    const builderClient = makeClient()
    await signIn(builderClient, builder)
    const registration = await builderClient('/api/builder/register', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Money Loop Builder' }),
    })
    assert(registration.status === 200, 'builder registers in Postgres')

    const initializeHash = await builderWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'initializeBuilder',
    })
    await publicClient.waitForTransactionReceipt({ hash: initializeHash })
    assert(true, 'builder initializes onchain and waits for confirmation')

    const submission = await builderClient('/api/builder/agents', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Money Loop Agent',
        description: 'Verifies paid settlement, HMAC, claim, and replay protection',
        category: 'PRODUCTIVITY',
        endpoint_url: `http://127.0.0.1:${MOCK_PORT}/run`,
        price_per_call: 0.3,
      }),
    })
    assert(submission.status === 200, 'builder submits a paid agent')
    expectedAgentSecret = submission.body.secret_key

    const adminClient = makeClient()
    await signIn(adminClient, admin)
    const decision = await adminClient(`/api/admin/agents/${submission.body.agent.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'APPROVE' }),
    })
    assert(decision.status === 200, 'admin approves the paid agent')

    const userClient = makeClient()
    await signIn(userClient, user)
    const recoveryClient = makeClient()
    await signIn(recoveryClient, recoveryUser)

    const depositAmount = parseUnits('5', 6)
    const approveHash = await userWallet.writeContract({
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: 'approve',
      args: [escrowAddress, depositAmount],
    })
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
    const depositHash = await userWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'depositCredits',
      args: [depositAmount],
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })
    const topup = await userClient('/api/dashboard/topup', {
      method: 'POST',
      body: JSON.stringify({ amount_usd: 5, tx_hash: depositHash }),
    })
    assert(topup.status === 200 && topup.body.balance_usd === 5, 'confirmed Deposit event credits $5')

    const topupReplay = await userClient('/api/dashboard/topup', {
      method: 'POST',
      body: JSON.stringify({ amount_usd: 5, tx_hash: depositHash }),
    })
    assert(topupReplay.status === 409, 'deposit transaction hash replay is rejected')

    const run = await userClient(`/api/agents/${submission.body.agent.slug}/run`, {
      method: 'POST',
      body: JSON.stringify({ input: 'settle this paid call' }),
    })
    assert(run.status === 200 && run.body.is_free_tier === false, 'first call is paid in test mode')
    assert(Boolean(run.body.settlement_tx_hash), 'backend returns creditBuilderEarnings transaction hash')
    assert(hmacVerified, 'mock agent verifies the outbound HMAC signature')

    const dashboard = await userClient('/api/dashboard')
    assert(Math.abs(dashboard.body.balance_usd - 4.7) < 1e-9, 'paid call deducts $0.30 atomically')

    const earnings = await builderClient('/api/builder/earnings')
    assert(Math.abs(earnings.body.earnings.available - 0.27) < 1e-9, 'builder receives the 90% DB credit')

    const onchainAccount = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'getBuilderAccount',
      args: [builder.address],
    })
    const onchainAvailable = onchainAccount.availableToClaim ?? onchainAccount[1]
    assert(onchainAvailable === parseUnits('0.27', 6), 'builder receives the 90% onchain credit')

    const claimHash = await builderWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'claimEarnings',
      args: [parseUnits('0.27', 6)],
    })
    await publicClient.waitForTransactionReceipt({ hash: claimHash })
    const claim = await builderClient('/api/builder/claim', {
      method: 'POST',
      body: JSON.stringify({ amount: 0.27, tx_hash: claimHash }),
    })
    assert(
      claim.status === 200,
      'confirmed Claimed event reconciles builder earnings: ' + JSON.stringify(claim)
    )

    const claimReplay = await builderClient('/api/builder/claim', {
      method: 'POST',
      body: JSON.stringify({ amount: 0.27, tx_hash: claimHash }),
    })
    assert(claimReplay.status === 409, 'claim transaction hash replay is rejected')


    const missedDepositAmount = parseUnits('2', 6)
    const missedDepositApproveHash = await recoveryWallet.writeContract({
      address: tokenAddress,
      abi: tokenArtifact.abi,
      functionName: 'approve',
      args: [escrowAddress, missedDepositAmount],
    })
    await publicClient.waitForTransactionReceipt({ hash: missedDepositApproveHash })
    const missedDepositHash = await recoveryWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'depositCredits',
      args: [missedDepositAmount],
    })
    const missedDepositReceipt = await publicClient.waitForTransactionReceipt({
      hash: missedDepositHash,
    })
    assert(missedDepositReceipt.status === 'success', 'unreported deposit confirms onchain')

    const interruptedRun = await userClient(
      `/api/agents/${submission.body.agent.slug}/run`,
      {
        method: 'POST',
        body: JSON.stringify({ input: 'force post-settlement rollback' }),
      }
    )
    assert(
      interruptedRun.status === 503 &&
        interruptedRun.body.reconciliation_pending === true &&
        Boolean(interruptedRun.body.call_id) &&
        Boolean(interruptedRun.body.settlement_tx_hash),
      'paid call confirms onchain then intentionally rolls back its DB ledger'
    )

    const beforeInterruptedRecovery = await userClient('/api/dashboard')
    assert(
      Math.abs(beforeInterruptedRecovery.body.balance_usd - 4.7) < 1e-9,
      'interrupted paid call has not deducted user credits before reconciliation'
    )

    const preRecoveryDb = new Client({ connectionString: process.env.DATABASE_URL })
    await preRecoveryDb.connect()
    const preRecoveryCall = await preRecoveryDb.query(
      `select status, onchain_call_id, output
       from agent_calls
       where id = $1`,
      [interruptedRun.body.call_id]
    )
    const preRecoveryTransaction = await preRecoveryDb.query(
      'select count(*)::int as count from transactions where tx_hash = $1',
      [interruptedRun.body.settlement_tx_hash]
    )
    await preRecoveryDb.end()
    assert(
      preRecoveryCall.rows[0]?.status === 'PROCESSING' &&
        preRecoveryCall.rows[0].onchain_call_id ===
          keccak256(toBytes(interruptedRun.body.call_id)) &&
        preRecoveryCall.rows[0].output !== null,
      'durable correlated call intent and upstream output survive the forced rollback'
    )
    assert(
      preRecoveryTransaction.rows[0].count === 0,
      'forced rollback leaves no paid-call transaction ledger before worker recovery'
    )

    const beforeReconcile = await recoveryClient('/api/dashboard')
    assert(
      Math.abs(beforeReconcile.body.balance_usd) < 1e-9,
      'unreported $2 deposit is absent before reconciliation'
    )

    const missedClaimHash = await builderWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'claimEarnings',
      args: [parseUnits('0.27', 6)],
    })
    const missedClaimReceipt = await publicClient.waitForTransactionReceipt({
      hash: missedClaimHash,
    })
    assert(missedClaimReceipt.status === 'success', 'unreported claim confirms onchain')


    const platformWithdrawalHash = await adminWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'withdrawPlatformRevenue',
      args: [admin.address, parseUnits('0.03', 6)],
    })
    const platformWithdrawalReceipt = await publicClient.waitForTransactionReceipt({
      hash: platformWithdrawalHash,
    })
    assert(
      platformWithdrawalReceipt.status === 'success',
      'platform withdrawal confirms onchain'
    )

    const beforeClaimReconcile = await builderClient('/api/builder/earnings')
    assert(
      Math.abs(beforeClaimReconcile.body.earnings.available) < 1e-9 &&
        Math.abs(beforeClaimReconcile.body.earnings.total_claimed - 0.27) < 1e-9,
      'interrupted settlement and unreported claim are both absent from the DB ledger'
    )

    const reconcileOutput = await runReconcile(
      runtimeEnv,
      escrowDeployReceipt.blockNumber,
      platformWithdrawalReceipt.blockNumber
    )
    assert(reconcileOutput.includes('drift clean'), 'worker reports zero event-ledger drift')

    const healedDashboard = await recoveryClient('/api/dashboard')
    assert(
      Math.abs(healedDashboard.body.balance_usd - 2) < 1e-9,
      'worker backfills missed deposit without an API report'
    )
    const healedInterruptedUser = await userClient('/api/dashboard')
    assert(
      Math.abs(healedInterruptedUser.body.balance_usd - 4.4) < 1e-9,
      'worker deducts the exact user for the correlated settled call'
    )
    const healedEarnings = await builderClient('/api/builder/earnings')
    assert(
      Math.abs(healedEarnings.body.earnings.available) < 1e-9 &&
        Math.abs(healedEarnings.body.earnings.total_claimed - 0.54) < 1e-9,
      'worker backfills missed claim without an API report'
    )

    const auditDb = new Client({ connectionString: process.env.DATABASE_URL })
    await auditDb.connect()
    const missedDepositRows = await auditDb.query(
      'select count(*)::int as count from transactions where tx_hash = $1',
      [missedDepositHash]
    )
    const missedClaimRows = await auditDb.query(
      'select count(*)::int as count from earnings_claims where tx_hash = $1',
      [missedClaimHash]
    )
    const platformRows = await auditDb.query(
      'select count(*)::int as count from transactions where tx_hash = $1 and type = $2',
      [platformWithdrawalHash, 'PLATFORM_WITHDRAWAL']
    )
    const recoveredCallRows = await auditDb.query(
      `select
         ac.status,
         ac.onchain_call_id,
         ac.price_charged,
         ac.builder_earned,
         ac.platform_earned,
         ac.output,
         t.tx_hash,
         ce.correlation_id
       from agent_calls ac
       join transactions t on t.agent_call_id = ac.id
       join chain_events ce
         on ce.tx_hash = t.tx_hash
        and ce.event_type = 'EARNINGS_CREDITED'
       where ac.id = $1`,
      [interruptedRun.body.call_id]
    )
    const recoveredAgentStats = await auditDb.query(
      'select total_calls, total_revenue from agents where id = $1',
      [submission.body.agent.id]
    )
    const syncRows = await auditDb.query(
      'select last_processed_block from chain_sync_state where lower(contract_address) = lower($1)',
      [escrowAddress]
    )
    await auditDb.end()
    assert(missedDepositRows.rows[0].count === 1, 'missed deposit ledger row exists in Postgres')
    assert(missedClaimRows.rows[0].count === 1, 'missed claim ledger row exists in Postgres')
    assert(platformRows.rows[0].count === 1, 'platform withdrawal event is indexed')
    const recoveredCall = recoveredCallRows.rows[0]
    assert(
      recoveredCall?.status === 'SUCCESS' &&
        recoveredCall.tx_hash === interruptedRun.body.settlement_tx_hash &&
        recoveredCall.correlation_id === recoveredCall.onchain_call_id &&
        Math.abs(Number(recoveredCall.price_charged) - 0.3) < 1e-9 &&
        Math.abs(Number(recoveredCall.builder_earned) - 0.27) < 1e-9 &&
        Math.abs(Number(recoveredCall.platform_earned) - 0.03) < 1e-9 &&
        recoveredCall.output !== null,
      'worker repairs the specific correlated agent_call and links its settlement transaction'
    )
    assert(
      recoveredAgentStats.rows[0].total_calls === 2 &&
        Math.abs(Number(recoveredAgentStats.rows[0].total_revenue) - 0.6) < 1e-9,
      'worker repairs agent call count and revenue exactly once'
    )
    assert(
      BigInt(syncRows.rows[0].last_processed_block) >= platformWithdrawalReceipt.blockNumber,
      'worker persists last_processed_block'
    )

    const missedTopupReplay = await recoveryClient('/api/dashboard/topup', {
      method: 'POST',
      body: JSON.stringify({ amount_usd: 2, tx_hash: missedDepositHash }),
    })
    assert(missedTopupReplay.status === 409, 'worker-backfilled deposit rejects later API replay')
    const missedClaimReplay = await builderClient('/api/builder/claim', {
      method: 'POST',
      body: JSON.stringify({ amount: 0.27, tx_hash: missedClaimHash }),
    })
    assert(missedClaimReplay.status === 409, 'worker-backfilled claim rejects later API replay')

    const retroactiveOutput = await runReconcile(
      runtimeEnv,
      escrowDeployReceipt.blockNumber,
      platformWithdrawalReceipt.blockNumber
    )
    assert(
      retroactiveOutput.includes('retroactive cursor preserved'),
      'manual retroactive scan cannot move the persistent catch-up cursor'
    )
    const afterRescan = await recoveryClient('/api/dashboard')
    const interruptedUserAfterRescan = await userClient('/api/dashboard')
    assert(
      Math.abs(afterRescan.body.balance_usd - 2) < 1e-9 &&
        Math.abs(interruptedUserAfterRescan.body.balance_usd - 4.4) < 1e-9,
      'retroactive re-scan is idempotent for deposit and correlated paid-call recovery'
    )

    const earningsBeforeRace = await builderClient('/api/builder/earnings')
    const raceStartBlock = await publicClient.getBlockNumber({ cacheTime: 0 })
    const raceRunPromise = userClient(
      '/api/agents/' + submission.body.agent.slug + '/run',
      {
        method: 'POST',
        body: JSON.stringify({ input: 'race live request and worker' }),
      }
    )

    // The backend pauses after the chain receipt while its SQL transaction is
    // still open. Start reconciliation against that exact block so both paths
    // try to finalize the same PROCESSING row concurrently.
    let raceEventBlock = null
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const latestBlock = await publicClient.getBlockNumber({ cacheTime: 0 })
      if (latestBlock > raceStartBlock) {
        const logs = await publicClient.getLogs({
          address: escrowAddress,
          fromBlock: raceStartBlock + 1n,
          toBlock: latestBlock,
        })
        const raceLog = logs.find((log) => log.blockNumber !== null)
        if (raceLog?.blockNumber !== null && raceLog?.blockNumber !== undefined) {
          raceEventBlock = raceLog.blockNumber
          break
        }
      }
      await delay(25)
    }
    assert(raceEventBlock !== null, 'race test observes the live EarningsCredited event')

    const raceWorkerPromise = runReconcile(runtimeEnv, raceEventBlock, raceEventBlock)
    const [raceRun, raceWorkerOutput] = await Promise.all([
      raceRunPromise,
      raceWorkerPromise,
    ])
    assert(raceRun.status === 200, 'live paid-call path completes during worker race')
    assert(
      (raceWorkerOutput + backendLogs.join('')).includes(
        'conditional finalization already owned; guarded no-op'
      ),
      'losing path detects the conditional-update winner and no-ops'
    )
    assert(
      raceWorkerOutput.includes('drift clean'),
      'concurrent live/worker finalization leaves zero event-ledger drift'
    )

    const userAfterRace = await userClient('/api/dashboard')
    const earningsAfterRace = await builderClient('/api/builder/earnings')
    assert(
      Math.abs(
        interruptedUserAfterRescan.body.balance_usd -
          userAfterRace.body.balance_usd -
          0.3
      ) < 1e-9,
      'race debits the user exactly once'
    )
    assert(
      Math.abs(
        earningsAfterRace.body.earnings.available -
          earningsBeforeRace.body.earnings.available -
          0.27
      ) < 1e-9 &&
        Math.abs(
          earningsAfterRace.body.earnings.total_earned -
            earningsBeforeRace.body.earnings.total_earned -
            0.27
        ) < 1e-9,
      'race credits builder available and total earnings exactly once'
    )

    const raceDb = new Client({ connectionString: process.env.DATABASE_URL })
    await raceDb.connect()
    const raceCallRows = await raceDb.query(
      'select ac.status, count(t.id)::int as transaction_count, min(t.tx_hash) as tx_hash from agent_calls ac left join transactions t on t.agent_call_id = ac.id where ac.id = $1 group by ac.status',
      [raceRun.body.call_id]
    )
    const raceAgentStats = await raceDb.query(
      'select total_calls, total_revenue from agents where id = $1',
      [submission.body.agent.id]
    )
    await raceDb.end()
    assert(
      raceCallRows.rows[0]?.status === 'SUCCESS' &&
        raceCallRows.rows[0].transaction_count === 1 &&
        raceCallRows.rows[0].tx_hash === raceRun.body.settlement_tx_hash,
      'race leaves one SUCCESS call linked to exactly one settlement transaction'
    )
    assert(
      raceAgentStats.rows[0].total_calls === 3 &&
        Math.abs(Number(raceAgentStats.rows[0].total_revenue) - 0.9) < 1e-9,
      'race increments agent call count and revenue exactly once'
    )

    const balanceBeforeAmbiguous = await userClient('/api/dashboard')
    const earningsBeforeAmbiguous = await builderClient('/api/builder/earnings')
    const ambiguousRun = await userClient('/api/agents/' + submission.body.agent.slug + '/run', {
      method: 'POST',
      body: JSON.stringify({ input: 'force ambiguous receipt recovery' }),
    })
    assert(
      ambiguousRun.status === 503 &&
        ambiguousRun.body.code === 'SETTLEMENT_AMBIGUOUS' &&
        Boolean(ambiguousRun.body.settlement_tx_hash),
      'receipt timeout returns a durable ambiguous settlement response'
    )

    const ambiguousReceipt = await publicClient.waitForTransactionReceipt({
      hash: ambiguousRun.body.settlement_tx_hash,
    })
    const ambiguousDb = new Client({ connectionString: process.env.DATABASE_URL })
    await ambiguousDb.connect()
    const ambiguousBefore = await ambiguousDb.query(
      `select ac.status as call_status,
              sa.status as attempt_status,
              sa.tx_hash,
              cb.reserved_usd,
              count(t.id)::int as transaction_count
         from agent_calls ac
         join settlement_attempts sa on sa.agent_call_id = ac.id
         join credit_balances cb on cb.user_id = ac.user_id
         left join transactions t on t.agent_call_id = ac.id
        where ac.id = $1
        group by ac.status, sa.status, sa.tx_hash, cb.reserved_usd`,
      [ambiguousRun.body.call_id]
    )
    assert(
      ambiguousBefore.rows[0]?.call_status === 'PROCESSING' &&
        ambiguousBefore.rows[0].attempt_status === 'AMBIGUOUS' &&
        ambiguousBefore.rows[0].tx_hash === ambiguousRun.body.settlement_tx_hash &&
        Math.abs(Number(ambiguousBefore.rows[0].reserved_usd) - 0.3) < 1e-9 &&
        ambiguousBefore.rows[0].transaction_count === 0,
      'ambiguous receipt keeps one durable hash and reserves funds without applying the ledger'
    )

    const ambiguousWorkerOutput = await runReconcile(
      runtimeEnv,
      ambiguousReceipt.blockNumber,
      ambiguousReceipt.blockNumber
    )
    assert(
      ambiguousWorkerOutput.includes('drift clean'),
      'worker reconciles the ambiguous receipt without ledger drift'
    )

    const balanceAfterAmbiguous = await userClient('/api/dashboard')
    const earningsAfterAmbiguous = await builderClient('/api/builder/earnings')
    assert(
      Math.abs(
        balanceBeforeAmbiguous.body.balance_usd -
          balanceAfterAmbiguous.body.balance_usd -
          0.3
      ) < 1e-9,
      'ambiguous recovery debits the reserved user amount exactly once'
    )
    assert(
      Math.abs(
        earningsAfterAmbiguous.body.earnings.available -
          earningsBeforeAmbiguous.body.earnings.available -
          0.27
      ) < 1e-9,
      'ambiguous recovery credits the builder exactly once'
    )

    const ambiguousAfter = await ambiguousDb.query(
      `select ac.status as call_status,
              sa.status as attempt_status,
              cb.reserved_usd,
              count(t.id)::int as transaction_count
         from agent_calls ac
         join settlement_attempts sa on sa.agent_call_id = ac.id
         join credit_balances cb on cb.user_id = ac.user_id
         left join transactions t on t.agent_call_id = ac.id
        where ac.id = $1
        group by ac.status, sa.status, cb.reserved_usd`,
      [ambiguousRun.body.call_id]
    )
    await ambiguousDb.end()
    assert(
      ambiguousAfter.rows[0]?.call_status === 'SUCCESS' &&
        ambiguousAfter.rows[0].attempt_status === 'APPLIED' &&
        Math.abs(Number(ambiguousAfter.rows[0].reserved_usd)) < 1e-9 &&
        ambiguousAfter.rows[0].transaction_count === 1,
      'worker closes AMBIGUOUS to APPLIED, releases reservation, and inserts one ledger row'
    )

    const balanceBeforeUnknownBroadcast = await userClient('/api/dashboard')
    const earningsBeforeUnknownBroadcast = await builderClient('/api/builder/earnings')
    const unknownBroadcastStart = await publicClient.getBlockNumber({ cacheTime: 0 })
    const unknownBroadcastRun = await userClient(
      '/api/agents/' + submission.body.agent.slug + '/run',
      {
        method: 'POST',
        body: JSON.stringify({ input: 'force unknown broadcast recovery' }),
      }
    )
    assert(
      unknownBroadcastRun.status === 503 &&
        unknownBroadcastRun.body.code === 'SETTLEMENT_AMBIGUOUS' &&
        !unknownBroadcastRun.body.settlement_tx_hash,
      'lost broadcast response preserves a recoverable call without claiming a tx hash'
    )

    const unknownBroadcastHead = await publicClient.getBlockNumber({ cacheTime: 0 })
    const unknownBroadcastLogs = await publicClient.getLogs({
      address: escrowAddress,
      fromBlock: unknownBroadcastStart + 1n,
      toBlock: unknownBroadcastHead,
    })
    const unknownBroadcastLog = unknownBroadcastLogs.find(
      (log) => log.blockNumber !== null && log.transactionHash
    )
    assert(Boolean(unknownBroadcastLog), 'unknown broadcast transaction actually confirms onchain')

    const unknownDb = new Client({ connectionString: process.env.DATABASE_URL })
    await unknownDb.connect()
    const unknownBefore = await unknownDb.query(
      `select ac.status as call_status,
              sa.status as attempt_status,
              sa.tx_hash,
              sa.attempt_count,
              cb.reserved_usd,
              count(t.id)::int as transaction_count
         from agent_calls ac
         join settlement_attempts sa on sa.agent_call_id = ac.id
         join credit_balances cb on cb.user_id = ac.user_id
         left join transactions t on t.agent_call_id = ac.id
        where ac.id = $1
        group by ac.status, sa.status, sa.tx_hash, sa.attempt_count, cb.reserved_usd`,
      [unknownBroadcastRun.body.call_id]
    )
    assert(
      unknownBefore.rows[0]?.call_status === 'PROCESSING' &&
        unknownBefore.rows[0].attempt_status === 'AMBIGUOUS' &&
        unknownBefore.rows[0].tx_hash === null &&
        unknownBefore.rows[0].attempt_count === 1 &&
        Math.abs(Number(unknownBefore.rows[0].reserved_usd) - 0.3) < 1e-9 &&
        unknownBefore.rows[0].transaction_count === 0,
      'unknown broadcast outcome remains reserved and unapplied before chain scan'
    )

    const unknownWorkerOutput = await runReconcile(
      runtimeEnv,
      unknownBroadcastLog.blockNumber,
      unknownBroadcastLog.blockNumber
    )
    assert(
      unknownWorkerOutput.includes('drift clean'),
      'correlated event heals the unknown broadcast outcome without drift'
    )

    const balanceAfterUnknownBroadcast = await userClient('/api/dashboard')
    const earningsAfterUnknownBroadcast = await builderClient('/api/builder/earnings')
    assert(
      Math.abs(
        balanceBeforeUnknownBroadcast.body.balance_usd -
          balanceAfterUnknownBroadcast.body.balance_usd -
          0.3
      ) < 1e-9,
      'unknown broadcast recovery debits the reserved user amount exactly once'
    )
    assert(
      Math.abs(
        earningsAfterUnknownBroadcast.body.earnings.available -
          earningsBeforeUnknownBroadcast.body.earnings.available -
          0.27
      ) < 1e-9,
      'unknown broadcast recovery credits builder earnings exactly once'
    )

    const unknownAfter = await unknownDb.query(
      `select ac.status as call_status,
              sa.status as attempt_status,
              sa.tx_hash,
              cb.reserved_usd,
              count(t.id)::int as transaction_count
         from agent_calls ac
         join settlement_attempts sa on sa.agent_call_id = ac.id
         join credit_balances cb on cb.user_id = ac.user_id
         left join transactions t on t.agent_call_id = ac.id
        where ac.id = $1
        group by ac.status, sa.status, sa.tx_hash, cb.reserved_usd`,
      [unknownBroadcastRun.body.call_id]
    )
    assert(
      unknownAfter.rows[0]?.call_status === 'SUCCESS' &&
        unknownAfter.rows[0].attempt_status === 'APPLIED' &&
        unknownAfter.rows[0].tx_hash === unknownBroadcastLog.transactionHash &&
        Math.abs(Number(unknownAfter.rows[0].reserved_usd)) < 1e-9 &&
        unknownAfter.rows[0].transaction_count === 1,
      'worker records the authoritative event hash and closes unknown broadcast recovery'
    )

    await attemptLateTerminalRegression(
      runtimeEnv,
      unknownBroadcastRun.body.call_id,
      unknownBroadcastLog.transactionHash
    )
    const terminalState = await unknownDb.query(
      'select status from settlement_attempts where agent_call_id = $1',
      [unknownBroadcastRun.body.call_id]
    )
    assert(
      terminalState.rows[0]?.status === 'APPLIED',
      'late ambiguous/confirmed callbacks cannot regress an APPLIED settlement'
    )

    const earningsBeforeDynamicFee = await builderClient('/api/builder/earnings')
    const feeChangeHash = await adminWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'setPlatformFeeBps',
      args: [1250],
    })
    await publicClient.waitForTransactionReceipt({ hash: feeChangeHash })
    const dynamicFeeRun = await userClient('/api/agents/' + submission.body.agent.slug + '/run', {
      method: 'POST',
      body: JSON.stringify({ input: 'use the confirmed dynamic fee split' }),
    })
    assert(dynamicFeeRun.status === 200, 'paid call survives an authorized contract fee change')

    const dynamicFeeRow = await unknownDb.query(
      'select ac.builder_earned, ac.platform_earned, sa.builder_amount, sa.platform_amount from agent_calls ac join settlement_attempts sa on sa.agent_call_id = ac.id where ac.id = $1',
      [dynamicFeeRun.body.call_id]
    )
    const earningsAfterDynamicFee = await builderClient('/api/builder/earnings')
    assert(
      dynamicFeeRow.rows[0]?.builder_earned === '0.262500' &&
        dynamicFeeRow.rows[0]?.platform_earned === '0.037500' &&
        dynamicFeeRow.rows[0]?.builder_amount === '0.262500' &&
        dynamicFeeRow.rows[0]?.platform_amount === '0.037500' &&
        Math.abs(
          earningsAfterDynamicFee.body.earnings.available -
            earningsBeforeDynamicFee.body.earnings.available -
            0.2625
        ) < 1e-9,
      'DB and outbox use the authoritative EarningsCredited split instead of stale 90/10'
    )
    const feeResetHash = await adminWallet.writeContract({
      address: escrowAddress,
      abi: escrowArtifact.abi,
      functionName: 'setPlatformFeeBps',
      args: [1000],
    })
    await publicClient.waitForTransactionReceipt({ hash: feeResetHash })

    try {
      const quarantinedClaimHash = '0x' + 'ab'.repeat(32)
    const quarantineBlock = await publicClient.getBlockNumber({ cacheTime: 0 })
    await unknownDb.query(
      `insert into chain_events (
         id, sync_state_id, event_type, tx_hash, log_index, block_number,
         block_timestamp, actor_address, amount
       )
       select 'quarantined-claim-event', id, 'CLAIMED', $1, 999, $2, now(), $3, '999.000000'
         from chain_sync_state
        limit 1`,
      [quarantinedClaimHash, quarantineBlock.toString(), builder.address]
    )
    const quarantineOutput = await runReconcile(
      runtimeEnv,
      quarantineBlock + 1n,
      quarantineBlock
    )
    const quarantinedClaim = await unknownDb.query(
      `select ce.reconciled, ce.reconciliation_error, ec.id as claim_id
         from chain_events ce
         left join earnings_claims ec on ec.tx_hash = ce.tx_hash
        where ce.tx_hash = $1`,
      [quarantinedClaimHash]
    )
    assert(
      quarantineOutput.includes('DRIFT WARNING') &&
        quarantinedClaim.rows[0]?.reconciled === false &&
        quarantinedClaim.rows[0]?.claim_id == null &&
        quarantinedClaim.rows[0]?.reconciliation_error?.includes(
          'waiting for earlier earnings events'
        ),
      'claim backfill waits instead of clamping when earlier earnings are unresolved'
    )
      await unknownDb.query('delete from chain_events where tx_hash = $1', [quarantinedClaimHash])
    } finally {
      await unknownDb.end()
    }
    console.log(
      'MONEY LOOP VERIFIED: outbox recovery + idempotent rescan + concurrent live/worker finalization'
    )
  } finally {
    await stopChild(backend)
    await close(mockServer).catch(() => undefined)
    await evm.close().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
