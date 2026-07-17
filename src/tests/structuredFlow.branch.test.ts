import { describe, expect, expectTypeOf, it } from 'vitest'

import { collectFailedStepIds, convertResultNode } from '../resultUtils.ts'
import { BranchStepFlowResult, StepBranchInfo, StepResult } from '../flowClasses'
import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'

type ReviewData = {
  route: 'approve' | 'reject'
  severity: 'low' | 'high'
  checks: Array<'audit' | 'rules'>
}

type StepMeta = {
  id: string
  description: string
  fn?: (data: ReviewData) => Record<string, unknown> | Promise<Record<string, unknown>>
}

function resolveStepMeta({
  id,
  description,
}: {
  id: StepMeta
  description?: string
}) {
  return {
    id: id.id,
    description: description ?? id.description,
  }
}

function createSyncMetaFlow() {
  return createSyncFlow<StepMeta, ReviewData>({
    resolver: resolveStepMeta,
  })
}

function createAsyncMetaFlow() {
  return createAsyncFlow<StepMeta, ReviewData>({
    resolver: resolveStepMeta,
  })
}

describe('FlowBuilder.branch', () => {
  it('passes a separate ctx to branch select when the builder uses withContext()', () => {
    type RequestCtx = {
      allowReject: boolean
    }

    const builder = createSyncMetaFlow().withContext<RequestCtx>()
    const approveFlow = builder.step({
      id: 'APP-CTX-1',
      description: 'Approve branch',
      fn: ({ severity }) => ({
        approvedSeverity: severity,
      }),
    })
    const rejectFlow = builder.step({
      id: 'REJ-CTX-1',
      description: 'Reject branch',
      fn: ({ severity }) => ({
        rejectedSeverity: severity,
      }),
    })

    const flow = builder
      .branch(
        {
          id: 'ROUTE-CTX-1',
          description: 'Route with ctx',
        },
        (data, ctx) => (ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
        {
          approve: approveFlow,
          reject: rejectFlow,
        }
      )
      .build()

    const result = flow.run(
      {
        route: 'reject',
        severity: 'high',
        checks: [],
      },
      { allowReject: false }
    )

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [{ selectedBranchKeys: ['approve'] }],
    })
  })

  it('allows non-context child flows inside a context flow', () => {
    type RequestCtx = {
      allowReject: boolean
    }

    const childFlow = createSyncMetaFlow().step({
      id: 'NOCTX-1',
      description: 'No ctx child',
      fn: ({ severity }) => ({
        severitySeen: severity,
      }),
    })

    const flow = createSyncMetaFlow()
      .withContext<RequestCtx>()
      .branch(
        {
          id: 'ROUTE-NOCTX-1',
          description: 'Route to no ctx child',
        },
        (data, ctx) => (ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
        {
          approve: childFlow,
          reject: childFlow,
        }
      )
      .build()

    const result = flow.run(
      {
        route: 'approve',
        severity: 'low',
        checks: [],
      },
      { allowReject: true }
    )

    expect(result.status).toBe('ok')
  })

  it('maps branch run data with map()', () => {
    const childFlow = createSyncFlow<Pick<ReviewData, 'route'>>()
      .step(
        'MAP-DATA-CHILD-1',
        ({ route }) => ({
          routeSeen: route,
        }),
        { description: 'Uses mapped branch data' }
      )
      .build()

    const flow = createSyncMetaFlow()
      .branch(
        {
          id: 'MAP-DATA-1',
          description: 'Map branch data',
        },
        ({ route }: Pick<ReviewData, 'route'>) => route,
        {
          approve: childFlow,
          reject: childFlow,
        },
        {
          map: ({ data }: { id: StepMeta; data: ReviewData; ctx: undefined }) => ({ route: data.route }),
        }
      )
      .build()

    const result = flow.run({
      route: 'approve',
      severity: 'high',
      checks: ['audit'],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          id: 'MAP-DATA-1',
          branches: [
            {
              key: 'approve',
              stepResults: [{ id: 'MAP-DATA-CHILD-1', result: { routeSeen: 'approve' } }],
            },
            { key: 'reject', status: 'skip' },
          ],
        },
      ],
    })
  })

  it('maps branch inputs with map()', () => {
    type ParentCtx = {
      allowReject: boolean
    }

    type ChildData = {
      route: ReviewData['route']
      severity: ReviewData['severity']
      actorId: string
    }

    const childFlow = createSyncFlow<ChildData>()
      .step(
        'MAP-PARAMS-CHILD-1',
        ({ route, severity, actorId }) => ({
          routeSeen: route,
          severitySeen: severity,
          actorId,
        }),
        { description: 'Uses mapped branch params' }
      )
      .build()

    const flow = createSyncMetaFlow()
      .withContext<ParentCtx>()
      .branch(
        {
          id: 'MAP-PARAMS-1',
          description: 'Map branch ctx only',
        },
        ({ route }: ChildData) => route,
        {
          approve: childFlow,
          reject: childFlow,
        },
        {
          map: ({ data, ctx }: { id: StepMeta; data: ReviewData; ctx: ParentCtx }) => {
            void ctx.allowReject
            return {
              route: data.route,
              severity: data.severity,
              actorId: 'branch-actor',
            } satisfies ChildData
          },
        }
      )
      .build()

    const result = flow.run(
      {
        route: 'approve',
        severity: 'low',
        checks: [],
      },
      { allowReject: true }
    )

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          id: 'MAP-PARAMS-1',
          branches: [
            {
              key: 'approve',
              stepResults: [
                {
                  id: 'MAP-PARAMS-CHILD-1',
                  result: { routeSeen: 'approve', severitySeen: 'low', actorId: 'branch-actor' },
                },
              ],
            },
            { key: 'reject', status: 'skip' },
          ],
        },
      ],
    })
  })

  it('rejects context child flows in non-context branches at runtime', () => {
    type ChildCtx = {
      actorId: string
    }

    const parentBuilder = createSyncMetaFlow()
    const childFlow = createSyncMetaFlow()
      .withContext<ChildCtx>()
      .step(
        {
          id: 'CTX-CHILD-0',
          description: 'Child with context',
        },
        ({ severity }, ctx) => ({
          severitySeen: severity,
          actorId: ctx.actorId,
        })
      )
      .build()

    expect(() =>
      (parentBuilder.branch as (...args: any[]) => unknown)(
        {
          id: 'ROUTE-CTX-NOCTX-1',
          description: 'No context parent',
        },
        () => 'approve',
        {
          approve: childFlow,
        }
      )
    ).toThrow('Flow branch "ROUTE-CTX-NOCTX-1" cannot include context flow "approve" without withContext()')
  })

  it('rejects mismatched context flows in branch at type level', () => {
    type ParentCtx = {
      allowReject: boolean
    }

    type ChildCtx = {
      actorId: string
    }

    const parentBuilder = createSyncMetaFlow().withContext<ParentCtx>()
    const childFlow = createSyncMetaFlow()
      .withContext<ChildCtx>()
      .step(
        {
          id: 'CTX-CHILD-1',
          description: 'Child with different context',
        },
        ({ severity }, ctx) => ({
          severitySeen: severity,
          actorId: ctx.actorId,
        })
      )
      .build()

    parentBuilder.branch(
      {
        id: 'ROUTE-CTX-MISMATCH-1',
        description: 'Mismatch branch',
      },
      () => 'approve' as const,
      {
        // @ts-expect-error child context must match parent context type
        approve: childFlow,
      }
    )
  })

  it('rejects mismatched data flows in branch at type level', () => {
    const parentBuilder = createSyncMetaFlow()
    const childFlow = createSyncFlow<{ other: string }>().build()

    parentBuilder.branch(
      {
        id: 'ROUTE-DATA-MISMATCH-1',
        description: 'Data mismatch branch',
      },
      () => 'approve' as const,
      {
        // @ts-expect-error child data must match parent data
        approve: childFlow,
      }
    )
  })

  it('requires branch map output to match child flow run types at type level', () => {
    type ChildData = {
      route: ReviewData['route']
      actorId: string
    }

    const builder = createSyncMetaFlow().withContext<{ allowReject: boolean }>()
    const childFlow = createSyncFlow<ChildData>().build()

    builder.branch(
      {
        id: 'MAP-TYPE-OK',
        description: 'Mapped params branch',
      },
      () => 'approve' as const,
      {
        approve: childFlow,
      },
      {
        map: ({
          data,
        }: {
          id: StepMeta
          data: ReviewData
          ctx: { allowReject: boolean }
        }) => ({
          route: data.route,
          actorId: 'ok',
        }),
      }
    )

    builder.branch(
      {
        id: 'MAP-TYPE-FAIL',
        description: 'Invalid mapped params branch',
      },
      () => 'approve' as const,
      {
        // @ts-expect-error mapped child params must match the child flow
        approve: childFlow,
      },
      {
        map: ({ data }: { id: StepMeta; data: ReviewData; ctx: { allowReject: boolean } }) => ({
          route: data.route,
          wrong: true,
        }),
      }
    )
  })

  it('uses resolver descriptions for branches and keeps child payloads out of the parent data', () => {
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
    const firstStep = result.stepResults[0] as StepResult<any, any>
    expect(firstStep.branches?.[0]).toBeInstanceOf(BranchStepFlowResult)
    expect(firstStep.selectedBranchKeys).toEqual(['reject'])
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
    expect((result.stepResults[0] as StepResult<any, any>).selectedBranchKeys).toEqual(['audit', 'rules'])
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
    expect((result.stepResults[0] as StepResult<any, any>).selectedBranchKeys).toEqual(['reject'])
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
    expect((result.stepResults[0] as StepResult<any, any>).selectedBranchKeys).toEqual([rejectKey])
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
      // @ts-expect-error invalid selector data contract
      ({ missing }: { missing: string }) => missing,
      {}
    )

    expect(builder.build().steps).toBeDefined()
  })

  it('infers the first-branch ctx from the selector', () => {
    const firstBranchFlow = createAsyncFlow(
      'FIRST-BRANCH',
      ({ route }: Pick<ReviewData, 'route'>) => route,
      {
        approve: createAsyncFlow<Pick<ReviewData, 'route'>>()
          .step('APP-FIRST', async () => ({ approved: true }), { description: 'Approve first branch' })
          .build(),
        reject: createAsyncFlow<Pick<ReviewData, 'route'>>()
          .step('REJ-FIRST', async () => ({ rejected: true }), { description: 'Reject first branch' })
          .build(),
      },
      { description: 'First branch entrypoint' }
    ).build()

    expect(firstBranchFlow.steps).toHaveLength(1)
    expectTypeOf<Parameters<typeof firstBranchFlow.run>[0]>().toEqualTypeOf<Pick<ReviewData, 'route'>>()
  })
})
