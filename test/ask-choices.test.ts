import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeChoiceAnswers,
  parseAskChoicesArgs,
  toQuestionRequest,
} from '../src/choices/ask.js'
import { registerAskChoicesTool } from '../src/plugin/runtime.js'
import type { Context, ToolRunContext } from '../src/types/dsh-runtime.js'
import { FakeContext } from './helpers/fake-context.js'

function exec(): ToolRunContext {
  const controller = new AbortController()
  return {
    agent: { id: 'agent-1', session: { id: 'session-1' } } as unknown as ToolRunContext['agent'],
    signal: controller.signal,
    callId: 'call-choices',
  } as unknown as ToolRunContext
}

describe('ask_choices parsing', () => {
  it('normalizes questions, descriptions, and recommended labels', () => {
    const questions = parseAskChoicesArgs({
      questions: [
        {
          question: '选择发布方式',
          detail: '这会决定后续流程。',
          multiSelect: true,
          options: [
            { label: '直接发布', description: '立即上线', recommended: true },
            { label: '先测试' },
          ],
        },
      ],
    })
    assert.equal(questions.length, 1)
    assert.equal(questions[0]?.id, 'q1')
    assert.equal(questions[0]?.multiSelect, true)
    assert.equal(questions[0]?.options[0]?.label, '直接发布（推荐）')
    assert.equal(questions[0]?.options[0]?.description, '立即上线')
    assert.equal(questions[0]?.options[1]?.label, '先测试')

    const request = toQuestionRequest(questions)
    assert.equal(request[0]?.detail, '这会决定后续流程。')
    assert.equal(request[0]?.multiSelect, true)
    assert.equal(request[0]?.options[0]?.label, '直接发布（推荐）')
  })

  it('rejects empty, duplicate, and out-of-range questions', () => {
    assert.throws(() => parseAskChoicesArgs({}), /at least one question/)
    assert.throws(
      () => parseAskChoicesArgs({ questions: [{ question: 'x', options: [{ label: 'a' }] }] }),
      /2-10 options/,
    )
    assert.throws(
      () =>
        parseAskChoicesArgs({
          questions: [{ question: 'x', options: [{ label: 'a' }, { label: 'a' }] }],
        }),
      /duplicated/,
    )
    assert.throws(
      () =>
        parseAskChoicesArgs({
          questions: [
            { id: 'same', question: 'a', options: [{ label: 'a1' }, { label: 'a2' }] },
            { id: 'same', question: 'b', options: [{ label: 'b1' }, { label: 'b2' }] },
          ],
        }),
      /duplicated/,
    )
  })

  it('normalizes answers by question id and keeps custom text', () => {
    const questions = parseAskChoicesArgs({
      questions: [
        { id: 'a', question: '问题 A', options: [{ label: '甲' }, { label: '乙' }] },
        { id: 'b', question: '问题 B', options: [{ label: '丙' }, { label: '丁' }] },
      ],
    })
    const answers = normalizeChoiceAnswers(questions, {
      answers: [
        { id: 'a', selected: ['乙'] },
        { id: 'b', selected: [], custom: '其他' },
      ],
    })
    assert.deepEqual(answers, [
      { id: 'a', selected: ['乙'] },
      { id: 'b', selected: [], custom: '其他' },
    ])
  })
})

describe('ask_choices tool', () => {
  it('registers, asks through the official question API, and returns selections', async () => {
    const ctx = new FakeContext()
    const dispose = registerAskChoicesTool(ctx as unknown as Context)
    assert.ok(ctx.toolDefs.has('ask_choices'))

    const result = (await ctx.runTool(
      'ask_choices',
      {
        questions: [
          {
            question: '选哪个？',
            options: [{ label: '方案 A', recommended: true }, { label: '方案 B' }],
          },
        ],
      },
      exec(),
    )) as { cancelled: boolean; answers: Array<{ id: string; selected: string[] }> }

    assert.equal(ctx.askCalls.length, 1)
    assert.equal(ctx.askCalls[0]?.questions[0]?.question, '选哪个？')
    assert.equal(result.cancelled, false)
    assert.deepEqual(result.answers, [{ id: 'q1', selected: ['方案 A（推荐）'] }])
    dispose()
    assert.equal(ctx.toolDefs.has('ask_choices'), false)
  })

  it('fails closed when the question request is malformed', async () => {
    const ctx = new FakeContext()
    registerAskChoicesTool(ctx as unknown as Context)
    await assert.rejects(
      () => ctx.runTool('ask_choices', { questions: [] }, exec()),
      /at least one question/,
    )
    assert.equal(ctx.askCalls.length, 0)
  })
})
