import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewedDocumentationFinding } from './code-audit-policy.mjs'

const reviewed = {
  file: 'docs/v3/OWNER_ARCHITECTURE_SPEC.md',
  sha256: '65fdc0805ac1557f5c7b81eb507b7ff2a9c776fcd7fee298dc4562e2cc7d9d35',
  line: 232,
  category: 'unsafeAny',
}
test('only the exact immutable prose finding is adjudicated', () => {
  assert.match(reviewedDocumentationFinding(reviewed), /not a TypeScript type/)
})
test('executable source remains a blocker', () => {
  assert.equal(reviewedDocumentationFinding({ ...reviewed, file: 'src/App.tsx' }), null)
})
test('a changed Owner document cannot inherit the adjudication', () => {
  assert.equal(reviewedDocumentationFinding({ ...reviewed, sha256: '0'.repeat(64) }), null)
})
test('other code snippets or lines in the same document remain unreviewed', () => {
  assert.equal(reviewedDocumentationFinding({ ...reviewed, line: 233 }), null)
})
test('private-path and other security categories are never exempted', () => {
  assert.equal(reviewedDocumentationFinding({ ...reviewed, category: 'absolutePath' }), null)
})
