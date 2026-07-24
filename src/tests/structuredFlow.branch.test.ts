import { describe, expect, expectTypeOf, it } from 'vitest'

import { convertResultNode, flattenStepResults } from '../resultUtils.ts'
import {
  BranchStepFlowResult,
  type BranchInitResult,
  createAsyncFlow,
  createSyncFlow,
  fail,
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
    const childFlow = createSyncMetaFlow().step({
      rule: meta('BRANCH-RES-CHILD', 'Child branch'),
      fn: ({ severity }, _params) => ({
        severitySeen: severity,
      }),
    })

    const flow = createSyncFlow<ReviewData>({
      stepDefaults: {
        resolver: (stepId) =>
          typeof stepId === 'string'
            ? { id: `RES-${stepId}`, description: `Resolved ${stepId}` }
            : { id: `RES-${stepId.id}`, description: stepId.description },
      },
    }).branch({
      init: ({ data: { route } }) => route,
      branches: {
        approve: childFlow,
        reject: childFlow,
      },
      ruleId: 'BRANCH-RES',
      name: 'Branch resolver',
    })

    const result = flow.run({
      route: 'reject',
      severity: 'high',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [{ id: 'RES-BRANCH-RES', description: 'Resolved BRANCH-RES', selectedBranchKeys: ['reject'] }],
    })
  })

  it('allows branch initializers without a rule id and uses options.name as the display name', () => {
    const childFlow = createSyncMetaFlow().step({
      rule: meta('NAMELESS-BRANCH-CHILD-1', 'Child branch'),
      fn: ({ severity }, _params) => ({
        severitySeen: severity,
      }),
    })

    const flow = createSyncMetaFlow().branch({
      init: ({ data: { route } }) => route,
      branches: {
        approve: childFlow,
        reject: childFlow,
      },
      name: 'route-by-name',
      description: 'Route by name',
    })

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

  it('runs every branch flow when no branch init is provided', () => {
    const childFlow = createSyncMetaFlow().step({
      rule: meta('ALL-BRANCH-CHILD', 'Selected child'),
      fn: ({ severity }, _params) => ({
        severitySeen: severity,
      }),
    })

    const flow = createSyncMetaFlow().branch({
      branches: {
        approve: childFlow,
        reject: childFlow,
      },
      name: 'run-all-branches',
      description: 'Run all branches',
      path: 'review.route',
    })

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

  it('supports init-less branches from the flow factory', () => {
    const childFlow = createSyncMetaFlow().step({
      rule: meta('FACTORY-ALL-CHILD', 'Factory selected child'),
      fn: ({ route }) => ({
        routeSeen: route,
      }),
    })

    const flow = createSyncFlow<ReviewData>({
      name: 'factory-branch-flow',
      branch: {
        branches: {
          name: childFlow,
          reject: childFlow,
        },
        name: 'factory-run-all',
      },
    })

    expect(flow.options.name).toBe('factory-branch-flow')
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

  it('supports selected branches from the flow factory object', () => {
    const childFlow = createSyncMetaFlow().step({
      rule: meta('FACTORY-SELECT-CHILD', 'Factory selected child'),
      fn: ({ route }) => ({
        routeSeen: route,
      }),
    })

    const flow = createSyncFlow<ReviewData>({
      branch: {
        init: ({ data }) => data.route,
        branches: {
          approve: childFlow,
          reject: childFlow,
        },
        name: 'factory-select',
      },
    })

    const result = flow.run({
      route: 'approve',
      severity: 'low',
      checks: [],
    })

    expect(convertResultNode(result)).toMatchObject({
      stepResults: [
        {
          name: 'factory-select',
          selectedBranchKeys: ['approve'],
        },
      ],
    })
  })

  it('passes a separate ctx to branch init when the builder uses withContext()', () => {
    type RequestCtx = {
      allowReject: boolean
    }

    const builder = createSyncMetaFlow().withContext<RequestCtx>()
    const approveFlow = builder.step({
      rule: meta('APP-CTX-1', 'Approve branch'),
      fn: ({ severity }, _params) => ({
        approvedSeverity: severity,
      }),
    })
    const rejectFlow = builder.step({
      rule: meta('REJ-CTX-1', 'Reject branch'),
      fn: ({ severity }, _params) => ({
        rejectedSeverity: severity,
      }),
    })

    const flow = builder.branch({
      init: ({ data, ctx }) => (ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
      branches: {
        approve: approveFlow,
        reject: rejectFlow,
      },
      name: 'ROUTE-CTX-1',
      description: 'Route with ctx',
    })

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
      rule: meta('NOCTX-1', 'No ctx child'),
      fn: ({ severity }, _params) => ({
        severitySeen: severity,
      }),
    })

    const flow = createSyncMetaFlow()
      .withContext<RequestCtx>()
      .branch({
        init: ({ data, ctx }) => (ctx.allowReject && data.route === 'reject' ? 'reject' : 'approve'),
        branches: {
          approve: childFlow,
          reject: childFlow,
        },
        name: 'ROUTE-NOCTX-1',
        description: 'Route to no ctx child',
      })

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

  it('lets branch initializers override child flow data', () => {
    const childFlow = createSyncFlow<{ severity: ReviewData['severity'] }>().step({
      rule: meta('MAP-DATA-CHILD-1', 'Uses selector-provided branch data'),
      fn: ({ severity }, _params) => ({
        severitySeen: severity,
      }),
    })

    const flow = createSyncMetaFlow().branch<ReviewData['route'], { severity: ReviewData['severity'] }>({
      init: ({
        data: { route, severity },
      }): BranchInitResult<ReviewData['route'], { severity: ReviewData['severity'] }, undefined> => ({
        keys: route,
        data: { severity },
      }),
      branches: {
        approve: childFlow,
        reject: childFlow,
      },
      name: 'MAP-DATA-1',
      description: 'Return branch data override',
    })

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

  it('lets branch initializers override child flow ctx', () => {
    type ParentCtx = {
      allowReject: boolean
    }
    const childFlow = createSyncMetaFlow()
      .withContext<{ actorId: string }>()
      .step({
        rule: meta('MAP-PARAMS-CHILD-1', 'Uses selector-provided ctx after branch inition'),
        fn: ({ severity }, params) => ({
          severitySeen: severity,
          actorId: params.ctx.actorId,
        }),
      })

    const flow = createSyncMetaFlow()
      .withContext<ParentCtx>()
      .branch<ReviewData['route'], ReviewData, { actorId: string }>({
        init: ({ data: { route }, ctx }): BranchInitResult<ReviewData['route'], ReviewData, { actorId: string }> => ({
          keys: ctx.allowReject ? route : 'reject',
          ctx: { actorId: 'branch-actor' },
        }),
        branches: {
          approve: childFlow,
          reject: childFlow,
        },
        name: 'MAP-PARAMS-1',
        description: 'Return branch ctx override',
      })

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

  it('lets branch initializers override child flow data and ctx together', () => {
    const initWithBranchResult = ({ data, ctx }: { data: ReviewData; ctx: undefined }) => {
      expectTypeOf(data).toEqualTypeOf<ReviewData>()
      expectTypeOf(ctx).toEqualTypeOf<undefined>()
      return data.route === 'approve' ? ('approve' as const) : ('reject' as const)
    }

    const childFlow = createSyncFlow<{ severity: ReviewData['severity'] }>()
      .withContext<{ actorId: string }>()
      .step({
        rule: meta('MAP-FNINPUT-APP', 'Approve path'),
        fn: ({ severity }, params) => ({
          severitySeen: severity,
          actorId: params.ctx.actorId,
        }),
      })

    const rejectFlow = createSyncFlow<{ severity: ReviewData['severity'] }>()
      .withContext<{ actorId: string }>()
      .step({
        rule: meta('MAP-FNINPUT-REJ', 'Reject path'),
        fn: ({ severity }, params) => ({
          severitySeen: severity,
          actorId: params.ctx.actorId,
        }),
      })

    const flow = createSyncMetaFlow().branch<
      ReviewData['route'],
      { severity: ReviewData['severity'] },
      { actorId: string }
    >({
      init: ({
        data,
        ctx,
      }): BranchInitResult<ReviewData['route'], { severity: ReviewData['severity'] }, { actorId: string }> => ({
        keys: initWithBranchResult({ data, ctx }),
        data: { severity: data.severity },
        ctx: { actorId: 'branch-actor' },
      }),
      branches: {
        approve: childFlow,
        reject: rejectFlow,
      },
      name: 'MAP-FNINPUT-1',
      description: 'Override child flow input from selector result',
    })

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
      .step({
        rule: meta('CTX-CHILD-0', 'Child with context'),
        fn: ({ severity }, params) => ({
          severitySeen: severity,
          actorId: params.ctx.actorId,
        }),
      })

    const flow = (parentBuilder.branch as (...args: any[]) => typeof parentBuilder)({
      branches: {
        approve: childFlow,
      },
      name: 'ROUTE-CTX-NOCTX-1',
      description: 'No context parent',
    })

    expect(
      flow.run({
        route: 'approve',
        severity: 'low',
        checks: [],
      }).status
    ).toBe('exception')
  })

  it('checks context only for child flows selected by branch init', () => {
    type ChildCtx = {
      actorId: string
    }

    const contextChild = createSyncMetaFlow()
      .withContext<ChildCtx>()
      .step({
        rule: meta('CTX-SELECTED-CHILD', 'Context child'),
        fn: ({ severity }, { ctx }) => ({ severitySeen: severity, actorId: ctx.actorId }),
      })
    const plainChild = createSyncMetaFlow().step({
      rule: meta('PLAIN-SELECTED-CHILD', 'Plain child'),
      fn: ({ severity }) => ({ severitySeen: severity }),
    })

    const missingContext = createSyncMetaFlow().branch<'approve', ReviewData, ChildCtx>({
      init: () => 'approve',
      branches: {
        approve: contextChild,
      },
    })
    expect(
      missingContext.run({
        route: 'approve',
        severity: 'low',
        checks: [],
      }).status
    ).toBe('exception')

    const unselectedContext = createSyncMetaFlow().branch<'approve' | 'reject', ReviewData, ChildCtx>({
      init: () => 'reject',
      branches: {
        approve: contextChild,
        reject: plainChild,
      },
    })
    expect(
      unselectedContext.run({
        route: 'reject',
        severity: 'low',
        checks: [],
      }).status
    ).toBe('ok')
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
      .step({
        rule: meta('CTX-CHILD-1', 'Child with different context'),
        fn: ({ severity }, params) => ({
          severitySeen: severity,
          actorId: params.ctx.actorId,
        }),
      })

    parentBuilder.branch({
      init: () => 'approve' as const,
      branches: {
        // @ts-expect-error child context must match parent context type
        approve: childFlow,
      },
      name: 'ROUTE-CTX-MISMATCH-1',
      description: 'Mismatch branch',
    })
  })

  it('rejects mismatched data flows in branch at type level', () => {
    const parentBuilder = createSyncMetaFlow()
    const childFlow = createSyncFlow<{ other: string }>()

    parentBuilder.branch({
      init: () => 'approve' as const,
      branches: {
        // @ts-expect-error child data must match parent data
        approve: childFlow,
      },
      name: 'ROUTE-DATA-MISMATCH-1',
      description: 'Data mismatch branch',
    })
  })

  it('types branch child flows from selector result overrides', () => {
    const builder = createSyncMetaFlow().withContext<{ allowReject: boolean }>()

    const ctxChildFlow = createSyncMetaFlow().withContext<{ allowReject: boolean; actorId: string }>()
    const dataChildFlow = createSyncFlow<{ severity: ReviewData['severity'] }>()

    builder.branch<ReviewData['route'], ReviewData, { allowReject: boolean; actorId: string }>({
      init: ({ ctx }): BranchInitResult<ReviewData['route'], ReviewData, { allowReject: boolean; actorId: string }> => {
        expectTypeOf(ctx).toEqualTypeOf<{ allowReject: boolean }>()
        return {
          keys: ctx.allowReject ? ('approve' as const) : ('reject' as const),
          ctx: { allowReject: ctx.allowReject, actorId: 'ok' },
        }
      },
      branches: {
        approve: ctxChildFlow,
        reject: ctxChildFlow,
      },
      name: 'MAP-TYPE-OK',
      description: 'Selector result ctx typing',
    })

    builder.branch<'approve', { severity: ReviewData['severity'] }, { allowReject: boolean }>({
      init: ({
        data,
        ctx,
      }): BranchInitResult<'approve', { severity: ReviewData['severity'] }, { allowReject: boolean }> => {
        expectTypeOf(data).toEqualTypeOf<ReviewData>()
        expectTypeOf(ctx).toEqualTypeOf<{ allowReject: boolean }>()
        return {
          keys: 'approve' as const,
          data: { severity: data.severity },
        }
      },
      branches: {
        approve: dataChildFlow,
      },
      name: 'MAP-TYPE-CHECK',
      description: 'Selector result data typing',
    })
  })

  it('uses rule descriptions for branches and keeps child payloads out of the parent data', () => {
    const approvedFlow = createSyncMetaFlow().step({
      rule: meta('APP-1', 'Approve request'),
      fn: ({ severity }, _params) => ({
        approvedSeverity: severity,
      }),
    })

    const rejectedFlow = createSyncMetaFlow().step({
      rule: meta('REJ-1', 'Reject request'),
      fn: ({ severity }, _params) => ({
        rejectedSeverity: severity,
      }),
    })

    const flow = createSyncMetaFlow()
      .branch({
        init: ({ data: { route } }) => route,
        branches: {
          approve: approvedFlow,
          reject: rejectedFlow,
        },
        ruleId: meta('ROUTE-1', 'Route by review decision'),
        name: 'Review route',
      })
      .step({
        rule: meta('AFTER-1', 'After branch'),
        fn: ({ checks }, _params) => ({
          checksSeen: checks.length,
        }),
      })

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
    const auditFlow = createAsyncMetaFlow().step({
      rule: meta('AUDIT-1', 'Audit request'),
      fn: async (_data, _params) => ({
        audited: true,
      }),
    })

    const rulesFlow = createAsyncMetaFlow().step({
      rule: meta('RULES-1', 'Check rules'),
      fn: async ({ checks }, _params) =>
        checks.includes('rules') ? fail({ variables: { info: 'Rules rejected the request.' } }) : {},
    })

    const flow = createAsyncMetaFlow()
      .branch({
        init: ({ data: { checks } }) => checks,
        branches: {
          audit: auditFlow,
          rules: rulesFlow,
        },
        ruleId: meta('REVIEW-1', 'Run reviews'),
        name: 'Review checks',
        path: 'review',
      })
      .step({
        rule: meta('AFTER-2', 'Continue after branch'),
        fn: async ({ severity }, _params) => ({
          severitySeen: severity,
        }),
      })

    const result = await flow.run({
      route: 'approve',
      severity: 'low',
      checks: ['audit', 'rules'],
    })

    expect(result.status).toBe('fail')
    expect(flattenStepResults(result.stepResults)).toEqual([
      { id: 'REVIEW-1', status: 'fail', description: 'Run reviews', path: 'review', variables: {} },
      {
        id: 'RULES-1',
        status: 'fail',
        description: 'Check rules',
        path: 'review',
        variables: { info: 'Rules rejected the request.' },
      },
    ])
    expect(result.stepResults[0].selectedBranchKeys).toBeUndefined()
    expect(convertResultNode(result)).toMatchObject({
      status: 'fail',
      stepResults: [
        {
          id: 'REVIEW-1',
          name: 'Review checks',
          status: 'fail',
          branches: [
            { key: 'audit', status: 'ok' },
            { key: 'rules', status: 'fail' },
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
    const failingFlow = createAsyncMetaFlow().step({
      rule: meta('FAIL-1', 'Fail branch'),
      fn: async (_data, _params) => fail({ variables: { code: 'child-fail' } }),
    })

    const flow = createAsyncMetaFlow().branch({
      init: () => 'reject' as const,
      branches: {
        reject: failingFlow,
      },
      ruleId: 'ROUTE-2',
      name: 'Reject route',
      description: 'Ignore branch failures',
      status: { fail: 'ignore' },
    })

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
          originalStatus: 'fail',
          branches: [
            {
              key: 'reject',
              status: 'fail',
              stepResults: [{ id: 'FAIL-1', status: 'fail', variables: { code: 'child-fail' } }],
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
        rule: meta('APP-SYMBOL', 'Approve with symbol key'),
        fn: (_data, _params) => ({
          approved: true,
        }),
      }),
      [rejectKey]: createSyncMetaFlow().step({
        rule: meta('REJ-SYMBOL', 'Reject with symbol key'),
        fn: (_data, _params) => ({
          rejected: true,
        }),
      }),
    }

    const flow = createSyncMetaFlow().branch({
      init: () => rejectKey,
      branches: symbolBranches,
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
    const asyncChildFlow = createAsyncMetaFlow().step({
      rule: meta('ASYNC-CHILD', 'Async child branch'),
      fn: async (_data, _params) => ({
        loaded: true,
      }),
    })

    expect(() =>
      createSyncMetaFlow().branch({
        init: () => 'reject' as const,
        branches: {
          reject: asyncChildFlow as any,
        },
        name: 'SYNC-PARENT',
        description: 'Sync branch parent',
      })
    ).toThrow('cannot include async flow')
  })

  it('checks branch initializers against the flow ctx type', () => {
    const builder = createSyncMetaFlow()

    builder.branch({
      init: ({ data: { route } }) => route,
      branches: {
        approve: createSyncMetaFlow().step({
          rule: meta('APPROVE', 'Approve'),
          fn: (_data, _params) => ({ ok: true }),
        }),
        reject: createSyncMetaFlow().step({ rule: meta('REJECT', 'Reject'), fn: (_data, _params) => ({ ok: true }) }),
      },
      name: 'TYPE-BRANCH',
      description: 'Uses route',
    })

    expect(builder.steps).toBeDefined()
  })

  it('infers the first-branch ctx from the selector', () => {
    const firstBranchFlow = createAsyncFlow<Pick<ReviewData, 'route'>>().branch({
      init: ({ data: { route } }) => route,
      branches: {
        approve: createAsyncFlow<Pick<ReviewData, 'route'>>().step({
          rule: 'APP-FIRST',
          fn: async (_data, _params) => ({ approved: true }),
          description: 'Approve first branch',
        }),
        reject: createAsyncFlow<Pick<ReviewData, 'route'>>().step({
          rule: 'REJ-FIRST',
          fn: async (_data, _params) => ({ rejected: true }),
          description: 'Reject first branch',
        }),
      },
      name: 'FIRST-BRANCH',
      description: 'First branch entrypoint',
    })

    expect(firstBranchFlow.steps).toHaveLength(1)
    expectTypeOf<Parameters<typeof firstBranchFlow.run>[0]>().toEqualTypeOf<Pick<ReviewData, 'route'>>()
  })
})
