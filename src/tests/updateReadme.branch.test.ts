import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { writeStructuredProcessExampleMarkdown } from '../demos/updateReadme.ts'

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
    expect(markdown).toContain('Flow metadata')
    expect(markdown).toContain('Context-aware flow')
    expect(markdown).toContain('Mapped payload flow')
    expect(markdown).toContain('<!-- structured-process-demo:rule-flow-flow-html:html-table:start -->')
    expect(markdown).toContain('<!-- structured-process-demo:core-api-static-graph:mermaid:start -->')
  })
})
