import { getOwnEntries, isPromise } from './utils.ts'
import {
  type BranchInitResult,
  BranchStepFlowResult,
  FlowResult,
  type FlowLike,
  type FlowStepInfo,
  type InvocationInput as SharedInvocationInput,
  type InvocationMap,
  type ProcessingState,
  type RawStepFnResult,
  StepBranchInfo,
  StepFnResult,
  StepInfo,
  type StepOptionsStatusHandling,
  StepResult,
  type StepResultMap,
  type StepResultMapInput,
  type StepStatus,
  stepStatuses,
} from './flowClasses.ts'

type RuntimeFlow = Pick<FlowLike, 'steps' | 'options'>
type RuntimeStepInit = InvocationMap<any, any, any, any, any, any, any, any, any, true>
type RuntimeStepResultMap = StepResultMap<any, any, any, any, any, any, any, any, any, true>

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

type InvocationInput = Omit<SharedInvocationInput<FlowStepInfo, object, unknown>, 'processingState'> & {
  processingState: RuntimeProcessingState
}

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

type CallbackRequest = {
  invoke: () => unknown
  syncError: string
}

type TravelGenerator<Result = void> = Generator<CallbackRequest, Result, unknown>

const branchStatusPrecedence: Record<StepStatus, number> = {
  ok: 0,
  skip: 1,
  stop: 2,
  fail: 3,
  exception: 4,
}

function* call<Result>(invoke: () => Result, syncError: string): TravelGenerator<Awaited<Result>> {
  return (yield { invoke, syncError }) as Awaited<Result>
}

function isStepStatus(value: unknown): value is StepStatus {
  return typeof value === 'string' && stepStatuses.includes(value as StepStatus)
}

function applyStatusHandling(status: StepStatus, options?: StepOptionsStatusHandling) {
  if (status === 'fail') {
    if (options?.fail === 'ignore') {
      return 'ok'
    }

    if (options?.fail === 'exception') {
      return 'exception'
    }
  }

  if (status === 'exception' && options?.exception === 'fail') {
    return 'fail'
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

function normalizeStepFnResult(result: RawStepFnResult | undefined, trueIsFail = false) {
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
    return { status: (trueIsFail ? 'fail' : 'ok') as StepStatus, payload: {} }
  }

  if (result === false) {
    return { status: (trueIsFail ? 'ok' : 'fail') as StepStatus, payload: {} }
  }

  const resultLike = (result ?? {}) as { status?: StepStatus } & Record<string, unknown>
  return {
    status: resultLike.status ?? 'ok',
    payload: Object.fromEntries(Object.entries(resultLike).filter(([key]) => key !== 'status')) as Record<
      string,
      unknown
    >,
  }
}

type BranchSelection =
  | {
      kind: 'keys'
      keys: readonly PropertyKey[]
      data: object
      ctx: unknown
      hasContext: boolean
    }
  | {
      kind: 'status'
      normalized: ReturnType<typeof normalizeStepFnResult>
      data: object
      ctx: unknown
    }

function normalizeBranchSelection(
  stepLabel: string,
  branches: Record<PropertyKey, FlowLike>,
  selection: BranchInitResult<PropertyKey>,
  data: object,
  ctx: unknown,
  hasInputContext: boolean
): BranchSelection {
  if (selection instanceof StepFnResult) {
    return { kind: 'status', normalized: normalizeStepFnResult(selection), data, ctx }
  }

  if (Array.isArray(selection)) {
    if (selection.length === 0) {
      throw new Error(`Flow branch "${stepLabel}" selected no flow keys; return a step result instead`)
    }

    return { kind: 'keys', keys: selection, data, ctx, hasContext: hasInputContext }
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
    const nextKeys = selectionLike.keys ?? Reflect.ownKeys(branches)
    const nextData = selectionLike.data ?? data
    const nextCtx = 'ctx' in selectionLike ? selectionLike.ctx : ctx

    if (Array.isArray(nextKeys)) {
      if (nextKeys.length === 0) {
        throw new Error(`Flow branch "${stepLabel}" selected no flow keys; return a step result instead`)
      }

      return {
        kind: 'keys',
        keys: nextKeys,
        data: nextData,
        ctx: nextCtx,
        hasContext: 'ctx' in selectionLike || hasInputContext,
      }
    }

    return {
      kind: 'keys',
      keys: [nextKeys as PropertyKey],
      data: nextData,
      ctx: nextCtx,
      hasContext: 'ctx' in selectionLike || hasInputContext,
    }
  }

  return {
    kind: 'keys',
    keys: [selection as PropertyKey],
    data,
    ctx,
    hasContext: hasInputContext,
  }
}

function selectsAllBranches(selectedKeys: readonly PropertyKey[], branches: Record<PropertyKey, FlowLike>) {
  const branchKeys = Reflect.ownKeys(branches)
  return (
    branchKeys.length > 0 &&
    selectedKeys.length === branchKeys.length &&
    branchKeys.every((key) => selectedKeys.includes(key))
  )
}

function* applyMap(
  map: RuntimeStepInit | undefined,
  input: InvocationInput,
  label: string,
  targetFlow?: RuntimeFlow
): TravelGenerator<InvocationInput> {
  if (map == null) {
    return input
  }

  const mapped = yield* call(() => map(input), `${label} returned a Promise in sync run()`)
  if (targetFlow?.options.allowContext && !('ctx' in mapped)) {
    throw new Error(`${label} did not provide context required by its flow`)
  }
  return { ...input, data: mapped.data, ctx: mapped.ctx }
}

function* resolveInvocation(
  stepInfo: FlowStepInfo,
  processingState: RuntimeProcessingState
): TravelGenerator<InvocationInput> {
  const baseInvocation: InvocationInput = {
    stepInfo,
    processingState,
    data: processingState.data,
    ctx: processingState.ctx,
  }
  const flowInvocation = yield* applyMap(processingState.flow.options.stepDefaults?.map, baseInvocation, 'Flow map')

  return stepInfo instanceof StepInfo
    ? yield* applyMap(
        stepInfo.options?.init as RuntimeStepInit | undefined,
        flowInvocation,
        `Flow step "${stepInfo.id}" init`,
        processingState.flow
      )
    : flowInvocation
}

function* applyResultMap(
  mapResult: RuntimeStepResultMap | undefined,
  input: RuntimeStepResultMapInput,
  label: string
): TravelGenerator<RawStepFnResult | undefined> {
  if (mapResult == null) {
    return input.result
  }

  const mappedResult = yield* call(() => mapResult(input), `${label} returned a Promise in sync run()`)
  if (mappedResult === undefined) {
    return new StepFnResult('exception', { message: `${label} returned undefined` })
  }

  return mappedResult
}

function* createStepResult(
  stepInfo: StepInfo,
  result: RawStepFnResult | undefined,
  processingState: RuntimeProcessingState,
  data = processingState.data,
  ctx = processingState.ctx
): TravelGenerator<StepResult> {
  const resultInput: RuntimeStepResultMapInput = {
    stepInfo,
    processingState,
    data,
    ctx,
    result,
  }
  const flowMappedResult = yield* applyResultMap(
    processingState.flow.options.stepDefaults?.mapResult,
    resultInput,
    'Flow mapResult'
  )
  const stepMappedResult = yield* applyResultMap(
    stepInfo.options?.mapResult as RuntimeStepResultMap | undefined,
    { ...resultInput, result: flowMappedResult },
    `Flow step "${stepInfo.id}" mapResult`
  )
  const normalized = normalizeStepFnResult(
    stepMappedResult,
    stepInfo.options?.trueIsFail ?? processingState.flow.options.stepDefaults?.trueIsFail
  )
  const status = applyStatusHandling(normalized.status, stepInfo.options?.status)

  return new StepResult(
    stepInfo,
    status,
    Object.keys(normalized.payload).length === 0 ? undefined : normalized.payload,
    undefined,
    undefined,
    normalized.status === status ? undefined : normalized.status,
    normalized.path,
    normalized.message,
    normalized.results
  )
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

function* createStepResultWithStatus(
  step: FlowStepInfo,
  status: StepStatus,
  processingState: RuntimeProcessingState,
  data = processingState.data,
  ctx = processingState.ctx
): TravelGenerator<StepResult> {
  return step instanceof StepInfo
    ? yield* createStepResult(step, { status } as RawStepFnResult, processingState, data, ctx)
    : yield* createBranchStepResult(step, status)
}

function* createBranchStepResult(
  step: StepBranchInfo,
  rawStatus: StepStatus,
  selectedKeys: PropertyKey[] = [],
  branchResults: BranchStepFlowResult[] = [],
  branchState?: Pick<RuntimeProcessingState, 'data' | 'ctx'>,
  normalized?: ReturnType<typeof normalizeStepFnResult>
): TravelGenerator<StepResult> {
  const selectedKeySet = new Set(selectedKeys)
  const skippedBranches: BranchStepFlowResult[] = []

  for (const [key, flow] of getOwnEntries(step.branches)) {
    if (selectedKeySet.has(key)) {
      continue
    }

    const skippedState = createProcessingState(flow, branchState?.data ?? {}, branchState?.ctx, key)
    const skippedResults: StepResult[] = []
    for (const branchStep of flow.steps) {
      skippedResults.push(yield* createStepResultWithStatus(branchStep, 'skip', skippedState))
    }
    skippedBranches.push(new BranchStepFlowResult(key, 'skip', skippedResults))
  }

  const status = applyStatusHandling(rawStatus, step.options?.status)
  return new StepResult(
    step,
    status,
    normalized && Object.keys(normalized.payload).length > 0 ? normalized.payload : undefined,
    selectedKeys.length === 0 || selectsAllBranches(selectedKeys, step.branches) ? undefined : [...selectedKeys],
    [...branchResults, ...skippedBranches],
    rawStatus === status ? undefined : rawStatus,
    normalized?.path ?? step.options?.path,
    normalized?.message,
    normalized?.results
  )
}

function* ensureStepResult(
  step: StepInfo,
  result: StepResult | RawStepFnResult | undefined,
  processingState: RuntimeProcessingState,
  data: object,
  ctx: unknown
): TravelGenerator<StepResult> {
  if (result instanceof StepResult) {
    if (result.stepInfo !== step) {
      throw new Error(`Flow step "${step.id}" returned a StepResult bound to a different step`)
    }

    return result
  }

  return yield* createStepResult(step, result, processingState, data, ctx)
}

function* finishStep(state: RuntimeProcessingState, result: StepResult): TravelGenerator {
  state.stepResults.push(result)

  if (result.status !== 'stop' && result.status !== 'exception') {
    state.index++
    return
  }

  for (let index = state.index + 1; index < state.flow.steps.length; index++) {
    state.stepResults.push(yield* createStepResultWithStatus(state.flow.steps[index], 'skip', state))
  }
  state.index = state.flow.steps.length
}

function assertValidBranchKeys(
  stepLabel: string,
  keys: readonly PropertyKey[],
  branches: Record<PropertyKey, FlowLike>
) {
  for (const key of keys) {
    if (!(key in branches)) {
      throw new Error(`Flow branch "${stepLabel}" selected unknown flow key "${String(key)}"`)
    }
  }
}

function* processBranch(state: RuntimeProcessingState, step: StepBranchInfo, input: InvocationInput): TravelGenerator {
  const stepLabel = step.options?.name ?? step.id ?? 'branch'
  const selected = yield* call(
    () => step.init(input as any),
    `Flow branch "${stepLabel}" returned a Promise in sync run()`
  )
  const selection = normalizeBranchSelection(
    stepLabel,
    step.branches,
    selected,
    input.data,
    input.ctx,
    state.flow.options.allowContext || input.ctx !== undefined
  )

  if (selection.kind === 'status') {
    yield* finishStep(
      state,
      yield* createBranchStepResult(
        step,
        selection.normalized.status,
        [],
        [],
        { data: selection.data, ctx: selection.ctx },
        selection.normalized
      )
    )
    return
  }

  assertValidBranchKeys(stepLabel, selection.keys, step.branches)
  for (const key of selection.keys) {
    if (step.branches[key].options.allowContext && !selection.hasContext) {
      throw new Error(`Flow branch "${stepLabel}" init did not provide context required by "${String(key)}"`)
    }
  }
  state.pendingBranch = {
    step,
    selectedKeys: [...selection.keys],
    nextBranchIndex: 0,
    branchResults: [],
    data: selection.data,
    ctx: selection.ctx,
  }
}

function* processStep(state: RuntimeProcessingState, step: StepInfo, input: InvocationInput): TravelGenerator {
  const rawResult = yield* call(
    () => step.fn(input.data as any, { ctx: input.ctx } as any),
    `Flow step "${step.id}" returned a Promise in sync run()`
  )
  const result = yield* ensureStepResult(step, rawResult, state, input.data, input.ctx)
  yield* finishStep(state, result)
}

function* finishPendingBranch(state: RuntimeProcessingState): TravelGenerator {
  const pending = state.pendingBranch!
  yield* finishStep(
    state,
    yield* createBranchStepResult(
      pending.step,
      mergeStepStatuses(pending.branchResults.map(({ status }) => status)),
      pending.selectedKeys,
      pending.branchResults,
      { data: pending.data, ctx: pending.ctx }
    )
  )
  state.pendingBranch = undefined
}

function finishChildBranch(processingStates: RuntimeProcessingState[], finishedState: RuntimeProcessingState) {
  const parentState = processingStates[processingStates.length - 1]
  parentState.pendingBranch?.branchResults.push(
    new BranchStepFlowResult(
      finishedState.branchKey!,
      mergeStepStatuses(finishedState.stepResults.map(({ status }) => status)),
      finishedState.stepResults
    )
  )
}

function* travel(flow: RuntimeFlow, data: object, ctx: unknown): TravelGenerator<FlowResult> {
  const processingStates = [createProcessingState(flow, data, ctx)]

  while (true) {
    const state = processingStates[processingStates.length - 1]

    if (state.pendingBranch != null) {
      if (state.pendingBranch.nextBranchIndex < state.pendingBranch.selectedKeys.length) {
        const key = state.pendingBranch.selectedKeys[state.pendingBranch.nextBranchIndex++]
        processingStates.push(
          createProcessingState(
            state.pendingBranch.step.branches[key],
            state.pendingBranch.data,
            state.pendingBranch.ctx,
            key
          )
        )
      } else {
        yield* finishPendingBranch(state)
      }
      continue
    }

    if (state.index >= state.flow.steps.length) {
      if (processingStates.length === 1) {
        return new FlowResult(state.stepResults, mergeStepStatuses(state.stepResults.map(({ status }) => status)))
      }

      finishChildBranch(processingStates, processingStates.pop()!)
      continue
    }

    const step = state.flow.steps[state.index]
    let input: InvocationInput | undefined
    try {
      input = yield* resolveInvocation(step, state)
      if (step instanceof StepBranchInfo) {
        yield* processBranch(state, step, input)
      } else {
        yield* processStep(state, step, input)
      }
    } catch {
      yield* finishStep(state, yield* createStepResultWithStatus(step, 'exception', state, input?.data, input?.ctx))
    }
  }
}

export function syncRun(flow: RuntimeFlow, data: object, ctx: unknown): FlowResult {
  const iterator = travel(flow, data, ctx)
  let current = iterator.next()

  while (!current.done) {
    const request = current.value
    let result: unknown
    try {
      result = request.invoke()
    } catch (error) {
      current = iterator.throw(error)
      continue
    }

    current = isPromise(result) ? iterator.throw(new Error(request.syncError)) : iterator.next(result)
  }

  return current.value
}

export async function asyncRun(flow: RuntimeFlow, data: object, ctx: unknown): Promise<FlowResult> {
  const iterator = travel(flow, data, ctx)
  let current = iterator.next()

  while (!current.done) {
    let result: unknown
    try {
      result = await current.value.invoke()
    } catch (error) {
      current = iterator.throw(error)
      continue
    }

    current = iterator.next(result)
  }

  return current.value
}
