import {
  type AnyStepMap,
  type AnyStepResolver,
  type MaybePromise,
  StepBranchInfo,
  StepInfo,
  type FlowResult,
  type FlowStepInfo,
  type StepOptions,
  type StepStatus,
} from './flowClasses.ts'
import { asyncRun, syncRun } from './flowRun.ts'
import { getOwnEntries } from './utils.ts'

type AsyncMode = 'sync' | 'async'
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type BranchSelectFnReturnValue<Key extends PropertyKey> = Key | readonly Key[] | StepStatus

type CompatibleBranchFlow<Data extends object, Ctx> =
  | Flow<Data, any, any, undefined>
  | FlowBuilder<Data, any, any, any, undefined, any, any, any>
  | ([Ctx] extends [undefined] ? never : Flow<Data, any, any, Ctx> | FlowBuilder<Data, any, any, any, Ctx, any, any, any>)

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

type ValidateFnShape<Fn, ExpectedData extends object, ExpectedCtx> = Fn extends (...args: any[]) => any
  ? Expand<ExpectedData> extends StepInputData<Fn>
    ? ValidateFnContext<Fn, ExpectedCtx> extends never
      ? never
      : Fn
    : never
  : never

type ValidateStepFn<Fn, ExpectedData extends object, ExpectedCtx, Mode extends AsyncMode> =
  ValidateFnShape<Fn, ExpectedData, ExpectedCtx> extends never
    ? never
    : ValidStepReturn<Mode, StepOutput<Fn>> extends never
      ? never
      : Fn

type ValidateBranchSelect<Fn, ExpectedData extends object, ExpectedCtx, Key extends PropertyKey> =
  ValidateFnShape<Fn, ExpectedData, ExpectedCtx> extends never
    ? never
    : StepOutput<Fn> extends BranchSelectFnReturnValue<Key>
      ? Fn
      : never

type MapOutput<Map, Fallback extends object> = [Map] extends [undefined]
  ? Fallback
  : ReturnType<Extract<Map, (...args: any[]) => any>> extends infer Output
    ? Extract<Output, object> extends infer Mapped extends object
      ? Mapped
      : Fallback
    : Fallback

type MapFromOptions<Options> = Options extends { map?: infer Map } ? Exclude<Map, undefined> : never
type MappedStepData<Options, Fallback extends object> = [MapFromOptions<Options>] extends [never]
  ? Fallback
  : MapOutput<MapFromOptions<Options>, Fallback>
type MappedStepCtx<Options, Fallback> = [MapFromOptions<Options>] extends [never] ? Fallback : undefined
type HasMap<Map> = [Map] extends [undefined] ? false : true
type InferResolverStepId<Resolver> = Resolver extends (params: { id: infer StepId; description?: string }) => any
  ? StepId
  : string

type MetadataResolution = {
  id: string
  description?: string
}

export type StepInfoResolver<StepId = any> = (params: { id: StepId; description?: string }) => MetadataResolution

type StepMapFn<StepId, Data extends object, Ctx, Output extends object> = (params: {
  id: StepId
  data: Expand<Data>
  ctx: Ctx
  stepOptions?: StepOptions
}) => Output

type ValidateResolverInput<Resolver, StepId> = Resolver extends (params: infer Params) => any
  ? Params extends { id: infer ResolverStepId; description?: string }
    ? [StepId] extends [ResolverStepId]
      ? Resolver
      : never
    : never
  : never

type ValidateMapInput<Mapper, StepId, Data extends object, Ctx> = Mapper extends (params: infer Params) => any
  ? Params extends { id: infer MapperStepId; data: infer MapperData extends object; ctx: infer MapperCtx }
    ? [StepId] extends [MapperStepId]
      ? Expand<Data> extends MapperData
        ? [Ctx] extends [MapperCtx]
          ? Mapper
          : never
        : never
      : never
    : never
  : never

type FlowRunResult<Steps extends readonly FlowStepInfo[], Mode extends 'sync' | 'async'> = Mode extends 'sync'
  ? FlowResult<Steps>
  : Promise<FlowResult<Steps>>

type CreateFlowOptions<
  Data extends object,
  StepId,
  Ctx = undefined,
  Mapper extends StepMapFn<StepId, Data, Ctx, any> | undefined = undefined,
> = Omit<StepOptions, 'resolver' | 'map'> & {
  name?: string
  description?: string
  resolver?: ValidateResolverInput<StepInfoResolver<StepId>, StepId>
  map?: ValidateMapInput<Mapper, StepId, Data, Ctx>
}

function previewStepId(stepId: unknown) {
  if (typeof stepId === 'string') {
    return stepId
  }

  if (stepId != null && typeof stepId === 'object' && 'id' in stepId && typeof (stepId as { id?: unknown }).id === 'string') {
    return (stepId as { id: string }).id
  }

  return String(stepId)
}

function resolveMetadata(
  flowResolver: AnyStepResolver | undefined,
  stepId: unknown,
  options?: StepOptions
): { id: string; options?: StepOptions } {
  const resolver = (options?.resolver ?? flowResolver) as AnyStepResolver | undefined
  const description = options?.description
  const resolved = resolver == null ? { id: previewStepId(stepId), description } : resolver({ id: stepId, description })
  const mergedOptions = resolved.description === undefined ? options : { ...options, description: resolved.description }

  return {
    id: resolved.id,
    options: mergedOptions,
  }
}

export function stepResult<const Result extends Record<string, unknown>>(result: Result): Result {
  return result
}

class Flow<
  RunData extends object = object,
  Steps extends readonly FlowStepInfo[] = [],
  Mode extends AsyncMode = AsyncMode,
  RunCtx = undefined,
> {
  declare readonly __flowRunDataType__: (data: RunData) => RunData
  declare readonly __flowRunCtxType__: (ctx: RunCtx) => RunCtx

  constructor(
    readonly steps: Steps,
    readonly asyncMode: Mode,
    readonly allowsContext: boolean,
    readonly name?: string,
    readonly description?: string,
    readonly map?: AnyStepMap
  ) {}

  run(...args: RunCtx extends undefined ? [data: RunData] : [data: RunData, ctx: RunCtx]): FlowRunResult<Steps, Mode> {
    if (this.allowsContext ? args.length !== 2 : args.length !== 1) {
      throw new Error(
        this.allowsContext
          ? 'Flow.run() expects both data and ctx when the flow uses withContext()'
          : 'Flow.run() expects only data when the flow does not use withContext()'
      )
    }

    const [data, ctx] = args as [RunData, RunCtx]

    if (this.asyncMode === 'sync') {
      return syncRun(this, data, ctx) as FlowRunResult<Steps, Mode>
    }

    return asyncRun(this, data, ctx) as FlowRunResult<Steps, Mode>
  }
}

class FlowBuilder<
  RunData extends object = object,
  StepId = string,
  Steps extends readonly FlowStepInfo[] = [],
  Mode extends AsyncMode = AsyncMode,
  RunCtx = undefined,
  StepData extends object = RunData,
  StepCtx = RunCtx,
  FlowHasMap extends boolean = false,
> {
  declare readonly __flowRunDataType__: (data: RunData) => RunData
  declare readonly __flowRunCtxType__: (ctx: RunCtx) => RunCtx

  constructor(
    readonly steps: Steps,
    private readonly asyncMode: Mode,
    private readonly resolver?: AnyStepResolver,
    private readonly map?: AnyStepMap,
    readonly name?: string,
    readonly description?: string,
    private readonly allowsContext = false,
    private readonly stepAllowsContext = false
  ) {}

  private appendStep<NewStep extends FlowStepInfo>(
    newStep: NewStep
  ): FlowBuilder<RunData, StepId, [...Steps, NewStep], Mode, RunCtx, StepData, StepCtx, FlowHasMap> {
    return new FlowBuilder<RunData, StepId, [...Steps, NewStep], Mode, RunCtx, StepData, StepCtx, FlowHasMap>(
      [...this.steps, newStep] as [...Steps, NewStep],
      this.asyncMode,
      this.resolver,
      this.map,
      this.name,
      this.description,
      this.allowsContext,
      this.stepAllowsContext
    )
  }

  withContext<NewCtx>() {
    return new FlowBuilder<
      RunData,
      StepId,
      Steps,
      Mode,
      NewCtx,
      StepData,
      FlowHasMap extends true ? StepCtx : NewCtx,
      FlowHasMap
    >(
      this.steps,
      this.asyncMode,
      this.resolver,
      this.map,
      this.name,
      this.description,
      true,
      this.map == null
    )
  }

  private previewStep(stepId: StepId, options?: StepOptions) {
    return resolveMetadata(this.resolver, stepId, options)
  }

  step<TOptions extends StepOptions | undefined = undefined>(
    stepId: StepId,
    options?: TOptions
  ): FlowBuilder<
    RunData,
    StepId,
    [...Steps, StepInfo<StepId, MappedStepData<TOptions, StepData>, object, MappedStepCtx<TOptions, StepCtx>>],
    Mode,
    RunCtx,
    StepData,
    StepCtx,
    FlowHasMap
  >
  step<Fn extends (...args: any[]) => any, TOptions extends StepOptions | undefined = undefined>(
    stepId: StepId,
    fn: ValidateStepFn<Fn, MappedStepData<TOptions, StepData>, MappedStepCtx<TOptions, StepCtx>, Mode>,
    options?: TOptions
  ): FlowBuilder<
    RunData,
    StepId,
    [
      ...Steps,
      StepInfo<StepId, MappedStepData<TOptions, StepData>, ResolvedStepReturn<Mode, ReturnType<Fn>>, MappedStepCtx<TOptions, StepCtx>>,
    ],
    Mode,
    RunCtx,
    StepData,
    StepCtx,
    FlowHasMap
  >
  step(stepId: StepId, fnOrOptions?: unknown, maybeOptions?: StepOptions): any {
    const isFunction = typeof fnOrOptions === 'function'
    const fn = isFunction ? (fnOrOptions as (...args: any[]) => any) : undefined
    const resolvedOptions = (isFunction ? maybeOptions : fnOrOptions) as StepOptions | undefined
    const preview = this.previewStep(stepId, resolvedOptions)
    const defaultFn =
      fn ??
      (((stepId as { fn?: unknown }).fn instanceof Function ? (stepId as { fn: (...args: any[]) => any }).fn : undefined) as
        | ((...args: any[]) => any)
        | undefined)

    if (defaultFn == null) {
      throw new Error(`Flow step "${preview.id}" is missing a step function`)
    }

    return this.appendStep(
      new StepInfo(preview.id, stepId, defaultFn as StepInfo<StepId, object, object, StepCtx>['fn'], preview.options)
    )
  }

  branch<
    TOptions extends StepOptions | undefined = undefined,
    SelectedKey extends PropertyKey = PropertyKey,
    TBranches extends BranchFlowMap<MappedStepData<TOptions, StepData>, MappedStepCtx<TOptions, StepCtx>, SelectedKey> = BranchFlowMap<
      MappedStepData<TOptions, StepData>,
      MappedStepCtx<TOptions, StepCtx>,
      SelectedKey
    >,
    Select extends (...args: any[]) => any = (
      data: MappedStepData<TOptions, StepData>,
      ctx: MappedStepCtx<TOptions, StepCtx>
    ) => BranchSelectFnReturnValue<SelectedKey>,
  >(
    stepId: StepId,
    select: ValidateBranchSelect<Select, MappedStepData<TOptions, StepData>, MappedStepCtx<TOptions, StepCtx>, SelectedKey>,
    branches: TBranches,
    options?: TOptions
  ): FlowBuilder<
    RunData,
    StepId,
    [
      ...Steps,
      StepBranchInfo<
        StepId,
        StepData,
        SelectedKey,
        StepCtx,
        NormalizedBranchFlows<TBranches>
      >,
    ],
    Mode,
    RunCtx,
    StepData,
    StepCtx,
    FlowHasMap
  > {
    const preview = this.previewStep(stepId, options)
    const branchAllowsContext = options?.map == null && this.stepAllowsContext
    const normalizedBranches = Object.fromEntries(
      getOwnEntries(branches).map(([key, flow]) => {
        const normalizedFlow = flow instanceof Flow ? flow : flow.build()

        if (this.asyncMode === 'sync' && normalizedFlow.asyncMode === 'async') {
          throw new Error(`Flow branch "${preview.id}" cannot include async flow "${String(key)}" in sync mode`)
        }

        if (!branchAllowsContext && normalizedFlow.allowsContext) {
          throw new Error(
            `Flow branch "${preview.id}" cannot include context flow "${String(key)}" without withContext()`
          )
        }

        return [key, normalizedFlow]
      })
    ) as NormalizedBranchFlows<TBranches>

    return this.appendStep(
      new StepBranchInfo(
        preview.id,
        stepId,
        select as StepBranchInfo<
          StepId,
          StepData,
          SelectedKey,
          StepCtx,
          NormalizedBranchFlows<TBranches>
        >['select'],
        normalizedBranches,
        preview.options
      )
    )
  }

  build() {
    return new Flow<RunData, Steps, Mode, RunCtx>(
      this.steps,
      this.asyncMode,
      this.allowsContext,
      this.name,
      this.description,
      this.map
    )
  }
}

type CreateFlowFactory<Mode extends AsyncMode> = {
  <Data extends object = object>(): FlowBuilder<Data, string, [], Mode, undefined, Data, undefined, false>
  <
    StepId,
    Data extends object,
    Mapper extends StepMapFn<StepId, Data, undefined, any> | undefined = undefined,
  >(
    config: CreateFlowOptions<Data, StepId, undefined, Mapper>
  ): FlowBuilder<
    Data,
    StepId,
    [],
    Mode,
    undefined,
    MapOutput<Mapper, Data>,
    MappedStepCtx<{ map?: Mapper }, undefined>,
    HasMap<Mapper>
  >
  <Resolver extends StepInfoResolver<any>>(
    config: Omit<CreateFlowOptions<object, InferResolverStepId<Resolver>>, 'map'> & { resolver: Resolver }
  ): FlowBuilder<object, InferResolverStepId<Resolver>, [], Mode, undefined, object, undefined, false>
  <
    StepId,
    Fn extends (...args: any[]) => any = Mode extends 'sync'
      ? (data: any) => object
      : (data: any) => MaybePromise<object>,
    Data extends object = Extract<StepInputData<Fn>, object>,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, Data, undefined, Mode>,
    config?: Omit<CreateFlowOptions<Data, StepId>, 'resolver' | 'map'>
  ): FlowBuilder<Data, StepId, [StepInfo<StepId, Data, ResolvedStepReturn<Mode, ReturnType<Fn>>, undefined>], Mode, undefined, Data, undefined, false>
  <
    StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Data, undefined, SelectedKey>,
    Select extends (...args: any[]) => any = (data: any) => BranchSelectFnReturnValue<SelectedKey>,
    Data extends object = Extract<StepInputData<Select>, object>,
  >(
    id: StepId,
    select: ValidateBranchSelect<Select, Data, undefined, SelectedKey>,
    branches: TBranches,
    config?: StepOptions
  ): FlowBuilder<
    Data,
    StepId,
    [StepBranchInfo<StepId, Data, SelectedKey, undefined, NormalizedBranchFlows<TBranches>>],
    Mode,
    undefined,
    Data,
    undefined,
    false
  >
}

function createFlow<Mode extends AsyncMode>(asyncMode: Mode, ...args: unknown[]) {
  const builder = new FlowBuilder([], asyncMode)

  if (args.length === 0) {
    return builder
  }

  if (args.length === 1) {
    const [config] = args as [CreateFlowOptions<any, any>]
    const map = config.map as AnyStepMap | undefined
    return new FlowBuilder(
      [],
      asyncMode,
      config.resolver as AnyStepResolver | undefined,
      map,
      config.name,
      config.description,
      false,
      false
    )
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
    const [id, select, branches, options] = args as [string, (...args: any[]) => any, Record<PropertyKey, unknown>, StepOptions]
    return (builder as any).branch(id, select, branches, options)
  }

  throw new Error(`create${asyncMode === 'sync' ? 'Sync' : 'Async'}Flow() expects 0, 1, 2, 3, or 4 arguments`)
}

function isFlowConfig(value: unknown): value is CreateFlowOptions<any, any> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  return 'description' in value || 'status' in value || 'name' in value || 'resolver' in value || 'map' in value
}

export const createSyncFlow = ((...args: unknown[]) => createFlow('sync', ...args)) as CreateFlowFactory<'sync'>
export const createAsyncFlow = ((...args: unknown[]) => createFlow('async', ...args)) as CreateFlowFactory<'async'>
