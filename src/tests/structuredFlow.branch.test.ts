import { describe, expect, expectTypeOf, it } from 'vitest'

import { collectFailedStepIds, convertResultNode } from '../resultUtils.ts'
import { BranchStepFlowResult, StepBranchInfo, StepResult } from '../flowClasses'
import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'

type ReviewCtx = {
  route: 'approve' | 'reject'
  severity: 'low' | 'high'
  checks: Array<'audit' | 'rules'>
}

type StepMeta = {
  id: string
  description: string
  fn?: (ctx: ReviewCtx) => Record<string, unknown> | Promise<Record<string, unknown>>
}

function createSyncMetaFlow() {
  return createSyncFlow<StepMeta, ReviewCtx>({
    resolver: (step) => ({
      id: step.id,
      description: step.description,
      stepFn: step.fn,
    }),
  })
}

function createAsyncMetaFlow() {
  return createAsyncFlow<StepMeta, ReviewCtx>({
    resolver: (step) => ({
      id: step.id,
      description: step.description,
      stepFn: step.fn,
    }),
  })
}

describe('FlowBuilder.branch', () => {
  it('uses resolver descriptions for branches and keeps child payloads out of the parent ctx', () => {
    const approvedFlow = createSyncMetaFlow().step({
      id: 'APP-1',
      description: 'Approve request',
      fn: ({ severity }) => ({
        approvedSeverity: severity,
      }),
    })

    const rejectedFlow = createSyncMetaFlow().step({
      id: 'REJ-1',
      description: 'Reject request',
      fn: ({ severity }) => ({
        rejectedSeverity: severity,
      }),
    })

    const flow = createSyncMetaFlow()
      .branch(
        {
          id: 'ROUTE-1',
          description: 'Route request',
        },
        ({ route }) => route,
        {
          approve: approvedFlow,
          reject: rejectedFlow,
        },
        { description: 'Route by review decision' }
      )
      .step(
        {
          id: 'AFTER-1',
          description: 'After branch',
        },
        ({ checks }) => ({
          checksSeen: checks.length,
        })
      )
      .build()

    const result = flow.run({
      route: 'reject',
      severity: 'high',
      checks: ['audit'],
    })

    expect(flow.steps).toMatchObject([
      { id: 'ROUTE-1', options: { description: 'Route by review decision' } },
      { id: 'AFTER-1', options: { description: 'After branch' } },
    ])
    expect(flow.steps[0]).toBeInstanceOf(StepBranchInfo)
    expect(result.status).toBe('ok')
    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    expect(result.stepResults[0].branches?.[0]).toBeInstanceOf(BranchStepFlowResult)
    expect(result.stepResults[0].selectedBranchKeys).toEqual(['reject'])
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        {
          id: 'ROUTE-1',
          description: 'Route by review decision',
          status: 'ok',
          selectedBranchKeys: ['reject'],
          branches: [
            {
              key: 'reject',
              status: 'ok',
              stepResults: [
                { id: 'REJ-1', description: 'Reject request', status: 'ok', result: { rejectedSeverity: 'high' } },
              ],
            },
            {
              key: 'approve',
              status: 'skip',
              stepResults: [{ id: 'APP-1', description: 'Approve request', status: 'skip' }],
            },
          ],
        },
        { id: 'AFTER-1', description: 'After branch', status: 'ok', result: { checksSeen: 1 } },
      ],
    })
  })

  it('reports failures from branch steps and nested child steps', async () => {
    const auditFlow = createAsyncMetaFlow().step({
      id: 'AUDIT-1',
      description: 'Audit request',
      fn: async () => ({
        audited: true,
      }),
    })

    const rulesFlow = createAsyncMetaFlow().step({
      id: 'RULES-1',
      description: 'Check rules',
      fn: async ({ checks }) =>
        stepResult({
          status: checks.includes('rules') ? 'error' : 'ok',
          info: 'Rules rejected the request.',
        }),
    })

    const flow = createAsyncMetaFlow()
      .branch(
        {
          id: 'REVIEW-1',
          description: 'Run reviews',
        },
        ({ checks }) => checks,
        {
          audit: auditFlow,
          rules: rulesFlow,
        }
      )
      .step(
        {
          id: 'AFTER-2',
          description: 'Continue after branch',
        },
        async ({ severity }) => ({
          severitySeen: severity,
        })
      )
      .build()

    const result = await flow.run({
      route: 'approve',
      severity: 'low',
      checks: ['audit', 'rules'],
    })

    expect(result.status).toBe('error')
    expect(collectFailedStepIds(result.stepResults)).toEqual(['REVIEW-1', 'RULES-1'])
    expect(collectFailedStepIds(result.stepResults, { branchPrefix: true })).toEqual(['REVIEW-1', 'REVIEW-1/RULES-1'])
    expect(result.stepResults[0].selectedBranchKeys).toEqual(['audit', 'rules'])
    expect(convertResultNode(result)).toMatchObject({
      status: 'error',
      stepResults: [
        {
          id: 'REVIEW-1',
          status: 'error',
          selectedBranchKeys: ['audit', 'rules'],
          branches: [
            { key: 'audit', status: 'ok' },
            { key: 'rules', status: 'error' },
          ],
        },
        {
          id: 'AFTER-2',
          status: 'ok',
          result: { severitySeen: 'low' },
        },
      ],
    })
  })

  it('applies result remapping to the branch step itself', async () => {
    const failingFlow = createAsyncMetaFlow().step({
      id: 'FAIL-1',
      description: 'Fail branch',
      fn: async () =>
        stepResult({
          status: 'error',
          code: 'child-error',
        }),
    })

    const flow = createAsyncMetaFlow()
      .branch(
        {
          id: 'ROUTE-2',
          description: 'Ignore branch errors',
        },
        () => 'reject' as const,
        {
          reject: failingFlow,
        },
        { status: { error: 'ignore' } }
      )
      .build()

    const result = await flow.run({
      route: 'reject',
      severity: 'high',
      checks: [],
    })

    expect(result.status).toBe('ok')
    expect(result.stepResults[0].selectedBranchKeys).toEqual(['reject'])
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        {
          id: 'ROUTE-2',
          status: 'ok',
          originalStatus: 'error',
          selectedBranchKeys: ['reject'],
          branches: [
            {
              key: 'reject',
              status: 'error',
              stepResults: [{ id: 'FAIL-1', status: 'error', result: { code: 'child-error' } }],
            },
          ],
        },
      ],
    })
  })

  it('preserves symbol branch keys in branch results', () => {
    const approveKey = Symbol('approve')
    const rejectKey = Symbol('reject')
    const symbolBranches = {
      [approveKey]: createSyncMetaFlow().step({
        id: 'APP-SYMBOL',
        description: 'Approve with symbol key',
        fn: () => ({ approved: true }),
      }),
      [rejectKey]: createSyncMetaFlow().step({
        id: 'REJ-SYMBOL',
        description: 'Reject with symbol key',
        fn: () => ({ rejected: true }),
      }),
    }

    const flow = createSyncMetaFlow()
      .branch(
        {
          id: 'SYMBOL-BRANCH',
          description: 'Route using symbol keys',
        },
        () => rejectKey,
        symbolBranches
      )
      .build()

    const result = flow.run({
      route: 'reject',
      severity: 'high',
      checks: [],
    })

    expect(result.stepResults).toHaveLength(1)
    expect(result.stepResults[0].selectedBranchKeys).toEqual([rejectKey])
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        {
          id: 'SYMBOL-BRANCH',
          selectedBranchKeys: [rejectKey],
          branches: [
            {
              key: rejectKey,
              status: 'ok',
              stepResults: [{ id: 'REJ-SYMBOL', status: 'ok', result: { rejected: true } }],
            },
            {
              key: approveKey,
              status: 'skip',
              stepResults: [{ id: 'APP-SYMBOL', status: 'skip' }],
            },
          ],
        },
      ],
    })
  })

  it('rejects async child flows in sync branches', () => {
    const asyncChildFlow = createAsyncMetaFlow()
      .step({
        id: 'ASYNC-CHILD',
        description: 'Async child branch',
        fn: async () => ({
          loaded: true,
        }),
      })
      .build()

    expect(() =>
      createSyncMetaFlow().branch(
        {
          id: 'SYNC-PARENT',
          description: 'Sync branch parent',
        },
        () => 'reject' as const,
        {
          reject: asyncChildFlow as any,
        }
      )
    ).toThrow('cannot include async flow')
  })

  it('checks branch selectors against the flow ctx type', () => {
    const builder = createSyncMetaFlow()

    builder.branch(
      {
        id: 'TYPE-BRANCH',
        description: 'Uses route',
      },
      ({ route }) => route,
      {
        approve: createSyncMetaFlow().step({
          id: 'APPROVE',
          description: 'Approve',
          fn: () => ({ ok: true }),
        }),
        reject: createSyncMetaFlow().step({
          id: 'REJECT',
          description: 'Reject',
          fn: () => ({ ok: true }),
        }),
      }
    )

    builder.branch(
      {
        id: 'TYPE-FAIL',
        description: 'Invalid selector',
      },
      // @ts-expect-error invalid ctx contract
      ({ missing }: { missing: string }) => missing,
      {}
    )

    expect(builder.build().steps).toBeDefined()
  })

  it('infers the first-branch ctx from the selector', () => {
    const firstBranchFlow = createAsyncFlow(
      'FIRST-BRANCH',
      ({ route }: Pick<ReviewCtx, 'route'>) => route,
      {
        approve: createAsyncFlow<Pick<ReviewCtx, 'route'>>()
          .step('APP-FIRST', async () => ({ approved: true }), { description: 'Approve first branch' })
          .build(),
        reject: createAsyncFlow<Pick<ReviewCtx, 'route'>>()
          .step('REJ-FIRST', async () => ({ rejected: true }), { description: 'Reject first branch' })
          .build(),
      },
      { description: 'First branch entrypoint' }
    ).build()

    expect(firstBranchFlow.steps).toHaveLength(1)
    expectTypeOf<Parameters<typeof firstBranchFlow.run>[0]>().toEqualTypeOf<Pick<ReviewCtx, 'route'>>()
  })
})
