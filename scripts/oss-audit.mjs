import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const patterns = {
  machineSpecificHome: /\/(?:Users|home)\/[A-Za-z0-9._-]+\//,
  likelySecret: /(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,})/,
  privateKey: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
}
export function scanText(text, name) {
  return text.split(/\r?\n/).flatMap((line, index) =>
    Object.entries(patterns)
      .filter(([, pattern]) => pattern.test(line))
      .map(([category]) => ({ file: name, line: index + 1, category })),
  )
}
async function files(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...(await files(path)))
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|css|html|svg|json)$/.test(entry.name))
      result.push(path)
  }
  return result
}
export async function audit(root = ROOT) {
  const paths = [
    ...(await files(join(root, 'src'))),
    ...(await files(join(root, 'server'))),
    ...(await files(join(root, 'public'))),
    join(root, 'start.command'),
    join(root, '.env.example'),
  ]
  const findings = []
  for (const path of paths)
    findings.push(...scanText(await readFile(path, 'utf8'), relative(root, path)))
  return findings
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = await audit()
  process.stdout.write(
    JSON.stringify(
      { checked: 'production source and launch/config templates', findings },
      null,
      2,
    ) + '\n',
  )
  if (findings.length) process.exitCode = 1
}
