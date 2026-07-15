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
      REDIS_URL: 'redis://127.0.0.1:6399',
      VELOSTRA_ESCROW_ADDRESS: escrowAddress,
      BACKEND_SIGNER_PRIVATE_KEY: keys[0],
      SETTLEMENT_TOKEN_DECIMALS: '6',
      ROBINHOOD_RPC_URL: RPC,
      ROBINHOOD_CHAIN_ID: '4663',
      ONCHAIN_SETTLEMENT_MODE: 'required',
      FREE_TIER_CALLS_PER_MONTH: '0',
      AGENT_TIMEOUT_MS: '5000',
      VELOSTRA_DEPLOYMENT_BLOCK: String(escrowDeployReceipt.blockNumber),
      RECONCILE_CONFIRMATIONS: '0',
      RECONCILE_MAX_BLOCK_RANGE: '3',
      RECONCILE_RPC_RETRIES: '2',
      RECONCILE_TEST_FAIL_AFTER_SETTLEMENT_INPUT: 'force post-settlement rollback',
      RECONCILE_TEST_PAUSE_AFTER_SETTLEMENT_INPUT: 'race live request and worker',
      RECONCILE_TEST_PAUSE_AFTER_SETTLEMENT_MS: '2500',
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

    await runReconcile(
      runtimeEnv,
      escrowDeployReceipt.blockNumber,
      platformWithdrawalReceipt.blockNumber
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
      raceWorkerOutput.includes('correlated call already finalized; no-op'),
      'losing reconciliation path detects the conditional-update winner and no-ops'
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

    console.log(
      'MONEY LOOP VERIFIED: recovery + idempotent rescan + concurrent live/worker finalization'
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
