// Test-owned directory only; no real passwords, accounts, network or production CLI entrypoint.
import { createLocalVault } from './local-vault.mjs'
import { fixtureProjection } from './gateway-fixtures.mjs'
const [directory, stage] = process.argv.slice(2)
if (!directory.includes('today-vault-test-')) throw new Error('fixture_directory_required')
const now = () => Date.parse('2026-10-14T00:00:00.000Z')
const vault = createLocalVault({
  directory,
  now,
  checkpoint: async (current) => {
    if (current === stage) {
      await new Promise((r) => process.send({ stage: current }, r))
      await new Promise(() => {})
    }
  },
})
try {
  await vault.unlock('fixture-owner', 'fixture-only-long-passphrase-rc1')
  const status = vault.status('fixture-owner')
  await vault.publish('fixture-owner', {
    epoch: status.epoch,
    expectedRevision: 1,
    operationId: 'fixture-child',
    consent: true,
    data: fixtureProjection(now(), 'child'),
  })
  await vault.close()
  process.disconnect()
} catch (e) {
  process.send({ error: e.code || 'fixture_failed' }, () => process.disconnect())
}
