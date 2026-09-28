import { capabilities, type Capability } from './types'

export interface TrainingExample {
  schemaVersion: 1
  datasetVersion: string
  id: string
  capability: Capability
  rawSyntheticExample: Record<string, unknown>
  canonicalTarget: Record<string, unknown>
  difficulty: 'easy' | 'medium' | 'hard'
  language: string
  sourceGenerator: string
  validationStatus: 'candidate' | 'validated' | 'rejected'
  licenseProvenance: {
    sourceLicense: string
    generatorLicense: string
    teacherTerms: string
    redistribution: 'permitted' | 'prohibited' | 'unverified'
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export function validateTrainingExample(value: unknown): TrainingExample {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.datasetVersion !== 'string' ||
    !/^[\w.-]+$/.test(String(value.id)) ||
    !capabilities.includes(value.capability as Capability) ||
    !record(value.rawSyntheticExample) ||
    !record(value.canonicalTarget) ||
    !['easy', 'medium', 'hard'].includes(String(value.difficulty)) ||
    typeof value.language !== 'string' ||
    typeof value.sourceGenerator !== 'string' ||
    !['candidate', 'validated', 'rejected'].includes(String(value.validationStatus))
  )
    throw new Error('INVALID_TRAINING_EXAMPLE')
  const license = value.licenseProvenance
  if (
    !record(license) ||
    !license.sourceLicense ||
    !license.generatorLicense ||
    !license.teacherTerms ||
    !['permitted', 'prohibited', 'unverified'].includes(String(license.redistribution))
  )
    throw new Error('LICENSE_INCOMPLETE')
  return structuredClone(value) as unknown as TrainingExample
}
export function prepareSyntheticDataset(candidates: unknown[]): {
  accepted: TrainingExample[]
  rejected: Array<{ index: number; reason: string }>
} {
  const accepted: TrainingExample[] = []
  const rejected: Array<{ index: number; reason: string }> = []
  const seen = new Set<string>()
  candidates.forEach((candidate, index) => {
    try {
      const example = validateTrainingExample(candidate)
      if (example.validationStatus !== 'validated') throw new Error('NOT_VALIDATED')
      if (example.licenseProvenance.redistribution !== 'permitted')
        throw new Error('LICENSE_UNVERIFIED')
      const key = JSON.stringify([
        example.capability,
        example.rawSyntheticExample,
        example.canonicalTarget,
      ])
      if (seen.has(key)) throw new Error('DUPLICATE')
      seen.add(key)
      accepted.push(example)
    } catch (error) {
      rejected.push({ index, reason: error instanceof Error ? error.message : 'INVALID' })
    }
  })
  return { accepted, rejected }
}
