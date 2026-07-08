import { describe, expect, it } from 'vitest'

import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'
import { renderProcessAsMermaidGraph } from '../mermaidRenderer'

describe('renderProcessAsMermaidGraph branch rendering', () => {
  it('renders empty flows and empty results as start-to-done graphs', () => {
    const flow = createSyncFlow<{ amount: number }>().build()

    const staticGraph = renderProcessAsMermaidGraph(flow)
    const resultGraph = renderProcessAsMermaidGraph(flow.run({ amount: 10 }))

    expect(staticGraph).toContain('flowchart TD')
    expect(staticGraph).toContain('start([Start])')
    expect(staticGraph).toContain('done([Done])')
    expect(staticGraph).toContain('start --> done')
    expect(staticGraph).not.toContain('step_0[')

    expect(resultGraph).toContain('done([Done])')
    expect(resultGraph).toContain('start --> done')
    expect(resultGraph).not.toContain('step_0[')
  })

  it('shows nested branch steps for a single selected branch', () => {
    const incomeFlow = createSyncFlow('IN-1', 'Handle income', ({ kind }: { kind: 'income' | 'expense' }) => ({
      accepted: kind === 'income',
    })).build()

    const expenseFlow = createSyncFlow('EX-1', 'Handle expense', ({ kind }: { kind: 'income' | 'expense' }) => ({
      accepted: kind === 'expense',
    })).build()

    const flow = createSyncFlow('ROUTE', 'Route kind', ({ kind }: { kind: 'income' | 'expense' }) => kind, {
      income: incomeFlow,
      expense: expenseFlow,
    }).build()

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

  it('renders static branch graphs from flow metadata', () => {
    const incomeFlow = createSyncFlow('IN-1', 'Handle income', ({ kind }: { kind: 'income' | 'expense' }) => ({
      accepted: kind === 'income',
    })).build()

    const expenseFlow = createSyncFlow('EX-1', 'Handle expense', ({ kind }: { kind: 'income' | 'expense' }) => ({
      accepted: kind === 'expense',
    })).build()

    const flow = createSyncFlow('ROUTE', 'Route kind', ({ kind }: { kind: 'income' | 'expense' }) => kind, {
      income: incomeFlow,
      expense: expenseFlow,
    }).build()

    const graph = renderProcessAsMermaidGraph(flow)

    expect(graph).toContain('step_0["ROUTE: Route kind\nbranches: income, expense"]')
    expect(graph).toContain('branch_0_0_start["Branch: income"]')
    expect(graph).toContain('branch_0_0_step_0["IN-1: Handle income"]')
    expect(graph).toContain('branch_0_1_start["Branch: expense"]')
    expect(graph).toContain('branch_0_1_step_0["EX-1: Handle expense"]')
    expect(graph).toContain('branch_0_end["ROUTE:\nend"]')
    expect(graph).toContain('branch_0_end --> done')
    expect(graph).not.toContain('\n  step_0 --> done\n')
  })

  it('shows nested branch steps and info for multiple selected branches', async () => {
    const taxFlow = createAsyncFlow(
      'TAX-1',
      'Check taxes',
      async ({ checks }: { checks: Array<'tax' | 'fraud' | 'policy'> }) => ({
        checked: checks.includes('tax'),
      })
    ).build()

    const fraudFlow = createAsyncFlow<string, string>(
      'FRAUD-1',
      'Check fraud',
      async ({ checks }: { checks: Array<'tax' | 'fraud' | 'policy'> }) =>
        stepResult({
          result: checks.includes('fraud') ? 'error' : 'skip',
          info: 'Fraud review failed.',
        })
    ).build()

    const policyFlow = createAsyncFlow(
      'POLICY-1',
      'Check policy',
      async ({ checks }: { checks: Array<'tax' | 'fraud' | 'policy'> }) => ({
        checkedPolicy: checks.includes('policy'),
      })
    ).build()

    const flow = createAsyncFlow(
      'CHECKS',
      'Run checks',
      ({ checks }: { checks: Array<'tax' | 'fraud' | 'policy'> }) => checks,
      {
        tax: taxFlow,
        fraud: fraudFlow,
        policy: policyFlow,
      }
    ).build()

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
    const branchAFlow = createSyncFlow(
      'A-1',
      'Handle A',
      ({ firstBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => ({
        visitedA: firstBranch === 'A',
      })
    ).build()

    const branchCFlow = createSyncFlow(
      'C-1',
      'Handle C',
      ({ secondBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => ({
        visitedC: secondBranch === 'C',
      })
    ).build()

    const branchDFlow = createSyncFlow(
      'D-1',
      'Handle D',
      ({ secondBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => ({
        visitedD: secondBranch === 'D',
      })
    ).build()

    const branchBFlow = createSyncFlow(
      'B-ROUTE',
      'Route nested branch',
      ({ secondBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => secondBranch,
      {
        C: branchCFlow,
        D: branchDFlow,
      }
    ).build()

    const flow = createSyncFlow(
      'ROOT-ROUTE',
      'Route root branch',
      ({ firstBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => firstBranch,
      {
        A: branchAFlow,
        B: branchBFlow,
      }
    ).build()

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

  it('renders nested static branch graphs from flow metadata', () => {
    const branchAFlow = createSyncFlow(
      'A-1',
      'Handle A',
      ({ firstBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => ({
        visitedA: firstBranch === 'A',
      })
    ).build()

    const branchCFlow = createSyncFlow(
      'C-1',
      'Handle C',
      ({ secondBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => ({
        visitedC: secondBranch === 'C',
      })
    ).build()

    const branchDFlow = createSyncFlow(
      'D-1',
      'Handle D',
      ({ secondBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => ({
        visitedD: secondBranch === 'D',
      })
    ).build()

    const branchBFlow = createSyncFlow(
      'B-ROUTE',
      'Route nested branch',
      ({ secondBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => secondBranch,
      {
        C: branchCFlow,
        D: branchDFlow,
      }
    ).build()

    const flow = createSyncFlow(
      'ROOT-ROUTE',
      'Route root branch',
      ({ firstBranch }: { firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }) => firstBranch,
      {
        A: branchAFlow,
        B: branchBFlow,
      }
    ).build()

    const graph = renderProcessAsMermaidGraph(flow)

    expect(graph).toContain('step_0["ROOT-ROUTE: Route root branch\nbranches: A, B"]')
    expect(graph).toContain('branch_0_1_start["Branch: B"]')
    expect(graph).toContain('branch_0_1_step_0["B-ROUTE: Route nested branch\nbranches: C, D"]')
    expect(graph).toContain('branch_0_1_step_0_branch_0_start["Branch: C"]')
    expect(graph).toContain('branch_0_1_step_0_branch_0_step_0["C-1: Handle C"]')
    expect(graph).toContain('branch_0_1_step_0_branch_1_start["Branch: D"]')
    expect(graph).toContain('branch_0_1_step_0_branch_1_step_0["D-1: Handle D"]')
    expect(graph).toContain('branch_0_1_step_0_branch_end["B-ROUTE:\nend"]')
    expect(graph).toContain('branch_0_end["ROOT-ROUTE:\nend"]')
    expect(graph).not.toContain('\n  step_0 --> done\n')
  })

  it('renders structured step definitions without JSON syntax that breaks Mermaid parsing', () => {
    type StepMeta = {
      label: string
      area: 'billing' | 'risk'
      severity: 'low' | 'high'
    }

    const manualFlow = createSyncFlow(
      'MANUAL-1',
      { label: 'Manual review', area: 'risk', severity: 'high' },
      ({ normalizedAmount }: { amount: number; normalizedAmount: number }) => ({
        queued: normalizedAmount > 1000,
      })
    ).build()

    const autoFlow = createSyncFlow(
      'AUTO-1',
      { label: 'Auto review', area: 'risk', severity: 'low' },
      ({ normalizedAmount }: { amount: number; normalizedAmount: number }) => ({
        autoApproved: normalizedAmount <= 1000,
      })
    ).build()

    const flow = createSyncFlow<StepMeta>(
      'VALIDATE',
      { label: 'Validate amount', area: 'billing', severity: 'high' },
      ({ amount }: { amount: number }) => ({
        normalizedAmount: Math.abs(amount),
      })
    )
      .branch(
        'ROUTE',
        { label: 'Route review', area: 'risk', severity: 'low' },
        ({ normalizedAmount }) => (normalizedAmount > 1000 ? 'manual' : 'auto'),
        {
          auto: autoFlow,
          manual: manualFlow,
        }
      )
      .build()

    const graph = renderProcessAsMermaidGraph(flow.run({ amount: -1400 }))

    expect(graph).toContain('VALIDATE: label=Validate amount, area=billing, severity=high')
    expect(graph).toContain('ROUTE: label=Route review, area=risk, severity=low')
    expect(graph).toContain('MANUAL-1: label=Manual review, area=risk, severity=high')
    expect(graph).toContain('AUTO-1: label=Auto review, area=risk, severity=low')
    expect(graph).not.toContain('{\\"label\\":')
  })
})
