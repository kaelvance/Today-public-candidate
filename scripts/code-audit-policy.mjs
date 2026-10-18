// Reviewed, immutable Owner prose. No executable code is exempted.
export function reviewedDocumentationFinding({ file, sha256, line, category }) {
  if (
    file === 'docs/v3/OWNER_ARCHITECTURE_SPEC.md' &&
    sha256 === '65fdc0805ac1557f5c7b81eb507b7ff2a9c776fcd7fee298dc4562e2cc7d9d35' &&
    line === 232 &&
    category === 'unsafeAny'
  )
    return 'Owner specification release-blocker prose; regex matched English, not a TypeScript type. Original document hash verified; no executable exemption.'
  return null
}
