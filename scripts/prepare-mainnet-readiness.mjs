import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, gitHead, readJson } from './lib/phase3-release.mjs'
import {
  createMainnetReadinessPacket,
  validateMainnetReadinessPacket,
} from './lib/mainnet-readiness.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const inputPath = path.resolve(repositoryRoot, argument('input', 'config/mainnet-readiness-input.example.json'))
const outputPath = path.resolve(repositoryRoot, argument('output', 'artifacts/mainnet/readiness-packet.json'))
const allowDirty = process.env.MAINNET_READINESS_ALLOW_DIRTY === 'development-only'
const input = await readJson(inputPath)
const packet = await createMainnetReadinessPacket({ repositoryRoot, input, allowDirty })
const validation = await validateMainnetReadinessPacket({
  repositoryRoot,
  packet,
  expectedHead: gitHead(repositoryRoot),
  requireClean: !allowDirty,
})
if (!validation.passed) {
  console.error(JSON.stringify(validation, null, 2))
  process.exit(1)
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, canonicalJson(packet))
console.log(JSON.stringify({
  passed: true,
  decision: packet.decision,
  blockers: packet.blockers,
  release: packet.release,
  manifestSha256: packet.integrity.manifestSha256,
  output: path.relative(repositoryRoot, outputPath).replaceAll('\\', '/'),
  mainnetAuthorized: false,
}, null, 2))