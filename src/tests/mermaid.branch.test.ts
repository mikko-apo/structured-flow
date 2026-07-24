import { describe, expect, it } from 'vitest'

import { renderProcessAsMermaidGraph } from '../renderMermaid'
import { createAsyncFlow, createSyncFlow, fail, skip } from '../index'

describe('renderProcessAsMermaidGraph', () => {
  it('renders a static graph from a flow definition', () => {
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>().branch({
      init: ({ data: { route } }) => route,
      branches: {
        approve: createSyncFlow({
          step: {
            rule: 'APP-1',
            fn: (_data, _params) => ({ approved: true }),
            description: 'Approve request',
          },
        }),
        reject: createSyncFlow({
          step: {
            rule: 'REJ-1',
            fn: (_data, _params) => ({ rejected: true }),
            description: 'Reject request',
          },
        }),
      },
      name: 'ROUTE-1',
      description: 'Route request',
    })

    const graph = renderProcessAsMermaidGraph(flow)

    expect(graph).toContain('ROUTE-1: Route request')
    expect(graph).toContain('Branch: approve')
    expect(graph).toContain('APP-1: Approve request')
    expect(graph).toContain('Branch: reject')
  })

  it('renders symbol branch keys in a static graph', () => {
    const approveKey = Symbol('approve')
    const rejectKey = Symbol('reject')
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>().branch({
      init: ({ data: { route } }) => (route === 'approve' ? approveKey : rejectKey),
      branches: {
        [approveKey]: createSyncFlow({
          step: {
            rule: 'APP-SYMBOL',
            fn: (_data, _params) => ({ approved: true }),
            description: 'Approve symbol request',
          },
        }),
        [rejectKey]: createSyncFlow({
          step: {
            rule: 'REJ-SYMBOL',
            fn: (_data, _params) => ({ rejected: true }),
            description: 'Reject symbol request',
          },
        }),
      },
      name: 'ROUTE-SYMBOL',
      description: 'Route symbol request',
    })

    const graph = renderProcessAsMermaidGraph(flow)

    expect(graph).toContain('ROUTE-SYMBOL: Route symbol request')
    expect(graph).toContain('branches: Symbol(approve), Symbol(reject)')
    expect(graph).toContain('Branch: Symbol(approve)')
    expect(graph).toContain('Branch: Symbol(reject)')
  })

  it('does not duplicate edges between sequential branch child steps', () => {
    const flow = createSyncFlow<{ route: 'approve' }>().branch({
      init: ({ data: { route } }) => route,
      branches: {
        approve: createSyncFlow<{ route: 'approve' }>()
          .step({ rule: 'APP-1', fn: (_data, _params) => ({ first: true }), description: 'First child step' })
          .step({ rule: 'APP-2', fn: (_data, _params) => ({ second: true }), description: 'Second child step' }),
      },
      name: 'ROUTE-DUPLICATE-CHECK',
      description: 'Route duplicate check',
    })

    const graph = renderProcessAsMermaidGraph(flow)
    const edge = 'branch_0_0_step_0 --> branch_0_0_step_1'

    expect(graph.match(new RegExp(edge, 'g'))).toHaveLength(1)
  })

  it('renders symbol branch keys from an executed result graph', () => {
    const approveKey = Symbol('approve')
    const rejectKey = Symbol('reject')
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>().branch({
      init: ({ data: { route } }) => (route === 'approve' ? approveKey : rejectKey),
      branches: {
        [approveKey]: createSyncFlow({
          step: {
            rule: 'APP-SYMBOL-RUN',
            fn: (_data, _params) => ({ approved: true }),
            description: 'Approve symbol request',
          },
        }),
        [rejectKey]: createSyncFlow({
          step: {
            rule: 'REJ-SYMBOL-RUN',
            fn: (_data, _params) => ({ rejected: true }),
            description: 'Reject symbol request',
          },
        }),
      },
      name: 'ROUTE-SYMBOL-RUN',
      description: 'Route symbol request',
    })

    const result = flow.run({ route: 'reject' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('ROUTE-SYMBOL-RUN: Route symbol request')
    expect(graph).toContain('branches: Symbol(reject)')
    expect(graph).toContain('Branch: Symbol(reject)')
    expect(graph).toContain('Branch: Symbol(approve)')
    expect(graph).toContain('[skip]')
  })

  it('renders selected branch keys even when the selected child branch is skipped', () => {
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>().branch({
      init: ({ data: { route } }) => route,
      branches: {
        approve: createSyncFlow({
          step: {
            rule: 'APP-SKIP',
            fn: (_data, _params) => skip(),
            description: 'Approve but skip',
          },
        }),
        reject: createSyncFlow({
          step: {
            rule: 'REJ-SKIP',
            fn: (_data, _params) => ({ rejected: true }),
            description: 'Reject request',
          },
        }),
      },
      name: 'ROUTE-SKIP',
      description: 'Route request',
    })

    const result = flow.run({ route: 'approve' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('ROUTE-SKIP: Route request')
    expect(graph).toContain('branches: approve')
    expect(graph).toContain('Branch: approve')
    expect(graph).toContain('APP-SKIP: Approve but skip')
  })

  it('renders statuses and payload text from an executed result', async () => {
    const rulesFlow = createAsyncFlow({
      step: {
        rule: 'RULES-1',
        fn: async ({ checks }: { checks: Array<'audit' | 'rules'> }, _params) =>
          checks.includes('rules') ? fail({ variables: { info: 'Rules failed.' } }) : { info: 'Rules passed.' },
        description: 'Rules',
      },
    })

    const flow = createAsyncFlow<{ checks: Array<'audit' | 'rules'> }>().branch({
      init: ({ data: { checks } }) => checks,
      branches: {
        audit: createAsyncFlow({
          step: {
            rule: 'AUDIT-1',
            fn: async (_data, _params) => ({ audited: true }),
            description: 'Audit',
          },
        }),
        rules: rulesFlow,
      },
      name: 'BR-1',
      description: 'Run selected checks',
    })

    const result = await flow.run({ checks: ['audit', 'rules'] })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('BR-1: Run selected checks')
    expect(graph).toContain('branches: audit, rules')
    expect(graph).toContain('[fail]')
    expect(graph).toContain('Rules failed.')
    expect(graph).toContain('Branch: rules')
  })
})
