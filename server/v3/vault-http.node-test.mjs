import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTodayServer } from '../index.mjs'
import { fixtureProjection } from './gateway-fixtures.mjs'
const NOW = Date.parse('2026-10-14T00:00:00.000Z'),
  PHRASE = 'fixture-browser-only-long-passphrase'
let nextPort = 44130
async function server(t, enabled = true) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'today-vault-http-')),
    directory = join(parent, 'private'),
    app = await createTodayServer({
      port: nextPort++,
      production: true,
      env: enabled ? { TODAY_V3_VAULT_DIR: directory } : {},
      now: () => new Date(NOW),
      fetchImpl: () => {
        throw new Error('external_fetch_forbidden')
      },
    })
  const base = await app.listen()
  t.after(async () => {
    await app.close()
    rmSync(parent, { recursive: true, force: true })
  })
  const bootstrap = await fetch(base),
    cookie = bootstrap.headers.get('set-cookie').split(';')[0]
  const call = (route, body, headers = {}) =>
    fetch(`${base}/api/v3/vault/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        cookie,
        'x-today-request': '1',
        ...(body === undefined ? {} : { origin: base, 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { base, call, cookie }
}
test('disabled vault does not create storage, core server remains usable', async (t) => {
  const { call } = await server(t, false)
  assert.equal((await (await call('status')).json()).enabled, false)
  assert.equal((await call('setup', { consent: true, passphrase: PHRASE })).status, 503)
})
test('anonymous, cross-origin, cross-site, missing marker and non-JSON auth requests are denied', async (t) => {
  const { base, call } = await server(t)
  assert.equal(
    (await fetch(`${base}/api/v3/vault/status`, { headers: { 'x-today-request': '1' } })).status,
    403,
  )
  assert.equal((await call('status', undefined, { 'x-today-request': '' })).status, 403)
  assert.equal((await call('status', undefined, { origin: 'https://example.invalid' })).status, 403)
  assert.equal((await call('status', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal(
    (
      await call(
        'setup',
        { consent: true, passphrase: PHRASE },
        { origin: 'https://example.invalid' },
      )
    ).status,
    403,
  )
  assert.equal(
    (await call('setup', { consent: true, passphrase: PHRASE }, { 'content-type': 'text/plain' }))
      .status,
    403,
  )
})
test('real HTTP setup/share/read/export/lock is bound to the unlocking session', async (t) => {
  const { base, call } = await server(t)
  assert.equal((await call('setup', { consent: true, passphrase: PHRASE })).status, 200)
  const status = await (await call('status')).json()
  const data = {
    epoch: status.epoch,
    expectedRevision: status.revision,
    operationId: 'fixture-http',
    consent: true,
    data: fixtureProjection(NOW),
  }
  assert.equal((await call('publish', data)).status, 200)
  const response = await call('overview?date=2026-10-14&tz=Asia%2FTokyo')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const overview = await response.json()
  assert.equal(overview.tasks.length, 1)
  assert.equal('vaultRevision' in overview, false)
  const exportResponse = await call('export'),
    backup = await exportResponse.json()
  assert.equal(backup.format, 'today.v3.encrypted-backup.v1')
  assert.equal(JSON.stringify(backup).includes('架空の確認タスク'), false)
  const otherCookie = (await fetch(base)).headers.get('set-cookie').split(';')[0]
  assert.equal(
    (await call('overview?date=2026-10-14&tz=UTC', undefined, { cookie: otherCookie })).status,
    403,
  )
  assert.equal((await call('publish', { ...data, sessionId: status.epoch })).status, 400)
  assert.equal((await call('lock', {})).status, 200)
  assert.equal((await call('export')).status, 403)
  assert.equal((await call('unlock', { consent: true, passphrase: PHRASE })).status, 200)
  assert.equal((await call('export')).status, 200)
})
test('delete confirmation is explicit and malformed operations never change state', async (t) => {
  const { call } = await server(t)
  await call('setup', { consent: true, passphrase: PHRASE })
  const original = await (await call('status')).json()
  assert.equal(
    (await call('archive', { ...original, consent: true, data: { SQL: 'fixture' } })).status,
    400,
  )
  assert.equal((await call('delete-confirm', { confirmed: true })).status, 400)
  const p = await (await call('delete-preview', {})).json()
  assert.equal(
    (
      await call('delete-confirm', {
        nonce: p.nonce,
        epoch: p.epoch,
        revision: p.revision,
        confirmed: false,
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await call('delete-confirm', {
        nonce: p.nonce,
        epoch: p.epoch,
        revision: p.revision,
        confirmed: true,
      })
    ).status,
    200,
  )
  const after = await (await call('status')).json()
  assert.notEqual(after.epoch, original.epoch)
  assert.equal(after.revision, 1)
})
