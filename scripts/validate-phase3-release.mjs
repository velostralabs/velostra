import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  gitHead,
  readJson,
  validatePhase3Manifest,
} from './lib/phase3-release.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const manifestPath = path.resolve(
  repositoryRoot,
  argument('manifest', 'artifacts/phase3/release-manifest.json')
)
const mode = argument('mode', 'preparation')
const allowDirty = process.env.PHASE3_VALIDATE_ALLOW_DIRTY === 'development-only'
const manifest = await readJson(manifestPath)
const result = await validatePhase3Manifest({
  repositoryRoot,
  manifest,
  mode,
  expectedHead: gitHead(repositoryRoot),
  requireClean: !allowDirty,
})
console.log(
  JSON.stringify(
    {
      ...result,
      mode,
      release: manifest.release,
      stage: manifest.stage,
      manifestSha256: manifest.integrity?.manifestSha256,
      mainnetAuthorized: manifest.authorization?.mainnetApproved === true,
    },
    null,
    2
  )
)
if (!result.passed) process.exitCode = 1