import { listRows, saveRows } from '@/data/local-store'
import { LEDGER_SCHEMA_VERSION, NOTIFICATION_DETAIL_VERSION, loadLedger, resetLedger, saveLedger } from '@/data/alert-store'
import { directionOf, higherSeverity, parseRule, recoveryText, toNumber, validateRuleInput } from '@/data/alert-rules'
import type {
  AlertAlarm,
  AlertEvent,
  AlertLedger,
  AlertNotification,
  AlertRule,
  AnomalyReading,
  EntryRow,
} from '@/data/types'

export { validateRuleInput } from '@/data/alert-rules'

export type AlertEvaluationResult = {
  ok: boolean
  message: string
  /** 本次判定是否真正生效（false = 并发重复 / 乱序 / 静默） */
  applied: boolean
  detailCodes: string[]
  alarmId: string
}

function isProcessed(ledger: AlertLedger, code: string): boolean {
  return Object.prototype.hasOwnProperty.call(ledger.processedReadings, code)
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function toMinute(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1, 2)
  const day = pad(date.getDate(), 2)
  const hour = pad(date.getHours(), 2)
  const minute = pad(date.getMinutes(), 2)
  return `${year}-${month}-${day}T${hour}:${minute}:00`
}

function nowIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}T${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}`
}

export function listAlertRules(): AlertRule[] {
  return listRows('alert')
    .map(parseRule)
    .filter((rule): rule is AlertRule => rule !== null)
}

export function listEnabledRules(): AlertRule[] {
  return listAlertRules().filter((rule) => rule.status === '已启用')
}

export function loadAlertLedger(): AlertLedger {
  return loadLedger()
}

export function resetAlertLedger(): AlertLedger {
  return resetLedger()
}

export function ledgerVersions(): { schemaVersion: string; detailVersion: string } {
  return { schemaVersion: LEDGER_SCHEMA_VERSION, detailVersion: NOTIFICATION_DETAIL_VERSION }
}

function nextEvent(ledger: AlertLedger, event: Omit<AlertEvent, 'id' | 'code' | 'at'>): AlertEvent {
  ledger.eventSeq += 1
  const record: AlertEvent = {
    id: ledger.eventSeq,
    code: `EVNT-${pad(ledger.eventSeq, 4)}`,
    at: nowIso(),
    ...event,
  }
  ledger.events.push(record)
  return record
}

/** 更新规则阈值并递增版本：保存前拦掉越界条件，历史明细里的旧阈值不受影响。 */
export function updateRuleThresholds(
  ruleId: number,
  input: { upper: number; lower: number; silentMinutes: number; version: string },
): { ok: boolean; message: string; rule?: AlertRule } {
  const invalid = validateRuleInput(input)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const rows = listRows('alert')
  const index = rows.findIndex((row) => Number(row.id) === ruleId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${ruleId} 的预警规则` }
  }
  const before = parseRule(rows[index])
  if (!before) {
    return { ok: false, message: '原规则阈值无法解析，不能按新口径保存' }
  }
  if (before.status !== '已启用') {
    return { ok: false, message: `规则 ${before.code} 当前为「${before.status}」，启用后才能调整判定口径` }
  }
  const updated: EntryRow = {
    ...rows[index],
    '阈值上界': String(input.upper),
    '阈值下界': String(input.lower),
    '静默分钟': String(input.silentMinutes),
    '规则版本': input.version.trim(),
    '恢复条件': recoveryText({ lower: input.lower, upper: input.upper }),
  }
  const next = [...rows]
  next[index] = updated
  saveRows('alert', next)

  const ledger = loadLedger()
  const after = parseRule(updated)
  if (after) {
    // 口径调整后，活动告警下次判定按新版本核对；历史明细保留旧阈值与旧版本。
    nextEvent(ledger, {
      kind: '阈值调整',
      readingCode: '',
      metric: after.metric,
      metricValue: null,
      detailCodes: [],
      alarmId: '',
      note: `${after.code} 阈值 ${before.lower}~${before.upper} → ${after.lower}~${after.upper}，版本 ${before.version} → ${after.version}`,
    })
    saveLedger(ledger)
  }
  return { ok: true, message: `规则 ${updated['规则编号']} 已按新口径保存，版本 ${updated['规则版本']}`, rule: after ?? undefined }
}

function newNotification(
  ledger: AlertLedger,
  input: Omit<AlertNotification, 'id' | 'code' | 'detailVersion' | 'notifiedAt' | 'silenced' | 'decision' | 'conflictNote'>,
): AlertNotification {
  ledger.notificationSeq += 1
  const notification: AlertNotification = {
    id: ledger.notificationSeq,
    code: `NOTI-${pad(ledger.notificationSeq, 4)}`,
    detailVersion: NOTIFICATION_DETAIL_VERSION,
    notifiedAt: nowIso(),
    silenced: false,
    decision: '主告警',
    conflictNote: '',
    ...input,
  }
  ledger.notifications.push(notification)
  return notification
}

function findActiveAlarm(ledger: AlertLedger, metric: string): AlertAlarm | undefined {
  return ledger.alarms.find((alarm) => alarm.metric === metric && alarm.state === '活动')
}

function newAlarm(ledger: AlertLedger, rule: AlertRule, reading: AnomalyReading, detailCode: string): AlertAlarm {
  ledger.alarmSeq += 1
  const alarm: AlertAlarm = {
    id: `ALRM-${pad(ledger.alarmSeq, 4)}`,
    metric: rule.metric,
    ruleId: rule.id,
    ruleCode: rule.code,
    ruleVersion: rule.version,
    thresholdUpper: rule.upper,
    thresholdLower: rule.lower,
    thresholdVersion: `${rule.code}@${rule.version}`,
    severity: rule.severity,
    channel: rule.channel,
    recoveryCondition: rule.recoveryCondition,
    silentMinutes: rule.silentMinutes,
    state: '活动',
    notificationCode: detailCode,
    primaryNotificationCode: detailCode,
    conflictCodes: [],
    firstDetectedAt: reading.detectedAt,
    lastDetectedAt: reading.detectedAt,
    lastNotifiedAt: nowIso(),
    lastValue: reading.value,
    silencedUpdates: 0,
    revision: 1,
  }
  ledger.alarms.push(alarm)
  return alarm
}

function withinSilence(alarm: AlertAlarm, detectedAt: string): boolean {
  const last = new Date(alarm.lastDetectedAt).getTime()
  const current = new Date(detectedAt).getTime()
  if (!Number.isFinite(last) || !Number.isFinite(current)) {
    return false
  }
  return current >= last && current - last < alarm.silentMinutes * 60 * 1000
}

/**
 * 阈值判定：读取异常检测结果里的指标值，按上下界与静默窗口计算通知。
 *
 * 约定：
 * - 同一指标的并发检测只生效一次（processedReadings 幂等 + 同分钟去重）；
 * - 同一分钟再次越界只更新活动告警，不新增明细；
 * - 静默窗口内只更新那一条活动告警；
 * - 同一指标的每条规则各自保留阈值依据，冲突时保留来源取舍。
 */
export function evaluateReading(reading: AnomalyReading): AlertEvaluationResult {
  const ledger = loadLedger()
  const minute = toMinute(reading.detectedAt)

  if (isProcessed(ledger, reading.code)) {
    nextEvent(ledger, {
      kind: '重复判定',
      readingCode: reading.code,
      metric: reading.metric,
      metricValue: reading.value,
      detailCodes: [ledger.processedReadings[reading.code]],
      alarmId: '',
      note: '同一份检测结果并发投递，仅第一次生效',
    })
    saveLedger(ledger)
    return {
      ok: true,
      applied: false,
      message: `检测结果 ${reading.code} 已处理过，并发重复只生效一次`,
      detailCodes: [ledger.processedReadings[reading.code]],
      alarmId: '',
    }
  }

  const watermark = ledger.metricWatermarks[reading.metric]
  if (watermark && minute < watermark) {
    nextEvent(ledger, {
      kind: '乱序忽略',
      readingCode: reading.code,
      metric: reading.metric,
      metricValue: reading.value,
      detailCodes: [],
      alarmId: findActiveAlarm(ledger, reading.metric)?.id ?? '',
      note: `判定分钟 ${minute} 早于已处理水位 ${watermark}，不重算恢复`,
    })
    ledger.processedReadings[reading.code] = ''
    saveLedger(ledger)
    return { ok: true, applied: false, message: `检测结果 ${reading.code} 早于已处理水位，按乱序忽略`, detailCodes: [], alarmId: '' }
  }

  ledger.metricWatermarks[reading.metric] = watermark && watermark > minute ? watermark : minute
  ledger.readings.push(reading)

  const rules = listEnabledRules().filter((rule) => rule.metric === reading.metric)
  const hits = rules
    .map((rule) => ({ rule, side: directionOf(reading.value, rule) }))
    .filter((item): item is { rule: AlertRule; side: '上界' | '下界' } => item.side !== null)
    .sort((a, b) => (higherSeverity(a.rule, b.rule) ? -1 : 1))

  if (hits.length === 0) {
    const active = findActiveAlarm(ledger, reading.metric)
    if (active && rules.length > 0) {
      // 全部规则都不再越界，且读数是新判定，触发一次恢复，之后不再重复通知。
      active.state = '恢复'
      active.revision += 1
      active.lastValue = reading.value
      active.lastDetectedAt = reading.detectedAt
      active.lastNotifiedAt = nowIso()
      const detail = newNotification(ledger, {
        ruleId: active.ruleId,
        ruleCode: active.ruleCode,
        ruleVersion: active.ruleVersion,
        dedupeKey: `${reading.metric}|${minute}|${active.ruleCode}@${active.ruleVersion}|恢复`,
        metric: reading.metric,
        metricValue: reading.value,
        thresholdUpper: active.thresholdUpper,
        thresholdLower: active.thresholdLower,
        thresholdVersion: active.thresholdVersion,
        breachSide: '恢复',
        severity: active.severity,
        channel: active.channel,
        recoveryCondition: active.recoveryCondition,
        silentMinutes: active.silentMinutes,
        detectedAt: reading.detectedAt,
        state: '恢复',
        alarmId: active.id,
      })
      active.notificationCode = detail.code
      nextEvent(ledger, {
        kind: '恢复',
        readingCode: reading.code,
        metric: reading.metric,
        metricValue: reading.value,
        detailCodes: [detail.code],
        alarmId: active.id,
        note: `指标回到 ${active.thresholdLower}~${active.thresholdUpper} 之间，活动告警恢复`,
      })
      ledger.processedReadings[reading.code] = detail.code
      saveLedger(ledger)
      return { ok: true, applied: true, message: `指标 ${reading.metric} 已恢复`, detailCodes: [detail.code], alarmId: active.id }
    }
    nextEvent(ledger, {
      kind: '重复判定',
      readingCode: reading.code,
      metric: reading.metric,
      metricValue: reading.value,
      detailCodes: [],
      alarmId: active?.id ?? '',
      note: '未命中任何启用规则，无通知',
    })
    ledger.processedReadings[reading.code] = ''
    saveLedger(ledger)
    return { ok: true, applied: false, message: `指标 ${reading.metric} 未命中启用规则`, detailCodes: [], alarmId: '' }
  }

  const active = findActiveAlarm(ledger, reading.metric)
  const detailCodes: string[] = []

  // 同一分钟再次越界：只更新活动告警，不再新增通知明细。
  const sameMinute = active && toMinute(active.lastDetectedAt) === minute
  if (sameMinute) {
    active!.lastValue = reading.value
    active!.revision += 1
    const event = nextEvent(ledger, {
      kind: '重复判定',
      readingCode: reading.code,
      metric: reading.metric,
      metricValue: reading.value,
      detailCodes: [active!.primaryNotificationCode],
      alarmId: active!.id,
      note: '同一分钟再次越界，仅更新活动告警，不新增明细',
    })
    ledger.processedReadings[reading.code] = active!.primaryNotificationCode
    saveLedger(ledger)
    return {
      ok: true,
      applied: false,
      message: `同一分钟再次越界，活动告警 ${active!.id} 仅更新（${event.code}）`,
      detailCodes: [active!.primaryNotificationCode],
      alarmId: active!.id,
    }
  }

  const primary = hits[0]
  let alarm: AlertAlarm

  if (active) {
    // 已有活动告警：静默窗口内只更新这一条，不新增主告警。
    if (withinSilence(active, reading.detectedAt)) {
      active.lastValue = reading.value
      active.lastDetectedAt = reading.detectedAt
      active.lastNotifiedAt = nowIso()
      active.revision += 1
      active.silencedUpdates += 1
      const silenced = newNotification(ledger, {
        ruleId: primary.rule.id,
        ruleCode: primary.rule.code,
        ruleVersion: primary.rule.version,
        dedupeKey: `${reading.metric}|${minute}|${primary.rule.code}@${primary.rule.version}|${primary.side}`,
        metric: reading.metric,
        metricValue: reading.value,
        thresholdUpper: primary.rule.upper,
        thresholdLower: primary.rule.lower,
        thresholdVersion: `${primary.rule.code}@${primary.rule.version}`,
        breachSide: primary.side,
        severity: primary.rule.severity,
        channel: primary.rule.channel,
        recoveryCondition: primary.rule.recoveryCondition,
        silentMinutes: primary.rule.silentMinutes,
        detectedAt: reading.detectedAt,
        state: '活动',
        alarmId: active.id,
      })
      silenced.silenced = true
      silenced.decision = '静默更新'
      silenced.conflictNote = `静默窗口内命中规则 ${primary.rule.code}@${primary.rule.version}，只更新活动告警 ${active.id}`
      active.conflictCodes.push(silenced.code)
      detailCodes.push(silenced.code)
      // 静默窗口内同样保留其它规则的阈值依据，但都只挂在这一条活动告警上。
      for (const hit of hits.slice(1)) {
        const conflict = newNotification(ledger, {
          ruleId: hit.rule.id,
          ruleCode: hit.rule.code,
          ruleVersion: hit.rule.version,
          dedupeKey: `${reading.metric}|${minute}|${hit.rule.code}@${hit.rule.version}|${hit.side}`,
          metric: hit.rule.metric,
          metricValue: reading.value,
          thresholdUpper: hit.rule.upper,
          thresholdLower: hit.rule.lower,
          thresholdVersion: `${hit.rule.code}@${hit.rule.version}`,
          breachSide: hit.side,
          severity: hit.rule.severity,
          channel: hit.rule.channel,
          recoveryCondition: hit.rule.recoveryCondition,
          silentMinutes: hit.rule.silentMinutes,
          detectedAt: reading.detectedAt,
          state: '活动',
          alarmId: active.id,
        })
        conflict.silenced = true
        conflict.decision = '冲突保留'
        conflict.conflictNote = `静默窗口内同时命中 ${primary.rule.code}@${primary.rule.version} 与 ${hit.rule.code}@${hit.rule.version}，只更新活动告警 ${active.id}，保留各自阈值依据`
        active.conflictCodes.push(conflict.code)
        detailCodes.push(conflict.code)
      }
      nextEvent(ledger, {
        kind: '静默更新',
        readingCode: reading.code,
        metric: reading.metric,
        metricValue: reading.value,
        detailCodes,
        alarmId: active.id,
        note: `静默窗口 ${active.silentMinutes} 分钟内，仅更新活动告警，不新增活动告警`,
      })
      ledger.processedReadings[reading.code] = silenced.code
      saveLedger(ledger)
      return { ok: true, applied: false, message: `静默窗口内仅更新活动告警 ${active.id}`, detailCodes, alarmId: active.id }
    }
    // 静默窗口已过且仍越界：沿用同一活动告警复核，升级版本/阈值依据。
    active.ruleId = primary.rule.id
    active.ruleCode = primary.rule.code
    active.ruleVersion = primary.rule.version
    active.thresholdUpper = primary.rule.upper
    active.thresholdLower = primary.rule.lower
    active.thresholdVersion = `${primary.rule.code}@${primary.rule.version}`
    active.severity = primary.rule.severity
    active.channel = primary.rule.channel
    active.recoveryCondition = primary.rule.recoveryCondition
    active.silentMinutes = primary.rule.silentMinutes
    active.lastValue = reading.value
    active.lastDetectedAt = reading.detectedAt
    active.lastNotifiedAt = nowIso()
    active.revision += 1
    alarm = active
  } else {
    alarm = newAlarm(ledger, primary.rule, reading, '')
  }

  const primaryDetail = newNotification(ledger, {
    ruleId: primary.rule.id,
    ruleCode: primary.rule.code,
    ruleVersion: primary.rule.version,
    dedupeKey: `${reading.metric}|${minute}|${primary.rule.code}@${primary.rule.version}|${primary.side}`,
    metric: primary.rule.metric,
    metricValue: reading.value,
    thresholdUpper: primary.rule.upper,
    thresholdLower: primary.rule.lower,
    thresholdVersion: `${primary.rule.code}@${primary.rule.version}`,
    breachSide: primary.side,
    severity: primary.rule.severity,
    channel: primary.rule.channel,
    recoveryCondition: primary.rule.recoveryCondition,
    silentMinutes: primary.rule.silentMinutes,
    detectedAt: reading.detectedAt,
    state: '活动',
    alarmId: alarm.id,
  })
  alarm.notificationCode = primaryDetail.code
  alarm.primaryNotificationCode = primaryDetail.code
  detailCodes.push(primaryDetail.code)

  // 同一指标同时命中多条规则：每条通知保留自己的规则版本与阈值依据。
  for (const hit of hits.slice(1)) {
    const conflict = newNotification(ledger, {
      ruleId: hit.rule.id,
      ruleCode: hit.rule.code,
      ruleVersion: hit.rule.version,
      dedupeKey: `${reading.metric}|${minute}|${hit.rule.code}@${hit.rule.version}|${hit.side}`,
      metric: hit.rule.metric,
      metricValue: reading.value,
      thresholdUpper: hit.rule.upper,
      thresholdLower: hit.rule.lower,
      thresholdVersion: `${hit.rule.code}@${hit.rule.version}`,
      breachSide: hit.side,
      severity: hit.rule.severity,
      channel: hit.rule.channel,
      recoveryCondition: hit.rule.recoveryCondition,
      silentMinutes: hit.rule.silentMinutes,
      detectedAt: reading.detectedAt,
      state: '活动',
      alarmId: alarm.id,
    })
    conflict.decision = '冲突保留'
    conflict.conflictNote = `同时命中 ${primary.rule.code}@${primary.rule.version}（${primary.rule.severity}，主告警）与 ${hit.rule.code}@${hit.rule.version}（${hit.rule.severity}），按级别保留各自阈值依据`
    alarm.conflictCodes.push(conflict.code)
    detailCodes.push(conflict.code)
    nextEvent(ledger, {
      kind: '冲突保留',
      readingCode: reading.code,
      metric: reading.metric,
      metricValue: reading.value,
      detailCodes: [conflict.code],
      alarmId: alarm.id,
      note: conflict.conflictNote,
    })
  }

  nextEvent(ledger, {
    kind: '通知',
    readingCode: reading.code,
    metric: reading.metric,
    metricValue: reading.value,
    detailCodes,
    alarmId: alarm.id,
    note: `指标 ${reading.value} ${primary.side === '上界' ? '高于上界' : '低于下界'} ${primary.side === '上界' ? primary.rule.upper : primary.rule.lower}，生成 ${detailCodes.length} 条通知明细`,
  })
  ledger.processedReadings[reading.code] = primaryDetail.code
  saveLedger(ledger)
  return {
    ok: true,
    applied: true,
    message: `已生成 ${detailCodes.length} 条预警通知明细，活动告警 ${alarm.id}`,
    detailCodes,
    alarmId: alarm.id,
  }
}

/** 模拟并发检测：同一份检测结果同时投递两次，只有第一次生效。 */
export function evaluateReadingConcurrently(reading: AnomalyReading): {
  results: AlertEvaluationResult[]
  appliedCount: number
} {
  // 纯前端没有真正的并行线程，这里把同一份结果连续投递两次，
  // 依赖 processedReadings 做幂等，等价于并发只生效一次。
  const results = [evaluateReading(reading), evaluateReading(reading)]
  return { results, appliedCount: results.filter((item) => item.applied).length }
}

/** 生成一份新的检测结果编号：同一指标同一时刻的重复操作也能区分，同时不会和已处理编号撞车。 */
export function makeReadingCode(base: string, metric: string, detectedAt: string): string {
  const ledger = loadLedger()
  const stamp = detectedAt.replace(/[-:T]/g, '').slice(0, 12) || String(Date.now())
  const prefix = `${base || 'READ'}-${stamp}`
  let seq = 1
  let code = `${prefix}-${seq}`
  while (isProcessed(ledger, code) || ledger.readings.some((item) => item.code === code)) {
    seq += 1
    code = `${prefix}-${seq}`
  }
  return code
}

/** 把异常检测页的「当前指标值」推成一份检测结果，交给阈值判定。 */
export function pushReadingsFromAnomaly(anomalyRuleId: number): AlertEvaluationResult {
  const rows = listRows('anomaly')
  const row = rows.find((item) => Number(item.id) === anomalyRuleId)
  if (!row) {
    return { ok: false, applied: false, message: `没有找到编号为 ${anomalyRuleId} 的检测规则`, detailCodes: [], alarmId: '' }
  }
  const value = toNumber(row['当前指标值'])
  if (!Number.isFinite(value)) {
    return { ok: false, applied: false, message: '检测规则缺少可用的当前指标值', detailCodes: [], alarmId: '' }
  }
  const detectedAt = String(row['最近检测时间'] ?? '') || nowIso()
  const sourceCode = String(row['规则编号'] ?? `ANOM-${row.id}`)
  const reading: AnomalyReading = {
    id: Number(row.id),
    code: makeReadingCode(sourceCode, String(row['监控指标'] ?? ''), detectedAt),
    metric: String(row['监控指标'] ?? ''),
    value,
    detectedAt,
    sourceRuleCode: sourceCode,
  }
  return evaluateReading(reading)
}

export function alarmMatchesNotification(alarm: AlertAlarm, notification: AlertNotification): boolean {
  if (notification.alarmId !== alarm.id) {
    return false
  }
  if (notification.ruleCode !== alarm.ruleCode || notification.ruleVersion !== alarm.ruleVersion) {
    // 冲突保留明细回查的是各自规则依据，仍通过 alarmId 关联，但主告警明细必须与活动告警版本一致。
    return notification.decision === '冲突保留'
  }
  return notification.thresholdUpper === alarm.thresholdUpper && notification.thresholdLower === alarm.thresholdLower
}

/** 活动告警与通知明细的核对结果：页面直接展示，用户可检查。 */
export function reconcileAlarms(ledger: AlertLedger): {
  alarmId: string
  metric: string
  state: string
  notificationCode: string
  matched: boolean
  notificationCount: number
}[] {
  return ledger.alarms.map((alarm) => {
    const related = ledger.notifications.filter((item) => item.alarmId === alarm.id)
    const active = related.find((item) => item.code === alarm.notificationCode)
    return {
      alarmId: alarm.id,
      metric: alarm.metric,
      state: alarm.state,
      notificationCode: alarm.notificationCode,
      matched: Boolean(active) && alarmMatchesNotification(alarm, active as AlertNotification),
      notificationCount: related.length,
    }
  })
}

export type AlertDetailFilters = {
  metric?: string
  state?: string
  decision?: string
  ruleCode?: string
}

export function listNotifications(filters: AlertDetailFilters = {}): AlertNotification[] {
  const ledger = loadLedger()
  return ledger.notifications
    .filter((item) => (filters.metric ? item.metric.includes(filters.metric) : true))
    .filter((item) => (filters.state ? item.state === filters.state : true))
    .filter((item) => (filters.decision ? item.decision === filters.decision : true))
    .filter((item) => (filters.ruleCode ? item.ruleCode.includes(filters.ruleCode) : true))
    .slice()
    .sort((a, b) => b.id - a.id)
}

export function listAlarms(state?: string): AlertAlarm[] {
  const ledger = loadLedger()
  return ledger.alarms
    .filter((item) => (state ? item.state === state : true))
    .slice()
    .sort((a, b) => (a.firstDetectedAt < b.firstDetectedAt ? 1 : -1))
}

export function listEvents(): AlertEvent[] {
  return loadLedger().events.slice().reverse()
}

export function listReadings(): AnomalyReading[] {
  return loadLedger().readings.slice().reverse()
}

/** 明细统计：给页面卡片与导出共用，保证列表和导出同一口径。 */
export function alertStats(): {
  ruleTotal: number
  enabledRules: number
  activeAlarms: number
  recoveredAlarms: number
  notificationTotal: number
  silencedTotal: number
  conflictTotal: number
} {
  const ledger = loadLedger()
  const rules = listAlertRules()
  return {
    ruleTotal: rules.length,
    enabledRules: rules.filter((rule) => rule.status === '已启用').length,
    activeAlarms: ledger.alarms.filter((item) => item.state === '活动').length,
    recoveredAlarms: ledger.alarms.filter((item) => item.state === '恢复').length,
    notificationTotal: ledger.notifications.length,
    silencedTotal: ledger.notifications.filter((item) => item.silenced).length,
    conflictTotal: ledger.notifications.filter((item) => item.decision === '冲突保留').length,
  }
}

