import { getOwnEntries, isPromise } from './utils.ts'
import {
  type BranchSelectResult,
  BranchStepFlowResult,
  FlowResult,
  type FlowLike,
  type FlowStepInfo,
  type InvocationInput as SharedInvocationInput,
  type InvocationMap,
  type RawStepFnResult,
  type ProcessingState,
  type StepResultMap,
  type StepResultMapInput,
  type StepOptionsStatusHandling,
  StepFnResult,
  StepBranchInfo,
  StepInfo,
  StepResult,
  type StepStatus,
  stepStatuses,
} from './flowClasses.ts'

type RuntimeFlow = Pick<FlowLike, 'steps' | 'map' | 'mapResult'>

type RuntimeStepMap = InvocationMap<any, any, any, any, any, any, any, any, any>
type RuntimeStepResultMap = StepResultMap<any, any, any, any, any, any, any, any, any>

type RuntimeProcessingState = ProcessingState<object, unknown, FlowStepInfo, RuntimeFlow> & {
  pendingBranch?: {
    step: StepBranchInfo
    selectedKeys: PropertyKey[]
    nextBranchIndex: number
    branchResults: BranchStepFlowResult[]
    data: object
    ctx: unknown
  }
}

type InvocationInput = SharedInvocationInput<
  FlowStepInfo,
  object,
  unknown,
  object,
  unknown,
  FlowStepInfo,
  RuntimeFlow
> & { processingState: RuntimeProcessingState }

type RuntimeStepResultMapInput = StepResultMapInput<
  unknown,
  object,
  unknown,
  RawStepFnResult | undefined,
  object,
  unknown,
  FlowStepInfo,
  RuntimeFlow
> & { stepInfo: StepInfo; processingState: RuntimeProcessingState }

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
  kind: 'keys'
  keys: readonly PropertyKey[]
  data: object
  ctx: unknown
}

type BranchSelectionStatus = {
  kind: 'status'
  normalized: ReturnType<typeof normalizeStepFnResult>
  data: object
  ctx: unknown
}

function assertValidBranchKey(stepLabel: string, key: PropertyKey, branches: Record<PropertyKey, FlowLike>) {
  if (!(key in branches)) {
    throw new Error(`Flow branch "${stepLabel}" selected unknown flow key "${String(key)}"`)
  }
}

function normalizeBranchSelection(
  stepLabel: string,
  branches: Record<PropertyKey, FlowLike>,
  selection: BranchSelectResult<PropertyKey>,
  data: object,
  ctx: unknown
): BranchSelection | BranchSelectionStatus {
  if (selection instanceof StepFnResult) {
    return { kind: 'status', normalized: normalizeStepFnResult(selection), data, ctx }
  }

  if (Array.isArray(selection)) {
    if (selection.length === 0) {
      throw new Error(`Flow branch "${stepLabel}" selected no flow keys; return a step result instead`)
    }

    return { kind: 'keys', keys: selection, data, ctx }
  }

  if (isStepStatus(selection)) {
    return { kind: 'status', normalized: normalizeStepFnResult({ status: selection }), data, ctx }
  }

  if (selection != null && typeof selection === 'object') {
    const selectionLike = selection as {
      keys?: PropertyKey | readonly PropertyKey[]
      data?: object
      ctx?: unknown
    }
    const nextData = selectionLike.data ?? data
    const nextCtx = 'ctx' in selectionLike ? selectionLike.ctx : ctx
    const nextKeys = selectionLike.keys ?? Reflect.ownKeys(branches)

    if (Array.isArray(nextKeys)) {
      if (nextKeys.length === 0) {
        throw new Error(`Flow branch "${stepLabel}" selected no flow keys; return a step result instead`)
      }

      return { kind: 'keys', keys: nextKeys, data: nextData, ctx: nextCtx }
    }

    return { kind: 'keys', keys: [nextKeys as PropertyKey], data: nextData, ctx: nextCtx }
  }

  return { kind: 'keys', keys: [selection as PropertyKey], data, ctx }
}

function selectsAllBranches(selectedKeys: readonly PropertyKey[], branches: Record<PropertyKey, FlowLike>) {
  const branchKeys = Reflect.ownKeys(branches)

  return (
    branchKeys.length > 0 &&
    selectedKeys.length === branchKeys.length &&
    branchKeys.every((key) => selectedKeys.includes(key))
  )
}

function applyMap(map: RuntimeStepMap | undefined, input: InvocationInput): InvocationInput {
  if (map == null) {
    return input
  }

  const mapped = map(input)

  return { ...input, data: mapped.data, ctx: mapped.ctx }
}

function resolveInvocation(stepInfo: FlowStepInfo, processingState: RuntimeProcessingState): InvocationInput {
  const baseInvocation: InvocationInput = {
    stepInfo,
    processingState,
    data: processingState.data,
    ctx: processingState.ctx,
  }

  const flowInvocation = applyMap(processingState.flow.map, baseInvocation)

  if (stepInfo instanceof StepInfo) {
    return applyMap(stepInfo.options?.map as RuntimeStepMap | undefined, flowInvocation)
  }

  return flowInvocation
}

function invokeCallback(fn: (...args: any[]) => any, input: InvocationInput) {
  return fn(input.data as any, { ctx: input.ctx } as any)
}

function invokeStepFn(step: StepInfo, input: InvocationInput) {
  return invokeCallback(step.fn, input)
}

function invokeBranchSelect(step: StepBranchInfo, input: InvocationInput) {
  return step.select(input as any)
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

function applyResultMap(mapResult: RuntimeStepResultMap | undefined, input: RuntimeStepResultMapInput) {
  if (mapResult == null) {
    return input.result
  }

  return mapResult(input)
}

function createStepResult(
  stepInfo: StepInfo,
  result: RawStepFnResult | undefined,
  processingState: RuntimeProcessingState,
  data = processingState.data,
  ctx = processingState.ctx
) {
  const resultInput: RuntimeStepResultMapInput = {
    stepInfo,
    processingState,
    data,
    ctx,
    result,
  }
  const flowMappedResult = applyResultMap(processingState.flow.mapResult, {
    ...resultInput,
  })
  const stepMappedResult = applyResultMap(stepInfo.options?.mapResult as RuntimeStepResultMap | undefined, {
    ...resultInput,
    result: flowMappedResult,
  })
  const normalized = normalizeStepFnResult(stepMappedResult)
  const rawStatus = normalized.status
  const status = applyStatusHandling(rawStatus, stepInfo.options?.status)
  const originalStatus = rawStatus !== status ? rawStatus : undefined

  return new StepResult(
    stepInfo,
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
  branchResults: BranchStepFlowResult[] = [],
  branchState?: Pick<RuntimeProcessingState, 'data' | 'ctx'>,
  normalized?: ReturnType<typeof normalizeStepFnResult>
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
          flow.steps.map((branchStep: FlowStepInfo) =>
            createStepResultWithStatus(
              branchStep,
              'skip',
              createProcessingState(flow, branchState?.data ?? {}, branchState?.ctx, key)
            )
          )
        )
    )

  return new StepResult(
    step,
    status,
    normalized && Object.keys(normalized.payload).length > 0 ? normalized.payload : undefined,
    selectedKeys.length === 0 || selectedEveryBranch ? undefined : [...selectedKeys],
    [...branchResults, ...skippedBranches],
    originalStatus,
    normalized?.path ?? step.options?.path,
    normalized?.message,
    normalized?.results
  )
}

function createStepResultWithStatus(
  step: FlowStepInfo,
  rawStatus: StepStatus,
  processingState: RuntimeProcessingState,
  data = processingState.data,
  ctx = processingState.ctx
): StepResult {
  if (step instanceof StepInfo) {
    return createStepResult(step, { status: rawStatus } as RawStepFnResult, processingState, data, ctx)
  }

  return createBranchStepResult(step, rawStatus)
}

function ensureStepResult(
  step: StepInfo,
  result: StepResult | RawStepFnResult | undefined,
  processingState: RuntimeProcessingState,
  data = processingState.data,
  ctx = processingState.ctx
) {
  if (result instanceof StepResult) {
    if (result.stepInfo !== step) {
      throw new Error(`Flow step "${step.id}" returned a StepResult bound to a different step`)
    }

    return result
  }

  return createStepResult(step, result, processingState, data, ctx)
}

function createProcessingState(
  flow: RuntimeFlow,
  data: object,
  ctx: unknown,
  branchKey?: PropertyKey
): RuntimeProcessingState {
  return {
    flow,
    index: 0,
    stepResults: [],
    data,
    ctx,
    branchKey,
  }
}

function skipRemainingSteps(state: RuntimeProcessingState) {
  for (let index = state.index + 1; index < state.flow.steps.length; index++) {
    state.stepResults.push(createStepResultWithStatus(state.flow.steps[index], 'skip', state))
  }
}

function finishStep(state: RuntimeProcessingState, stepResult: StepResult) {
  state.stepResults.push(stepResult)

  if (stepResult.status === 'stop' || stepResult.status === 'exception') {
    skipRemainingSteps(state)
    state.index = state.flow.steps.length
    return
  }

  state.index++
}

function travel(
  processingStateList: RuntimeProcessingState[]
):
  | { kind: 'step'; state: RuntimeProcessingState; step: StepInfo; input: InvocationInput }
  | { kind: 'done'; result: FlowResult } {
  while (true) {
    const state = processingStateList[processingStateList.length - 1]

    if (state.pendingBranch != null) {
      if (state.pendingBranch.nextBranchIndex < state.pendingBranch.selectedKeys.length) {
        const key = state.pendingBranch.selectedKeys[state.pendingBranch.nextBranchIndex++]
        const branchFlow = state.pendingBranch.step.branches[key]
        processingStateList.push(
          createProcessingState(branchFlow, state.pendingBranch.data, state.pendingBranch.ctx, key)
        )
        continue
      }

      finishStep(
        state,
        createBranchStepResult(
          state.pendingBranch.step,
          mergeStepStatuses(state.pendingBranch.branchResults.map((entry) => entry.status)),
          state.pendingBranch.selectedKeys,
          state.pendingBranch.branchResults,
          {
            data: state.pendingBranch.data,
            ctx: state.pendingBranch.ctx,
          }
        )
      )
      state.pendingBranch = undefined
      continue
    }

    if (state.index >= state.flow.steps.length) {
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

    const step = state.flow.steps[state.index]
    const input = resolveInvocation(step, state)

    if (step instanceof StepBranchInfo) {
      try {
        const stepLabel = step.options?.name ?? step.id ?? 'branch'
        const selection = normalizeBranchSelection(
          stepLabel,
          step.branches,
          invokeBranchSelect(step, input),
          input.data,
          input.ctx
        )

        if (selection.kind === 'status') {
          finishStep(
            state,
            createBranchStepResult(
              step,
              selection.normalized.status,
              [],
              [],
              {
                data: selection.data,
                ctx: selection.ctx,
              },
              selection.normalized
            )
          )
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
          data: selection.data,
          ctx: selection.ctx,
        }
      } catch {
        finishStep(state, createStepResultWithStatus(step, 'exception', state))
      }

      continue
    }

    return { kind: 'step', state, step, input }
  }
}

export function syncRun(flow: RuntimeFlow, data: object, ctx: unknown): FlowResult {
  const processingStateList: RuntimeProcessingState[] = [createProcessingState(flow, data, ctx)]

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

      finishStep(
        current.state,
        ensureStepResult(current.step, result, current.state, current.input.data, current.input.ctx)
      )
    } catch {
      finishStep(
        current.state,
        createStepResultWithStatus(current.step, 'exception', current.state, current.input.data, current.input.ctx)
      )
    }
  }
}

export async function asyncRun(flow: RuntimeFlow, data: object, ctx: unknown): Promise<FlowResult> {
  const processingStateList: RuntimeProcessingState[] = [createProcessingState(flow, data, ctx)]

  while (true) {
    const current = travel(processingStateList)
    if (current.kind === 'done') {
      return current.result
    }

    try {
      finishStep(
        current.state,
        ensureStepResult(
          current.step,
          await invokeStepFn(current.step, current.input),
          current.state,
          current.input.data,
          current.input.ctx
        )
      )
    } catch {
      finishStep(
        current.state,
        createStepResultWithStatus(current.step, 'exception', current.state, current.input.data, current.input.ctx)
      )
    }
  }
}
