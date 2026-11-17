import type { AlertLedger } from './types'

// 预警通知记录数据明细单独落一个本地台账：刷新、关掉再打开都还能核对。
// schemaVersion / detailVersion 会写进导出的台账文件，换版本或换后端时能认出来。
const STORAGE_KEY = 'data-explore-studio:alert-ledger'

export const LEDGER_SCHEMA_VERSION = 'alert-ledger/v1'
export const NOTIFICATION_DETAIL_VERSION = 'alert-detail/v1'

export function emptyLedger(): AlertLedger {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    detailVersion: NOTIFICATION_DETAIL_VERSION,
    notificationSeq: 0,
    alarmSeq: 0,
    eventSeq: 0,
    notifications: [],
    alarms: [],
    readings: [],
    events: [],
    processedReadings: {},
    metricWatermarks: {},
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalize(raw: Partial<AlertLedger> | null): AlertLedger {
  const base = emptyLedger()
  if (!raw || typeof raw !== 'object') {
    return base
  }
  return {
    ...base,
    ...raw,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    detailVersion: NOTIFICATION_DETAIL_VERSION,
    notificationSeq: Number(raw.notificationSeq) || 0,
    alarmSeq: Number(raw.alarmSeq) || 0,
    eventSeq: Number(raw.eventSeq) || 0,
    notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
    alarms: Array.isArray(raw.alarms) ? raw.alarms : [],
    readings: Array.isArray(raw.readings) ? raw.readings : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    processedReadings: raw.processedReadings && typeof raw.processedReadings === 'object' ? raw.processedReadings : {},
    metricWatermarks: raw.metricWatermarks && typeof raw.metricWatermarks === 'object' ? raw.metricWatermarks : {},
  }
}

let cache: AlertLedger | null = null

export function loadLedger(): AlertLedger {
  if (cache !== null) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = emptyLedger()
    return cache
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cache = emptyLedger()
    return cache
  }
  try {
    cache = normalize(JSON.parse(raw) as Partial<AlertLedger>)
  } catch {
    cache = emptyLedger()
  }
  return cache
}

export function saveLedger(ledger: AlertLedger): void {
  const next = clone({ ...ledger, schemaVersion: LEDGER_SCHEMA_VERSION, detailVersion: NOTIFICATION_DETAIL_VERSION })
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetLedger(): AlertLedger {
  const ledger = emptyLedger()
  saveLedger(ledger)
  return ledger
}

export function ledgerStorageKey(): string {
  return STORAGE_KEY
}
