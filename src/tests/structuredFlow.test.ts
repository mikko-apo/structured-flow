import { describe, expect, expectTypeOf, it } from 'vitest'

import { collectFailedStepIds, convertResultNode } from '../resultUtils.ts'
import {
  createAsyncFlow,
  createSyncFlow,
  error,
  ok,
  ruleId,
  skip,
  step as defineStep,
  StepResult,
  stop,
} from '../index'

type PersonData = {
  person: {
    id: string
    name: string
    age: number
  }
  route: 'approve' | 'reject'
  checks: Array<'audit' | 'rules'>
}

function meta(id: string, description: string) {
  return ruleId(id, { description })
}

function createSyncBuilder() {
  return createSyncFlow<PersonData>()
}

function createAsyncBuilder() {
  return createAsyncFlow<PersonData>()
}

describe('structuredFlow core execution', () => {
  it('uses the flow resolver to map string, RuleId, and Step metadata', () => {
    const resolvedStep = defineStep(
      'STEP-RES',
      ({ person }: PersonData, _params: { ctx: undefined }) => ({
        stepPersonId: person.id,
      }),
      { description: 'Step helper description' }
    )
    const flow = createSyncFlow<PersonData>({
      resolver: (stepId) =>
        typeof stepId === 'string'
          ? { id: `RES-${stepId}`, description: 'Resolved string id' }
          : { id: `RES-${stepId.id}`, description: `Resolved ${stepId.description ?? 'metadata'}` },
    })
      .step('STRING-RES', ({ person }, _params) => ({
        stringPersonId: person.id,
      }))
      .step(meta('RULE-RES', 'Rule description'), ({ person }, _params) => ({
        rulePersonId: person.id,
      }))
      .step(resolvedStep)
      .build()

    const result = flow.run({
      person: { id: 'p-res', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        { id: 'RES-STRING-RES', description: 'Resolved string id' },
        { id: 'RES-RULE-RES', description: 'Resolved Rule description' },
        { id: 'RES-STEP-RES', description: 'Resolved Step helper description' },
      ],
    })
  })

  it('stores flow metadata from the flow options', () => {
    const flow = createSyncFlow<PersonData>({
      name: 'Person Review',
      description: 'Checks person review steps',
    })
      .step(meta('NAME-0', 'No-op'), ({ person }, _params) => ({
        personId: person.id,
      }))
      .build()

    expect(flow.name).toBe('Person Review')
    expect(flow.description).toBe('Checks person review steps')
  })

  it('passes a separate ctx to steps when the builder uses withContext()', () => {
    type RequestCtx = {
      actorId: string
    }

    const builder = createSyncFlow<PersonData>().withContext<RequestCtx>()

    const flow = builder
      .step(meta('CTX-1', 'Uses request context'), (data, params) => ({
        actorId: params.ctx.actorId,
        personId: data.person.id,
      }))
      .build()

    const result = flow.run(
      {
        person: { id: 'p0', name: 'Ada', age: 31 },
        route: 'approve',
        checks: [],
      },
      { actorId: 'user-1' }
    )

    expect(result.status).toBe('ok')
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'CTX-1', result: { actorId: 'user-1', personId: 'p0' } }],
    })

    expectTypeOf<Parameters<typeof flow.run>>().toEqualTypeOf<[data: PersonData, ctx: RequestCtx]>()

    // @ts-expect-error second parameter must match the configured ctx type
    builder.step(meta('CTX-2', 'Invalid ctx'), (data, params: { ctx: { wrong: true } }) => ({
      actorId: String(params.ctx.wrong),
      personId: data.person.id,
    }))
  })

  it('rejects ctx at runtime when the flow does not use withContext()', () => {
    const flow = createSyncBuilder()
      .step(meta('CTX-RUN-1', 'No ctx flow'), ({ person }, _params) => ({
        personId: person.id,
      }))
      .build()

    expect(() =>
      (flow.run as (...args: any[]) => unknown)(
        {
          person: { id: 'p0', name: 'Ada', age: 31 },
          route: 'approve',
          checks: [],
        },
        { actorId: 'user-1' }
      )
    ).toThrow('Flow.run() expects only data when the flow does not use withContext()')
  })

  it('requires ctx at runtime when the flow uses withContext()', () => {
    type RequestCtx = {
      actorId: string
    }

    const flow = createSyncBuilder()
      .withContext<RequestCtx>()
      .step(meta('CTX-RUN-2', 'Ctx flow'), ({ person }, params) => ({
        actorId: params.ctx.actorId,
        personId: person.id,
      }))
      .build()

    expect(() =>
      (flow.run as (...args: any[]) => unknown)({
        person: { id: 'p0', name: 'Ada', age: 31 },
        route: 'approve',
        checks: [],
      })
    ).toThrow('Flow.run() expects both data and ctx when the flow uses withContext()')
  })

  it('uses rule metadata with explicit step functions and keeps ctx stable', () => {
    const flow = createSyncBuilder()
      .step(meta('AGE-1', 'Check age'), ({ person }, _params) => ({
        eligible: person.age >= 18,
      }))
      .step(
        meta('NAME-1', 'Normalize name'),
        ({ person }, _params) => ({
          normalizedName: person.name.trim().toUpperCase(),
          info: 'Normalized with a custom fn override.',
        }),
        { description: 'Normalize person name' }
      )
      .build()

    const result = flow.run({
      person: { id: 'p1', name: ' Ada ', age: 31 },
      route: 'approve',
      checks: ['audit'],
    })

    expect(flow.steps).toMatchObject([
      { id: 'AGE-1', options: { description: 'Check age' } },
      { id: 'NAME-1', options: { description: 'Normalize person name' } },
    ])
    expect(result.status).toBe('ok')
    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        { id: 'AGE-1', description: 'Check age', status: 'ok', result: { eligible: true } },
        {
          id: 'NAME-1',
          description: 'Normalize person name',
          status: 'ok',
          result: {
            normalizedName: 'ADA',
            info: 'Normalized with a custom fn override.',
          },
        },
      ],
    })
  })

  it('allows step options to override rule metadata descriptions', () => {
    const flow = createSyncFlow<PersonData>()
      .step(
        meta('OVERRIDE-1', 'Original description'),
        ({ person }, _params) => ({
          seen: person.id,
        }),
        {
          description: 'Step option override',
        }
      )
      .build()

    const result = flow.run({
      person: { id: 'p1b', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(flow.steps).toMatchObject([{ id: 'OVERRIDE-1', options: { description: 'Step option override' } }])
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'OVERRIDE-1', description: 'Step option override', status: 'ok', result: { seen: 'p1b' } }],
    })
  })

  it('lets map override the step callback signature with fnInput', () => {
    type FlowMap = (params: { id: string; data: PersonData; ctx: undefined }) => {
      submissionId: string
      fnInput: [{ personId: string; route: PersonData['route'] }, { ctx: undefined; submissionId: string }]
    }

    const flow = createSyncFlow<string, PersonData, FlowMap>({
      map: ({ data }) => ({
        submissionId: data.person.id,
        fnInput: [
          { personId: data.person.id, route: data.route },
          { ctx: undefined, submissionId: data.person.id },
        ],
      }),
    })
      .step(
        'FNINPUT-1',
        (data, params) => {
          expectTypeOf(data).toEqualTypeOf<{ personId: string; route: PersonData['route'] }>()
          expectTypeOf(params).toEqualTypeOf<{ ctx: undefined; submissionId: string }>()

          return {
            seen: `${data.personId}:${data.route}:${params.submissionId}`,
          }
        },
        { description: 'Use fnInput override' }
      )
      .build()

    const result = flow.run({
      person: { id: 'p1c', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'FNINPUT-1', result: { seen: 'p1c:approve:p1c' } }],
    })
  })

  it('parses status, stores the remaining payload on the step result, and supports result remapping', () => {
    const flow = createSyncBuilder()
      .step(
        meta('AGE-2', 'Reject minors'),
        ({ person }, _params) => (person.age >= 18 ? { reason: 'adult' } : error({ variables: { reason: 'minor' } })),
        { status: { error: 'ignore' } }
      )
      .step(
        meta('THROW-1', 'Convert exception to error'),
        ({ route }, _params) => {
          if (route === 'reject') {
            throw new Error('boom')
          }

          return { reached: true }
        },
        { status: { exception: 'error' } }
      )
      .step(meta('AFTER-1', 'Still runs after remapped exception'), ({ checks }, _params) => ({
        checksSeen: checks.length,
      }))
      .build()

    const result = flow.run({
      person: { id: 'p2', name: 'Max', age: 16 },
      route: 'reject',
      checks: ['audit', 'rules'],
    })

    expect(result.status).toBe('error')
    expect(collectFailedStepIds(result.stepResults)).toEqual(['THROW-1'])
    expect(convertResultNode(result)).toMatchObject({
      status: 'error',
      stepResults: [
        { id: 'AGE-2', status: 'ok', originalStatus: 'error', result: { reason: 'minor' } },
        { id: 'THROW-1', status: 'error', originalStatus: 'exception' },
        { id: 'AFTER-1', status: 'ok', result: { checksSeen: 2 } },
      ],
    })
  })

  it('stops on stop and skips the remaining steps', () => {
    const flow = createSyncBuilder()
      .step(meta('STOP-1', 'Stop rejected requests'), ({ route }, _params) =>
        route === 'reject' ? stop({ variables: { decision: route } }) : { decision: route }
      )
      .step(meta('AFTER-2', 'Skipped after stop'), (_data, _params) => ({
        unreachable: true,
      }))
      .build()

    const result = flow.run({
      person: { id: 'p3', name: 'Nia', age: 23 },
      route: 'reject',
      checks: [],
    })

    expect(result.status).toBe('stop')
    expect(convertResultNode(result)).toMatchObject({
      status: 'stop',
      stepResults: [
        { id: 'STOP-1', status: 'stop', result: { decision: 'reject' } },
        { id: 'AFTER-2', status: 'skip' },
      ],
    })
  })

  it('supports async steps and preserves the same ctx for every step', async () => {
    const flow = createAsyncBuilder()
      .step(meta('ASYNC-1', 'Load score'), async ({ person }, _params) => ({
        score: person.age * 2,
      }))
      .step(meta('ASYNC-2', 'Approve score'), async ({ person, checks }, _params) => ({
        approved: person.age >= 18 && checks.includes('audit'),
      }))
      .build()

    const result = await flow.run({
      person: { id: 'p4', name: 'Ivy', age: 27 },
      route: 'approve',
      checks: ['audit'],
    })

    expect(result.status).toBe('ok')
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        { id: 'ASYNC-1', status: 'ok', result: { score: 54 } },
        { id: 'ASYNC-2', status: 'ok', result: { approved: true } },
      ],
    })
  })

  it('marks a sync step as exception when a step function returns a promise at runtime', () => {
    const builderWithRuntimePromise = (createSyncBuilder().step as unknown as (...args: any[]) => unknown)(
      meta('PROMISE-1', 'Unexpected promise'),
      async () => ({ loaded: true })
    ) as ReturnType<typeof createSyncBuilder>
    const flow = builderWithRuntimePromise
      .step(meta('AFTER-PROMISE', 'Skipped after runtime promise'), (_data, _params) => ({
        reached: true,
      }))
      .build()

    const result = flow.run({
      person: { id: 'p4b', name: 'Ivy', age: 27 },
      route: 'approve',
      checks: ['audit'],
    })

    expect(result.status).toBe('exception')
    expect(collectFailedStepIds(result.stepResults)).toEqual(['PROMISE-1'])
    expect(convertResultNode(result)).toMatchObject({
      status: 'exception',
      stepResults: [
        { id: 'PROMISE-1', status: 'exception' },
        { id: 'AFTER-PROMISE', status: 'skip' },
      ],
    })
  })

  it('converts class-based results to plain objects', () => {
    const flow = createSyncBuilder()
      .step(meta('CONVERT-1', 'Attach description'), (_data, _params) => ({
        seen: true,
      }))
      .build()

    const result = flow.run({
      person: { id: 'p5', name: 'Jon', age: 22 },
      route: 'approve',
      checks: [],
    })

    const converted = convertResultNode(result)

    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    expect(converted).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'CONVERT-1', description: 'Attach description', status: 'ok', result: { seen: true } }],
    })
    expect(result.stepResults[0].result).toEqual({ seen: true })
    expect(collectFailedStepIds(result.stepResults)).toEqual([])
  })

  it('checks custom step fns against the flow ctx type', () => {
    const builder = createSyncBuilder()

    builder.step(meta('TYPE-1', 'Uses a subset of ctx'), ({ person }, _params) => ({
      seen: person.id,
    }))

    builder.step(
      meta('TYPE-2', 'Invalid ctx access'),
      // @ts-expect-error invalid step data contract
      ({ missing }: { missing: number }, _params: { ctx: undefined }) => ({
        seen: missing,
      })
    )

    expectTypeOf(builder.build().run).toBeFunction()
  })

  it('runs helper-defined steps with rule metadata and global StepFnResult helpers', () => {
    const ageRule = ruleId('HELPER-1', { description: 'Helper age check', info: { group: 'eligibility' } })
    const helperStep = defineStep(
      ageRule.id,
      ({ person }: PersonData, _params: { ctx: undefined }) => {
        return ok({
          path: 'person.age',
          message: 'Age accepted',
          variables: { adult: person.age >= 18 },
        }).addResult(skip({ message: 'Nested detail', variables: { nested: true } }))
      },
      { path: 'person.age', description: ageRule.description, info: ageRule.info }
    )

    const flow = createSyncFlow<PersonData>().step(helperStep).build()
    const result = flow.run({
      person: { id: 'p6', name: 'Grace', age: 40 },
      route: 'approve',
      checks: [],
    })

    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        {
          id: 'HELPER-1',
          description: 'Helper age check',
          status: 'ok',
          path: 'person.age',
          message: 'Age accepted',
          result: { adult: true },
          results: [{ status: 'skip', message: 'Nested detail', variables: { nested: true } }],
        },
      ],
    })
  })

  it('normalizes boolean and object step returns into result variables', () => {
    const flow = createSyncFlow<PersonData>()
      .step('BOOL-OK', () => true)
      .step('OBJECT-VARS', ({ person }) => ({ personId: person.id }))
      .step('BOOL-ERROR', () => false)
      .build()

    const result = flow.run({
      person: { id: 'p7', name: 'Lin', age: 20 },
      route: 'reject',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      status: 'error',
      stepResults: [
        { id: 'BOOL-OK', status: 'ok' },
        { id: 'OBJECT-VARS', status: 'ok', result: { personId: 'p7' } },
        { id: 'BOOL-ERROR', status: 'error' },
      ],
    })
  })

  it('rejects helper steps that are async or use the wrong input signature in sync flows', () => {
    const asyncHelperStep = defineStep(
      'ASYNC-HELPER',
      async (_data: PersonData) => ({
        reached: true,
      }),
      { description: 'Async helper' }
    )
    const wrongInputStep = defineStep('WRONG-INPUT', (_data: { missing: true }) => true, { description: 'Wrong input' })

    // @ts-expect-error sync flows cannot accept async helper steps
    createSyncFlow<PersonData>().step(asyncHelperStep)

    // @ts-expect-error helper step input data must match the flow data
    createSyncFlow<PersonData>().step(wrongInputStep)
  })
})
