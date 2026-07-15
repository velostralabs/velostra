import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  createPhase3Manifest,
  gitHead,
  readJson,
  validatePhase3Manifest,
} from './lib/phase3-release.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const inputPath = path.resolve(
  repositoryRoot,
  argument('input', 'config/phase3-release-input.example.json')
)
const outputPath = path.resolve(
  repositoryRoot,
  argument('output', 'artifacts/phase3/release-manifest.json')
)
const allowDirty = process.env.PHASE3_PREPARE_ALLOW_DIRTY === 'development-only'
const input = await readJson(inputPath)
const manifest = await createPhase3Manifest({
  repositoryRoot,
  input,
  allowDirty,
})
const mode =
  input.stage === 'preparation'
    ? 'preparation'
    : input.stage === 'deployed'
      ? 'deployed'
      : 'broadcast'
const validation = await validatePhase3Manifest({
  repositoryRoot,
  manifest,
  mode,
  expectedHead: gitHead(repositoryRoot),
  requireClean: !allowDirty,
})
if (!validation.passed) {
  console.error(JSON.stringify(validation, null, 2))
  process.exit(1)
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, canonicalJson(manifest))
console.log(
  JSON.stringify(
    {
      passed: true,
      stage: manifest.stage,
      release: manifest.release,
      manifestSha256: manifest.integrity.manifestSha256,
      output: path.relative(repositoryRoot, outputPath).replaceAll('\\', '/'),
      mainnetAuthorized: manifest.authorization.mainnetApproved,
    },
    null,
    2
  )
)