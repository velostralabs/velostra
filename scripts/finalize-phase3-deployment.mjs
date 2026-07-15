import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  gitHead,
  readJson,
  validatePhase3Manifest,
} from './lib/phase3-release.mjs'
import { finalizeDeploymentManifest } from './lib/phase3-deployment.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const prefix = '--' + name + '='
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

const manifestPath = path.resolve(
  repositoryRoot,
  argument('manifest', 'artifacts/phase3/release-manifest.json')
)
const deploymentPath = path.resolve(
  repositoryRoot,
  argument('deployment', 'contracts/deployment.json')
)
const outputPath = path.resolve(
  repositoryRoot,
  argument('output', 'artifacts/phase3/deployed-release-manifest.json')
)
const allowDirty = process.env.PHASE3_VALIDATE_ALLOW_DIRTY === 'development-only'
const [manifest, deployment] = await Promise.all([
  readJson(manifestPath),
  readJson(deploymentPath),
])
const sourceValidation = await validatePhase3Manifest({
  repositoryRoot,
  manifest,
  mode: 'broadcast',
  expectedHead: gitHead(repositoryRoot),
  requireClean: !allowDirty,
})
if (!sourceValidation.passed) {
  console.error(JSON.stringify(sourceValidation, null, 2))
  process.exit(1)
}

const deployedManifest = finalizeDeploymentManifest(manifest, deployment)
const deployedValidation = await validatePhase3Manifest({
  repositoryRoot,
  manifest: deployedManifest,
  mode: 'deployed',
  expectedHead: gitHead(repositoryRoot),
  requireClean: !allowDirty,
})
if (!deployedValidation.passed) {
  console.error(JSON.stringify(deployedValidation, null, 2))
  process.exit(1)
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, canonicalJson(deployedManifest))
console.log(
  JSON.stringify(
    {
      passed: true,
      stage: deployedManifest.stage,
      release: deployedManifest.release,
      contractAddress: deployedManifest.contract.address,
      deploymentBlock: deployedManifest.contract.deploymentBlock,
      output: path.relative(repositoryRoot, outputPath).replaceAll('\\', '/'),
      verificationRequired: true,
    },
    null,
    2
  )
)