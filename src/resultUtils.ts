import type { StepFnResultRuleId, StepStatus } from './flowClasses.ts'
import { BranchStepFlowResult, FlowResult, StepBranchInfo, StepFnResult, StepResult } from './flowClasses.ts'
import { getRuleId } from './utils.ts'

type ResultNode = FlowResult | StepResult | BranchStepFlowResult
type ResultConverter = (value: ResultNode) => unknown

export type ConvertedStepResult = {
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

type ConvertedResultWithSteps = {
  status: StepStatus
  stepResults: ConvertedStepResult[]
}

export type ConvertedBranchStepFlowResult = ConvertedResultWithSteps & {
  key: PropertyKey
}

export type ConvertedFlowResult = ConvertedResultWithSteps

export type FlattenedStepResult = {
  id?: string
  status: StepStatus
  description?: string
  path?: string
  message?: string
  variables: Record<string, unknown>
}

export type FlattenedFailedStepResult = FlattenedStepResult & {
  id: string
}

export type FlattenStepResultParams = {
  failed: boolean
  flattenedResult: FlattenedStepResult
  stepResult: StepResult | StepFnResult
}

export type FlattenStepResultFn<Item> = (params: FlattenStepResultParams) => Item | undefined

type FlattenedStepMetadata = Pick<FlattenedStepResult, 'id' | 'status' | 'description'>

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

function visitResultTree(
  results: readonly (StepResult | StepFnResult)[],
  visit: (params: FlattenStepResultParams) => void,
  parentPath?: string,
  parentFailed = false,
  parentMetadata?: FlattenedStepMetadata
): void {
  for (const result of results) {
    const isFlowStep = result instanceof StepResult
    const path = joinPath(parentPath, result.path)
    const failed = (!isFlowStep && parentFailed) || result.status === 'fail' || result.status === 'exception'
    const flowStepId =
      isFlowStep && (!(result.stepInfo instanceof StepBranchInfo) || result.stepInfo.rawId !== undefined)
        ? result.stepInfo.id
        : undefined
    const metadata: FlattenedStepMetadata = isFlowStep
      ? {
          ...(flowStepId === undefined ? {} : { id: flowStepId }),
          status: result.status,
          ...(result.stepInfo.options?.description === undefined
            ? {}
            : { description: result.stepInfo.options.description }),
        }
      : {
          ...metadataFromRuleId(result.ruleId, parentMetadata ?? { status: result.status }),
          status: result.status,
        }

    visit({
      failed,
      flattenedResult: {
        ...metadata,
        ...(path === undefined ? {} : { path }),
        ...(result.message === undefined ? {} : { message: result.message }),
        variables: result.variables ?? {},
      },
      stepResult: result,
    })

    if (result.results !== undefined) {
      visitResultTree(result.results, visit, path, failed, metadata)
    }

    if (isFlowStep) {
      for (const branch of result.branches ?? []) {
        visitResultTree(branch.stepResults, visit, path)
      }
    }
  }
}

function failedStepResult({ failed, flattenedResult }: FlattenStepResultParams): FlattenedFailedStepResult | undefined {
  return failed && flattenedResult.id !== undefined ? { ...flattenedResult, id: flattenedResult.id } : undefined
}

export function flattenStepResults(stepResults: readonly StepResult[]): FlattenedFailedStepResult[]
export function flattenStepResults<FlattenedResult>(
  stepResults: readonly StepResult[],
  fn: FlattenStepResultFn<FlattenedResult>
): FlattenedResult[]
export function flattenStepResults<FlattenedResult>(
  stepResults: readonly StepResult[],
  fn: FlattenStepResultFn<FlattenedResult> = failedStepResult as FlattenStepResultFn<FlattenedResult>
): FlattenedResult[] {
  const flattenedResults: FlattenedResult[] = []

  visitResultTree(stepResults, (params) => {
    const item = fn(params)

    if (item !== undefined) {
      flattenedResults.push(item)
    }
  })

  return flattenedResults
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function defaultResultConverter(
  value: ResultNode
): ConvertedFlowResult | ConvertedStepResult | ConvertedBranchStepFlowResult {
  if (value instanceof FlowResult || value instanceof BranchStepFlowResult) {
    const converted = { status: value.status, stepResults: [] }
    return value instanceof BranchStepFlowResult ? { key: value.key, ...converted } : converted
  }

  const branchInfo = value.stepInfo instanceof StepBranchInfo ? value.stepInfo : undefined
  const ruleId = getRuleId(branchInfo?.rawId)

  return {
    ...(value.stepInfo.id === undefined ? {} : { id: value.stepInfo.id }),
    ...(ruleId === undefined ? {} : { ruleId }),
    ...(branchInfo?.options?.name === undefined ? {} : { name: branchInfo.options.name }),
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

  if (value instanceof FlowResult || value instanceof BranchStepFlowResult) {
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
