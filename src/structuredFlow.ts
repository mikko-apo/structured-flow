import { StepBranchInfo, StepInfo, FlowStepInfo, FlowResult, StepOptions } from './flowClasses.ts'
import { asyncRun, syncRun } from './flowRun.ts'
import { getOwnEntries } from './utils.ts'

type MaybePromise<T> = T | Promise<T>
type AsyncMode = 'sync' | 'async'
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type BranchSelectFnReturnValue<Key extends PropertyKey> = Key | readonly Key[] | import('./flowClasses.ts').StepStatus

type BranchFlowMap<Ctx extends object, SelectedKey extends PropertyKey = PropertyKey> = Record<
  SelectedKey,
  Flow<Ctx, any, any> | FlowBuilder<Ctx, any, any, any>
>

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

type FlowRunResult<Steps extends readonly FlowStepInfo[], Mode extends 'sync' | 'async'> = Mode extends 'sync'
  ? FlowResult<Steps>
  : Promise<FlowResult<Steps>>

export function stepResult<const Result extends Record<string, unknown>>(result: Result): Result {
  return result
}

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
  <StepId, Ctx extends object>(config: CreateFlowOptions<Ctx, StepId, Mode>): FlowBuilder<Ctx, StepId, [], Mode>
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
