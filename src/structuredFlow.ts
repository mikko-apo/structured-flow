import {
  type BranchInfoType,
  type BranchSelectInput,
  type BranchSelectResult,
  type InvocationInput,
  type InvocationMap,
  type BranchOptions,
  type MapResult,
  type MaybePromise,
  type RawStepFnResult,
  type StepMap,
  type StepResultMap,
  type StepResultMapInput,
  StepBranchInfo,
  StepFnResult,
  type StepFnResultOptions,
  StepInfo,
  RuleId,
  Rule,
  type FlowResult,
  type FlowStepInfo,
  type StepOptions,
  type StepFnResultRuleId,
  type StepInfoType,
  type StepStatus,
} from './flowClasses.ts'
import { asyncRun, syncRun } from './flowRun.ts'
import { getOwnEntries } from './utils.ts'

type AsyncMode = 'sync' | 'async'
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type CompatibleBranchFlow<Data extends object, Ctx> =
  | Flow<Data, any, any, undefined, any, any, any, any>
  | ([Ctx] extends [undefined] ? never : Flow<Data, any, any, Ctx, any, any, any, any>)

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

type MapOutput<Map, FallbackData extends object, FallbackCtx> = [Extract<Map, (...args: any[]) => any>] extends [never]
  ? MapResult<FallbackData, FallbackCtx>
  : ReturnType<Extract<Map, (...args: any[]) => any>> extends infer Output
    ? Output extends MapResult<infer MappedData extends object, infer MappedCtx>
      ? MapResult<Expand<MappedData>, MappedCtx>
      : MapResult<FallbackData, FallbackCtx>
    : MapResult<FallbackData, FallbackCtx>

type ApplyMapInput<Map, Data extends object, Ctx> = [
  MapOutput<Map, Data, Ctx>['data'],
  {
    ctx: MapOutput<Map, Data, Ctx>['ctx']
  },
]
type ResultMapOutput<Mapper, Fallback> = [Extract<Mapper, (...args: any[]) => any>] extends [never]
  ? Fallback
  : ReturnType<Extract<Mapper, (...args: any[]) => any>>
type MappedData<Mapper, Data extends object, Ctx> = MapOutput<Mapper, Data, Ctx>['data']
type MappedCtx<Mapper, Data extends object, Ctx> = MapOutput<Mapper, Data, Ctx>['ctx']
type StepRawResult<Fn> = Awaited<StepOutput<Fn>> | undefined
type CtxFromParams<Params> = Params extends { ctx: infer Ctx } ? Ctx : unknown
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
type RuleAsyncFlag<Fn extends (...args: any[]) => any> = ReturnType<Fn> extends Promise<any> ? true : false
type RuleAllowedInMode<TRule extends Rule<any, any, any>, Mode extends AsyncMode> = Mode extends 'sync'
  ? TRule extends Rule<any, true, any>
    ? never
    : TRule
  : TRule

type MetadataResolution = {
  id: string
  description?: string
}

type ResolvableStepId = string | RuleId<any> | Rule<any, any, any>

type FlowResolver = (stepId: ResolvableStepId) => string | RuleId<any> | { id: string; description?: string }

type FlowStateInfo<StepId> = StepInfoType<StepId> | BranchInfoType<StepFnResultRuleId | undefined>

type FlowMapFn<StepId, Data extends object, Ctx> = InvocationMap<
  FlowStateInfo<StepId>,
  Expand<Data>,
  Ctx,
  object,
  unknown,
  Data,
  Ctx,
  FlowStateInfo<StepId>
>

type FlowResultMapFn<StepId, Data extends object, Ctx, Result = RawStepFnResult | undefined> = StepResultMap<
  StepId,
  Expand<Data>,
  Ctx,
  Result,
  RawStepFnResult | undefined,
  Data,
  Ctx,
  FlowStateInfo<StepId>
>

type ValidateMapper<Mapper, ExpectedInput, AllowedOutput> = Mapper extends (
  input: infer MapperInput
) => infer MapperOutput
  ? ExpectedInput extends MapperInput
    ? MapperOutput extends AllowedOutput
      ? Mapper
      : never
    : never
  : never

type RequireValidMapper<Mapper, ExpectedInput, AllowedOutput> = [Extract<Mapper, (...args: any[]) => any>] extends [
  never,
]
  ? unknown
  : ValidateMapper<Extract<Mapper, (...args: any[]) => any>, ExpectedInput, AllowedOutput> extends never
    ? never
    : unknown

type MapperValidationArgs<Mapper, ExpectedInput, AllowedOutput> =
  RequireValidMapper<Mapper, ExpectedInput, AllowedOutput> extends never ? [invalidMapper: never] : []

type StepOptionMap<Id, Data extends object, Ctx, RunData extends object, RunCtx, StepId> = StepMap<
  Id,
  Expand<Data>,
  Ctx,
  object,
  unknown,
  RunData,
  RunCtx,
  FlowStateInfo<StepId>
>

type StepOptionResultMap<Id, Data extends object, Ctx, Result, RunData extends object, RunCtx, StepId> = StepResultMap<
  Id,
  Expand<Data>,
  Ctx,
  Result,
  RawStepFnResult | undefined,
  RunData,
  RunCtx,
  FlowStateInfo<StepId>
>

type FlowBranchSelectInput<StepId, Data extends object, Ctx, RunData extends object, RunCtx> = BranchSelectInput<
  StepFnResultRuleId | undefined,
  Expand<Data>,
  Ctx,
  RunData,
  RunCtx,
  FlowStateInfo<StepId>
>

type RuntimeStepMap = InvocationMap<any, any, any, any, any, any, any, any, any>
type RuntimeStepResultMap = StepResultMap<any, any, any, any, any, any, any, any, any>

type FlowRunResult<Mode extends 'sync' | 'async'> = Mode extends 'sync' ? FlowResult : Promise<FlowResult>
type FactoryStepFn = (data: any, params: { ctx: undefined }) => MaybePromise<object | boolean>

type CreateFlowOptions<
  Data extends object,
  StepId,
  Ctx = undefined,
  Mapper extends FlowMapFn<StepId, Data, Ctx> | undefined = undefined,
  ResultMapper extends
    | FlowResultMapFn<StepId, MapOutput<Mapper, Data, Ctx>['data'], MapOutput<Mapper, Data, Ctx>['ctx']>
    | undefined = undefined,
> = Omit<StepOptions, 'map' | 'mapResult'> & {
  name?: string
  description?: string
  resolver?: FlowResolver
  map?: Mapper
  mapResult?: ResultMapper
}

type CreateStepFlowOptions<
  Data extends object,
  StepId,
  Result,
  ResultMapper extends FlowResultMapFn<StepId, Data, undefined, Result> | undefined = undefined,
> = Omit<CreateFlowOptions<Data, StepId>, 'map' | 'mapResult'> & {
  mapResult?: ResultMapper
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

function isCreateFlowOptions(value: unknown): value is CreateFlowOptions<any, any> {
  if (value == null || typeof value !== 'object') {
    return false
  }

  const keys = Reflect.ownKeys(value)

  return (
    keys.length === 0 ||
    keys.some(
      (key) => key === 'name' || key === 'description' || key === 'resolver' || key === 'map' || key === 'mapResult'
    )
  )
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

export function rule<I, Fn extends (...args: any[]) => any>(
  id: string,
  stepFn: Fn,
  params?: { path?: string; description?: string; info?: I }
): Rule<Fn, RuleAsyncFlag<Fn>, I> {
  return new Rule(id, stepFn, params)
}

class Flow<
  RunData extends object = object,
  StepId = string,
  Mode extends AsyncMode = AsyncMode,
  RunCtx = undefined,
  StepData extends object = RunData,
  StepParams extends object = { ctx: RunCtx },
  FlowMapper = undefined,
  FlowResultMapper = undefined,
> {
  declare readonly __flowRunDataType__: (data: RunData) => RunData
  declare readonly __flowRunCtxType__: (ctx: RunCtx) => RunCtx

  constructor(
    readonly steps: readonly FlowStepInfo[],
    readonly asyncMode: Mode,
    private readonly resolver?: FlowResolver,
    readonly map?: RuntimeStepMap,
    readonly mapResult?: RuntimeStepResultMap,
    readonly name?: string,
    readonly description?: string,
    readonly allowsContext = false
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

  private appendStep(
    newStep: FlowStepInfo
  ): Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper> {
    return new Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper>(
      [...this.steps, newStep],
      this.asyncMode,
      this.resolver,
      this.map,
      this.mapResult,
      this.name,
      this.description,
      this.allowsContext
    )
  }

  withContext<NewCtx>(
    ..._validation: MapperValidationArgs<
      FlowMapper,
      InvocationInput<FlowStateInfo<StepId>, Expand<RunData>, NewCtx, RunData, NewCtx, FlowStateInfo<StepId>>,
      MapResult<object, unknown>
    >
  ) {
    return new Flow<
      RunData,
      StepId,
      Mode,
      NewCtx,
      MapOutput<FlowMapper, RunData, NewCtx>['data'],
      { ctx: MapOutput<FlowMapper, RunData, NewCtx>['ctx'] },
      FlowMapper,
      FlowResultMapper
    >(this.steps, this.asyncMode, this.resolver, this.map, this.mapResult, this.name, this.description, true)
  }

  private previewStep(stepId: unknown, options?: StepOptions | BranchOptions) {
    return resolveOptions(this.resolver, stepId as ResolvableStepId, options)
  }

  step<
    TRule extends Rule<any, any, any>,
    Fn extends (...args: any[]) => any = TRule extends Rule<infer StepFn, any, any> ? StepFn : never,
    Options extends Omit<StepOptions, 'map' | 'mapResult'> & {
      map: StepOptionMap<TRule, StepData, CtxFromParams<StepParams>, RunData, RunCtx, StepId>
      mapResult?: (...args: any[]) => RawStepFnResult | undefined
    } = Omit<StepOptions, 'map' | 'mapResult'> & {
      map: StepOptionMap<TRule, StepData, CtxFromParams<StepParams>, RunData, RunCtx, StepId>
    },
  >(
    rule: RuleAllowedInMode<TRule, Mode> &
      (ValidateCallbackInput<
        Fn,
        MappedData<Options['map'], StepData, CtxFromParams<StepParams>>,
        { ctx: MappedCtx<Options['map'], StepData, CtxFromParams<StepParams>> }
      > extends never
        ? never
        : TRule),
    options: Options & {
      mapResult?: StepOptionResultMap<
        TRule,
        MappedData<Options['map'], StepData, CtxFromParams<StepParams>>,
        MappedCtx<Options['map'], StepData, CtxFromParams<StepParams>>,
        ResultMapOutput<FlowResultMapper, StepRawResult<Fn>>,
        RunData,
        RunCtx,
        StepId
      >
    },
    ...validation: MapperValidationArgs<
      FlowResultMapper,
      StepResultMapInput<
        TRule,
        MappedData<Options['map'], StepData, CtxFromParams<StepParams>>,
        MappedCtx<Options['map'], StepData, CtxFromParams<StepParams>>,
        StepRawResult<NoInfer<Fn>>,
        RunData,
        RunCtx,
        FlowStateInfo<StepId>
      >,
      RawStepFnResult | undefined
    >
  ): Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper>
  step<
    TRule extends Rule<any, any, any>,
    Fn extends (...args: any[]) => any = TRule extends Rule<infer StepFn, any, any> ? StepFn : never,
    ResultMapper extends
      | StepOptionResultMap<
          TRule,
          StepData,
          CtxFromParams<StepParams>,
          ResultMapOutput<FlowResultMapper, StepRawResult<Fn>>,
          RunData,
          RunCtx,
          StepId
        >
      | undefined = undefined,
  >(
    rule: RuleAllowedInMode<TRule, Mode> &
      (ValidateCallbackInput<Fn, StepData, StepParams> extends never ? never : TRule),
    options?: Omit<StepOptions, 'map' | 'mapResult'> & { map?: undefined; mapResult?: ResultMapper },
    ...validation: MapperValidationArgs<
      FlowResultMapper,
      StepResultMapInput<
        TRule,
        StepData,
        CtxFromParams<StepParams>,
        StepRawResult<NoInfer<Fn>>,
        RunData,
        RunCtx,
        FlowStateInfo<StepId>
      >,
      RawStepFnResult | undefined
    >
  ): Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper>
  step<
    Id extends StepId | string | RuleId<any>,
    Options extends Omit<StepOptions, 'map' | 'mapResult'> & {
      map: StepOptionMap<Id, StepData, CtxFromParams<StepParams>, RunData, RunCtx, StepId>
      mapResult?: (...args: any[]) => RawStepFnResult | undefined
    },
    Fn extends (
      data: MappedData<Options['map'], StepData, CtxFromParams<StepParams>>,
      params: { ctx: MappedCtx<Options['map'], StepData, CtxFromParams<StepParams>> }
    ) => any,
  >(
    ruleId: Id,
    fn: ValidateStepFn<Fn, Mode>,
    options: Options & {
      mapResult?: StepOptionResultMap<
        Id,
        MappedData<Options['map'], StepData, CtxFromParams<StepParams>>,
        MappedCtx<Options['map'], StepData, CtxFromParams<StepParams>>,
        ResultMapOutput<FlowResultMapper, StepRawResult<Fn>>,
        RunData,
        RunCtx,
        StepId
      >
    },
    ...validation: MapperValidationArgs<
      FlowResultMapper,
      StepResultMapInput<
        Id,
        MappedData<Options['map'], StepData, CtxFromParams<StepParams>>,
        MappedCtx<Options['map'], StepData, CtxFromParams<StepParams>>,
        StepRawResult<NoInfer<Fn>>,
        RunData,
        RunCtx,
        FlowStateInfo<StepId>
      >,
      RawStepFnResult | undefined
    >
  ): Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper>
  step<
    Id extends StepId | string | RuleId<any> = StepId,
    Fn extends (data: StepData, params: StepParams) => any = Mode extends 'sync'
      ? (data: StepData, params: StepParams) => object | boolean
      : (data: StepData, params: StepParams) => MaybePromise<object | boolean>,
    ResultMapper extends
      | StepOptionResultMap<
          Id,
          StepData,
          CtxFromParams<StepParams>,
          ResultMapOutput<FlowResultMapper, StepRawResult<Fn>>,
          RunData,
          RunCtx,
          StepId
        >
      | undefined = undefined,
  >(
    ruleId: Id,
    fn: ValidateStepFn<Fn, Mode>,
    options?: Omit<StepOptions, 'map' | 'mapResult'> & { map?: undefined; mapResult?: ResultMapper },
    ...validation: MapperValidationArgs<
      FlowResultMapper,
      StepResultMapInput<
        Id,
        StepData,
        CtxFromParams<StepParams>,
        StepRawResult<NoInfer<Fn>>,
        RunData,
        RunCtx,
        FlowStateInfo<StepId>
      >,
      RawStepFnResult | undefined
    >
  ): Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper>
  step(
    ruleOrId: StepId | string | RuleId<any> | Rule<any, any, any>,
    fnOrOptions?: unknown,
    maybeOptions?: StepOptions,
    ..._validation: never[]
  ): any {
    const isFunction = typeof fnOrOptions === 'function'
    const fn = isFunction ? (fnOrOptions as (...args: any[]) => any) : undefined
    const resolvedOptions = (isFunction ? maybeOptions : fnOrOptions) as StepOptions | undefined
    const defaultFn = fn ?? (ruleOrId instanceof Rule ? ruleOrId.stepFn : undefined)
    const preview = this.previewStep(ruleOrId, resolvedOptions)

    if (defaultFn == null) {
      throw new Error(`Flow step "${preview.id}" is missing a step function`)
    }

    return this.appendStep(new StepInfo(preview.id, ruleOrId, defaultFn as StepInfo['fn'], preview.options))
  }

  branch<
    SelectedKey extends PropertyKey = PropertyKey,
    TBranches extends BranchFlowMap<RunData, RunCtx, SelectedKey> = BranchFlowMap<RunData, RunCtx, SelectedKey>,
  >(
    branches: TBranches,
    options?: BranchOptions
  ): Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper>
  branch<
    SelectedKey extends PropertyKey = PropertyKey,
    SelectedData extends object = RunData,
    SelectedCtx = RunCtx,
    TBranches extends BranchFlowMap<SelectedData, SelectedCtx, SelectedKey> = BranchFlowMap<
      SelectedData,
      SelectedCtx,
      SelectedKey
    >,
    Select extends (
      input: FlowBranchSelectInput<StepId, StepData, CtxFromParams<StepParams>, RunData, RunCtx>
    ) => BranchSelectResult<SelectedKey, SelectedData, SelectedCtx> = (
      input: FlowBranchSelectInput<StepId, StepData, CtxFromParams<StepParams>, RunData, RunCtx>
    ) => BranchSelectResult<SelectedKey, SelectedData, SelectedCtx>,
  >(
    select: Select,
    branches: TBranches,
    options?: BranchOptions
  ): Flow<RunData, StepId, Mode, RunCtx, StepData, StepParams, FlowMapper, FlowResultMapper>
  branch(
    selectOrBranches: ((...args: any[]) => any) | Record<PropertyKey, CompatibleBranchFlow<RunData, RunCtx>>,
    branchesOrOptions?: Record<PropertyKey, CompatibleBranchFlow<RunData, RunCtx>> | BranchOptions,
    maybeOptions?: BranchOptions
  ): any {
    const hasSelect = typeof selectOrBranches === 'function'
    const branches = (hasSelect ? branchesOrOptions : selectOrBranches) as Record<
      PropertyKey,
      CompatibleBranchFlow<RunData, RunCtx>
    >
    const options = (hasSelect ? maybeOptions : branchesOrOptions) as BranchOptions | undefined
    const branchRuleId = options?.ruleId
    const preview =
      branchRuleId === undefined
        ? { id: undefined, options }
        : (this.previewStep(branchRuleId, options) as { id: string; options?: BranchOptions })
    const branchLabel = options?.name ?? preview.id ?? 'branch'
    const normalizedBranches = Object.fromEntries(
      getOwnEntries(branches).map(([key, flow]) => {
        if (this.asyncMode === 'sync' && flow.asyncMode === 'async') {
          throw new Error(`Flow branch "${branchLabel}" cannot include async flow "${String(key)}" in sync mode`)
        }

        if (!this.allowsContext && flow.allowsContext && !hasSelect) {
          throw new Error(
            `Flow branch "${branchLabel}" cannot include context flow "${String(key)}" without withContext()`
          )
        }

        return [key, flow]
      })
    ) as Record<PropertyKey, Flow<any, any, any, any, any, any, any, any>>
    const select = hasSelect ? selectOrBranches : () => Reflect.ownKeys(normalizedBranches)

    return this.appendStep(
      new StepBranchInfo(
        preview.id,
        branchRuleId,
        select as StepBranchInfo['select'],
        normalizedBranches,
        preview.options
      )
    )
  }
}

type CreateFlowFactory<Mode extends AsyncMode> = {
  <Data extends object = object>(): Flow<Data, string, Mode, undefined, Data, { ctx: undefined }, undefined, undefined>
  <
    Data extends object,
    Mapper extends FlowMapFn<string, Data, undefined> | undefined = undefined,
    ResultMapper extends
      | FlowResultMapFn<string, MapOutput<Mapper, Data, undefined>['data'], MapOutput<Mapper, Data, undefined>['ctx']>
      | undefined = undefined,
  >(
    config: CreateFlowOptions<Data, string, undefined, Mapper, ResultMapper>
  ): Flow<
    Data,
    string,
    Mode,
    undefined,
    ApplyMapInput<Mapper, Data, undefined>[0],
    ApplyMapInput<Mapper, Data, undefined>[1],
    Mapper,
    ResultMapper
  >
  <
    StepId,
    Data extends object,
    Mapper extends FlowMapFn<StepId, Data, undefined> | undefined = undefined,
    ResultMapper extends
      | FlowResultMapFn<StepId, MapOutput<Mapper, Data, undefined>['data'], MapOutput<Mapper, Data, undefined>['ctx']>
      | undefined = undefined,
  >(
    config: CreateFlowOptions<Data, StepId, undefined, Mapper, ResultMapper>
  ): Flow<
    Data,
    StepId,
    Mode,
    undefined,
    ApplyMapInput<Mapper, Data, undefined>[0],
    ApplyMapInput<Mapper, Data, undefined>[1],
    Mapper,
    ResultMapper
  >
  <
    StepId,
    Fn extends (...args: any[]) => any = Mode extends 'sync'
      ? (data: any, params: { ctx: undefined }) => object
      : (data: any, params: { ctx: undefined }) => MaybePromise<object>,
    Data extends object = Extract<StepInputData<Fn>, object>,
    ResultMapper extends FlowResultMapFn<StepId, Data, undefined, StepRawResult<Fn>> | undefined = undefined,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, Mode>,
    config?: CreateStepFlowOptions<Data, StepId, StepRawResult<Fn>, ResultMapper>
  ): Flow<Data, StepId, Mode, undefined, Data, { ctx: undefined }, undefined, ResultMapper>
  <TBranches extends BranchFlowMap<any, undefined>>(
    branches: TBranches,
    config?: BranchOptions
  ): Flow<any, string, Mode, undefined, any, { ctx: undefined }, undefined, undefined>
  <
    SelectedKey extends PropertyKey,
    Data extends object = object,
    SelectedData extends object = Data,
    SelectedCtx = undefined,
    TBranches extends BranchFlowMap<SelectedData, SelectedCtx, SelectedKey> = BranchFlowMap<
      SelectedData,
      SelectedCtx,
      SelectedKey
    >,
    Select extends (
      input: FlowBranchSelectInput<string, Data, undefined, Data, undefined>
    ) => BranchSelectResult<SelectedKey, SelectedData, SelectedCtx> = (
      input: FlowBranchSelectInput<string, Data, undefined, Data, undefined>
    ) => BranchSelectResult<SelectedKey, SelectedData, SelectedCtx>,
  >(
    select: Select,
    branches: TBranches,
    config?: BranchOptions
  ): Flow<Data, string, Mode, undefined, Data, { ctx: undefined }, undefined, undefined>
}

function createFlow(asyncMode: AsyncMode, ...args: unknown[]) {
  const flow = new Flow<object, string, AsyncMode, undefined>([], asyncMode)

  if (args.length === 0) {
    return flow
  }

  if (args.length === 1) {
    const [configOrBranches] = args

    if (!isCreateFlowOptions(configOrBranches)) {
      return flow.branch(configOrBranches as Record<PropertyKey, CompatibleBranchFlow<any, undefined>>)
    }

    const config = configOrBranches as CreateFlowOptions<any, any>
    const map = config.map as RuntimeStepMap | undefined
    const mapResult = config.mapResult as RuntimeStepResultMap | undefined
    return new Flow([], asyncMode, config.resolver, map, mapResult, config.name, config.description, false)
  }

  if (args.length === 2) {
    const [first, second] = args

    if (typeof second === 'function') {
      return flow.step(first as string, second as FactoryStepFn)
    }

    return flow.branch(
      first as Record<PropertyKey, CompatibleBranchFlow<any, undefined>>,
      second as BranchOptions | undefined
    )
  }

  if (args.length === 3) {
    const [first, second, third] = args
    if (typeof first === 'function') {
      return flow.branch(
        first as (...args: any[]) => any,
        second as Record<PropertyKey, CompatibleBranchFlow<any, undefined>>,
        third as BranchOptions | undefined
      )
    }

    return (flow.step as any)(first as string, second as FactoryStepFn, third as StepOptions | undefined)
  }

  throw new Error(`create${asyncMode === 'sync' ? 'Sync' : 'Async'}Flow() expects 0, 1, 2, or 3 arguments`)
}

export const createSyncFlow = ((...args: unknown[]) => createFlow('sync', ...args)) as CreateFlowFactory<'sync'>
export const createAsyncFlow = ((...args: unknown[]) => createFlow('async', ...args)) as CreateFlowFactory<'async'>
