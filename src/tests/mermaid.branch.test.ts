import { describe, expect, it } from 'vitest'

import { renderProcessAsMermaidGraph } from '../mermaidRenderer'
import { createAsyncFlow, createSyncFlow, error, skip } from '../index'

describe('renderProcessAsMermaidGraph', () => {
  it('renders a static graph from a flow definition', () => {
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>()
      .branch(
        ({ route }) => route,
        {
          approve: createSyncFlow('APP-1', (_data, _params) => ({ approved: true }), {
            description: 'Approve request',
          }),
          reject: createSyncFlow('REJ-1', (_data, _params) => ({ rejected: true }), { description: 'Reject request' }),
        },
        { name: 'ROUTE-1', description: 'Route request' }
      )
      .build()

    const graph = renderProcessAsMermaidGraph(flow)

    expect(graph).toContain('ROUTE-1: Route request')
    expect(graph).toContain('Branch: approve')
    expect(graph).toContain('APP-1: Approve request')
    expect(graph).toContain('Branch: reject')
  })

  it('renders symbol branch keys in a static graph', () => {
    const approveKey = Symbol('approve')
    const rejectKey = Symbol('reject')
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>()
      .branch(
        ({ route }) => (route === 'approve' ? approveKey : rejectKey),
        {
          [approveKey]: createSyncFlow('APP-SYMBOL', (_data, _params) => ({ approved: true }), {
            description: 'Approve symbol request',
          }),
          [rejectKey]: createSyncFlow('REJ-SYMBOL', (_data, _params) => ({ rejected: true }), {
            description: 'Reject symbol request',
          }),
        },
        { name: 'ROUTE-SYMBOL', description: 'Route symbol request' }
      )
      .build()

    const graph = renderProcessAsMermaidGraph(flow)

    expect(graph).toContain('ROUTE-SYMBOL: Route symbol request')
    expect(graph).toContain('branches: Symbol(approve), Symbol(reject)')
    expect(graph).toContain('Branch: Symbol(approve)')
    expect(graph).toContain('Branch: Symbol(reject)')
  })

  it('renders symbol branch keys from an executed result graph', () => {
    const approveKey = Symbol('approve')
    const rejectKey = Symbol('reject')
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>()
      .branch(
        ({ route }) => (route === 'approve' ? approveKey : rejectKey),
        {
          [approveKey]: createSyncFlow('APP-SYMBOL-RUN', (_data, _params) => ({ approved: true }), {
            description: 'Approve symbol request',
          }),
          [rejectKey]: createSyncFlow('REJ-SYMBOL-RUN', (_data, _params) => ({ rejected: true }), {
            description: 'Reject symbol request',
          }),
        },
        { name: 'ROUTE-SYMBOL-RUN', description: 'Route symbol request' }
      )
      .build()

    const result = flow.run({ route: 'reject' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('ROUTE-SYMBOL-RUN: Route symbol request')
    expect(graph).toContain('branches: Symbol(reject)')
    expect(graph).toContain('Branch: Symbol(reject)')
    expect(graph).toContain('Branch: Symbol(approve)')
    expect(graph).toContain('[skip]')
  })

  it('renders selected branch keys even when the selected child branch is skipped', () => {
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>()
      .branch(
        ({ route }) => route,
        {
          approve: createSyncFlow('APP-SKIP', (_data, _params) => skip(), { description: 'Approve but skip' }),
          reject: createSyncFlow('REJ-SKIP', (_data, _params) => ({ rejected: true }), {
            description: 'Reject request',
          }),
        },
        { name: 'ROUTE-SKIP', description: 'Route request' }
      )
      .build()

    const result = flow.run({ route: 'approve' })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('ROUTE-SKIP: Route request')
    expect(graph).toContain('branches: approve')
    expect(graph).toContain('Branch: approve')
    expect(graph).toContain('APP-SKIP: Approve but skip')
  })

  it('renders statuses and payload text from an executed result', async () => {
    const rulesFlow = createAsyncFlow(
      'RULES-1',
      async ({ checks }: { checks: Array<'audit' | 'rules'> }, _params) =>
        checks.includes('rules') ? error({ variables: { info: 'Rules failed.' } }) : { info: 'Rules passed.' },
      { description: 'Rules' }
    )

    const flow = createAsyncFlow<{ checks: Array<'audit' | 'rules'> }>()
      .branch(
        ({ checks }) => checks,
        {
          audit: createAsyncFlow('AUDIT-1', async (_data, _params) => ({ audited: true }), { description: 'Audit' }),
          rules: rulesFlow,
        },
        { name: 'BR-1', description: 'Run selected checks' }
      )
      .build()

    const result = await flow.run({ checks: ['audit', 'rules'] })
    const graph = renderProcessAsMermaidGraph(result)

    expect(graph).toContain('BR-1: Run selected checks')
    expect(graph).toContain('branches: audit, rules')
    expect(graph).toContain('[error]')
    expect(graph).toContain('Rules failed.')
    expect(graph).toContain('Branch: rules')
  })
})
