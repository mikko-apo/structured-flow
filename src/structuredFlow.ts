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
  | FlowBuilder<Data, any, any, any, undefined, any, any>
  | ([Ctx] extends [undefined] ? never : Flow<Data, any, any, Ctx> | FlowBuilder<Data, any, any, any, Ctx, any, any>)

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

type ValidateStepFn<Fn, Mode extends AsyncMode> = ValidStepReturn<Mode, StepOutput<Fn>> extends never ? never : Fn

type MapOutput<Map, Fallback extends object> = [Map] extends [undefined]
  ? Fallback
  : ReturnType<Extract<Map, (...args: any[]) => any>> extends infer Output
    ? Extract<Output, object> extends infer Mapped extends object
      ? Mapped
      : Fallback
    : Fallback

type MapFromOptions<Options> = Options extends { map?: infer Map } ? Exclude<Map, undefined> : never
type FnInputTuple = readonly [data: object, params: object]
type MapParamsOutput<Map> = Omit<MapOutput<Map, object>, 'fnInput'>
type MapFnInput<Map> = MapOutput<Map, object> extends { fnInput: infer Input }
  ? Input extends readonly [infer Data extends object, infer Params extends object]
    ? [Expand<Data>, Expand<Params>]
    : never
  : never
type MergeStepParams<Params extends object, Map> = Expand<Params & MapParamsOutput<Map>>
type ApplyMapInput<Map, Data extends object, Params extends object> = [Map] extends [undefined]
  ? [Data, Params]
  : [MapFnInput<Map>] extends [never]
    ? [Data, MergeStepParams<Params, Map>]
    : MapFnInput<Map>
type StepInputDataWithMap<Options, Data extends object, Params extends object> = ApplyMapInput<
  MapFromOptions<Options>,
  Data,
  Params
>[0]
type StepInputParamsWithMap<Options, Data extends object, Params extends object> = ApplyMapInput<
  MapFromOptions<Options>,
  Data,
  Params
>[1]
type ReplaceStepCtx<Params extends object, Ctx> = Expand<Omit<Params, 'ctx'> & { ctx: Ctx }>
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
  params?: object
}) => Output & { fnInput?: FnInputTuple }

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
  StepParams extends object = { ctx: RunCtx },
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
    private readonly allowsContext = false
  ) {}

  private appendStep<NewStep extends FlowStepInfo>(
    newStep: NewStep
  ): FlowBuilder<RunData, StepId, [...Steps, NewStep], Mode, RunCtx, StepData, StepParams> {
    return new FlowBuilder<RunData, StepId, [...Steps, NewStep], Mode, RunCtx, StepData, StepParams>(
      [...this.steps, newStep] as [...Steps, NewStep],
      this.asyncMode,
      this.resolver,
      this.map,
      this.name,
      this.description,
      this.allowsContext
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
      ReplaceStepCtx<StepParams, NewCtx>
    >(
      this.steps,
      this.asyncMode,
      this.resolver,
      this.map,
      this.name,
      this.description,
      true
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
    [...Steps, StepInfo<StepId, StepInputDataWithMap<TOptions, StepData, StepParams>, object, StepInputParamsWithMap<TOptions, StepData, StepParams>>],
    Mode,
    RunCtx,
    StepData,
    StepParams
  >
  step<
    TOptions extends StepOptions | undefined = undefined,
    Fn extends (
      data: StepInputDataWithMap<TOptions, StepData, StepParams>,
      params: StepInputParamsWithMap<TOptions, StepData, StepParams>
    ) => any = Mode extends 'sync'
      ? (
          data: StepInputDataWithMap<TOptions, StepData, StepParams>,
          params: StepInputParamsWithMap<TOptions, StepData, StepParams>
        ) => object
      : (
          data: StepInputDataWithMap<TOptions, StepData, StepParams>,
          params: StepInputParamsWithMap<TOptions, StepData, StepParams>
        ) => MaybePromise<object>,
  >(
    stepId: StepId,
    fn: ValidateStepFn<Fn, Mode>,
    options?: TOptions
  ): FlowBuilder<
    RunData,
    StepId,
    [
      ...Steps,
      StepInfo<
        StepId,
        StepInputDataWithMap<TOptions, StepData, StepParams>,
        ResolvedStepReturn<Mode, ReturnType<Fn>>,
        StepInputParamsWithMap<TOptions, StepData, StepParams>
      >,
    ],
    Mode,
    RunCtx,
    StepData,
    StepParams
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
      new StepInfo(preview.id, stepId, defaultFn as StepInfo<StepId, object, object, StepParams>['fn'], preview.options)
    )
  }

  branch<
    TOptions extends StepOptions | undefined = undefined,
    SelectedKey extends PropertyKey = PropertyKey,
    TBranches extends BranchFlowMap<RunData, RunCtx, SelectedKey> = BranchFlowMap<
      RunData,
      RunCtx,
      SelectedKey
    >,
    Select extends (...args: any[]) => any = (
      data: StepInputDataWithMap<TOptions, StepData, StepParams>,
      params: StepInputParamsWithMap<TOptions, StepData, StepParams>
    ) => BranchSelectFnReturnValue<SelectedKey>,
  >(
    stepId: StepId,
    select: Select,
    branches: TBranches,
    options?: TOptions
  ): FlowBuilder<
    RunData,
    StepId,
    [
      ...Steps,
      StepBranchInfo<
        StepId,
        StepInputDataWithMap<TOptions, StepData, StepParams>,
        SelectedKey,
        StepInputParamsWithMap<TOptions, StepData, StepParams>,
        NormalizedBranchFlows<TBranches>
      >,
    ],
    Mode,
    RunCtx,
    StepData,
    StepParams
  > {
    const preview = this.previewStep(stepId, options)
    const normalizedBranches = Object.fromEntries(
      getOwnEntries(branches).map(([key, flow]) => {
        const normalizedFlow = flow instanceof Flow ? flow : flow.build()

        if (this.asyncMode === 'sync' && normalizedFlow.asyncMode === 'async') {
          throw new Error(`Flow branch "${preview.id}" cannot include async flow "${String(key)}" in sync mode`)
        }

        if (!this.allowsContext && normalizedFlow.allowsContext) {
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
          StepInputDataWithMap<TOptions, StepData, StepParams>,
          SelectedKey,
          StepInputParamsWithMap<TOptions, StepData, StepParams>,
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
  <Data extends object = object>(): FlowBuilder<Data, string, [], Mode, undefined, Data, { ctx: undefined }>
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
    ApplyMapInput<Mapper, Data, { ctx: undefined }>[0],
    ApplyMapInput<Mapper, Data, { ctx: undefined }>[1]
  >
  <Resolver extends StepInfoResolver<any>>(
    config: Omit<CreateFlowOptions<object, InferResolverStepId<Resolver>>, 'map'> & { resolver: Resolver }
  ): FlowBuilder<object, InferResolverStepId<Resolver>, [], Mode, undefined, object, { ctx: undefined }>
  <
    StepId,
    Fn extends (...args: any[]) => any = Mode extends 'sync'
      ? (data: any, params: { ctx: undefined }) => object
      : (data: any, params: { ctx: undefined }) => MaybePromise<object>,
    Data extends object = Extract<StepInputData<Fn>, object>,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, Mode>,
    config?: Omit<CreateFlowOptions<Data, StepId>, 'resolver' | 'map'>
  ): FlowBuilder<
    Data,
    StepId,
    [StepInfo<StepId, Data, ResolvedStepReturn<Mode, ReturnType<Fn>>, { ctx: undefined }>],
    Mode,
    undefined,
    Data,
    { ctx: undefined }
  >
  <
    StepId,
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Data, undefined, SelectedKey>,
    Select extends (...args: any[]) => any = (data: any, params: { ctx: undefined }) => BranchSelectFnReturnValue<SelectedKey>,
    Data extends object = Extract<StepInputData<Select>, object>,
  >(
    id: StepId,
    select: Select,
    branches: TBranches,
    config?: StepOptions
  ): FlowBuilder<
    Data,
    StepId,
    [StepBranchInfo<StepId, Data, SelectedKey, { ctx: undefined }, NormalizedBranchFlows<TBranches>>],
    Mode,
    undefined,
    Data,
    { ctx: undefined }
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
