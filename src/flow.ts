import {
  type BranchInfoType,
  type BranchInitInput,
  type BranchInitResult,
  type InvocationInput,
  type InvocationMap,
  type BranchOptions,
  type MapResult,
  type MaybePromise,
  type RawStepFnResult,
  type StepInit,
  type StepResultMap,
  type StepResultMapInput,
  StepBranchInfo,
  StepInfo,
  RuleId,
  Rule,
  type FlowResult,
  type FlowOptions,
  type FlowStepOptions,
  type FlowResolver,
  type FlowStepInfo,
  type StepOptions,
  type StepParams,
  type StepFnResultRuleId,
  type StepInfoType,
} from './flowClasses.ts'
import { asyncRun, syncRun } from './flowRun.ts'
import { getOwnEntries } from './utils.ts'

type AnyFlow = Flow<any, any, any, any, any, any, any, any>
type AnyRule = Rule<any, any, any>
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type CompatibleBranchFlow<Data extends object, Ctx> =
  | Flow<Data, any, any, undefined, any, any, any, any>
  | ([Ctx] extends [undefined] ? never : Flow<Data, any, any, Ctx, any, any, any, any>)

type BranchFlowMap<Data extends object, Ctx, SelectedKey extends PropertyKey = PropertyKey> = Record<
  SelectedKey,
  CompatibleBranchFlow<Data, Ctx>
>

type BranchDataSelection<Key extends PropertyKey, Data extends object, Ctx> = {
  keys?: Key | readonly Key[]
  data: Data
  ctx?: Ctx
}

type BranchMapData<Branches extends Record<PropertyKey, AnyFlow>> =
  Branches[keyof Branches] extends Flow<infer Data, any, any, any, any, any, any, any> ? Data : never

type AnyFn = (...args: any[]) => any
type ExtractFn<T> = Extract<T, AnyFn>
type StepInputData<Fn> = Fn extends (...args: infer Args) => any ? (Args extends [] ? object : Args[0]) : never
type StepOutput<Fn> = Fn extends (...args: any[]) => infer Result ? Result : never
type RuleFn<TRule extends AnyRule> = TRule extends Rule<infer Fn, any, any> ? Fn : never
type RuleData<TRule extends AnyRule> = Extract<StepInputData<RuleFn<TRule>>, object>
type RuleCtx<TRule extends AnyRule, Fallback> =
  RuleFn<TRule> extends (...args: infer Args) => any
    ? Args extends [unknown, infer Params, ...unknown[]]
      ? Params extends { ctx: infer Ctx }
        ? Ctx
        : Fallback
      : Fallback
    : Fallback

type ValidateStepFn<Fn, SyncMode extends boolean> =
  Awaited<StepOutput<Fn>> extends object | boolean
    ? SyncMode extends true
      ? StepOutput<Fn> extends Promise<any>
        ? never
        : Fn
      : Fn
    : never
type AllowAsync<SyncMode extends boolean> = SyncMode extends true ? false : true
type ModeReturn<SyncMode extends boolean, Result> = SyncMode extends true ? Result : MaybePromise<Result>
type ModeCallback<SyncMode extends boolean, Input, Result> = (input: Input) => ModeReturn<SyncMode, Result>
type ModeStepFn<SyncMode extends boolean, Data extends object, Ctx> = (
  data: Data,
  params: { ctx: Ctx }
) => ModeReturn<SyncMode, object | boolean>

type MapOutput<Map, FallbackData extends object, FallbackCtx> = [ExtractFn<Map>] extends [never]
  ? MapResult<FallbackData, FallbackCtx>
  : Awaited<ReturnType<ExtractFn<Map>>> extends infer Output
    ? Output extends MapResult<infer MappedData extends object, infer MappedCtx>
      ? MapResult<Expand<MappedData>, MappedCtx>
      : MapResult<FallbackData, FallbackCtx>
    : MapResult<FallbackData, FallbackCtx>

type ResultMapOutput<Mapper, Fallback> = [ExtractFn<Mapper>] extends [never]
  ? Fallback
  : Awaited<ReturnType<ExtractFn<Mapper>>>
type MappedData<Mapper, Data extends object, Ctx> = MapOutput<Mapper, Data, Ctx>['data']
type MappedCtx<Mapper, Data extends object, Ctx> = MapOutput<Mapper, Data, Ctx>['ctx']
type StepRawResult<Fn> = Awaited<StepOutput<Fn>> | undefined
type ValidateCallbackInput<Fn, Data extends object, Params extends object> = Fn extends (...args: infer Args) => any
  ? Args extends []
    ? Fn
    : [Data] extends [Args[0]]
      ? Args extends [unknown, infer FnParams, ...unknown[]]
        ? [Params] extends [FnParams]
          ? Fn
          : never
        : Fn
      : never
  : never
type RuleAllowedInMode<TRule extends AnyRule, SyncMode extends boolean> = SyncMode extends true
  ? TRule extends Rule<any, true, any>
    ? never
    : TRule
  : TRule

type ResolvableStepId = Parameters<FlowResolver>[0]

type FlowStateInfo<StepId> = StepInfoType<StepId> | BranchInfoType<StepFnResultRuleId | undefined>
type FlowState<StepId> = { steps: readonly FlowStateInfo<StepId>[] }

type FlowMapFn<StepId, Data extends object, Ctx, SyncMode extends boolean> = InvocationMap<
  FlowStateInfo<StepId>,
  Expand<Data>,
  Ctx,
  object,
  unknown,
  Data,
  Ctx,
  FlowStateInfo<StepId>,
  FlowState<StepId>,
  AllowAsync<SyncMode>
>

type FlowResultMapFn<
  StepId,
  Data extends object,
  Ctx,
  SyncMode extends boolean,
  Result = RawStepFnResult | undefined,
> = StepResultMap<
  StepId,
  Expand<Data>,
  Ctx,
  Result,
  RawStepFnResult | undefined,
  Data,
  Ctx,
  FlowStateInfo<StepId>,
  FlowState<StepId>,
  AllowAsync<SyncMode>
>

type MapperValidationArgs<Mapper, ExpectedInput, AllowedOutput> = [ExtractFn<Mapper>] extends [never]
  ? []
  : ExtractFn<Mapper> extends (input: infer MapperInput) => infer MapperOutput
    ? ExpectedInput extends MapperInput
      ? Awaited<MapperOutput> extends AllowedOutput
        ? []
        : [invalidMapper: never]
      : [invalidMapper: never]
    : [invalidMapper: never]

type StepOptionInit<
  Id,
  Data extends object,
  Ctx,
  RunData extends object,
  RunCtx,
  StepId,
  SyncMode extends boolean,
  InitializedData extends object = object,
  InitializedCtx = unknown,
> = StepInit<
  Id,
  Expand<Data>,
  Ctx,
  InitializedData,
  InitializedCtx,
  RunData,
  RunCtx,
  FlowStateInfo<StepId>,
  FlowState<StepId>,
  AllowAsync<SyncMode>
>

type StepOptionResultMap<
  Id,
  Data extends object,
  Ctx,
  Result,
  RunData extends object,
  RunCtx,
  StepId,
  SyncMode extends boolean,
> = StepResultMap<
  Id,
  Expand<Data>,
  Ctx,
  Result,
  RawStepFnResult | undefined,
  RunData,
  RunCtx,
  FlowStateInfo<StepId>,
  FlowState<StepId>,
  AllowAsync<SyncMode>
>

type UnmappedStepOptions<ResultMapper> = StepOptions<undefined, ResultMapper>

type StepResultMapper<
  Id,
  Data extends object,
  Ctx,
  Fn,
  FlowResultMapper,
  RunData extends object,
  RunCtx,
  StepId,
  SyncMode extends boolean,
> = StepOptionResultMap<
  Id,
  Data,
  Ctx,
  ResultMapOutput<FlowResultMapper, StepRawResult<Fn>>,
  RunData,
  RunCtx,
  StepId,
  SyncMode
>

type StepResultMapperValidation<
  Mapper,
  Id,
  Data extends object,
  Ctx,
  Result,
  RunData extends object,
  RunCtx,
  StepId,
> = MapperValidationArgs<
  Mapper,
  StepResultMapInput<Id, Data, Ctx, Result, RunData, RunCtx, FlowStateInfo<StepId>>,
  RawStepFnResult | undefined
>

type FlowBranchInitInput<StepId, Data extends object, Ctx, RunData extends object, RunCtx> = BranchInitInput<
  StepFnResultRuleId | undefined,
  Expand<Data>,
  Ctx,
  RunData,
  RunCtx,
  FlowStateInfo<StepId>
>

type FlowRunResult<SyncMode extends boolean> = SyncMode extends true ? FlowResult : Promise<FlowResult>
type CurrentFlow<
  RunData extends object,
  StepId,
  SyncMode extends boolean,
  RunCtx,
  StepData extends object,
  StepCtx,
  FlowMapper,
  FlowResultMapper,
> = Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
type FlowMetadataOptions = Pick<FlowOptions, 'name' | 'description'>
type FlattenFlowOptions<Options> = Omit<Options, 'step' | 'branch'> &
  (Options extends { step?: infer FlowStep } ? NonNullable<FlowStep> : object)
type FactoryBranchOptions<
  Branches extends Record<PropertyKey, AnyFlow>,
  Init = undefined,
  FlowConfig = CreateFlowOptions<any, string, boolean>,
> = {
  branch: BranchOptions<Branches, Init>
} & FlattenFlowOptions<FlowConfig>
type FactoryFlow<
  Data extends object,
  StepId,
  SyncMode extends boolean,
  StepData extends object = Data,
  StepCtx = undefined,
  FlowMapper = undefined,
  FlowResultMapper = undefined,
> = Flow<Data, StepId, SyncMode, undefined, StepData, StepCtx, FlowMapper, FlowResultMapper>

type MappedFlowOptions<Mapper, ResultMapper> = FlowMetadataOptions & {
  step?: Omit<FlowStepOptions, 'map' | 'mapResult'> & {
    map?: Mapper
    mapResult?: ResultMapper
  }
}

type CreateFlowOptions<
  Data extends object,
  StepId,
  SyncMode extends boolean,
  Ctx = undefined,
  Mapper extends FlowMapFn<StepId, Data, Ctx, SyncMode> | undefined = undefined,
  ResultMapper extends
    | FlowResultMapFn<StepId, MapOutput<Mapper, Data, Ctx>['data'], MapOutput<Mapper, Data, Ctx>['ctx'], SyncMode>
    | undefined = undefined,
> = MappedFlowOptions<Mapper, ResultMapper> & {
  branch?: never
  branches?: never
  init?: never
}

type FactoryStepOptions<Initializer = undefined, ResultMapper = undefined> = {
  step?: StepOptions<Initializer, ResultMapper>
} & FlowMetadataOptions

type InitialFlowOptions<
  Data extends object,
  StepId,
  Result,
  SyncMode extends boolean,
  Mapper extends FlowMapFn<StepId, Data, undefined, SyncMode> | undefined = undefined,
  ResultMapper extends
    | FlowResultMapFn<
        StepId,
        MapOutput<Mapper, Data, undefined>['data'],
        MapOutput<Mapper, Data, undefined>['ctx'],
        SyncMode,
        Result
      >
    | undefined = undefined,
> = MappedFlowOptions<Mapper, ResultMapper>

type CombinedFactoryStepOptions<FlowConfig, ResultMapper = unknown> = {
  step?: StepOptions<unknown, ResultMapper>
} & FlattenFlowOptions<FlowConfig>

type FactoryFlowResultMapper<Data extends object, SyncMode extends boolean> = FlowResultMapFn<
  unknown,
  Data,
  undefined,
  SyncMode
>

type FactoryRuleOptions<TRule extends AnyRule, SyncMode extends boolean> = FlowMetadataOptions & {
  resolver?: FlowResolver
  mapResult?: FactoryFlowResultMapper<RuleData<TRule>, SyncMode>
  trueIsFail?: boolean
  step?: StepOptions<
    unknown,
    StepResultMapper<
      TRule,
      RuleData<TRule>,
      undefined,
      RuleFn<TRule>,
      FactoryFlowResultMapper<RuleData<TRule>, SyncMode>,
      RuleData<TRule>,
      undefined,
      string,
      SyncMode
    >
  >
}

function resolveOptions(
  resolver: FlowResolver | undefined,
  stepId: ResolvableStepId,
  options?: StepOptions | BranchOptions
): { id: string; options?: StepOptions | BranchOptions } {
  const resolved = resolver?.(stepId) ?? stepId
  const id = typeof resolved === 'string' ? resolved : resolved.id
  const description = options?.description ?? (typeof resolved === 'string' ? undefined : resolved.description)
  const mergedOptions = description === undefined ? options : { ...options, description }

  return {
    id,
    options: mergedOptions,
  }
}

export class Flow<
  RunData extends object = object,
  StepId = string,
  SyncMode extends boolean = boolean,
  RunCtx = undefined,
  StepData extends object = RunData,
  StepCtx = RunCtx,
  FlowMapper = undefined,
  FlowResultMapper = undefined,
> {
  declare private readonly __flowType__: (data: RunData, ctx: RunCtx) => [RunData, RunCtx]

  constructor(
    readonly steps: readonly FlowStepInfo[],
    readonly options: FlowOptions
  ) {}

  run(...args: RunCtx extends undefined ? [data: RunData] : [data: RunData, ctx: RunCtx]): FlowRunResult<SyncMode> {
    if (this.options.allowContext ? args.length !== 2 : args.length !== 1) {
      throw new Error(
        this.options.allowContext
          ? 'Flow.run() expects both data and ctx when the flow uses withContext()'
          : 'Flow.run() expects only data when the flow does not use withContext()'
      )
    }

    const [data, ctx] = args as [RunData, RunCtx]

    if (this.options.syncMode) {
      return syncRun(this, data, ctx) as FlowRunResult<SyncMode>
    }

    return asyncRun(this, data, ctx) as FlowRunResult<SyncMode>
  }

  private appendStep(
    newStep: FlowStepInfo
  ): CurrentFlow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper> {
    return new Flow([...this.steps, newStep], this.options)
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
      SyncMode,
      NewCtx,
      MapOutput<FlowMapper, RunData, NewCtx>['data'],
      MapOutput<FlowMapper, RunData, NewCtx>['ctx'],
      FlowMapper,
      FlowResultMapper
    >(this.steps, { ...this.options, allowContext: true })
  }

  private previewStep(stepId: unknown, options?: StepOptions | BranchOptions) {
    return resolveOptions(this.options.step.resolver, stepId as ResolvableStepId, options)
  }

  step<
    TRule extends AnyRule,
    Fn extends (...args: any[]) => any = TRule extends Rule<infer StepFn, any, any> ? StepFn : never,
  >(
    rule: RuleAllowedInMode<TRule, SyncMode>,
    options: StepOptions<
      StepOptionInit<
        TRule,
        StepData,
        StepCtx,
        RunData,
        RunCtx,
        StepId,
        SyncMode,
        RuleData<TRule>,
        RuleCtx<TRule, StepCtx>
      >,
      StepResultMapper<
        TRule,
        RuleData<TRule>,
        RuleCtx<TRule, StepCtx>,
        Fn,
        FlowResultMapper,
        RunData,
        RunCtx,
        StepId,
        SyncMode
      >
    >,
    ...validation: StepResultMapperValidation<
      FlowResultMapper,
      TRule,
      RuleData<TRule>,
      RuleCtx<TRule, StepCtx>,
      StepRawResult<NoInfer<Fn>>,
      RunData,
      RunCtx,
      StepId
    >
  ): CurrentFlow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<
    TRule extends AnyRule,
    Fn extends (...args: any[]) => any = TRule extends Rule<infer StepFn, any, any> ? StepFn : never,
    ResultMapper extends
      | StepResultMapper<TRule, StepData, StepCtx, Fn, FlowResultMapper, RunData, RunCtx, StepId, SyncMode>
      | undefined = undefined,
  >(
    rule: RuleAllowedInMode<TRule, SyncMode> &
      (ValidateCallbackInput<Fn, StepData, { ctx: StepCtx }> extends never ? never : TRule),
    options?: UnmappedStepOptions<ResultMapper>,
    ...validation: StepResultMapperValidation<
      FlowResultMapper,
      TRule,
      StepData,
      StepCtx,
      StepRawResult<NoInfer<Fn>>,
      RunData,
      RunCtx,
      StepId
    >
  ): CurrentFlow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<
    Id extends StepId | string | RuleId<any> | AnyRule,
    Init extends StepOptionInit<Id, StepData, StepCtx, RunData, RunCtx, StepId, SyncMode>,
  >(
    params: StepParams<
      Id,
      ModeStepFn<SyncMode, MappedData<Init, StepData, StepCtx>, MappedCtx<Init, StepData, StepCtx>>,
      Init,
      StepOptionResultMap<
        Id,
        MappedData<Init, StepData, StepCtx>,
        MappedCtx<Init, StepData, StepCtx>,
        ResultMapOutput<FlowResultMapper, RawStepFnResult | undefined>,
        RunData,
        RunCtx,
        StepId,
        SyncMode
      >
    >
  ): CurrentFlow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<Id extends StepId | string | RuleId<any> | AnyRule = StepId>(
    params: StepParams<
      Id,
      ModeStepFn<SyncMode, StepData, StepCtx>,
      undefined,
      StepOptionResultMap<
        Id,
        StepData,
        StepCtx,
        ResultMapOutput<FlowResultMapper, RawStepFnResult | undefined>,
        RunData,
        RunCtx,
        StepId,
        SyncMode
      >
    >
  ): CurrentFlow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step(
    ruleOrParams: AnyRule | StepParams<StepId | string | RuleId<any> | AnyRule, AnyFn>,
    options?: StepOptions,
    ..._validation: never[]
  ): any {
    const isParams = !(ruleOrParams instanceof Rule)
    const { rule, fn, ...stepOptions } = isParams
      ? ruleOrParams
      : { rule: ruleOrParams, fn: ruleOrParams.stepFn, ...(options ?? {}) }
    const resolvedOptions = Object.keys(stepOptions).length === 0 ? undefined : stepOptions
    const preview = this.previewStep(rule, resolvedOptions)

    if (fn == null) {
      throw new Error(`Flow step "${preview.id}" is missing a step function`)
    }

    return this.appendStep(new StepInfo(preview.id, rule, fn as StepInfo['fn'], preview.options))
  }

  branch<
    SelectedKey extends PropertyKey = PropertyKey,
    SelectedData extends object = RunData,
    SelectedCtx = RunCtx,
    TBranches extends BranchFlowMap<SelectedData, SelectedCtx, SelectedKey> = BranchFlowMap<
      SelectedData,
      SelectedCtx,
      SelectedKey
    >,
  >(
    params: BranchOptions<
      TBranches,
      ModeCallback<
        SyncMode,
        FlowBranchInitInput<StepId, StepData, StepCtx, RunData, RunCtx>,
        BranchInitResult<SelectedKey, SelectedData, SelectedCtx>
      >
    >
  ): CurrentFlow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  branch<
    TBranches extends Record<PropertyKey, CompatibleBranchFlow<any, RunCtx>>,
    SelectedData extends object = BranchMapData<TBranches>,
  >(
    params: BranchOptions<
      TBranches & BranchFlowMap<SelectedData, RunCtx, keyof TBranches>,
      ModeCallback<
        SyncMode,
        FlowBranchInitInput<StepId, StepData, StepCtx, RunData, RunCtx>,
        BranchDataSelection<keyof TBranches, SelectedData, RunCtx>
      >
    >
  ): CurrentFlow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  branch(
    params: BranchOptions<
      Record<PropertyKey, CompatibleBranchFlow<RunData, RunCtx>>,
      ((...args: any[]) => any) | undefined
    >
  ): any {
    const { branches } = params
    const branchRuleId = params.ruleId
    const preview =
      branchRuleId === undefined
        ? { id: undefined, options: params }
        : (this.previewStep(branchRuleId, params) as { id: string; options?: BranchOptions })
    const branchLabel = params.name ?? preview.id ?? 'branch'
    for (const [key, flow] of getOwnEntries(branches)) {
      if (this.options.syncMode && !flow.options.syncMode) {
        throw new Error(`Flow branch "${branchLabel}" cannot include async flow "${String(key)}" in sync mode`)
      }
    }

    return this.appendStep(new StepBranchInfo(preview.id, branchRuleId, preview.options as BranchOptions))
  }
}

export type CreateFlowFactory<SyncMode extends boolean> = {
  <
    Data extends object = object,
    Mapper extends FlowMapFn<string, Data, undefined, SyncMode> | undefined = undefined,
    ResultMapper extends
      | FlowResultMapFn<
          string,
          MapOutput<Mapper, Data, undefined>['data'],
          MapOutput<Mapper, Data, undefined>['ctx'],
          SyncMode
        >
      | undefined = undefined,
  >(
    config?: CreateFlowOptions<Data, string, SyncMode, undefined, Mapper, ResultMapper>
  ): FactoryFlow<
    Data,
    string,
    SyncMode,
    MappedData<Mapper, Data, undefined>,
    MappedCtx<Mapper, Data, undefined>,
    Mapper,
    ResultMapper
  >
  <
    StepId,
    Data extends object,
    Mapper extends FlowMapFn<StepId, Data, undefined, SyncMode> | undefined = undefined,
    ResultMapper extends
      | FlowResultMapFn<
          StepId,
          MapOutput<Mapper, Data, undefined>['data'],
          MapOutput<Mapper, Data, undefined>['ctx'],
          SyncMode
        >
      | undefined = undefined,
  >(
    config: CreateFlowOptions<Data, StepId, SyncMode, undefined, Mapper, ResultMapper>
  ): FactoryFlow<
    Data,
    StepId,
    SyncMode,
    MappedData<Mapper, Data, undefined>,
    MappedCtx<Mapper, Data, undefined>,
    Mapper,
    ResultMapper
  >
  <
    StepId,
    Data extends object,
    Initializer extends StepOptionInit<StepId, Data, undefined, Data, undefined, StepId, SyncMode>,
    Fn extends (
      data: MappedData<Initializer, Data, undefined>,
      params: { ctx: MappedCtx<Initializer, Data, undefined> }
    ) => any,
    ResultMapper extends
      | StepResultMapper<
          StepId,
          MappedData<Initializer, Data, undefined>,
          MappedCtx<Initializer, Data, undefined>,
          Fn,
          undefined,
          Data,
          undefined,
          StepId,
          SyncMode
        >
      | undefined = undefined,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, SyncMode>,
    config: FactoryStepOptions<Initializer, ResultMapper>
  ): FactoryFlow<Data, StepId, SyncMode>
  <
    StepId,
    Fn extends (...args: any[]) => any = SyncMode extends true
      ? (data: any, params: { ctx: undefined }) => object
      : (data: any, params: { ctx: undefined }) => MaybePromise<object>,
    Data extends object = Extract<StepInputData<Fn>, object>,
    Mapper extends FlowMapFn<StepId, Data, undefined, SyncMode> | undefined = undefined,
    ResultMapper extends
      | FlowResultMapFn<
          StepId,
          MapOutput<Mapper, Data, undefined>['data'],
          MapOutput<Mapper, Data, undefined>['ctx'],
          SyncMode,
          StepRawResult<Fn>
        >
      | undefined = undefined,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, SyncMode>,
    config: CombinedFactoryStepOptions<
      InitialFlowOptions<Data, StepId, StepRawResult<Fn>, SyncMode, Mapper, ResultMapper>
    >
  ): FactoryFlow<
    Data,
    StepId,
    SyncMode,
    MappedData<Mapper, Data, undefined>,
    MappedCtx<Mapper, Data, undefined>,
    Mapper,
    ResultMapper
  >
  <
    StepId,
    Fn extends (...args: any[]) => any = SyncMode extends true
      ? (data: any, params: { ctx: undefined }) => object
      : (data: any, params: { ctx: undefined }) => MaybePromise<object>,
    Data extends object = Extract<StepInputData<Fn>, object>,
    ResultMapper extends FlowResultMapFn<StepId, Data, undefined, SyncMode, StepRawResult<Fn>> | undefined = undefined,
  >(
    id: StepId,
    fn: ValidateStepFn<Fn, SyncMode>,
    config?: FactoryStepOptions<undefined, ResultMapper>
  ): FactoryFlow<Data, StepId, SyncMode>
  <TRule extends AnyRule>(
    rule: RuleAllowedInMode<TRule, SyncMode>,
    config?: FactoryRuleOptions<TRule, SyncMode>
  ): FactoryFlow<
    RuleData<TRule>,
    string,
    SyncMode,
    RuleData<TRule>,
    undefined,
    undefined,
    FactoryFlowResultMapper<RuleData<TRule>, SyncMode>
  >
  <TBranches extends BranchFlowMap<any, undefined>>(
    config: FactoryBranchOptions<TBranches, undefined, CreateFlowOptions<any, string, SyncMode>>
  ): FactoryFlow<any, string, SyncMode>
  <
    Data extends object,
    SelectedKey extends PropertyKey = PropertyKey,
    SelectedData extends object = Data,
    SelectedCtx = undefined,
    TBranches extends BranchFlowMap<SelectedData, SelectedCtx, SelectedKey> = BranchFlowMap<
      SelectedData,
      SelectedCtx,
      SelectedKey
    >,
  >(
    config: FactoryBranchOptions<
      TBranches,
      ModeCallback<
        SyncMode,
        FlowBranchInitInput<string, Data, undefined, Data, undefined>,
        BranchInitResult<SelectedKey, SelectedData, SelectedCtx>
      >,
      CreateFlowOptions<Data, string, SyncMode>
    >
  ): FactoryFlow<Data, string, SyncMode>
}
