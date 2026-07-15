const Ganache = require('ganache')
const { ethers } = require('ethers')
const escrowArtifact = require('../build/VelostraEscrow.json')
const usdArtifact = require('../build/MockUSD.json')

function assert(condition, message) {
  if (!condition) throw new Error('❌ ASSERTION FAILED: ' + message)
  console.log('✅', message)
}

async function assertReverts(action, message) {
  let reverted = false
  try {
    const transaction = await action()
    if (transaction?.wait) await transaction.wait()
  } catch {
    reverted = true
  }
  assert(reverted, message)
}

async function main() {
  const chain = Ganache.provider({ wallet: { totalAccounts: 12 }, logging: { quiet: true } })
  const provider = new ethers.BrowserProvider(chain)
  const accounts = await provider.send('eth_accounts', [])
  const [
    deployerAddress,
    adminAddress,
    settlerAddress,
    treasuryAddress,
    guardianAddress,
    builderAddress,
    userAddress,
    platformSinkAddress,
    successorAddress,
    replacementSettlerAddress,
  ] = accounts

  const deployer = await provider.getSigner(deployerAddress)
  const admin = await provider.getSigner(adminAddress)
  const settler = await provider.getSigner(settlerAddress)
  const treasury = await provider.getSigner(treasuryAddress)
  const guardian = await provider.getSigner(guardianAddress)
  const builder = await provider.getSigner(builderAddress)
  const user = await provider.getSigner(userAddress)
  const replacementSettler = await provider.getSigner(replacementSettlerAddress)

  console.log('\n--- Deploying MockUSD (6-decimal stablecoin) ---')
  const UsdFactory = new ethers.ContractFactory(usdArtifact.abi, usdArtifact.bytecode, deployer)
  const usd = await UsdFactory.deploy()
  await usd.waitForDeployment()
  const usdAddress = await usd.getAddress()

  console.log('\n--- Deploying role-separated VelostraEscrow ---')
  const EscrowFactory = new ethers.ContractFactory(escrowArtifact.abi, escrowArtifact.bytecode, deployer)
  const escrow = await EscrowFactory.deploy(
    usdAddress,
    1000,
    adminAddress,
    settlerAddress,
    treasuryAddress,
    guardianAddress
  )
  await escrow.waitForDeployment()
  const escrowAddress = await escrow.getAddress()

  const defaultAdminRole = await escrow.DEFAULT_ADMIN_ROLE()
  const settlerRole = await escrow.SETTLER_ROLE()
  const treasuryRole = await escrow.TREASURY_ROLE()
  const pauserRole = await escrow.PAUSER_ROLE()
  const feeManagerRole = await escrow.FEE_MANAGER_ROLE()

  console.log('\n--- TEST 1: Constructor freezes authority and token policy ---')
  assert(await escrow.hasRole(defaultAdminRole, adminAddress), 'governance address owns delayed default admin')
  assert(await escrow.hasRole(settlerRole, settlerAddress), 'backend signer owns only settlement authority')
  assert(await escrow.hasRole(treasuryRole, treasuryAddress), 'treasury address owns revenue withdrawal authority')
  assert(await escrow.hasRole(pauserRole, guardianAddress), 'independent guardian owns pause authority')
  assert(await escrow.hasRole(feeManagerRole, adminAddress), 'governance owns fee authority')
  assert((await escrow.defaultAdminDelay()) === 172800n, 'default-admin transfer delay is two days')
  assert((await escrow.SUPPORTED_TOKEN_DECIMALS()) === 6n, 'settlement token policy is fixed to six decimals')

  await assertReverts(
    () => EscrowFactory.deploy(usdAddress, 1000, ethers.ZeroAddress, settlerAddress, treasuryAddress, guardianAddress),
    'constructor rejects zero role addresses'
  )

  console.log('\n--- TEST 2: Deposits are exact and cumulative audit evidence ---')
  await (await usd.connect(deployer).transfer(userAddress, 100_000_000n)).wait()
  await (await usd.connect(user).approve(escrowAddress, 50_000_000n)).wait()
  await (await escrow.connect(user).depositCredits(50_000_000n)).wait()
  assert((await escrow.userCreditBalance(userAddress)) === 50_000_000n, 'user deposit audit counter records 50.00 mUSD')
  assert((await escrow.totalDeposited()) === 50_000_000n, 'lifetime deposit volume records exact token units')
  assert((await escrow.availableEscrowLiquidity()) === 50_000_000n, 'unallocated escrow liquidity equals deposited funds')
  assert(await escrow.isSolvent(), 'escrow starts solvent')

  await (await usd.connect(user).approve(escrowAddress, 500_000n)).wait()
  await assertReverts(
    () => escrow.connect(user).depositCredits(500_000n),
    'deposit below the fixed one-dollar minimum reverts'
  )

  console.log('\n--- TEST 3: Builder lifecycle and settler boundary ---')
  const uninitializedCallId = ethers.keccak256(ethers.toUtf8Bytes('uninitialized'))
  await assertReverts(
    () => escrow.connect(settler).creditBuilderEarnings(builderAddress, 1_000_000n, uninitializedCallId),
    'settlement requires an initialized builder'
  )
  await (await escrow.connect(builder).initializeBuilder()).wait()
  await assertReverts(
    () => escrow.connect(builder).initializeBuilder(),
    'builder initialization cannot be replayed'
  )

  const unauthorizedCallId = ethers.keccak256(ethers.toUtf8Bytes('unauthorized'))
  await assertReverts(
    () => escrow.connect(admin).creditBuilderEarnings(builderAddress, 1_000_000n, unauthorizedCallId),
    'governance cannot bypass the dedicated settler role'
  )
  await assertReverts(
    () => escrow.connect(settler).withdrawPlatformRevenue(platformSinkAddress, 1n),
    'settler cannot withdraw treasury revenue'
  )
  await assertReverts(
    () => escrow.connect(settler).setPlatformFeeBps(900),
    'settler cannot change platform economics'
  )
  await assertReverts(
    () => escrow.connect(settler).pause(),
    'settler cannot activate emergency pause'
  )

  console.log('\n--- TEST 4: Correlated settlement creates fully collateralized liabilities ---')
  const primaryCallId = ethers.keccak256(ethers.toUtf8Bytes('agent-call-primary'))
  const creditReceipt = await (
    await escrow.connect(settler).creditBuilderEarnings(builderAddress, 2_000_000n, primaryCallId)
  ).wait()
  const earningsEvent = creditReceipt.logs
    .map((log) => {
      try { return escrow.interface.parseLog(log) } catch { return null }
    })
    .find((event) => event?.name === 'EarningsCredited')
  assert(earningsEvent?.args.callId === primaryCallId, 'EarningsCredited emits the durable bytes32 callId')
  assert((await escrow.settledCallIds(primaryCallId)) === true, 'contract records the call as settled')

  const builderAccount = await escrow.getBuilderAccount(builderAddress)
  assert(builderAccount.availableToClaim === 1_800_000n, 'builder receives the deterministic 90% cut')
  assert((await escrow.platformRevenueAvailable()) === 200_000n, 'platform receives the deterministic 10% cut')
  assert((await escrow.totalBuilderLiability()) === 1_800_000n, 'aggregate builder liability is tracked')
  assert((await escrow.totalLiabilities()) === 2_000_000n, 'all outstanding liabilities are explicit')
  assert((await escrow.availableEscrowLiquidity()) === 48_000_000n, 'available liquidity excludes outstanding liabilities')
  assert(await escrow.isSolvent(), 'escrow remains solvent after settlement')

  console.log('\n--- TEST 5: Duplicate and undercollateralized settlements fail closed ---')
  await assertReverts(
    () => escrow.connect(settler).creditBuilderEarnings(builderAddress, 2_000_000n, primaryCallId),
    'duplicate callId settlement reverts'
  )
  const oversizedCallId = ethers.keccak256(ethers.toUtf8Bytes('oversized'))
  await assertReverts(
    () => escrow.connect(settler).creditBuilderEarnings(builderAddress, 49_000_000n, oversizedCallId),
    'settlement cannot create liabilities beyond token collateral'
  )

  console.log('\n--- TEST 6: Emergency pause stops new risk but preserves earned exits ---')
  await (await escrow.connect(guardian).pause()).wait()
  assert(await escrow.paused(), 'guardian can pause the contract')
  await assertReverts(
    () => escrow.connect(user).depositCredits(1_000_000n),
    'pause blocks new deposits'
  )
  const pausedCallId = ethers.keccak256(ethers.toUtf8Bytes('paused'))
  await assertReverts(
    () => escrow.connect(settler).creditBuilderEarnings(builderAddress, 1_000_000n, pausedCallId),
    'pause blocks new settlement liabilities'
  )
  await (await escrow.connect(builder).claimEarnings(1_000_000n)).wait()
  assert((await usd.balanceOf(builderAddress)) === 1_000_000n, 'builder can exit already-earned funds while paused')
  assert((await escrow.totalBuilderLiability()) === 800_000n, 'claim atomically reduces aggregate builder liability')
  await assertReverts(
    () => escrow.connect(guardian).unpause(),
    'pause guardian cannot unpause without governance'
  )
  await (await escrow.connect(admin).unpause()).wait()

  console.log('\n--- TEST 7: Treasury and fee authorities remain separated ---')
  await (await escrow.connect(treasury).withdrawPlatformRevenue(platformSinkAddress, 200_000n)).wait()
  assert((await usd.balanceOf(platformSinkAddress)) === 200_000n, 'treasury routes only available platform revenue')
  assert((await escrow.platformRevenueAvailable()) === 0n, 'withdrawal reduces platform liability')
  await assertReverts(
    () => escrow.connect(admin).withdrawPlatformRevenue(platformSinkAddress, 1n),
    'governance cannot bypass the treasury role'
  )
  await assertReverts(
    () => escrow.connect(admin).setPlatformFeeBps(6000),
    'fee hard cap remains 50%'
  )
  await (await escrow.connect(admin).setPlatformFeeBps(1500)).wait()
  assert((await escrow.platformFeeBps()) === 1500n, 'fee manager updates fee within the hard cap')

  console.log('\n--- TEST 8: Settler rotation revokes compromised authority ---')
  await (await escrow.connect(admin).grantRole(settlerRole, replacementSettlerAddress)).wait()
  await (await escrow.connect(admin).revokeRole(settlerRole, settlerAddress)).wait()
  const rotatedCallId = ethers.keccak256(ethers.toUtf8Bytes('rotated-settler'))
  await assertReverts(
    () => escrow.connect(settler).creditBuilderEarnings(builderAddress, 1_000_000n, rotatedCallId),
    'revoked settler can no longer settle calls'
  )
  await (
    await escrow.connect(replacementSettler).creditBuilderEarnings(builderAddress, 1_000_000n, rotatedCallId)
  ).wait()
  assert((await escrow.totalVolume()) === 3_000_000n, 'replacement settler resumes correlated settlement')
  assert((await escrow.totalPlatformRevenue()) === 350_000n, 'lifetime platform revenue tracks fee changes')
  assert((await escrow.totalBuilderLiability()) === 1_650_000n, 'builder liability reflects claims and rotated settlement')

  console.log('\n--- TEST 9: Migration declaration creates a claims-only predecessor ---')
  await assertReverts(
    () => escrow.connect(treasury).migrateAvailableLiquidity(),
    'liquidity cannot migrate before governance declares a successor'
  )
  await (await escrow.connect(guardian).pause()).wait()
  await (await escrow.connect(admin).declareSuccessorEscrow(successorAddress)).wait()
  assert((await escrow.successorEscrow()) === ethers.getAddress(successorAddress), 'paused governance declares one successor escrow')
  await assertReverts(
    () => escrow.connect(admin).declareSuccessorEscrow(userAddress),
    'successor declaration is immutable'
  )
  const deprecatedCallId = ethers.keccak256(ethers.toUtf8Bytes('deprecated'))
  await assertReverts(
    () => escrow.connect(replacementSettler).creditBuilderEarnings(builderAddress, 1_000_000n, deprecatedCallId),
    'deprecated paused escrow cannot accept new settlements'
  )
  await (await escrow.connect(admin).unpause()).wait()
  await assertReverts(
    () => escrow.connect(replacementSettler).creditBuilderEarnings(builderAddress, 1_000_000n, deprecatedCallId),
    'successor declaration permanently blocks new settlement even after unpause'
  )
  await assertReverts(
    () => escrow.connect(replacementSettler).migrateAvailableLiquidity(),
    'settler cannot migrate unencumbered liquidity'
  )
  await (await escrow.connect(treasury).migrateAvailableLiquidity()).wait()
  assert((await usd.balanceOf(successorAddress)) === 47_000_000n, 'treasury migrates exactly the unencumbered liquidity to the successor')
  assert((await usd.balanceOf(escrowAddress)) === 1_800_000n, 'predecessor retains exact backing for every outstanding liability')
  assert((await escrow.availableEscrowLiquidity()) === 0n, 'no migratable liquidity remains after migration')
  await assertReverts(
    () => escrow.connect(treasury).migrateAvailableLiquidity(),
    'empty liquidity migration fails closed'
  )
  assert(await escrow.isSolvent(), 'liquidity migration cannot undercollateralize predecessor liabilities')

  await (await escrow.connect(builder).claimEarnings(1_650_000n)).wait()
  await (await escrow.connect(treasury).withdrawPlatformRevenue(platformSinkAddress, 150_000n)).wait()
  assert((await escrow.totalLiabilities()) === 0n, 'all predecessor liabilities can exit after deprecation')
  assert(await escrow.isSolvent(), 'predecessor remains solvent through final exits')
  assert((await escrow.userCreditBalance(userAddress)) === 50_000_000n, 'cumulative deposit audit counter never masquerades as spendable balance')

  console.log('\n--- TEST 10: Lifetime accounting remains internally consistent ---')
  const finalBuilder = await escrow.getBuilderAccount(builderAddress)
  assert(finalBuilder.totalEarned === 2_650_000n, 'builder lifetime earned equals all credited builder cuts')
  assert(finalBuilder.totalClaimed === 2_650_000n, 'builder lifetime claims equal exited earnings')
  assert(finalBuilder.availableToClaim === 0n, 'builder has no residual claim after full exit')
  assert((await escrow.totalDeposited()) === 50_000_000n, 'lifetime deposits remain exact')
  assert((await escrow.totalVolume()) === 3_000_000n, 'lifetime gross settled volume remains exact')
  assert((await escrow.totalPlatformRevenue()) === 350_000n, 'lifetime platform revenue remains exact')

  console.log('\n🎉 ALL 10 PHASE-1 CONTRACT GROUPS PASSED — authority, pause, solvency, rotation, and migration behavior verified.\n')
  process.exit(0)
}

main().catch((error) => {
  console.error('\n💥 TEST SUITE FAILED\n', error)
  process.exit(1)
})
