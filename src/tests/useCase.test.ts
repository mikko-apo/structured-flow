import { expect, it } from 'vitest'

import { convertResultNode, createSyncFlow, rule } from '../index.ts'

it('maps parent data into a reusable validation flow', () => {
  type ItemData = {
    label: string
    state?: string
    marker?: string
  }

  const requiredRule = rule('RULE-1', (item?: ItemData) => !item, {
    description: 'Item is missing',
    info: 'validation',
  })
  const stateRule = rule('RULE-2', (item: ItemData) => item.state === 'blocked', {
    description: 'Item state is blocked',
    info: 'validation',
  })
  const markerRule = rule('RULE-3', (item: ItemData) => item.marker !== undefined, {
    description: 'Item has a marker',
    info: 'validation',
  })
  const resultMapCalls: string[] = []
  const itemValidations = createSyncFlow(requiredRule, {
    step: {
      mapResult: ({ result }) => {
        resultMapCalls.push('step')
        return result
      },
    },
    mapResult: ({ result }) => {
      resultMapCalls.push('flow')
      return typeof result === 'boolean' ? !result : result
    },
  })
    .step(stateRule)
    .step(markerRule)

  type UseCaseData = {
    requestId: string
    item: ItemData
  }

  const validationFlow = createSyncFlow<UseCaseData>().branch({
    init: ({ data }) => ({ data: data.item }),
    branches: {
      item: itemValidations,
    },
  })

  const result = validationFlow.run({
    requestId: 'REQUEST-1',
    item: {
      label: 'Example',
      state: 'blocked',
    },
  })

  expect(resultMapCalls).toEqual(['flow', 'step', 'flow', 'flow'])
  expect(convertResultNode(result)).toMatchObject({
    status: 'fail',
    stepResults: [
      {
        status: 'fail',
        branches: [
          {
            key: 'item',
            status: 'fail',
            stepResults: [
              { id: 'RULE-1', status: 'ok' },
              { id: 'RULE-2', status: 'fail' },
              { id: 'RULE-3', status: 'ok' },
            ],
          },
        ],
      },
    ],
  })
})
