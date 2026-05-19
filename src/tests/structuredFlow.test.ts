import { describe, expect, it } from 'vitest'

import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'

describe('structuredFlow core execution', () => {
  it('accumulates ctx from successful sync steps', () => {
    const flow = createSyncFlow<{ amount: number }, string>()
      .step('S1', 'Add tax', ({ amount }) => ({
        taxedAmount: amount * 1.24,
      }))
      .step('S2', 'Finalize total', ({ taxedAmount }) =>
        stepResult({
          info: 'Total finalized.',
          finalAmount: Math.round(taxedAmount * 100) / 100,
        })
      )
      .build()

    const result = flow.run({ amount: 10 })

    expect(result.ok).toBe(true)
    expect(result.finalCtx).toEqual({
      amount: 10,
      taxedAmount: 12.4,
      finalAmount: 12.4,
    })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'ok', addToCtx: { taxedAmount: 12.4 } },
      { id: 'S2', result: 'ok', info: 'Total finalized.', addToCtx: { finalAmount: 12.4 } },
    ])
  })

  it('continues after error and marks the flow as failed', () => {
    const flow = createSyncFlow<{ amount: number }, string>()
      .step('S1', 'Validate amount', () =>
        stepResult({
          result: 'error',
          info: 'Amount failed validation.',
        })
      )
      .step('S2', 'Still runs', () => ({
        afterError: true,
      }))
      .build()

    const result = flow.run({ amount: 10 })

    expect(result.ok).toBe(false)
    expect(result.failedStepIds()).toEqual(['S1'])
    expect(result.finalCtx).toEqual({
      amount: 10,
      afterError: true,
    })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'error', info: 'Amount failed validation.' },
      { id: 'S2', result: 'ok', addToCtx: { afterError: true } },
    ])
  })

  it('stops early and records remaining steps as skip', () => {
    const flow = createSyncFlow<{ amount: number }, string>()
      .step('S1', 'Stop early', ({ amount }) =>
        stepResult({
          result: 'stop',
          info: 'Enough information collected.',
          stoppedAmount: amount,
        })
      )
      .step('S2', 'Skipped', () => ({
        unreachable: true,
      }))
      .build()

    const result = flow.run({ amount: 10 })

    expect(result.ok).toBe(true)
    expect(result.finalCtx).toEqual({
      amount: 10,
      stoppedAmount: 10,
    })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'stop', info: 'Enough information collected.', addToCtx: { stoppedAmount: 10 } },
      { id: 'S2', result: 'skip' },
    ])
  })

  it('converts thrown exceptions into exception results and skips the rest', () => {
    const flow = createSyncFlow<{ amount: number }>()
      .step('S1', 'Throw', () => {
        throw new Error('boom')
      })
      .step('S2', 'Skipped after exception', () => ({
        unreachable: true,
      }))
      .build()

    const result = flow.run({ amount: 10 })

    expect(result.ok).toBe(false)
    expect(result.failedStepIds()).toEqual(['S1'])
    expect(result.finalCtx).toEqual({ amount: 10 })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'exception' },
      { id: 'S2', result: 'skip' },
    ])
  })

  it('rejects ctx overwrites from later steps', () => {
    const flow = createSyncFlow<{ amount: number }>()
      .step('S1', 'Add total', () => ({
        total: 10,
      }))
      .step('S2', 'Try overwrite total', () => ({
        total: 20,
      }))
      .build()

    const result = flow.run({ amount: 10 })

    expect(result.ok).toBe(false)
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'ok', addToCtx: { total: 10 } },
      { id: 'S2', result: 'exception' },
    ])
    expect(result.finalCtx).toEqual({
      amount: 10,
      total: 10,
    })
  })

  it('rejects promises returned from sync flows', () => {
    const flow = createSyncFlow<{ amount: number }>()
      .step('S1', 'Invalid async in sync flow', (() => Promise.resolve({ later: true })) as never)
      .step('S2', 'Skipped', () => ({
        unreachable: true,
      }))
      .build()

    const result = flow.run({ amount: 10 })

    expect(result.ok).toBe(false)
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'exception' },
      { id: 'S2', result: 'skip' },
    ])
  })

  it('awaits async steps and preserves async execution semantics', async () => {
    const flow = createAsyncFlow<{ amount: number }, string>()
      .step('A1', 'Load multiplier', async () => ({
        multiplier: 3,
      }))
      .step('A2', 'Compute total', async ({ amount, multiplier }) =>
        stepResult({
          info: 'Computed asynchronously.',
          total: amount * multiplier,
        })
      )
      .build()

    const result = await flow.run({ amount: 7 })

    expect(result.ok).toBe(true)
    expect(result.finalCtx).toEqual({
      amount: 7,
      multiplier: 3,
      total: 21,
    })
    expect(result.stepResults).toEqual([
      { id: 'A1', result: 'ok', addToCtx: { multiplier: 3 } },
      { id: 'A2', result: 'ok', info: 'Computed asynchronously.', addToCtx: { total: 21 } },
    ])
  })

  it('supports createSyncFlow/createAsyncFlow with custom step definitions and InitialCtx in the new generic order', async () => {
    const syncFlow = createSyncFlow<{ label: string }, { amount: number }>()
      .step('S1', { label: 'Add tax' }, ({ amount }) => ({
        taxedAmount: amount * 1.24,
      }))
      .build()

    const asyncFlow = createAsyncFlow<{ label: string }, { amount: number }, string>()
      .step('A1', { label: 'Finalize total' }, async ({ amount }) =>
        stepResult({
          info: 'Done.',
          finalAmount: amount + 1,
        })
      )
      .build()

    expect(syncFlow.steps).toMatchObject([{ id: 'S1', description: { label: 'Add tax' } }])
    expect(syncFlow.run({ amount: 10 }).finalCtx).toEqual({ amount: 10, taxedAmount: 12.4 })
    expect(asyncFlow.steps).toMatchObject([{ id: 'A1', description: { label: 'Finalize total' } }])
    await expect(asyncFlow.run({ amount: 10 })).resolves.toMatchObject({
      ok: true,
      stepResults: [{ id: 'A1', result: 'ok', info: 'Done.', addToCtx: { finalAmount: 11 } }],
      finalCtx: { amount: 10, finalAmount: 11 },
    })
  })

  it('enriches results with step descriptions, including nested branch results', () => {
    const approvedFlow = createSyncFlow<{ label: string }, { amount: number; route: 'approved' | 'rejected' }>().step(
      'APP-1',
      { label: 'Approve request' },
      ({ amount }) => ({
        approvedTotal: amount + 1,
      })
    )

    const rejectedFlow = createSyncFlow<{ label: string }, { amount: number; route: 'approved' | 'rejected' }>().step(
      'REJ-1',
      { label: 'Reject request' },
      () => ({
        rejectionCode: 'manual-review',
      })
    )

    const flow = createSyncFlow<{ label: string }, { amount: number; route: 'approved' | 'rejected' }>()
      .branch('BR-1', { label: 'Route request' }, ({ route }) => route, {
        approved: approvedFlow,
        rejected: rejectedFlow,
      })
      .step('AFTER', { label: 'Continue parent flow' }, () => ({
        parentCompleted: true,
      }))
      .build()

    const result = flow.run({ amount: 4, route: 'approved' })
    const enrichedResult = flow.enrichResult(result)

    expect(enrichedResult.stepResults).toEqual([
      {
        id: 'BR-1',
        description: { label: 'Route request' },
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
            steps: [{ id: 'APP-1', description: { label: 'Approve request' } }],
            stepResults: [
              {
                id: 'APP-1',
                description: { label: 'Approve request' },
                result: 'ok',
                addToCtx: { approvedTotal: 5 },
              },
            ],
          },
          {
            key: 'rejected',
            result: 'skip',
            finalCtx: {
              amount: 4,
              route: 'approved',
            },
            steps: [{ id: 'REJ-1', description: { label: 'Reject request' } }],
            stepResults: [
              {
                id: 'REJ-1',
                description: { label: 'Reject request' },
                result: 'skip',
              },
            ],
          },
        ],
      },
      {
        id: 'AFTER',
        description: { label: 'Continue parent flow' },
        result: 'ok',
        addToCtx: { parentCompleted: true },
      },
    ])
    expect(enrichedResult.failedStepIds()).toEqual([])
  })
})
