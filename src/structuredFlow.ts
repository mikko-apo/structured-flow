import {
  type AnyStepMap,
  type BranchOptions,
  type MaybePromise,
  StepBranchInfo,
  StepFnResult,
  type StepFnResultOptions,
  StepInfo,
  RuleId,
  Step,
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
  | Flow<Data, any, undefined>
  | FlowBuilder<Data, any, any, undefined, any, any>
  | ([Ctx] extends [undefined] ? never : Flow<Data, any, Ctx> | FlowBuilder<Data, any, any, Ctx, any, any>)

type BranchFlowMap<Data extends object, Ctx, SelectedKey extends PropertyKey = PropertyKey> = Record<
  SelectedKey,
  CompatibleBranchFlow<Data, Ctx>
>

type StepInputData<Fn> = Fn extends (...args: infer Args) => any ? (Args extends [] ? object : Args[0]) : never
type StepOutput<Fn> = Fn extends (...args: any[]) => infer Result ? Result : never

type ValidStepReturn<Mode extends AsyncMode, Result> = Mode extends 'sync'
  ? Result extends Promise<any>
    ? never
    : Result extends object | boolean
      ? Result
      : never
  : Awaited<Result> extends object | boolean
    ? Result
    : never

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
type MapFnInput<Map> =
  MapOutput<Map, object> extends { fnInput: infer Input }
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
type ValidateCallbackInput<Fn, Data extends object, Params extends object> = Fn extends (
  data: infer FnData,
  params: infer FnParams
) => any
  ? [Data] extends [FnData]
    ? [Params] extends [FnParams]
      ? Fn
      : never
    : never
  : never
type StepAsyncFlag<Fn extends (...args: any[]) => any> = ReturnType<Fn> extends Promise<any> ? true : false
type StepAllowedInMode<TStep extends Step<any, any, any>, Mode extends AsyncMode> = Mode extends 'sync'
  ? TStep extends Step<any, true, any>
    ? never
    : TStep
  : TStep

type MetadataResolution = {
  id: string
  description?: string
}

type ResolvableStepId = string | RuleId<any> | Step<any, any, any>

type FlowResolver = (stepId: ResolvableStepId) => string | RuleId<any> | { id: string; description?: string }

type StepMapFn<StepId, Data extends object, Ctx> = (params: {
  id: StepId
  data: Expand<Data>
  ctx: Ctx
  stepOptions?: StepOptions
  params?: object
}) => object & { fnInput?: FnInputTuple }

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

type FlowRunResult<Mode extends 'sync' | 'async'> = Mode extends 'sync' ? FlowResult : Promise<FlowResult>

type CreateFlowOptions<
  Data extends object,
  StepId,
  Ctx = undefined,
  Mapper extends StepMapFn<StepId, Data, Ctx> | undefined = undefined,
> = Omit<StepOptions, 'map'> & {
  name?: string
  description?: string
  resolver?: FlowResolver
  map?: ValidateMapInput<Mapper, StepId, Data, Ctx>
}

function normalizeResolvedStepId(
  stepId: string | RuleId<any> | { id: string; description?: string }
): MetadataResolution {
  if (typeof stepId === 'string') {
    return { id: stepId }
  }

  return {
    id: stepId.id,
    description: stepId.description,
  }
}

function resolveMetadata(
  resolver: FlowResolver | undefined,
  stepId: ResolvableStepId,
  options?: StepOptions | BranchOptions
): MetadataResolution {
  const resolved = normalizeResolvedStepId(resolver == null ? stepId : resolver(stepId))

  return {
    id: resolved.id,
    description: options?.description ?? resolved.description,
  }
}

function resolveOptions(
  resolver: FlowResolver | undefined,
  stepId: ResolvableStepId,
  options?: StepOptions | BranchOptions
): { id: string; options?: StepOptions | BranchOptions } {
  const resolved = resolveMetadata(resolver, stepId, options)
  const mergedOptions = resolved.description === undefined ? options : { ...options, description: resolved.description }

  return {
    id: resolved.id,
    options: mergedOptions,
  }
}

function stepFnResult(status: StepStatus, params?: StepFnResultOptions): StepFnResult {
  return new StepFnResult(status, params)
}

export function ok(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('ok', params)
}

export function skip(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('skip', params)
}

export function stop(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('stop', params)
}

export function error(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('error', params)
}

export function exception(params?: StepFnResultOptions): StepFnResult {
  return stepFnResult('exception', params)
}

export function ruleId<I = undefined>(id: string, params: { description?: string; info?: I } = {}): RuleId<I> {
  return new RuleId(id, params.description, params.info)
}

export function step<I, Fn extends (...args: any[]) => any>(
  id: string,
  stepFn: Fn,
  params?: { path?: string; description?: string; info?: I }
): Step<Fn, StepAsyncFlag<Fn>, I> {
  return new Step(id, stepFn, params)
}

class Flow<
  RunData extends object = object,
  Mode extends AsyncMode = AsyncMode,
  RunCtx = undefined,
> {
  declare readonly __flowRunDataType__: (data: RunData) => RunData
  declare readonly __flowRunCtxType__: (ctx: RunCtx) => RunCtx

  constructor(
    readonly steps: readonly FlowStepInfo[],
    readonly asyncMode: Mode,
    readonly allowsContext: boolean,
    readonly name?: string,
    readonly description?: string,
    readonly map?: AnyStepMap
  ) {}

  run(...args: RunCtx extends undefined ? [data: RunData] : [data: RunData, ctx: RunCtx]): FlowRunResult<Mode> {
    if (this.allowsContext ? args.length !== 2 : args.length !== 1) {
      throw new Error(
        this.allowsContext
          ? 'Flow.run() expects both data and ctx when the flow uses withContext()'
          : 'Flow.run() expects only data when the flow does not use withContext()'
      )
    }

    const [data, ctx] = args as [RunData, RunCtx]

    if (this.asyncMode === 'sync') {
      return syncRun(this, data, ctx) as FlowRunResult<Mode>
    }

    return asyncRun(this, data, ctx) as FlowRunResult<Mode>
  }
}

class FlowBuilder<
  RunData extends object = object,
  StepId = string,
  Mode extends AsyncMode = AsyncMode,
  RunCtx = undefined,
  StepData extends object = RunData,
  StepParams extends object = { ctx: RunCtx },
> {
  declare readonly __flowRunDataType__: (data: RunData) => RunData
  declare readonly __flowRunCtxType__: (ctx: RunCtx) => RunCtx

  constructor(
    readonly steps: readonly FlowStepInfo[],
    private readonly asyncMode: Mode,
    private readonly resolver?: FlowResolver,
    private readonly map?: AnyStepMap,
    readonly name?: string,
    readonly description?: string,
    private readonly allowsContext = false
  ) {}

  private appendStep(newStep: FlowStepInfo): FlowBuilder<RunData, StepId, Mode, RunCtx, StepData, StepParams> {
    return new FlowBuilder<RunData, StepId, Mode, RunCtx, StepData, StepParams>(
      [...this.steps, newStep],
      this.asyncMode,
      this.resolver,
      this.map,
      this.name,
      this.description,
      this.allowsContext
    )
  }

  withContext<NewCtx>() {
    return new FlowBuilder<RunData, StepId, Mode, NewCtx, StepData, ReplaceStepCtx<StepParams, NewCtx>>(
      this.steps,
      this.asyncMode,
      this.resolver,
      this.map,
      this.name,
      this.description,
      true
    )
  }

  private previewStep(stepId: unknown, options?: StepOptions | BranchOptions) {
    return resolveOptions(this.resolver, stepId as ResolvableStepId, options)
  }

  step<
    TStep extends Step<any, any, any>,
    Fn extends (...args: any[]) => any = TStep extends Step<infer StepFn, any, any> ? StepFn : never,
  >(
    stepId: StepAllowedInMode<TStep, Mode> &
      (ValidateCallbackInput<Fn, StepData, StepParams> extends never ? never : TStep)
  ): FlowBuilder<
    RunData,
    StepId,
    Mode,
    RunCtx,
    StepData,
    StepParams
  >
  step<
    TOptions extends StepOptions | undefined = undefined,
    Id extends StepId | string | RuleId<any> = StepId,
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
    stepId: Id,
    fn: ValidateStepFn<Fn, Mode>,
    options?: TOptions
  ): FlowBuilder<
    RunData,
    StepId,
    Mode,
    RunCtx,
    StepData,
    StepParams
  >
  step(stepId: StepId | Step<any, any, any>, fnOrOptions?: unknown, maybeOptions?: StepOptions): any {
    const isFunction = typeof fnOrOptions === 'function'
    const fn = isFunction ? (fnOrOptions as (...args: any[]) => any) : undefined
    const resolvedOptions = (isFunction ? maybeOptions : fnOrOptions) as StepOptions | undefined
    const defaultFn = fn ?? (stepId instanceof Step ? stepId.stepFn : undefined)
    const preview = this.previewStep(stepId, resolvedOptions)

    if (defaultFn == null) {
      throw new Error(`Flow step "${preview.id}" is missing a step function`)
    }

    return this.appendStep(new StepInfo(preview.id, stepId, defaultFn as StepInfo['fn'], preview.options))
  }

  branch<
    SelectedKey extends PropertyKey = PropertyKey,
    TBranches extends BranchFlowMap<RunData, RunCtx, SelectedKey> = BranchFlowMap<RunData, RunCtx, SelectedKey>,
    Select extends (...args: any[]) => any = (
      data: StepInputDataWithMap<BranchOptions, StepData, StepParams>,
      params: StepInputParamsWithMap<BranchOptions, StepData, StepParams>
    ) => BranchSelectFnReturnValue<SelectedKey>,
  >(
    select: Select,
    branches: TBranches,
    options?: BranchOptions
  ): FlowBuilder<
    RunData,
    StepId,
    Mode,
    RunCtx,
    StepData,
    StepParams
  >
  branch(
    select: (...args: any[]) => any,
    branches: Record<PropertyKey, CompatibleBranchFlow<RunData, RunCtx>>,
    options?: BranchOptions
  ): any {
    const stepId = options?.name ?? `branch-${this.steps.length + 1}`
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
    ) as Record<PropertyKey, Flow<any, any, any>>

    return this.appendStep(
      new StepBranchInfo(
        preview.id,
        stepId,
        select as StepBranchInfo['select'],
        normalizedBranches,
        preview.options
      )
    )
  }

  build() {
    return new Flow<RunData, Mode, RunCtx>(
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
  <Data extends object = object>(): FlowBuilder<Data, string, Mode, undefined, Data, { ctx: undefined }>
  <Data extends object, Mapper extends StepMapFn<string, Data, undefined> | undefined = undefined>(
    config: CreateFlowOptions<Data, string, undefined, Mapper>
  ): FlowBuilder<
    Data,
    string,
    Mode,
    undefined,
    ApplyMapInput<Mapper, Data, { ctx: undefined }>[0],
    ApplyMapInput<Mapper, Data, { ctx: undefined }>[1]
  >
  <StepId, Data extends object, Mapper extends StepMapFn<StepId, Data, undefined> | undefined = undefined>(
    config: CreateFlowOptions<Data, StepId, undefined, Mapper>
  ): FlowBuilder<
    Data,
    StepId,
    Mode,
    undefined,
    ApplyMapInput<Mapper, Data, { ctx: undefined }>[0],
    ApplyMapInput<Mapper, Data, { ctx: undefined }>[1]
  >
  <
    StepId,
    Fn extends (...args: any[]) => any = Mode extends 'sync'
      ? (data: any, params: { ctx: undefined }) => object
      : (data: any, params: { ctx: undefined }) => MaybePromise<object>,
    Data extends object = Extract<StepInputData<Fn>, object>,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, Mode>,
    config?: Omit<CreateFlowOptions<Data, StepId>, 'map'>
  ): FlowBuilder<
    Data,
    StepId,
    Mode,
    undefined,
    Data,
    { ctx: undefined }
  >
  <
    SelectedKey extends PropertyKey,
    TBranches extends BranchFlowMap<Data, undefined, SelectedKey>,
    Select extends (...args: any[]) => any = (
      data: any,
      params: { ctx: undefined }
    ) => BranchSelectFnReturnValue<SelectedKey>,
    Data extends object = Extract<StepInputData<Select>, object>,
  >(
    select: Select,
    branches: TBranches,
    config?: BranchOptions
  ): FlowBuilder<
    Data,
    string,
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
    return new FlowBuilder([], asyncMode, config.resolver, map, config.name, config.description, false)
  }

  if (args.length === 2) {
    const [id, fn] = args as [string, (...args: any[]) => any]
    return (builder as any).step(id, fn)
  }

  if (args.length === 3) {
    const [first, second, third] = args
    if (typeof first === 'function') {
      return (builder as any).branch(first, second, third)
    }

    return (builder as any).step(first, second, third)
  }

  throw new Error(`create${asyncMode === 'sync' ? 'Sync' : 'Async'}Flow() expects 0, 1, 2, or 3 arguments`)
}

export const createSyncFlow = ((...args: unknown[]) => createFlow('sync', ...args)) as CreateFlowFactory<'sync'>
export const createAsyncFlow = ((...args: unknown[]) => createFlow('async', ...args)) as CreateFlowFactory<'async'>
