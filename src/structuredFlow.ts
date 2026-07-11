import { StepBranchInfo, StepInfo, FlowStepInfo, FlowResult, StepOptions } from './flowClasses.ts'
import { asyncRun, syncRun } from './flowRun.ts'
import { getOwnEntries } from './utils.ts'

type MaybePromise<T> = T | Promise<T>
type AsyncMode = 'sync' | 'async'
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type BranchSelectFnReturnValue<Key extends PropertyKey> = Key | readonly Key[] | import('./flowClasses.ts').StepStatus

type CompatibleBranchFlow<Data extends object, Ctx> =
  | Flow<Data, any, any, undefined>
  | FlowBuilder<Data, any, any, any, undefined>
  | ([Ctx] extends [undefined] ? never : Flow<Data, any, any, Ctx> | FlowBuilder<Data, any, any, any, Ctx>)

type BranchFlowMap<Data extends object, Ctx, SelectedKey extends PropertyKey = PropertyKey> = Record<
  SelectedKey,
  CompatibleBranchFlow<Data, Ctx>
>

type NormalizedBranchFlows<TBranches extends Record<PropertyKey, unknown>> = {
  [K in keyof TBranches]: Flow<any, any, any, any>
}

type StepInputData<Fn> = Fn extends (...args: infer Args) => any ? (Args extends [] ? object : Args[0]) : never
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

type ValidateFnContext<Fn, ExpectedCtx> = [ExpectedCtx] extends [undefined]
  ? Fn
  : Fn extends (...args: infer Args) => any
    ? Args extends [] | [any]
      ? Fn
      : Expand<ExpectedCtx> extends Args[1]
        ? Fn
        : never
    : never

type ValidateStepFn<Fn, ExpectedData extends object, ExpectedCtx, Mode extends AsyncMode> = Fn extends (
  ...args: any[]
) => any
  ? Expand<ExpectedData> extends StepInputData<Fn>
    ? ValidateFnContext<Fn, ExpectedCtx> extends never
      ? never
      : ValidStepReturn<Mode, StepOutput<Fn>> extends never
        ? never
        : Fn
    : never
  : never

type ValidateBranchSelect<Fn, ExpectedData extends object, ExpectedCtx, Key extends PropertyKey> = Fn extends (
  ...args: any[]
) => any
  ? Expand<ExpectedData> extends StepInputData<Fn>
    ? ValidateFnContext<Fn, ExpectedCtx> extends never
      ? never
      : StepOutput<Fn> extends BranchSelectFnReturnValue<Key>
        ? Fn
        : never
    : never
  : never

type ResolverStepFn<Data extends object, Mode extends AsyncMode, Ctx = any> = Mode extends 'sync'
  ? (data: Data, ctx: Ctx) => object
  : (data: Data, ctx: Ctx) => MaybePromise<object>

type StepInfoResolution<Data extends object, Mode extends AsyncMode, Ctx = any> = {
  id: string
  description?: string
  stepFn?: ResolverStepFn<Data, Mode, Ctx>
}

type StepInfoResolver<StepId = any, Data extends object = object, Mode extends AsyncMode = AsyncMode, Ctx = any> = (
  id: StepId
) => StepInfoResolution<Data, Mode, Ctx>

type InferResolverData<Resolver> = Resolver extends (...args: any[]) => { stepFn?: infer Fn }
  ? Extract<StepInputData<Exclude<Fn, undefined>>, object>
  : object

type InferResolverStepId<Resolver> = Resolver extends (id: infer StepId) => any ? StepId : string

type CreateFlowOptions<Data extends object, StepId, Mode extends AsyncMode> = StepOptions & {
  resolver?: StepInfoResolver<StepId, Data, Mode, any>
}

type FlowRunResult<Steps extends readonly FlowStepInfo[], Mode extends 'sync' | 'async'> = Mode extends 'sync'
  ? FlowResult<Steps>
  : Promise<FlowResult<Steps>>

export function stepResult<const Result extends Record<string, unknown>>(result: Result): Result {
  return result
}

class Flow<
  Data extends object = object,
  Steps extends readonly FlowStepInfo[] = [],
  Mode extends AsyncMode = AsyncMode,
  Ctx = undefined,
> {
  declare readonly __flowDataType__: (data: Data) => Data

  constructor(
    readonly steps: Steps,
    readonly asyncMode: Mode,
    readonly allowsContext: boolean
  ) {}

  run(...args: Ctx extends undefined ? [data: Data] : [data: Data, ctx: Ctx]): FlowRunResult<Steps, Mode> {
    if (this.allowsContext ? args.length !== 2 : args.length !== 1) {
      throw new Error(
        this.allowsContext
          ? 'Flow.run() expects both data and ctx when the flow uses withContext()'
          : 'Flow.run() expects only data when the flow does not use withContext()'
      )
    }

    const [data, ctx] = args as [Data, Ctx]

    if (this.asyncMode === 'sync') {
      return syncRun(this.steps, data, ctx) as FlowRunResult<Steps, Mode>
    }

    return asyncRun(this.steps, data, ctx) as FlowRunResult<Steps, Mode>
  }
}

class FlowBuilder<
  Data extends object = object,
  StepId = string,
  Steps extends readonly FlowStepInfo[] = [],
  Mode extends AsyncMode = AsyncMode,
  Ctx = undefined,
> {
  declare readonly __flowDataType__: (data: Data) => Data

  constructor(
    readonly steps: Steps,
    private readonly asyncMode: Mode,
    private readonly resolver: StepInfoResolver<StepId, Data, Mode, Ctx>,
    private readonly allowsContext = false
  ) {}

  private appendStep<NewStep extends FlowStepInfo>(
    newStep: NewStep
  ): FlowBuilder<Data, StepId, [...Steps, NewStep], Mode, Ctx> {
    return new FlowBuilder<Data, StepId, [...Steps, NewStep], Mode, Ctx>(
      [...this.steps, newStep] as [...Steps, NewStep],
      this.asyncMode,
      this.resolver,
      this.allowsContext
    )
  }

  withContext<NewCtx>() {
    return new FlowBuilder<Data, StepId, Steps, Mode, NewCtx>(
      this.steps,
      this.asyncMode,
      this.resolver as unknown as StepInfoResolver<StepId, Data, Mode, NewCtx>,
      true
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
  ): FlowBuilder<Data, StepId, [...Steps, StepInfo<string, Data, object, Ctx>], Mode, Ctx>
  step<Fn extends (...args: any[]) => any>(
    stepId: StepId,
    fn: ValidateStepFn<Fn, Data, Ctx, Mode>,
    options?: StepOptions
  ): FlowBuilder<
    Data,
    StepId,
    [...Steps, StepInfo<string, Data, ResolvedStepReturn<Mode, ReturnType<Fn>>, Ctx>],
    Mode,
    Ctx
  >
  step<Fn extends (...args: any[]) => any>(
    stepId: StepId,
    fnOrOptions?: ValidateStepFn<Fn, Data, Ctx, Mode> | StepOptions,
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

    return this.appendStep(
      new StepInfo(resolved.id, stepFn as StepInfo<string, Data, object, Ctx>['fn'], resolved.options)
    )
  }

  branch<
    Ref extends StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Data, Ctx, SelectedKey>,
    Select extends (...args: any[]) => any = (data: Data, ctx: Ctx) => BranchSelectFnReturnValue<SelectedKey>,
  >(
    stepId: Ref,
    select: ValidateBranchSelect<Select, Data, Ctx, SelectedKey>,
    branches: TBranches,
    options?: StepOptions
  ): FlowBuilder<
    Data,
    StepId,
    [...Steps, StepBranchInfo<string, Data, SelectedKey, Ctx, NormalizedBranchFlows<TBranches>>],
    Mode,
    Ctx
  > {
    const resolved = this.resolveStep(stepId, options)
    const normalizedBranches = Object.fromEntries(
      getOwnEntries(branches).map(([key, flow]) => {
        const normalizedFlow = flow instanceof Flow ? flow : flow.build()

        if (this.asyncMode === 'sync' && normalizedFlow.asyncMode === 'async') {
          throw new Error(`Flow branch "${resolved.id}" cannot include async flow "${String(key)}" in sync mode`)
        }

        if (!this.allowsContext && normalizedFlow.allowsContext) {
          throw new Error(`Flow branch "${resolved.id}" cannot include context flow "${String(key)}" without withContext()`)
        }

        return [key, normalizedFlow]
      })
    ) as NormalizedBranchFlows<TBranches>

    return this.appendStep(
      new StepBranchInfo(
        resolved.id,
        select as StepBranchInfo<string, Data, SelectedKey, Ctx>['select'],
        normalizedBranches,
        resolved.options
      )
    )
  }

  build() {
    return new Flow<Data, Steps, Mode, Ctx>(this.steps, this.asyncMode, this.allowsContext)
  }
}

function createDefaultResolver<Mode extends AsyncMode>() {
  return function (id: string) {
    return { id }
  } as (id: string) => StepInfoResolution<object, Mode>
}

type CreateFlowFactory<Mode extends AsyncMode> = {
  <Data extends object = object>(): FlowBuilder<Data, string, [], Mode>
  <StepId, Data extends object>(config: CreateFlowOptions<Data, StepId, Mode>): FlowBuilder<Data, StepId, [], Mode>
  <Resolver extends StepInfoResolver<any, any, Mode>>(
    config: { resolver: Resolver } & StepOptions
  ): FlowBuilder<InferResolverData<Resolver>, InferResolverStepId<Resolver>, [], Mode>
  <
    StepId,
    Fn extends (...args: any[]) => any = Mode extends 'sync'
      ? (data: any) => object
      : (data: any) => MaybePromise<object>,
    Data extends object = Extract<StepInputData<Fn>, object>,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, Data, undefined, Mode>,
    config?: CreateFlowOptions<Data, StepId, Mode>
  ): FlowBuilder<Data, StepId, [StepInfo<string, Data, ResolvedStepReturn<Mode, ReturnType<Fn>>, undefined>], Mode>
  <
    StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Data, undefined, SelectedKey>,
    Select extends (...args: any[]) => any = (data: any, ctx: any) => BranchSelectFnReturnValue<SelectedKey>,
    Data extends object = Extract<StepInputData<Select>, object>,
  >(
    id: StepId,
    select: ValidateBranchSelect<Select, Data, undefined, SelectedKey>,
    branches: TBranches,
    config?: CreateFlowOptions<Data, StepId, Mode>
  ): FlowBuilder<
    Data,
    StepId,
    [StepBranchInfo<string, Data, SelectedKey, undefined, NormalizedBranchFlows<TBranches>>],
    Mode
  >
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
