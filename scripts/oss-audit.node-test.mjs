import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { audit, scanText } from './oss-audit.mjs'

test('redacts findings and detects unsafe absolute homes and secrets', () => {
  const findings = scanText(
    '/Users/example/private/model\nkey=' + 'sk-proj-' + 'a'.repeat(24),
    'fixture',
  )
  assert.deepEqual(
    findings.map((row) => row.category),
    ['machineSpecificHome', 'likelySecret'],
  )
  assert.equal(JSON.stringify(findings).includes('abcdefghijklmnop'), false)
})
test('production source and launch script contain no identified credentials or user paths', async () => {
  assert.deepEqual(await audit(), [])
})
