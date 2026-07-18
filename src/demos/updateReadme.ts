import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAsyncFlow, createSyncFlow, stepResult } from '../structuredFlow.ts'
import { writeMarkdownDocumentation } from './renderMarkdownDocumentation.ts'

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
  id: string
  data: MapFlowData
  ctx: undefined
}) => {
  submissionId: string
  occupancyCount: number
  requiresManualReview: boolean
  summary?: string
  fnInput: [
    { submissionId: string; occupancyCount: number; summary?: string },
    { ctx: undefined; submissionId: string; occupancyCount: number; requiresManualReview: boolean; summary?: string }
  ]
}

type StepInfo = {
  id: string
  description: string
  fn?: (data: ReviewData, params: { ctx: unknown }) => Record<string, unknown> | Promise<Record<string, unknown>>
}

function resolveStepMeta({
  id,
  description,
}: {
  id: StepInfo
  description?: string
}) {
  return {
    id: id.id,
    description: description ?? id.description,
  }
}

/* CORE_API:START */
const loadOccupancies = createAsyncFlow(
  'IC10',
  async ({ form }: { form: SubmittedForm }, _params) => ({
    occupancyCount: form.occupantCount,
  }),
  { description: 'Get linked occupancy records' }
)
  .step(
    'IC20',
    ({ form }, _params) =>
      stepResult({
        status: form.occupantCount >= 2 ? 'ok' : 'error',
        info: form.occupantCount >= 2 ? 'Occupancy count looks good.' : 'Expected at least two occupancies.',
      }),
    { description: 'Verify occupancy count' }
  )
  .build()
/* CORE_API:END */

/* FLOW_METADATA:START */
const namedReviewFlow = createSyncFlow<string, MetadataFlowData>({
  name: 'Named Review Flow',
  description: 'Demonstrates flow-level name and description metadata.',
})
  .step(
    'META-10',
    ({ form }, _params) => ({
      reviewTarget: form.id,
    }),
    { description: 'Record the form id as the review target' }
  )
  .build()
/* FLOW_METADATA:END */

/* CONTEXT_FLOW:START */
const actorAwareFlow = createSyncFlow<string, ContextFlowData>({
  name: 'Actor-aware Review',
  description: 'Demonstrates withContext() and flow.run(data, ctx).',
})
  .withContext<ContextFlowCtx>()
  .step(
    'CTX-10',
    ({ form }, params) => ({
      actorLabel: `${params.ctx.role}:${params.ctx.actorId}`,
      reviewTarget: form.id,
    }),
    { description: 'Attach actor context to the review' }
  )
  .build()
/* CONTEXT_FLOW:END */

/* MAP_FLOW:START */
const mappedReviewFlow = createSyncFlow<string, MapFlowData, MapFlowMapper>({
  name: 'Mapped Review Flow',
  description: 'Demonstrates flow-level map() params augmentation and fnInput overrides.',
  map: ({ data }) => ({
    submissionId: data.form.id,
    occupancyCount: data.form.occupantCount,
    requiresManualReview: data.form.requiresManualReview,
    summary: data.summary,
    fnInput: [
      {
        submissionId: data.form.id,
        occupancyCount: data.form.occupantCount,
        summary: data.summary,
      },
      {
        ctx: undefined,
        submissionId: data.form.id,
        occupancyCount: data.form.occupantCount,
        requiresManualReview: data.form.requiresManualReview,
        summary: data.summary,
      },
    ],
  }),
})
  .step(
    'MAP-10',
    (data, params) => ({
      summary: `${data.submissionId}:${data.occupancyCount}`,
      reviewTarget: params.submissionId,
    }),
    { description: 'Use fnInput to override the callback signature' }
  )
  .step(
    'MAP-20',
    (data, params) =>
      stepResult({
        status: params.requiresManualReview ? 'error' : 'ok',
        info: params.requiresManualReview
          ? `Escalate ${data.summary ?? 'missing-summary'}`
          : `Auto-approve ${data.summary ?? 'missing-summary'}`,
      }),
    {
      description: 'Use the same fnInput override after step output has updated the flow data',
    }
  )
  .build()
/* MAP_FLOW:END */

/* RESOLVER_FLOW:START */
const reviewFlow = createSyncFlow<StepInfo, ReviewData>({
  resolver: resolveStepMeta,
})
  .step({
    id: 'VALIDATE-1',
    description: 'Validate request',
    fn: ({ form }, _params) => ({
      valid: form.id.length > 0,
    }),
  })
  .branch(
    {
      id: 'REVIEW-1',
      description: 'Route review',
    },
    ({ form }, _params) => (form.requiresManualReview ? 'manual' : 'auto'),
    {
      auto: createSyncFlow<StepInfo, ReviewData>({
        resolver: resolveStepMeta,
      }).step({
        id: 'AUTO-1',
        description: 'Auto approve',
        fn: ({ checks }, _params) => ({
          checksSeen: checks.length,
        }),
      }),
      manual: createSyncFlow<StepInfo, ReviewData>({
        resolver: resolveStepMeta,
      }).step({
        id: 'MANUAL-1',
        description: 'Send to manual review',
        fn: ({ form }, _params) =>
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
    templateFile: join(dirname(fileURLToPath(import.meta.url)), 'structuredFlowDemo.readme.template.md'),
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
        description: 'Flow using flow-level map() to augment params and override callback inputs with fnInput.',
        flow: mappedReviewFlow,
        demos: [
          {
            id: 'manual',
            init: { form: { id: 'map-400', occupantCount: 1, requiresManualReview: true }, checks: ['rules'] },
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
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeStructuredProcessExampleMarkdown().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
