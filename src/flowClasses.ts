export type MaybePromise<T> = T | Promise<T>
type AsyncMode = 'sync' | 'async'

export const stepStatuses = ['ok', 'skip', 'stop', 'error', 'exception'] as const

export type StepStatus = (typeof stepStatuses)[number]

export type StepOptionsStatusHandling = {
  error?: 'ignore' | 'exception'
  exception?: 'error'
}

export type StepInfoType<RawId = unknown> = {
  id: string
  rawId: RawId
  options?: StepOptions
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

export type StepMapInput<
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
> = StepMapInput<RawId, Data, Ctx, StateData, StateCtx, StateStepInfo, StateFlow> & {
  result: Result
}

export type BranchSelectInput<
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
> = (
  input: InvocationInput<Info, Data, Ctx, StateData, StateCtx, StateStepInfo, StateFlow>
) => MapResult<MappedData, MappedCtx>

export type StepMap<
  RawId = unknown,
  Data extends object = object,
  Ctx = unknown,
  MappedData extends object = object,
  MappedCtx = unknown,
  StateData extends object = Data,
  StateCtx = Ctx,
  StateStepInfo = StepInfoType<RawId>,
  StateFlow extends { steps: readonly StateStepInfo[] } = { steps: readonly StateStepInfo[] },
> = InvocationMap<StepInfoType<RawId>, Data, Ctx, MappedData, MappedCtx, StateData, StateCtx, StateStepInfo, StateFlow>

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
> = (input: StepResultMapInput<RawId, Data, Ctx, Result, StateData, StateCtx, StateStepInfo, StateFlow>) => MappedResult

export type StepOptions = {
  description?: string
  status?: StepOptionsStatusHandling
  map?: unknown
  mapResult?: unknown
}

export type StepFnResultRuleId = string | { id: string; description?: string }

export type BranchOptions = {
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

export type BranchSelectResult<Key extends PropertyKey = PropertyKey, Data extends object = object, Ctx = unknown> =
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
    readonly options?: StepOptions
  ) {}
}

export type FlowLike = {
  steps: readonly FlowStepInfo[]
  asyncMode: AsyncMode
  allowsContext: boolean
  name?: string
  description?: string
  map?: InvocationMap<any, any, any, any, any, any, any, any, any>
  mapResult?: StepResultMap<any, any, any, any, any, any, any, any, any>
  run(...args: any[]): MaybePromise<FlowResult>
}

export class StepBranchInfo {
  constructor(
    readonly id: string | undefined,
    readonly rawId: unknown,
    readonly select: (input: BranchSelectInput) => BranchSelectResult,
    readonly branches: Record<PropertyKey, FlowLike>,
    readonly options?: BranchOptions
  ) {}
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
