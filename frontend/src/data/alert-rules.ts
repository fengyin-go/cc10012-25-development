import type { AlertRule, EntryRow } from './types'

// 规则口径的纯计算：阈值解析、越界判定、级别排序与保存前校验。
// 不读写存储，页面、状态流转与判定服务共用同一份口径。

export const SEVERITY_RANK: Record<string, number> = { 严重: 3, 警告: 2, 提示: 1 }

export function toNumber(value: unknown): number {
  const text = String(value ?? '').trim()
  if (text === '') {
    return Number.NaN
  }
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function parseRule(row: EntryRow): AlertRule | null {
  const upper = toNumber(row['阈值上界'])
  const lower = toNumber(row['阈值下界'])
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) {
    return null
  }
  return {
    id: Number(row.id),
    code: String(row['规则编号'] ?? ''),
    metric: String(row['关联指标'] ?? '').trim(),
    upper,
    lower,
    severity: String(row['告警级别'] ?? '提示'),
    silentMinutes: Math.max(0, Math.trunc(toNumber(row['静默分钟'])) || 0),
    channel: String(row['通知渠道'] ?? ''),
    recoveryCondition: String(row['恢复条件'] ?? ''),
    version: String(row['规则版本'] ?? 'v1').trim() || 'v1',
    status: String(row.status ?? ''),
  }
}

/** 不允许保存越界条件：下界必须小于上界，静默分钟不能为负，版本不能为空。 */
export function validateRuleInput(input: {
  upper: unknown
  lower: unknown
  silentMinutes: unknown
  version?: unknown
}): string | null {
  const upper = toNumber(input.upper)
  const lower = toNumber(input.lower)
  const silent = toNumber(input.silentMinutes)
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) {
    return '阈值上下界必须是数字'
  }
  if (!(lower < upper)) {
    return `阈值下界 ${lower} 必须小于阈值上界 ${upper}，不允许保存越界条件`
  }
  if (!Number.isFinite(silent) || silent < 0) {
    return '静默分钟必须是非负数字'
  }
  if (input.version !== undefined && !String(input.version).trim()) {
    return '规则版本不能为空'
  }
  return null
}

/** 启用前校验：阈值必须能解析且下界小于上界，避免带着越界条件参与判定。 */
export function validateRuleRow(row: EntryRow): string | null {
  const rule = parseRule(row)
  if (!rule) {
    return '阈值上下界必须是数字，当前规则无法参与判定'
  }
  if (!rule.metric) {
    return '关联指标不能为空'
  }
  return validateRuleInput({
    upper: rule.upper,
    lower: rule.lower,
    silentMinutes: rule.silentMinutes,
    version: rule.version,
  })
}

export function directionOf(value: number, rule: AlertRule): '上界' | '下界' | null {
  if (value > rule.upper) return '上界'
  if (value < rule.lower) return '下界'
  return null
}

export function higherSeverity(a: AlertRule, b: AlertRule): boolean {
  const rankA = SEVERITY_RANK[a.severity] ?? 0
  const rankB = SEVERITY_RANK[b.severity] ?? 0
  if (rankA !== rankB) {
    return rankA > rankB
  }
  // 同级别时覆盖区间更宽的规则作为主告警，取舍结果稳定可复现。
  return a.upper - a.lower >= b.upper - b.lower
}

export function recoveryText(rule: { lower: number; upper: number }): string {
  return `指标回落到 ${rule.lower}~${rule.upper} 之间`
}
