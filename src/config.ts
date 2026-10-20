import type { RiskPolicy } from './core/types.js'
import { RISK_POLICY_VERSION } from './core/version.js'

export type PluginMode = 'observe' | 'active'
export type AuditNoticeMode = 'off' | 'plan' | 'all'

export interface PluginConfig {
  /** Observe records what *would* be allowed but never returns allowed-once. */
  mode: PluginMode
  /** Opt-in for high-risk grants (Sprint 3); requires a second confirmation. */
  allowHighRiskGrants: boolean
  requireSecondConfirmForHigh: boolean
  /** Master switch for pending-interaction alerts (taskbar flash and sound). */
  notifications: boolean
  /** Audit-only never auto-approves, regardless of mode. */
  auditOnly: boolean
  auditRetentionDays: number
  maxPlanItems: number
  maxUsesPerItem: number
  maxTotalUses: number
  /** Active mode only: approving the plan authorizes all auto-eligible items without a second checkbox card. */
  autoSelectAll: boolean
  showDetailsButton: boolean
  /** Alert when the plan-review card is waiting. */
  notifyOnPlan: boolean
  /** Alert when a question card (ask_choices or the per-item selection) is waiting. */
  notifyOnQuestion: boolean
  /** Alert when an official approval card is waiting. */
  notifyOnApproval: boolean
  /** Windows: flash the taskbar button of the DeepSeek Harness window. */
  flashWindow: boolean
  /** Windows: play the system exclamation sound. */
  soundAlert: boolean
  /** Repeat the alert every N seconds while the card stays pending; 0 = once. */
  notifyRepeatSeconds: number
  auditNotices: AuditNoticeMode
}

export const DEFAULT_CONFIG: PluginConfig = {
  mode: 'observe',
  allowHighRiskGrants: false,
  requireSecondConfirmForHigh: true,
  notifications: true,
  auditOnly: false,
  auditRetentionDays: 30,
  maxPlanItems: 20,
  maxUsesPerItem: 5,
  maxTotalUses: 50,
  autoSelectAll: false,
  showDetailsButton: true,
  notifyOnPlan: true,
  notifyOnQuestion: true,
  notifyOnApproval: true,
  flashWindow: true,
  soundAlert: true,
  notifyRepeatSeconds: 0,
  auditNotices: 'off',
}

export interface ConfigIssue {
  field: string
  code: string
  message: string
}

export interface SanitizedConfig {
  config: PluginConfig
  warnings: ConfigIssue[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function readBoolean(
  source: Record<string, unknown>,
  field: keyof PluginConfig,
  fallback: boolean,
  warnings: ConfigIssue[],
): boolean {
  const value = source[field]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    warnings.push({ field, code: 'invalid-type', message: `${field} must be a boolean` })
    return fallback
  }
  return value
}

function readInteger(
  source: Record<string, unknown>,
  field: keyof PluginConfig,
  fallback: number,
  minimum: number,
  maximum: number,
  warnings: ConfigIssue[],
): number {
  const value = source[field]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    warnings.push({
      field,
      code: 'out-of-range',
      message: `${field} must be an integer between ${minimum} and ${maximum}`,
    })
    return fallback
  }
  return value
}

/**
 * Validate untrusted plugin config. Invalid values fall back to safe defaults;
 * this function never throws and never enables a risky option by accident.
 */
export function sanitizeConfig(input: unknown): SanitizedConfig {
  const warnings: ConfigIssue[] = []
  try {
    if (input === undefined || input === null) {
      return { config: { ...DEFAULT_CONFIG }, warnings }
    }
    if (!isPlainObject(input)) {
      return {
        config: { ...DEFAULT_CONFIG },
        warnings: [{ field: 'config', code: 'invalid-type', message: 'config must be an object' }],
      }
    }

    let mode: PluginMode = DEFAULT_CONFIG.mode
    if (input.mode !== undefined) {
      if (input.mode === 'observe' || input.mode === 'active') {
        mode = input.mode
      } else {
        warnings.push({
          field: 'mode',
          code: 'invalid-value',
          message: 'mode must be "observe" or "active"',
        })
      }
    }

    let auditNotices: AuditNoticeMode = DEFAULT_CONFIG.auditNotices
    if (input.auditNotices !== undefined) {
      if (input.auditNotices === 'off' || input.auditNotices === 'plan' || input.auditNotices === 'all') {
        auditNotices = input.auditNotices
      } else {
        warnings.push({
          field: 'auditNotices',
          code: 'invalid-value',
          message: 'auditNotices must be "off", "plan", or "all"',
        })
      }
    }

    const auditOnly = readBoolean(input, 'auditOnly', DEFAULT_CONFIG.auditOnly, warnings)
    if (auditOnly && mode === 'active') {
      warnings.push({
        field: 'mode',
        code: 'audit-only-forces-observe',
        message: 'auditOnly disables active auto-approval',
      })
    }

    const allowHighRiskGrants = readBoolean(
      input,
      'allowHighRiskGrants',
      DEFAULT_CONFIG.allowHighRiskGrants,
      warnings,
    )
    let requireSecondConfirmForHigh = readBoolean(
      input,
      'requireSecondConfirmForHigh',
      DEFAULT_CONFIG.requireSecondConfirmForHigh,
      warnings,
    )
    if (allowHighRiskGrants && !requireSecondConfirmForHigh) {
      warnings.push({
        field: 'requireSecondConfirmForHigh',
        code: 'second-confirm-required',
        message: 'high-risk grants cannot disable the second confirmation; forcing true',
      })
      requireSecondConfirmForHigh = true
    }

    const config: PluginConfig = {
      mode,
      allowHighRiskGrants,
      requireSecondConfirmForHigh,
      notifications: readBoolean(input, 'notifications', DEFAULT_CONFIG.notifications, warnings),
      auditOnly,
      auditRetentionDays: readInteger(
        input,
        'auditRetentionDays',
        DEFAULT_CONFIG.auditRetentionDays,
        1,
        3650,
        warnings,
      ),
      maxPlanItems: readInteger(input, 'maxPlanItems', DEFAULT_CONFIG.maxPlanItems, 1, 20, warnings),
      maxUsesPerItem: readInteger(
        input,
        'maxUsesPerItem',
        DEFAULT_CONFIG.maxUsesPerItem,
        1,
        5,
        warnings,
      ),
      maxTotalUses: readInteger(input, 'maxTotalUses', DEFAULT_CONFIG.maxTotalUses, 1, 100, warnings),
      autoSelectAll: readBoolean(input, 'autoSelectAll', DEFAULT_CONFIG.autoSelectAll, warnings),
      showDetailsButton: readBoolean(
        input,
        'showDetailsButton',
        DEFAULT_CONFIG.showDetailsButton,
        warnings,
      ),
      notifyOnPlan: readBoolean(input, 'notifyOnPlan', DEFAULT_CONFIG.notifyOnPlan, warnings),
      notifyOnQuestion: readBoolean(
        input,
        'notifyOnQuestion',
        DEFAULT_CONFIG.notifyOnQuestion,
        warnings,
      ),
      notifyOnApproval: readBoolean(
        input,
        'notifyOnApproval',
        DEFAULT_CONFIG.notifyOnApproval,
        warnings,
      ),
      flashWindow: readBoolean(input, 'flashWindow', DEFAULT_CONFIG.flashWindow, warnings),
      soundAlert: readBoolean(input, 'soundAlert', DEFAULT_CONFIG.soundAlert, warnings),
      notifyRepeatSeconds: readInteger(
        input,
        'notifyRepeatSeconds',
        DEFAULT_CONFIG.notifyRepeatSeconds,
        0,
        600,
        warnings,
      ),
      auditNotices,
    }

    return { config, warnings }
  } catch {
    return {
      config: { ...DEFAULT_CONFIG },
      warnings: [{ field: 'config', code: 'validation-error', message: 'config could not be read' }],
    }
  }
}

export function isObserveOnly(config: PluginConfig): boolean {
  return config.mode === 'observe' || config.auditOnly
}

/** Map config to the risk policy used by the matcher. */
export function riskPolicyFromConfig(config: PluginConfig): RiskPolicy {
  return {
    version: RISK_POLICY_VERSION,
    autoLevels: ['low', 'medium'],
    allowHighRiskGrants:
      config.mode === 'active' && !config.auditOnly && config.allowHighRiskGrants,
    requireSecondConfirmForHigh: config.requireSecondConfirmForHigh,
  }
}

export function planLimitsFromConfig(config: PluginConfig): {
  maxItems: number
  maxUsesPerItem: number
  maxTotalUses: number
} {
  return {
    maxItems: config.maxPlanItems,
    maxUsesPerItem: config.maxUsesPerItem,
    maxTotalUses: config.maxTotalUses,
  }
}
