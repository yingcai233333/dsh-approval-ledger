import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPlanReviewRequest, buildPlanSelectionQuestion, validatePlanReviewShape } from '../src/plan/review.js'
import { validatePlan } from '../src/plan/validate.js'
import type { PlanValidationOptions, ValidatedPlan } from '../src/plan/types.js'

const CWD = 'C:\\ws'
const KNOWN = new Set(['write', 'pwsh'])
const OPTIONS: PlanValidationOptions = {
  cwd: CWD,
  platform: 'win32',
  knownTools: KNOWN,
}

function plan(): ValidatedPlan {
  const result = validatePlan(
    {
      summary: 'Write a report and run tests',
      items: [
        {
          id: 'A',
          tool: 'write',
          title: 'write report',
          scope: { paths: ['C:\\ws\\out\\report.md'] },
        },
        {
          id: 'B',
          tool: 'pwsh',
          title: 'run tests',
          dependsOn: ['A'],
          scope: { commands: ['npm test'] },
        },
      ],
    },
    OPTIONS,
  )
  assert.ok(result.ok)
  return result.plan
}

describe('plan review request', () => {
  it('builds the one-question shape accepted by the official plan card', () => {
    const request = buildPlanReviewRequest(plan())
    assert.equal(request.questions.length, 1)
    const question = request.questions[0]
    assert.ok(question)
    assert.equal(question.id.length > 0, true)
    assert.equal(question.intent.kind, 'plan-review')
    assert.equal(question.options.length, 2)
    assert.equal(question.options[0]?.label, question.intent.approve)
    assert.equal(question.multiSelect, undefined)
    assert.equal('callId' in question, false)
    assert.ok(question.detail.trim().length > 0)
    assert.deepEqual(validatePlanReviewShape(request), { ok: true, issues: [] })
  })

  it('includes the plan document in detail and sanitizes model HTML', () => {
    const source = plan()
    const first = source.items[0]
    assert.ok(first)
    first.title = '<script>alert(1)</script> 写报告 [link](https://evil.example) 报告'
    const request = buildPlanReviewRequest(source)
    const detail = request.questions[0]?.detail ?? ''
    assert.equal(detail.includes('<script>'), false)
    assert.equal(detail.includes('https://evil.example'), false)
    assert.match(detail, /写报告/)
    assert.match(detail, /report/)
  })

  it('supports English labels and custom approve labels', () => {
    const request = buildPlanReviewRequest(plan(), {
      lang: 'en',
      approveLabel: 'Go ahead',
      discussLabel: 'Revise',
    })
    const question = request.questions[0]
    assert.ok(question)
    assert.equal(question.options[0]?.label, 'Go ahead')
    assert.equal(question.intent.approve, 'Go ahead')
    assert.equal(question.options[1]?.label, 'Revise')
    assert.match(question.detail, /Approval plan/)
  })

  it('builds a per-item multi-select question for auto-eligible items', () => {
    const selection = buildPlanSelectionQuestion(plan())
    assert.ok(selection)
    assert.equal(selection.multiSelect, true)
    assert.deepEqual(selection.options.map((option) => option.label), ['A'])
    assert.match(selection.detail, /未勾选/)
    assert.match(selection.options[0]?.description ?? '', /写入文件/)
  })

  it('rejects malformed plan-review shapes', () => {
    const valid = buildPlanReviewRequest(plan())
    const question = valid.questions[0] as unknown as Record<string, unknown>

    assert.equal(validatePlanReviewShape({ questions: [] }).ok, false)
    assert.equal(validatePlanReviewShape({ questions: [question, question] }).ok, false)
    assert.equal(
      validatePlanReviewShape({ questions: [{ ...question, detail: '' }] }).ok,
      false,
    )
    assert.equal(
      validatePlanReviewShape({ questions: [{ ...question, multiSelect: true }] }).ok,
      false,
    )
    assert.equal(
      validatePlanReviewShape({
        questions: [
          {
            ...question,
            options: [
              { label: 'a' },
              { label: 'b' },
              { label: 'c' },
            ],
          },
        ],
      }).ok,
      false,
    )
    assert.equal(
      validatePlanReviewShape({
        questions: [
          {
            ...question,
            intent: { kind: 'plan-review', approve: 'missing' },
          },
        ],
      }).ok,
      false,
    )
    assert.equal(
      validatePlanReviewShape({
        questions: [{ ...question, intent: { kind: 'question', approve: '批准计划' } }],
      }).ok,
      false,
    )
    assert.equal(
      validatePlanReviewShape({ questions: [{ ...question, callId: 'call-1' }] }).ok,
      false,
    )
  })
})
