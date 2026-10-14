import { it, expect } from 'vitest'
// @ts-expect-error Node built-in used only by Vitest; product TS config has browser types
import { createHash } from 'node:crypto'
// @ts-expect-error Node built-in used only for cleanup of this test's synthetic directory
import { rmSync } from 'node:fs'
import { makeBackup } from '../backup'
import type { PersistedState } from '../types'
import { projectWorkspace } from './projection'
import { inspectFixtureV2Backup } from './fixture-migration'
import {
  createFixtureStoreDirectory,
  openFixtureSQLiteStore,
} from '../../server/v3/sqlite-workspace-store.mjs'
// @ts-expect-error existing in-process Mock protocol; no production transport
import { createMockGateway } from '../../server/v3/mock-gateway.mjs'
// @ts-expect-error existing ephemeral fixture client
import { fixtureDevice, enrollFixture, readFixture } from '../../server/v3/gateway-fixtures.mjs'

it('actual V2 exporter → dry-run → selected projection → SQLite → reopen → signed Mock read', async () => {
  const stamp = '2026-10-11T00:00:00.000Z',
    now = () => Date.parse(stamp)
  const state: PersistedState = {
    version: 3,
    theme: 'light',
    showSamples: false,
    queuedActions: [],
    items: [
      {
        id: 'fixture-migration-task',
        kind: 'task',
        title: '架空の復旧検証',
        description: '投影へ含めない架空詳細',
        source: '手動',
        sourceId: 'manual',
        createdAt: stamp,
        lastUpdated: stamp,
        sourceUpdatedAt: stamp,
        importance: 2,
        pinned: true,
        requiresAction: true,
        confidence: 'high',
        status: 'active',
        syncStatus: 'synced',
        demo: false,
        deadline: '2026-10-11T06:00:00.000Z',
        actions: [
          {
            id: 'view',
            label: '詳細を見る',
            type: 'view',
            riskLevel: 0,
            plugin: 'manual',
            requiresConfirmation: false,
          },
        ],
      },
    ],
  }
  const original = JSON.stringify(state),
    exported = JSON.parse(makeBackup(state))
  exported.exportedAt = stamp
  const source = JSON.stringify(exported, null, 2),
    sourceHash = createHash('sha256').update(source).digest('hex')
  const report = inspectFixtureV2Backup({
    fixtureOnly: true,
    backupJSON: source,
    now: new Date(now()),
  })
  expect(report.findings).toEqual([])
  expect(report.status).toBe('DRY_RUN_COMPATIBLE')
  expect(report.candidateState).not.toBeNull()
  const projection = projectWorkspace(
    report.candidateState!,
    ['fixture-migration-task'],
    { configured: false, connection: 'disconnected', phase: 'idle' },
    new Date(now()),
  )
  expect(JSON.stringify(projection)).not.toContain('投影へ含めない架空詳細')
  const directory = createFixtureStoreDirectory({ fixtureOnly: true })
  let store, gateway
  try {
    store = openFixtureSQLiteStore({ fixtureOnly: true, directory })
    gateway = await createMockGateway({
      fixtureOnly: true,
      workspaceIds: ['fixture-one'],
      store,
      now,
    })
    const request = {
      fixtureOnly: true,
      expectedRevision: 0,
      operationId: 'fixture-migration-shadow',
      data: projection,
    }
    await gateway.owners.get('fixture-one').replaceFixture(request)
    await gateway.close()
    await store.close()
    store = openFixtureSQLiteStore({ fixtureOnly: true, directory })
    gateway = await createMockGateway({
      fixtureOnly: true,
      workspaceIds: ['fixture-one'],
      store,
      now,
    })
    await gateway.owners.get('fixture-one').replaceFixture(request)
    expect(store.diagnostics().writeCount).toBe(0)
    const device = fixtureDevice(),
      grant = enrollFixture(gateway, gateway.owners.get('fixture-one'), device)
    const result = await readFixture(gateway, device, grant.deviceId, 'tasks')
    expect(result.tasks[0].id).toBe('fixture-migration-task')
    expect(result.tasks[0].dueAt).toBe(state.items[0].deadline)
    expect(result.capturedAt).toBe(stamp)
    expect(result.revision).toBe(1)
    expect(createHash('sha256').update(report.sourceArchive).digest('hex')).toBe(sourceHash)
    expect(JSON.stringify(state)).toBe(original)
  } finally {
    await gateway?.close()
    await store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
