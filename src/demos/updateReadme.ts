import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow.ts'
import { h1, p, writeMarkdownDocumentation } from './renderMarkdownDocumentation.ts'

const documentationSourceFile = fileURLToPath(import.meta.url)

type SubmittedForm = {
  id: string
  occupantCount: number
  requiresManualReview: boolean
}

type ReviewCtx = {
  form: SubmittedForm
  checks: Array<'audit' | 'rules'>
}

type StepInfo = {
  id: string
  description: string
  fn?: (ctx: ReviewCtx) => Record<string, unknown> | Promise<Record<string, unknown>>
}

/* CORE_API:START */
const loadOccupancies = createAsyncFlow(
  'IC10',
  async ({ form }: { form: SubmittedForm }) => ({
    occupancyCount: form.occupantCount,
  }),
  { description: 'Get linked occupancy records' }
)
  .step(
    'IC20',
    ({ form }) =>
      stepResult({
        status: form.occupantCount >= 2 ? 'ok' : 'error',
        info: form.occupantCount >= 2 ? 'Occupancy count looks good.' : 'Expected at least two occupancies.',
      }),
    { description: 'Verify occupancy count' }
  )
  .build()
/* CORE_API:END */

/* RESOLVER_FLOW:START */
const reviewFlow = createSyncFlow({
  resolver: (step: StepInfo) => ({
    id: step.id,
    description: step.description,
    stepFn: step.fn,
  }),
})
  .step({
    id: 'VALIDATE-1',
    description: 'Validate request',
    fn: ({ form }) => ({
      valid: form.id.length > 0,
    }),
  })
  .branch(
    {
      id: 'REVIEW-1',
      description: 'Route review',
    },
    ({ form }) => (form.requiresManualReview ? 'manual' : 'auto'),
    {
      auto: createSyncFlow<ReviewCtx, StepInfo>({
        resolver: (step) => ({
          id: step.id,
          description: step.description,
          stepFn: step.fn,
        }),
      }).step({
        id: 'AUTO-1',
        description: 'Auto approve',
        fn: ({ checks }) => ({
          checksSeen: checks.length,
        }),
      }),
      manual: createSyncFlow<ReviewCtx, StepInfo>({
        resolver: (step) => ({
          id: step.id,
          description: step.description,
          stepFn: step.fn,
        }),
      }).step({
        id: 'MANUAL-1',
        description: 'Send to manual review',
        fn: ({ form }) =>
          stepResult({
            status: 'error',
            info: `Manual review required for ${form.id}.`,
          }),
      }),
    }
  )
  .build()
/* RESOLVER_FLOW:END */

export async function writeStructuredProcessExampleMarkdown(
  outputFile = join(dirname(fileURLToPath(import.meta.url)), '../..', 'README.md')
) {
  await writeMarkdownDocumentation({
    documentationSourceFile,
    outputFile,
    printReport: true,
    formatter: (node) => ({
      title: node.id,
      description: node.options?.description ?? '',
    }),
    flows: [
      {
        id: 'CORE_API',
        title: 'Core API',
        description: 'Basic async validation flow with a fixed input ctx.',
        flow: loadOccupancies,
        demos: [
          {
            id: 'ok',
            init: { form: { id: '200', occupantCount: 2, requiresManualReview: false } },
          },
        ],
      },
      {
        id: 'RESOLVER_FLOW',
        title: 'Resolver-based flow',
        description: 'Flow created with resolver so step ids carry their own description and optional step fn.',
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
    pageContent: [
      h1('Core API'),
      p(
        "const validations = createAsyncFlow('IC10', async ({ form }) => ({ occupancyCount: form.occupantCount }), { description: 'Get linked occupancy records' })"
      ),
      p("const result = await validations.run({form: {id: '200', occupantCount: 2, requiresManualReview: false}})"),
      h1('Resolver Flow'),
      p(
        'createSyncFlow({ resolver }).step(stepInfo) resolves id, description, and an optional default step function from the step info object.'
      ),
      'ALL_FLOWS_HTML_MERMAID',
      'LEAF_FLOWS_HTML',
    ],
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeStructuredProcessExampleMarkdown().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
