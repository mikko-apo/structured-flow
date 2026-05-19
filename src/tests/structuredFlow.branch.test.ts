import { describe, expect, it } from 'vitest'

import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow.ts'

describe('FlowBuilder.branch', () => {
  it('supports createSyncFlow<StepDescription, Info>(id, description, select, branches) as the first branch', () => {
    type StepMeta = { label: string }
    type InfoMeta = { reason: string }

    const approvedFlow = createSyncFlow<StepMeta, InfoMeta>('APP-1', { label: 'Approve request' }, () => ({
      approved: true,
    }))

    const rejectedFlow = createSyncFlow<StepMeta, InfoMeta>('REJ-1', { label: 'Reject request' }, () => ({
      rejected: true,
    }))

    const flow = createSyncFlow<StepMeta, InfoMeta>(
      'BR-1',
      { label: 'Route request' },
      ({ route }: { route: 'approved' | 'rejected' }) => route,
      {
        approved: approvedFlow,
        rejected: rejectedFlow,
      }
    )
      .step('AFTER', { label: 'After branch' }, () => ({
        parentCompleted: true,
      }))
      .build()

    const result = flow.run({ route: 'approved' })

    expect(flow.steps).toMatchObject([
      { id: 'BR-1', description: { label: 'Route request' } },
      { id: 'AFTER', description: { label: 'After branch' } },
    ])
    expect(result.stepResults).toEqual([
      {
        id: 'BR-1',
        result: 'ok',
        branches: [
          {
            key: 'approved',
            result: 'ok',
            finalCtx: { route: 'approved', approved: true },
            steps: [{ id: 'APP-1', description: { label: 'Approve request' } }],
            stepResults: [{ id: 'APP-1', result: 'ok', addToCtx: { approved: true } }],
          },
          {
            key: 'rejected',
            result: 'skip',
            finalCtx: { route: 'approved' },
            steps: [{ id: 'REJ-1', description: { label: 'Reject request' } }],
            stepResults: [{ id: 'REJ-1', result: 'skip' }],
          },
        ],
      },
      {
        id: 'AFTER',
        result: 'ok',
        addToCtx: { parentCompleted: true },
      },
    ])
    expect(result.finalCtx).toEqual({ route: 'approved', parentCompleted: true })
  })

  it('supports createAsyncFlow<StepDescription, Info>(id, description, select, branches) as the first branch', async () => {
    type StepMeta = { label: string }
    type InfoMeta = { reason: string }

    const auditFlow = createAsyncFlow<StepMeta, InfoMeta>('AUDIT-1', { label: 'Audit request' }, async () => ({
      audited: true,
    }))

    const rulesFlow = createAsyncFlow<StepMeta, InfoMeta>('RULES-1', { label: 'Check rules' }, async () =>
      stepResult({
        result: 'error',
        info: { reason: 'rejected' },
      })
    )

    const flow = createAsyncFlow<StepMeta, InfoMeta>(
      'BR-1',
      { label: 'Run reviews' },
      ({ mode }: { mode: 'audit' | 'rules' }) => mode,
      {
        audit: auditFlow,
        rules: rulesFlow,
      }
    )
      .step('AFTER', { label: 'After branch' }, async () => ({
        after: true,
      }))
      .build()

    const result = await flow.run({ mode: 'rules' })

    expect(flow.steps).toMatchObject([
      { id: 'BR-1', description: { label: 'Run reviews' } },
      { id: 'AFTER', description: { label: 'After branch' } },
    ])
    expect(result.stepResults).toEqual([
      {
        id: 'BR-1',
        result: 'error',
        branches: [
          {
            key: 'rules',
            result: 'error',
            finalCtx: { mode: 'rules' },
            steps: [{ id: 'RULES-1', description: { label: 'Check rules' } }],
            stepResults: [{ id: 'RULES-1', result: 'error', info: { reason: 'rejected' } }],
          },
          {
            key: 'audit',
            result: 'skip',
            finalCtx: { mode: 'rules' },
            steps: [{ id: 'AUDIT-1', description: { label: 'Audit request' } }],
            stepResults: [{ id: 'AUDIT-1', result: 'skip' }],
          },
        ],
      },
      {
        id: 'AFTER',
        result: 'ok',
        addToCtx: { after: true },
      },
    ])
    expect(result.finalCtx).toEqual({ mode: 'rules', after: true })
  })

  it('runs a selected sync branch and keeps child ctx out of the parent flow ctx', () => {
    const approvedFlow = createSyncFlow(
      'APP-1',
      'Approve request',
      ({ amount }: { amount: number; route: 'approved' | 'rejected' }) => ({
        approvedTotal: amount + 1,
      })
    )

    const rejectedFlow = createSyncFlow(
      'REJ-1',
      'Reject request',
      ({ amount }: { amount: number; route: 'approved' | 'rejected' }) => ({
        rejectionCode: amount > 0 ? 'manual-review' : 'auto-review',
      })
    )

    const flow = createSyncFlow(
      'BR-1',
      'Route request',
      ({ route }: { amount: number; route: 'approved' | 'rejected' }) => route,
      {
        approved: approvedFlow,
        rejected: rejectedFlow,
      }
    )
      .step('AFTER', 'Continue parent flow', () => ({
        parentCompleted: true,
      }))
      .build()

    const result = flow.run({ amount: 4, route: 'approved' })

    expect(flow.steps[0]).toMatchObject({ id: 'BR-1', description: 'Route request' })
    expect(result.ok).toBe(true)
    expect(result.finalCtx).toEqual({
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
            finalCtx: {
              amount: 4,
              route: 'approved',
              approvedTotal: 5,
            },
            steps: [{ id: 'APP-1', description: 'Approve request' }],
            stepResults: [{ id: 'APP-1', result: 'ok', addToCtx: { approvedTotal: 5 } }],
          },
          {
            key: 'rejected',
            result: 'skip',
            finalCtx: {
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
        addToCtx: { parentCompleted: true },
      },
    ])
  })

  it('supports direct status selection without running branch flows', () => {
    const flow = createSyncFlow(
      'BR-STOP',
      'Optional branch stop',
      ({ shouldStop }: { shouldStop: boolean }) => (shouldStop ? 'stop' : 'ok'),
      {
        active: createSyncFlow('ACTIVE-1', 'Should not run', ({ shouldStop }: { shouldStop: boolean }) => ({
          touched: !shouldStop,
        })).build(),
      }
    )
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
            finalCtx: {
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
    expect(result.finalCtx).toEqual({ shouldStop: true })
  })

  it('fails the branch step when the selector returns an unknown flow key', () => {
    const knownFlow = createSyncFlow('KNOWN-1', 'Known path', ({ route }: { route: string }) => ({
      seenKnown: route === 'known',
    })).build()

    const flow = createSyncFlow('BR-FAIL', 'Fail unknown route', ({ route }: { route: string }) => route as 'known', {
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
    const auditFlow = createAsyncFlow(
      'AUDIT-1',
      'Audit request',
      async ({ amount }: { mode: 'all'; amount: number }) => ({
        audited: amount > 0,
      })
    )

    const rulesFlow = createAsyncFlow<string, string>(
      'RULES-1',
      'Check rules',
      async ({ mode }: { mode: 'all'; amount: number }) =>
        stepResult({
          result: mode === 'all' ? 'error' : 'skip',
          info: 'Rules rejected the request.',
        })
    )

    const policyFlow = createAsyncFlow(
      'POLICY-1',
      'Check policy',
      async ({ mode }: { mode: 'all'; amount: number }) => ({
        policyChecked: mode === 'all',
      })
    )

    const flow = createAsyncFlow(
      'BR-MULTI',
      'Run selected reviews',
      ({ mode }: { mode: 'all'; amount: number }) => (mode === 'all' ? (['audit', 'rules'] as const) : 'ok'),
      {
        audit: auditFlow,
        rules: rulesFlow,
        policy: policyFlow,
      }
    )
      .step('AFTER', 'Parent flow continues after branch errors', async () => ({
        reviewed: true,
      }))
      .build()

    const result = await flow.run({ mode: 'all', amount: 8 })

    expect(result.ok).toBe(false)
    expect(result.finalCtx).toEqual({
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
            finalCtx: {
              mode: 'all',
              amount: 8,
              audited: true,
            },
            steps: [{ id: 'AUDIT-1', description: 'Audit request' }],
            stepResults: [{ id: 'AUDIT-1', result: 'ok', addToCtx: { audited: true } }],
          },
          {
            key: 'rules',
            result: 'error',
            finalCtx: {
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
            finalCtx: {
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
        addToCtx: { reviewed: true },
      },
    ])
  })

  it('treats an empty branch key array as an exception and skips remaining steps', () => {
    const flow = createSyncFlow(
      'BR-EMPTY',
      'No selected checks',
      ({ runChecks }: { runChecks: boolean }) => (runChecks ? [] : []),
      {
        audit: createSyncFlow('AUDIT-1', 'Audit', ({ runChecks }: { runChecks: boolean }) => ({
          audited: runChecks,
        })).build(),
        fraud: createSyncFlow('FRAUD-1', 'Fraud', ({ runChecks }: { runChecks: boolean }) => ({
          fraudChecked: runChecks,
        })).build(),
      }
    )
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
    const flow = createAsyncFlow<{ route: string }>()
      .branch('BR-ASYNC-FAIL', 'Fail async route', ({ route }) => route as 'known', {
        known: createAsyncFlow<{ route: string }>()
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
    const okFlow = createAsyncFlow<{ mode: 'all' }>()
      .step('OK-1', 'Ok branch', async () => ({ okSeen: true }))
      .build()

    const stopFlow = createAsyncFlow<{ mode: 'all' }, string>()
      .step('STOP-1', 'Stop branch', async () =>
        stepResult({
          result: 'stop',
          info: 'Branch stopped early.',
          stopped: true,
        })
      )
      .build()

    const exceptionFlow = createAsyncFlow<{ mode: 'all' }, string>()
      .step('EX-1', 'Exception branch', async () =>
        stepResult({
          result: 'exception',
          info: 'Branch raised an exception result.',
        })
      )
      .build()

    const flow = createAsyncFlow<{ mode: 'all' }>()
      .branch('BR-SEVERITY', 'Run all branches', () => ['ok', 'stop', 'exception'] as const, {
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
            finalCtx: {
              mode: 'all',
              okSeen: true,
            },
            steps: [{ id: 'OK-1', description: 'Ok branch' }],
            stepResults: [{ id: 'OK-1', result: 'ok', addToCtx: { okSeen: true } }],
          },
          {
            key: 'stop',
            result: 'stop',
            finalCtx: {
              mode: 'all',
              stopped: true,
            },
            steps: [{ id: 'STOP-1', description: 'Stop branch' }],
            stepResults: [{ id: 'STOP-1', result: 'stop', info: 'Branch stopped early.', addToCtx: { stopped: true } }],
          },
          {
            key: 'exception',
            result: 'exception',
            finalCtx: {
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
    const emptyFlow = createSyncFlow<{ route: 'empty' | 'normal' }>().build()

    const normalFlow = createSyncFlow<{ route: 'empty' | 'normal' }>()
      .step('NORMAL-1', 'Normal path', () => ({
        seenNormal: true,
      }))
      .build()

    const flow = createSyncFlow<{ route: 'empty' | 'normal' }>()
      .branch('BR-ZERO', 'Route branch', ({ route }) => route, {
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
            finalCtx: {
              route: 'empty',
            },
            steps: [],
            stepResults: [],
          },
          {
            key: 'normal',
            result: 'skip',
            finalCtx: {
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
    const flow = createAsyncFlow<{ checks: string[] }>()
      .branch('BR-FAILED-IDS', 'Run selected branches', () => ['audit', 'rules'] as const, {
        audit: createAsyncFlow<{ checks: string[] }>()
          .step('AUDIT-1', 'Audit', async () => ({ audited: true }))
          .build(),
        rules: createAsyncFlow<{ checks: string[] }, string>()
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
      addToCtx: { reached: true },
    })
  })
})
