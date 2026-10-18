import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const drift of ['commit', 'working-tree']) {
  test(`qualification rejects ${drift} drift during a gate`, () => {
    const parent = mkdtempSync(join(tmpdir(), 'today-qualification-identity-'))
    try {
      const source = join(parent, 'source'),
        bin = join(parent, 'bin'),
        output = join(parent, 'output')
      mkdirSync(join(source, 'scripts'), { recursive: true })
      mkdirSync(join(source, '.github/workflows'), { recursive: true })
      mkdirSync(bin)
      writeFileSync(join(source, 'package.json'), '{"version":"0.0.0-fixture"}')
      writeFileSync(join(source, 'pnpm-lock.yaml'), 'fixture lock\n')
      writeFileSync(join(source, 'SBOM.cdx.json'), '{}\n')
      writeFileSync(
        join(source, '.github/workflows/release-qualification.yml'),
        'fixture workflow\n',
      )
      copyFileSync(
        fileURLToPath(new URL('./qualify-release.mjs', import.meta.url)),
        join(source, 'scripts/qualify-release.mjs'),
      )
      const git = (...args) =>
        execFileSync(
          'git',
          [
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'commit.gpgsign=false',
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            ...args,
          ],
          { cwd: source, stdio: 'pipe' },
        )
      git('init', '-q')
      git('add', '.')
      git('commit', '-qm', 'fixture baseline')
      const before = git('rev-parse', 'HEAD').toString().trim()
      writeFileSync(
        join(bin, 'pnpm'),
        `#!/bin/sh
if [ "$1" = '--version' ]; then echo '11.19.0'; exit 0; fi
if [ "$1" = 'install' ]; then
  echo 'drift' >> pnpm-lock.yaml
  ${drift === 'commit' ? "git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name=Fixture -c user.email=fixture@example.invalid add pnpm-lock.yaml\ngit -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm 'fixture drift'" : ''}
fi
exit 0
`,
        { mode: 0o755 },
      )
      const result = spawnSync(process.execPath, ['scripts/qualify-release.mjs', output], {
        cwd: source,
        encoding: 'utf8',
        timeout: 15_000,
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: parent, TMPDIR: tmpdir() },
      })
      assert.notEqual(result.status, 0, 'A moving source must never qualify')
      const receipt = JSON.parse(readFileSync(join(output, 'qualification.json'), 'utf8'))
      assert.equal(receipt.commit, before)
      assert.equal(receipt.passed, false)
      assert.match(receipt.failure, /source.*changed|working.*tree/i)
      assert.equal(
        receipt.steps.length,
        1,
        'Stop before running another gate on a different source',
      )
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
}
