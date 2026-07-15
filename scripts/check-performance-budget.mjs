import { gzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const config = JSON.parse(await readFile(path.join(root, 'config/performance-budgets.json'), 'utf8'))
const assetsDirectory = path.join(root, 'dist/assets')
const indexHtml = await readFile(path.join(root, 'dist/index.html'), 'utf8')
const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith('.js'))

if (files.length === 0) throw new Error('No built JavaScript assets were found')

const rows = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(path.join(assetsDirectory, file))
    return { file, rawBytes: source.byteLength, gzipBytes: gzipSync(source).byteLength }
  })
)
rows.sort((left, right) => right.gzipBytes - left.gzipBytes)

const entryMatch = indexHtml.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)
if (!entryMatch) throw new Error('Unable to identify the initial Vite entry chunk')
const entry = rows.find((row) => row.file === entryMatch[1])
if (!entry) throw new Error('The initial Vite entry chunk is missing from dist/assets')

const asyncRows = rows.filter((row) => row.file !== entry.file)
const metrics = {
  initialEntryGzipBytes: entry.gzipBytes,
  largestAsyncChunkGzipBytes: asyncRows[0]?.gzipBytes ?? 0,
  totalJavaScriptGzipBytes: rows.reduce((total, row) => total + row.gzipBytes, 0),
}
const failures = Object.entries(config.build)
  .filter(([metric, budget]) => metrics[metric] > budget)
  .map(([metric, budget]) => `${metric}: ${metrics[metric]} > ${budget}`)

const evidence = {
  capturedAt: new Date().toISOString(),
  budgets: config.build,
  metrics,
  chunks: rows,
  passed: failures.length === 0,
}
await mkdir(path.join(root, 'artifacts/performance'), { recursive: true })
await writeFile(
  path.join(root, 'artifacts/performance/build-budget.json'),
  JSON.stringify(evidence, null, 2) + '\n'
)

console.log(JSON.stringify(evidence, null, 2))
if (failures.length > 0) throw new Error('Performance budget exceeded: ' + failures.join(', '))
