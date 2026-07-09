import { describe, expect, it } from 'vitest'

import { renderProcessAsMermaidGraph } from '../mermaidRenderer'
import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow'

describe('renderProcessAsMermaidGraph', () => {
  it('renders a static graph from a flow definition', () => {
    const flow = createSyncFlow<{ route: 'approve' | 'reject' }>()
      .branch(
        'ROUTE-1',
        ({ route }) => route,
        {
          approve: createSyncFlow('APP-1', () => ({ approved: true }), { description: 'Approve request' }),
          reject: createSyncFlow('REJ-1', () => ({ rejected: true }), { description: 'Reject request' }),
        },
        { description: 'Route request' }
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
        'ROUTE-SYMBOL',
        ({ route }) => (route === 'approve' ? approveKey : rejectKey),
        {
          [approveKey]: createSyncFlow('APP-SYMBOL', () => ({ approved: true }), {
            description: 'Approve symbol request',
          }),
          [rejectKey]: createSyncFlow('REJ-SYMBOL', () => ({ rejected: true }), {
            description: 'Reject symbol request',
          }),
        },
        { description: 'Route symbol request' }
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
        'ROUTE-SYMBOL-RUN',
        ({ route }) => (route === 'approve' ? approveKey : rejectKey),
        {
          [approveKey]: createSyncFlow('APP-SYMBOL-RUN', () => ({ approved: true }), {
            description: 'Approve symbol request',
          }),
          [rejectKey]: createSyncFlow('REJ-SYMBOL-RUN', () => ({ rejected: true }), {
            description: 'Reject symbol request',
          }),
        },
        { description: 'Route symbol request' }
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
        'ROUTE-SKIP',
        ({ route }) => route,
        {
          approve: createSyncFlow(
            'APP-SKIP',
            () =>
              stepResult({
                status: 'skip',
              }),
            { description: 'Approve but skip' }
          ),
          reject: createSyncFlow('REJ-SKIP', () => ({ rejected: true }), { description: 'Reject request' }),
        },
        { description: 'Route request' }
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
      async ({ checks }: { checks: Array<'audit' | 'rules'> }) =>
        stepResult({
          status: checks.includes('rules') ? 'error' : 'ok',
          info: 'Rules failed.',
        }),
      { description: 'Rules' }
    )

    const flow = createAsyncFlow<{ checks: Array<'audit' | 'rules'> }>()
      .branch(
        'BR-1',
        ({ checks }) => checks,
        {
          audit: createAsyncFlow('AUDIT-1', async () => ({ audited: true }), { description: 'Audit' }),
          rules: rulesFlow,
        },
        { description: 'Run selected checks' }
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
