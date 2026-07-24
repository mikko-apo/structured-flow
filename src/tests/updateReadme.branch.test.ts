import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { createSyncFlow } from '../index.ts'
import { writeStructuredProcessExampleMarkdown } from '../demos/updateReadme.ts'
import { writeMarkdownDocumentation } from '../renderMarkdownDocumentation.ts'

describe('updateReadme', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes markdown that demonstrates the current api', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'structured-flow-readme-'))
    tempDirs.push(dir)
    const outputFile = join(dir, 'README.generated.md')

    await writeStructuredProcessExampleMarkdown(outputFile)

    const markdown = readFileSync(outputFile, 'utf8')

    expect(markdown).toContain('# structured-flow')
    expect(markdown).toContain('## Factory variants')
    expect(markdown).toContain('## Flow options')
    expect(markdown).toContain('createSyncFlow(ruleOrFlowOptionsOrCombinedBranchOptions)')
    expect(markdown).toContain('{ ...flowOptions, step: stepOptions }')
    expect(markdown).toContain('branch: { branches, init')
    expect(markdown).toContain('type Person = {')
    expect(markdown).toContain('type CoreApiData = {')
    expect(markdown).toContain('const PC10verifyPerson = rule(')
    expect(markdown).toContain('const PC20checkChildrenCount = rule(')
    expect(markdown).toContain('const personChecks = createSyncFlow<CoreApiData>()')
    expect(markdown).toContain('mainPerson: personChecks')
    expect(markdown).toContain("path: 'mainPerson'")
    expect(markdown).toContain('### No Kids Run')
    expect(markdown).toContain('### Two Kids Run')
    expect(markdown).toContain('### Missing Name Run')
    expect(markdown).toContain('flattenStepResults')
    expect(markdown).toContain('## Flow Metadata Example')
    expect(markdown).toContain('## Context Example')
    expect(markdown).toContain('## Map Example')
    expect(markdown).toContain('Initial flow.run() input')
    expect(markdown).toContain('&quot;actorId&quot;: &quot;user-7&quot;')
    expect(markdown).toContain('&quot;role&quot;: &quot;reviewer&quot;')
    expect(markdown).toContain('This example uses `ruleId()` so ids and descriptions can be defined together')
    expect(markdown).toContain('Rule helper flow')
    expect(markdown).toContain('Send to manual review')
    expect(markdown).toContain('Named Review Flow')
    expect(markdown).toContain('Demonstrates flow-level name and description metadata.')
    expect(markdown).toContain('Actor-aware Review')
    expect(markdown).toContain('Demonstrates withContext() and flow.run(data, ctx).')
    expect(markdown).toContain('Mapped Review Flow')
    expect(markdown).toContain('Demonstrates flow-level map() overrides for callback data and ctx.')
    expect(markdown).toContain('<!-- structured-process-demo:rule-flow-flow-html:html-table:start -->')
    expect(markdown).toContain('<!-- structured-process-demo:core-api-static-graph:mermaid:start -->')
  })

  it('reads marked code blocks from multiple external source files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'structured-flow-external-sources-'))
    tempDirs.push(dir)
    const firstSourceFile = join(dir, 'first.ts')
    const secondSourceFile = join(dir, 'second.ts')
    const templateFile = join(dir, 'template.md')
    const outputFile = join(dir, 'README.generated.md')

    writeFileSync(firstSourceFile, '/* FIRST:START */\nconst first = true\n/* FIRST:END */\n')
    writeFileSync(secondSourceFile, '/* SECOND:START */\nconst second = true\n/* SECOND:END */\n')
    writeFileSync(templateFile, '{{FIRST_CODE_BLOCK}}\n\n{{SECOND_CODE_BLOCK}}\n')

    await writeMarkdownDocumentation({
      sourceFiles: [firstSourceFile, secondSourceFile],
      templateFile,
      outputFile,
      flows: [
        { placeholderId: 'FIRST', title: 'First', description: 'First flow.', flow: createSyncFlow<object>() },
        { placeholderId: 'SECOND', title: 'Second', description: 'Second flow.', flow: createSyncFlow<object>() },
      ],
    })

    const markdown = readFileSync(outputFile, 'utf8')
    expect(markdown).toContain('const first = true')
    expect(markdown).toContain('const second = true')
  })

  it('requires documentation metadata when the flow does not provide it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'structured-flow-missing-metadata-'))
    tempDirs.push(dir)

    await expect(
      writeMarkdownDocumentation({
        sourceFiles: [],
        pageContent: [],
        outputFile: join(dir, 'README.generated.md'),
        flows: [
          { placeholderId: 'MISSING_TITLE', description: 'Documented flow.', flow: createSyncFlow<object>() },
        ],
      })
    ).rejects.toThrow('requires a title because its flow does not have a name')

    await expect(
      writeMarkdownDocumentation({
        sourceFiles: [],
        pageContent: [],
        outputFile: join(dir, 'README.generated.md'),
        flows: [
          { placeholderId: 'MISSING_DESCRIPTION', title: 'Documented flow', flow: createSyncFlow<object>() },
        ],
      })
    ).rejects.toThrow('requires a description because its flow does not have a description')
  })

  it('type checks demo data and context against each flow', () => {
    const noContextFlow = createSyncFlow<{ form: { id: string } }>()
    const contextFlow = createSyncFlow<{ form: { id: string } }>().withContext<{ actorId: string }>()

    const typecheckOnly = () => {
      void writeMarkdownDocumentation({
        sourceFiles: [],
        pageContent: [],
        outputFile: 'unused.md',
        flows: [
          {
            placeholderId: 'NO_CONTEXT',
            title: 'No context',
            description: 'A flow without context.',
            flow: noContextFlow,
            demos: [{ placeholderId: 'valid', data: { form: { id: 'form-1' } } }],
          },
          {
            placeholderId: 'WITH_CONTEXT',
            title: 'With context',
            description: 'A flow with context.',
            flow: contextFlow,
            demos: [
              { placeholderId: 'valid', data: { form: { id: 'form-2' } }, ctx: { actorId: 'user-1' } },
            ],
          },
        ],
      })

      void writeMarkdownDocumentation({
        sourceFiles: [],
        pageContent: [],
        outputFile: 'unused.md',
        flows: [
          {
            placeholderId: 'INVALID_DATA',
            title: 'Invalid data',
            description: 'Invalid demo data.',
            flow: noContextFlow,
            // @ts-expect-error demo data must match the flow run data
            demos: [
              {
                placeholderId: 'invalid',
                data: { form: { missingId: true } },
              },
            ],
          },
          {
            placeholderId: 'MISSING_CONTEXT',
            title: 'Missing context',
            description: 'Missing demo context.',
            flow: contextFlow,
            // @ts-expect-error demos for context flows require ctx
            demos: [{ placeholderId: 'invalid', data: { form: { id: 'form-3' } } }],
          },
          {
            placeholderId: 'UNEXPECTED_CONTEXT',
            title: 'Unexpected context',
            description: 'Unexpected demo context.',
            flow: noContextFlow,
            // @ts-expect-error demos for non-context flows do not accept ctx
            demos: [
              {
                placeholderId: 'invalid',
                data: { form: { id: 'form-4' } },
                ctx: { actorId: 'user-2' },
              },
            ],
          },
        ],
      })
    }

    expect(typecheckOnly).toBeTypeOf('function')
  })
})
