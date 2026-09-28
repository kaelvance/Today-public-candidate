import { readFile, readdir, lstat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const rules = {
  privateHome: /\/(?:Users|home)\/[A-Za-z0-9._-]+\//,
  privateKey: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  credential:
    /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|\b1\/[A-Za-z0-9_-]{30,})/,
  assignment:
    /^(?:[A-Z_]*(?:API_KEY|CLIENT_SECRET|TOKEN_KEY|PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN))\s*=\s*\S+/,
}
const fixtureExceptions = new Map([
  ['scripts/oss-audit.node-test.mjs:privateHome', 'deliberate scanner regression fixture'],
])
export function scan(text, file) {
  return text.split(/\r?\n/).flatMap((line, index) =>
    Object.entries(rules)
      .filter(
        ([category, regex]) => regex.test(line) && !fixtureExceptions.has(`${file}:${category}`),
      )
      .map(([category]) => ({ file, line: index + 1, category })),
  )
}
async function files(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      ['node_modules', 'dist', '.git'].includes(entry.name) ||
      entry.name.endsWith('.tsbuildinfo')
    )
      continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...(await files(path)))
    else result.push(path)
  }
  return result
}
export async function audit() {
  const findings = [],
    emails = []
  const paths = await files(root)
  for (const path of paths) {
    const file = relative(root, path)
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      findings.push({ file, category: 'symlink_not_allowed' })
      continue
    }
    if (
      /\.(?:safetensors|gguf|bin|enc|log|zip|tar|gz)$/i.test(path) ||
      /(?:^|\/)\.env(?!\.example$)/.test(file) ||
      /(?:private|shadow-records|tokens\.json)/i.test(file)
    )
      findings.push({ file, category: 'private_or_unintended_artifact' })
    const data = await readFile(path)
    if (data.includes(0)) {
      findings.push({ file, category: 'unexpected_binary' })
      continue
    }
    const text = data.toString('utf8')
    // Vendor notices retain upstream copyright contacts. They are not user records.
    if (!file.startsWith('third-party/') && file !== 'THIRD_PARTY_NOTICES.md')
      findings.push(...scan(text, file))
    if (!file.startsWith('third-party/'))
      for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
        const domain = match[0].split('@')[1]
        if (
          !/^(?:example\.(?:com|org|net|edu|invalid)|.*\.invalid)$/i.test(domain) &&
          !file.startsWith('SBOM') &&
          !file.startsWith('THIRD_PARTY')
        )
          emails.push({ file, category: 'email_requires_manual_review' })
      }
  }
  let history = 'ABSENT'
  let gitAvailable = false
  try {
    gitAvailable =
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === root.replace(/\/$/, '')
  } catch {
    /* The source archive intentionally has no Git metadata. */
  }
  if (gitAvailable) {
    const revisions = execFileSync('git', ['rev-list', '--all'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
    for (const revision of revisions) {
      const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', revision], {
        cwd: root,
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
      for (const file of tracked)
        if (file && !file.startsWith('third-party/') && file !== 'THIRD_PARTY_NOTICES.md')
          findings.push(
            ...scan(
              execFileSync('git', ['show', `${revision}:${file}`], {
                cwd: root,
                encoding: 'utf8',
                maxBuffer: 8 * 1024 * 1024,
              }),
              file,
            ).map((item) => ({ ...item, revision })),
          )
    }
    history = `SCANNED_${revisions.length}_COMMITS`
  } // A scan/read error in an existing repository fails the command; it is not absence of history.
  return {
    files: paths.length,
    history,
    findings,
    emailReview: emails,
    fixtureExceptions: Object.fromEntries(fixtureExceptions),
    boundary:
      'candidate tree and available local Git history; pattern scan cannot prove absence of every secret or PII',
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await audit()
  console.log(JSON.stringify(result, null, 2))
  if (result.findings.length || result.emailReview.length) process.exitCode = 1
}
