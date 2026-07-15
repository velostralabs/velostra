/**
 * Deploy VelostraEscrow to Robinhood Chain (chainId 4663).
 *
 * Role separation is mandatory:
 *   DEPLOYER_PRIVATE_KEY   — funded deployment-only wallet
 *   SETTLEMENT_TOKEN       — audited 6-decimal settlement token
 *   ADMIN_ADDRESS          — governance multisig contract
 *   SETTLER_ADDRESS        — backend settlement signer
 *   TREASURY_ADDRESS       — treasury receiver/operator
 *   PAUSE_GUARDIAN_ADDRESS — independent emergency guardian
 *   PLATFORM_FEE_BPS       — optional, defaults to 1000 (10%)
 */
const path = require('path')
const solc = require('solc')
const fs = require('fs')
const { ethers } = require('ethers')
require('dotenv').config()

const ROOT = path.join(__dirname, '..')
const CHAIN_ID = 4663

function findImports(importPath) {
  const local = path.join(ROOT, 'node_modules', importPath)
  if (fs.existsSync(local)) return { contents: fs.readFileSync(local, 'utf8') }
  return { error: 'not found: ' + importPath }
}

function requiredAddress(name, value) {
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be an explicit non-zero EVM address`)
  }
  return ethers.getAddress(value)
}

async function main() {
  const {
    DEPLOYER_PRIVATE_KEY,
    SETTLEMENT_TOKEN,
    PLATFORM_FEE_BPS = '1000',
    ADMIN_ADDRESS,
    SETTLER_ADDRESS,
    TREASURY_ADDRESS,
    PAUSE_GUARDIAN_ADDRESS,
    ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com',
  } = process.env

  if (!DEPLOYER_PRIVATE_KEY) throw new Error('Set DEPLOYER_PRIVATE_KEY in contracts/.env')

  const tokenAddress = requiredAddress('SETTLEMENT_TOKEN', SETTLEMENT_TOKEN)
  const adminAddress = requiredAddress('ADMIN_ADDRESS', ADMIN_ADDRESS)
  const settlerAddress = requiredAddress('SETTLER_ADDRESS', SETTLER_ADDRESS)
  const treasuryAddress = requiredAddress('TREASURY_ADDRESS', TREASURY_ADDRESS)
  const pauseGuardianAddress = requiredAddress('PAUSE_GUARDIAN_ADDRESS', PAUSE_GUARDIAN_ADDRESS)
  const separated = new Set([
    adminAddress,
    settlerAddress,
    treasuryAddress,
    pauseGuardianAddress,
  ].map((address) => address.toLowerCase()))
  if (separated.size !== 4) {
    throw new Error('ADMIN, SETTLER, TREASURY, and PAUSE_GUARDIAN must be distinct addresses')
  }

  const feeBps = Number(PLATFORM_FEE_BPS)
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5000) {
    throw new Error('PLATFORM_FEE_BPS must be an integer between 0 and 5000')
  }

  console.log('Compiling VelostraEscrow.sol…')
  const input = {
    language: 'Solidity',
    sources: {
      'VelostraEscrow.sol': {
        content: fs.readFileSync(path.join(ROOT, 'VelostraEscrow.sol'), 'utf8'),
      },
    },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error')
  if (errors.length) {
    errors.forEach((entry) => console.error(entry.formattedMessage))
    throw new Error('Compilation failed')
  }
  const contract = output.contracts['VelostraEscrow.sol']['VelostraEscrow']

  const provider = new ethers.JsonRpcProvider(ROBINHOOD_RPC_URL, CHAIN_ID)
  const network = await provider.getNetwork()
  if (network.chainId !== BigInt(CHAIN_ID)) {
    throw new Error(`RPC chain mismatch: expected ${CHAIN_ID}, received ${network.chainId}`)
  }

  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider)
  const adminCode = await provider.getCode(adminAddress)
  if (adminCode === '0x') {
    throw new Error('ADMIN_ADDRESS must be a deployed multisig contract')
  }

  const token = new ethers.Contract(
    tokenAddress,
    ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'],
    provider
  )
  const [tokenDecimals, tokenSymbol] = await Promise.all([token.decimals(), token.symbol()])
  if (tokenDecimals !== 6n) {
    throw new Error(`Settlement token must use 6 decimals; ${tokenSymbol} reports ${tokenDecimals}`)
  }

  console.log('Deployer:', wallet.address)
  console.log('Settlement token:', `${tokenSymbol} ${tokenAddress}`)
  console.log('Platform fee (bps):', feeBps)
  console.log('Governance multisig:', adminAddress)
  console.log('Settler:', settlerAddress)
  console.log('Treasury:', treasuryAddress)
  console.log('Pause guardian:', pauseGuardianAddress)

  const factory = new ethers.ContractFactory(contract.abi, contract.evm.bytecode.object, wallet)
  const escrow = await factory.deploy(
    tokenAddress,
    feeBps,
    adminAddress,
    settlerAddress,
    treasuryAddress,
    pauseGuardianAddress
  )
  console.log('Submitted, tx hash:', escrow.deploymentTransaction()?.hash)
  await escrow.waitForDeployment()

  const address = await escrow.getAddress()
  const deploymentBlock = await provider.getBlockNumber()
  console.log('\n✅ VelostraEscrow deployed at:', address)
  console.log('   Explorer:', `https://robinhoodchain.blockscout.com/address/${address}`)
  console.log('   Deployment block:', deploymentBlock)

  fs.writeFileSync(
    path.join(ROOT, 'deployment.json'),
    JSON.stringify({
      address,
      chainId: CHAIN_ID,
      deploymentBlock,
      settlementToken: tokenAddress,
      settlementTokenDecimals: Number(tokenDecimals),
      platformFeeBps: feeBps,
      roles: {
        admin: adminAddress,
        settler: settlerAddress,
        treasury: treasuryAddress,
        pauseGuardian: pauseGuardianAddress,
      },
    }, null, 2)
  )
}

main().catch((error) => {
  console.error('💥 Deployment failed:', error.message || error)
  process.exit(1)
})
