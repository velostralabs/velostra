import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const self = 'scripts/check-public-privacy.mjs'

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

const rules = [
  {
    label: 'local Windows user-profile path',
    pattern: /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'<>]+/i,
  },
  {
    label: 'local macOS/Linux user-profile path',
    pattern: /(?:^|[\s"'(])\/(?:Users|home)\/[A-Za-z0-9._-]+(?:[\\/]|$)/im,
  },
  {
    label: 'private-key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  },
]

const trackedFiles = git(['ls-files', '-z'])
  .split('\0')
  .filter(Boolean)
const failures = []
const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi

function isPublicExampleDomain(domain) {
  return (
    domain === 'example.com' ||
    /\.(?:example|invalid|test|internal)$/.test(domain) ||
    domain === 'users.noreply.github.com' ||
    domain === 'developer.gserviceaccount.com' ||
    domain.endsWith('.iam.gserviceaccount.com')
  )
}

for (const file of trackedFiles) {
  if (file === self) continue
  const buffer = readFileSync(path.join(repositoryRoot, file))
  if (buffer.includes(0)) continue
  const content = buffer.toString('utf8')
  for (const rule of rules) {
    if (rule.pattern.test(content)) failures.push(`${rule.label}: ${file}`)
  }
  for (const match of content.matchAll(emailPattern)) {
    if (!isPublicExampleDomain(match[1].toLowerCase())) {
      failures.push(`non-public email domain: ${file}`)
    }
  }
}

const checkHeadIdentity = process.env.GITHUB_EVENT_NAME !== 'pull_request'
if (checkHeadIdentity) {
  const [authorName, authorEmail, committerName, committerEmail] = git([
    'show',
    '-s',
    '--format=%an%n%ae%n%cn%n%ce',
    'HEAD',
  ])
    .trim()
    .split(/\r?\n/)
  const publicEmail = /^\d+\+velostralabs@users\.noreply\.github\.com$/i

  if (authorName.toLowerCase() !== 'velostra' || !publicEmail.test(authorEmail)) {
    failures.push('HEAD author must use the Velostra public identity')
  }
  if (committerName.toLowerCase() !== 'velostra' || !publicEmail.test(committerEmail)) {
    failures.push('HEAD committer must use the Velostra public identity')
  }
}

if (failures.length > 0) {
  console.error('PUBLIC PRIVACY GATE FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `PUBLIC PRIVACY GATE PASSED (${trackedFiles.length} tracked files; Velostra public identity)`
)
