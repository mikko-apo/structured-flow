import { getOwnEntries } from './utils.ts'

type MaybePromise<T> = T | Promise<T>
type FlowMode = 'sync' | 'async'
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

export class StepInfo<
  Id extends string = string,
  Ctx extends object = object,
  Result extends object = object,
  Mode extends FlowMode = FlowMode,
> {
  constructor(
    readonly id: Id,
    readonly fn: Mode extends 'sync' ? (ctx: Expand<Ctx>) => Result : (ctx: Expand<Ctx>) => MaybePromise<Result>,
    readonly options?: StepOptions,
    readonly branches?: Record<PropertyKey, FlowLike<any, any>>
  ) {}
}

type FlowLike<Ctx extends object, Result extends MaybePromise<FlowResult<any>> = MaybePromise<FlowResult<any>>> = {
  steps: readonly StepInfo[]
  run(initial: Ctx): Result
}

type BranchFlowMap<Ctx extends object, Mode extends FlowMode, SelectedKey extends PropertyKey = PropertyKey> = Record<
  SelectedKey,
  Flow<Ctx, any, Mode> | FlowBuilder<Ctx, any, any, Mode>
>

type BranchKey<TBranches> = Extract<keyof TBranches, PropertyKey>

type StepInputCtx<Fn> = Fn extends (...args: infer Args) => any ? (Args extends [] ? object : Args[0]) : never
type StepOutput<Fn> = Fn extends (...args: any[]) => infer Result ? Result : never

type ValidStepReturn<Mode extends FlowMode, Result> = Mode extends 'sync'
  ? Result extends Promise<any>
    ? never
    : Result extends object
      ? Result
      : never
  : Awaited<Result> extends object
    ? Result
    : never

type ResolvedStepReturn<Mode extends FlowMode, Result> = Mode extends 'sync'
  ? ValidStepReturn<'sync', Result>
  : Awaited<ValidStepReturn<'async', Result>>

type ValidateStepFn<Fn, ExpectedCtx extends object, Mode extends FlowMode> = Fn extends (...args: any[]) => any
  ? Expand<ExpectedCtx> extends StepInputCtx<Fn>
    ? ValidStepReturn<Mode, StepOutput<Fn>> extends never
      ? never
      : Fn
    : never
  : never

type BranchSelectFnReturnValue<Key extends PropertyKey> = Key | readonly Key[] | StepStatus

type ValidateBranchSelect<Fn, ExpectedCtx extends object, Key extends PropertyKey> = Fn extends (...args: any[]) => any
  ? Expand<ExpectedCtx> extends StepInputCtx<Fn>
    ? StepOutput<Fn> extends BranchSelectFnReturnValue<Key>
      ? Fn
      : never
    : never
  : never

type ResolverStepFn<Ctx extends object, Mode extends FlowMode> = Mode extends 'sync'
  ? (ctx: Ctx) => object
  : (ctx: Ctx) => MaybePromise<object>

type StepInfoResolution<Ctx extends object, Mode extends FlowMode> = {
  id: string
  description?: string
  stepFn?: ResolverStepFn<Ctx, Mode>
}

type StepInfoResolver<StepId = any, Ctx extends object = object, Mode extends FlowMode = FlowMode> = (
  id: StepId
) => StepInfoResolution<Ctx, Mode>

type InferResolverCtx<Resolver> = Resolver extends (...args: any[]) => { stepFn?: infer Fn }
  ? Extract<StepInputCtx<Exclude<Fn, undefined>>, object>
  : object

type InferResolverStepId<Resolver> = Resolver extends (id: infer StepId) => any ? StepId : string

type CreateFlowOptions<Ctx extends object, StepId, Mode extends FlowMode> = StepOptions & {
  resolver?: StepInfoResolver<StepId, Ctx, Mode>
}

type StepPayloadOf<Result> =
  Awaited<Result> extends StepResult<infer Payload>
    ? Payload
    : Awaited<Result> extends object
      ? Omit<Awaited<Result>, 'status'>
      : StepFnPayload

type RawStepFnResult<TStep extends StepInfo> = { status?: StepStatus } & Partial<StepPayloadOf<ReturnType<TStep['fn']>>>

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

function assertValidBranchKey<TBranches extends Record<PropertyKey, Flow<any, any, any>>>(
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
  result: RawStepFnResult<TStep> | undefined,
  skip = false
): StepResult<StepPayloadOf<ReturnType<TStep['fn']>>> {
  const resultLike: RawStepFnResult<TStep> = result ?? {}
  const rawStatus = skip ? 'skip' : (resultLike.status ?? 'ok')
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

function ensureStepResult<TStep extends StepInfo>(
  step: TStep,
  result: StepResult<StepPayloadOf<ReturnType<TStep['fn']>>> | RawStepFnResult<TStep> | undefined,
  skip = false
): StepResult<StepPayloadOf<ReturnType<TStep['fn']>>> {
  if (skip) {
    return createStepResult(step, undefined, true)
  }

  if (result instanceof StepResult) {
    if (result.stepInfo !== step) {
      throw new Error(`Flow step "${step.id}" returned a StepResult bound to a different step`)
    }

    return result
  }

  return createStepResult(step, result)
}

function runBranch<
  Ctx extends object,
  Mode extends FlowMode,
  TStep extends StepInfo<string, Ctx, any, Mode>,
  TBranches extends Record<PropertyKey, Flow<Ctx, any, Mode>>,
>(
  mode: Mode,
  step: TStep,
  ctx: Ctx,
  select: (ctx: Ctx) => BranchSelectFnReturnValue<BranchKey<TBranches>>,
  branches: TBranches
): MaybePromise<StepResult<StepPayloadOf<ReturnType<TStep['fn']>>>> {
  const selection = normalizeBranchSelection(step.id, select(ctx))

  const selectedKeys = new Set<BranchKey<TBranches>>()

  const createStepResultForBranch = (selectedBranchResults: BranchStepFlowResult[], rawStatus: StepStatus) => {
    const skippedBranchResults = getOwnEntries(branches)
      .filter(([key]) => !selectedKeys.has(key))
      .map(
        ([key, flow]) =>
          new BranchStepFlowResult(
            key,
            'skip',
            flow.steps.map((step: StepInfo) => new StepResult(step, 'skip'))
          )
      )
    const status = applyStatusHandling(rawStatus, step.options?.status)
    const originalStatus = rawStatus !== status ? rawStatus : undefined
    const branchStepResult = new StepResult<StepPayloadOf<ReturnType<TStep['fn']>>>(
      step,
      status,
      undefined,
      Array.from(selectedKeys),
      [...selectedBranchResults, ...skippedBranchResults],
      originalStatus
    )
    return mode === 'sync' ? branchStepResult : Promise.resolve(branchStepResult)
  }

  if (isStepStatus(selection)) {
    return createStepResultForBranch([], selection)
  }

  const processBranchResults = (selectedBranchResults: BranchStepFlowResult[]) =>
    createStepResultForBranch(
      selectedBranchResults,
      mergeStepStatuses(selectedBranchResults.map((branch) => branch.status))
    )

  const runSelectedBranch = (key: BranchKey<TBranches>): MaybePromise<BranchStepFlowResult> => {
    assertValidBranchKey(step.id, key, branches)
    selectedKeys.add(key)

    const result = branches[key].run(ctx)

    if (isPromise(result)) {
      return result.then(
        (resolvedResult) => new BranchStepFlowResult(key, resolvedResult.status, resolvedResult.stepResults)
      )
    }

    return new BranchStepFlowResult(key, result.status, result.stepResults)
  }

  const selectedBranchKeys = [...selection]
  if (mode === 'sync') {
    const selectedBranchResults = selectedBranchKeys.map((key) => {
      const branchResult = runSelectedBranch(key)

      if (isPromise(branchResult)) {
        throw new Error(`Flow branch "${step.id}" returned a Promise in sync build()`)
      }

      return branchResult
    })

    return processBranchResults(selectedBranchResults)
  }

  return selectedBranchKeys
    .reduce<
      Promise<BranchStepFlowResult[]>
    >((promise, key) => promise.then((selectedBranchResults) => Promise.resolve(runSelectedBranch(key)).then((branchResult) => [...selectedBranchResults, branchResult])), Promise.resolve([]))
    .then(processBranchResults)
}

export class StepResult<TResult extends object = StepFnPayload> {
  constructor(
    readonly stepInfo: StepInfo,
    readonly status: StepStatus,
    readonly result?: TResult,
    readonly selectedBranchKeys?: PropertyKey[],
    readonly branches?: BranchStepFlowResult[],
    readonly originalStatus?: StepStatus
  ) {}
}

export class BranchStepFlowResult<TStepResult extends StepResult<any> = StepResult<any>> {
  constructor(
    readonly key: PropertyKey,
    readonly status: StepStatus,
    readonly stepResults: TStepResult[]
  ) {}
}

export class FlowResult<Steps extends readonly StepInfo[]> {
  constructor(
    readonly stepResults: Array<StepResult<StepPayloadOf<ReturnType<Step<Steps>['fn']>>>>,
    readonly status: StepStatus
  ) {}
}

type Step<Steps extends readonly unknown[]> = Steps[number]

function isPromise<T>(value: object): value is Promise<T> {
  return 'then' in value && typeof value.then === 'function'
}

function executeFlow<Ctx extends object, Steps extends readonly StepInfo[] = [], Mode extends FlowMode = FlowMode>(
  steps: Steps,
  initial: Ctx,
  mode: Mode
): MaybePromise<FlowResult<Steps>> {
  const ctx = { ...initial } as unknown as Expand<Ctx>
  const results: FlowResult<Steps>['stepResults'] = []

  const recordSkippedRemainingSteps = (startIndex: number) => {
    for (let index = startIndex; index < steps.length; index++) {
      handleResultAndCheckStop(steps[index], index, undefined, true)
    }
  }

  const handleResultAndCheckStop = (
    step: Step<Steps>,
    index: number,
    result: StepResult<StepPayloadOf<ReturnType<Step<Steps>['fn']>>> | RawStepFnResult<Step<Steps>> | undefined,
    skip = false
  ) => {
    const recordedResult = ensureStepResult(step, result, skip)
    results.push(recordedResult)

    if (recordedResult.status === 'stop' || recordedResult.status === 'exception') {
      recordSkippedRemainingSteps(index + 1)
      return true
    }

    return false
  }

  const runSteps = (index: number): MaybePromise<void> => {
    if (index >= steps.length) {
      return
    }

    if (mode === 'sync') {
      for (let currentIndex = index; currentIndex < steps.length; currentIndex++) {
        const step = steps[currentIndex]

        try {
          const result = step.fn(ctx)

          if (isPromise(result)) {
            throw new Error(`Flow step "${step.id}" returned a Promise in sync build()`)
          }

          if (handleResultAndCheckStop(step, currentIndex, result)) {
            break
          }
        } catch {
          if (handleResultAndCheckStop(step, currentIndex, { status: 'exception' } as RawStepFnResult<typeof step>)) {
            break
          }
        }
      }

      return
    }

    const step = steps[index]
    const continueAfterException = () => {
      if (!handleResultAndCheckStop(step, index, { status: 'exception' } as RawStepFnResult<typeof step>)) {
        return runSteps(index + 1)
      }
    }

    return Promise.resolve()
      .then(() => step.fn(ctx))
      .then((result) => {
        if (!handleResultAndCheckStop(step, index, result)) {
          return runSteps(index + 1)
        }
      })
      .catch(() => continueAfterException())
  }

  const finalize = () => new FlowResult<Steps>(results, mergeStepStatuses(results.map((s) => s.status)))

  if (mode === 'sync') {
    runSteps(0)
    return finalize()
  }

  return Promise.resolve(runSteps(0)).then(finalize)
}

class Flow<
  Ctx extends object = object,
  Steps extends readonly StepInfo<any, any, any, any>[] = [],
  Mode extends FlowMode = FlowMode,
> {
  constructor(
    readonly steps: Steps,
    readonly mode: Mode
  ) {}

  run(initial: Ctx) {
    return executeFlow<Ctx, Steps, Mode>(this.steps, initial, this.mode)
  }
}

class FlowBuilder<
  Ctx extends object = object,
  StepId = string,
  Steps extends readonly StepInfo<any, any, any, any>[] = [],
  Mode extends FlowMode = FlowMode,
> {
  constructor(
    readonly steps: Steps,
    private readonly mode: Mode,
    private readonly resolver: StepInfoResolver<StepId, Ctx, Mode>
  ) {}

  private appendStep<NewStep extends StepInfo<string, Ctx, any, Mode>>(
    newStep: NewStep
  ): FlowBuilder<Ctx, StepId, [...Steps, NewStep], Mode> {
    return new FlowBuilder<Ctx, StepId, [...Steps, NewStep], Mode>(
      [...this.steps, newStep] as [...Steps, NewStep],
      this.mode,
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

  step(
    stepId: StepId,
    options?: StepOptions
  ): FlowBuilder<Ctx, StepId, [...Steps, StepInfo<string, Ctx, object, Mode>], Mode>
  step<Fn extends (...args: any[]) => any>(
    stepId: StepId,
    fn: ValidateStepFn<Fn, Ctx, Mode>,
    options?: StepOptions
  ): FlowBuilder<Ctx, StepId, [...Steps, StepInfo<string, Ctx, ResolvedStepReturn<Mode, ReturnType<Fn>>, Mode>], Mode>
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

    const newStep = new StepInfo(resolved.id, stepFn as StepInfo<string, Ctx, object, Mode>['fn'], resolved.options)

    return this.appendStep(newStep)
  }

  branch<
    Ref extends StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Ctx, Mode, SelectedKey>,
    Select extends (...args: any[]) => any = (ctx: Ctx) => BranchSelectFnReturnValue<SelectedKey>,
  >(stepId: Ref, select: ValidateBranchSelect<Select, Ctx, SelectedKey>, branches: TBranches, options?: StepOptions) {
    const resolved = this.resolveStep(stepId, options)
    const normalizedBranches = Object.fromEntries(
      getOwnEntries(branches).map(([key, flow]) => [key, flow instanceof Flow ? flow : flow.build()])
    )

    const newStep = new StepInfo(
      resolved.id,
      ((ctx: Expand<Ctx>) =>
        runBranch(
          this.mode,
          newStep as StepInfo<string, Ctx, StepResult<StepFnPayload>, Mode>,
          ctx as unknown as Ctx,
          select,
          normalizedBranches as typeof normalizedBranches
        )) as StepInfo<string, Ctx, StepResult<StepFnPayload>, Mode>['fn'],
      resolved.options,
      normalizedBranches as Record<PropertyKey, FlowLike<any, any>>
    )

    return this.appendStep(newStep)
  }

  build() {
    return new Flow<Ctx, Steps, Mode>(this.steps, this.mode)
  }
}

function createDefaultResolver<Mode extends FlowMode>() {
  return function (id: string) {
    return { id }
  } as (id: string) => StepInfoResolution<object, Mode>
}

type CreateFlowFactory<Mode extends FlowMode> = {
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
  ): FlowBuilder<Ctx, StepId, [StepInfo<string, Ctx, ResolvedStepReturn<Mode, ReturnType<Fn>>, Mode>], Mode>
  <
    StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Ctx, Mode, SelectedKey>,
    Select extends (...args: any[]) => any = (ctx: any) => BranchSelectFnReturnValue<SelectedKey>,
    Ctx extends object = Extract<StepInputCtx<Select>, object>,
  >(
    id: StepId,
    select: ValidateBranchSelect<Select, Ctx, SelectedKey>,
    branches: TBranches,
    config?: CreateFlowOptions<Ctx, StepId, Mode>
  ): FlowBuilder<Ctx, StepId, [StepInfo<string, Ctx, StepResult<StepFnPayload>, Mode>], Mode>
}

function createFlow<Mode extends FlowMode>(mode: Mode, ...args: unknown[]) {
  const builder = new FlowBuilder([], mode, createDefaultResolver<Mode>())

  if (args.length === 0) {
    return builder
  }

  if (args.length === 1) {
    const [config] = args as [CreateFlowOptions<any, any, Mode>]

    return new FlowBuilder([], mode, config.resolver ?? createDefaultResolver<Mode>())
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

  throw new Error(`create${mode === 'sync' ? 'Sync' : 'Async'}Flow() expects 0, 1, 2, 3, or 4 arguments`)
}

function isFlowConfig(value: unknown): value is CreateFlowOptions<any, any, any> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return 'description' in value || 'status' in value || 'resolver' in value
}

export const createSyncFlow = ((...args: unknown[]) => createFlow('sync', ...args)) as CreateFlowFactory<'sync'>
export const createAsyncFlow = ((...args: unknown[]) => createFlow('async', ...args)) as CreateFlowFactory<'async'>
