import type { StepFnResultRuleId, StepStatus } from './flowClasses.ts'
import { BranchStepFlowResult, FlowResult, StepBranchInfo, StepFnResult, StepResult } from './flowClasses.ts'

type ResultNode = FlowResult | StepResult | BranchStepFlowResult
type ResultConverter = (value: ResultNode) => any

type ConvertedStepResult = {
  id?: string
  ruleId?: string
  name?: string
  description?: string
  status: StepStatus
  originalStatus?: StepStatus
  path?: string
  message?: string
  variables?: Record<string, unknown>
  results?: Record<string, unknown>[]
  selectedBranchKeys?: PropertyKey[]
  branches?: ConvertedBranchStepFlowResult[]
}

type ConvertedBranchStepFlowResult = {
  key: PropertyKey
  status: StepStatus
  stepResults: ConvertedStepResult[]
}

type ConvertedFlowResult = {
  status: StepStatus
  stepResults: ConvertedStepResult[]
}

type ResultTreeStep = {
  stepInfo: { id?: string; options?: { description?: string } }
  status: StepStatus
  path?: string
  message?: string
  variables?: Record<string, unknown>
  results?: StepFnResult[]
  branches?: ResultTreeBranch[]
}

type ResultTreeBranch = {
  stepResults: ResultTreeStep[]
}

function visitResultTree(
  stepResults: readonly ResultTreeStep[],
  visit: (stepResult: ResultTreeStep, path: string | undefined) => void,
  parentPath?: string
): void {
  for (const stepResult of stepResults) {
    const path = joinPath(parentPath, stepResult.path)
    visit(stepResult, path)

    for (const branch of stepResult.branches ?? []) {
      visitResultTree(branch.stepResults, visit, path)
    }
  }
}

export type FlattenedFailedStepResult = {
  id: string
  status: StepStatus
  description?: string
  path?: string
  message?: string
  variables: Record<string, unknown>
}

type FlattenedStepMetadata = {
  id: string
  status: StepStatus
  description?: string
}

function metadataFromRuleId(
  ruleId: StepFnResultRuleId | undefined,
  fallback: FlattenedStepMetadata
): FlattenedStepMetadata {
  if (ruleId === undefined) {
    return fallback
  }

  if (typeof ruleId === 'string') {
    return {
      ...fallback,
      id: ruleId,
    }
  }

  return {
    ...fallback,
    id: ruleId.id,
    ...(ruleId.description === undefined ? {} : { description: ruleId.description }),
  }
}

function joinPath(parentPath: string | undefined, path: string | undefined): string | undefined {
  if (parentPath == null || parentPath.length === 0) {
    return path
  }

  if (path == null || path.length === 0) {
    return parentPath
  }

  return `${parentPath}.${path}`
}

function flattenStepFnResults(
  results: readonly StepFnResult[] | undefined,
  parentPath: string | undefined,
  includeAll: boolean,
  metadata: FlattenedStepMetadata,
  flattenedResults: FlattenedFailedStepResult[]
): void {
  for (const result of results ?? []) {
    const path = joinPath(parentPath, result.path)
    const shouldInclude = includeAll || result.status === 'error' || result.status === 'exception'
    const resultMetadata = {
      ...metadataFromRuleId(result.ruleId, metadata),
      status: result.status,
    }

    if (shouldInclude) {
      flattenedResults.push({
        ...resultMetadata,
        ...(path === undefined ? {} : { path }),
        ...(result.message === undefined ? {} : { message: result.message }),
        variables: result.variables,
      })
    }

    flattenStepFnResults(result.results, path, shouldInclude, resultMetadata, flattenedResults)
  }
}

export function flattenFailedStepResults(
  stepResults: ReadonlyArray<{
    stepInfo: { id?: string; options?: { description?: string } }
    status: StepStatus
    path?: string
    message?: string
    variables?: Record<string, unknown>
    results?: StepFnResult[]
    branches?: Array<{ stepResults: any[] }>
  }>
): FlattenedFailedStepResult[] {
  const flattenedResults: FlattenedFailedStepResult[] = []

  visitResultTree(stepResults, (stepResult, path) => {
    const isFailed = stepResult.status === 'error' || stepResult.status === 'exception'
    const hasFailureIdentity = !isBranchStepInfo(stepResult.stepInfo) || stepResult.stepInfo.rawId !== undefined

    const failureId = stepResult.stepInfo.id
    if (isFailed && hasFailureIdentity && failureId !== undefined) {
      flattenedResults.push({
        id: failureId,
        status: stepResult.status,
        ...(stepResult.stepInfo.options?.description === undefined
          ? {}
          : { description: stepResult.stepInfo.options.description }),
        ...(path === undefined ? {} : { path }),
        ...(stepResult.message === undefined ? {} : { message: stepResult.message }),
        variables: stepResult.variables ?? {},
      })
    }

    flattenStepFnResults(
      stepResult.results,
      path,
      isFailed,
      {
        id: stepResult.stepInfo.id ?? '',
        status: stepResult.status,
        ...(stepResult.stepInfo.options?.description === undefined
          ? {}
          : { description: stepResult.stepInfo.options.description }),
      },
      flattenedResults
    )
  })

  return flattenedResults
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isBranchStepInfo(value: unknown): value is StepBranchInfo {
  return value instanceof StepBranchInfo
}

function formatRuleId(ruleId: unknown): string | undefined {
  if (typeof ruleId === 'string') {
    return ruleId
  }

  return ruleId != null && typeof ruleId === 'object' && 'id' in ruleId && typeof ruleId.id === 'string'
    ? ruleId.id
    : undefined
}

function defaultResultConverter(
  value: ResultNode
): ConvertedFlowResult | ConvertedStepResult | ConvertedBranchStepFlowResult {
  if (value instanceof FlowResult) {
    return {
      status: value.status,
      stepResults: [],
    }
  }

  if (value instanceof BranchStepFlowResult) {
    return {
      key: value.key,
      status: value.status,
      stepResults: [],
    }
  }

  return {
    ...(value.stepInfo.id === undefined ? {} : { id: value.stepInfo.id }),
    ...(isBranchStepInfo(value.stepInfo) && formatRuleId(value.stepInfo.rawId) !== undefined
      ? { ruleId: formatRuleId(value.stepInfo.rawId) }
      : {}),
    ...(isBranchStepInfo(value.stepInfo) && value.stepInfo.options?.name !== undefined
      ? { name: value.stepInfo.options.name }
      : {}),
    ...(value.stepInfo.options?.description === undefined ? {} : { description: value.stepInfo.options.description }),
    status: value.status,
    ...(value.originalStatus === undefined ? {} : { originalStatus: value.originalStatus }),
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.message === undefined ? {} : { message: value.message }),
    ...(value.variables === undefined ? {} : { variables: value.variables as Record<string, unknown> }),
    ...(value.results === undefined ? {} : { results: value.results as unknown as Record<string, unknown>[] }),
    ...(value.selectedBranchKeys == null ? {} : { selectedBranchKeys: value.selectedBranchKeys }),
    ...(value.branches == null ? {} : { branches: [] }),
  }
}

export function convertResultNode(value: ResultNode, converter: ResultConverter = defaultResultConverter): unknown {
  const convertedValue = converter(value)

  if (!isObjectLike(convertedValue)) {
    return convertedValue
  }

  if (value instanceof FlowResult) {
    return {
      ...convertedValue,
      stepResults: value.stepResults.map((stepResult) => convertResultNode(stepResult, converter)),
    }
  }

  if (value instanceof BranchStepFlowResult) {
    return {
      ...convertedValue,
      stepResults: value.stepResults.map((stepResult) => convertResultNode(stepResult, converter)),
    }
  }

  return {
    ...convertedValue,
    ...(value.branches == null
      ? {}
      : { branches: value.branches.map((branch) => convertResultNode(branch, converter)) }),
  }
}
