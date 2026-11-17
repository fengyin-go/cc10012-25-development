/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/**
 * 预警通知记录数据明细：一次阈值判定产生的可回查凭据。
 * 每条明细固化当时使用的规则版本与阈值上下界，规则后续调整不会改写历史依据。
 */
export type AlertNotification = {
  id: number
  /** 明细编号，形如 NOTI-0001 */
  code: string
  /** 明细结构版本，随导出文件保存，便于回看核对 */
  detailVersion: string
  ruleId: number
  ruleCode: string
  ruleVersion: string
  /** 同一指标的并发检测只认一份明细：同指标 + 同判定分钟 + 同规则版本 + 同越界方向 */
  dedupeKey: string
  metric: string
  metricValue: number
  thresholdUpper: number
  thresholdLower: number
  thresholdVersion: string
  breachSide: string
  severity: string
  channel: string
  recoveryCondition: string
  silentMinutes: number
  /** 判定发生的分钟（ISO，截到分钟），同一分钟重复越界不新增活动告警 */
  detectedAt: string
  /** 通知时刻：静默窗口内只更新活动告警，不新增明细 */
  notifiedAt: string
  /** 活动 / 恢复 */
  state: '活动' | '恢复'
  /** 是否被静默窗口吸收 */
  silenced: boolean
  /** 同一指标多条规则同时命中时的取舍来源：主告警 / 冲突保留 / 静默更新 */
  decision: '主告警' | '冲突保留' | '静默更新'
  conflictNote: string
  /** 活动告警编号，用于通知与活动告警互相核对 */
  alarmId: string
}

/** 活动告警：同一指标同一时刻只有一条活动告警（revision 随通知/静默更新递增）。 */
export type AlertAlarm = {
  id: string
  metric: string
  ruleId: number
  ruleCode: string
  ruleVersion: string
  thresholdUpper: number
  thresholdLower: number
  thresholdVersion: string
  severity: string
  channel: string
  recoveryCondition: string
  silentMinutes: number
  state: '活动' | '恢复'
  /** 整条活动告警对外发出的通知编号（首条明细的编号，恢复后指向恢复明细） */
  notificationCode: string
  /** 当前主告警明细编号（活动期间静默更新不改变它） */
  primaryNotificationCode: string
  /** 同一指标的冲突明细（保留各自阈值依据，供回查） */
  conflictCodes: string[]
  firstDetectedAt: string
  /** 最近一次判定分钟，用于同分钟去重与静默窗口计算 */
  lastDetectedAt: string
  lastNotifiedAt: string
  lastValue: number
  /** 静默窗口内更新次数，>0 说明被静默吸收过 */
  silencedUpdates: number
  revision: number
}

/** 异常检测结果：告警判定读取这里的指标值。 */
export type AnomalyReading = {
  id: number
  code: string
  metric: string
  value: number
  detectedAt: string
  sourceRuleCode: string
}

/** 规则口径：阈值判定与版本回查使用的归一化规则。 */
export type AlertRule = {
  id: number
  code: string
  metric: string
  upper: number
  lower: number
  severity: string
  silentMinutes: number
  channel: string
  recoveryCondition: string
  version: string
  status: string
}

export type AlertEventKind =
  | '通知'
  | '静默更新'
  | '恢复'
  | '重复判定'
  | '乱序忽略'
  | '冲突保留'
  | '阈值调整'
  | '重置'

export type AlertEvent = {
  id: number
  code: string
  at: string
  kind: AlertEventKind
  readingCode: string
  metric: string
  metricValue: number | null
  detailCodes: string[]
  alarmId: string
  note: string
}

/** 预警通知记录数据明细的持久化台账：schemaVersion / detailVersion 随导出文件一起保存。 */
export type AlertLedger = {
  schemaVersion: string
  detailVersion: string
  notificationSeq: number
  alarmSeq: number
  eventSeq: number
  notifications: AlertNotification[]
  alarms: AlertAlarm[]
  readings: AnomalyReading[]
  events: AlertEvent[]
  /** 已处理过的检测结果编号，保证并发重复投递只生效一次 */
  processedReadings: Record<string, string>
  /** 每个指标已处理到的判定分钟，乱序到达的旧检测结果只记录不重算 */
  metricWatermarks: Record<string, string>
}

