// --- Core Types ---

type MaybePromise<T> = T | Promise<T>

type ReservedStepField = 'result' | 'info'

type StepResult<AddCtx extends object, Info> =
  | ({ result?: 'ok'; info?: Info } & AddCtx)
  | ({ result: 'stop'; info?: Info } & AddCtx)
  | {
      result: 'skip' | 'exception' | 'error'
      info?: Info
    }

export type StepStatus = NonNullable<StepResult<Record<never, never>, unknown>['result']>

type StepCtxResult<AddCtx extends object, Info> = Extract<StepResult<AddCtx, Info>, { result?: 'ok' | 'stop' }>

type StepFn<InputCtx, AddCtx extends object, Info> = (params: InputCtx) => MaybePromise<StepResult<AddCtx, Info>>
type SyncStepReturn<Result, Info> =
  Result extends Promise<any> ? never : Result extends StepResult<object, Info> ? Result : never

type AsyncStepReturn<Result, Info> = Awaited<Result> extends StepResult<object, Info> ? Result : never

type StepDefinition<Id extends string, InputCtx, AddCtx extends object, Info> = {
  id: Id
  description: string
  fn: StepFn<InputCtx, AddCtx, Info>
}

// --- Helpers ---

type NoOverlap<New, Existing> = keyof New & keyof Existing extends never ? New : never

type NoReservedStepFields<T> = keyof T & ReservedStepField extends never ? T : never

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never

type StepAddedCtx<Result> = Omit<Extract<Result, { result?: 'ok' | 'stop' }>, ReservedStepField>

type Step<Steps extends readonly unknown[]> = Steps[number]

type StepId<CurrentStep> = CurrentStep extends { id: infer Id extends string } ? Id : never

type StepInfo<CurrentStep> = CurrentStep extends { fn: StepFn<any, any, infer Info> } ? Info : never

type StepResultEntry<CurrentStep extends { id: string }> = Pick<CurrentStep, 'id'> & {
  result: StepStatus
  info?: StepInfo<CurrentStep>
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

// --- Result ---

export class FlowResult<Steps extends readonly StepDefinition<any, any, any, any>[], Ctx> {
  constructor(
    readonly steps: Steps,
    readonly ok: boolean,
    readonly stepResults: Array<StepResultEntry<Step<Steps>>>,
    readonly ctx: Expand<Ctx>
  ) {}

  failedStepIds(): StepIds<Steps>[] {
    return this.stepResults.filter((r) => r.result === 'error' || r.result === 'exception').map((r) => r.id)
  }
}

function isPromise<T>(v: object): v is Promise<T> {
  return v && 'then' in v && typeof v.then === 'function'
}

function executeFlow<
  InitialCtx extends object,
  Ctx extends object,
  Steps extends readonly StepDefinition<any, any, any, any>[] = [],
>(steps: Steps, initial: InitialCtx, mode: 'sync'): FlowResult<Steps, Ctx>

function executeFlow<
  InitialCtx extends object,
  Ctx extends object,
  Steps extends readonly StepDefinition<any, any, any, any>[] = [],
>(steps: Steps, initial: InitialCtx, mode: 'async'): Promise<FlowResult<Steps, Ctx>>

function executeFlow<
  InitialCtx extends object,
  Ctx extends object,
  Steps extends readonly StepDefinition<any, any, any, any>[] = [],
>(steps: Steps, initial: InitialCtx, mode: 'sync' | 'async'): unknown {
  let ctx: Expand<Ctx> = { ...initial } as unknown as Expand<Ctx>
  const results: FlowResult<Steps, Ctx>['stepResults'] = []
  let hasFailure = false

  const addCtx = <AddCtx extends object>(res: StepCtxResult<AddCtx, unknown>, stepId: StepIds<Steps>) => {
    const nextEntries = Object.entries(res).filter(([key]) => key !== 'result' && key !== 'info')

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
      addCtx(res, step.id)
    }

    const ok = result !== 'error' && result !== 'exception'
    if (!ok) {
      hasFailure = true
    }

    const recordedResult = {
      id: step.id,
      result,
      info: res.info,
    } as FlowResult<Steps, Ctx>['stepResults'][number]

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

export class Flow<
  InitialCtx extends object,
  Ctx extends object,
  Steps extends readonly StepDefinition<any, any, any, any>[] = [],
> {
  constructor(readonly steps: Steps) {}

  run(initial: InitialCtx) {
    return executeFlow<InitialCtx, Ctx, Steps>(this.steps, initial, 'sync')
  }
}

export class AsyncFlow<
  InitialCtx extends object,
  Ctx extends object,
  Steps extends readonly StepDefinition<any, any, any, any>[] = [],
> {
  constructor(readonly steps: Steps) {}

  run(initial: InitialCtx) {
    return executeFlow<InitialCtx, Ctx, Steps>(this.steps, initial, 'async')
  }
}

// --- Builder (Ctx evolves directly) ---

export class FlowBuilder<
  InitialCtx extends object,
  Ctx extends object,
  Info = unknown,
  Steps extends readonly StepDefinition<any, any, any, any>[] = [],
> {
  constructor(readonly steps: Steps) {}

  step<Id extends string, Result>(id: Id, description: string, fn: (ctx: Expand<Ctx>) => SyncStepReturn<Result, Info>) {
    type AddCtx = NoOverlap<NoReservedStepFields<StepAddedCtx<SyncStepReturn<Result, Info>>>, Ctx>

    const newStep: StepDefinition<Id, Expand<Ctx>, AddCtx, Info> = {
      id,
      description,
      fn: fn as StepFn<Expand<Ctx>, AddCtx, Info>,
    }

    return new FlowBuilder<InitialCtx, Expand<Ctx & AddCtx>, Info, [...Steps, typeof newStep]>([
      ...this.steps,
      newStep,
    ] as [...Steps, typeof newStep])
  }

  build() {
    return new Flow<InitialCtx, Ctx, Steps>(this.steps)
  }
}

export class AsyncFlowBuilder<
  InitialCtx extends object,
  Ctx extends object,
  Info = unknown,
  Steps extends readonly StepDefinition<any, any, any, any>[] = [],
> {
  constructor(readonly steps: Steps) {}

  step<Id extends string, Result>(
    id: Id,
    description: string,
    fn: (ctx: Expand<Ctx>) => AsyncStepReturn<Result, Info>
  ) {
    type AddCtx = NoOverlap<NoReservedStepFields<StepAddedCtx<Awaited<AsyncStepReturn<Result, Info>>>>, Ctx>

    const newStep: StepDefinition<Id, Expand<Ctx>, AddCtx, Info> = {
      id,
      description,
      fn: fn as StepFn<Expand<Ctx>, AddCtx, Info>,
    }

    return new AsyncFlowBuilder<InitialCtx, Expand<Ctx & AddCtx>, Info, [...Steps, typeof newStep]>([
      ...this.steps,
      newStep,
    ] as [...Steps, typeof newStep])
  }

  build() {
    return new AsyncFlow<InitialCtx, Ctx, Steps>(this.steps)
  }
}

// --- Factory ---

export function createSync<Ctx extends object, Info = unknown>() {
  return new FlowBuilder<Ctx, Ctx, Info>([])
}

export function createAsync<Ctx extends object, Info = unknown>() {
  return new AsyncFlowBuilder<Ctx, Ctx, Info>([])
}
