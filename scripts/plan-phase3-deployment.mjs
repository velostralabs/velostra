import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, gitHead, readJson, repositoryPath, validatePhase3Manifest } from './lib/phase3-release.mjs'
import { createDeploymentPlan } from './lib/phase3-deployment.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const manifestPath = path.resolve(repositoryRoot, argument('manifest', 'artifacts/phase3/release-manifest.json'))
const outputPath = path.resolve(repositoryRoot, argument('output', 'artifacts/phase3/deployment-plan.json'))
const manifest = await readJson(manifestPath)
const mode =
  manifest.stage === 'preparation'
    ? 'preparation'
    : manifest.stage === 'deployed'
      ? 'deployed'
      : 'broadcast'
const allowDirty = process.env.PHASE3_VALIDATE_ALLOW_DIRTY === 'development-only'
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

const [artifact, canaryPolicy] = await Promise.all([
  readJson(repositoryPath(repositoryRoot, manifest.contract.artifact)),
  readJson(repositoryPath(repositoryRoot, manifest.policies.canary.path)),
])
const plan = createDeploymentPlan({ manifest, artifact, canaryPolicy })
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, canonicalJson(plan))
console.log(JSON.stringify({
  passed: true,
  release: plan.release,
  stage: plan.stage,
  output: path.relative(repositoryRoot, outputPath).replaceAll('\\', '/'),
  planSha256: plan.integrity.manifestSha256,
  broadcastPerformed: false,
  broadcastEligible: plan.broadcastEligible,
}, null, 2))