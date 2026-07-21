import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitHead, readJson } from './lib/phase3-release.mjs'
import { validateMainnetReadinessPacket } from './lib/mainnet-readiness.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const packetPath = path.resolve(repositoryRoot, argument('packet', 'artifacts/mainnet/readiness-packet.json'))
const requireReady = argument('require-ready', 'false') === 'true'
const allowDirty = process.env.MAINNET_READINESS_ALLOW_DIRTY === 'development-only'
const packet = await readJson(packetPath)
const result = await validateMainnetReadinessPacket({
  repositoryRoot,
  packet,
  expectedHead: gitHead(repositoryRoot),
  requireClean: !allowDirty,
  requireReady,
})
console.log(JSON.stringify({
  ...result,
  decision: packet.decision,
  blockers: packet.blockers,
  release: packet.release,
  manifestSha256: packet.integrity?.manifestSha256,
  mainnetAuthorized: false,
}, null, 2))
if (!result.passed) process.exitCode = 1