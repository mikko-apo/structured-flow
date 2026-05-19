import { describe, expect, it } from 'vitest'

import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'
import { renderProcessAsMermaidGraph } from '../mermaidRenderer'

describe('renderProcessAsMermaidGraph branch rendering', () => {
  it('shows nested branch steps for a single selected branch', () => {
    const incomeFlow = createSyncFlow<{ kind: 'income' | 'expense' }>()
      .step('IN-1', 'Handle income', () => ({
        accepted: true,
      }))
      .build()

    const expenseFlow = createSyncFlow<{ kind: 'income' | 'expense' }>()
      .step('EX-1', 'Handle expense', () => ({
        accepted: true,
      }))
      .build()

    const flow = createSyncFlow<{ kind: 'income' | 'expense' }>()
      .branch('ROUTE', 'Route kind', ({ kind }) => kind, {
        income: incomeFlow,
        expense: expenseFlow,
      })
      .build()

    const result = flow.run({ kind: 'expense' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('step_0["ROUTE: Route kind\nbranches: expense\n[ok]"]')
    expect(graph).toContain('branch_0_0_start["Branch: expense"]')
    expect(graph).toContain('branch_0_0_step_0["EX-1: Handle expense\n[ok]"]')
    expect(graph).toContain('branch_0_1_start["Branch: income\n[skip]"]')
    expect(graph).toContain('branch_0_1_step_0["IN-1: Handle income\n[skip]"]')
    expect(graph).toContain('branch_0_end["ROUTE:\nend"]')
    expect(graph).toContain('step_0 --> branch_0_0_start')
    expect(graph).toContain('branch_0_end --> done')
    expect(graph).toContain('branch_0_0_step_0 --> branch_0_end')
    expect(graph).toContain('branch_0_1_step_0 --> branch_0_end')
    expect(graph).not.toContain('\n  step_0 --> branch_0_end\n')
    expect(graph).not.toContain('branch_0_result')
  })

  it('shows nested branch steps and info for multiple selected branches', async () => {
    const taxFlow = createAsyncFlow<{ checks: Array<'tax' | 'fraud' | 'policy'> }>()
      .step('TAX-1', 'Check taxes', async () => ({
        checked: true,
      }))
      .build()

    const fraudFlow = createAsyncFlow<{ checks: Array<'tax' | 'fraud' | 'policy'> }, string>()
      .step('FRAUD-1', 'Check fraud', async () =>
        stepResult({
          result: 'error',
          info: 'Fraud review failed.',
        })
      )
      .build()

    const policyFlow = createAsyncFlow<{ checks: Array<'tax' | 'fraud' | 'policy'> }>()
      .step('POLICY-1', 'Check policy', async () => ({
        checkedPolicy: true,
      }))
      .build()

    const flow = createAsyncFlow<{ checks: Array<'tax' | 'fraud' | 'policy'> }>()
      .branch('CHECKS', 'Run checks', ({ checks }) => checks, {
        tax: taxFlow,
        fraud: fraudFlow,
        policy: policyFlow,
      })
      .build()

    const result = await flow.run({ checks: ['tax', 'fraud'] })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('step_0["CHECKS: Run checks\nbranches: tax, fraud\n[error]"]')
    expect(graph).toContain('branch_0_0_start["Branch: tax"]')
    expect(graph).toContain('branch_0_0_step_0["TAX-1: Check taxes\n[ok]"]')
    expect(graph).toContain('branch_0_end["CHECKS:\nend"]')
    expect(graph).toContain('branch_0_end --> done')
    expect(graph).toContain('branch_0_1_start["Branch: fraud"]')
    expect(graph).toContain('branch_0_1_step_0["FRAUD-1: Check fraud\n[error]\nFraud review failed."]')
    expect(graph).toContain('branch_0_2_start["Branch: policy\n[skip]"]')
    expect(graph).toContain('branch_0_2_step_0["POLICY-1: Check policy\n[skip]"]')
    expect(graph).toContain('branch_0_0_step_0 --> branch_0_end')
    expect(graph).toContain('branch_0_1_step_0 --> branch_0_end')
    expect(graph).toContain('branch_0_2_step_0 --> branch_0_end')
    expect(graph).not.toContain('\n  step_0 --> branch_0_end\n')
    expect(graph).not.toContain('branch_0_result')
  })

  it('renders nested branch graphs inside a selected branch', () => {
    const branchAFlow = createSyncFlow<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .step('A-1', 'Handle A', () => ({
        visitedA: true,
      }))
      .build()

    const branchCFlow = createSyncFlow<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .step('C-1', 'Handle C', () => ({
        visitedC: true,
      }))
      .build()

    const branchDFlow = createSyncFlow<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .step('D-1', 'Handle D', () => ({
        visitedD: true,
      }))
      .build()

    const branchBFlow = createSyncFlow<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .branch('B-ROUTE', 'Route nested branch', ({ secondBranch }) => secondBranch, {
        C: branchCFlow,
        D: branchDFlow,
      })
      .build()

    const flow = createSyncFlow<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .branch('ROOT-ROUTE', 'Route root branch', ({ firstBranch }) => firstBranch, {
        A: branchAFlow,
        B: branchBFlow,
      })
      .build()

    const result = flow.run({ firstBranch: 'B', secondBranch: 'D' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('step_0["ROOT-ROUTE: Route root branch\nbranches: B\n[ok]"]')
    expect(graph).toContain('branch_0_0_start["Branch: B"]')
    expect(graph).toContain('branch_0_0_step_0["B-ROUTE: Route nested branch\nbranches: D\n[ok]"]')
    expect(graph).toContain('branch_0_0_step_0_branch_0_start["Branch: D"]')
    expect(graph).toContain('branch_0_0_step_0_branch_0_step_0["D-1: Handle D\n[ok]"]')
    expect(graph).toContain('branch_0_0_step_0_branch_1_start["Branch: C\n[skip]"]')
    expect(graph).toContain('branch_0_end["ROOT-ROUTE:\nend"]')
    expect(graph).toContain('branch_0_end --> done')
    expect(graph).toContain('branch_0_0_step_0_branch_end["B-ROUTE:\nend"]')
    expect(graph).toContain('branch_0_0_step_0_branch_end --> branch_0_end')
    expect(graph).toContain('branch_0_0_step_0_branch_0_step_0 --> branch_0_0_step_0_branch_end')
    expect(graph).toContain('branch_0_0_step_0_branch_1_step_0 --> branch_0_0_step_0_branch_end')
    expect(graph).not.toContain('\n  step_0 --> branch_0_end\n')
    expect(graph).not.toContain('branch_0_0_step_0 --> branch_0_0_step_0_branch_end')
    expect(graph).not.toContain('branch_0_0_step_0_branch_result')
    expect(graph).not.toContain('branch_0_result')
  })

  it('renders structured step definitions without JSON syntax that breaks Mermaid parsing', () => {
    type StepMeta = {
      label: string
      area: 'billing' | 'risk'
      severity: 'low' | 'high'
    }

    const manualFlow = createSyncFlow<StepMeta, { amount: number; normalizedAmount: number }, unknown>()
      .step('MANUAL-1', { label: 'Manual review', area: 'risk', severity: 'high' }, () => ({
        queued: true,
      }))
      .build()

    const flow = createSyncFlow<StepMeta, { amount: number }, unknown>()
      .step('VALIDATE', { label: 'Validate amount', area: 'billing', severity: 'high' }, ({ amount }) => ({
        normalizedAmount: Math.abs(amount),
      }))
      .branch(
        'ROUTE',
        { label: 'Route review', area: 'risk', severity: 'low' },
        ({ normalizedAmount }) => (normalizedAmount > 1000 ? 'manual' : 'skip'),
        {
          manual: manualFlow,
        }
      )
      .build()

    const graph = renderProcessAsMermaidGraph(flow.run({ amount: -1400 }))

    expect(graph).toContain('VALIDATE: label=Validate amount, area=billing, severity=high')
    expect(graph).toContain('ROUTE: label=Route review, area=risk, severity=low')
    expect(graph).toContain('MANUAL-1: label=Manual review, area=risk, severity=high')
    expect(graph).not.toContain('{\\"label\\":')
  })
})
