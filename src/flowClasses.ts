export type MaybePromise<T> = T | Promise<T>
type AsyncMode = 'sync' | 'async'
export type StepFnPayload = Record<string, unknown>
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

export const stepStatuses = ['ok', 'skip', 'stop', 'error', 'exception'] as const

export type StepStatus = (typeof stepStatuses)[number]

export type StepOptionsStatusHandling = {
  error?: 'ignore' | 'exception'
  exception?: 'error'
}

export type AnyStepResolver = (params: { id: unknown; description?: string }) => {
  id: string
  description?: string
}

export type AnyStepMap = (params: {
  id: unknown
  data: object
  ctx: unknown
  stepOptions?: StepOptions
}) => object

export type StepOptions = {
  description?: string
  status?: StepOptionsStatusHandling
  resolver?: unknown
  map?: unknown
}

type BranchSelectFnReturnValue<Key extends PropertyKey> = Key | readonly Key[] | StepStatus

export class StepInfo<
  Id = string,
  Data extends object = object,
  Result extends object = object,
  Ctx = undefined,
> {
  constructor(
    readonly id: string,
    readonly rawId: Id,
    readonly fn: (data: Expand<Data>, ctx: Ctx) => MaybePromise<Result>,
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
}

export class StepBranchInfo<
  Id = string,
  Data extends object = object,
  SelectedKey extends PropertyKey = PropertyKey,
  Ctx = undefined,
  TBranches extends Record<PropertyKey, FlowLike> = Record<PropertyKey, FlowLike>,
> {
  constructor(
    readonly id: string,
    readonly rawId: Id,
    readonly select: (data: Expand<Data>, ctx: Ctx) => BranchSelectFnReturnValue<SelectedKey>,
    readonly branches: TBranches,
    readonly options?: StepOptions
  ) {}
}

export type FlowStepInfo = StepInfo<any, any, any, any> | StepBranchInfo<any, any, any, any, any>

export class StepResult<TResult extends object = StepFnPayload, TStepInfo extends FlowStepInfo = FlowStepInfo> {
  constructor(
    readonly stepInfo: TStepInfo,
    readonly status: StepStatus,
    readonly result?: TResult,
    readonly selectedBranchKeys?: PropertyKey[],
    readonly branches?: BranchStepFlowResult[],
    readonly originalStatus?: StepStatus
  ) {}
}

export class BranchStepFlowResult<TStepResult extends StepResult<any, any> = StepResult<any, any>> {
  constructor(
    readonly key: PropertyKey,
    readonly status: StepStatus,
    readonly stepResults: TStepResult[]
  ) {}
}

type Step<Steps extends readonly unknown[]> = Steps[number]
export type StepPayloadOf<Result> =
  Awaited<Result> extends StepResult<infer Payload, any>
    ? Payload
    : Awaited<Result> extends object
      ? Omit<Awaited<Result>, 'status'>
      : StepFnPayload

export type StepResultOf<TStep extends FlowStepInfo> = TStep extends StepInfo
  ? StepResult<StepPayloadOf<ReturnType<TStep['fn']>>, TStep>
  : TStep extends StepBranchInfo
    ? StepResult<StepFnPayload, TStep>
    : never

export class FlowResult<Steps extends readonly FlowStepInfo[]> {
  constructor(
    readonly stepResults: Array<StepResultOf<Step<Steps>>>,
    readonly status: StepStatus
  ) {}
}
