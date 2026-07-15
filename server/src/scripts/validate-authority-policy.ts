import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { validateAuthorityPolicy } from '../lib/authority-policy.js'

async function main(): Promise<void> {
  const input = process.argv[2]
  if (!input) {
    throw new Error('Usage: npm run authority:validate -- <authority-policy.json>')
  }
  const policyPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), input)
  const policy = validateAuthorityPolicy(JSON.parse(await fs.readFile(policyPath, 'utf8')))
  console.info('[authority-policy] valid', {
    environment: policy.environment,
    changeTicket: policy.change_ticket,
    roles: policy.roles.map((entry) => entry.role),
  })
}

main().catch((error) => {
  console.error('[authority-policy] invalid', error)
  process.exitCode = 1
})
