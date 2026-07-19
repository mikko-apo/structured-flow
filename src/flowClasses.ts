export type MaybePromise<T> = T | Promise<T>
type AsyncMode = 'sync' | 'async'

export const stepStatuses = ['ok', 'skip', 'stop', 'error', 'exception'] as const

export type StepStatus = (typeof stepStatuses)[number]

export type StepOptionsStatusHandling = {
  error?: 'ignore' | 'exception'
  exception?: 'error'
}

export type AnyStepMap = (params: {
  id: unknown
  data: object
  ctx: unknown
  stepOptions?: StepOptions | BranchOptions
  params?: object
}) => object & { fnInput?: readonly [object, object] }

export type StepOptions = {
  description?: string
  status?: StepOptionsStatusHandling
  map?: unknown
}

export type StepFnResultRuleId = string | { id: string; description?: string }

export type BranchOptions = {
  ruleId?: StepFnResultRuleId
  name?: string
  description?: string
  path?: string
  status?: StepOptionsStatusHandling
  map?: unknown
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

type BranchSelectFnReturnValue = PropertyKey | readonly PropertyKey[] | StepStatus

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
  map?: AnyStepMap
  run(...args: [data: object] | [data: object, ctx: unknown]): MaybePromise<FlowResult>
}

export class StepBranchInfo {
  constructor(
    readonly id: string | undefined,
    readonly rawId: unknown,
    readonly select: (data: object, params: object) => BranchSelectFnReturnValue,
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
