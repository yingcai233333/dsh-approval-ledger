/**
 * Tool categories and a conservative default allow-list.
 *
 * The host should pass the actual registered tool set to plan validation.
 * This list is only a fallback for tests and for hosts that cannot enumerate
 * tools; an unknown MCP tool therefore fails closed (the plan is rejected).
 */

export const READ_TOOLS: ReadonlySet<string> = new Set([
  'read',
  'ls',
  'glob',
  'grep',
  'read_image',
  'ops_grep',
  'ops_glob',
  'ops_inspect_local_file',
  'web_fetch',
  'web_search',
  'job_output',
  'job_list',
  'list_agents',
  'get_goal',
  'schedule_list',
  'cordis_inspect_list',
  'cordis_inspect_query',
  'skill',
])

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multiedit',
  'apply_patch',
  'ops_replace',
  'replace',
  'notebook_edit',
  'copy',
  'mkdir',
])

export const COMMAND_TOOLS: ReadonlySet<string> = new Set([
  'pwsh',
  'shell',
  'exec',
  'bash',
  'powershell',
  'run_command',
  'process',
])

export const DELETE_TOOLS: ReadonlySet<string> = new Set(['delete', 'remove', 'trash'])

export const MOVE_TOOLS: ReadonlySet<string> = new Set(['move', 'rename'])

export const PLUGIN_TOOLS: ReadonlySet<string> = new Set(['plugin_manager'])

export const NETWORK_TOOLS: ReadonlySet<string> = new Set(['web_fetch', 'web_search'])

export const INTERFACE_TOOLS: ReadonlySet<string> = new Set([
  'request_approvals',
  'ask_choices',
  'ask_user_question',
  'present',
  'todo_write',
  'working_directory',
  'create_goal',
  'get_goal',
  'update_goal',
  'exit_plan_mode',
  'schedule_create',
  'schedule_update',
  'schedule_delete',
  'subagent',
  'subagent_fork',
  'workflow',
  'send_message',
  'interrupt_agent',
  'job_kill',
])

export const DEFAULT_KNOWN_TOOLS: ReadonlySet<string> = new Set([
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...COMMAND_TOOLS,
  ...DELETE_TOOLS,
  ...MOVE_TOOLS,
  ...PLUGIN_TOOLS,
  ...INTERFACE_TOOLS,
  'copy',
  'mkdir',
  'present',
  'goal',
])

export function isReadTool(tool: string): boolean {
  return READ_TOOLS.has(tool)
}

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.has(tool)
}

export function isCommandTool(tool: string): boolean {
  return COMMAND_TOOLS.has(tool)
}

export function isDeleteTool(tool: string): boolean {
  return DELETE_TOOLS.has(tool)
}

export function isMoveTool(tool: string): boolean {
  return MOVE_TOOLS.has(tool)
}

export function isPluginTool(tool: string): boolean {
  return PLUGIN_TOOLS.has(tool)
}
