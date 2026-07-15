import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  gitHead,
  readJson,
  repositoryPath,
  validatePhase3Manifest,
} from './lib/phase3-release.mjs'
import { evaluateCanary, sealGateArtifact } from './lib/phase3-gates.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const manifestPath = path.resolve(repositoryRoot, argument('manifest', 'artifacts/phase3/deployed-release-manifest.json'))
const summaryPath = path.resolve(repositoryRoot, argument('summary', 'artifacts/phase3/canary-summary.json'))
const outputPath = path.resolve(repositoryRoot, argument('output', 'artifacts/phase3/canary-decision.json'))
const allowDirty = process.env.PHASE3_VALIDATE_ALLOW_DIRTY === 'development-only'
const manifest = await readJson(manifestPath)
const manifestValidation = await validatePhase3Manifest({
  repositoryRoot,
  manifest,
  mode: 'deployed',
  expectedHead: gitHead(repositoryRoot),
  requireClean: !allowDirty,
})
if (!manifestValidation.passed) {
  console.error(JSON.stringify(manifestValidation, null, 2))
  process.exit(1)
}
const [summary, policy] = await Promise.all([
  readJson(summaryPath),
  readJson(repositoryPath(repositoryRoot, manifest.policies.canary.path)),
])
const decision = evaluateCanary({
  manifest,
  policy,
  summary,
  evaluatedAt: new Date().toISOString(),
})
const artifact = sealGateArtifact(decision)
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, canonicalJson(artifact))
console.log(JSON.stringify({
  passed: artifact.passed,
  decision: artifact.decision,
  expansionAuthorized: false,
  operatorApprovalRequired: true,
  failures: artifact.failures,
  stopPlan: artifact.stopPlan,
  output: path.relative(repositoryRoot, outputPath).replaceAll('\\', '/'),
  artifactSha256: artifact.integrity.manifestSha256,
}, null, 2))
if (!artifact.passed) process.exitCode = 1