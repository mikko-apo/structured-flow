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

  it('writes markdown that demonstrates the resolver-based api', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'structured-flow-readme-'))
    tempDirs.push(dir)
    const outputFile = join(dir, 'README.generated.md')

    await writeStructuredProcessExampleMarkdown(outputFile)

    const markdown = readFileSync(outputFile, 'utf8')

    expect(markdown).toContain('# Core API')
    expect(markdown).toContain('# Resolver Flow')
    expect(markdown).toContain(
      "const validations = createAsyncFlow('IC10', async ({ form }) => ({ occupancyCount: form.occupantCount }), { description: 'Get linked occupancy records' })"
    )
    expect(markdown).toContain(
      "const result = await validations.run({form: {id: '200', occupantCount: 2, requiresManualReview: false}})"
    )
    expect(markdown).toContain('createSyncFlow({ resolver }).step(stepInfo)')
    expect(markdown).toContain('Resolver-based flow')
    expect(markdown).toContain('Send to manual review')
    expect(markdown).toContain('<!-- structured-process-demo:resolver-flow-flow-html:html-table:start -->')
    expect(markdown).toContain('<!-- structured-process-demo:core-api-static-graph:mermaid:start -->')
  })
})
