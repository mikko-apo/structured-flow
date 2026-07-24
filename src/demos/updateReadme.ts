import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSyncFlow, fail, ruleId, rule } from '../index.ts'
import { writeMarkdownDocumentation } from '../renderMarkdownDocumentation.ts'

const documentationSourceFile = fileURLToPath(import.meta.url)

type SubmittedForm = {
  id: string
  occupantCount: number
  requiresManualReview: boolean
}

type ReviewData = {
  form: SubmittedForm
  checks: Array<'audit' | 'rules'>
}

type MetadataFlowData = {
  form: SubmittedForm
}

type ContextFlowData = {
  form: SubmittedForm
}

type ContextFlowCtx = {
  actorId: string
  role: 'reviewer' | 'admin'
}

type MapFlowData = {
  form: SubmittedForm
  checks: Array<'audit' | 'rules'>
  summary?: string
}

type MapFlowMapper = (params: {
  stepInfo: { rawId: unknown }
  processingState: { index: number }
  data: MapFlowData
  ctx: undefined
}) => {
  data: { submissionId: string; occupancyCount: number; summary?: string }
  ctx: { submissionId: string; occupancyCount: number; requiresManualReview: boolean; summary?: string }
}

function meta(id: string, description: string) {
  return ruleId(id, { description })
}

/* CORE_API:START */
type Person = {
  id: string
  name: string
  age: number
}

type CoreApiData = {
  person: Person
  children: Person[]
}

const PC10verifyPerson = rule(
  'PC10',
  ({ person }: CoreApiData) =>
    person.name.trim().length > 0
      ? { personId: person.id, personName: person.name }
      : fail({
          message: 'Person is invalid.',
          variables: { info: 'Person failed identity checks.' },
        }).addResult(
          ruleId('PC10.name', { description: 'Check person name' }),
          fail({
            path: 'name',
            message: 'Person name is required.',
            variables: { info: 'Person name is required.' },
          })
        ),
  { description: 'Verify person identity' }
)

const PC20checkChildrenCount = rule(
  'PC20',
  ({ children }: CoreApiData) => ({
    childCount: children.length,
    hasChildren: children.length > 0,
  }),
  { description: 'Check children count' }
)

const personChecks = createSyncFlow<CoreApiData>()
  .step(PC10verifyPerson)
  .step({
    rule: 'PC11',
    fn: ({ person }) =>
      person.age >= 18
        ? { adult: true }
        : fail({
            path: 'person.age',
            message: `${person.name} must be an adult.`,
            variables: { info: `${person.name} must be an adult.` },
          }),
    description: 'Check person age',
  })

const childrenFlow = createSyncFlow<CoreApiData>()
  .step(PC20checkChildrenCount)
  .step({
    rule: 'PC21',
    fn: ({ children }) => ({
      childNames: children.map((child) => child.name),
    }),
    description: 'List children',
  })

const noChildrenFlow = createSyncFlow<CoreApiData>().step({
  rule: 'PC22',
  fn: ({ children }) =>
    children.length === 0
      ? { noChildren: true }
      : fail({
          path: 'children',
          message: 'Expected no children.',
          variables: { info: 'Expected no children.' },
        }),
  description: 'Confirm no children',
})

const householdFlow = createSyncFlow<CoreApiData>()
  .branch({
    branches: {
      mainPerson: personChecks,
    },
    name: 'main person checks',
    description: 'Run all main person checks',
    path: 'mainPerson',
  })
  .branch({
    init: ({ data: { children } }) => (children.length > 0 ? 'children' : 'noChildren'),
    branches: {
      children: childrenFlow,
      noChildren: noChildrenFlow,
    },
    ruleId: ruleId('BR20', { description: 'Route based on whether the person has children' }),
    name: 'children or no children',
    description: 'Route based on whether the person has children',
  })
/* CORE_API:END */

/* FLOW_METADATA:START */
const namedReviewFlow = createSyncFlow<string, MetadataFlowData>({
  name: 'Named Review Flow',
  description: 'Demonstrates flow-level name and description metadata.',
}).step({
  rule: 'META-10',
  fn: ({ form }, _params) => ({
    reviewTarget: form.id,
  }),
  description: 'Record the form id as the review target',
})
/* FLOW_METADATA:END */

/* CONTEXT_FLOW:START */
const actorAwareFlow = createSyncFlow<string, ContextFlowData>({
  name: 'Actor-aware Review',
  description: 'Demonstrates withContext() and flow.run(data, ctx).',
})
  .withContext<ContextFlowCtx>()
  .step({
    rule: 'CTX-10',
    fn: ({ form }, params) => ({
      actorLabel: `${params.ctx.role}:${params.ctx.actorId}`,
      reviewTarget: form.id,
    }),
    description: 'Attach actor context to the review',
  })
/* CONTEXT_FLOW:END */

/* MAP_FLOW:START */
const mappedReviewFlow = createSyncFlow<string, MapFlowData, MapFlowMapper>({
  name: 'Mapped Review Flow',
  description: 'Demonstrates flow-level map() overrides for callback data and ctx.',
  stepDefaults: {
    map: ({ data }) => ({
      data: {
        submissionId: data.form.id,
        occupancyCount: data.form.occupantCount,
        summary: data.summary,
      },
      ctx: {
        submissionId: data.form.id,
        occupancyCount: data.form.occupantCount,
        requiresManualReview: data.form.requiresManualReview,
        summary: data.summary,
      },
    }),
  },
})
  .step({
    rule: 'MAP-10',
    fn: (data, params) => ({
      summary: `${data.submissionId}:${data.occupancyCount}`,
      reviewTarget: params.ctx.submissionId,
    }),
    description: 'Use mapped callback data and ctx',
  })
  .step({
    rule: 'MAP-20',
    fn: (data, params) =>
      params.ctx.requiresManualReview
        ? fail({ variables: { info: `Escalate ${data.summary ?? 'missing-summary'}` } })
        : { info: `Auto-approve ${data.summary ?? 'missing-summary'}` },
    description: 'Use the same mapped callback data and ctx after step output has updated the flow data',
  })
/* MAP_FLOW:END */

/* RULE_FLOW:START */
const reviewFlow = createSyncFlow<ReviewData>()
  .step({
    rule: meta('VALIDATE-1', 'Validate request'),
    fn: ({ form }, _params) => ({
      valid: form.id.length > 0,
    }),
  })
  .branch({
    init: ({ data: { form } }) => (form.requiresManualReview ? 'manual' : 'auto'),
    branches: {
      auto: createSyncFlow<ReviewData>().step({
        rule: meta('AUTO-1', 'Auto approve'),
        fn: ({ checks }, _params) => ({
          checksSeen: checks.length,
        }),
      }),
      manual: createSyncFlow<ReviewData>().step({
        rule: meta('MANUAL-1', 'Send to manual review'),
        fn: ({ form }, _params) => fail({ variables: { info: `Manual review required for ${form.id}.` } }),
      }),
    },
    name: 'REVIEW-1',
    description: 'Route review',
  })
/* RULE_FLOW:END */

export async function writeStructuredProcessExampleMarkdown(
  outputFile = join(dirname(fileURLToPath(import.meta.url)), '../..', 'README.md')
) {
  await writeMarkdownDocumentation({
    documentationSourceFile,
    templateFile: join(dirname(fileURLToPath(import.meta.url)), 'structuredFlowDemo.readme.template.md'),
    outputFile,
    printReport: true,
    formatter: (node) => ({
      title:
        node.options != null && 'name' in node.options && typeof node.options.name === 'string'
          ? node.options.name
          : (node.id ?? ''),
      description: node.options?.description ?? '',
    }),
    flows: [
      {
        id: 'CORE_API',
        title: 'Core API',
        description: 'Basic sync flow with reusable rule() helpers and branches.',
        flow: householdFlow,
        demos: [
          {
            id: 'no_kids',
            init: { person: { id: 'p1', name: 'Ada', age: 37 }, children: [] },
          },
          {
            id: 'two_kids',
            init: {
              person: { id: 'p2', name: 'Grace', age: 42 },
              children: [
                { id: 'c1', name: 'Lin', age: 8 },
                { id: 'c2', name: 'Mika', age: 6 },
              ],
            },
          },
          {
            id: 'missing_name',
            init: { person: { id: 'p3', name: '', age: 29 }, children: [] },
          },
        ],
      },
      {
        id: 'FLOW_METADATA',
        title: 'Flow metadata',
        description: 'Flow configured with a name and description.',
        flow: namedReviewFlow,
        demos: [
          {
            id: 'ok',
            init: { form: { id: 'meta-200', occupantCount: 2, requiresManualReview: false } },
          },
        ],
      },
      {
        id: 'CONTEXT_FLOW',
        title: 'Context-aware flow',
        description: 'Flow using withContext() so flow.run(data, ctx) passes a separate context object.',
        flow: actorAwareFlow,
        demos: [
          {
            id: 'reviewer',
            init: { form: { id: 'ctx-200', occupantCount: 2, requiresManualReview: false } },
            ctx: { actorId: 'user-7', role: 'reviewer' },
          },
        ],
      },
      {
        id: 'MAP_FLOW',
        title: 'Mapped payload flow',
        description: 'Flow using flow-level map() to override callback data and ctx.',
        flow: mappedReviewFlow,
        demos: [
          {
            id: 'manual',
            init: { form: { id: 'map-400', occupantCount: 1, requiresManualReview: true }, checks: ['rules'] },
          },
        ],
      },
      {
        id: 'RULE_FLOW',
        title: 'Rule helper flow',
        description: 'Flow using ruleId() to keep ids and descriptions together while step functions stay explicit.',
        flow: reviewFlow,
        demos: [
          {
            id: 'manual',
            init: {
              form: { id: '400', occupantCount: 1, requiresManualReview: true },
              checks: ['audit', 'rules'],
            },
          },
        ],
      },
    ],
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeStructuredProcessExampleMarkdown().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
