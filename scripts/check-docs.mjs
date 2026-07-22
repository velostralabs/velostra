import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['README.md', '.github', 'brand', 'contracts', 'deploy', 'docs', 'sdk', 'server']
const skippedDirectories = new Set(['node_modules', 'dist', 'artifacts', 'coverage', '.git'])
const markdownFiles = []

function collect(entry) {
  const absolute = resolve(root, entry)
  if (!existsSync(absolute)) return
  const stat = statSync(absolute)
  if (stat.isFile()) {
    if (extname(absolute).toLowerCase() === '.md') markdownFiles.push(absolute)
    return
  }

  for (const child of readdirSync(absolute, { withFileTypes: true })) {
    if (child.isDirectory() && skippedDirectories.has(child.name)) continue
    collect(relative(root, join(absolute, child.name)))
  }
}

for (const entry of roots) collect(entry)

const failures = []
const checkedLinks = []
const inlineLink = /!?\[[^\]]*\]\(([^)]+)\)/g

for (const file of markdownFiles) {
  const source = readFileSync(file, 'utf8')
  const display = relative(root, file).replaceAll('\\', '/')
  let match

  while ((match = inlineLink.exec(source)) !== null) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    target = target.split(/\s+["']/)[0]
    if (!target || /^(?:https?:|mailto:|data:|#)/i.test(target)) continue

    const pathPart = decodeURIComponent(target.split('#')[0].split('?')[0])
    if (!pathPart) continue
    const absoluteTarget = normalize(resolve(dirname(file), pathPart))
    checkedLinks.push(`${display} -> ${target}`)
    if (!absoluteTarget.startsWith(root) || !existsSync(absoluteTarget)) {
      failures.push(`${display}: missing relative link target "${target}"`)
    }
  }

  if (/\b(?:TODO|TBD)\b/.test(source) && ![
    'docs/AUDIT_READINESS.md',
    'docs/ROADMAP.md',
  ].includes(display)) {
    failures.push(`${display}: unresolved TODO/TBD marker outside an approved planning document`)
  }
}

const currentTruthFiles = [
  '.github/SECURITY.md',
  'deploy/observability/README.md',
  'deploy/staging/README.md',
  'sdk/javascript/README.md',
  'sdk/python/README.md',
  'server/test/README.md',
]

const stalePatterns = [
  /Public API status:\s*not deployed/i,
  /No managed backend staging resource has been provisioned yet/i,
  /public Netlify preview\s+is static and provides no server test target/i,
  /static protocol preview at `velostra\.xyz` is a separate deployment/i,
]

for (const display of currentTruthFiles) {
  const source = readFileSync(resolve(root, display), 'utf8')
  for (const pattern of stalePatterns) {
    if (pattern.test(source)) failures.push(`${display}: stale deployment wording matches ${pattern}`)
  }
}

const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
for (const asset of [
  './docs/assets/velostra-hero.svg',
  './docs/assets/velostra-proof-grid.svg',
  './docs/assets/velostra-system-map.svg',
  './docs/assets/settlement-flow.svg',
]) {
  if (!readme.includes(asset)) failures.push(`README.md: required presentation asset missing: ${asset}`)
}

for (const phrase of [
  'Public deployment',
  'PASS_BY_OWNER_WAIVER',
  'No mainnet deployment',
  'private security advisory',
]) {
  if (!readme.includes(phrase)) failures.push(`README.md: required release-truth phrase missing: ${phrase}`)
}

if (failures.length > 0) {
  console.error('Documentation gate failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`PASS documentation gate: ${markdownFiles.length} Markdown files and ${checkedLinks.length} relative links checked`)
