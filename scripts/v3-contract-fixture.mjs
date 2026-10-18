import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { assembleOverview, validateSnapshot } from '../server/v3/overview.mjs'

const now = Date.parse('2026-10-10T00:00:00.000Z')
const snapshot = validateSnapshot(
  {
    schemaVersion: 1,
    capturedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
    calendar: { state: 'unconfigured', retrievedAt: null },
    tasks: [
      {
        id: 'fictional-task',
        title: '架空の資料を確認する',
        dueAt: '2026-10-10T02:00:00.000Z',
        importance: 3,
        sourceTime: '2026-10-09T08:00:00.000Z',
      },
      {
        id: 'fictional-unscheduled',
        title: '架空の買い物メモ',
        dueAt: null,
        importance: 1,
        sourceTime: '2026-10-09T08:00:00.000Z',
      },
    ],
    events: [
      {
        id: 'fictional-event',
        title: '架空の打ち合わせ',
        source: 'manual',
        allDay: false,
        startAt: '2026-10-10T03:00:00.000Z',
        endAt: '2026-10-10T04:00:00.000Z',
        startDate: null,
        endDate: null,
        sourceTime: '2026-10-09T08:00:00.000Z',
      },
    ],
  },
  now,
)
const value =
  JSON.stringify(assembleOverview(snapshot, '2026-10-10', 'Asia/Tokyo', now), null, 2) + '\n'
for (const path of [
  '../apps/ios/TodayNative/fictional-overview.json',
  '../apps/ios/TodayNativeCore/Tests/TodayNativeCoreTests/Fixtures/fictional-overview.json',
]) {
  const url = new URL(path, import.meta.url)
  await mkdir(fileURLToPath(new URL('.', url)), { recursive: true })
  await writeFile(url, value)
}
process.stdout.write('Synthetic JS → Swift contract fixtures generated; no user data read.\n')
