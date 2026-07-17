import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { publicKeyPemToAddress } from '../signer/kms.js'

const input = process.argv[2]
if (!input) {
  throw new Error('Usage: npm run kms:address -- <public-key.pem>')
}
const resolved = path.resolve(input)
const stat = fs.statSync(resolved)
if (!stat.isFile() || stat.size < 80 || stat.size > 16_384) {
  throw new Error('KMS public key input must be a PEM file below 16 KiB')
}
const pem = fs.readFileSync(resolved, 'utf8')
const address = publicKeyPemToAddress(pem)
const pemSha256 = crypto.createHash('sha256').update(pem).digest('hex')
console.log(JSON.stringify({ address, pemSha256 }))
