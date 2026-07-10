import { getOwnEntries } from './utils.ts'
import {
  BranchStepFlowResult,
  FlowResult,
  type FlowLike,
  type FlowStepInfo,
  StepBranchInfo,
  StepInfo,
  StepResult,
  type StepStatus,
  stepStatuses,
} from './flowClasses.ts'

type StepPayloadOf<Result> =
  Awaited<Result> extends StepResult<infer Payload, any>
    ? Payload
    : Awaited<Result> extends object
      ? Omit<Awaited<Result>, 'status'>
      : Record<string, unknown>

type RawStepFnResult<TStep extends StepInfo> = { status?: StepStatus } & Partial<StepPayloadOf<ReturnType<TStep['fn']>>>

type StepResultOf<TStep extends FlowStepInfo> = TStep extends StepInfo
  ? StepResult<StepPayloadOf<ReturnType<TStep['fn']>>, TStep>
  : TStep extends StepBranchInfo
    ? StepResult<Record<string, unknown>, TStep>
    : never

type ProcessingState = {
  steps: readonly FlowStepInfo[]
  index: number
  stepResults: StepResult<any, any>[]
  branchKey?: PropertyKey
  pendingBranch?: {
    step: StepBranchInfo<any, any, any, any>
    selectedKeys: PropertyKey[]
    nextBranchIndex: number
    branchResults: BranchStepFlowResult[]
  }
}

const branchStatusPrecedence: Record<StepStatus, number> = {
  ok: 0,
  skip: 1,
  stop: 2,
  error: 3,
  exception: 4,
}

function isStepStatus(value: unknown): value is StepStatus {
  return typeof value === 'string' && stepStatuses.includes(value as StepStatus)
}

function isPromise<T>(value: object): value is Promise<T> {
  return 'then' in value && typeof value.then === 'function'
}

function applyStatusHandling(status: StepStatus, options?: { error?: 'ignore' | 'exception'; exception?: 'error' }) {
  if (status === 'error') {
    if (options?.error === 'ignore') {
      return 'ok'
    }

    if (options?.error === 'exception') {
      return 'exception'
    }
  }

  if (status === 'exception' && options?.exception === 'error') {
    return 'error'
  }

  return status
}

function mergeStepStatuses(results: readonly StepStatus[]) {
  if (results.length === 0) {
    return 'skip'
  }

  return results.reduce((selected, current) =>
    branchStatusPrecedence[current] > branchStatusPrecedence[selected] ? current : selected
  )
}

function assertValidBranchKey(stepId: string, key: PropertyKey, branches: Record<PropertyKey, FlowLike>) {
  if (!(key in branches)) {
    throw new Error(`Flow branch "${stepId}" selected unknown flow key "${String(key)}"`)
  }
}

function normalizeBranchSelection<Key extends PropertyKey>(
  stepId: string,
  selection: Key | readonly Key[] | StepStatus
): readonly Key[] | StepStatus {
  if (Array.isArray(selection)) {
    if (selection.length === 0) {
      throw new Error(`Flow branch "${stepId}" selected no flow keys; return a step result instead`)
    }

    return selection
  }

  if (isStepStatus(selection)) {
    return selection
  }

  return [selection as Key]
}

function createStepResult<TStep extends StepInfo>(step: TStep, result: RawStepFnResult<TStep> | undefined) {
  const resultLike: RawStepFnResult<TStep> = result ?? {}
  const rawStatus = resultLike.status ?? 'ok'
  const status = applyStatusHandling(rawStatus, step.options?.status)
  const originalStatus = rawStatus !== status ? rawStatus : undefined
  const payload = Object.fromEntries(Object.entries(resultLike).filter((entry) => entry[0] !== 'status')) as Record<
    string,
    unknown
  >

  return new StepResult(
    step,
    status,
    Object.keys(payload).length === 0 ? undefined : payload,
    undefined,
    undefined,
    originalStatus
  )
}

function createBranchStepResult(
  step: StepBranchInfo<any, any, any, any>,
  rawStatus: StepStatus,
  selectedKeys: PropertyKey[] = [],
  branchResults: BranchStepFlowResult[] = []
) {
  const selectedKeySet = new Set(selectedKeys)
  const status = applyStatusHandling(rawStatus, step.options?.status)
  const originalStatus = rawStatus !== status ? rawStatus : undefined
  const skippedBranches = getOwnEntries(step.branches)
    .filter(([key]) => !selectedKeySet.has(key))
    .map(
      ([key, flow]) =>
        new BranchStepFlowResult(
          key,
          'skip',
          flow.steps.map((branchStep: FlowStepInfo) => createStepResultWithStatus(branchStep, 'skip'))
        )
    )

  return new StepResult(
    step,
    status,
    undefined,
    selectedKeys.length === 0 ? undefined : [...selectedKeys],
    [...branchResults, ...skippedBranches],
    originalStatus
  )
}

function createStepResultWithStatus<TStep extends FlowStepInfo>(
  step: TStep,
  rawStatus: StepStatus
): StepResultOf<TStep> {
  if (step instanceof StepInfo) {
    return createStepResult(step, { status: rawStatus } as RawStepFnResult<typeof step>) as StepResultOf<TStep>
  }

  return createBranchStepResult(step, rawStatus) as StepResultOf<TStep>
}

function ensureStepResult<TStep extends StepInfo>(
  step: TStep,
  result: StepResult<any, any> | RawStepFnResult<TStep> | undefined
) {
  if (result instanceof StepResult) {
    if (result.stepInfo !== step) {
      throw new Error(`Flow step "${step.id}" returned a StepResult bound to a different step`)
    }

    return result
  }

  return createStepResult(step, result)
}

function skipRemainingSteps(state: ProcessingState) {
  for (let index = state.index + 1; index < state.steps.length; index++) {
    state.stepResults.push(createStepResultWithStatus(state.steps[index], 'skip'))
  }
}

function finishStep(state: ProcessingState, stepResult: StepResult<any, any>) {
  state.stepResults.push(stepResult)

  if (stepResult.status === 'stop' || stepResult.status === 'exception') {
    skipRemainingSteps(state)
    state.index = state.steps.length
    return
  }

  state.index++
}

function travel(
  processingStateList: ProcessingState[],
  ctx: object
): { kind: 'step'; state: ProcessingState; step: StepInfo<any, any, any> } | { kind: 'done'; result: FlowResult<any> } {
  while (true) {
    const state = processingStateList[processingStateList.length - 1]

    if (state.pendingBranch != null) {
      if (state.pendingBranch.nextBranchIndex < state.pendingBranch.selectedKeys.length) {
        const key = state.pendingBranch.selectedKeys[state.pendingBranch.nextBranchIndex++]
        const branchFlow = state.pendingBranch.step.branches[key]
        processingStateList.push({
          steps: branchFlow.steps,
          index: 0,
          stepResults: [],
          branchKey: key,
        })
        continue
      }

      finishStep(
        state,
        createBranchStepResult(
          state.pendingBranch.step,
          mergeStepStatuses(state.pendingBranch.branchResults.map((entry) => entry.status)),
          state.pendingBranch.selectedKeys,
          state.pendingBranch.branchResults
        )
      )
      state.pendingBranch = undefined
      continue
    }

    if (state.index >= state.steps.length) {
      if (processingStateList.length === 1) {
        return {
          kind: 'done',
          result: new FlowResult(state.stepResults, mergeStepStatuses(state.stepResults.map((entry) => entry.status))),
        }
      }

      const finishedState = processingStateList.pop()!
      const parentState = processingStateList[processingStateList.length - 1]
      parentState.pendingBranch?.branchResults.push(
        new BranchStepFlowResult(
          finishedState.branchKey!,
          mergeStepStatuses(finishedState.stepResults.map((entry) => entry.status)),
          finishedState.stepResults
        )
      )
      continue
    }

    const step = state.steps[state.index]

    if (step instanceof StepBranchInfo) {
      try {
        const selection = normalizeBranchSelection(step.id, step.select(ctx as any))

        if (isStepStatus(selection)) {
          finishStep(state, createBranchStepResult(step, selection))
          continue
        }

        for (const key of selection) {
          assertValidBranchKey(step.id, key, step.branches)
        }

        state.pendingBranch = {
          step,
          selectedKeys: [...selection],
          nextBranchIndex: 0,
          branchResults: [],
        }
      } catch {
        finishStep(state, createStepResultWithStatus(step, 'exception'))
      }

      continue
    }

    return { kind: 'step', state, step }
  }
}

export function syncRun<Ctx extends object, Steps extends readonly FlowStepInfo[]>(
  steps: Steps,
  ctx: Ctx
): FlowResult<Steps> {
  const processingStateList: ProcessingState[] = [{ steps, index: 0, stepResults: [] }]

  while (true) {
    const current = travel(processingStateList, ctx)
    if (current.kind === 'done') {
      return current.result as FlowResult<Steps>
    }

    try {
      const result = current.step.fn(ctx as any)

      if (isPromise(result)) {
        throw new Error(`Flow step "${current.step.id}" returned a Promise in sync run()`)
      }

      finishStep(current.state, ensureStepResult(current.step, result))
    } catch {
      finishStep(current.state, createStepResultWithStatus(current.step, 'exception'))
    }
  }
}

export async function asyncRun<Ctx extends object, Steps extends readonly FlowStepInfo[]>(
  steps: Steps,
  ctx: Ctx
): Promise<FlowResult<Steps>> {
  const processingStateList: ProcessingState[] = [{ steps, index: 0, stepResults: [] }]

  while (true) {
    const current = travel(processingStateList, ctx)
    if (current.kind === 'done') {
      return current.result as FlowResult<Steps>
    }

    try {
      finishStep(current.state, ensureStepResult(current.step, await current.step.fn(ctx as any)))
    } catch {
      finishStep(current.state, createStepResultWithStatus(current.step, 'exception'))
    }
  }
}
