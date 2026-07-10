import { getOwnEntries } from './utils.ts'

type MaybePromise<T> = T | Promise<T>
type AsyncMode = 'sync' | 'async'
export type StepFnPayload = Record<string, unknown>
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

const stepStatuses = ['ok', 'skip', 'stop', 'error', 'exception'] as const

export type StepStatus = (typeof stepStatuses)[number]

type StepOptionsStatusHandling = {
  error?: 'ignore' | 'exception'
  exception?: 'error'
}

type StepOptions = {
  description?: string
  status?: StepOptionsStatusHandling
}

export class StepInfo<Id extends string = string, Ctx extends object = object, Result extends object = object> {
  constructor(
    readonly id: Id,
    readonly fn: (ctx: Expand<Ctx>) => MaybePromise<Result>,
    readonly options?: StepOptions
  ) {}
}

type BranchSelectFnReturnValue<Key extends PropertyKey> = Key | readonly Key[] | StepStatus

export class StepBranchInfo<
  Id extends string = string,
  Ctx extends object = object,
  SelectedKey extends PropertyKey = PropertyKey,
  TBranches extends Record<PropertyKey, FlowLike> = Record<PropertyKey, FlowLike>,
> {
  constructor(
    readonly id: Id,
    readonly select: (ctx: Expand<Ctx>) => BranchSelectFnReturnValue<SelectedKey>,
    readonly branches: TBranches,
    readonly options?: StepOptions
  ) {}
}

export type FlowStepInfo = StepInfo<any, any, any> | StepBranchInfo<any, any, any, any>

type FlowRunResult<Steps extends readonly FlowStepInfo[], Mode extends AsyncMode> = Mode extends 'sync'
  ? FlowResult<Steps>
  : Promise<FlowResult<Steps>>

type FlowLike = {
  steps: readonly FlowStepInfo[]
  asyncMode: AsyncMode
  run(initial: object): MaybePromise<FlowResult<any>>
}

type BranchFlowMap<Ctx extends object, SelectedKey extends PropertyKey = PropertyKey> = Record<
  SelectedKey,
  Flow<Ctx, any, any> | FlowBuilder<Ctx, any, any, any>
>

type BranchKey<TBranches> = Extract<keyof TBranches, PropertyKey>
type NormalizedBranchFlows<TBranches extends BranchFlowMap<any, any>> = {
  [K in keyof TBranches]: Flow<any, any, any>
}

type StepInputCtx<Fn> = Fn extends (...args: infer Args) => any ? (Args extends [] ? object : Args[0]) : never
type StepOutput<Fn> = Fn extends (...args: any[]) => infer Result ? Result : never

type ValidStepReturn<Mode extends AsyncMode, Result> = Mode extends 'sync'
  ? Result extends Promise<any>
    ? never
    : Result extends object
      ? Result
      : never
  : Awaited<Result> extends object
    ? Result
    : never

type ResolvedStepReturn<Mode extends AsyncMode, Result> = Mode extends 'sync'
  ? ValidStepReturn<'sync', Result>
  : Awaited<ValidStepReturn<'async', Result>>

type ValidateStepFn<Fn, ExpectedCtx extends object, Mode extends AsyncMode> = Fn extends (...args: any[]) => any
  ? Expand<ExpectedCtx> extends StepInputCtx<Fn>
    ? ValidStepReturn<Mode, StepOutput<Fn>> extends never
      ? never
      : Fn
    : never
  : never

type ValidateBranchSelect<Fn, ExpectedCtx extends object, Key extends PropertyKey> = Fn extends (...args: any[]) => any
  ? Expand<ExpectedCtx> extends StepInputCtx<Fn>
    ? StepOutput<Fn> extends BranchSelectFnReturnValue<Key>
      ? Fn
      : never
    : never
  : never

type ResolverStepFn<Ctx extends object, Mode extends AsyncMode> = Mode extends 'sync'
  ? (ctx: Ctx) => object
  : (ctx: Ctx) => MaybePromise<object>

type StepInfoResolution<Ctx extends object, Mode extends AsyncMode> = {
  id: string
  description?: string
  stepFn?: ResolverStepFn<Ctx, Mode>
}

type StepInfoResolver<StepId = any, Ctx extends object = object, Mode extends AsyncMode = AsyncMode> = (
  id: StepId
) => StepInfoResolution<Ctx, Mode>

type InferResolverCtx<Resolver> = Resolver extends (...args: any[]) => { stepFn?: infer Fn }
  ? Extract<StepInputCtx<Exclude<Fn, undefined>>, object>
  : object

type InferResolverStepId<Resolver> = Resolver extends (id: infer StepId) => any ? StepId : string

type CreateFlowOptions<Ctx extends object, StepId, Mode extends AsyncMode> = StepOptions & {
  resolver?: StepInfoResolver<StepId, Ctx, Mode>
}

type StepPayloadOf<Result> =
  Awaited<Result> extends StepResult<infer Payload, any>
    ? Payload
    : Awaited<Result> extends object
      ? Omit<Awaited<Result>, 'status'>
      : StepFnPayload

type RawStepFnResult<TStep extends StepInfo> = { status?: StepStatus } & Partial<StepPayloadOf<ReturnType<TStep['fn']>>>

type StepResultOf<TStep extends FlowStepInfo> = TStep extends StepInfo
  ? StepResult<StepPayloadOf<ReturnType<TStep['fn']>>, TStep>
  : TStep extends StepBranchInfo
    ? StepResult<StepFnPayload, TStep>
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

export function stepResult<const Result extends Record<string, unknown>>(result: Result): Result {
  return result
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

function applyStatusHandling(status: StepStatus, options?: StepOptionsStatusHandling): StepStatus {
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

function mergeStepStatuses(results: readonly StepStatus[]): StepStatus {
  if (results.length === 0) {
    return 'skip'
  }

  return results.reduce((selected, current) =>
    branchStatusPrecedence[current] > branchStatusPrecedence[selected] ? current : selected
  )
}

function assertValidBranchKey<TBranches extends Record<PropertyKey, FlowLike>>(
  stepId: string,
  key: PropertyKey,
  branches: TBranches
): asserts key is BranchKey<TBranches> {
  if (!(key in branches)) {
    throw new Error(`Flow branch "${stepId}" selected unknown flow key "${String(key)}"`)
  }
}

function normalizeBranchSelection<Key extends PropertyKey>(
  stepId: string,
  selection: BranchSelectFnReturnValue<Key>
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

function createStepResult<TStep extends StepInfo>(
  step: TStep,
  result: RawStepFnResult<TStep> | undefined
): StepResult<StepPayloadOf<ReturnType<TStep['fn']>>, TStep> {
  const resultLike: RawStepFnResult<TStep> = result ?? {}
  const rawStatus = resultLike.status ?? 'ok'
  const status = applyStatusHandling(rawStatus, step.options?.status)
  const originalStatus = rawStatus !== status ? rawStatus : undefined
  const payload = Object.fromEntries(
    Object.entries(resultLike).filter((entry) => entry[0] !== 'status')
  ) as StepPayloadOf<ReturnType<TStep['fn']>>

  return new StepResult(
    step,
    status,
    Object.keys(payload).length === 0 ? undefined : payload,
    undefined,
    undefined,
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

function ensureStepResult<TStep extends StepInfo>(
  step: TStep,
  result: StepResult<StepPayloadOf<ReturnType<TStep['fn']>>, TStep> | RawStepFnResult<TStep> | undefined,
  skip = false
): StepResult<StepPayloadOf<ReturnType<TStep['fn']>>, TStep> {
  if (skip) {
    return createStepResult(step, { status: 'skip' } as RawStepFnResult<TStep>)
  }

  if (result instanceof StepResult) {
    if (result.stepInfo !== step) {
      throw new Error(`Flow step "${step.id}" returned a StepResult bound to a different step`)
    }

    return result
  }

  return createStepResult(step, result)
}

function syncRun<Ctx extends object, Steps extends readonly FlowStepInfo[]>(
  steps: Steps,
  initial: Ctx
): FlowResult<Steps> {
  const ctx = { ...initial } as unknown as Expand<Ctx>
  const processingStateList: ProcessingState[] = [{ steps, index: 0, stepResults: [] }]

  while (true) {
    const current = travel(processingStateList, ctx)
    if (current.kind === 'done') {
      return current.result as FlowResult<Steps>
    }

    try {
      const result = current.step.fn(ctx)

      if (isPromise(result)) {
        throw new Error(`Flow step "${current.step.id}" returned a Promise in sync run()`)
      }

      finishStep(current.state, ensureStepResult(current.step, result))
    } catch {
      finishStep(current.state, createStepResultWithStatus(current.step, 'exception'))
    }
  }
}

async function asyncRun<Ctx extends object, Steps extends readonly FlowStepInfo[]>(
  steps: Steps,
  initial: Ctx
): Promise<FlowResult<Steps>> {
  const ctx = { ...initial } as unknown as Expand<Ctx>
  const processingStateList: ProcessingState[] = [{ steps, index: 0, stepResults: [] }]

  while (true) {
    const current = travel(processingStateList, ctx)
    if (current.kind === 'done') {
      return current.result as FlowResult<Steps>
    }

    try {
      finishStep(current.state, ensureStepResult(current.step, await current.step.fn(ctx)))
    } catch {
      finishStep(current.state, createStepResultWithStatus(current.step, 'exception'))
    }
  }
}

export class StepResult<TResult extends object = StepFnPayload, TStepInfo extends FlowStepInfo = FlowStepInfo> {
  constructor(
    readonly stepInfo: TStepInfo,
    readonly status: StepStatus,
    readonly result?: TResult,
    readonly selectedBranchKeys?: PropertyKey[],
    readonly branches?: BranchStepFlowResult[],
    readonly originalStatus?: StepStatus
  ) {}
}

export class BranchStepFlowResult<TStepResult extends StepResult<any, any> = StepResult<any, any>> {
  constructor(
    readonly key: PropertyKey,
    readonly status: StepStatus,
    readonly stepResults: TStepResult[]
  ) {}
}

export class FlowResult<Steps extends readonly FlowStepInfo[]> {
  constructor(
    readonly stepResults: Array<StepResultOf<Step<Steps>>>,
    readonly status: StepStatus
  ) {}
}

type Step<Steps extends readonly unknown[]> = Steps[number]

class Flow<
  Ctx extends object = object,
  Steps extends readonly FlowStepInfo[] = [],
  Mode extends AsyncMode = AsyncMode,
> {
  constructor(
    readonly steps: Steps,
    readonly asyncMode: Mode
  ) {}

  run(initial: Ctx): FlowRunResult<Steps, Mode> {
    if (this.asyncMode === 'sync') {
      return syncRun(this.steps, initial) as FlowRunResult<Steps, Mode>
    }

    return asyncRun(this.steps, initial) as FlowRunResult<Steps, Mode>
  }
}

class FlowBuilder<
  Ctx extends object = object,
  StepId = string,
  Steps extends readonly FlowStepInfo[] = [],
  Mode extends AsyncMode = AsyncMode,
> {
  constructor(
    readonly steps: Steps,
    private readonly asyncMode: Mode,
    private readonly resolver: StepInfoResolver<StepId, Ctx, Mode>
  ) {}

  private appendStep<NewStep extends FlowStepInfo>(
    newStep: NewStep
  ): FlowBuilder<Ctx, StepId, [...Steps, NewStep], Mode> {
    return new FlowBuilder<Ctx, StepId, [...Steps, NewStep], Mode>(
      [...this.steps, newStep] as [...Steps, NewStep],
      this.asyncMode,
      this.resolver
    )
  }

  private resolveStep(stepId: StepId, options?: StepOptions) {
    const resolved = this.resolver(stepId)
    const description = options?.description ?? resolved.description
    const mergedOptions = description === undefined ? options : { ...options, description }

    return {
      id: resolved.id,
      stepFn: resolved.stepFn,
      options: mergedOptions,
    }
  }

  step(stepId: StepId, options?: StepOptions): FlowBuilder<Ctx, StepId, [...Steps, StepInfo<string, Ctx, object>], Mode>
  step<Fn extends (...args: any[]) => any>(
    stepId: StepId,
    fn: ValidateStepFn<Fn, Ctx, Mode>,
    options?: StepOptions
  ): FlowBuilder<Ctx, StepId, [...Steps, StepInfo<string, Ctx, ResolvedStepReturn<Mode, ReturnType<Fn>>>], Mode>
  step<Fn extends (...args: any[]) => any>(
    stepId: StepId,
    fnOrOptions?: ValidateStepFn<Fn, Ctx, Mode> | StepOptions,
    maybeOptions?: StepOptions
  ) {
    const isFunction = typeof fnOrOptions === 'function'
    const fn = isFunction ? fnOrOptions : undefined
    const options = isFunction ? maybeOptions : fnOrOptions
    const resolved = this.resolveStep(stepId, options)
    const stepFn = fn ?? resolved.stepFn

    if (stepFn == null) {
      throw new Error(`Flow step "${resolved.id}" is missing a step function`)
    }

    return this.appendStep(new StepInfo(resolved.id, stepFn as StepInfo<string, Ctx, object>['fn'], resolved.options))
  }

  branch<
    Ref extends StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Ctx, SelectedKey>,
    Select extends (...args: any[]) => any = (ctx: Ctx) => BranchSelectFnReturnValue<SelectedKey>,
  >(
    stepId: Ref,
    select: ValidateBranchSelect<Select, Ctx, SelectedKey>,
    branches: TBranches,
    options?: StepOptions
  ): FlowBuilder<
    Ctx,
    StepId,
    [...Steps, StepBranchInfo<string, Ctx, SelectedKey, NormalizedBranchFlows<TBranches>>],
    Mode
  > {
    const resolved = this.resolveStep(stepId, options)
    const normalizedBranches = Object.fromEntries(
      getOwnEntries(branches).map(([key, flow]) => {
        const normalizedFlow = flow instanceof Flow ? flow : flow.build()

        if (this.asyncMode === 'sync' && normalizedFlow.asyncMode === 'async') {
          throw new Error(`Flow branch "${resolved.id}" cannot include async flow "${String(key)}" in sync mode`)
        }

        return [key, normalizedFlow]
      })
    ) as NormalizedBranchFlows<TBranches>

    return this.appendStep(
      new StepBranchInfo(
        resolved.id,
        select as StepBranchInfo<string, Ctx, SelectedKey>['select'],
        normalizedBranches,
        resolved.options
      )
    )
  }

  build() {
    return new Flow<Ctx, Steps, Mode>(this.steps, this.asyncMode)
  }
}

function createDefaultResolver<Mode extends AsyncMode>() {
  return function (id: string) {
    return { id }
  } as (id: string) => StepInfoResolution<object, Mode>
}

type CreateFlowFactory<Mode extends AsyncMode> = {
  <Ctx extends object = object>(): FlowBuilder<Ctx, string, [], Mode>
  <Ctx extends object, StepId>(config: CreateFlowOptions<Ctx, StepId, Mode>): FlowBuilder<Ctx, StepId, [], Mode>
  <Resolver extends StepInfoResolver<any, any, Mode>>(
    config: { resolver: Resolver } & StepOptions
  ): FlowBuilder<InferResolverCtx<Resolver>, InferResolverStepId<Resolver>, [], Mode>
  <
    StepId,
    Fn extends (...args: any[]) => any = Mode extends 'sync'
      ? (ctx: any) => object
      : (ctx: any) => MaybePromise<object>,
    Ctx extends object = Extract<StepInputCtx<Fn>, object>,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, Ctx, Mode>,
    config?: CreateFlowOptions<Ctx, StepId, Mode>
  ): FlowBuilder<Ctx, StepId, [StepInfo<string, Ctx, ResolvedStepReturn<Mode, ReturnType<Fn>>>], Mode>
  <
    StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Ctx, SelectedKey>,
    Select extends (...args: any[]) => any = (ctx: any) => BranchSelectFnReturnValue<SelectedKey>,
    Ctx extends object = Extract<StepInputCtx<Select>, object>,
  >(
    id: StepId,
    select: ValidateBranchSelect<Select, Ctx, SelectedKey>,
    branches: TBranches,
    config?: CreateFlowOptions<Ctx, StepId, Mode>
  ): FlowBuilder<Ctx, StepId, [StepBranchInfo<string, Ctx, SelectedKey, NormalizedBranchFlows<TBranches>>], Mode>
}

function createFlow<Mode extends AsyncMode>(asyncMode: Mode, ...args: unknown[]) {
  const builder = new FlowBuilder([], asyncMode, createDefaultResolver<Mode>())

  if (args.length === 0) {
    return builder
  }

  if (args.length === 1) {
    const [config] = args as [CreateFlowOptions<any, any, Mode>]
    return new FlowBuilder([], asyncMode, config.resolver ?? createDefaultResolver<Mode>())
  }

  if (args.length === 2) {
    const [id, fn] = args as [string, (...args: any[]) => any]
    return (builder as any).step(id, fn)
  }

  if (args.length === 3) {
    const [id, second, third] = args
    if (typeof second === 'function' && isFlowConfig(third)) {
      return (builder as any).step(id, second, third)
    }

    return (builder as any).branch(id, second, third)
  }

  if (args.length === 4) {
    const [id, select, branches, options] = args as [
      string,
      (...args: any[]) => any,
      Record<PropertyKey, any>,
      CreateFlowOptions<any, any, Mode>,
    ]

    return (builder as any).branch(id, select, branches, options)
  }

  throw new Error(`create${asyncMode === 'sync' ? 'Sync' : 'Async'}Flow() expects 0, 1, 2, 3, or 4 arguments`)
}

function isFlowConfig(value: unknown): value is CreateFlowOptions<any, any, any> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return 'description' in value || 'status' in value || 'resolver' in value
}

export const createSyncFlow = ((...args: unknown[]) => createFlow('sync', ...args)) as CreateFlowFactory<'sync'>
export const createAsyncFlow = ((...args: unknown[]) => createFlow('async', ...args)) as CreateFlowFactory<'async'>
