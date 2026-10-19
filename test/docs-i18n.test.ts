import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, it } from 'node:test'

const PAIRS = [
  ['README.en.md', 'README.md'],
  ['CHANGELOG.en.md', 'CHANGELOG.md'],
  ['SECURITY.en.md', 'SECURITY.md'],
  ['CONTRIBUTING.en.md', 'CONTRIBUTING.md'],
  ['HANDOFF.en.md', 'HANDOFF.md'],
  ['AGENTS.en.md', 'AGENTS.md'],
  ['docs/README.en.md', 'docs/README.md'],
  ['docs/design.en.md', 'docs/design.md'],
  ['docs/threat-model.en.md', 'docs/threat-model.md'],
  ['docs/audit.en.md', 'docs/audit.md'],
  ['docs/compatibility.en.md', 'docs/compatibility.md'],
  ['docs/runtime-notes.en.md', 'docs/runtime-notes.md'],
  ['docs/runtime-spike.en.md', 'docs/runtime-spike.md'],
  ['docs/install-review-p0.en.md', 'docs/install-review-p0.md'],
  ['docs/release-0.2.0-beta.1.en.md', 'docs/release-0.2.0-beta.1.md'],
]

describe('documentation i18n', () => {
  it('keeps every user-facing document in an English/Chinese pair with a language switch', () => {
    for (const [english, chinese] of PAIRS) {
      const englishText = readFileSync(english, 'utf8')
      const chineseText = readFileSync(chinese, 'utf8')
      for (const text of [englishText, chineseText]) {
        assert.match(text, /^> Language: \[English\]\([^)]+\) · \[中文\]\([^)]+\)$/m, `${english}/${chinese}`)
      }
      assert.match(englishText, new RegExp(basename(chinese).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(chineseText, new RegExp(basename(english).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })
})
