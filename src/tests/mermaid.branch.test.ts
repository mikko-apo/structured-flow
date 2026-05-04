import { describe, expect, it } from 'vitest'

import { createAsync, createSync, stepResult } from '../structuredFlow'
import { renderProcessAsMermaidGraph } from '../mermaid'

describe('renderProcessAsMermaidGraph branch rendering', () => {
  it('shows nested branch steps for a single selected branch', () => {
    const incomeFlow = createSync<{ kind: 'income' | 'expense' }>()
      .step('IN-1', 'Handle income', () => ({
        accepted: true,
      }))
      .build()

    const expenseFlow = createSync<{ kind: 'income' | 'expense' }>()
      .step('EX-1', 'Handle expense', () => ({
        accepted: true,
      }))
      .build()

    const flow = createSync<{ kind: 'income' | 'expense' }>()
      .branch('ROUTE', ({ kind }) => kind, {
        income: incomeFlow,
        expense: expenseFlow,
      })
      .build()

    const result = flow.run({ kind: 'expense' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('step_0["ROUTE:\nbranches: expense"]')
    expect(graph).toContain('branch_0_0_start["Branch: expense"]')
    expect(graph).toContain('branch_0_0_step_0["EX-1: Handle expense\n[ok]"]')
    expect(graph).toContain('branch_0_1_start["Branch: income\n[skip]"]')
    expect(graph).toContain('branch_0_1_step_0["IN-1: Handle income\n[skip]"]')
    expect(graph).toContain('branch_0_result["ROUTE:\nResult: ok"]')
    expect(graph).toContain('step_0 --> branch_0_0_start')
    expect(graph).toContain('branch_0_result --> done')
  })

  it('shows nested branch steps and info for multiple selected branches', async () => {
    const taxFlow = createAsync<{ checks: Array<'tax' | 'fraud' | 'policy'> }>()
      .step('TAX-1', 'Check taxes', async () => ({
        checked: true,
      }))
      .build()

    const fraudFlow = createAsync<{ checks: Array<'tax' | 'fraud' | 'policy'> }, string>()
      .step('FRAUD-1', 'Check fraud', async () =>
        stepResult({
          result: 'error',
          info: 'Fraud review failed.',
        })
      )
      .build()

    const policyFlow = createAsync<{ checks: Array<'tax' | 'fraud' | 'policy'> }>()
      .step('POLICY-1', 'Check policy', async () => ({
        checkedPolicy: true,
      }))
      .build()

    const flow = createAsync<{ checks: Array<'tax' | 'fraud' | 'policy'> }>()
      .branch('CHECKS', ({ checks }) => checks, {
        tax: taxFlow,
        fraud: fraudFlow,
        policy: policyFlow,
      })
      .build()

    const result = await flow.run({ checks: ['tax', 'fraud'] })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('step_0["CHECKS:\nbranches: tax, fraud"]')
    expect(graph).toContain('branch_0_0_start["Branch: tax"]')
    expect(graph).toContain('branch_0_0_step_0["TAX-1: Check taxes\n[ok]"]')
    expect(graph).toContain('branch_0_result["CHECKS:\nResult: error"]')
    expect(graph).toContain('branch_0_1_start["Branch: fraud"]')
    expect(graph).toContain('branch_0_1_step_0["FRAUD-1: Check fraud\n[error]\nFraud review failed."]')
    expect(graph).toContain('branch_0_2_start["Branch: policy\n[skip]"]')
    expect(graph).toContain('branch_0_2_step_0["POLICY-1: Check policy\n[skip]"]')
    expect(graph).toContain('branch_0_result --> done')
  })

  it('renders nested branch graphs inside a selected branch', () => {
    const branchAFlow = createSync<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .step('A-1', 'Handle A', () => ({
        visitedA: true,
      }))
      .build()

    const branchCFlow = createSync<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .step('C-1', 'Handle C', () => ({
        visitedC: true,
      }))
      .build()

    const branchDFlow = createSync<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .step('D-1', 'Handle D', () => ({
        visitedD: true,
      }))
      .build()

    const branchBFlow = createSync<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .branch('B-ROUTE', ({ secondBranch }) => secondBranch, {
        C: branchCFlow,
        D: branchDFlow,
      })
      .build()

    const flow = createSync<{ firstBranch: 'A' | 'B'; secondBranch: 'C' | 'D' }>()
      .branch('ROOT-ROUTE', ({ firstBranch }) => firstBranch, {
        A: branchAFlow,
        B: branchBFlow,
      })
      .build()

    const result = flow.run({ firstBranch: 'B', secondBranch: 'D' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('step_0["ROOT-ROUTE:\nbranches: B"]')
    expect(graph).toContain('branch_0_0_start["Branch: B"]')
    expect(graph).toContain('branch_0_0_step_0["B-ROUTE:\nbranches: D"]')
    expect(graph).toContain('branch_0_0_step_0_branch_0_start["Branch: D"]')
    expect(graph).toContain('branch_0_0_step_0_branch_0_step_0["D-1: Handle D\n[ok]"]')
    expect(graph).toContain('branch_0_0_step_0_branch_1_start["Branch: C\n[skip]"]')
    expect(graph).toContain('branch_0_0_step_0_branch_result["B-ROUTE:\nResult: ok"]')
    expect(graph).toContain('branch_0_result["ROOT-ROUTE:\nResult: ok"]')
  })
})
