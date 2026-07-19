import { describe, expect, expectTypeOf, it } from 'vitest'

import { collectFailedStepIds, convertResultNode } from '../resultUtils.ts'
import { BranchStepFlowResult, createAsyncFlow, createSyncFlow, error, ruleId, StepResult } from '../index'

type ReviewData = {
  route: 'approve' | 'reject'
  severity: 'low' | 'high'
  checks: Array<'audit' | 'rules'>
}

function meta(id: string, description: string) {
  return ruleId(id, { description })
}

function createSyncMetaFlow() {
  return createSyncFlow<ReviewData>()
}

function createAsyncMetaFlow() {
  return createAsyncFlow<ReviewData>()
}

describe('FlowBuilder.branch', () => {
  it('uses the flow resolver to map branch metadata', () => {
    const childFlow = createSyncMetaFlow().step(meta('BRANCH-RES-CHILD', 'Child branch'), ({ severity }, _params) => ({
      severitySeen: severity,
    }))

    const flow = createSyncFlow<ReviewData>({
      resolver: (stepId) =>
        typeof stepId === 'string'
          ? { id: `RES-${stepId}`, description: `Resolved ${stepId}` }
          : { id: `RES-${stepId.id}`, description: stepId.description },
    })
      .branch(
        ({ route }, _params) => route,
        {
          approve: childFlow,
          reject: childFlow,
        },
        { name: 'BRANCH-RES' }
      )
      .build()

    const result = flow.run({
      route: 'reject',
      severity: 'high',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [{ id: 'RES-BRANCH-RES', description: 'Resolved BRANCH-RES', selectedBranchKeys: ['reject'] }],
    })
  })

  it('allows branch selectors without a step id and uses options.name as the branch id', () => {
    const childFlow = createSyncMetaFlow().step(
      meta('NAMELESS-BRANCH-CHILD-1', 'Child branch'),
      ({ severity }, _params) => ({
        severitySeen: severity,
      })
    )

    const flow = createSyncMetaFlow()
      .branch(
        ({ route }, _params) => route,
        {
          approve: childFlow,
          reject: childFlow,
        },
        { name: 'route-by-name', description: 'Route by name' }
      )
      .build()

    const result = flow.run({
      route: 'approve',
      severity: 'low',
      checks: [],
    })

    expect(flow.steps[0]).toMatchObject({ id: 'route-by-name', options: { description: 'Route by name' } })
    expect(convertResultNode(result)).toMatchObject({
      stepResults: [{ id: 'route-by-name', selectedBranchKeys: ['approve'] }],
    })
  })

  it('passes a separate ctx to branch select when the builder uses withContext()', () => {
    type RequestCtx = {
      allowReject: boolean
    }

    const builder = createSyncMetaFlow().withContext<RequestCtx>()
    const approveFlow = builder.step(meta('APP-CTX-1', 'Approve branch'), ({ severity }, _params) => ({
      approvedSeverity: severity,
    }))
    const rejectFlow = builder.step(meta('REJ-CTX-1', 'Reject branch'), ({ severity }, _params) => ({
      rejectedSeverity: severity,
    }))

    const flow = builder
      .branch(
        (data, params) => (params.ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
        {
          approve: approveFlow,
          reject: rejectFlow,
        },
        { name: 'ROUTE-CTX-1', description: 'Route with ctx' }
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

    const childFlow = createSyncMetaFlow().step(meta('NOCTX-1', 'No ctx child'), ({ severity }, _params) => ({
      severitySeen: severity,
    }))

    const flow = createSyncMetaFlow()
      .withContext<RequestCtx>()
      .branch(
        (data, params) => (params.ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
        {
          approve: childFlow,
          reject: childFlow,
        },
        { name: 'ROUTE-NOCTX-1', description: 'Route to no ctx child' }
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

  it('maps branch selector params with map()', () => {
    const childFlow = createSyncMetaFlow().step(
      meta('MAP-DATA-CHILD-1', 'Uses original branch data'),
      ({ severity }, _params) => ({
        severitySeen: severity,
      })
    )

    const flow = createSyncMetaFlow()
      .branch(
        (_data, params: { ctx: undefined; route: ReviewData['route'] }) => params.route,
        {
          approve: childFlow,
          reject: childFlow,
        },
        {
          name: 'MAP-DATA-1',
          description: 'Map branch params',
          map: ({ data }: { id: string; data: ReviewData; ctx: undefined }) => ({ route: data.route }),
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
              stepResults: [{ id: 'MAP-DATA-CHILD-1', result: { severitySeen: 'high' } }],
            },
            { key: 'reject', status: 'skip' },
          ],
        },
      ],
    })
  })

  it('maps branch selector params with ctx and custom fields', () => {
    type ParentCtx = {
      allowReject: boolean
    }
    const childFlow = createSyncMetaFlow().step(
      meta('MAP-PARAMS-CHILD-1', 'Uses original data after branch selection'),
      ({ severity }, _params) => ({
        severitySeen: severity,
      })
    )

    const flow = createSyncMetaFlow()
      .withContext<ParentCtx>()
      .branch(
        ({ route }, params: { ctx: ParentCtx; actorId: string }) =>
          params.ctx.allowReject && params.actorId === 'branch-actor' ? route : 'reject',
        {
          approve: childFlow,
          reject: childFlow,
        },
        {
          name: 'MAP-PARAMS-1',
          description: 'Map branch params',
          map: ({ data, ctx }: { id: string; data: ReviewData; ctx: ParentCtx }) => {
            void ctx.allowReject
            return {
              actorId: 'branch-actor',
              route: data.route,
            }
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
                  result: { severitySeen: 'low' },
                },
              ],
            },
            { key: 'reject', status: 'skip' },
          ],
        },
      ],
    })
  })

  it('lets branch map override the selector signature with fnInput', () => {
    const selectWithFnInput = (
      data: { decision: ReviewData['route'] },
      params: { ctx: undefined; actorId: string }
    ) => {
      expectTypeOf(data).toEqualTypeOf<{ decision: ReviewData['route'] }>()
      expectTypeOf(params).toEqualTypeOf<{ ctx: undefined; actorId: string }>()
      return data.decision === 'approve' && params.actorId === 'branch-actor'
        ? ('approve' as const)
        : ('reject' as const)
    }

    const flow = createSyncMetaFlow()
      .branch(
        selectWithFnInput,
        {
          approve: createSyncMetaFlow().step(meta('MAP-FNINPUT-APP', 'Approve path'), ({ severity }, _params) => ({
            severitySeen: severity,
          })),
          reject: createSyncMetaFlow().step(meta('MAP-FNINPUT-REJ', 'Reject path'), ({ severity }, _params) => ({
            severitySeen: severity,
          })),
        },
        {
          name: 'MAP-FNINPUT-1',
          description: 'Override branch selector input',
          map: ({ data }: { id: string; data: ReviewData; ctx: undefined }) => ({
            actorId: 'branch-actor',
            fnInput: [{ decision: data.route }, { ctx: undefined, actorId: 'branch-actor' }],
          }),
        }
      )
      .build()

    const result = flow.run({
      route: 'approve',
      severity: 'low',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          id: 'MAP-FNINPUT-1',
          selectedBranchKeys: ['approve'],
          branches: [
            { key: 'approve', stepResults: [{ id: 'MAP-FNINPUT-APP', result: { severitySeen: 'low' } }] },
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
      .step(meta('CTX-CHILD-0', 'Child with context'), ({ severity }, params) => ({
        severitySeen: severity,
        actorId: params.ctx.actorId,
      }))
      .build()

    expect(() =>
      (parentBuilder.branch as (...args: any[]) => unknown)(
        () => 'approve',
        {
          approve: childFlow,
        },
        {
          name: 'ROUTE-CTX-NOCTX-1',
          description: 'No context parent',
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
      .step(meta('CTX-CHILD-1', 'Child with different context'), ({ severity }, params) => ({
        severitySeen: severity,
        actorId: params.ctx.actorId,
      }))
      .build()

    parentBuilder.branch(
      () => 'approve' as const,
      {
        // @ts-expect-error child context must match parent context type
        approve: childFlow,
      },
      { name: 'ROUTE-CTX-MISMATCH-1', description: 'Mismatch branch' }
    )
  })

  it('rejects mismatched data flows in branch at type level', () => {
    const parentBuilder = createSyncMetaFlow()
    const childFlow = createSyncFlow<{ other: string }>().build()

    parentBuilder.branch(
      () => 'approve' as const,
      {
        // @ts-expect-error child data must match parent data
        approve: childFlow,
      },
      { name: 'ROUTE-DATA-MISMATCH-1', description: 'Data mismatch branch' }
    )
  })

  it('types branch selector params from map output', () => {
    const builder = createSyncMetaFlow().withContext<{ allowReject: boolean }>()

    builder.branch(
      (_data, params: { ctx: { allowReject: boolean }; actorId: string }) =>
        params.ctx.allowReject && params.actorId === 'ok' ? ('approve' as const) : ('reject' as const),
      {
        approve: createSyncMetaFlow().build(),
        reject: createSyncMetaFlow().build(),
      },
      {
        name: 'MAP-TYPE-OK',
        description: 'Mapped branch params',
        map: ({ data: _data }: { id: string; data: ReviewData; ctx: { allowReject: boolean } }) => ({
          actorId: 'ok',
        }),
      }
    )

    builder.branch(
      (_data, params: { ctx: { allowReject: boolean }; actorId: string }) => {
        expectTypeOf(params).toEqualTypeOf<{ ctx: { allowReject: boolean }; actorId: string }>()
        return 'approve' as const
      },
      {
        approve: createSyncMetaFlow().build(),
      },
      {
        name: 'MAP-TYPE-CHECK',
        description: 'Check mapped selector params',
        map: () => ({
          actorId: 'ok',
        }),
      }
    )
  })

  it('uses rule descriptions for branches and keeps child payloads out of the parent data', () => {
    const approvedFlow = createSyncMetaFlow().step(meta('APP-1', 'Approve request'), ({ severity }, _params) => ({
      approvedSeverity: severity,
    }))

    const rejectedFlow = createSyncMetaFlow().step(meta('REJ-1', 'Reject request'), ({ severity }, _params) => ({
      rejectedSeverity: severity,
    }))

    const flow = createSyncMetaFlow()
      .branch(
        ({ route }) => route,
        {
          approve: approvedFlow,
          reject: rejectedFlow,
        },
        { name: 'ROUTE-1', description: 'Route by review decision' }
      )
      .step(meta('AFTER-1', 'After branch'), ({ checks }, _params) => ({
        checksSeen: checks.length,
      }))
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
    expect(result.status).toBe('ok')
    expect(result.stepResults[0]).toBeInstanceOf(StepResult)
    const firstStep = result.stepResults[0]
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
    const auditFlow = createAsyncMetaFlow().step(meta('AUDIT-1', 'Audit request'), async (_data, _params) => ({
      audited: true,
    }))

    const rulesFlow = createAsyncMetaFlow().step(meta('RULES-1', 'Check rules'), async ({ checks }, _params) =>
      checks.includes('rules') ? error({ variables: { info: 'Rules rejected the request.' } }) : {}
    )

    const flow = createAsyncMetaFlow()
      .branch(
        ({ checks }) => checks,
        {
          audit: auditFlow,
          rules: rulesFlow,
        },
        { name: 'REVIEW-1', description: 'Run reviews' }
      )
      .step(meta('AFTER-2', 'Continue after branch'), async ({ severity }, _params) => ({
        severitySeen: severity,
      }))
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
    const failingFlow = createAsyncMetaFlow().step(meta('FAIL-1', 'Fail branch'), async (_data, _params) =>
      error({ variables: { code: 'child-error' } })
    )

    const flow = createAsyncMetaFlow()
      .branch(
        () => 'reject' as const,
        {
          reject: failingFlow,
        },
        { name: 'ROUTE-2', description: 'Ignore branch errors', status: { error: 'ignore' } }
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
      [approveKey]: createSyncMetaFlow().step(meta('APP-SYMBOL', 'Approve with symbol key'), (_data, _params) => ({
        approved: true,
      })),
      [rejectKey]: createSyncMetaFlow().step(meta('REJ-SYMBOL', 'Reject with symbol key'), (_data, _params) => ({
        rejected: true,
      })),
    }

    const flow = createSyncMetaFlow()
      .branch(() => rejectKey, symbolBranches, { name: 'SYMBOL-BRANCH', description: 'Route using symbol keys' })
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
      .step(meta('ASYNC-CHILD', 'Async child branch'), async (_data, _params) => ({
        loaded: true,
      }))
      .build()

    expect(() =>
      createSyncMetaFlow().branch(
        () => 'reject' as const,
        {
          reject: asyncChildFlow as any,
        },
        { name: 'SYNC-PARENT', description: 'Sync branch parent' }
      )
    ).toThrow('cannot include async flow')
  })

  it('checks branch selectors against the flow ctx type', () => {
    const builder = createSyncMetaFlow()

    builder.branch(
      ({ route }, _params) => route,
      {
        approve: createSyncMetaFlow().step(meta('APPROVE', 'Approve'), (_data, _params) => ({ ok: true })),
        reject: createSyncMetaFlow().step(meta('REJECT', 'Reject'), (_data, _params) => ({ ok: true })),
      },
      { name: 'TYPE-BRANCH', description: 'Uses route' }
    )

    expect(builder.build().steps).toBeDefined()
  })

  it('infers the first-branch ctx from the selector', () => {
    const firstBranchFlow = createAsyncFlow(
      ({ route }: Pick<ReviewData, 'route'>, _params) => route,
      {
        approve: createAsyncFlow<Pick<ReviewData, 'route'>>()
          .step('APP-FIRST', async (_data, _params) => ({ approved: true }), { description: 'Approve first branch' })
          .build(),
        reject: createAsyncFlow<Pick<ReviewData, 'route'>>()
          .step('REJ-FIRST', async (_data, _params) => ({ rejected: true }), { description: 'Reject first branch' })
          .build(),
      },
      { name: 'FIRST-BRANCH', description: 'First branch entrypoint' }
    ).build()

    expect(firstBranchFlow.steps).toHaveLength(1)
    expectTypeOf<Parameters<typeof firstBranchFlow.run>[0]>().toEqualTypeOf<Pick<ReviewData, 'route'>>()
  })
})
