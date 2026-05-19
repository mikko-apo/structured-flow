import { describe, expect, it } from 'vitest'

import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'

describe('structuredFlow core execution', () => {
  it('accumulates ctx from successful sync steps', () => {
    const flow = createSyncFlow<string, string>('S1', 'Add tax', ({ amount }: { amount: number }) => ({
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
    const flow = createSyncFlow<string, string>('S1', 'Validate amount', ({ amount }: { amount: number }) =>
      stepResult({
        result: 'error',
        info: `Amount ${amount} failed validation.`,
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
      { id: 'S1', result: 'error', info: 'Amount 10 failed validation.' },
      { id: 'S2', result: 'ok', addToCtx: { afterError: true } },
    ])
  })

  it('continues after explicit skip without merging returned fields into ctx', () => {
    const flow = createSyncFlow('S1', 'Optionally skip', ({ amount }: { amount: number }) =>
      stepResult({
        result: 'skip',
        info: `Skipped amount ${amount}.`,
      })
    )
      .step('S2', 'Still runs after skip', ({ amount }) => ({
        continued: amount > 0,
      }))
      .build()

    const result = flow.run({ amount: 10 })

    expect(result.ok).toBe(true)
    expect(result.finalCtx).toEqual({
      amount: 10,
      continued: true,
    })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'skip', info: 'Skipped amount 10.' },
      { id: 'S2', result: 'ok', addToCtx: { continued: true } },
    ])
  })

  it('stops early and records remaining steps as skip', () => {
    const flow = createSyncFlow<string, string>('S1', 'Stop early', ({ amount }: { amount: number }) =>
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
    const flow = createSyncFlow('S1', 'Throw', ({ amount }: { amount: number }) => {
      if (amount >= 0) {
        throw new Error('boom')
      }

      return { unreachable: true }
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
    const flow = createSyncFlow('S1', 'Add total', ({ amount }: { amount: number }) => ({
      total: amount,
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
      .step('S1', 'Invalid async in sync flow', (({ amount }: { amount: number }) =>
        Promise.resolve({ later: amount > 0 })) as never)
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
    const flow = createAsyncFlow<string, string>('A1', 'Load multiplier', async ({ amount }: { amount: number }) => ({
      multiplier: amount > 5 ? 3 : 2,
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

  it('supports createSyncFlow(id, description, fn) without explicit type signatures', () => {
    const flow = createSyncFlow('S1', 'Normalize amount', ({ amount }: { amount: number }) => ({
      normalizedAmount: Math.abs(amount),
    }))
      .step('S2', 'Classify amount', ({ normalizedAmount }) => ({
        isLarge: normalizedAmount >= 100,
      }))
      .build()

    const result = flow.run({ amount: -120 })

    expect(result.ok).toBe(true)
    expect(flow.steps).toMatchObject([
      { id: 'S1', description: 'Normalize amount' },
      { id: 'S2', description: 'Classify amount' },
    ])
    expect(result.finalCtx).toEqual({
      amount: -120,
      normalizedAmount: 120,
      isLarge: true,
    })
  })

  it('supports createAsyncFlow(id, description, fn) without explicit type signatures', async () => {
    const flow = createAsyncFlow('A1', 'Load score', async ({ amount }: { amount: number }) => ({
      score: amount * 2,
    }))
      .step('A2', 'Approve score', async ({ score }) =>
        stepResult({
          info: 'Approved asynchronously.',
          approved: score > 10,
        })
      )
      .build()

    const result = await flow.run({ amount: 7 })

    expect(result.ok).toBe(true)
    expect(flow.steps).toMatchObject([
      { id: 'A1', description: 'Load score' },
      { id: 'A2', description: 'Approve score' },
    ])
    expect(result.finalCtx).toEqual({
      amount: 7,
      score: 14,
      approved: true,
    })
  })

  it('supports createSyncFlow/createAsyncFlow with custom step definitions and InitialCtx in the new generic order', async () => {
    const syncFlow = createSyncFlow<{ label: string }, { amount: number }, unknown>()
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

  it('supports createSyncFlow<StepDescription, Info>(id, description, fn) as the first step', () => {
    type StepMeta = { label: string }
    type InfoMeta = { reason: string }

    const flow = createSyncFlow<StepMeta, InfoMeta>('S1', { label: 'Add tax' }, ({ amount }: { amount: number }) =>
      stepResult({
        info: { reason: 'applied default rate' },
        taxedAmount: amount * 1.24,
      })
    )
      .step('S2', { label: 'Finalize total' }, ({ taxedAmount }) => ({
        finalAmount: Math.round(taxedAmount * 100) / 100,
      }))
      .build()

    const result = flow.run({ amount: 10 })

    expect(flow.steps).toMatchObject([
      { id: 'S1', description: { label: 'Add tax' } },
      { id: 'S2', description: { label: 'Finalize total' } },
    ])
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'ok', info: { reason: 'applied default rate' }, addToCtx: { taxedAmount: 12.4 } },
      { id: 'S2', result: 'ok', addToCtx: { finalAmount: 12.4 } },
    ])
    expect(result.finalCtx).toEqual({ amount: 10, taxedAmount: 12.4, finalAmount: 12.4 })
  })

  it('supports createAsyncFlow<StepDescription, Info>(id, description, fn) as the first step', async () => {
    type StepMeta = { label: string }
    type InfoMeta = { source: string }

    const flow = createAsyncFlow<StepMeta, InfoMeta>(
      'A1',
      { label: 'Load multiplier' },
      async ({ amount }: { amount: number }) =>
        stepResult({
          info: { source: 'remote' },
          multiplier: amount > 0 ? 3 : 0,
        })
    )
      .step('A2', { label: 'Compute total' }, async ({ amount, multiplier }) => ({
        total: amount * multiplier,
      }))
      .build()

    const result = await flow.run({ amount: 7 })

    expect(flow.steps).toMatchObject([
      { id: 'A1', description: { label: 'Load multiplier' } },
      { id: 'A2', description: { label: 'Compute total' } },
    ])
    expect(result.stepResults).toEqual([
      { id: 'A1', result: 'ok', info: { source: 'remote' }, addToCtx: { multiplier: 3 } },
      { id: 'A2', result: 'ok', addToCtx: { total: 21 } },
    ])
    expect(result.finalCtx).toEqual({ amount: 7, multiplier: 3, total: 21 })
  })

  it('enriches results with step descriptions, including nested branch results', () => {
    const approvedFlow = createSyncFlow<{ label: string }>(
      'APP-1',
      { label: 'Approve request' },
      ({ amount }: { amount: number; route: 'approved' | 'rejected' }) => ({
        approvedTotal: amount + 1,
      })
    )

    const rejectedFlow = createSyncFlow<{ label: string }>(
      'REJ-1',
      { label: 'Reject request' },
      ({ amount }: { amount: number; route: 'approved' | 'rejected' }) => ({
        rejectionCode: amount > 0 ? 'manual-review' : 'auto-review',
      })
    )

    const flow = createSyncFlow<{ label: string }>(
      'BR-1',
      { label: 'Route request' },
      ({ route }: { amount: number; route: 'approved' | 'rejected' }) => route,
      {
        approved: approvedFlow,
        rejected: rejectedFlow,
      }
    )
      .step('AFTER', { label: 'Continue parent flow' }, () => ({
        parentCompleted: true,
      }))
      .build()

    const result = flow.run({ amount: 4, route: 'approved' })
    const enrichedResult = result.enrichResult()

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

  it('supports empty flows and empty enriched results', () => {
    const flow = createSyncFlow<{ amount: number }>().build()

    const result = flow.run({ amount: 10 })
    const enrichedResult = result.enrichResult()

    expect(result.ok).toBe(true)
    expect(result.failedStepIds()).toEqual([])
    expect(result.finalCtx).toEqual({ amount: 10 })
    expect(result.stepResults).toEqual([])

    expect(enrichedResult.ok).toBe(true)
    expect(enrichedResult.failedStepIds()).toEqual([])
    expect(enrichedResult.finalCtx).toEqual({ amount: 10 })
    expect(enrichedResult.stepResults).toEqual([])
  })
})
