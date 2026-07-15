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
import {
  evaluateCatchup,
  evaluateReadiness,
  sealGateArtifact,
} from './lib/phase3-gates.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const manifestPath = path.resolve(repositoryRoot, argument('manifest', 'artifacts/phase3/deployed-release-manifest.json'))
const snapshotPath = path.resolve(repositoryRoot, argument('snapshot', 'artifacts/phase3/operational-snapshot.json'))
const catchupPath = path.resolve(repositoryRoot, argument('catchup', 'artifacts/phase3/catchup-evidence.json'))
const outputPath = path.resolve(repositoryRoot, argument('output', 'artifacts/phase3/readiness-decision.json'))
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

const [snapshot, catchup, policy, slos] = await Promise.all([
  readJson(snapshotPath),
  readJson(catchupPath),
  readJson(repositoryPath(repositoryRoot, manifest.policies.canary.path)),
  readJson(repositoryPath(repositoryRoot, 'config/phase2-slos.json')),
])
const evaluatedAt = new Date().toISOString()
const readiness = evaluateReadiness({ manifest, policy, snapshot, evaluatedAt })
const catchupDecision = evaluateCatchup({
  release: manifest.release,
  evidence: catchup,
  maxBlockRange: manifest.reconciliation.maxBlockRange,
  catchUpSloMs: slos.objectives.oneHourLagCatchUpMs,
  evaluatedAt,
})
const artifact = sealGateArtifact({
  schemaVersion: 1,
  kind: 'velostra-phase3-go-no-go',
  release: manifest.release,
  environment: manifest.environment,
  evaluatedAt,
  passed: readiness.passed && catchupDecision.passed,
  decision: readiness.passed && catchupDecision.passed ? 'GO' : 'NO-GO',
  paidWritesAllowed: readiness.passed && catchupDecision.passed,
  readiness,
  catchup: catchupDecision,
})
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, canonicalJson(artifact))
console.log(JSON.stringify({
  passed: artifact.passed,
  decision: artifact.decision,
  paidWritesAllowed: artifact.paidWritesAllowed,
  readinessFailures: readiness.failures,
  catchupFailures: catchupDecision.failures,
  output: path.relative(repositoryRoot, outputPath).replaceAll('\\', '/'),
  artifactSha256: artifact.integrity.manifestSha256,
}, null, 2))
if (!artifact.passed) process.exitCode = 1