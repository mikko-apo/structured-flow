import type { StepStatus } from './flowClasses.ts'
import { BranchStepFlowResult, FlowResult, StepResult } from './flowClasses.ts'

export type FailedStepIdOptions = {
  branchPrefix?: boolean
}

type ResultNode = FlowResult | StepResult | BranchStepFlowResult
type ResultConverter = (value: ResultNode) => any

type ConvertedStepResult = {
  id: string
  description?: string
  status: StepStatus
  originalStatus?: StepStatus
  path?: string
  message?: string
  result?: Record<string, unknown>
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
  stepInfo: { id: string }
  status: StepStatus
  branches?: ResultTreeBranch[]
}

type ResultTreeBranch = {
  stepResults: ResultTreeStep[]
}

function visitResultTree(
  stepResults: readonly ResultTreeStep[],
  visit: (stepResult: ResultTreeStep, branchPath: string[]) => void,
  branchPath: string[] = []
): void {
  for (const stepResult of stepResults) {
    visit(stepResult, branchPath)

    for (const branch of stepResult.branches ?? []) {
      visitResultTree(branch.stepResults, visit, [...branchPath, stepResult.stepInfo.id])
    }
  }
}

export function collectFailedStepIds(
  stepResults: ReadonlyArray<{
    stepInfo: { id: string }
    status: StepStatus
    branches?: Array<{ stepResults: any[] }>
  }>,
  options: FailedStepIdOptions = {}
): string[] {
  const failedStepIds: string[] = []

  visitResultTree(stepResults, (stepResult, branchPath) => {
    if (stepResult.status !== 'error' && stepResult.status !== 'exception') {
      return
    }

    failedStepIds.push(
      options.branchPrefix && branchPath.length > 0
        ? [...branchPath, stepResult.stepInfo.id].join('/')
        : stepResult.stepInfo.id
    )
  })

  return failedStepIds
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
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
    id: value.stepInfo.id,
    ...(value.stepInfo.options?.description === undefined ? {} : { description: value.stepInfo.options.description }),
    status: value.status,
    ...(value.originalStatus === undefined ? {} : { originalStatus: value.originalStatus }),
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.message === undefined ? {} : { message: value.message }),
    ...(value.result === undefined ? {} : { result: value.result as Record<string, unknown> }),
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
