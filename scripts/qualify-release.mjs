import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(
  process.argv.slice(2).filter((arg) => arg !== '--')[0] || join(tmpdir(), 'today-qualification'),
)
const distance = relative(root, output)
assert(
  distance === '..' || distance.startsWith(`..${sep}`),
  'Evidence must be outside the release source',
)
await mkdir(output, { recursive: true })
const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(join(root, path)))
    .digest('hex')
const record = {
  version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  lockSha256: await hash('pnpm-lock.yaml'),
  sbomSha256: await hash('SBOM.cdx.json'),
  workflowSha256: await hash('.github/workflows/release-qualification.yml'),
  node: process.version,
  pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
  platform: process.platform,
  arch: process.arch,
  startedAt: new Date().toISOString(),
  steps: [],
  testTimeZone: 'UTC',
}
const cleanEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  // pnpm/action-setup selects its store through this non-secret runtime path.
  ...(process.env.PNPM_HOME ? { PNPM_HOME: process.env.PNPM_HOME } : {}),
  CI: 'true',
  TMPDIR: tmpdir(),
  TZ: 'UTC',
}
try {
  for (const [label, args] of [
    ['install', ['install', '--frozen-lockfile']],
    ['format', ['format:check']],
    ['lint', ['lint']],
    ['typecheck', ['typecheck']],
    ['unit', ['test']],
    ['local', ['test:local']],
    ['remote', ['test:remote']],
    ['ollama', ['test:ollama']],
    ['security', ['test:security']],
    ['oss', ['test:oss']],
    ['code-audit', ['release:audit', '--', '--output', join(output, 'code-audit-inventory.json')]],
    ['license', ['licenses:check']],
    ['dependency', ['audit', '--audit-level', 'high', '--json']],
    ['build', ['build']],
    ['e2e', ['test:e2e']],
    ['v2-ui', ['test:v2', '--', output]],
    ['packaging', ['release:package', '--', output]],
  ]) {
    const started = Date.now()
    const child = spawn('pnpm', args, { cwd: root, env: cleanEnv, stdio: 'pipe' })
    let log = ''
    child.stdout.on('data', (data) => {
      log += data
    })
    child.stderr.on('data', (data) => {
      log += data
    })
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    await writeFile(join(output, `${label}.log`), log)
    record.steps.push({
      label,
      command: ['pnpm', ...args],
      exitCode: code,
      durationMs: Date.now() - started,
      log: `${label}.log`,
    })
    console.log(JSON.stringify(record.steps.at(-1)))
    assert.equal(code, 0, `${label} failed; original log preserved`)
  }
  record.passed = true
} catch (error) {
  record.passed = false
  record.failure = error.message
  throw error
} finally {
  record.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'qualification.json'), JSON.stringify(record, null, 2) + '\n')
}
