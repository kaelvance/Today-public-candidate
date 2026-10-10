import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const lock = await readFile('pnpm-lock.yaml', 'utf8')
const lockSha256 = createHash('sha256').update(lock).digest('hex')
const section = lock.split('\npackages:\n')[1]?.split('\nsnapshots:\n')[0]
if (!section || !lock.startsWith("lockfileVersion: '9.0'"))
  throw new Error('Unsupported lockfile; inventory must be reviewed')
const entries = [...section.matchAll(/^  '?([^'\n]+)'?:\n([\s\S]*?)(?=^  \S|$(?![\s\S]))/gm)].map(
  (match) => {
    const at = match[1].lastIndexOf('@')
    const name = match[1].slice(0, at),
      version = match[1].slice(at + 1)
    const integrity = match[2].match(/integrity: (sha512-[^}\s]+)/)?.[1]
    if (!integrity || !version || !name) throw new Error('Unpinned dependency')
    return { name, version, integrity, key: `${name}@${version}` }
  },
)
const licenseMap = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' }),
)
const installed = new Map(
  Object.values(licenseMap)
    .flat()
    .flatMap((item) => item.versions.map((version) => [`${item.name}@${version}`, item])),
)
const inventoryPath = 'docs/qualification/dependencies.json'
if (process.argv.includes('--check')) {
  const saved = JSON.parse(await readFile(inventoryPath, 'utf8'))
  if (saved.lockSha256 !== lockSha256 || saved.components.length !== entries.length)
    throw new Error('Inventory differs from lockfile')
  for (const entry of entries) {
    const item = saved.components.find(
      (item) => item.name === entry.name && item.version === entry.version,
    )
    if (
      !item?.license ||
      item.license === 'UNKNOWN' ||
      item.integrity !== entry.integrity ||
      (installed.has(entry.key) && installed.get(entry.key).license !== item.license)
    )
      throw new Error(`License mismatch: ${entry.key}`)
  }
  const sbom = JSON.parse(await readFile('SBOM.cdx.json', 'utf8'))
  const application = sbom.metadata?.component
  if (
    application?.name !== manifest.name ||
    application?.version !== manifest.version ||
    application?.purl !== `pkg:npm/${manifest.name}@${manifest.version}` ||
    sbom.metadata?.properties?.find((item) => item.name === 'today:lockSha256')?.value !==
      lockSha256 ||
    sbom.components?.length !== entries.length
  )
    throw new Error('SBOM application identity or lock coverage mismatch')
  for (const component of sbom.components) {
    const name = component.group ? `${component.group}/${component.name}` : component.name
    const entry = saved.components.find(
      (item) => item.name === name && item.version === component.version,
    )
    const license = component.licenses?.[0]?.expression || component.licenses?.[0]?.license?.id
    if (!entry || license !== entry.license) throw new Error('SBOM dependency license mismatch')
  }
  const references = new Set([
    application['bom-ref'],
    ...sbom.components.map((item) => item['bom-ref']),
  ])
  if (
    references.size !== entries.length + 1 ||
    sbom.dependencies?.length !== references.size ||
    new Set(sbom.dependencies.map((item) => item.ref)).size !== references.size ||
    sbom.dependencies.some(
      (item) => !references.has(item.ref) || item.dependsOn?.some((ref) => !references.has(ref)),
    )
  )
    throw new Error('SBOM dependency graph mismatch')
  console.log(
    JSON.stringify({
      checked: entries.length,
      lockSha256,
      licenseMetadata: 'verified',
      scope: 'source distribution; no dependency binaries bundled',
    }),
  )
} else {
  const components = []
  for (let offset = 0; offset < entries.length; offset += 8) {
    const batch = await Promise.all(
      entries.slice(offset, offset + 8).map(async (entry) => {
        const local = installed.get(entry.key)
        let metadata = local
        if (!local) {
          const response = await fetch(
            `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`,
            { signal: AbortSignal.timeout(15000) },
          )
          if (!response.ok) throw new Error(`Registry metadata unavailable: ${entry.key}`)
          metadata = await response.json()
          if (metadata.dist?.integrity !== entry.integrity)
            throw new Error(`Registry integrity mismatch: ${entry.key}`)
        }
        const license =
          typeof metadata.license === 'string'
            ? metadata.license
            : metadata.license?.type || 'UNKNOWN'
        const direct =
          entry.name in (manifest.dependencies || {}) || entry.name in manifest.devDependencies
        const runtime = [
          'react',
          'react-dom',
          'scheduler',
          '@mlc-ai/web-llm',
          '@mlc-ai/web-tokenizers',
          'loglevel',
        ].includes(entry.name)
        const productionAttribution = runtime || ['vite', 'rollup'].includes(entry.name)
        const purpose = direct
          ? {
              react: 'UI runtime',
              'react-dom': 'DOM rendering',
              '@mlc-ai/web-llm': 'optional browser on-device inference',
              prettier: 'CI formatting',
              typescript: 'type checks',
              vite: 'build/dev server',
              vitest: 'unit/domain/contract/integration tests',
              'playwright-core': 'E2E browser automation',
              eslint: 'static analysis',
              jsdom: 'DOM unit test environment',
            }[entry.name] || 'development checks and tooling'
          : runtime
            ? 'React scheduling'
            : metadata.description || 'transitive build/test/tool dependency'
        const notices = []
        if (local)
          for (const name of await readdir(local.paths[0]))
            if (/^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name)) {
              const destination = `third-party/licenses/${entry.name.replaceAll('/', '_')}@${entry.version}/${name}`
              await mkdir(join(destination, '..'), { recursive: true })
              try {
                await copyFile(join(local.paths[0], name), destination)
                notices.push(destination)
              } catch (error) {
                if (error.code !== 'EISDIR') throw error
              }
            }
        return {
          ...entry,
          license,
          direct,
          runtime,
          installedOnAuditHost: !!local,
          purpose,
          releaseNecessity: runtime
            ? entry.name.startsWith('@mlc-ai/') || entry.name === 'loglevel'
              ? 'optional AI runtime; Core works without model loading'
              : 'required for Core'
            : 'required by reproducible development graph; platform optional packages installed conditionally',
          includedInSource: false,
          includedInProductionBundle: runtime || entry.name === 'vite',
          productionAttributionRequired: productionAttribution,
          productionAttributionReason: runtime
            ? 'bundled runtime'
            : ['vite', 'rollup'].includes(entry.name)
              ? 'modulepreload/build-generated helpers; retain tooling notices conservatively'
              : 'not part of production runtime',
          attribution: runtime
            ? 'retain copyright and license text in built distribution'
            : 'dependency package retains its own notices when installed',
          modificationNotice: 'not modified',
          vulnerabilityStatus:
            'see pinned pnpm audit snapshot in docs/qualification/dependency-audit.json; no known advisory in that snapshot is not a proof of absence',
          evidence: local
            ? 'installed package license metadata and copied notices'
            : 'npm registry pinned version; integrity matched to lockfile',
          notices,
        }
      }),
    )
    components.push(...batch)
  }
  components.sort((a, b) => a.key.localeCompare(b.key))
  await mkdir('docs/qualification', { recursive: true })
  await writeFile(
    inventoryPath,
    JSON.stringify({ schemaVersion: 1, lockSha256, components }, null, 2) + '\n',
  )
  const sbom = JSON.parse(
    execFileSync(
      'pnpm',
      [
        'sbom',
        '--sbom-format',
        'cyclonedx',
        '--sbom-spec-version',
        '1.5',
        '--sbom-type',
        'application',
        '--lockfile-only',
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    ),
  )
  if (sbom.components.length !== components.length) throw new Error('SBOM coverage mismatch')
  for (const component of sbom.components) {
    const entry = components.find(
      (entry) =>
        entry.name ===
          (component.group ? `${component.group}/${component.name}` : component.name) &&
        entry.version === component.version,
    )
    if (!entry) throw new Error('SBOM component mismatch')
    component.licenses = entry.license.includes(' ')
      ? [{ expression: entry.license }]
      : [{ license: { id: entry.license } }]
  }
  sbom.metadata.properties = [{ name: 'today:lockSha256', value: lockSha256 }]
  await writeFile('SBOM.cdx.json', JSON.stringify(sbom, null, 2) + '\n')
  let notices =
    '# Third-party notices\n\nソース配布は依存パッケージ本体を同梱しません。production buildにはReact、React DOM、Scheduler、任意AI用WebLLM / Web Tokenizers / loglevelとViteのmodulepreload helperが含まれます。Rollupの生成helperについても帰属表示を保守的に保持します。以下はその原文の帰属・許諾です。その他の開発依存の原文は `third-party/licenses/`、全固定バージョンは `docs/qualification/dependencies.json` と `SBOM.cdx.json` にあります。\n\n'
  for (const item of components.filter((item) => item.productionAttributionRequired)) {
    notices += `## ${item.key}\n\nLicense: ${item.license}. Unmodified upstream code.\n\n`
    for (const file of item.notices)
      notices += '```text\n' + (await readFile(file, 'utf8')) + '\n```\n\n'
  }
  await writeFile('THIRD_PARTY_NOTICES.md', notices)
  console.log(
    JSON.stringify({
      components: components.length,
      installed: installed.size,
      unknown: components.filter((item) => item.license === 'UNKNOWN').map((item) => item.key),
      lockSha256,
    }),
  )
}
