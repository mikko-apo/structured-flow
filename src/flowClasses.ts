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

export type StepOptions = {
  description?: string
  status?: StepOptionsStatusHandling
}

type BranchSelectFnReturnValue<Key extends PropertyKey> = Key | readonly Key[] | StepStatus

export class StepInfo<Id extends string = string, Ctx extends object = object, Result extends object = object> {
  constructor(
    readonly id: Id,
    readonly fn: (ctx: Expand<Ctx>) => MaybePromise<Result>,
    readonly options?: StepOptions
  ) {}
}

export type FlowLike = {
  steps: readonly FlowStepInfo[]
  asyncMode: AsyncMode
}

export class StepBranchInfo<
  Id extends string = string,
  Ctx extends object = object,
  SelectedKey extends PropertyKey = PropertyKey,
  TBranches extends Record<PropertyKey, FlowLike> = Record<PropertyKey, FlowLike>,
> {
  constructor(
    readonly id: Id,
    readonly select: (ctx: Expand<Ctx>) => BranchSelectFnReturnValue<SelectedKey>,
    readonly branches: TBranches,
    readonly options?: StepOptions
  ) {}
}

export type FlowStepInfo = StepInfo<any, any, any> | StepBranchInfo<any, any, any, any>

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
type StepPayloadOf<Result> =
  Awaited<Result> extends StepResult<infer Payload, any>
    ? Payload
    : Awaited<Result> extends object
      ? Omit<Awaited<Result>, 'status'>
      : StepFnPayload

type StepResultOf<TStep extends FlowStepInfo> = TStep extends StepInfo
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
