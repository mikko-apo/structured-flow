// --- Core Types ---

type MaybePromise<T> = T | Promise<T>
type FlowMode = 'sync' | 'async'
type ReservedStepField = 'result' | 'info' | 'branches'

export type FlowStepResult<Id extends string = string, Info = unknown, AddToCtx extends object = object> = {
  id: Id
  result: StepStatus
  info?: Info
  addToCtx?: AddToCtx
  branches?: BranchRunResult<string, any>[]
}

export type FlowStepDefinition<StepDefinition = string> = {
  id: string
  description: StepDefinition
  branches?: Record<string, FlowLike<any, StepDefinition, any>>
}

export type BranchRunResult<Key extends string = string, StepDefinition = string> = {
  key: Key
  result: StepStatus
  finalCtx: object
  steps: readonly FlowStepDefinition<StepDefinition>[]
  stepResults: Array<FlowStepResult>
}

export type EnrichedFlowStepResult<
  StepDefinition = string,
  Id extends string = string,
  Info = unknown,
  AddToCtx extends object = object,
> = Omit<FlowStepResult<Id, Info, AddToCtx>, 'branches'> & {
  description: StepDefinition
  branches?: EnrichedBranchRunResult<string, any>[]
}

export type EnrichedBranchRunResult<Key extends string = string, StepDefinition = string> = Omit<
  BranchRunResult<Key, StepDefinition>,
  'stepResults'
> & {
  stepResults: Array<EnrichedFlowStepResult<StepDefinition>>
}

export type FailedStepIdOptions = {
  branchPrefix?: boolean
}

type FlowRunResult<Mode extends FlowMode, Steps extends readonly AnyStepDefinition[], Ctx> = Mode extends 'sync'
  ? FlowResult<Steps, Ctx>
  : Promise<FlowResult<Steps, Ctx>>

// can be either Flow or
export type FlowLike<
  InitialCtx extends object,
  StepDefinition = string,
  Result extends MaybePromise<FlowResult<any, any>> = MaybePromise<FlowResult<any, any>>,
> = {
  steps: readonly FlowStepDefinition<StepDefinition>[]
  run(initial: InitialCtx): Result
}

type BuildableFlowLike<
  InitialCtx extends object,
  StepDefinition = string,
  Result extends MaybePromise<FlowResult<any, any>> = MaybePromise<FlowResult<any, any>>,
> = {
  steps: readonly FlowStepDefinition<StepDefinition>[]
  build(): FlowLike<InitialCtx, StepDefinition, Result>
}

type FlowBranchSource<
  InitialCtx extends object,
  StepDefinition = string,
  Result extends MaybePromise<FlowResult<any, any>> = MaybePromise<FlowResult<any, any>>,
> = FlowLike<InitialCtx, StepDefinition, Result> | BuildableFlowLike<InitialCtx, StepDefinition, Result>

type FlowBranches<
  InitialCtx extends object,
  StepDefinition = string,
  Result extends MaybePromise<FlowResult<any, any>> = MaybePromise<FlowResult<any, any>>,
> = Record<string, FlowLike<InitialCtx, StepDefinition, Result>>

type FlowBranchSources<
  InitialCtx extends object,
  StepDefinition = string,
  Result extends MaybePromise<FlowResult<any, any>> = MaybePromise<FlowResult<any, any>>,
> = Record<string, FlowBranchSource<InitialCtx, StepDefinition, Result>>

type BranchKey<TBranches> = Extract<keyof TBranches, string>

export type BranchSelection<Key extends string> = Key | readonly Key[] | StepStatus

type StepResult<AddCtx extends object, Info> = {
  info?: Info
  branches?: BranchRunResult<string, any>[]
} & (({ result?: 'ok' } & AddCtx) | ({ result: 'stop' } & AddCtx) | { result: 'skip' | 'exception' | 'error' })

export type StepStatus = NonNullable<StepResult<Record<never, never>, unknown>['result']>

type StepCtxResult<AddCtx extends object, Info> = Extract<StepResult<AddCtx, Info>, { result?: 'ok' | 'stop' }>

type StepFn<InputCtx, AddCtx extends object, Info> = (params: InputCtx) => MaybePromise<StepResult<AddCtx, Info>>

type SyncStepReturn<Result, Info> =
  Result extends Promise<any> ? never : Result extends StepResult<object, Info> ? Result : never

type AsyncStepReturn<Result, Info> = Awaited<Result> extends StepResult<object, Info> ? Result : never

type StepReturnByMode<Mode extends FlowMode, Result, Info> = Mode extends 'sync'
  ? SyncStepReturn<Result, Info>
  : AsyncStepReturn<Result, Info>

type ResolvedStepReturn<Mode extends FlowMode, Result, Info> = Mode extends 'sync'
  ? SyncStepReturn<Result, Info>
  : Awaited<AsyncStepReturn<Result, Info>>

type StepDefinition<Id extends string, InputCtx, AddCtx extends object, Info, StepDescription> = {
  id: Id
  description: StepDescription
  fn: StepFn<InputCtx, AddCtx, Info>
  branches?: Record<string, FlowLike<any, StepDescription, any>>
}

type AnyStepDefinition = StepDefinition<string, any, object, any, any>

// --- Helpers ---

type NoOverlap<New, Existing> = keyof New & keyof Existing extends never ? New : never

type NoReservedStepFields<T> = keyof T & ReservedStepField extends never ? T : never

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type StepContinueCtx<Result> = Omit<Extract<Result, { result?: 'ok' }>, ReservedStepField>
type StepFinalCtx<Result> = Omit<Extract<Result, { result?: 'ok' | 'stop' }>, ReservedStepField>

type Step<Steps extends readonly unknown[]> = Steps[number]

type StepInfo<CurrentStep> = CurrentStep extends { fn: StepFn<any, any, infer Info> } ? Info : never

type StepAddToCtx<CurrentStep> = CurrentStep extends { fn: StepFn<any, infer AddCtx, any> } ? AddCtx : never

type StepDescriptionOf<CurrentStep> = CurrentStep extends { description: infer StepDescription }
  ? StepDescription
  : never
type StepInputCtx<Fn> = Fn extends (ctx: infer Ctx) => any ? Ctx : never
type StepOutput<Fn> = Fn extends (...args: any[]) => infer Result ? Result : never
type NormalizeStepDescription<StepDescription> = StepDescription extends string ? string : StepDescription
type ValidateStepFn<Fn, ExpectedCtx extends object, Mode extends FlowMode, Info> = Fn extends (ctx: any) => any
  ? Expand<ExpectedCtx> extends StepInputCtx<Fn>
    ? StepReturnByMode<Mode, StepOutput<Fn>, Info> extends StepOutput<Fn>
      ? Fn
      : never
    : never
  : never

type StepResultEntry<CurrentStep extends { id: string }> = Pick<CurrentStep, 'id'> & {
  result: StepStatus
  info?: StepInfo<CurrentStep>
  addToCtx?: StepAddToCtx<CurrentStep>
  branches?: BranchRunResult<string, any>[]
}

type EnrichedStepResultEntry<CurrentStep extends { id: string; description: unknown }> = Omit<
  StepResultEntry<CurrentStep>,
  'branches'
> & {
  description: StepDescriptionOf<CurrentStep>
  branches?: EnrichedBranchRunResult<string, any>[]
}

export function stepResult<AddCtx extends object, Info, const Result extends StepResult<AddCtx, Info>>(
  result: Result
): Result {
  return result
}

function canAddCtx<AddCtx extends object, Info>(
  result: StepStatus,
  res: StepResult<AddCtx, Info>
): res is StepCtxResult<AddCtx, Info> {
  return res.result === undefined || result === 'ok' || result === 'stop'
}

const branchStatusPrecedence: Record<StepStatus, number> = {
  ok: 0,
  skip: 1,
  stop: 2,
  error: 3,
  exception: 4,
}

function isStepStatus(value: unknown): value is StepStatus {
  return value === 'ok' || value === 'skip' || value === 'stop' || value === 'error' || value === 'exception'
}

function getOverallFlowStatus(result: Pick<FlowResult<any, any>, 'ok' | 'stepResults'>): StepStatus {
  const finalStepResult = [...result.stepResults].reverse().find((stepResult) => stepResult.result !== 'skip')

  if (finalStepResult?.result === 'exception') {
    return 'exception'
  }

  if (!result.ok) {
    return 'error'
  }

  if (finalStepResult?.result === 'stop') {
    return 'stop'
  }

  if (finalStepResult?.result === 'skip') {
    return 'skip'
  }

  return 'ok'
}

function mergeStepStatuses(results: readonly StepStatus[]): StepStatus {
  if (results.length === 0) {
    return 'skip'
  }

  return results.reduce((selected, current) =>
    branchStatusPrecedence[current] > branchStatusPrecedence[selected] ? current : selected
  )
}

function assertValidBranchKey<TBranches extends FlowBranches<any, any, any>>(
  stepId: string,
  key: string,
  branches: TBranches
): asserts key is BranchKey<TBranches> {
  if (!(key in branches)) {
    throw new Error(`Flow branch "${stepId}" selected unknown flow key "${key}"`)
  }
}

function normalizeBranchSelection<Key extends string>(
  stepId: string,
  selection: BranchSelection<Key>
): readonly Key[] | StepStatus {
  if (Array.isArray(selection)) {
    if (selection.length === 0) {
      throw new Error(`Flow branch "${stepId}" selected no flow keys; return a step result instead`)
    }

    return selection
  }

  if (isStepStatus(selection)) {
    return selection
  }

  return [selection as Key]
}

function toFlowLike<InitialCtx extends object, StepDefinition, Result extends MaybePromise<FlowResult<any, any>>>(
  flow: FlowBranchSource<InitialCtx, StepDefinition, Result>
): FlowLike<InitialCtx, StepDefinition, Result> {
  return 'run' in flow ? flow : flow.build()
}

function normalizeFlowBranches<
  InitialCtx extends object,
  StepDefinition,
  Result extends MaybePromise<FlowResult<any, any>>,
  TBranches extends FlowBranchSources<InitialCtx, StepDefinition, Result>,
>(branches: TBranches): FlowBranches<InitialCtx, StepDefinition, Result> {
  return Object.fromEntries(Object.entries(branches).map(([key, flow]) => [key, toFlowLike(flow)])) as FlowBranches<
    InitialCtx,
    StepDefinition,
    Result
  >
}

function createSkippedBranchRun<Key extends string, Ctx extends object, StepDescription>(
  key: Key,
  flow: FlowLike<Ctx, StepDescription, any>,
  ctx: Ctx
): BranchRunResult<Key, StepDescription> {
  return {
    key,
    result: 'skip',
    finalCtx: ctx,
    steps: flow.steps.map(({ id, description }) => ({ id, description })),
    stepResults: flow.steps.map(({ id }) => ({
      id,
      result: 'skip',
    })),
  }
}

function createBranchRunResult<Key extends string, StepDescription>(
  key: Key,
  result: FlowResult<any, any>
): BranchRunResult<Key, StepDescription> {
  return {
    key,
    result: getOverallFlowStatus(result),
    finalCtx: result.finalCtx,
    steps: result.steps.map(({ id, description }: FlowStepDefinition<StepDescription>) => ({
      id,
      description,
    })),
    stepResults: result.stepResults,
  }
}

function runBranch<Ctx extends object, StepDescription>(
  mode: FlowMode,
  stepId: string,
  ctx: Ctx,
  select: (ctx: Ctx) => BranchSelection<string>,
  branches: FlowBranches<Ctx, StepDescription>
): MaybePromise<StepResult<Record<never, never>, never>> {
  const selection = normalizeBranchSelection(stepId, select(ctx))

  if (isStepStatus(selection)) {
    const skippedBranches = Object.entries(branches).map(([key, flow]) =>
      createSkippedBranchRun(key, flow as FlowLike<Ctx, StepDescription, any>, ctx)
    )

    return mode === 'sync'
      ? {
          result: selection,
          branches: skippedBranches,
        }
      : Promise.resolve({
          result: selection,
          branches: skippedBranches,
        })
  }

  const createBranchResult = (selectedBranchRuns: BranchRunResult<string, StepDescription>[]) => {
    const skippedBranchRuns = Object.entries(branches)
      .filter(([key]) => !selectedKeys.has(key))
      .map(([key, flow]) => createSkippedBranchRun(key, flow as FlowLike<Ctx, StepDescription, any>, ctx))
    const branchRuns = [...selectedBranchRuns, ...skippedBranchRuns]

    return {
      result: mergeStepStatuses(selectedBranchRuns.map((branch) => branch.result)),
      branches: branchRuns,
    }
  }

  const selectedKeys = new Set<string>()

  if (mode === 'sync') {
    const selectedBranchRuns = selection.map((key) => {
      assertValidBranchKey(stepId, key, branches)
      selectedKeys.add(key)

      return createBranchRunResult<string, StepDescription>(key, branches[key].run(ctx) as FlowResult<any, any>)
    })

    return createBranchResult(selectedBranchRuns)
  }

  return Promise.all(
    selection.map(async (key) => {
      assertValidBranchKey(stepId, key, branches)
      selectedKeys.add(key)

      return createBranchRunResult<string, StepDescription>(key, await branches[key].run(ctx))
    })
  ).then((selectedBranchRuns) => createBranchResult(selectedBranchRuns))
}

function runBranchSync<
  Ctx extends object,
  StepDescription,
  TBranches extends FlowBranches<Ctx, StepDescription, FlowResult<any, any>>,
>(
  stepId: string,
  ctx: Ctx,
  select: (ctx: Ctx) => BranchSelection<BranchKey<TBranches>>,
  branches: TBranches
): StepResult<Record<never, never>, never> {
  return runBranch('sync', stepId, ctx, select as (ctx: Ctx) => BranchSelection<string>, branches) as StepResult<
    Record<never, never>,
    never
  >
}

async function runBranchAsync<
  Ctx extends object,
  StepDescription,
  TBranches extends FlowBranches<Ctx, StepDescription>,
>(
  stepId: string,
  ctx: Ctx,
  select: (ctx: Ctx) => BranchSelection<BranchKey<TBranches>>,
  branches: TBranches
): Promise<StepResult<Record<never, never>, never>> {
  return runBranch('async', stepId, ctx, select as (ctx: Ctx) => BranchSelection<string>, branches) as Promise<
    StepResult<Record<never, never>, never>
  >
}

function collectFailedStepIds(
  stepResults: readonly { id: string; result: StepStatus; branches?: BranchRunResult<string, any>[] }[],
  options: FailedStepIdOptions = {},
  branchPath: string[] = []
): string[] {
  return stepResults.flatMap((stepResult) => {
    const ownIds =
      stepResult.result === 'error' || stepResult.result === 'exception'
        ? [options.branchPrefix && branchPath.length > 0 ? [...branchPath, stepResult.id].join('/') : stepResult.id]
        : []
    const branchIds =
      stepResult.branches?.flatMap((branch) =>
        collectFailedStepIds(branch.stepResults, options, [...branchPath, stepResult.id])
      ) ?? []

    return [...ownIds, ...branchIds]
  })
}

// --- Result ---

export class FlowResult<Steps extends readonly AnyStepDefinition[], Ctx> {
  constructor(
    readonly steps: Steps,
    readonly ok: boolean,
    readonly stepResults: Array<StepResultEntry<Step<Steps>>>,
    readonly finalCtx: Expand<Ctx>
  ) {}

  failedStepIds(options?: FailedStepIdOptions): string[] {
    return collectFailedStepIds(this.stepResults, options)
  }

  enrichResult(): EnrichedFlowResult<Steps, Ctx> {
    return new EnrichedFlowResult<Steps, Ctx>(
      this.steps,
      this.ok,
      enrichStepResults(this.steps, this.stepResults),
      this.finalCtx
    )
  }
}

export class EnrichedFlowResult<Steps extends readonly AnyStepDefinition[], Ctx> {
  constructor(
    readonly steps: Steps,
    readonly ok: boolean,
    readonly stepResults: Array<EnrichedStepResultEntry<Step<Steps>>>,
    readonly finalCtx: Expand<Ctx>
  ) {}

  failedStepIds(options?: FailedStepIdOptions): string[] {
    return collectFailedStepIds(this.stepResults, options)
  }
}

function getStepDescriptionOrThrow<StepDescription>(
  steps: readonly FlowStepDefinition<StepDescription>[],
  stepId: string
): StepDescription {
  const step = steps.find((candidate) => candidate.id === stepId)

  if (step == null) {
    throw new Error(`Flow result referenced unknown step "${stepId}"`)
  }

  return step.description
}

function enrichBranchRuns(
  branches?: BranchRunResult<string, any>[]
): EnrichedBranchRunResult<string, any>[] | undefined {
  return branches?.map((branch) => ({
    key: branch.key,
    result: branch.result,
    finalCtx: branch.finalCtx,
    steps: branch.steps,
    stepResults: branch.stepResults.map((stepResult) => ({
      id: stepResult.id,
      result: stepResult.result,
      description: getStepDescriptionOrThrow(branch.steps, stepResult.id),
      ...(stepResult.info === undefined ? {} : { info: stepResult.info }),
      ...(stepResult.addToCtx === undefined ? {} : { addToCtx: stepResult.addToCtx }),
      ...(stepResult.branches == null ? {} : { branches: enrichBranchRuns(stepResult.branches) }),
    })),
  }))
}

function enrichStepResults<Steps extends readonly AnyStepDefinition[]>(
  steps: Steps,
  stepResults: Array<StepResultEntry<Step<Steps>>>
): Array<EnrichedStepResultEntry<Step<Steps>>> {
  return stepResults.map((stepResult) => ({
    id: stepResult.id,
    result: stepResult.result,
    description: getStepDescriptionOrThrow(steps, stepResult.id) as StepDescriptionOf<Step<Steps>>,
    ...(stepResult.info === undefined ? {} : { info: stepResult.info }),
    ...(stepResult.addToCtx === undefined ? {} : { addToCtx: stepResult.addToCtx }),
    ...(stepResult.branches == null ? {} : { branches: enrichBranchRuns(stepResult.branches) }),
  }))
}

function isPromise<T>(v: object): v is Promise<T> {
  return v && 'then' in v && typeof v.then === 'function'
}

function executeFlow<InitialCtx extends object, Ctx extends object, Steps extends readonly AnyStepDefinition[] = []>(
  steps: Steps,
  initial: InitialCtx,
  mode: FlowMode
): MaybePromise<FlowResult<Steps, Ctx>> {
  let ctx: Expand<Ctx> = { ...initial } as unknown as Expand<Ctx>
  const results: FlowResult<Steps, Ctx>['stepResults'] = []
  let hasFailure = false

  const getAddToCtx = <AddCtx extends object>(res: StepCtxResult<AddCtx, unknown>) =>
    Object.fromEntries(
      Object.entries(res).filter(([key]) => key !== 'result' && key !== 'info' && key !== 'branches')
    ) as AddCtx

  const addCtx = <AddCtx extends object>(addToCtx: AddCtx, stepId: string) => {
    const nextEntries = Object.entries(addToCtx)

    for (const [key] of nextEntries) {
      if (key in ctx) {
        throw new Error(`Flow step "${stepId}" attempted to overwrite "${key}"`)
      }
    }

    if (nextEntries.length === 0) {
      return
    }

    ctx = {
      ...ctx,
      ...Object.fromEntries(nextEntries),
    }
  }

  const recordStepResult = <AddCtx extends object>(
    step: Step<Steps>,
    result: StepStatus,
    res: StepResult<AddCtx, unknown>
  ) => {
    if (canAddCtx(result, res)) {
      const addToCtx = getAddToCtx(res)

      if (Object.keys(addToCtx).length > 0) {
        addCtx(addToCtx, step.id)
      }
    }

    const ok = result !== 'error' && result !== 'exception'
    if (!ok) {
      hasFailure = true
    }

    const recordedResult = {
      id: step.id,
      result,
    } as FlowResult<Steps, Ctx>['stepResults'][number]

    if (res.info !== undefined) {
      recordedResult.info = res.info as StepInfo<Step<Steps>>
    }

    if (canAddCtx(result, res)) {
      const addToCtx = getAddToCtx(res)

      if (Object.keys(addToCtx).length > 0) {
        recordedResult.addToCtx = addToCtx as unknown as StepAddToCtx<Step<Steps>>
      }
    }

    if (res.branches !== undefined) {
      recordedResult.branches = res.branches
    }

    results.push(recordedResult)
  }

  const finalize = () => new FlowResult<Steps, Ctx>(steps, !hasFailure, results, ctx)

  const recordSkippedRemainingSteps = (startIndex: number) => {
    for (let index = startIndex; index < steps.length; index++) {
      recordStepResult(steps[index], 'skip', {})
    }
  }

  const handleStepResult = <AddCtx extends object>(step: Step<Steps>, res: StepResult<AddCtx, unknown>) => {
    const result: StepStatus = res.result ?? 'ok'

    recordStepResult(step, result, res)
    switch (result) {
      case 'ok':
        return false
      case 'skip':
        return false
      case 'stop':
        return true
      case 'error':
        return false
      case 'exception':
        return true
    }
  }

  if (mode === 'sync') {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]
      try {
        const res = step.fn(ctx)

        if (isPromise(res)) {
          throw new Error(`Flow step "${step.id}" returned a Promise in sync build()`)
        }

        if (handleStepResult(step, res)) {
          recordSkippedRemainingSteps(index + 1)
          break
        }
      } catch {
        recordStepResult(step, 'exception', { result: 'exception' })
        recordSkippedRemainingSteps(index + 1)
        break
      }
    }

    return finalize()
  }

  return (async () => {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]
      try {
        const res = await step.fn(ctx)

        if (handleStepResult(step, res)) {
          recordSkippedRemainingSteps(index + 1)
          break
        }
      } catch {
        recordStepResult(step, 'exception', { result: 'exception' })
        recordSkippedRemainingSteps(index + 1)
        break
      }
    }

    return finalize()
  })()
}

class Flow<
  StepDescription = string,
  InitialCtx extends object = object,
  FinalCtx extends object = InitialCtx,
  Steps extends readonly StepDefinition<any, any, any, any, StepDescription>[] = [],
  Mode extends FlowMode = FlowMode,
> {
  constructor(
    readonly steps: Steps,
    private readonly mode: Mode
  ) {}

  run(initial: InitialCtx): FlowRunResult<Mode, Steps, FinalCtx> {
    if (this.mode === 'sync') {
      return executeFlow<InitialCtx, FinalCtx, Steps>(this.steps, initial, 'sync') as FlowRunResult<
        Mode,
        Steps,
        FinalCtx
      >
    }

    return executeFlow<InitialCtx, FinalCtx, Steps>(this.steps, initial, 'async') as FlowRunResult<
      Mode,
      Steps,
      FinalCtx
    >
  }
}

// --- Builder (Ctx evolves directly) ---

class FlowBuilder<
  StepDescription = string,
  InitialCtx extends object = object,
  NextStepCtx extends object = InitialCtx,
  FinalCtx extends object = InitialCtx,
  Info = unknown,
  Steps extends readonly StepDefinition<any, any, any, any, StepDescription>[] = [],
  Mode extends FlowMode = FlowMode,
> {
  constructor(
    readonly steps: Steps,
    private readonly mode: Mode
  ) {}

  step<Id extends string, Fn extends (ctx: any) => any, Result = StepOutput<Fn>>(
    id: Id,
    stepDescription: StepDescription,
    fn: ValidateStepFn<Fn, NextStepCtx, Mode, Info>
  ) {
    type ContinueCtx = NoOverlap<
      NoReservedStepFields<StepContinueCtx<ResolvedStepReturn<Mode, Result, Info>>>,
      NextStepCtx
    >
    type AddCtx = NoOverlap<NoReservedStepFields<StepFinalCtx<ResolvedStepReturn<Mode, Result, Info>>>, FinalCtx>

    const newStep: StepDefinition<Id, Expand<NextStepCtx>, AddCtx, Info, StepDescription> = {
      id,
      description: stepDescription,
      fn: fn as StepFn<Expand<NextStepCtx>, AddCtx, Info>,
    }

    return new FlowBuilder<
      StepDescription,
      InitialCtx,
      Expand<NextStepCtx & ContinueCtx>,
      Expand<FinalCtx & AddCtx>,
      Info,
      [...Steps, typeof newStep],
      Mode
    >(
      [...this.steps, newStep] as [...Steps, typeof newStep],
      this.mode
    )
  }

  branch<
    Id extends string,
    TBranches extends Mode extends 'sync'
      ? FlowBranchSources<Expand<NextStepCtx>, StepDescription, FlowResult<any, any>>
      : FlowBranchSources<Expand<NextStepCtx>, StepDescription>,
  >(
    id: Id,
    stepDescription: StepDescription,
    select: (ctx: Expand<NextStepCtx>) => BranchSelection<BranchKey<TBranches>>,
    branches: TBranches
  ) {
    const selectBranches = select as (ctx: Expand<NextStepCtx>) => BranchSelection<string>
    const normalizedBranches =
      this.mode === 'sync'
        ? normalizeFlowBranches(
            branches as FlowBranchSources<Expand<NextStepCtx>, StepDescription, FlowResult<any, any>>
          )
        : normalizeFlowBranches(branches as FlowBranchSources<Expand<NextStepCtx>, StepDescription>)
    const newStep: StepDefinition<Id, Expand<NextStepCtx>, Record<never, never>, Info, StepDescription> = {
      id,
      description: stepDescription,
      branches: normalizedBranches as Record<string, FlowLike<any, StepDescription, any>>,
      fn:
        this.mode === 'sync'
          ? (ctx) =>
              runBranchSync(
                id,
                ctx,
                selectBranches,
                normalizedBranches as FlowBranches<Expand<NextStepCtx>, StepDescription, FlowResult<any, any>>
              )
          : (ctx) =>
              runBranchAsync(
                id,
                ctx,
                selectBranches,
                normalizedBranches as FlowBranches<Expand<NextStepCtx>, StepDescription>
              ),
    }

    return new FlowBuilder<
      StepDescription,
      InitialCtx,
      NextStepCtx,
      FinalCtx,
      Info,
      [...Steps, typeof newStep],
      Mode
    >(
      [...this.steps, newStep] as [...Steps, typeof newStep],
      this.mode
    )
  }

  build() {
    return new Flow<StepDescription, InitialCtx, FinalCtx, Steps, Mode>(this.steps, this.mode)
  }
}

type FirstStepDefinition<
  StepDescription,
  InitialCtx extends object,
  Info,
  Id extends string,
  AddCtx extends object,
> = StepDefinition<Id, Expand<InitialCtx>, AddCtx, Info, StepDescription>

type FirstBranchDefinition<StepDescription, InitialCtx extends object, Info, Id extends string> = StepDefinition<
  Id,
  Expand<InitialCtx>,
  Record<never, never>,
  Info,
  StepDescription
>

type FlowBuilderAfterFirstStep<
  Mode extends FlowMode,
  StepDescription,
  InitialCtx extends object,
  Info,
  Id extends string,
  ContinueCtx extends object,
  AddCtx extends object,
> = FlowBuilder<
  NormalizeStepDescription<StepDescription>,
  InitialCtx,
  Expand<InitialCtx & ContinueCtx>,
  Expand<InitialCtx & AddCtx>,
  Info,
  [FirstStepDefinition<NormalizeStepDescription<StepDescription>, InitialCtx, Info, Id, AddCtx>],
  Mode
>

type SelectCtx<Fn> = Fn extends (ctx: infer Ctx) => any ? Ctx : never

type FlowBuilderAfterFirstBranch<
  Mode extends FlowMode,
  StepDescription,
  InitialCtx extends object,
  Info,
  Id extends string,
> = FlowBuilder<
  NormalizeStepDescription<StepDescription>,
  InitialCtx,
  InitialCtx,
  InitialCtx,
  Info,
  [FirstBranchDefinition<NormalizeStepDescription<StepDescription>, InitialCtx, Info, Id>],
  Mode
>

type CreateFlowArgs =
  | []
  | [string, unknown, (...args: any[]) => any]
  | [string, unknown, (...args: any[]) => any, Record<string, any>]

function createFlow<Mode extends FlowMode>(mode: Mode, ...args: CreateFlowArgs) {
  const builder = new FlowBuilder<any, any, any, any, any, [], Mode>([], mode)

  if (args.length === 0) {
    return builder
  }

  if (args.length === 3) {
    return builder.step(args[0], args[1], args[2])
  }

  if (args.length === 4) {
    return builder.branch(args[0], args[1], args[2], args[3])
  }

  throw new Error('createFlow() expects 0, 3, or 4 arguments')
}

export function createSyncFlow<InitialCtx extends object, Info = unknown>(): FlowBuilder<
  string,
  InitialCtx,
  InitialCtx,
  InitialCtx,
  Info,
  [],
  'sync'
>
export function createSyncFlow<StepDescription, InitialCtx extends object, Info = unknown>(): FlowBuilder<
  StepDescription,
  InitialCtx,
  InitialCtx,
  InitialCtx,
  Info,
  [],
  'sync'
>
export function createSyncFlow<
  const StepDescription = string,
  Info = unknown,
  Fn extends (ctx: any) => any = (ctx: any) => StepResult<object, Info>,
  Id extends string = string,
>(
  id: Id,
  stepDescription: StepDescription,
  fn: ValidateStepFn<Fn, StepInputCtx<Fn>, 'sync', Info>
): FlowBuilderAfterFirstStep<
  'sync',
  StepDescription,
  Expand<StepInputCtx<Fn>>,
  Info,
  Id,
  NoOverlap<
    NoReservedStepFields<StepContinueCtx<ResolvedStepReturn<'sync', ReturnType<Fn>, Info>>>,
    Expand<StepInputCtx<Fn>>
  >,
  NoOverlap<
    NoReservedStepFields<StepFinalCtx<ResolvedStepReturn<'sync', ReturnType<Fn>, Info>>>,
    Expand<StepInputCtx<Fn>>
  >
>
export function createSyncFlow<
  const StepDescription = string,
  Info = unknown,
  Id extends string = string,
  Select extends (ctx: any) => BranchSelection<any> = (ctx: any) => BranchSelection<string>,
  TBranches extends FlowBranchSources<
    Expand<SelectCtx<Select>>,
    NormalizeStepDescription<StepDescription>,
    FlowResult<any, any>
  > = FlowBranchSources<Expand<SelectCtx<Select>>, NormalizeStepDescription<StepDescription>, FlowResult<any, any>>,
>(
  id: Id,
  stepDescription: StepDescription,
  select: Select,
  branches: TBranches
): FlowBuilderAfterFirstBranch<'sync', NormalizeStepDescription<StepDescription>, Expand<SelectCtx<Select>>, Info, Id>
export function createSyncFlow(...args: CreateFlowArgs) {
  return createFlow('sync', ...args)
}

export function createAsyncFlow<InitialCtx extends object, Info = unknown>(): FlowBuilder<
  string,
  InitialCtx,
  InitialCtx,
  InitialCtx,
  Info,
  [],
  'async'
>
export function createAsyncFlow<StepDescription, InitialCtx extends object, Info = unknown>(): FlowBuilder<
  StepDescription,
  InitialCtx,
  InitialCtx,
  InitialCtx,
  Info,
  [],
  'async'
>
export function createAsyncFlow<
  const StepDescription = string,
  Info = unknown,
  Fn extends (ctx: any) => any = (ctx: any) => MaybePromise<StepResult<object, Info>>,
  Id extends string = string,
>(
  id: Id,
  stepDescription: StepDescription,
  fn: ValidateStepFn<Fn, StepInputCtx<Fn>, 'async', Info>
): FlowBuilderAfterFirstStep<
  'async',
  StepDescription,
  Expand<StepInputCtx<Fn>>,
  Info,
  Id,
  NoOverlap<
    NoReservedStepFields<StepContinueCtx<ResolvedStepReturn<'async', ReturnType<Fn>, Info>>>,
    Expand<StepInputCtx<Fn>>
  >,
  NoOverlap<
    NoReservedStepFields<StepFinalCtx<ResolvedStepReturn<'async', ReturnType<Fn>, Info>>>,
    Expand<StepInputCtx<Fn>>
  >
>
export function createAsyncFlow<
  const StepDescription = string,
  Info = unknown,
  Id extends string = string,
  Select extends (ctx: any) => BranchSelection<any> = (ctx: any) => BranchSelection<string>,
  TBranches extends FlowBranchSources<Expand<SelectCtx<Select>>, NormalizeStepDescription<StepDescription>> =
    FlowBranchSources<Expand<SelectCtx<Select>>, NormalizeStepDescription<StepDescription>>,
>(
  id: Id,
  stepDescription: StepDescription,
  select: Select,
  branches: TBranches
): FlowBuilderAfterFirstBranch<'async', NormalizeStepDescription<StepDescription>, Expand<SelectCtx<Select>>, Info, Id>
export function createAsyncFlow(...args: CreateFlowArgs) {
  return createFlow('async', ...args)
}
