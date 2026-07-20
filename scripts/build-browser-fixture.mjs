import { spawnSync } from 'node:child_process'

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('build:browser-fixture must be invoked through npm')
const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VITE_API_URL: 'http://localhost:8787',
    VITE_CHAIN_ID: '46630',
    VITE_CHAIN_RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
    VITE_CHAIN_EXPLORER_URL: 'https://explorer.testnet.chain.robinhood.com',
    VITE_ESCROW_ADDRESS: '0x1111111111111111111111111111111111111111',
    VITE_SETTLEMENT_TOKEN: '0x2222222222222222222222222222222222222222',
  },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
