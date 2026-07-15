const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const solc = require('solc')

const ROOT = path.join(__dirname, '..')
const optimizer = { enabled: true, runs: 200 }

function findImports(importPath) {
  const local = path.join(ROOT, 'node_modules', importPath)
  if (fs.existsSync(local)) return { contents: fs.readFileSync(local, 'utf8') }
  return { error: 'not found: ' + importPath }
}

const mockErc20Source = fs.readFileSync(
  path.join(ROOT, 'contracts', 'MockUSD.sol'),
  'utf8'
)

const input = {
  language: 'Solidity',
  sources: {
    'VelostraEscrow.sol': {
      content: fs.readFileSync(path.join(ROOT, 'VelostraEscrow.sol'), 'utf8'),
    },
    'MockUSD.sol': { content: mockErc20Source },
  },
  settings: {
    outputSelection: {
      '*': {
        '*': [
          'abi',
          'metadata',
          'evm.bytecode.object',
          'evm.deployedBytecode.object',
          'evm.deployedBytecode.immutableReferences',
        ],
      },
    },
    optimizer,
  },
}

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true })
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
let hasError = false
for (const entry of output.errors ?? []) {
  console.log(entry.severity.toUpperCase() + ':', entry.formattedMessage)
  if (entry.severity === 'error') hasError = true
}
if (hasError) process.exit(1)

function artifact(contract) {
  return {
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object,
    deployedBytecode: '0x' + contract.evm.deployedBytecode.object,
    immutableReferences: contract.evm.deployedBytecode.immutableReferences ?? {},
    compiler: {
      version: solc.version(),
      optimizer,
      metadataSha256: crypto
        .createHash('sha256')
        .update(contract.metadata)
        .digest('hex'),
    },
  }
}

const escrow = output.contracts['VelostraEscrow.sol'].VelostraEscrow
const mockUsd = output.contracts['MockUSD.sol'].MockUSD
fs.writeFileSync(
  path.join(ROOT, 'build', 'VelostraEscrow.json'),
  JSON.stringify(artifact(escrow), null, 2) + '\n'
)
fs.writeFileSync(
  path.join(ROOT, 'build', 'MockUSD.json'),
  JSON.stringify(artifact(mockUsd), null, 2) + '\n'
)
console.log('Compiled VelostraEscrow + MockUSD with reproducible runtime metadata.')
