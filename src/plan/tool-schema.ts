/**
 * Tool registration schemas for `request_approvals`.
 *
 * `ctx.tools.register()` receives a raw JSON Schema for `parameters` (unlike
 * `defineTool`, which compiles an author DSL). Every object node therefore uses
 * a `required` array and an explicit `additionalProperties` boolean.
 * The output schema is also plain JSON Schema.
 */

export const REQUEST_APPROVALS_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: {
      type: 'string',
      description: 'One-paragraph summary of the batch and its intended outcome.',
    },
    items: {
      type: 'array',
      description: 'Declared operations to approve as one batch. Ids must be unique.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'tool', 'title'],
        properties: {
          id: {
            type: 'string',
            description: 'Short unique id (A, B, C ...); 1-16 letters/digits/_/-.',
          },
          tool: {
            type: 'string',
            description: 'Registered tool name, e.g. write, edit, pwsh.',
          },
          title: {
            type: 'string',
            description: 'One-line human-readable description. Model text; shown as unverified.',
          },
          mode: {
            type: 'string',
            enum: ['read-only', 'workspace-write', 'danger-full-access'],
            description: 'Approval/escalation mode requested for this item.',
          },
          scope: {
            type: 'object',
            additionalProperties: false,
            description: 'Exact matching scope. Omit for a manual-only item.',
            properties: {
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Absolute paths, or paths relative to the session cwd.',
              },
              commands: {
                type: 'array',
                items: { type: 'string' },
                description: 'Whole commands; metacharacters/interpreters stay manual.',
              },
              args: {
                type: 'object',
                additionalProperties: true,
                description: 'Exact subset of tool arguments; values are never logged.',
              },
            },
          },
          uses: {
            type: 'integer',
            description: 'Maximum automatic uses for this item (1-5, default 1).',
          },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: 'Item ids that must be fully consumed before this item is ready.',
          },
          note: {
            type: 'string',
            description: 'Optional model explanation; shown as unverified, never a decision input.',
          },
        },
      },
    },
  },
}

export const REQUEST_APPROVALS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['planId', 'decision', 'items'],
  properties: {
    planId: { type: 'string' },
    planHash: { type: 'string' },
    decision: { type: 'string', enum: ['approved', 'cancelled'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'tool', 'risk', 'auto', 'uses'],
        properties: {
          id: { type: 'string' },
          tool: { type: 'string' },
          risk: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'unknown'] },
          auto: { type: 'boolean' },
          uses: { type: 'integer' },
        },
      },
    },
  },
}
