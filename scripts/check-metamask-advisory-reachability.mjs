import { readFile } from 'node:fs/promises'
import path from 'node:path'

const roots = [
  'node_modules/@metamask/utils',
  'node_modules/@metamask/mobile-wallet-protocol-dapp-client/node_modules/@metamask/utils',
]
const evidence = []

for (const root of roots) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const implementation = await readFile(path.join(root, 'dist/fs.mjs'), 'utf8')
  const uuidVersion = JSON.parse(
    await readFile(path.join(root, 'node_modules/uuid/package.json'), 'utf8')
  ).version
  const vulnerableAlgorithmCall = /uuid\.v(?:3|5|6)\s*\(/.test(implementation)
  const v4Call = /uuid\.v4\s*\(/.test(implementation)
  evidence.push({
    metamaskUtilsVersion: packageJson.version,
    uuidVersion,
    source: path.posix.join(root.replaceAll('\\', '/'), 'dist/fs.mjs'),
    v4Call,
    vulnerableAlgorithmCall,
  })
}

if (evidence.some((item) => !item.v4Call || item.vulnerableAlgorithmCall)) {
  throw new Error('MetaMask uuid reachability changed; repeat the security disposition review')
}

console.log(
  JSON.stringify(
    {
      advisory: 'GHSA-w5hq-g745-h8pq',
      affectedAlgorithms: ['v3', 'v5', 'v6 with caller-supplied buffer'],
      disposition: 'not reachable from installed MetaMask utility call sites; monitor upstream',
      evidence,
    },
    null,
    2
  )
)
