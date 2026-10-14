// Child-process fixture only. No HTTP, credentials, models, or real user databases.
import { openFixtureSQLiteStore } from './sqlite-workspace-store.mjs'
import { createMockGateway } from './mock-gateway.mjs'
import { fixtureProjection } from './gateway-fixtures.mjs'

const [directory, mode, pauseAt] = process.argv.slice(2)
const now = () => Date.parse('2026-10-11T00:00:00.000Z')
const send = (message) => new Promise((resolve) => process.send(message, resolve))
try {
  const store = openFixtureSQLiteStore({
    fixtureOnly: true,
    directory,
    checkpoint: async (phase) => {
      if (phase === pauseAt) {
        await send({ kind: 'checkpoint', phase })
        await new Promise(() => {})
      }
    },
  })
  if (mode === 'hold') {
    const lease = await store.claimWriter()
    await send({ kind: 'claimed' })
    process.on('message', async (message) => {
      if (message !== 'close') return
      await store.releaseWriter(lease)
      await store.close()
      await send({ kind: 'closed' })
      process.disconnect()
    })
  } else if (mode === 'write') {
    const gateway = await createMockGateway({
      fixtureOnly: true,
      workspaceIds: ['fixture-one'],
      store,
      now,
    })
    await gateway.owners.get('fixture-one').replaceFixture({
      fixtureOnly: true,
      expectedRevision: 1,
      operationId: 'child-write',
      data: fixtureProjection(now(), '-child'),
    })
    await gateway.close()
    await store.close()
    await send({ kind: 'written' })
    process.disconnect()
  } else {
    await send({ kind: 'error', code: 'invalid_fixture_mode' })
    process.disconnect()
  }
} catch (error) {
  await send({ kind: 'error', code: error.code || 'fixture_worker_failed' })
  process.disconnect()
}
