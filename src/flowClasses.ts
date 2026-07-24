export type MaybePromise<T> = T | Promise<T>
type SyncValue<T> = T extends object ? T & { then?: never } : T
type MaybePromiseInMode<Async extends boolean, T> = Async extends true ? MaybePromise<T> : SyncValue<T>

export const stepStatuses = ['ok', 'skip', 'stop', 'fail', 'exception'] as const

export type StepStatus = (typeof stepStatuses)[number]

export type StepOptionsStatusHandling = {
  fail?: 'ignore' | 'exception'
  exception?: 'fail'
}

export type StepInfoType<RawId = unknown> = {
  id: string
  rawId: RawId
  options?: StepParams
}

export type BranchInfoType<RawId = unknown> = {
  id: string | undefined
  rawId: RawId
  options?: BranchOptions
}

export type ProcessingState<
  Data extends object = object,
  Ctx = unknown,
  StateStepInfo = unknown,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
> = {
  flow: StateFlow
  index: number
  stepResults: StepResult[]
  data: Data
  ctx: Ctx
  branchKey?: PropertyKey
}

export type MapResult<Data extends object = object, Ctx = unknown> = {
  data: Data
  ctx: Ctx
}

export type RawStepFnResult = StepFnResult | boolean | object

export type InvocationInput<
  Info,
  Data extends object = object,
  Ctx = unknown,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = Info,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
> = {
  stepInfo: Info
  processingState: ProcessingState<StateData, StateCtx, StateStepInfo, StateFlow>
  data: Data
  ctx: Ctx
}

export type StepInitInput<
  RawId = unknown,
  Data extends object = object,
  Ctx = unknown,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = StepInfoType<RawId>,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
> = InvocationInput<StepInfoType<RawId>, Data, Ctx, StateData, StateCtx, StateStepInfo, StateFlow>

export type StepResultMapInput<
  RawId = unknown,
  Data extends object = object,
  Ctx = unknown,
  Result = RawStepFnResult | undefined,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = StepInfoType<RawId>,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
> = StepInitInput<RawId, Data, Ctx, StateData, StateCtx, StateStepInfo, StateFlow> & {
  result: Result
}

export type BranchInitInput<
  RawId = unknown,
  Data extends object = object,
  Ctx = unknown,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = BranchInfoType<RawId>,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
> = InvocationInput<BranchInfoType<RawId>, Data, Ctx, StateData, StateCtx, StateStepInfo, StateFlow>

export type InvocationMap<
  Info,
  Data extends object = object,
  Ctx = unknown,
  MappedData extends object = object,
  MappedCtx = unknown,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = Info,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
  Async extends boolean = false,
> = (
  input: InvocationInput<Info, Data, Ctx, StateData, StateCtx, StateStepInfo, StateFlow>
) => MaybePromiseInMode<Async, MapResult<MappedData, MappedCtx>>

export type StepInit<
  RawId = unknown,
  Data extends object = object,
  Ctx = unknown,
  MappedData extends object = object,
  MappedCtx = unknown,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = StepInfoType<RawId>,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
  Async extends boolean = false,
> = InvocationMap<
  StepInfoType<RawId>,
  Data,
  Ctx,
  MappedData,
  MappedCtx,
  StateData,
  StateCtx,
  StateStepInfo,
  StateFlow,
  Async
>

export type StepResultMap<
  RawId = unknown,
  Data extends object = object,
  Ctx = unknown,
  Result = RawStepFnResult | undefined,
  MappedResult extends RawStepFnResult | undefined = RawStepFnResult | undefined,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = StepInfoType<RawId>,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
  Async extends boolean = false,
> = (
  input: StepResultMapInput<RawId, Data, Ctx, Result, StateData, StateCtx, StateStepInfo, StateFlow>
) => MaybePromiseInMode<Async, MappedResult>

type InitOption<Init> = unknown extends Init
  ? { init?: Init }
  : [Init] extends [undefined]
    ? { init?: undefined }
    : { init: Init }

export type StepParams<Init = unknown, ResultMapper = unknown> = {
  description?: string
  status?: StepOptionsStatusHandling
  trueIsFail?: boolean
  mapResult?: ResultMapper
} & InitOption<Init>

export type StepOptions<
  RuleType = unknown,
  Fn extends (...args: any[]) => any = (...args: any[]) => any,
  Init = unknown,
  ResultMapper = unknown,
> = StepParams<Init, ResultMapper> & {
  rule: RuleType
  fn: Fn
}

export type StepFnResultRuleId = string | { id: string; description?: string }

export type BranchOptions<
  Branches extends Record<PropertyKey, FlowLike> = Record<PropertyKey, FlowLike>,
  Init = (input: BranchInitInput) => MaybePromise<BranchInitResult>,
> = {
  branches: Branches
  init?: Init
  ruleId?: StepFnResultRuleId
  name?: string
  description?: string
  path?: string
  status?: StepOptionsStatusHandling
}

export type StepFnResultOptions = {
  ruleId?: StepFnResultRuleId
  path?: string
  message?: string
  variables?: Record<string, unknown>
  results?: StepFnResult[]
}

export class StepFnResult {
  readonly ruleId?: StepFnResultRuleId
  readonly path?: string
  readonly message?: string
  readonly variables: Record<string, unknown>
  results?: StepFnResult[]

  constructor(
    readonly status: StepStatus,
    params: StepFnResultOptions = {}
  ) {
    this.ruleId = params.ruleId
    this.path = params.path
    this.message = params.message
    this.variables = params.variables ?? {}
    this.results = params.results
  }

  addResult(result: StepFnResult): this
  addResult(ruleId: StepFnResultRuleId, result: StepFnResult): this
  addResult(ruleIdOrResult: StepFnResultRuleId | StepFnResult, maybeResult?: StepFnResult): this {
    const result =
      maybeResult === undefined
        ? (ruleIdOrResult as StepFnResult)
        : new StepFnResult(maybeResult.status, {
            ruleId: ruleIdOrResult as StepFnResultRuleId,
            path: maybeResult.path,
            message: maybeResult.message,
            variables: maybeResult.variables,
            results: maybeResult.results,
          })

    this.results = [...(this.results ?? []), result]
    return this
  }
}

export class RuleId<I = undefined> {
  declare private readonly __ruleIdBrand: I

  constructor(
    readonly id: string,
    readonly description?: string,
    readonly info?: I
  ) {}
}

export class Rule<
  RuleFnInputSignature extends (...args: any[]) => any = (...args: any[]) => any,
  RuleFnAsync extends boolean = boolean,
  I = undefined,
> extends RuleId<I> {
  declare readonly __ruleFnAsyncType__: RuleFnAsync

  constructor(
    id: string,
    readonly stepFn: RuleFnInputSignature,
    params: { path?: string; description?: string; info?: I } = {}
  ) {
    super(id, params.description, params.info)
    this.path = params.path
  }

  readonly path?: string
}

export type FlowResolver = (
  stepId: string | RuleId<any> | Rule<any, any, any>
) => string | RuleId<any> | { id: string; description?: string }

export type FlowStepOptions = {
  readonly resolver?: FlowResolver
  readonly map?: InvocationMap<any, any, any, any, any, any, any, any, any, true>
  readonly mapResult?: StepResultMap<any, any, any, any, any, any, any, any, any, true>
  readonly trueIsFail?: boolean
}

export type FlowOptions = {
  readonly syncMode: boolean
  readonly allowContext: boolean
  readonly stepDefaults: FlowStepOptions
  readonly name?: string
  readonly description?: string
}

export type BranchInitResult<Key extends PropertyKey = PropertyKey, Data extends object = object, Ctx = unknown> =
  | Key
  | readonly Key[]
  | StepStatus
  | StepFnResult
  | {
      keys?: Key | readonly Key[]
      data?: Data
      ctx?: Ctx
    }

export class StepInfo {
  constructor(
    readonly id: string,
    readonly rawId: unknown,
    readonly fn: (data: object, params: object) => MaybePromise<object | boolean>,
    readonly options?: StepParams
  ) {}
}

export type FlowLike = {
  steps: readonly FlowStepInfo[]
  options: FlowOptions
  run(...args: any[]): MaybePromise<FlowResult>
}

export class StepBranchInfo {
  constructor(
    readonly id: string | undefined,
    readonly rawId: unknown,
    readonly options: BranchOptions
  ) {
    this.branches = options.branches
    this.init = options.init ?? (() => Reflect.ownKeys(this.branches))
  }

  readonly init: (input: BranchInitInput) => MaybePromise<BranchInitResult>
  readonly branches: Record<PropertyKey, FlowLike>
}

export type FlowStepInfo = StepInfo | StepBranchInfo

export class StepResult {
  constructor(
    readonly stepInfo: FlowStepInfo,
    readonly status: StepStatus,
    readonly variables?: Record<string, unknown>,
    readonly selectedBranchKeys?: PropertyKey[],
    readonly branches?: BranchStepFlowResult[],
    readonly originalStatus?: StepStatus,
    readonly path?: string,
    readonly message?: string,
    readonly results?: StepFnResult[]
  ) {}
}

export class BranchStepFlowResult {
  constructor(
    readonly key: PropertyKey,
    readonly status: StepStatus,
    readonly stepResults: StepResult[]
  ) {}
}

export class FlowResult {
  constructor(
    readonly stepResults: StepResult[],
    readonly status: StepStatus
  ) {}
}
