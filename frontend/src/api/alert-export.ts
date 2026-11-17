import { LEDGER_SCHEMA_VERSION, NOTIFICATION_DETAIL_VERSION, loadLedger } from '@/data/alert-store'
import type { AlertDetailFilters, alertStats, listAlarms, listNotifications } from '@/api/alert-service'

// 导出与页面列表共用同一份读模型：同一筛选条件导出的行必须和表格里看到的行一一对应。
// type-only import 避免运行时循环依赖。

export const NOTIFICATION_HEADERS = [
  '明细编号',
  '明细版本',
  '规则编号',
  '规则版本',
  '关联指标',
  '指标值',
  '阈值上界',
  '阈值下界',
  '阈值版本',
  '越界方向',
  '告警级别',
  '通知渠道',
  '静默分钟',
  '判定分钟',
  '通知时间',
  '明细状态',
  '静默吸收',
  '取舍来源',
  '活动告警',
  '恢复条件',
  '冲突说明',
]

export const ALARM_HEADERS = [
  '活动告警编号',
  '关联指标',
  '主规则',
  '规则版本',
  '阈值上界',
  '阈值下界',
  '阈值版本',
  '告警级别',
  '告警状态',
  '当前明细编号',
  '主告警明细',
  '最新指标值',
  '首次判定时间',
  '最近更新',
  '静默更新次数',
  '冲突明细',
]

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvLines(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function notificationRows(
  notifications: ReturnType<typeof listNotifications>,
): (string | number)[][] {
  return notifications.map((item) => [
    item.code,
    item.detailVersion,
    item.ruleCode,
    item.ruleVersion,
    item.metric,
    item.metricValue,
    item.thresholdUpper,
    item.thresholdLower,
    item.thresholdVersion,
    item.breachSide,
    item.severity,
    item.channel,
    item.silentMinutes,
    item.detectedAt,
    item.notifiedAt,
    item.state,
    item.silenced ? '是' : '否',
    item.decision,
    item.alarmId,
    item.recoveryCondition,
    item.conflictNote,
  ])
}

export function alarmRows(alarms: ReturnType<typeof listAlarms>): (string | number)[][] {
  return alarms.map((item) => [
    item.id,
    item.metric,
    item.ruleCode,
    item.ruleVersion,
    item.thresholdUpper,
    item.thresholdLower,
    item.thresholdVersion,
    item.severity,
    item.state,
    item.notificationCode,
    item.primaryNotificationCode,
    item.lastValue,
    item.firstDetectedAt,
    item.lastNotifiedAt,
    item.silencedUpdates,
    item.conflictCodes.join(' '),
  ])
}

export function buildNotificationCsv(
  notifications: ReturnType<typeof listNotifications>,
): { filename: string; content: string } {
  const lines = [NOTIFICATION_HEADERS.join(','), csvLines(notificationRows(notifications))]
  return { filename: '预警通知记录数据明细.csv', content: `﻿${lines.join('\n')}` }
}

export function buildAlarmCsv(alarms: ReturnType<typeof listAlarms>): { filename: string; content: string } {
  const lines = [ALARM_HEADERS.join(','), csvLines(alarmRows(alarms))]
  return { filename: '预警通知活动告警.csv', content: `﻿${lines.join('\n')}` }
}

/** 完整台账文件：明细 + 活动告警 + 判定事件 + 检测结果 + 版本号，版本随文件保存。 */
export function buildLedgerExport(
  notifications: ReturnType<typeof listNotifications>,
  filters: AlertDetailFilters = {},
): { filename: string; content: string } {
  const ledger = loadLedger()
  const payload = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    detailVersion: NOTIFICATION_DETAIL_VERSION,
    exportedAt: new Date().toISOString(),
    filters,
    notifications,
    alarms: ledger.alarms,
    events: ledger.events,
    readings: ledger.readings,
  }
  const date = new Date()
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return {
    filename: `预警通知记录数据明细-${stamp}.json`,
    content: JSON.stringify(payload, null, 2),
  }
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadNotificationCsv(notifications: ReturnType<typeof listNotifications>): void {
  const { filename, content } = buildNotificationCsv(notifications)
  downloadFile(filename, content, 'text/csv;charset=utf-8')
}

export function downloadLedgerJson(
  notifications: ReturnType<typeof listNotifications>,
  filters: AlertDetailFilters = {},
): void {
  const { filename, content } = buildLedgerExport(notifications, filters)
  downloadFile(filename, content, 'application/json;charset=utf-8')
}

export type AlertStatsShape = ReturnType<typeof alertStats>
