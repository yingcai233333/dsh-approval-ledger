import type { RiskLevel } from '../core/types.js'

const TOOL_LABELS: Readonly<Record<string, string>> = {
  write: '写入文件',
  edit: '编辑文件',
  read: '读取文件',
  glob: '查找文件',
  grep: '搜索内容',
  pwsh: 'PowerShell 命令',
  bash: 'Shell 命令',
  delete: '删除',
  move: '移动',
  copy: '复制',
  mkdir: '创建目录',
  plugin_manager: '插件管理',
  request_approvals: '提交审批计划',
  subagent: '子代理',
  workflow: '工作流',
  web_fetch: '抓取网页',
  web_search: '搜索网页',
  apply_patch: '应用补丁',
}

const MODE_LABELS: Readonly<Record<string, string>> = {
  'read-only': '只读',
  'workspace-write': '工作区写入',
  'danger-full-access': '完全访问',
}

const RISK_LABELS: Readonly<Record<RiskLevel, string>> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  'outside-workspace': '目标在工作区外',
  'data-file': '普通数据文件',
  'documentation-file': '文档文件',
  'mode-full-access': '请求完全访问',
  'mode-read-only': '只读模式下执行写入',
  'system-directory': '系统目录',
  'system-path': '系统路径',
  'credential-file': '凭据文件',
  'dsh-config': 'DSH 配置或插件文件',
  'hard-link': '硬链接文件',
  'command-shell-meta': '命令包含 shell 特殊字符',
  'command-execution': '执行命令或脚本',
  'command-interpreter': '解释器或脚本命令',
  'command-download': '网络下载',
  'command-package-install': '安装软件包',
  'command-privilege': '权限提升',
  'command-registry': '注册表变更',
  'command-service': '服务变更',
  'command-env': '环境变量变更',
  delete: '删除操作',
  'recursive-delete': '递归删除',
  'unknown-tool': '未知工具',
  unclassified: '无法分类',
  'assessment-error': '风险评估失败',
  'unsafe-path': '不安全路径',
  'invalid-command': '无效命令',
  unparsed: '无法解析',
  'risk-disabled': '风险门关闭',
  'risk-high-disabled': '高风险自动放行未开启',
  'risk-needs-confirmation': '高风险需要二次确认',
  'grant-exhausted': '授权次数已用完',
  'dependencies-not-ready': '依赖尚未完成',
  'plan-scope': '计划范围不匹配',
  'tool-mismatch': '工具不匹配',
}

export function toolLabel(tool: unknown): string {
  if (typeof tool !== 'string' || tool.length === 0) return '未知工具'
  return TOOL_LABELS[tool] ?? '其他工具'
}

export function modeLabel(mode: unknown): string {
  if (typeof mode !== 'string' || mode.length === 0) return '未指定'
  return MODE_LABELS[mode] ?? '未知模式'
}

export function riskLabel(level: RiskLevel): string {
  return RISK_LABELS[level]
}

export function reasonLabel(code: unknown): string {
  if (typeof code !== 'string' || code.length === 0) return '其他系统规则'
  return REASON_LABELS[code] ?? '其他系统规则'
}
