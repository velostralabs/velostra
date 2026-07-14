import { privateKeyToAccount } from 'viem/accounts'

const BASE = process.env.TEST_API_URL || 'http://localhost:8787'
const ADMIN_PK = process.env.TEST_ADMIN_PK
if (!ADMIN_PK) {
  throw new Error('Set TEST_ADMIN_PK to a private key whose address matches ADMIN_WALLET in .env')
}

function makeClient() {
  let cookieJar = ''
  return async function req(path, opts = {}) {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(cookieJar ? { Cookie: cookieJar } : {}), ...(opts.headers || {}) },
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookieJar = setCookie.split(';')[0]
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body }
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('FAILED: ' + msg)
  console.log('✅', msg)
}

async function signIn(client, account) {
  const nonceRes = await client('/api/auth/nonce', { method: 'POST', body: JSON.stringify({ walletAddress: account.address }) })
  const signature = await account.signMessage({ message: nonceRes.body.message })
  return client('/api/auth/login', { method: 'POST', body: JSON.stringify({ walletAddress: account.address, signature }) })
}

async function main() {
  const { generatePrivateKey } = await import('viem/accounts')
  const adminAccount = privateKeyToAccount(ADMIN_PK)

  const builderClient = makeClient()
  const builderAccount = privateKeyToAccount(generatePrivateKey())

  console.log('\n--- BUILDER: sign in, register, submit agent ---')
  await signIn(builderClient, builderAccount)
  await builderClient('/api/builder/register', { method: 'POST', body: JSON.stringify({ display_name: 'Full E2E Builder 2' }) })
  const submit = await builderClient('/api/builder/agents', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Full E2E Agent 2',
      description: 'An agent used to verify the complete marketplace flow end to end',
      category: 'PRODUCTIVITY',
      endpoint_url: 'http://localhost:9099/run',
      price_per_call: 0.3,
    }),
  })
  assert(submit.status === 200, 'agent submitted successfully')
  const slug = submit.body.agent.slug

  console.log('\n--- ADMIN: sign in, see pending agent, approve it ---')
  const adminClient = makeClient()
  const adminLogin = await signIn(adminClient, adminAccount)
  assert(adminLogin.status === 200 && adminLogin.body.user.is_admin === true, 'admin logs in with is_admin=true')

  const pending = await adminClient('/api/admin/agents/pending')
  assert(pending.status === 200, 'admin can access the pending queue')
  const found = pending.body.agents.find((a) => a.name === 'Full E2E Agent 2')
  assert(!!found, 'submitted agent appears in the pending queue')

  const decide = await adminClient(`/api/admin/agents/${found.id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'APPROVE' }),
  })
  assert(decide.status === 200 && decide.body.agent.status === 'APPROVED', 'admin approves the agent')

  console.log('\n--- MARKETPLACE: approved agent is now publicly visible ---')
  const market = await builderClient('/api/agents')
  const inMarket = market.body.agents.find((a) => a.slug === slug)
  assert(!!inMarket, 'approved agent now shows up in the public marketplace')

  console.log('\n--- USER: sign in, run the agent on free tier ---')
  const userClient = makeClient()
  const userAccount = privateKeyToAccount(generatePrivateKey())
  await signIn(userClient, userAccount)
  const run = await userClient(`/api/agents/${slug}/run`, { method: 'POST', body: JSON.stringify({ input: 'hello from e2e test' }) })
  assert(run.status === 200, 'agent runs successfully against a real HTTP endpoint (local mock agent)')
  assert(run.body.is_free_tier === true, "first call correctly uses the user's free tier")

  console.log('\n--- USER: leave a review ---')
  const review = await userClient(`/api/agents/${slug}/review`, { method: 'POST', body: JSON.stringify({ rating: 5, comment: 'Worked great in the e2e test' }) })
  assert(review.status === 200, 'review submission succeeds')

  console.log('\n--- ADMIN: platform stats reflect the activity ---')
  const stats = await adminClient('/api/admin/stats')
  assert(stats.status === 200 && stats.body.live_agents >= 1, 'platform stats show at least one live agent')
  console.log('   stats:', JSON.stringify(stats.body))

  console.log('\n--- USER: dashboard shows the call history ---')
  const dash = await userClient('/api/dashboard')
  assert(dash.status === 200 && dash.body.recent_calls.length >= 1, "user's dashboard shows the call just made")

  console.log('\n🎉 FULL PLATFORM FLOW VERIFIED LIVE: signup → submit → approve → browse → run → review → stats → dashboard\n')
}

main().catch((e) => {
  console.error('💥', e)
  process.exit(1)
})
