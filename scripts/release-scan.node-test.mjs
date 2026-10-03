import test from 'node:test'
import assert from 'node:assert/strict'
import { scan, emailRequiresReview } from './release-scan.mjs'

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
test('approved CoC contact is scoped to its exact address and document', () => {
  const address = ['today.coc.taccitypark', 'gmail.com'].join('@')
  assert.equal(emailRequiresReview(address, 'CODE_OF_CONDUCT.md'), false)
  assert.equal(emailRequiresReview(address, 'README.md'), true)
  assert.equal(
    emailRequiresReview(address.replace('taccitypark', 'other'), 'CODE_OF_CONDUCT.md'),
    true,
  )
  assert.equal(emailRequiresReview('fictional@example.invalid', 'README.md'), false)
  assert.equal(emailRequiresReview(['another', 'gmail.com'].join('@'), 'CODE_OF_CONDUCT.md'), true)
})
