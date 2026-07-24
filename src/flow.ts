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
  type FlowOptionStepDefaults,
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
type AnyNoCtxFlow = Flow<any, any, any, undefined, any, any, any, any>
type AnyRule = Rule<any, any, any>
type RuleIdWithoutFn = RuleId<any> & { readonly stepFn?: never }
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
type StepRawResult<Fn> = Awaited<StepOutput<Fn>>
type StepInitializerData<Initializer extends AnyFn> = Parameters<Initializer>[0] extends {
  data: infer Data extends object
}
  ? Data
  : object
type BranchInitializerData<Initializer extends AnyFn> = StepInitializerData<Initializer>
type BranchInitializerResult<Initializer extends AnyFn> = Awaited<ReturnType<Initializer>>
type BranchInitializerMappedData<Initializer extends AnyFn, Fallback extends object> =
  BranchInitializerResult<Initializer> extends { data: infer Data extends object } ? Data : Fallback
type BranchInitializerMappedCtx<Initializer extends AnyFn, Fallback> =
  BranchInitializerResult<Initializer> extends { ctx: infer Ctx } ? Ctx : Fallback
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
type RuleAllowedInMode<TRule extends AnyRule, SyncMode extends boolean> =
  ValidateStepFn<RuleFn<TRule>, SyncMode> extends never ? never : TRule

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
  Result = RawStepFnResult,
> = StepResultMap<
  StepId,
  Expand<Data>,
  Ctx,
  Result,
  RawStepFnResult,
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
  RawStepFnResult,
  RunData,
  RunCtx,
  FlowStateInfo<StepId>,
  FlowState<StepId>,
  AllowAsync<SyncMode>
>

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
  RawStepFnResult
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
type FactoryBranchOptions<
  Branches extends Record<PropertyKey, AnyFlow>,
  Init = undefined,
  FlowConfig = CreateFlowOptions<any, string, boolean>,
> = FlowConfig & {
  step?: never
  branch: BranchOptions<Branches, Init>
}
type FlowNoCtx<
  Data extends object,
  StepId,
  SyncMode extends boolean,
  StepData extends object = Data,
  StepCtx = undefined,
  FlowMapper = undefined,
  FlowResultMapper = undefined,
> = Flow<Data, StepId, SyncMode, undefined, StepData, StepCtx, FlowMapper, FlowResultMapper>

type CreateFlowOptions<
  Data extends object,
  StepId,
  SyncMode extends boolean,
  Ctx = undefined,
  Mapper extends FlowMapFn<StepId, Data, Ctx, SyncMode> | undefined = undefined,
  ResultMapper extends
    | FlowResultMapFn<StepId, MapOutput<Mapper, Data, Ctx>['data'], MapOutput<Mapper, Data, Ctx>['ctx'], SyncMode>
    | undefined = undefined,
> = Omit<
  FlowOptions<
    Mapper & FlowMapFn<StepId, Data, Ctx, SyncMode>,
    ResultMapper &
      FlowResultMapFn<StepId, MapOutput<Mapper, Data, Ctx>['data'], MapOutput<Mapper, Data, Ctx>['ctx'], SyncMode>
  >,
  'syncMode' | 'allowContext'
>

type InitialFlowResultMapper<Data extends object, SyncMode extends boolean> = FlowResultMapFn<
  unknown,
  Data,
  undefined,
  SyncMode
>

type FactoryStepOptions<Step, Data extends object, SyncMode extends boolean> = CreateFlowOptions<
  Data,
  unknown,
  SyncMode,
  undefined,
  undefined,
  InitialFlowResultMapper<Data, SyncMode>
> & {
  step: Step
  branch?: never
}

type FactoryRuleStepOptions<
  TRule extends AnyRule,
  Fn extends AnyFn,
  Data extends object,
  SyncMode extends boolean,
> = Omit<
  StepOptions<
    TRule,
    Fn,
    undefined,
    StepOptionResultMap<TRule, Data, undefined, RawStepFnResult, Data, undefined, string, SyncMode>
  >,
  'fn'
> & {
  fn?: Fn
}

type FactoryStepValidation<Fn extends AnyFn, SyncMode extends boolean> =
  ValidateStepFn<Fn, SyncMode> extends never ? [invalidStepFn: never] : []

type FactoryInitializerValidation<InitialId, Initializer extends AnyFn, Data extends object, SyncMode extends boolean> =
  Initializer extends StepOptionInit<InitialId, Data, undefined, Data, undefined, string, SyncMode>
    ? []
    : [invalidInitializer: never]

type FactoryBranchInitializerValidation<
  Initializer extends AnyFn,
  Data extends object,
  SelectedKey extends PropertyKey,
  SelectedData extends object,
  SelectedCtx,
  SyncMode extends boolean,
> =
  Initializer extends ModeCallback<
    SyncMode,
    FlowBranchInitInput<string, Data, undefined, Data, undefined>,
    BranchInitResult<SelectedKey, SelectedData, SelectedCtx>
  >
    ? []
    : [invalidInitializer: never]

function resolveOptions(
  resolver: FlowResolver | undefined,
  stepId: ResolvableStepId,
  options?: StepParams | BranchOptions
): { id: string; options?: StepParams | BranchOptions } {
  const resolved = resolver?.(stepId) ?? stepId
  const id = typeof resolved === 'string' ? resolved : resolved.id
  const description = options?.description ?? (typeof resolved === 'string' ? undefined : resolved.description)
  const mergedOptions = description === undefined ? options : { ...options, description }

  return {
    id,
    options: mergedOptions,
  }
}

/**
 * An immutable flow definition and its accumulated steps.
 *
 * @typeParam RunData - Data accepted by `run()`.
 * @typeParam StepId - Raw step-id type exposed to resolvers, maps, and processing state.
 * @typeParam SyncMode - Whether `run()` returns a `FlowResult` (`true`) or a promise (`false`).
 * @typeParam RunCtx - Context accepted by `run()`; `undefined` until `withContext()` is used.
 * @typeParam StepData - Data passed to steps after the flow-level `stepDefaults.map`.
 * @typeParam StepCtx - Context passed to steps after the flow-level `stepDefaults.map`.
 * @typeParam FlowMapper - Flow-level map function retained for validation when context changes.
 * @typeParam FlowResultMapper - Flow-level result map used to type each step's `mapResult` input.
 */
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

  /**
   * @param steps - Immutable step and branch definitions accumulated in this flow.
   * @param options - Runtime mode, context behavior, metadata, and step defaults for the flow.
   */
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
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper> {
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

  private previewStep(stepId: unknown, options?: StepParams | BranchOptions) {
    return resolveOptions(this.options.stepDefaults?.resolver, stepId as ResolvableStepId, options)
  }

  /**
   * Adds a step using one of these forms:
   *
   * - `step(rule)`
   * - `step(rule, stepParams)`
   * - `step({ rule, fn?, ...stepParams })`
   *
   * The object form requires `fn` for a `RuleId` or string. For a `Rule`, `fn` is optional and overrides the Rule's
   * function when supplied.
   *
   * Step parameters:
   *
   * - `rule`: rule, rule id, or string that identifies the step.
   * - `fn`: function to run; required for a rule id or string and optional for a `Rule`.
   * - `init`: maps data and context before `fn`.
   * - `description`: overrides the description from the rule or resolver.
   * - `status`: remaps `fail` or `exception` results.
   * - `trueIsFail`: overrides the flow's boolean-result interpretation.
   * - `mapResult`: maps the raw result after the flow-level result mapper.
   */
  step<
    TRule extends AnyRule,
    Fn extends (...args: any[]) => any = TRule extends Rule<infer StepFn, any, any> ? StepFn : never,
  >(
    rule: TRule & RuleAllowedInMode<NoInfer<TRule>, SyncMode>,
    options: StepParams<
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
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<
    TRule extends AnyRule,
    Fn extends (...args: any[]) => any = TRule extends Rule<infer StepFn, any, any> ? StepFn : never,
    ResultMapper extends
      | StepResultMapper<TRule, StepData, StepCtx, Fn, FlowResultMapper, RunData, RunCtx, StepId, SyncMode>
      | undefined = undefined,
  >(
    rule: TRule &
      RuleAllowedInMode<NoInfer<TRule>, SyncMode> &
      (ValidateCallbackInput<Fn, StepData, { ctx: StepCtx }> extends never ? never : TRule),
    options?: StepParams<undefined, ResultMapper>,
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
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<TRule extends AnyRule>(
    params: {
      rule: TRule & RuleAllowedInMode<NoInfer<TRule>, SyncMode>
      fn?: undefined
    } & StepParams<
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
        RuleFn<TRule>,
        FlowResultMapper,
        RunData,
        RunCtx,
        StepId,
        SyncMode
      >
    >
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<TRule extends AnyRule>(
    params: {
      rule: TRule &
        RuleAllowedInMode<NoInfer<TRule>, SyncMode> &
        (ValidateCallbackInput<RuleFn<TRule>, StepData, { ctx: StepCtx }> extends never ? never : TRule)
      fn?: undefined
    } & StepParams<
      undefined,
      StepResultMapper<TRule, StepData, StepCtx, RuleFn<TRule>, FlowResultMapper, RunData, RunCtx, StepId, SyncMode>
    >
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<
    Id extends StepId | string | RuleId<any> | AnyRule,
    Init extends StepOptionInit<Id, StepData, StepCtx, RunData, RunCtx, StepId, SyncMode>,
  >(
    params: StepOptions<
      Id,
      ModeStepFn<SyncMode, MappedData<Init, StepData, StepCtx>, MappedCtx<Init, StepData, StepCtx>>,
      Init,
      StepOptionResultMap<
        Id,
        MappedData<Init, StepData, StepCtx>,
        MappedCtx<Init, StepData, StepCtx>,
        ResultMapOutput<FlowResultMapper, RawStepFnResult>,
        RunData,
        RunCtx,
        StepId,
        SyncMode
      >
    >
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step<Id extends StepId | string | RuleId<any> | AnyRule = StepId>(
    params: StepOptions<
      Id,
      ModeStepFn<SyncMode, StepData, StepCtx>,
      undefined,
      StepOptionResultMap<
        Id,
        StepData,
        StepCtx,
        ResultMapOutput<FlowResultMapper, RawStepFnResult>,
        RunData,
        RunCtx,
        StepId,
        SyncMode
      >
    >
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
  step(
    ruleOrOptions: AnyRule | (Omit<StepOptions<StepId | string | RuleId<any> | AnyRule, AnyFn>, 'fn'> & { fn?: AnyFn }),
    params?: StepParams,
    ..._validation: never[]
  ): any {
    const isOptions = !(ruleOrOptions instanceof Rule)
    const {
      rule,
      fn: suppliedFn,
      ...stepParams
    } = isOptions ? ruleOrOptions : { rule: ruleOrOptions, fn: ruleOrOptions.stepFn, ...(params ?? {}) }
    const fn = suppliedFn ?? (rule instanceof Rule ? rule.stepFn : undefined)
    const resolvedOptions = Object.keys(stepParams).length === 0 ? undefined : stepParams
    const preview = this.previewStep(rule, resolvedOptions)

    if (fn == null) {
      throw new Error(`Flow step "${preview.id}" is missing a step function`)
    }

    return this.appendStep(new StepInfo(preview.id, rule, fn as StepInfo['fn'], preview.options))
  }

  /**
   * Adds a branch using `branch({ branches, init?, ...branchParams })`.
   *
   * Without `init`, every branch runs. With `init`, its result selects branches and can map their data and context.
   *
   * Branch parameters:
   *
   * - `branches`: child flows keyed by selectable branch values.
   * - `init`: optionally selects keys and maps data and context for the selected flows.
   * - `ruleId`: optional resolvable id stored on the branch result.
   * - `name`: display name, particularly for branches without a `ruleId`.
   * - `description`: human-readable branch description.
   * - `path`: base result path inherited by results inside the branches.
   * - `status`: remaps `fail` or `exception` branch results.
   *
   * Run every branch:
   *
   * ```ts
   * flow.branch({
   *   branches: {
   *     audit: auditFlow,
   *     notify: notificationFlow,
   *   },
   * })
   * ```
   *
   * Select one branch:
   *
   * ```ts
   * flow.branch({
   *   branches: {
   *     approve: approvalFlow,
   *     reject: rejectionFlow,
   *   },
   *   init: ({ data }) => data.route,
   * })
   * ```
   *
   * Select several branches:
   *
   * ```ts
   * flow.branch({
   *   branches: {
   *     audit: auditFlow,
   *     notify: notificationFlow,
   *   },
   *   init: () => ['audit', 'notify'],
   * })
   * ```
   *
   * Select a branch and map its input:
   *
   * ```ts
   * flow.branch({
   *   branches: {
   *     item: itemFlow,
   *   },
   *   init: ({ data, ctx }) => ({
   *     keys: 'item',
   *     data: data.item,
   *     ctx,
   *   }),
   * })
   * ```
   */
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
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
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
  ): Flow<RunData, StepId, SyncMode, RunCtx, StepData, StepCtx, FlowMapper, FlowResultMapper>
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
    flowOptions?: Omit<CreateFlowOptions<Data, string, SyncMode, undefined, Mapper, ResultMapper>, 'stepDefaults'> & {
      stepDefaults?: FlowOptionStepDefaults<Mapper, ResultMapper>
      step?: never
      branch?: never
    }
  ): FlowNoCtx<
    Data,
    string,
    SyncMode,
    MappedData<Mapper, Data, undefined>,
    MappedCtx<Mapper, Data, undefined>,
    Mapper,
    ResultMapper
  >
  <TRule extends AnyRule, Fn extends AnyFn = RuleFn<TRule>, Data extends object = Extract<StepInputData<Fn>, object>>(
    stepOptions: FactoryStepOptions<RuleAllowedInMode<TRule, SyncMode>, Data, SyncMode>,
    ...validation: FactoryStepValidation<Fn, SyncMode>
  ): FlowNoCtx<Data, string, SyncMode, Data, undefined, undefined, InitialFlowResultMapper<Data, SyncMode>>
  <TRule extends AnyRule, Fn extends AnyFn = RuleFn<TRule>, Data extends object = Extract<StepInputData<Fn>, object>>(
    stepOptions: FactoryStepOptions<FactoryRuleStepOptions<TRule, Fn, Data, SyncMode>, Data, SyncMode>,
    ...validation: FactoryStepValidation<Fn, SyncMode>
  ): FlowNoCtx<Data, string, SyncMode, Data, undefined, undefined, InitialFlowResultMapper<Data, SyncMode>>
  <
    Fn extends AnyFn,
    InitialId extends string | RuleIdWithoutFn = string,
    Data extends object = Extract<StepInputData<Fn>, object>,
  >(
    stepOptions: FactoryStepOptions<
      StepOptions<
        InitialId,
        Fn,
        undefined,
        StepOptionResultMap<InitialId, Data, undefined, RawStepFnResult, Data, undefined, string, SyncMode>
      >,
      Data,
      SyncMode
    >,
    ...validation: FactoryStepValidation<Fn, SyncMode>
  ): FlowNoCtx<Data, string, SyncMode, Data, undefined, undefined, InitialFlowResultMapper<Data, SyncMode>>
  <
    InitialId,
    Initializer extends AnyFn,
    Data extends object = StepInitializerData<Initializer>,
    Fn extends (
      data: MappedData<Initializer, Data, undefined>,
      params: { ctx: MappedCtx<Initializer, Data, undefined> }
    ) => any = ModeStepFn<SyncMode, MappedData<Initializer, Data, undefined>, MappedCtx<Initializer, Data, undefined>>,
  >(
    stepOptions: FactoryStepOptions<
      StepOptions<
        InitialId,
        Fn,
        Initializer,
        StepOptionResultMap<
          InitialId,
          MappedData<Initializer, Data, undefined>,
          MappedCtx<Initializer, Data, undefined>,
          RawStepFnResult,
          Data,
          undefined,
          string,
          SyncMode
        >
      >,
      Data,
      SyncMode
    >,
    ...validation: [
      ...FactoryInitializerValidation<InitialId, Initializer, Data, SyncMode>,
      ...FactoryStepValidation<Fn, SyncMode>,
    ]
  ): FlowNoCtx<Data, string, SyncMode, Data, undefined, undefined, InitialFlowResultMapper<Data, SyncMode>>
  <Data extends object = object>(
    branchOptions: FactoryBranchOptions<
      Record<PropertyKey, AnyNoCtxFlow>,
      ModeCallback<
        SyncMode,
        FlowBranchInitInput<string, Data, undefined, Data, undefined>,
        BranchInitResult<PropertyKey, object, unknown>
      >,
      CreateFlowOptions<Data, string, SyncMode>
    >
  ): FlowNoCtx<Data, string, SyncMode>
  <
    Initializer extends AnyFn,
    Data extends object = BranchInitializerData<Initializer>,
    SelectedData extends object = BranchInitializerMappedData<Initializer, Data>,
    SelectedCtx = BranchInitializerMappedCtx<Initializer, undefined>,
    TBranches extends Record<PropertyKey, CompatibleBranchFlow<SelectedData, SelectedCtx>> = Record<
      PropertyKey,
      CompatibleBranchFlow<SelectedData, SelectedCtx>
    >,
    SelectedKey extends keyof TBranches = keyof TBranches,
  >(
    branchOptions: FactoryBranchOptions<TBranches, Initializer, CreateFlowOptions<Data, string, SyncMode>>,
    ...validation: FactoryBranchInitializerValidation<
      Initializer,
      Data,
      SelectedKey,
      SelectedData,
      SelectedCtx,
      SyncMode
    >
  ): FlowNoCtx<Data, string, SyncMode>
  <
    Data extends object = object,
    SelectedKey extends PropertyKey = PropertyKey,
    SelectedCtx = undefined,
    TBranches extends BranchFlowMap<Data, SelectedCtx, SelectedKey> = BranchFlowMap<Data, SelectedCtx, SelectedKey>,
  >(
    branchOptions: FactoryBranchOptions<TBranches, undefined, CreateFlowOptions<Data, string, SyncMode>>
  ): FlowNoCtx<Data, string, SyncMode>
}
