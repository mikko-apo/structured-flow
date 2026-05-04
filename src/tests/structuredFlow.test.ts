import { describe, expect, it } from 'vitest'

import { createAsync, createSync, stepResult } from '../structuredFlow'

describe('structuredFlow core execution', () => {
  it('accumulates ctx from successful sync steps', () => {
    const flow = createSync<{ amount: number }, string>()
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
    expect(result.ctx).toEqual({
      amount: 10,
      taxedAmount: 12.4,
      finalAmount: 12.4,
    })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'ok' },
      { id: 'S2', result: 'ok', info: 'Total finalized.' },
    ])
  })

  it('continues after error and marks the flow as failed', () => {
    const flow = createSync<{ amount: number }, string>()
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
    expect(result.ctx).toEqual({
      amount: 10,
      afterError: true,
    })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'error', info: 'Amount failed validation.' },
      { id: 'S2', result: 'ok' },
    ])
  })

  it('stops early and records remaining steps as skip', () => {
    const flow = createSync<{ amount: number }, string>()
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
    expect(result.ctx).toEqual({
      amount: 10,
      stoppedAmount: 10,
    })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'stop', info: 'Enough information collected.' },
      { id: 'S2', result: 'skip' },
    ])
  })

  it('converts thrown exceptions into exception results and skips the rest', () => {
    const flow = createSync<{ amount: number }>()
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
    expect(result.ctx).toEqual({ amount: 10 })
    expect(result.stepResults).toEqual([
      { id: 'S1', result: 'exception' },
      { id: 'S2', result: 'skip' },
    ])
  })

  it('rejects ctx overwrites from later steps', () => {
    const flow = createSync<{ amount: number }>()
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
      { id: 'S1', result: 'ok' },
      { id: 'S2', result: 'exception' },
    ])
    expect(result.ctx).toEqual({
      amount: 10,
      total: 10,
    })
  })

  it('rejects promises returned from sync flows', () => {
    const flow = createSync<{ amount: number }>()
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
    const flow = createAsync<{ amount: number }, string>()
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
    expect(result.ctx).toEqual({
      amount: 7,
      multiplier: 3,
      total: 21,
    })
    expect(result.stepResults).toEqual([
      { id: 'A1', result: 'ok' },
      { id: 'A2', result: 'ok', info: 'Computed asynchronously.' },
    ])
  })
})
