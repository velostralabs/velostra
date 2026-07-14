/**
 * Deploy VelostraEscrow to Robinhood Chain mainnet (chainId 4663).
 *
 * Requires a .env with:
 *   DEPLOYER_PRIVATE_KEY   — funded wallet on Robinhood Chain (pays gas in ETH)
 *   SETTLEMENT_TOKEN       — address of the bridged stablecoin to use (e.g. USDG)
 *   PLATFORM_FEE_BPS       — optional, defaults to 1000 (10%)
 *   OWNER_ADDRESS          — optional, defaults to the deployer address
 *
 * Run: npm run deploy:robinhood
 */
const path = require('path')
const solc = require('solc')
const fs = require('fs')
const { ethers } = require('ethers')
require('dotenv').config()

const ROOT = path.join(__dirname, '..')

function findImports(importPath) {
  const local = path.join(ROOT, 'node_modules', importPath)
  if (fs.existsSync(local)) return { contents: fs.readFileSync(local, 'utf8') }
  return { error: 'not found: ' + importPath }
}

async function main() {
  const {
    DEPLOYER_PRIVATE_KEY,
    SETTLEMENT_TOKEN,
    PLATFORM_FEE_BPS = '1000',
    OWNER_ADDRESS,
    ROBINHOOD_RPC_URL = 'https://rpc.mainnet.chain.robinhood.com',
  } = process.env

  if (!DEPLOYER_PRIVATE_KEY) throw new Error('Set DEPLOYER_PRIVATE_KEY in contracts/.env')
  if (!SETTLEMENT_TOKEN) throw new Error('Set SETTLEMENT_TOKEN (bridged stablecoin address) in contracts/.env')

  console.log('Compiling VelostraEscrow.sol…')
  const input = {
    language: 'Solidity',
    sources: { 'VelostraEscrow.sol': { content: fs.readFileSync(path.join(ROOT, 'VelostraEscrow.sol'), 'utf8') } },
    settings: {
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      optimizer: { enabled: true, runs: 200 },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
  const errors = (output.errors || []).filter((e) => e.severity === 'error')
  if (errors.length) {
    errors.forEach((e) => console.error(e.formattedMessage))
    throw new Error('Compilation failed')
  }
  const contract = output.contracts['VelostraEscrow.sol']['VelostraEscrow']

  const provider = new ethers.JsonRpcProvider(ROBINHOOD_RPC_URL, 4663)
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider)
  const ownerAddress = OWNER_ADDRESS || wallet.address

  console.log('Deployer:', wallet.address)
  console.log('Settlement token:', SETTLEMENT_TOKEN)
  console.log('Platform fee (bps):', PLATFORM_FEE_BPS)
  console.log('Owner:', ownerAddress)

  const factory = new ethers.ContractFactory(contract.abi, contract.evm.bytecode.object, wallet)
  const escrow = await factory.deploy(SETTLEMENT_TOKEN, Number(PLATFORM_FEE_BPS), ownerAddress)
  console.log('Submitted, tx hash:', escrow.deploymentTransaction()?.hash)
  await escrow.waitForDeployment()

  const address = await escrow.getAddress()
  console.log('\n✅ VelostraEscrow deployed at:', address)
  console.log('   Explorer:', `https://robinhoodchain.blockscout.com/address/${address}`)
  console.log('\nSet this as VITE_ESCROW_ADDRESS in the frontend .env, and VITE_SETTLEMENT_TOKEN to', SETTLEMENT_TOKEN)

  fs.writeFileSync(
    path.join(ROOT, 'deployment.json'),
    JSON.stringify({ address, settlementToken: SETTLEMENT_TOKEN, owner: ownerAddress, chainId: 4663 }, null, 2)
  )
}

main().catch((err) => {
  console.error('💥 Deployment failed:', err.message || err)
  process.exit(1)
})
