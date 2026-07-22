import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [netlify, redirects, headers, robots, sitemap] = await Promise.all([
  readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  readFile(new URL('../public/_redirects', import.meta.url), 'utf8'),
  readFile(new URL('../public/_headers', import.meta.url), 'utf8'),
  readFile(new URL('../public/robots.txt', import.meta.url), 'utf8'),
  readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8'),
])

assert.match(netlify, /\[build\.processing\.html\][\s\S]*?pretty_urls\s*=\s*false/)

const redirectRules = redirects
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
assert.equal(
  redirectRules[0],
  'https://velostra.netlify.app/*  https://velostra.xyz/:splat  301!',
  'The Netlify subdomain must redirect to the public canonical domain.',
)
assert.equal(
  redirectRules.at(-1),
  '/*  /index.html  200',
  'The SPA rewrite must remain the final redirect rule.',
)

for (const requiredHeader of [
  'Content-Security-Policy:',
  'Cross-Origin-Opener-Policy: same-origin-allow-popups',
  'Permissions-Policy:',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'Strict-Transport-Security:',
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
  'Cache-Control: public, max-age=31536000, immutable',
  'Content-Type: application/manifest+json; charset=utf-8',
]) {
  assert.ok(headers.includes(requiredHeader), `Missing hosting header: ${requiredHeader}`)
}

for (const privateRoute of ['/dashboard', '/builder', '/admin']) {
  assert.match(
    headers,
    new RegExp(privateRoute + '\\s+X-Robots-Tag: noindex, nofollow'),
    privateRoute + ' must be excluded from search indexes at the HTTP layer.',
  )
}
assert.match(robots, /Sitemap:\s+https:\/\/velostra\.xyz\/sitemap\.xml/)
assert.match(sitemap, /<loc>https:\/\/velostra\.xyz\/marketplace<\/loc>/)
assert.doesNotMatch(sitemap, /dashboard|builder|admin/)

console.log('Hosting configuration verified: canonical redirects, SPA routing, headers, caching, and sitemap are guarded.')
