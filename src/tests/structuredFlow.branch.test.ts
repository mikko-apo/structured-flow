import { describe, expect, expectTypeOf, it } from 'vitest'

import { convertResultNode, flattenFailedStepResults } from '../resultUtils.ts'
import {
  BranchStepFlowResult,
  type BranchSelectResult,
  createAsyncFlow,
  createSyncFlow,
  error,
  ruleId,
  StepResult,
} from '../index'

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

describe('Flow.branch', () => {
  it('uses the flow resolver to map branch metadata', () => {
    const childFlow = createSyncMetaFlow().step(meta('BRANCH-RES-CHILD', 'Child branch'), ({ severity }, _params) => ({
      severitySeen: severity,
    }))

    const flow = createSyncFlow<ReviewData>({
      resolver: (stepId) =>
        typeof stepId === 'string'
          ? { id: `RES-${stepId}`, description: `Resolved ${stepId}` }
          : { id: `RES-${stepId.id}`, description: stepId.description },
    }).branch(
      ({ data: { route } }) => route,
      {
        approve: childFlow,
        reject: childFlow,
      },
      { ruleId: 'BRANCH-RES', name: 'Branch resolver' }
    )

    const result = flow.run({
      route: 'reject',
      severity: 'high',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [{ id: 'RES-BRANCH-RES', description: 'Resolved BRANCH-RES', selectedBranchKeys: ['reject'] }],
    })
  })

  it('allows branch selectors without a rule id and uses options.name as the display name', () => {
    const childFlow = createSyncMetaFlow().step(
      meta('NAMELESS-BRANCH-CHILD-1', 'Child branch'),
      ({ severity }, _params) => ({
        severitySeen: severity,
      })
    )

    const flow = createSyncMetaFlow().branch(
      ({ data: { route } }) => route,
      {
        approve: childFlow,
        reject: childFlow,
      },
      { name: 'route-by-name', description: 'Route by name' }
    )

    const result = flow.run({
      route: 'approve',
      severity: 'low',
      checks: [],
    })

    expect(flow.steps[0]).toMatchObject({ options: { name: 'route-by-name', description: 'Route by name' } })
    expect(convertResultNode(result)).toMatchObject({
      stepResults: [{ name: 'route-by-name', selectedBranchKeys: ['approve'] }],
    })
  })

  it('runs every branch flow when no branch selector is provided', () => {
    const childFlow = createSyncMetaFlow().step(
      meta('ALL-BRANCH-CHILD', 'Selected child'),
      ({ severity }, _params) => ({
        severitySeen: severity,
      })
    )

    const flow = createSyncMetaFlow().branch(
      {
        approve: childFlow,
        reject: childFlow,
      },
      { name: 'run-all-branches', description: 'Run all branches', path: 'review.route' }
    )

    const result = flow.run({
      route: 'approve',
      severity: 'high',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          name: 'run-all-branches',
          path: 'review.route',
          branches: [
            { key: 'approve', stepResults: [{ id: 'ALL-BRANCH-CHILD', variables: { severitySeen: 'high' } }] },
            { key: 'reject', stepResults: [{ id: 'ALL-BRANCH-CHILD', variables: { severitySeen: 'high' } }] },
          ],
        },
      ],
    })
  })

  it('supports selector-less branches from the flow factory', () => {
    const childFlow = createSyncMetaFlow().step(meta('FACTORY-ALL-CHILD', 'Factory selected child'), ({ route }) => ({
      routeSeen: route,
    }))

    const flow = createSyncFlow(
      {
        approve: childFlow,
        reject: childFlow,
      },
      { name: 'factory-run-all' }
    )

    const result = flow.run({
      route: 'reject',
      severity: 'low',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          name: 'factory-run-all',
        },
      ],
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

    const flow = builder.branch(
      ({ data, ctx }) => (ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
      {
        approve: approveFlow,
        reject: rejectFlow,
      },
      { name: 'ROUTE-CTX-1', description: 'Route with ctx' }
    )

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
        ({ data, ctx }) => (ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
        {
          approve: childFlow,
          reject: childFlow,
        },
        { name: 'ROUTE-NOCTX-1', description: 'Route to no ctx child' }
      )

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

  it('lets branch selectors override child flow data', () => {
    const childFlow = createSyncFlow<{ severity: ReviewData['severity'] }>().step(
      meta('MAP-DATA-CHILD-1', 'Uses selector-provided branch data'),
      ({ severity }, _params) => ({
        severitySeen: severity,
      })
    )

    const flow = createSyncMetaFlow().branch<ReviewData['route'], { severity: ReviewData['severity'] }>(
      ({
        data: { route, severity },
      }): BranchSelectResult<ReviewData['route'], { severity: ReviewData['severity'] }, undefined> => ({
        keys: route,
        data: { severity },
      }),
      {
        approve: childFlow,
        reject: childFlow,
      },
      { name: 'MAP-DATA-1', description: 'Return branch data override' }
    )

    const result = flow.run({
      route: 'approve',
      severity: 'high',
      checks: ['audit'],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          name: 'MAP-DATA-1',
          branches: [
            {
              key: 'approve',
              stepResults: [{ id: 'MAP-DATA-CHILD-1', variables: { severitySeen: 'high' } }],
            },
            { key: 'reject', status: 'skip' },
          ],
        },
      ],
    })
  })

  it('lets branch selectors override child flow ctx', () => {
    type ParentCtx = {
      allowReject: boolean
    }
    const childFlow = createSyncMetaFlow()
      .withContext<{ actorId: string }>()
      .step(
        meta('MAP-PARAMS-CHILD-1', 'Uses selector-provided ctx after branch selection'),
        ({ severity }, params) => ({
          severitySeen: severity,
          actorId: params.ctx.actorId,
        })
      )

    const flow = createSyncMetaFlow()
      .withContext<ParentCtx>()
      .branch<ReviewData['route'], ReviewData, { actorId: string }>(
        ({ data: { route }, ctx }): BranchSelectResult<ReviewData['route'], ReviewData, { actorId: string }> => ({
          keys: ctx.allowReject ? route : 'reject',
          ctx: { actorId: 'branch-actor' },
        }),
        {
          approve: childFlow,
          reject: childFlow,
        },
        { name: 'MAP-PARAMS-1', description: 'Return branch ctx override' }
      )

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
          name: 'MAP-PARAMS-1',
          branches: [
            {
              key: 'approve',
              stepResults: [
                {
                  id: 'MAP-PARAMS-CHILD-1',
                  variables: { severitySeen: 'low', actorId: 'branch-actor' },
                },
              ],
            },
            { key: 'reject', status: 'skip' },
          ],
        },
      ],
    })
  })

  it('lets branch selectors override child flow data and ctx together', () => {
    const selectWithBranchResult = ({ data, ctx }: { data: ReviewData; ctx: undefined }) => {
      expectTypeOf(data).toEqualTypeOf<ReviewData>()
      expectTypeOf(ctx).toEqualTypeOf<undefined>()
      return data.route === 'approve' ? ('approve' as const) : ('reject' as const)
    }

    const childFlow = createSyncFlow<{ severity: ReviewData['severity'] }>()
      .withContext<{ actorId: string }>()
      .step(meta('MAP-FNINPUT-APP', 'Approve path'), ({ severity }, params) => ({
        severitySeen: severity,
        actorId: params.ctx.actorId,
      }))

    const rejectFlow = createSyncFlow<{ severity: ReviewData['severity'] }>()
      .withContext<{ actorId: string }>()
      .step(meta('MAP-FNINPUT-REJ', 'Reject path'), ({ severity }, params) => ({
        severitySeen: severity,
        actorId: params.ctx.actorId,
      }))

    const flow = createSyncMetaFlow().branch<
      ReviewData['route'],
      { severity: ReviewData['severity'] },
      { actorId: string }
    >(
      ({
        data,
        ctx,
      }): BranchSelectResult<ReviewData['route'], { severity: ReviewData['severity'] }, { actorId: string }> => ({
        keys: selectWithBranchResult({ data, ctx }),
        data: { severity: data.severity },
        ctx: { actorId: 'branch-actor' },
      }),
      {
        approve: childFlow,
        reject: rejectFlow,
      },
      { name: 'MAP-FNINPUT-1', description: 'Override child flow input from selector result' }
    )

    const result = flow.run({
      route: 'approve',
      severity: 'low',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          name: 'MAP-FNINPUT-1',
          selectedBranchKeys: ['approve'],
          branches: [
            {
              key: 'approve',
              stepResults: [{ id: 'MAP-FNINPUT-APP', variables: { severitySeen: 'low', actorId: 'branch-actor' } }],
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
      .step(meta('CTX-CHILD-0', 'Child with context'), ({ severity }, params) => ({
        severitySeen: severity,
        actorId: params.ctx.actorId,
      }))

    expect(() =>
      (parentBuilder.branch as (...args: any[]) => unknown)(
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
    const childFlow = createSyncFlow<{ other: string }>()

    parentBuilder.branch(
      () => 'approve' as const,
      {
        // @ts-expect-error child data must match parent data
        approve: childFlow,
      },
      { name: 'ROUTE-DATA-MISMATCH-1', description: 'Data mismatch branch' }
    )
  })

  it('types branch child flows from selector result overrides', () => {
    const builder = createSyncMetaFlow().withContext<{ allowReject: boolean }>()

    const ctxChildFlow = createSyncMetaFlow().withContext<{ allowReject: boolean; actorId: string }>()
    const dataChildFlow = createSyncFlow<{ severity: ReviewData['severity'] }>()

    builder.branch<ReviewData['route'], ReviewData, { allowReject: boolean; actorId: string }>(
      ({ ctx }): BranchSelectResult<ReviewData['route'], ReviewData, { allowReject: boolean; actorId: string }> => {
        expectTypeOf(ctx).toEqualTypeOf<{ allowReject: boolean }>()
        return {
          keys: ctx.allowReject ? ('approve' as const) : ('reject' as const),
          ctx: { allowReject: ctx.allowReject, actorId: 'ok' },
        }
      },
      {
        approve: ctxChildFlow,
        reject: ctxChildFlow,
      },
      { name: 'MAP-TYPE-OK', description: 'Selector result ctx typing' }
    )

    builder.branch<'approve', { severity: ReviewData['severity'] }, { allowReject: boolean }>(
      ({
        data,
        ctx,
      }): BranchSelectResult<'approve', { severity: ReviewData['severity'] }, { allowReject: boolean }> => {
        expectTypeOf(data).toEqualTypeOf<ReviewData>()
        expectTypeOf(ctx).toEqualTypeOf<{ allowReject: boolean }>()
        return {
          keys: 'approve' as const,
          data: { severity: data.severity },
        }
      },
      {
        approve: dataChildFlow,
      },
      { name: 'MAP-TYPE-CHECK', description: 'Selector result data typing' }
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
        ({ data: { route } }) => route,
        {
          approve: approvedFlow,
          reject: rejectedFlow,
        },
        { ruleId: meta('ROUTE-1', 'Route by review decision'), name: 'Review route' }
      )
      .step(meta('AFTER-1', 'After branch'), ({ checks }, _params) => ({
        checksSeen: checks.length,
      }))

    const result = flow.run({
      route: 'reject',
      severity: 'high',
      checks: ['audit'],
    })

    expect(flow.steps).toMatchObject([
      { id: 'ROUTE-1', options: { name: 'Review route', description: 'Route by review decision' } },
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
          name: 'Review route',
          description: 'Route by review decision',
          status: 'ok',
          selectedBranchKeys: ['reject'],
          branches: [
            {
              key: 'reject',
              status: 'ok',
              stepResults: [
                { id: 'REJ-1', description: 'Reject request', status: 'ok', variables: { rejectedSeverity: 'high' } },
              ],
            },
            {
              key: 'approve',
              status: 'skip',
              stepResults: [{ id: 'APP-1', description: 'Approve request', status: 'skip' }],
            },
          ],
        },
        { id: 'AFTER-1', description: 'After branch', status: 'ok', variables: { checksSeen: 1 } },
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
        ({ data: { checks } }) => checks,
        {
          audit: auditFlow,
          rules: rulesFlow,
        },
        { ruleId: meta('REVIEW-1', 'Run reviews'), name: 'Review checks', path: 'review' }
      )
      .step(meta('AFTER-2', 'Continue after branch'), async ({ severity }, _params) => ({
        severitySeen: severity,
      }))

    const result = await flow.run({
      route: 'approve',
      severity: 'low',
      checks: ['audit', 'rules'],
    })

    expect(result.status).toBe('error')
    expect(flattenFailedStepResults(result.stepResults)).toEqual([
      { id: 'REVIEW-1', status: 'error', description: 'Run reviews', path: 'review', variables: {} },
      {
        id: 'RULES-1',
        status: 'error',
        description: 'Check rules',
        path: 'review',
        variables: { info: 'Rules rejected the request.' },
      },
    ])
    expect(result.stepResults[0].selectedBranchKeys).toBeUndefined()
    expect(convertResultNode(result)).toMatchObject({
      status: 'error',
      stepResults: [
        {
          id: 'REVIEW-1',
          name: 'Review checks',
          status: 'error',
          branches: [
            { key: 'audit', status: 'ok' },
            { key: 'rules', status: 'error' },
          ],
        },
        {
          id: 'AFTER-2',
          status: 'ok',
          variables: { severitySeen: 'low' },
        },
      ],
    })
  })

  it('applies result remapping to the branch step itself', async () => {
    const failingFlow = createAsyncMetaFlow().step(meta('FAIL-1', 'Fail branch'), async (_data, _params) =>
      error({ variables: { code: 'child-error' } })
    )

    const flow = createAsyncMetaFlow().branch(
      () => 'reject' as const,
      {
        reject: failingFlow,
      },
      { ruleId: 'ROUTE-2', name: 'Reject route', description: 'Ignore branch errors', status: { error: 'ignore' } }
    )

    const result = await flow.run({
      route: 'reject',
      severity: 'high',
      checks: [],
    })

    expect(result.status).toBe('ok')
    expect(result.stepResults[0].selectedBranchKeys).toBeUndefined()
    expect(convertResultNode(result)).toMatchObject({
      status: 'ok',
      stepResults: [
        {
          id: 'ROUTE-2',
          name: 'Reject route',
          status: 'ok',
          originalStatus: 'error',
          branches: [
            {
              key: 'reject',
              status: 'error',
              stepResults: [{ id: 'FAIL-1', status: 'error', variables: { code: 'child-error' } }],
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

    const flow = createSyncMetaFlow().branch(() => rejectKey, symbolBranches, {
      name: 'SYMBOL-BRANCH',
      description: 'Route using symbol keys',
    })

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
          name: 'SYMBOL-BRANCH',
          selectedBranchKeys: [rejectKey],
          branches: [
            {
              key: rejectKey,
              status: 'ok',
              stepResults: [{ id: 'REJ-SYMBOL', status: 'ok', variables: { rejected: true } }],
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
    const asyncChildFlow = createAsyncMetaFlow().step(
      meta('ASYNC-CHILD', 'Async child branch'),
      async (_data, _params) => ({
        loaded: true,
      })
    )

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
      ({ data: { route } }) => route,
      {
        approve: createSyncMetaFlow().step(meta('APPROVE', 'Approve'), (_data, _params) => ({ ok: true })),
        reject: createSyncMetaFlow().step(meta('REJECT', 'Reject'), (_data, _params) => ({ ok: true })),
      },
      { name: 'TYPE-BRANCH', description: 'Uses route' }
    )

    expect(builder.steps).toBeDefined()
  })

  it('infers the first-branch ctx from the selector', () => {
    const firstBranchFlow = createAsyncFlow<Pick<ReviewData, 'route'>>().branch(
      ({ data: { route } }) => route,
      {
        approve: createAsyncFlow<Pick<ReviewData, 'route'>>().step(
          'APP-FIRST',
          async (_data, _params) => ({ approved: true }),
          { description: 'Approve first branch' }
        ),
        reject: createAsyncFlow<Pick<ReviewData, 'route'>>().step(
          'REJ-FIRST',
          async (_data, _params) => ({ rejected: true }),
          { description: 'Reject first branch' }
        ),
      },
      { name: 'FIRST-BRANCH', description: 'First branch entrypoint' }
    )

    expect(firstBranchFlow.steps).toHaveLength(1)
    expectTypeOf<Parameters<typeof firstBranchFlow.run>[0]>().toEqualTypeOf<Pick<ReviewData, 'route'>>()
  })
})
