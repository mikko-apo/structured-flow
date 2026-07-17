import { describe, expect, expectTypeOf, it } from 'vitest'

import { collectFailedStepIds, convertResultNode } from '../resultUtils.ts'
import { StepResult } from '../flowClasses'
import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'

type PersonData = {
  person: {
    id: string
    name: string
    age: number
  }
  route: 'approve' | 'reject'
  checks: Array<'audit' | 'rules'>
}

type StepId = {
  id: string
  description: string
  fn?: (data: PersonData) => Record<string, unknown> | Promise<Record<string, unknown>>
}

function resolveStepMeta({
  id,
  description,
}: {
  id: StepId
  description?: string
}) {
  return {
    id: id.id,
    description: description ?? id.description,
  }
}

function createSyncBuilder() {
  return createSyncFlow<StepId, PersonData>({
    resolver: resolveStepMeta,
  })
}

function createAsyncBuilder() {
  return createAsyncFlow<StepId, PersonData>({
    resolver: resolveStepMeta,
  })
}

describe('structuredFlow core execution', () => {
  it('stores flow metadata from the flow options', () => {
    const flow = createSyncFlow<StepId, PersonData>({
      name: 'Person Review',
      description: 'Checks person review steps',
      resolver: resolveStepMeta,
    })
      .step(
        {
          id: 'NAME-0',
          description: 'No-op',
        },
        ({ person }) => ({
          personId: person.id,
        })
      )
      .build()

    expect(flow.name).toBe('Person Review')
    expect(flow.description).toBe('Checks person review steps')
  })

  it('passes a separate ctx to steps when the builder uses withContext()', () => {
    type RequestCtx = {
      actorId: string
    }

    const builder = createSyncFlow<StepId, PersonData>({
      resolver: resolveStepMeta,
    }).withContext<RequestCtx>()

    const flow = builder
      .step(
        {
          id: 'CTX-1',
          description: 'Uses request context',
        },
        (data, ctx) => ({
          actorId: ctx.actorId,
          personId: data.person.id,
        })
      )
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
    builder.step({ id: 'CTX-2', description: 'Invalid ctx' }, (data, ctx: { wrong: true }) => ({
      actorId: String(ctx.wrong),
      personId: data.person.id,
    }))
  })

  it('rejects ctx at runtime when the flow does not use withContext()', () => {
    const flow = createSyncBuilder()
      .step(
        {
          id: 'CTX-RUN-1',
          description: 'No ctx flow',
        },
        ({ person }) => ({
          personId: person.id,
        })
      )
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
      .step(
        {
          id: 'CTX-RUN-2',
          description: 'Ctx flow',
        },
        ({ person }, ctx) => ({
          actorId: ctx.actorId,
          personId: person.id,
        })
      )
      .build()

    expect(() =>
      (flow.run as (...args: any[]) => unknown)({
        person: { id: 'p0', name: 'Ada', age: 31 },
        route: 'approve',
        checks: [],
      })
    ).toThrow('Flow.run() expects both data and ctx when the flow uses withContext()')
  })

  it('uses resolver-provided step functions and keeps ctx stable', () => {
    const ageCheck: StepId = {
      id: 'AGE-1',
      description: 'Check age',
      fn: ({ person }) => ({
        eligible: person.age >= 18,
      }),
    }

    const normalizeName: StepId = {
      id: 'NAME-1',
      description: 'Normalize name',
    }

    const flow = createSyncBuilder()
      .step(ageCheck)
      .step(
        normalizeName,
        ({ person }) =>
          stepResult({
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

  it('allows a step-level resolver to override flow-level metadata resolution', () => {
    const overrideResolver = ({ id }: { id: StepId; description?: string }) => ({
      id: `STEP-${id.id}`,
      description: 'Step-level override',
    })

    const flow = createSyncFlow<StepId, PersonData>({
      resolver: ({ id, description }) => ({
        id: `FLOW-${id.id}`,
        description: (description ?? id.description).toUpperCase(),
      }),
    })
      .step(
        {
          id: 'OVERRIDE-1',
          description: 'Original description',
        },
        ({ person }) => ({
          seen: person.id,
        }),
        {
          resolver: overrideResolver,
        }
      )
      .build()

    const result = flow.run({
      person: { id: 'p1b', name: 'Ada', age: 31 },
      route: 'approve',
      checks: [],
    })

    expect(flow.steps).toMatchObject([{ id: 'STEP-OVERRIDE-1', options: { description: 'Step-level override' } }])
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [{ id: 'STEP-OVERRIDE-1', description: 'Step-level override', status: 'ok', result: { seen: 'p1b' } }],
    })
  })

  it('parses status, stores the remaining payload on the step result, and supports result remapping', () => {
    const rejectMinor: StepId = {
      id: 'AGE-2',
      description: 'Reject minors',
      fn: ({ person }) =>
        stepResult({
          status: person.age >= 18 ? 'ok' : 'error',
          reason: person.age >= 18 ? 'adult' : 'minor',
        }),
    }

    const flow = createSyncBuilder()
      .step(rejectMinor, { status: { error: 'ignore' } })
      .step(
        {
          id: 'THROW-1',
          description: 'Convert exception to error',
          fn: ({ route }) => {
            if (route === 'reject') {
              throw new Error('boom')
            }

            return { reached: true }
          },
        },
        { status: { exception: 'error' } }
      )
      .step(
        {
          id: 'AFTER-1',
          description: 'Still runs after remapped exception',
        },
        ({ checks }) => ({
          checksSeen: checks.length,
        })
      )
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
      .step({
        id: 'STOP-1',
        description: 'Stop rejected requests',
        fn: ({ route }) =>
          stepResult({
            status: route === 'reject' ? 'stop' : 'ok',
            decision: route,
          }),
      })
      .step(
        {
          id: 'AFTER-2',
          description: 'Skipped after stop',
        },
        () => ({
          unreachable: true,
        })
      )
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
      .step({
        id: 'ASYNC-1',
        description: 'Load score',
        fn: async ({ person }) => ({
          score: person.age * 2,
        }),
      })
      .step(
        {
          id: 'ASYNC-2',
          description: 'Approve score',
        },
        async ({ person, checks }) =>
          stepResult({
            approved: person.age >= 18 && checks.includes('audit'),
          })
      )
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
    const flow = createSyncBuilder()
      .step(
        {
          id: 'PROMISE-1',
          description: 'Unexpected promise',
        },
        (async () => ({ loaded: true })) as any
      )
      .step(
        {
          id: 'AFTER-PROMISE',
          description: 'Skipped after runtime promise',
        },
        () => ({
          reached: true,
        })
      )
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
      .step({
        id: 'CONVERT-1',
        description: 'Attach description',
        fn: () => ({
          seen: true,
        }),
      })
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
    expect((result.stepResults[0] as StepResult<any, any>).result).toEqual({ seen: true })
    expect(collectFailedStepIds(result.stepResults)).toEqual([])
  })

  it('checks custom step fns against the flow ctx type', () => {
    const builder = createSyncBuilder()

    builder.step(
      {
        id: 'TYPE-1',
        description: 'Uses a subset of ctx',
      },
      ({ person }) => ({
        seen: person.id,
      })
    )

    // @ts-expect-error invalid ctx contract
    builder.step({ id: 'TYPE-2', description: 'Invalid ctx access' }, ({ missing }: { missing: number }) => ({
      seen: missing,
    }))

    expectTypeOf(builder.build().run).toBeFunction()
  })
})
