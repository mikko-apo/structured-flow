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
}

type AnyStepDefinition = StepDefinition<string, any, object, any, any>

// --- Helpers ---

type NoOverlap<New, Existing> = keyof New & keyof Existing extends never ? New : never

type NoReservedStepFields<T> = keyof T & ReservedStepField extends never ? T : never

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type StepAddedCtx<Result> = Omit<Extract<Result, { result?: 'ok' | 'stop' }>, ReservedStepField>

type Step<Steps extends readonly unknown[]> = Steps[number]

type StepId<CurrentStep> = CurrentStep extends { id: infer Id extends string } ? Id : never

type StepInfo<CurrentStep> = CurrentStep extends { fn: StepFn<any, any, infer Info> } ? Info : never

type StepAddToCtx<CurrentStep> = CurrentStep extends { fn: StepFn<any, infer AddCtx, any> } ? AddCtx : never

type StepDescriptionOf<CurrentStep> = CurrentStep extends { description: infer StepDescription } ? StepDescription : never

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

type StepIds<Steps extends readonly unknown[]> = StepId<Step<Steps>>

export function stepResult<AddCtx extends object, Info, const Result extends StepResult<AddCtx, Info>>(
  result: Result
): Result {
  return result
}

function canAddCtx<AddCtx extends object, Info>(
  result: StepStatus,
  res: StepResult<AddCtx, Info>
): res is StepCtxResult<AddCtx, Info> {
  return result === 'ok' || result === 'stop'
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
  const selection = normalizeBranchSelection(stepId, select(ctx))

  if (isStepStatus(selection)) {
    return {
      result: selection,
      branches: Object.entries(branches).map(([key, flow]) =>
        createSkippedBranchRun(key as BranchKey<TBranches>, flow, ctx)
      ),
    }
  }

  const selectedKeys = new Set<BranchKey<TBranches>>()
  const selectedBranchRuns = selection.map((key) => {
    assertValidBranchKey(stepId, key, branches)
    selectedKeys.add(key)

    const result = branches[key].run(ctx)

    return {
      key,
      result: getOverallFlowStatus(result),
      finalCtx: result.finalCtx,
      steps: result.steps.map(({ id, description }: FlowStepDefinition<StepDescription>) => ({
        id,
        description,
      })),
      stepResults: result.stepResults,
    } satisfies BranchRunResult<BranchKey<TBranches>, StepDescription>
  })
  const skippedBranchRuns = Object.entries(branches)
    .filter(([key]) => !selectedKeys.has(key as BranchKey<TBranches>))
    .map(([key, flow]) => createSkippedBranchRun(key as BranchKey<TBranches>, flow, ctx))
  const branchRuns = [...selectedBranchRuns, ...skippedBranchRuns]

  return {
    result: mergeStepStatuses(selectedBranchRuns.map((branch) => branch.result)),
    branches: branchRuns,
  }
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
  const selection = normalizeBranchSelection(stepId, select(ctx))

  if (isStepStatus(selection)) {
    return {
      result: selection,
      branches: Object.entries(branches).map(([key, flow]) =>
        createSkippedBranchRun(key as BranchKey<TBranches>, flow, ctx)
      ),
    }
  }

  const selectedKeys = new Set<BranchKey<TBranches>>()
  const selectedBranchRuns = await Promise.all(
    selection.map(async (key) => {
      assertValidBranchKey(stepId, key, branches)
      selectedKeys.add(key)

      const result = await branches[key].run(ctx)

      return {
        key,
        result: getOverallFlowStatus(result),
        finalCtx: result.finalCtx,
        steps: result.steps.map(({ id, description }: FlowStepDefinition<StepDescription>) => ({
          id,
          description,
        })),
        stepResults: result.stepResults,
      } satisfies BranchRunResult<BranchKey<TBranches>, StepDescription>
    })
  )
  const skippedBranchRuns = Object.entries(branches)
    .filter(([key]) => !selectedKeys.has(key as BranchKey<TBranches>))
    .map(([key, flow]) => createSkippedBranchRun(key as BranchKey<TBranches>, flow, ctx))
  const branchRuns = [...selectedBranchRuns, ...skippedBranchRuns]

  return {
    result: mergeStepStatuses(selectedBranchRuns.map((branch) => branch.result)),
    branches: branchRuns,
  }
}

// --- Result ---

export class FlowResult<Steps extends readonly AnyStepDefinition[], Ctx> {
  constructor(
    readonly steps: Steps,
    readonly ok: boolean,
    readonly stepResults: Array<StepResultEntry<Step<Steps>>>,
    readonly finalCtx: Expand<Ctx>
  ) {}

  failedStepIds(): StepIds<Steps>[] {
    return this.stepResults
      .filter((r) => r.result === 'error' || r.result === 'exception')
      .map((r) => r.id) as StepIds<Steps>[]
  }
}

export class EnrichedFlowResult<Steps extends readonly AnyStepDefinition[], Ctx> {
  constructor(
    readonly steps: Steps,
    readonly ok: boolean,
    readonly stepResults: Array<EnrichedStepResultEntry<Step<Steps>>>,
    readonly finalCtx: Expand<Ctx>
  ) {}

  failedStepIds(): StepIds<Steps>[] {
    return this.stepResults
      .filter((r) => r.result === 'error' || r.result === 'exception')
      .map((r) => r.id) as StepIds<Steps>[]
  }
}

function assertSameFlowSteps(
  flowSteps: readonly FlowStepDefinition<unknown>[],
  resultSteps: readonly FlowStepDefinition<unknown>[]
): void {
  if (
    flowSteps.length !== resultSteps.length ||
    flowSteps.some((step, index) => step.id !== resultSteps[index]?.id || step.description !== resultSteps[index]?.description)
  ) {
    throw new Error('Flow.enrichResult() received a result from a different flow')
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

function enrichBranchRuns(branches?: BranchRunResult<string, any>[]): EnrichedBranchRunResult<string, any>[] | undefined {
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
  mode: 'sync'
): FlowResult<Steps, Ctx>

function executeFlow<InitialCtx extends object, Ctx extends object, Steps extends readonly AnyStepDefinition[] = []>(
  steps: Steps,
  initial: InitialCtx,
  mode: 'async'
): Promise<FlowResult<Steps, Ctx>>

function executeFlow<InitialCtx extends object, Ctx extends object, Steps extends readonly AnyStepDefinition[] = []>(
  steps: Steps,
  initial: InitialCtx,
  mode: FlowMode
): unknown {
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
  Ctx extends object = InitialCtx,
  Steps extends readonly StepDefinition<any, any, any, any, StepDescription>[] = [],
  Mode extends FlowMode = FlowMode,
> {
  constructor(
    readonly steps: Steps,
    private readonly mode: Mode
  ) {}

  run(initial: InitialCtx): FlowRunResult<Mode, Steps, Ctx> {
    if (this.mode === 'sync') {
      return executeFlow<InitialCtx, Ctx, Steps>(this.steps, initial, 'sync') as FlowRunResult<Mode, Steps, Ctx>
    }

    return executeFlow<InitialCtx, Ctx, Steps>(this.steps, initial, 'async') as FlowRunResult<Mode, Steps, Ctx>
  }

  enrichResult(result: FlowResult<Steps, Ctx>): EnrichedFlowResult<Steps, Ctx> {
    assertSameFlowSteps(this.steps, result.steps)

    return new EnrichedFlowResult<Steps, Ctx>(
      result.steps,
      result.ok,
      enrichStepResults(result.steps, result.stepResults),
      result.finalCtx
    )
  }
}

// --- Builder (Ctx evolves directly) ---

class FlowBuilder<
  StepDescription = string,
  InitialCtx extends object = object,
  Ctx extends object = InitialCtx,
  Info = unknown,
  Steps extends readonly StepDefinition<any, any, any, any, StepDescription>[] = [],
  Mode extends FlowMode = FlowMode,
> {
  constructor(
    readonly steps: Steps,
    private readonly mode: Mode
  ) {}

  step<Id extends string, Result>(
    id: Id,
    stepDescription: StepDescription,
    fn: (ctx: Expand<Ctx>) => StepReturnByMode<Mode, Result, Info>
  ) {
    type AddCtx = NoOverlap<NoReservedStepFields<StepAddedCtx<ResolvedStepReturn<Mode, Result, Info>>>, Ctx>

    const newStep: StepDefinition<Id, Expand<Ctx>, AddCtx, Info, StepDescription> = {
      id,
      description: stepDescription,
      fn: fn as StepFn<Expand<Ctx>, AddCtx, Info>,
    }

    return new FlowBuilder<StepDescription, InitialCtx, Expand<Ctx & AddCtx>, Info, [...Steps, typeof newStep], Mode>(
      [...this.steps, newStep] as [...Steps, typeof newStep],
      this.mode
    )
  }

  branch<
    Id extends string,
    TBranches extends Mode extends 'sync'
      ? FlowBranchSources<Expand<Ctx>, StepDescription, FlowResult<any, any>>
      : FlowBranchSources<Expand<Ctx>, StepDescription>,
  >(
    id: Id,
    stepDescription: StepDescription,
    select: (ctx: Expand<Ctx>) => BranchSelection<BranchKey<TBranches>>,
    branches: TBranches
  ) {
    const selectBranches = select as (ctx: Expand<Ctx>) => BranchSelection<string>
    const normalizedBranches =
      this.mode === 'sync'
        ? normalizeFlowBranches(branches as FlowBranchSources<Expand<Ctx>, StepDescription, FlowResult<any, any>>)
        : normalizeFlowBranches(branches as FlowBranchSources<Expand<Ctx>, StepDescription>)
    const newStep: StepDefinition<Id, Expand<Ctx>, Record<never, never>, Info, StepDescription> = {
      id,
      description: stepDescription,
      fn:
        this.mode === 'sync'
          ? (ctx) =>
              runBranchSync(
                id,
                ctx,
                selectBranches,
                normalizedBranches as FlowBranches<Expand<Ctx>, StepDescription, FlowResult<any, any>>
              )
          : (ctx) => runBranchAsync(id, ctx, selectBranches, normalizedBranches as FlowBranches<Expand<Ctx>, StepDescription>),
    }

    return new FlowBuilder<StepDescription, InitialCtx, Ctx, Info, [...Steps, typeof newStep], Mode>(
      [...this.steps, newStep] as [...Steps, typeof newStep],
      this.mode
    )
  }

  build() {
    return new Flow<StepDescription, InitialCtx, Ctx, Steps, Mode>(this.steps, this.mode)
  }
}

export function createSyncFlow<InitialCtx extends object, Info = unknown>(): FlowBuilder<
  string,
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
  Info,
  [],
  'sync'
>
export function createSyncFlow<StepDescription = string, InitialCtx extends object = object, Info = unknown>() {
  return new FlowBuilder<StepDescription, InitialCtx, InitialCtx, Info, [], 'sync'>([], 'sync')
}

export function createAsyncFlow<InitialCtx extends object, Info = unknown>(): FlowBuilder<
  string,
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
  Info,
  [],
  'async'
>
export function createAsyncFlow<StepDescription = string, InitialCtx extends object = object, Info = unknown>() {
  return new FlowBuilder<StepDescription, InitialCtx, InitialCtx, Info, [], 'async'>([], 'async')
}
