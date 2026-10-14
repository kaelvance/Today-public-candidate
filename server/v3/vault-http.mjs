// Same-origin loopback ONLY. This is not remote identity, OAuth or a device pairing transport.
export async function handleVaultRequest({
  req,
  res,
  url,
  baseUrl,
  vault,
  validSession,
  readJson,
  send,
}) {
  if (!url.pathname.startsWith('/api/v3/vault/')) return false
  const route = url.pathname.slice('/api/v3/vault/'.length)
  const queryKeys = [...url.searchParams.keys()]
  if (
    route.startsWith('overview')
      ? queryKeys.length !== 2 ||
        queryKeys.filter((k) => k === 'date').length !== 1 ||
        queryKeys.filter((k) => k === 'tz').length !== 1
      : queryKeys.length !== 0
  ) {
    send(res, 400, { code: 'vault_invalid_query' })
    return true
  }
  if (
    req.headers['x-today-request'] !== '1' ||
    (req.headers.origin && req.headers.origin !== baseUrl) ||
    (req.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
  ) {
    send(res, 403, { code: 'vault_request_denied' })
    return true
  }
  const sid = validSession(req)
  if (!sid) {
    send(res, 403, { code: 'vault_request_denied' })
    return true
  }
  if (!vault) {
    send(res, route === 'status' ? 200 : 503, { enabled: false, code: 'vault_disabled' })
    return true
  }
  try {
    let result
    if (req.method === 'GET' && route === 'status') result = vault.status(sid)
    else if (req.method === 'GET' && route === 'overview')
      result = vault.overview(sid, url.searchParams.get('date'), url.searchParams.get('tz'))
    else if (req.method === 'GET' && route === 'export') result = vault.export(sid)
    else if (req.method === 'GET' && route === 'archive-export') result = vault.archiveExport(sid)
    else if (req.method === 'POST') {
      if (
        req.headers.origin !== baseUrl ||
        !req.headers['content-type']?.startsWith('application/json')
      )
        throw Object.assign(new Error(), { code: 'vault_request_denied', status: 403 })
      const limits = {
        setup: 2048,
        unlock: 2048,
        lock: 256,
        publish: 131_072,
        archive: 2_150_000,
        preview: 3_050_000,
        'delete-preview': 256,
        'delete-confirm': 2048,
        'cancel-delete': 256,
        'restore-confirm': 2048,
        'cancel-restore': 256,
      }
      if (!Object.hasOwn(limits, route)) {
        send(res, 404, { code: 'vault_not_found' })
        return true
      }
      const body = await readJson(req, limits[route])
      if (['setup', 'unlock'].includes(route)) {
        if (
          !body ||
          Object.keys(body).sort().join(',') !== 'consent,passphrase' ||
          body.consent !== true
        )
          throw new Error('vault_invalid_input')
        result = await vault[route](sid, body.passphrase)
      } else if (route === 'lock') {
        if (JSON.stringify(body) !== '{}') throw new Error('vault_invalid_input')
        result = vault.lock(sid)
      } else if (route === 'publish') result = await vault.publish(sid, body)
      else if (route === 'archive') result = await vault.archive(sid, body)
      else if (route === 'preview') result = await vault.preview(sid, body)
      else if (route === 'delete-preview') {
        if (JSON.stringify(body) !== '{}') throw new Error('vault_invalid_input')
        result = vault.deletePreview(sid)
      } else if (route === 'cancel-delete') {
        if (!body || Object.keys(body).join(',') !== 'nonce' || typeof body.nonce !== 'string')
          throw new Error('vault_invalid_input')
        result = vault.cancelDelete(sid, body.nonce)
      } else if (route === 'restore-confirm') result = await vault.confirmRestore(sid, body)
      else if (route === 'cancel-restore') {
        if (
          !body ||
          Object.keys(body).join(',') !== 'restoreToken' ||
          typeof body.restoreToken !== 'string'
        )
          throw new Error('vault_invalid_input')
        result = vault.cancelRestore(sid, body.restoreToken)
      } else result = await vault.confirmDelete(sid, body)
    } else {
      send(res, 405, { code: 'vault_method_denied' })
      return true
    }
    send(res, 200, result)
  } catch (error) {
    const candidate = error.code || error.message || ''
    const known =
      /^(vault_[a-z_]+|invalid_portable|portable_too_[a-z_]+|snapshot_expired|invalid_snapshot|invalid_query|future_source|invalid_projection)$/.test(
        candidate,
      )
    send(res, error.status || (known ? 400 : 503), {
      code: known ? candidate : 'vault_unavailable',
    })
  }
  return true
}
