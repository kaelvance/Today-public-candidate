import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, readdir, mkdtemp, stat } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(
  process.argv.slice(2).filter((arg) => arg !== '--')[0] ||
    join(tmpdir(), 'today-release-evidence'),
)
const distance = relative(root, output)
assert(distance === '..' || distance.startsWith(`..${sep}`), 'Output must be outside source')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
assert.equal(git('status', '--porcelain'), '', 'Commit the exact candidate before packaging')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?$/)
const commit = git('rev-parse', 'HEAD'),
  tree = git('rev-parse', 'HEAD^{tree}')
const entries = git('ls-tree', '-r', '-z', 'HEAD')
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const [identity, path] = line.split('\t')
    const [mode, kind, sha] = identity.split(' ')
    assert(kind === 'blob' && ['100644', '100755'].includes(mode), 'No symlinks or submodules')
    assert(path && !path.startsWith('/') && !path.split('/').includes('..'))
    assert(!/(?:^|\/)(?:node_modules|dist|\.git|work|\.today-private)(?:\/|$)/.test(path))
    assert(
      !/(?:^|\/)\.env(?!\.example$)|\.(?:safetensors|gguf|bin|enc|log|zip|tar|gz)$/i.test(path),
    )
    return { path, mode, sha }
  })
await mkdir(output, { recursive: true })
const name = `Today-${manifest.version}-source.zip`,
  prefix = `Today-${manifest.version}`
const archive = join(output, name)
execFileSync(
  'git',
  ['archive', '--format=zip', `--prefix=${prefix}/`, `--output=${archive}`, commit],
  { cwd: root },
)
const data = await readFile(archive),
  sha256 = createHash('sha256').update(data).digest('hex')
await writeFile(join(output, `${name}.sha256`), `${sha256}  ${name}\n`)
const extraction = await mkdtemp(join(tmpdir(), 'today-archive-'))
execFileSync('unzip', ['-q', archive, '-d', extraction])
const extracted = join(extraction, prefix)
async function inventory(dir) {
  const all = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    assert(!entry.isSymbolicLink())
    if (entry.isDirectory()) all.push(...(await inventory(path)))
    else {
      assert(entry.isFile())
      all.push(relative(extracted, path).split(sep).join('/'))
    }
  }
  return all.sort()
}
assert.deepEqual(await inventory(extracted), entries.map((entry) => entry.path).sort())
for (const entry of entries) {
  const original = execFileSync('git', ['cat-file', 'blob', entry.sha], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert(
    !original.toString('utf8', 0, 80).startsWith('version https://git-lfs.github.com/spec/v1\n'),
    'Git LFS is not supported by this source archive policy',
  )
  assert.deepEqual(
    await readFile(join(extracted, entry.path)),
    original,
    `Archive differs: ${entry.path}`,
  )
  assert.equal(
    ((await stat(join(extracted, entry.path))).mode & 0o111) !== 0,
    entry.mode === '100755',
    `Executable mode differs: ${entry.path}`,
  )
}
const record = {
  version: manifest.version,
  commit,
  tree,
  archive: name,
  sha256,
  bytes: data.length,
  files: entries.length,
  archiveEqualsCommit: true,
  executableModePreserved: true,
  gitMetadataIncluded: false,
  steps: [],
  node: process.version,
  pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
  platform: process.platform,
  arch: process.arch,
  startedAt: new Date().toISOString(),
}
const cleanEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ...(process.env.CHROME_PATH ? { CHROME_PATH: process.env.CHROME_PATH } : {}),
  // pnpm/action-setup selects its store through this non-secret runtime path.
  ...(process.env.PNPM_HOME ? { PNPM_HOME: process.env.PNPM_HOME } : {}),
  CI: 'true',
  TMPDIR: tmpdir(),
  TZ: 'UTC',
  TODAY_SOURCE_COMMIT: commit,
}
async function run(label, args) {
  const started = Date.now(),
    log = join(output, `archive-${label}.log`)
  const child = spawn('pnpm', args, { cwd: extracted, env: cleanEnv, stdio: 'pipe' })
  let content = ''
  child.stdout.on('data', (data) => {
    content += data
  })
  child.stderr.on('data', (data) => {
    content += data
  })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  await writeFile(log, content)
  record.steps.push({
    label,
    command: ['pnpm', ...args],
    exitCode: code,
    durationMs: Date.now() - started,
    log: relative(output, log),
  })
  assert.equal(code, 0, `Archive ${label} failed; original log preserved`)
}
try {
  for (const [label, args] of [
    ['install', ['install', '--frozen-lockfile']],
    ['build', ['build']],
    ['unit', ['test']],
    ['local', ['test:local']],
    ['remote', ['test:remote']],
    ['ollama', ['test:ollama']],
    ['security', ['test:security']],
    ['chat-server', ['test:chat-server']],
    ['oss', ['test:oss']],
    ['e2e', ['test:e2e']],
    ['chat-e2e', ['test:chat-e2e', '--', join(output, 'chat')]],
    ['v2-ui', ['test:v2', '--', output, 'archive']],
    ['stranger', ['test:stranger', '--', output]],
    ['cold', ['test:cold', '--', output]],
    ['build-web', ['build:web']],
    ['web', ['test:web', '--', join(output, 'web')]],
    ['storage-recovery', ['test:recovery', '--', join(output, 'storage-recovery')]],
    ['update', ['test:update', '--', join(output, 'update')]],
  ])
    await run(label, args)
  record.passed = true
} catch (error) {
  record.passed = false
  record.failure = error.message
  throw error
} finally {
  record.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'release-receipt.json'), JSON.stringify(record, null, 2) + '\n')
  await writeFile(join(output, 'source-inventory.json'), JSON.stringify(entries, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: record.passed,
    version: record.version,
    commit,
    sha256,
    files: entries.length,
  }),
)
