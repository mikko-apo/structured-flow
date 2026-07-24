import { expect, expectTypeOf, it } from 'vitest'

import { convertResultNode, createSyncFlow, flattenStepResults, rule } from '../index.ts'

it('maps parent data into a reusable validation flow', () => {
  type ItemData = {
    label: string
    state?: string
    marker?: string
  }

  type UseCaseData = {
    requestId: string
    item: ItemData
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
  const itemValidations = createSyncFlow({
    step: requiredRule,
    stepDefaults: {
      trueIsFail: true,
    },
  })
    .step(stateRule)
    .step(markerRule)

  const validationFlow = createSyncFlow<UseCaseData>({
    branch: {
      init: ({ data }) => ({ data: data.item }),
      branches: {
        item: itemValidations,
      },
      path: 'pow',
    },
  })

  const result = validationFlow.run({
    requestId: 'REQUEST-1',
    item: {
      label: 'Example',
      state: 'blocked',
    },
  })

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
  const issues = flattenStepResults(
    result.stepResults,
    ({ failed, flattenedResult: { id, path, message, variables } }) =>
      failed && id !== undefined
        ? {
            code: id,
            path,
            message,
            variables,
            level: 'error' as const,
          }
        : undefined
  )
  expectTypeOf(issues).toEqualTypeOf<
    Array<{
      code: string
      path?: string
      message?: string
      variables: Record<string, unknown>
      level: 'error'
    }>
  >()
  expect(issues).toEqual([
    {
      code: 'RULE-2',
      path: 'pow',
      variables: {},
      level: 'error',
    },
  ])
})
