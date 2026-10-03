import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
const index = await readFile(new URL('index.html', dist), 'utf8')
await writeFile(
  new URL('index.html', dist),
  index.replace(
    '<head>',
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">`,
  ),
)
const files = (await readdir(new URL('assets/', dist))).filter((name) => /\.(js|css)$/.test(name))
const sw = await readFile(new URL('sw.js', dist), 'utf8')
await writeFile(
  new URL('sw.js', dist),
  `self.TODAY_STATIC_ASSETS = ${JSON.stringify(files.map((name) => `assets/${name}`))};\n${sw}`,
)
await copyFile(new URL('THIRD_PARTY_NOTICES.md', root), new URL('THIRD_PARTY_NOTICES.md', dist))
await copyFile(new URL('LICENSE', root), new URL('LICENSE', dist))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const version = JSON.parse(await readFile(new URL('package.json', root), 'utf8')).version
const hashes = {}
for (const path of ['index.html', 'sw.js', ...files.map((name) => `assets/${name}`)])
  hashes[path] = createHash('sha256')
    .update(await readFile(new URL(path, dist)))
    .digest('hex')
await writeFile(
  new URL('deployment.json', dist),
  JSON.stringify(
    { version, commit, mode: 'web', base: '/Today-public-candidate/', hashes },
    null,
    2,
  ) + '\n',
)
