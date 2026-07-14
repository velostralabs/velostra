const Ganache = require('ganache')
const { ethers } = require('ethers')
const escrowArtifact = require('../build/VelostraEscrow.json')
const usdArtifact = require('../build/MockUSD.json')

function assert(cond, msg) {
  if (!cond) throw new Error('❌ ASSERTION FAILED: ' + msg)
  console.log('✅', msg)
}

async function main() {
  const server = Ganache.provider({ wallet: { totalAccounts: 5 }, logging: { quiet: true } })
  const provider = new ethers.BrowserProvider(server)

  const accounts = await provider.send('eth_accounts', [])
  const [ownerAddr, builderAddr, userAddr, platformSinkAddr] = accounts

  const owner = await provider.getSigner(ownerAddr)
  const builder = await provider.getSigner(builderAddr)
  const user = await provider.getSigner(userAddr)

  console.log('\n--- Deploying MockUSD (6-decimal stablecoin) ---')
  const UsdFactory = new ethers.ContractFactory(usdArtifact.abi, usdArtifact.bytecode, owner)
  const usd = await UsdFactory.deploy()
  await usd.waitForDeployment()
  console.log('MockUSD deployed at', await usd.getAddress())

  console.log('\n--- Deploying VelostraEscrow (10% platform fee) ---')
  const EscrowFactory = new ethers.ContractFactory(escrowArtifact.abi, escrowArtifact.bytecode, owner)
  const escrow = await EscrowFactory.deploy(await usd.getAddress(), 1000, ownerAddr)
  await escrow.waitForDeployment()
  const escrowAddr = await escrow.getAddress()
  console.log('VelostraEscrow deployed at', escrowAddr)

  const primaryCallId = ethers.keccak256(ethers.toUtf8Bytes('agent-call-primary'))
  const uninitializedCallId = ethers.keccak256(ethers.toUtf8Bytes('agent-call-uninitialized'))
  const unauthorizedCallId = ethers.keccak256(ethers.toUtf8Bytes('agent-call-unauthorized'))

  // Fund user with 100 mUSD
  await (await usd.connect(owner).transfer(userAddr, 100_000_000n)).wait() // 100.00 * 1e6

  console.log('\n--- TEST 1: User deposits credits ---')
  await (await usd.connect(user).approve(escrowAddr, 50_000_000n)).wait()
  await (await escrow.connect(user).depositCredits(50_000_000n)).wait()
  const userCredit = await escrow.userCreditBalance(userAddr)
  assert(userCredit === 50_000_000n, `user credit balance is 50.00 mUSD (got ${userCredit})`)

  console.log('\n--- TEST 2: Deposit below minimum reverts ---')
  await (await usd.connect(user).approve(escrowAddr, 500_000n)).wait()
  let reverted = false
  try {
    await escrow.connect(user).depositCredits(500_000n) // $0.50, below $1 MIN_TOPUP
  } catch {
    reverted = true
  }
  assert(reverted, 'depositing below MIN_TOPUP reverts')

  console.log('\n--- TEST 3: Builder must initialize before earning credits ---')
  let notInitReverted = false
  try {
    await escrow
      .connect(owner)
      .creditBuilderEarnings(builderAddr, 1_000_000n, uninitializedCallId)
  } catch {
    notInitReverted = true
  }
  assert(notInitReverted, 'crediting an uninitialized builder reverts')

  await (await escrow.connect(builder).initializeBuilder()).wait()
  const builderAcctBefore = await escrow.getBuilderAccount(builderAddr)
  assert(builderAcctBefore.initialized === true, 'builder account is now initialized')

  console.log('\n--- TEST 4: Platform credits a $2.00 call, 90/10 split applies ---')
  const creditReceipt = await (
    await escrow.connect(owner).creditBuilderEarnings(builderAddr, 2_000_000n, primaryCallId)
  ).wait()
  const earningsEvent = creditReceipt.logs
    .map((log) => {
      try {
        return escrow.interface.parseLog(log)
      } catch {
        return null
      }
    })
    .find((event) => event?.name === 'EarningsCredited')
  assert(earningsEvent?.args.callId === primaryCallId, 'EarningsCredited emits the correlated bytes32 callId')
  assert(await escrow.settledCallIds(primaryCallId), 'contract records the callId as settled')

  const builderAcct = await escrow.getBuilderAccount(builderAddr)
  assert(builderAcct.availableToClaim === 1_800_000n, `builder gets 90% = 1.80 mUSD (got ${builderAcct.availableToClaim})`)

  const platformRevenue = await escrow.platformRevenueAvailable()
  assert(platformRevenue === 200_000n, `platform gets 10% = 0.20 mUSD (got ${platformRevenue})`)

  console.log('\n--- TEST 5: A callId cannot settle twice ---')
  let duplicateCallReverted = false
  try {
    await (
      await escrow.connect(owner).creditBuilderEarnings(builderAddr, 2_000_000n, primaryCallId)
    ).wait()
  } catch {
    duplicateCallReverted = true
  }
  assert(duplicateCallReverted, 'duplicate callId settlement reverts')

  console.log('\n--- TEST 6: Only owner (platform) can credit earnings ---')
  let unauthorizedReverted = false
  try {
    await escrow
      .connect(user)
      .creditBuilderEarnings(builderAddr, 1_000_000n, unauthorizedCallId)
  } catch {
    unauthorizedReverted = true
  }
  assert(unauthorizedReverted, 'non-owner cannot call creditBuilderEarnings')

  console.log('\n--- TEST 7: Builder claims earnings to their own wallet ---')
  const escrowUsdBefore = await usd.balanceOf(escrowAddr)
  await (await escrow.connect(builder).claimEarnings(1_800_000n)).wait()
  const builderUsdBalance = await usd.balanceOf(builderAddr)
  assert(builderUsdBalance === 1_800_000n, `builder wallet received 1.80 mUSD (got ${builderUsdBalance})`)

  const escrowUsdAfter = await usd.balanceOf(escrowAddr)
  assert(escrowUsdBefore - escrowUsdAfter === 1_800_000n, 'escrow contract balance decreased by exactly the claim amount')

  console.log('\n--- TEST 8: Cannot claim more than available ---')
  let overclaimReverted = false
  try {
    await escrow.connect(builder).claimEarnings(1_000_000n)
  } catch {
    overclaimReverted = true
  }
  assert(overclaimReverted, 'claiming more than availableToClaim reverts')

  console.log('\n--- TEST 9: Platform owner withdraws platform revenue ---')
  await (await escrow.connect(owner).withdrawPlatformRevenue(platformSinkAddr, 200_000n)).wait()
  const sinkBalance = await usd.balanceOf(platformSinkAddr)
  assert(sinkBalance === 200_000n, `platform sink received 0.20 mUSD (got ${sinkBalance})`)

  console.log('\n--- TEST 10: Fee cap enforced (cannot set > 50%) ---')
  let feeCapReverted = false
  try {
    await escrow.connect(owner).setPlatformFeeBps(6000)
  } catch {
    feeCapReverted = true
  }
  assert(feeCapReverted, 'setting platform fee above 50% reverts')

  await (await escrow.connect(owner).setPlatformFeeBps(1500)).wait()
  const newFee = await escrow.platformFeeBps()
  assert(newFee === 1500n, 'platform fee updated to 15% by owner')

  console.log('\n--- TEST 11: Total volume + revenue accounting ---')
  const totalVolume = await escrow.totalVolume()
  const totalPlatformRevenue = await escrow.totalPlatformRevenue()
  assert(totalVolume === 2_000_000n, `totalVolume tracks gross call value (got ${totalVolume})`)
  assert(totalPlatformRevenue === 200_000n, `totalPlatformRevenue tracks lifetime platform cut (got ${totalPlatformRevenue})`)

  console.log('\n🎉 ALL 11 TEST GROUPS PASSED — VelostraEscrow behaves correctly on a live local EVM.\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('\n💥 TEST SUITE FAILED\n', err)
  process.exit(1)
})
