import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, it } from 'node:test'

const PAIRS = [
  ['README.md', 'README.zh.md'],
  ['CHANGELOG.md', 'CHANGELOG.zh.md'],
  ['SECURITY.md', 'SECURITY.zh.md'],
  ['CONTRIBUTING.md', 'CONTRIBUTING.zh.md'],
  ['HANDOFF.md', 'HANDOFF.en.md'],
  ['AGENTS.md', 'AGENTS.en.md'],
  ['docs/README.md', 'docs/README.zh.md'],
  ['docs/design.md', 'docs/design.zh.md'],
  ['docs/threat-model.md', 'docs/threat-model.zh.md'],
  ['docs/audit.md', 'docs/audit.zh.md'],
  ['docs/compatibility.md', 'docs/compatibility.zh.md'],
  ['docs/runtime-notes.md', 'docs/runtime-notes.en.md'],
  ['docs/runtime-spike.md', 'docs/runtime-spike.zh.md'],
  ['docs/install-review-p0.md', 'docs/install-review-p0.zh.md'],
  ['docs/release-0.2.0-beta.1.md', 'docs/release-0.2.0-beta.1.zh.md'],
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
