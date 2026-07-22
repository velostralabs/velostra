import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicEmail = /^\d+\+velostralabs@users\.noreply\.github\.com$/i

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
    ...options,
  })
}

if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
  throw new Error('History privacy gate requires a complete Git history (checkout fetch-depth: 0).')
}

const rules = [
  {
    label: 'local Windows user-profile path',
    pattern: /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'<>]+/i,
  },
  {
    label: 'local macOS/Linux user-profile path',
    pattern: /(?:^|[\s"'(])\/(?:Users|home)\/[A-Za-z0-9._-]+(?:[\\/]|$)/i,
  },
  {
    label: 'private-key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  },
  {
    label: 'Telegram bot token',
    pattern: /\b\d{8,12}:[A-Za-z0-9_-]{35}\b/,
  },
  {
    label: 'GitHub access token',
    pattern: /\b(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{36,})\b/,
  },
  {
    label: 'Google API key',
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/,
  },
  {
    label: 'AWS access key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    label: 'Slack token',
    pattern: /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/,
  },
  {
    label: 'live payment secret',
    pattern: /\b(?:sk_live_|rk_live_)[A-Za-z0-9]{16,}\b/,
  },
  {
    label: 'npm access token',
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
  },
  {
    label: 'JWT credential',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    label: 'assigned EVM private key',
    pattern: /(?:PRIVATE_KEY|DEPLOYER_KEY|SETTLER_PRIVATE_KEY|OWNER_KEY|SECRET_KEY)\s*[:=]\s*["']?(?:0x)?[0-9a-f]{64}\b/i,
  },
  {
    label: 'Alchemy credential URL',
    pattern: /https:\/\/[^/\s]+\.alchemy\.com\/v2\/(?!replace|example|placeholder|<)[A-Za-z0-9_-]{20,}/i,
  },
  {
    label: 'labeled Indonesian identity number',
    pattern: /(?:\bNIK\b|Nomor Induk Kependudukan)[^\r\n]{0,40}\b\d{16}\b/i,
  },
]

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

const failures = new Map()
function record(label, commit, file) {
  const key = `${label}\u0000${commit}\u0000${file}`
  failures.set(key, `- ${label}: ${commit.slice(0, 12)} ${file}`)
}

const identityRows = git([
  'log',
  '--all',
  '--format=%H%x00%an%x00%ae%x00%cn%x00%ce',
])
  .split(/\r?\n/)
  .filter(Boolean)

for (const row of identityRows) {
  const [commit, authorName, authorEmail, committerName, committerEmail] = row.split('\0')
  if (authorName?.toLowerCase() !== 'velostra' || !publicEmail.test(authorEmail ?? '')) {
    record('non-public commit author identity', commit, '(commit metadata)')
  }
  if (committerName?.toLowerCase() !== 'velostra' || !publicEmail.test(committerEmail ?? '')) {
    record('non-public commit committer identity', commit, '(commit metadata)')
  }
}

const marker = '__VELOSTRA_COMMIT__'
const history = git([
  'log',
  '--all',
  '--full-history',
  '--no-ext-diff',
  '--no-renames',
  '-p',
  `--format=${marker}%H`,
  '--',
  '.',
])

let commit = ''
let file = '(unknown path)'
for (const line of history.split(/\r?\n/)) {
  if (line.startsWith(marker)) {
    commit = line.slice(marker.length)
    continue
  }
  if (line.startsWith('diff --git ')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    file = match?.[2] ?? '(unknown path)'
    continue
  }
  if ((!line.startsWith('+') && !line.startsWith('-')) || line.startsWith('+++') || line.startsWith('---')) {
    continue
  }
  const content = line.slice(1)
  for (const rule of rules) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(content)) record(rule.label, commit, file)
  }
  emailPattern.lastIndex = 0
  for (const match of content.matchAll(emailPattern)) {
    if (!isPublicExampleDomain(match[1].toLowerCase())) {
      record('non-public email domain', commit, file)
    }
  }
}

if (failures.size > 0) {
  console.error('PUBLIC HISTORY PRIVACY GATE FAILED')
  for (const failure of failures.values()) console.error(failure)
  process.exit(1)
}

console.log(`PUBLIC HISTORY PRIVACY GATE PASSED (${identityRows.length} commits; no sensitive historical patch content or private identity)`) 