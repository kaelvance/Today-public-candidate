import golden from '../../evals/golden-v1.json'
import { intelligenceRequest, IntelligenceRouter } from './router'
import type {
  Capability,
  IntelligencePolicy,
  IntelligenceProvider,
  IntelligenceRequest,
} from './types'

export interface GoldenCase {
  id: string
  category: string
  capability: Capability
  input: unknown
  expected: Record<string, unknown>
  allowedAlternatives: Record<string, unknown>[]
  difficulty: string
  language: string
  privacySafeSynthetic: true
  reason: string
  evidence: string[]
}
export interface GoldenDataset {
  datasetVersion: string
  synthetic: true
  cases: GoldenCase[]
}
export const todayIntelligenceBenchmark: GoldenDataset = golden as GoldenDataset
const positive = new Set(['SAME_CONTEXT', 'RELATED'])
const negative = new Set(['UNRELATED', 'CONFLICTING'])

function matches(caseData: GoldenCase, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  if (caseData.category === 'temporal') {
    const expressions = result.expressions as Array<{ iso: string | null }> | undefined
    const expected = String(caseData.expected.expectedTemporal)
    return expected === 'UNKNOWN'
      ? !expressions?.some((entry) => entry.iso)
      : !!expressions?.some((entry) => entry.iso?.startsWith(expected))
  }
  if (caseData.category === 'fact_extraction') {
    const facts = result.facts as Array<{ field: string; value: string }> | undefined
    return !!facts?.some(
      (fact) =>
        fact.field === caseData.expected.field &&
        fact.value.includes(String(caseData.expected.value)),
    )
  }
  if (caseData.category === 'summarization') {
    const summary = result.summary
    const sourceIds = result.sourceIds
    return (
      typeof summary === 'string' &&
      Array.isArray(sourceIds) &&
      JSON.stringify(sourceIds) === JSON.stringify(caseData.expected.sourceIds) &&
      (caseData.expected.mustContain as string[]).every((phrase) => summary.includes(phrase)) &&
      (caseData.expected.forbidden as string[]).every((phrase) => !summary.includes(phrase))
    )
  }
  if (caseData.category === 'structured_output')
    return (
      typeof result.summary === 'string' &&
      Array.isArray(result.sourceIds) &&
      JSON.stringify(result.sourceIds) === JSON.stringify(caseData.expected.sourceIds)
    )
  return [caseData.expected, ...caseData.allowedAlternatives].some((expected) =>
    Object.entries(expected).every(([key, target]) => result[key] === target),
  )
}
export interface BenchmarkReport {
  datasetVersion: string
  providerId: string
  cases: number
  categories: Record<string, { cases: number; correct: number; accuracy: number }>
  metrics: {
    contextPrecision: number | null
    contextRecall: number | null
    falseMergeRate: number
    missedRelationRate: number
    factExtractionAccuracy: number
    temporalAccuracy: number
    conflictAccuracy: number
    classificationAccuracy: number
    inputAccuracy: number
    schemaComplianceRate: number
    unknownCalibration: number
    medianLatencyMs: number
    p95LatencyMs: number
    memoryMiB: number | null
    modelSizeMiB: number | null
  }
  results: Array<{
    id: string
    status: string
    reason?: string
    correct: boolean
    expected: Record<string, unknown>
    actual: unknown
    rawRelation?: string
    sourceIdsRepaired?: boolean
    rawConfidence?: number
    policyConfidence?: number
    latencyMs: number
  }>
}
export async function runBenchmark(
  provider: IntelligenceProvider,
  policy: IntelligencePolicy,
  dataset: GoldenDataset = todayIntelligenceBenchmark,
  metadata: { memoryMiB?: number; modelSizeMiB?: number; latencyMs?: number } = {},
): Promise<BenchmarkReport> {
  if (
    !dataset.synthetic ||
    !dataset.datasetVersion ||
    new Set(dataset.cases.map((item) => item.id)).size !== dataset.cases.length ||
    dataset.cases.some((item) => !item.privacySafeSynthetic)
  )
    throw new Error('INVALID_DATASET')
  const router = new IntelligenceRouter([provider], policy)
  const results: BenchmarkReport['results'] = []
  for (const testCase of dataset.cases) {
    const request = intelligenceRequest(
      testCase.capability,
      testCase.input as IntelligenceRequest['input'],
      'PUBLIC',
      testCase.id,
      {
        traceId: testCase.id,
        minConfidence: 0,
        fallback: 'UNKNOWN',
        budget: {
          latencyMs: metadata.latencyMs ?? 500,
          maxInputChars: 4000,
          maxOutputChars: 2000,
          maxContextItems: 6,
          maxCalls: 1,
        },
      },
    )
    const started = performance.now()
    const route = await router.route(request, new AbortController().signal)
    const actual = route.status === 'proposal' ? route.proposal.value : null
    const diagnostic =
      router.diagnostics.at(-1)?.traceId === testCase.id ? router.diagnostics.at(-1) : undefined
    results.push({
      id: testCase.id,
      status: route.status,
      reason: route.status === 'proposal' ? undefined : route.reason,
      correct: matches(testCase, actual),
      expected: testCase.expected,
      actual,
      rawRelation: diagnostic?.rawRelation,
      sourceIdsRepaired: diagnostic?.sourceIdsRepaired,
      rawConfidence: route.status === 'proposal' ? route.proposal.confidence : undefined,
      policyConfidence: diagnostic?.policyConfidence,
      latencyMs: Math.round(performance.now() - started),
    })
  }
  const categories: BenchmarkReport['categories'] = {}
  for (const result of results) {
    const category = dataset.cases.find((testCase) => testCase.id === result.id)!.category
    const row = categories[category] || { cases: 0, correct: 0, accuracy: 0 }
    row.cases++
    row.correct += Number(result.correct)
    row.accuracy = row.correct / row.cases
    categories[category] = row
  }
  const pairs = dataset.cases.filter((item) => item.capability === 'compareContextCandidates')
  const lookup = new Map(results.map((result) => [result.id, result]))
  let tp = 0,
    fp = 0,
    fn = 0,
    negatives = 0,
    conflicts = 0,
    conflictsCorrect = 0,
    unknowns = 0,
    unknownsCorrect = 0
  for (const item of pairs) {
    const actual = lookup.get(item.id)?.actual as { relation?: string } | null
    const truth = String(item.expected.relation)
    const predicted = actual?.relation || 'UNKNOWN'
    if (positive.has(truth) && positive.has(predicted)) tp++
    if (positive.has(truth) && !positive.has(predicted)) fn++
    if (negative.has(truth)) {
      negatives++
      if (positive.has(predicted)) fp++
    }
    if (truth === 'CONFLICTING') {
      conflicts++
      conflictsCorrect += Number(predicted === truth)
    }
    if (truth === 'UNKNOWN') {
      unknowns++
      unknownsCorrect += Number(predicted === truth)
    }
  }
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b)
  return {
    datasetVersion: dataset.datasetVersion,
    providerId: provider.id,
    cases: results.length,
    categories,
    metrics: {
      contextPrecision: tp + fp ? tp / (tp + fp) : null,
      contextRecall: tp + fn ? tp / (tp + fn) : null,
      falseMergeRate: negatives ? fp / negatives : 0,
      missedRelationRate: tp + fn ? fn / (tp + fn) : 0,
      factExtractionAccuracy: categories.fact_extraction?.accuracy || 0,
      temporalAccuracy: categories.temporal?.accuracy || 0,
      conflictAccuracy: conflicts ? conflictsCorrect / conflicts : 0,
      classificationAccuracy: categories.classification?.accuracy || 0,
      inputAccuracy: categories.input_interpretation?.accuracy || 0,
      schemaComplianceRate: results.length
        ? results.filter((result) => result.status === 'proposal').length / results.length
        : 0,
      unknownCalibration: unknowns ? unknownsCorrect / unknowns : 0,
      medianLatencyMs: latencies[Math.floor(latencies.length / 2)] || 0,
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] || 0,
      memoryMiB: metadata.memoryMiB ?? null,
      modelSizeMiB: metadata.modelSizeMiB ?? null,
    },
    results,
  }
}
