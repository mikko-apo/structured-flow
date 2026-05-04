import { describe, expect, it } from 'vitest'

import { createAsync, createSync, stepResult } from '../structuredFlow'

describe('FlowBuilder.branch', () => {
  it('runs a selected sync branch and keeps child ctx out of the parent flow ctx', () => {
    const approvedFlow = createSync<{ amount: number; route: 'approved' | 'rejected' }>()
      .step('APP-1', 'Approve request', ({ amount }) => ({
        approvedTotal: amount + 1,
      }))
      .build()

    const rejectedFlow = createSync<{ amount: number; route: 'approved' | 'rejected' }>()
      .step('REJ-1', 'Reject request', () => ({
        rejectionCode: 'manual-review',
      }))
      .build()

    const flow = createSync<{ amount: number; route: 'approved' | 'rejected' }>()
      .branch('BR-1', ({ route }) => route, {
        approved: approvedFlow,
        rejected: rejectedFlow,
      })
      .step('AFTER', 'Continue parent flow', () => ({
        parentCompleted: true,
      }))
      .build()

    const result = flow.run({ amount: 4, route: 'approved' })

    expect(result.ok).toBe(true)
    expect(result.ctx).toEqual({
      amount: 4,
      route: 'approved',
      parentCompleted: true,
    })
    expect(result.stepResults).toEqual([
      {
        id: 'BR-1',
        result: 'ok',
        branches: [
          {
            key: 'approved',
            result: 'ok',
            ctx: {
              amount: 4,
              route: 'approved',
              approvedTotal: 5,
            },
            steps: [{ id: 'APP-1', description: 'Approve request' }],
            stepResults: [{ id: 'APP-1', result: 'ok' }],
          },
          {
            key: 'rejected',
            result: 'skip',
            ctx: {
              amount: 4,
              route: 'approved',
            },
            steps: [{ id: 'REJ-1', description: 'Reject request' }],
            stepResults: [{ id: 'REJ-1', result: 'skip' }],
          },
        ],
      },
      {
        id: 'AFTER',
        result: 'ok',
      },
    ])
  })

  it('supports direct status selection without running branch flows', () => {
    const flow = createSync<{ shouldStop: boolean }>()
      .branch('BR-STOP', ({ shouldStop }) => (shouldStop ? 'stop' : 'ok'), {
        active: createSync<{ shouldStop: boolean }>()
          .step('ACTIVE-1', 'Should not run', () => ({ touched: true }))
          .build(),
      })
      .step('AFTER', 'Skipped after stop', () => ({
        reached: true,
      }))
      .build()

    const result = flow.run({ shouldStop: true })

    expect(result.ok).toBe(true)
    expect(result.stepResults).toEqual([
      {
        id: 'BR-STOP',
        result: 'stop',
        branches: [
          {
            key: 'active',
            result: 'skip',
            ctx: {
              shouldStop: true,
            },
            steps: [{ id: 'ACTIVE-1', description: 'Should not run' }],
            stepResults: [{ id: 'ACTIVE-1', result: 'skip' }],
          },
        ],
      },
      {
        id: 'AFTER',
        result: 'skip',
      },
    ])
    expect(result.ctx).toEqual({ shouldStop: true })
  })

  it('fails the branch step when the selector returns an unknown flow key', () => {
    const knownFlow = createSync<{ route: string }>()
      .step('KNOWN-1', 'Known path', () => ({
        seenKnown: true,
      }))
      .build()

    const flow = createSync<{ route: string }>()
      .branch('BR-FAIL', ({ route }) => route as 'known', {
        known: knownFlow,
      })
      .step('AFTER', 'Skipped after branch exception', () => ({
        reached: true,
      }))
      .build()

    const result = flow.run({ route: 'missing' })

    expect(result.ok).toBe(false)
    expect(result.stepResults).toEqual([
      {
        id: 'BR-FAIL',
        result: 'exception',
      },
      {
        id: 'AFTER',
        result: 'skip',
      },
    ])
  })

  it('runs multiple async branches and records each branch result separately', async () => {
    const auditFlow = createAsync<{ mode: 'all'; amount: number }>()
      .step('AUDIT-1', 'Audit request', async () => ({ audited: true }))
      .build()

    const rulesFlow = createAsync<{ mode: 'all'; amount: number }, string>()
      .step('RULES-1', 'Check rules', async () =>
        stepResult({
          result: 'error',
          info: 'Rules rejected the request.',
        })
      )
      .build()

    const policyFlow = createAsync<{ mode: 'all'; amount: number }>()
      .step('POLICY-1', 'Check policy', async () => ({ policyChecked: true }))
      .build()

    const flow = createAsync<{ mode: 'all'; amount: number }>()
      .branch('BR-MULTI', ({ mode }) => (mode === 'all' ? (['audit', 'rules'] as const) : 'ok'), {
        audit: auditFlow,
        rules: rulesFlow,
        policy: policyFlow,
      })
      .step('AFTER', 'Parent flow continues after branch errors', async () => ({
        reviewed: true,
      }))
      .build()

    const result = await flow.run({ mode: 'all', amount: 8 })

    expect(result.ok).toBe(false)
    expect(result.ctx).toEqual({
      mode: 'all',
      amount: 8,
      reviewed: true,
    })
    expect(result.stepResults).toEqual([
      {
        id: 'BR-MULTI',
        result: 'error',
        branches: [
          {
            key: 'audit',
            result: 'ok',
            ctx: {
              mode: 'all',
              amount: 8,
              audited: true,
            },
            steps: [{ id: 'AUDIT-1', description: 'Audit request' }],
            stepResults: [{ id: 'AUDIT-1', result: 'ok' }],
          },
          {
            key: 'rules',
            result: 'error',
            ctx: {
              mode: 'all',
              amount: 8,
            },
            steps: [{ id: 'RULES-1', description: 'Check rules' }],
            stepResults: [
              {
                id: 'RULES-1',
                result: 'error',
                info: 'Rules rejected the request.',
              },
            ],
          },
          {
            key: 'policy',
            result: 'skip',
            ctx: {
              mode: 'all',
              amount: 8,
            },
            steps: [{ id: 'POLICY-1', description: 'Check policy' }],
            stepResults: [{ id: 'POLICY-1', result: 'skip' }],
          },
        ],
      },
      {
        id: 'AFTER',
        result: 'ok',
      },
    ])
  })

  it('treats an empty branch key array as an exception and skips remaining steps', () => {
    const flow = createSync<{ runChecks: boolean }>()
      .branch('BR-EMPTY', () => [], {
        audit: createSync<{ runChecks: boolean }>()
          .step('AUDIT-1', 'Audit', () => ({ audited: true }))
          .build(),
        fraud: createSync<{ runChecks: boolean }>()
          .step('FRAUD-1', 'Fraud', () => ({ fraudChecked: true }))
          .build(),
      })
      .step('AFTER', 'Skipped after exception', () => ({
        reached: true,
      }))
      .build()

    const result = flow.run({ runChecks: true })

    expect(result.ok).toBe(false)
    expect(result.failedStepIds()).toEqual(['BR-EMPTY'])
    expect(result.stepResults).toEqual([
      { id: 'BR-EMPTY', result: 'exception' },
      { id: 'AFTER', result: 'skip' },
    ])
  })

  it('fails async branch steps when the selector returns an unknown flow key', async () => {
    const flow = createAsync<{ route: string }>()
      .branch('BR-ASYNC-FAIL', ({ route }) => route as 'known', {
        known: createAsync<{ route: string }>()
          .step('KNOWN-1', 'Known path', async () => ({ seenKnown: true }))
          .build(),
      })
      .step('AFTER', 'Skipped after branch exception', async () => ({
        reached: true,
      }))
      .build()

    const result = await flow.run({ route: 'missing' })

    expect(result.ok).toBe(false)
    expect(result.failedStepIds()).toEqual(['BR-ASYNC-FAIL'])
    expect(result.stepResults).toEqual([
      { id: 'BR-ASYNC-FAIL', result: 'exception' },
      { id: 'AFTER', result: 'skip' },
    ])
  })

  it('uses the most severe branch status as the parent branch result', async () => {
    const okFlow = createAsync<{ mode: 'all' }>()
      .step('OK-1', 'Ok branch', async () => ({ okSeen: true }))
      .build()

    const stopFlow = createAsync<{ mode: 'all' }, string>()
      .step('STOP-1', 'Stop branch', async () =>
        stepResult({
          result: 'stop',
          info: 'Branch stopped early.',
          stopped: true,
        })
      )
      .build()

    const exceptionFlow = createAsync<{ mode: 'all' }, string>()
      .step('EX-1', 'Exception branch', async () =>
        stepResult({
          result: 'exception',
          info: 'Branch raised an exception result.',
        })
      )
      .build()

    const flow = createAsync<{ mode: 'all' }>()
      .branch('BR-SEVERITY', () => ['ok', 'stop', 'exception'] as const, {
        ok: okFlow,
        stop: stopFlow,
        exception: exceptionFlow,
      })
      .build()

    const result = await flow.run({ mode: 'all' })

    expect(result.ok).toBe(false)
    expect(result.failedStepIds()).toEqual(['BR-SEVERITY'])
    expect(result.stepResults).toEqual([
      {
        id: 'BR-SEVERITY',
        result: 'exception',
        branches: [
          {
            key: 'ok',
            result: 'ok',
            ctx: {
              mode: 'all',
              okSeen: true,
            },
            steps: [{ id: 'OK-1', description: 'Ok branch' }],
            stepResults: [{ id: 'OK-1', result: 'ok' }],
          },
          {
            key: 'stop',
            result: 'stop',
            ctx: {
              mode: 'all',
              stopped: true,
            },
            steps: [{ id: 'STOP-1', description: 'Stop branch' }],
            stepResults: [{ id: 'STOP-1', result: 'stop', info: 'Branch stopped early.' }],
          },
          {
            key: 'exception',
            result: 'exception',
            ctx: {
              mode: 'all',
            },
            steps: [{ id: 'EX-1', description: 'Exception branch' }],
            stepResults: [{ id: 'EX-1', result: 'exception', info: 'Branch raised an exception result.' }],
          },
        ],
      },
    ])
  })

  it('records branch ctx and result for zero-step child flows', () => {
    const emptyFlow = createSync<{ route: 'empty' | 'normal' }>().build()

    const normalFlow = createSync<{ route: 'empty' | 'normal' }>()
      .step('NORMAL-1', 'Normal path', () => ({
        seenNormal: true,
      }))
      .build()

    const flow = createSync<{ route: 'empty' | 'normal' }>()
      .branch('BR-ZERO', ({ route }) => route, {
        empty: emptyFlow,
        normal: normalFlow,
      })
      .build()

    const result = flow.run({ route: 'empty' })

    expect(result.ok).toBe(true)
    expect(result.stepResults).toEqual([
      {
        id: 'BR-ZERO',
        result: 'ok',
        branches: [
          {
            key: 'empty',
            result: 'ok',
            ctx: {
              route: 'empty',
            },
            steps: [],
            stepResults: [],
          },
          {
            key: 'normal',
            result: 'skip',
            ctx: {
              route: 'empty',
            },
            steps: [{ id: 'NORMAL-1', description: 'Normal path' }],
            stepResults: [{ id: 'NORMAL-1', result: 'skip' }],
          },
        ],
      },
    ])
  })

  it('reports branch-produced failures through failedStepIds()', async () => {
    const flow = createAsync<{ checks: string[] }>()
      .branch('BR-FAILED-IDS', () => ['audit', 'rules'] as const, {
        audit: createAsync<{ checks: string[] }>()
          .step('AUDIT-1', 'Audit', async () => ({ audited: true }))
          .build(),
        rules: createAsync<{ checks: string[] }, string>()
          .step('RULES-1', 'Rules', async () =>
            stepResult({
              result: 'error',
              info: 'Rules branch failed.',
            })
          )
          .build(),
      })
      .step('AFTER', 'Still runs', async () => ({ reached: true }))
      .build()

    const result = await flow.run({ checks: ['audit', 'rules'] })

    expect(result.failedStepIds()).toEqual(['BR-FAILED-IDS'])
    expect(result.stepResults[0]).toMatchObject({
      id: 'BR-FAILED-IDS',
      result: 'error',
    })
    expect(result.stepResults[1]).toEqual({
      id: 'AFTER',
      result: 'ok',
    })
  })
})
