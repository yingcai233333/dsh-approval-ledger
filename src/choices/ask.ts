import { scrubSecrets } from '../core/redact.js'
import { sanitizePlanText } from '../plan/document.js'

export const ASK_CHOICES_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      description: '要向用户提出的选择问题，最多 5 个。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'options'],
        properties: {
          id: {
            type: 'string',
            description: '问题 id，缺省为 q1、q2；同一调用内必须唯一。',
          },
          question: {
            type: 'string',
            description: '简短、明确的问题标题。',
          },
          detail: {
            type: 'string',
            description: '可选的中文解释，帮助用户理解选项；不会执行任何操作。',
          },
          multiSelect: {
            type: 'boolean',
            description: '是否允许多选；缺省为单选。',
          },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 10,
            description: '可选项；至少 2 个，最多 10 个。',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: {
                label: { type: 'string', description: '选项文字。' },
                description: { type: 'string', description: '选项的中文说明。' },
                recommended: {
                  type: 'boolean',
                  description: '是否推荐；界面会在文字后加“（推荐）”。',
                },
              },
            },
          },
        },
      },
    },
  },
}

export const ASK_CHOICES_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['cancelled', 'answers'],
  properties: {
    cancelled: { type: 'boolean' },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'selected'],
        properties: {
          id: { type: 'string' },
          selected: { type: 'array', items: { type: 'string' } },
          custom: { type: 'string' },
        },
      },
    },
  },
}

export interface ChoiceOption {
  label: string
  description?: string
  recommended?: boolean
}

export interface ChoiceQuestion {
  id: string
  question: string
  detail?: string
  multiSelect?: boolean
  options: ChoiceOption[]
}

export interface ChoiceAnswer {
  id: string
  selected: string[]
  custom?: string
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return sanitizePlanText(scrubSecrets(value), max)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse and normalize the model-supplied questions before showing the official question UI. */
export function parseAskChoicesArgs(args: unknown): ChoiceQuestion[] {
  if (!isRecord(args) || !Array.isArray(args.questions) || args.questions.length === 0) {
    throw new Error('ask_choices needs at least one question')
  }
  if (args.questions.length > 5) throw new Error('ask_choices supports at most 5 questions')

  const ids = new Set<string>()
  return args.questions.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`ask_choices question ${index + 1} is not an object`)
    const question = text(raw.question, 240)
    if (question.length === 0) throw new Error(`ask_choices question ${index + 1} has no text`)
    const id = text(raw.id, 32) || `q${index + 1}`
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`ask_choices question id is invalid: ${id}`)
    if (ids.has(id)) throw new Error(`ask_choices question id is duplicated: ${id}`)
    ids.add(id)

    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 10) {
      throw new Error(`ask_choices question ${id} needs 2-10 options`)
    }
    const labels = new Set<string>()
    const options: ChoiceOption[] = raw.options.map((value, optionIndex) => {
      if (!isRecord(value)) {
        throw new Error(`ask_choices option ${optionIndex + 1} of ${id} is not an object`)
      }
      const label = text(value.label, 80)
      if (label.length === 0) {
        throw new Error(`ask_choices option ${optionIndex + 1} of ${id} has no label`)
      }
      if (labels.has(label)) throw new Error(`ask_choices option label is duplicated: ${label}`)
      labels.add(label)
      const option: ChoiceOption = { label }
      const description = text(value.description, 200)
      if (description.length > 0) option.description = description
      if (value.recommended === true) {
        option.recommended = true
        option.label = label.endsWith('（推荐）') ? label : `${label}（推荐）`
      }
      return option
    })

    const result: ChoiceQuestion = { id, question, options }
    const detail = text(raw.detail, 600)
    if (detail.length > 0) result.detail = detail
    if (raw.multiSelect === true) result.multiSelect = true
    return result
  })
}

export function toQuestionRequest(questions: ChoiceQuestion[]): Array<{
  id: string
  question: string
  detail?: string
  multiSelect?: boolean
  options: Array<{ label: string; description?: string }>
}> {
  return questions.map((question) => {
    const item: {
      id: string
      question: string
      detail?: string
      multiSelect?: boolean
      options: Array<{ label: string; description?: string }>
    } = {
      id: question.id,
      question: question.question,
      options: question.options.map((option) => {
        const entry: { label: string; description?: string } = { label: option.label }
        if (option.description !== undefined) entry.description = option.description
        return entry
      }),
    }
    if (question.detail !== undefined) item.detail = question.detail
    else item.detail = '请选择一项；选择后模型会按你的选择继续。'
    if (question.multiSelect === true) item.multiSelect = true
    return item
  })
}

export function normalizeChoiceAnswers(
  questions: ChoiceQuestion[],
  answer: { answers: { id: string; selected: string[]; custom?: string }[] },
): ChoiceAnswer[] {
  return questions.map((question) => {
    const found = answer.answers.find((entry) => entry.id === question.id)
    const result: ChoiceAnswer = {
      id: question.id,
      selected: Array.isArray(found?.selected) ? [...found.selected] : [],
    }
    if (typeof found?.custom === 'string' && found.custom.length > 0) result.custom = found.custom
    return result
  })
}
