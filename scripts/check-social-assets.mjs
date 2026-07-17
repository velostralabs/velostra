import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const metadataChunks = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf'])
const assets = [
  ['brand/social/velostra-x-profile-800.png', 800, 800],
  ['brand/social/velostra-x-banner-1500x500.png', 1500, 500],
  ['public/velostra-social-card-1200x630.png', 1200, 630],
]

function inspectPng(relativePath, expectedWidth, expectedHeight) {
  const data = readFileSync(path.join(root, relativePath))
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', relativePath + ' must be PNG')
  assert.equal(data.readUInt32BE(16), expectedWidth, relativePath + ' width differs')
  assert.equal(data.readUInt32BE(20), expectedHeight, relativePath + ' height differs')

  let offset = 8
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.subarray(offset + 4, offset + 8).toString('ascii')
    assert(!metadataChunks.has(type), relativePath + ' contains a sensitive-capable metadata chunk')
    offset += 12 + length
    if (type === 'IEND') break
  }
  assert(offset <= data.length, relativePath + ' has an invalid PNG chunk boundary')
}

for (const [file, width, height] of assets) inspectPng(file, width, height)

const html = readFileSync(path.join(root, 'index.html'), 'utf8')
const imageUrl =
  'https://raw.githubusercontent.com/velostralabs/velostra/main/public/' +
  'velostra-social-card-1200x630.png'
assert(html.includes('property="og:image" content="' + imageUrl + '"'))
assert(html.includes('name="twitter:image" content="' + imageUrl + '"'))
assert(html.includes('property="og:image:width" content="1200"'))
assert(html.includes('property="og:image:height" content="630"'))

console.log('SOCIAL ASSET GATE PASSED: dimensions, metadata, and link-preview tags')
