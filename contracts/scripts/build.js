const solc = require('solc');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // contracts/

function findImports(importPath) {
  const local = path.join(ROOT, 'node_modules', importPath);
  if (fs.existsSync(local)) return { contents: fs.readFileSync(local, 'utf8') };
  return { error: 'not found: ' + importPath };
}

// Also compile a minimal mock ERC20 for testing
const mockErc20Source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockUSD is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {
        _mint(msg.sender, 1_000_000 * 10**6);
    }
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
`;
fs.mkdirSync(path.join(ROOT, 'contracts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'contracts', 'MockUSD.sol'), mockErc20Source);

const input = {
  language: 'Solidity',
  sources: {
    'VelostraEscrow.sol': { content: fs.readFileSync(path.join(ROOT, 'VelostraEscrow.sol'), 'utf8') },
    'MockUSD.sol': { content: mockErc20Source },
  },
  settings: {
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    optimizer: { enabled: true, runs: 200 },
  },
};

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hasError = false;
if (output.errors) {
  for (const e of output.errors) {
    console.log(e.severity.toUpperCase() + ':', e.formattedMessage);
    if (e.severity === 'error') hasError = true;
  }
}
if (hasError) process.exit(1);

const escrow = output.contracts['VelostraEscrow.sol']['VelostraEscrow'];
const mockUsd = output.contracts['MockUSD.sol']['MockUSD'];

fs.writeFileSync(path.join(ROOT, 'build', 'VelostraEscrow.json'), JSON.stringify({ abi: escrow.abi, bytecode: '0x' + escrow.evm.bytecode.object }, null, 2));
fs.writeFileSync(path.join(ROOT, 'build', 'MockUSD.json'), JSON.stringify({ abi: mockUsd.abi, bytecode: '0x' + mockUsd.evm.bytecode.object }, null, 2));

console.log('✅ Compiled VelostraEscrow + MockUSD, artifacts written to build/');
