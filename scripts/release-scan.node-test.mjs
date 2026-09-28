import test from 'node:test'
import assert from 'node:assert/strict'
import { scan } from './release-scan.mjs'

test('release scanner catches secrets and home paths without returning their values', () => {
  const home = '/' + 'Users' + '/fixture/private'
  const value = 'sk-proj-' + 'a'.repeat(24)
  const findings = scan(`${home}\n${value}\nTODAY_TOKEN_KEY=fictional`, 'fixture.md')
  assert.deepEqual(
    findings.map((item) => item.category),
    ['privateHome', 'credential', 'assignment'],
  )
  assert.equal(JSON.stringify(findings).includes(value), false)
})
test('empty environment examples and reserved fictional email data are allowed', () => {
  assert.deepEqual(scan('OPENAI_API_KEY=\nfictional@example.invalid', '.env.example'), [])
})
