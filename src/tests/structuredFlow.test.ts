import { describe, expect, expectTypeOf, it } from 'vitest'

import { collectFailedStepIds, convertResultNode } from '../resultUtils.ts'
import { StepResult } from '../flowClasses'
import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'

type PersonCtx = {
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
  fn?: (ctx: PersonCtx) => Record<string, unknown> | Promise<Record<string, unknown>>
}

function createSyncBuilder() {
  return createSyncFlow<StepId, PersonCtx>({
    resolver: (step) => ({
      id: step.id,
      description: step.description,
      stepFn: step.fn,
    }),
  })
}

function createAsyncBuilder() {
  return createAsyncFlow<StepId, PersonCtx>({
    resolver: (step) => ({
      id: step.id,
      description: step.description,
      stepFn: step.fn,
    }),
  })
}

describe('structuredFlow core execution', () => {
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
    expect(result.stepResults[0].result).toEqual({ seen: true })
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
