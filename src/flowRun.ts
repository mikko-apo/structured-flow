import { getOwnEntries, isPromise } from './utils.ts'
import {
  type AnyStepMap,
  BranchStepFlowResult,
  FlowResult,
  type FlowLike,
  type FlowStepInfo,
  type StepOptionsStatusHandling,
  StepFnResult,
  StepBranchInfo,
  StepInfo,
  StepResult,
  type StepStatus,
  stepStatuses,
} from './flowClasses.ts'

type RawStepFnResult = StepFnResult | boolean | ({ status?: StepStatus } & Record<string, unknown>)

type ProcessingState = {
  steps: readonly FlowStepInfo[]
  index: number
  stepResults: StepResult[]
  data: object
  ctx: unknown
  map?: AnyStepMap
  branchKey?: PropertyKey
  pendingBranch?: {
    step: StepBranchInfo
    selectedKeys: PropertyKey[]
    nextBranchIndex: number
    branchResults: BranchStepFlowResult[]
    data: object
    ctx: unknown
  }
}

type InvocationInput = {
  flowData: object
  params: object
  fnInput: readonly [object, object]
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

function applyStatusHandling(status: StepStatus, options?: StepOptionsStatusHandling) {
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

type BranchSelection = {
  keys: readonly PropertyKey[]
}

function assertValidBranchKey(stepLabel: string, key: PropertyKey, branches: Record<PropertyKey, FlowLike>) {
  if (!(key in branches)) {
    throw new Error(`Flow branch "${stepLabel}" selected unknown flow key "${String(key)}"`)
  }
}

function normalizeBranchSelection(
  stepLabel: string,
  selection: PropertyKey | readonly PropertyKey[] | StepStatus
): BranchSelection | StepStatus {
  if (Array.isArray(selection)) {
    if (selection.length === 0) {
      throw new Error(`Flow branch "${stepLabel}" selected no flow keys; return a step result instead`)
    }

    return { keys: selection }
  }

  if (isStepStatus(selection)) {
    return selection
  }

  return { keys: [selection as PropertyKey] }
}

function selectsAllBranches(selectedKeys: readonly PropertyKey[], branches: Record<PropertyKey, FlowLike>) {
  const branchKeys = Reflect.ownKeys(branches)

  return branchKeys.length > 0 && selectedKeys.length === branchKeys.length && branchKeys.every((key) => selectedKeys.includes(key))
}

function applyMap(
  map: AnyStepMap | undefined,
  input: {
    id: unknown
    data: object
    ctx: unknown
    stepOptions?: FlowStepInfo['options']
    params: object
    fnInput: readonly [object, object]
  }
): InvocationInput {
  if (map == null) {
    return { flowData: input.data, params: input.params, fnInput: input.fnInput }
  }

  const mapped = map({
    id: input.id,
    data: input.data,
    ctx: input.ctx,
    stepOptions: input.stepOptions,
    params: input.params,
  })
  const nextParams =
    Array.isArray(mapped.fnInput) && mapped.fnInput.length === 2
      ? mapped.fnInput[1]
      : { ...input.params, ...mapped, ctx: input.ctx }
  const nextData = Array.isArray(mapped.fnInput) && mapped.fnInput.length === 2 ? mapped.fnInput[0] : input.fnInput[0]

  return {
    flowData: input.data,
    params: nextParams,
    fnInput: [nextData, nextParams],
  }
}

function createBaseInvocation(data: object, ctx: unknown): InvocationInput {
  return {
    flowData: data,
    params: { ctx },
    fnInput: [data, { ctx }],
  }
}

function resolveInvocation(
  step: FlowStepInfo,
  flowMap: AnyStepMap | undefined,
  data: object,
  ctx: unknown
): InvocationInput {
  const baseInvocation = createBaseInvocation(data, ctx)
  const flowInvocation = applyMap(flowMap, {
    id: step.rawId,
    data,
    ctx,
    stepOptions: step.options,
    params: baseInvocation.params,
    fnInput: baseInvocation.fnInput,
  })
  const stepInvocation = applyMap(step.options?.map as AnyStepMap | undefined, {
    id: step.rawId,
    data: flowInvocation.flowData,
    ctx,
    stepOptions: step.options,
    params: flowInvocation.params,
    fnInput: flowInvocation.fnInput,
  })

  return {
    flowData: stepInvocation.flowData,
    params: stepInvocation.params,
    fnInput: stepInvocation.fnInput,
  }
}

function invokeCallback(fn: (...args: any[]) => any, input: InvocationInput) {
  return fn(input.fnInput[0] as any, input.fnInput[1] as any)
}

function invokeStepFn(step: StepInfo, input: InvocationInput) {
  return invokeCallback(step.fn, input)
}

function invokeBranchSelect(step: StepBranchInfo, input: InvocationInput) {
  return invokeCallback(step.select, input)
}

function normalizeStepFnResult(result: RawStepFnResult | undefined) {
  if (result instanceof StepFnResult) {
    return {
      status: result.status,
      payload: result.variables as Record<string, unknown>,
      path: result.path,
      message: result.message,
      results: result.results,
    }
  }

  if (result === true) {
    return { status: 'ok' as StepStatus, payload: {} }
  }

  if (result === false) {
    return { status: 'error' as StepStatus, payload: {} }
  }

  const resultLike = (result ?? {}) as { status?: StepStatus } & Record<string, unknown>
  const rawStatus = resultLike.status ?? 'ok'
  const payload = Object.fromEntries(Object.entries(resultLike).filter((entry) => entry[0] !== 'status')) as Record<
    string,
    unknown
  >

  return { status: rawStatus, payload }
}

function createStepResult(step: StepInfo, result: RawStepFnResult | undefined) {
  const normalized = normalizeStepFnResult(result)
  const rawStatus = normalized.status
  const status = applyStatusHandling(rawStatus, step.options?.status)
  const originalStatus = rawStatus !== status ? rawStatus : undefined

  return new StepResult(
    step,
    status,
    Object.keys(normalized.payload).length === 0 ? undefined : normalized.payload,
    undefined,
    undefined,
    originalStatus,
    normalized.path,
    normalized.message,
    normalized.results
  )
}

function createBranchStepResult(
  step: StepBranchInfo,
  rawStatus: StepStatus,
  selectedKeys: PropertyKey[] = [],
  branchResults: BranchStepFlowResult[] = []
) {
  const selectedKeySet = new Set(selectedKeys)
  const selectedEveryBranch = selectsAllBranches(selectedKeys, step.branches)
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
    selectedKeys.length === 0 || selectedEveryBranch ? undefined : [...selectedKeys],
    [...branchResults, ...skippedBranches],
    originalStatus,
    step.options?.path,
    undefined,
    undefined
  )
}

function createStepResultWithStatus(step: FlowStepInfo, rawStatus: StepStatus): StepResult {
  if (step instanceof StepInfo) {
    return createStepResult(step, { status: rawStatus } as RawStepFnResult)
  }

  return createBranchStepResult(step, rawStatus)
}

function ensureStepResult(step: StepInfo, result: StepResult | RawStepFnResult | undefined) {
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

function finishStep(state: ProcessingState, stepResult: StepResult) {
  state.stepResults.push(stepResult)

  if (stepResult.status === 'stop' || stepResult.status === 'exception') {
    skipRemainingSteps(state)
    state.index = state.steps.length
    return
  }

  state.index++
}

function travel(
  processingStateList: ProcessingState[]
):
  | { kind: 'step'; state: ProcessingState; step: StepInfo; input: InvocationInput }
  | { kind: 'done'; result: FlowResult } {
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
          data: state.pendingBranch.data,
          ctx: state.pendingBranch.ctx,
          map: branchFlow.map,
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
    const input = resolveInvocation(step, state.map, state.data, state.ctx)

    if (step instanceof StepBranchInfo) {
      try {
        const stepLabel = step.options?.name ?? step.id ?? 'branch'
        const selection = normalizeBranchSelection(stepLabel, invokeBranchSelect(step, input))

        if (isStepStatus(selection)) {
          finishStep(state, createBranchStepResult(step, selection))
          continue
        }

        for (const key of selection.keys) {
          assertValidBranchKey(stepLabel, key, step.branches)
        }

        state.pendingBranch = {
          step,
          selectedKeys: [...selection.keys],
          nextBranchIndex: 0,
          branchResults: [],
          data: input.flowData,
          ctx: state.ctx,
        }
      } catch {
        finishStep(state, createStepResultWithStatus(step, 'exception'))
      }

      continue
    }

    return { kind: 'step', state, step, input }
  }
}

export function syncRun(
  flow: { steps: readonly FlowStepInfo[]; map?: AnyStepMap },
  data: object,
  ctx: unknown
): FlowResult {
  const processingStateList: ProcessingState[] = [
    { steps: flow.steps, index: 0, stepResults: [], data, ctx, map: flow.map },
  ]

  while (true) {
    const current = travel(processingStateList)
    if (current.kind === 'done') {
      return current.result
    }

    try {
      const result = invokeStepFn(current.step, current.input)

      if (isPromise(result)) {
        throw new Error(`Flow step "${current.step.id}" returned a Promise in sync run()`)
      }

      finishStep(current.state, ensureStepResult(current.step, result))
    } catch {
      finishStep(current.state, createStepResultWithStatus(current.step, 'exception'))
    }
  }
}

export async function asyncRun(
  flow: { steps: readonly FlowStepInfo[]; map?: AnyStepMap },
  data: object,
  ctx: unknown
): Promise<FlowResult> {
  const processingStateList: ProcessingState[] = [
    { steps: flow.steps, index: 0, stepResults: [], data, ctx, map: flow.map },
  ]

  while (true) {
    const current = travel(processingStateList)
    if (current.kind === 'done') {
      return current.result
    }

    try {
      finishStep(current.state, ensureStepResult(current.step, await invokeStepFn(current.step, current.input)))
    } catch {
      finishStep(current.state, createStepResultWithStatus(current.step, 'exception'))
    }
  }
}
