<template>
  <section class="page" data-module="alert">
    <header class="page-head">
      <div>
        <h2>预警通知管理</h2>
        <p class="page-desc">
          维护预警规则的阈值口径，按异常检测结果中的指标值判定上下界，生成可回查的预警通知记录数据明细。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记预警规则</button>
        <button class="btn" type="button" @click="exportRules">导出预警规则清单</button>
        <button class="btn" type="button" @click="exportDetails">导出预警通知明细</button>
        <button class="btn" type="button" @click="exportLedger">导出台账文件</button>
        <button class="btn ghost" type="button" @click="clearLedger">重置判定台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" data-stat>{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">台账版本：{{ versions.schemaVersion }} · 明细版本：{{ versions.detailVersion }}</span>
    </p>

    <section class="panel" data-panel="rules">
      <h3 class="panel-title">预警规则与阈值口径</h3>
      <form class="filter-bar" @submit.prevent="reloadRules">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table" data-table="rules">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button
                class="link"
                type="button"
                :disabled="String(row.status) !== '已启用'"
                @click="openThresholdEditor(row)"
              >
                调整阈值口径
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无预警通知数据，可先登记预警规则</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ total }} 条预警规则，已启用 {{ stats.enabledRules }} 条</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </section>

    <section v-if="editing" class="panel" data-panel="threshold-editor">
      <h3 class="panel-title">调整阈值口径 · {{ editing.ruleCode }}</h3>
      <form class="filter-bar" @submit.prevent="saveThresholds">
        <label class="filter-item">
          <span>阈值下界</span>
          <input v-model.number="editing.lower" type="number" step="any" data-field="lower" />
        </label>
        <label class="filter-item">
          <span>阈值上界</span>
          <input v-model.number="editing.upper" type="number" step="any" data-field="upper" />
        </label>
        <label class="filter-item">
          <span>静默分钟</span>
          <input v-model.number="editing.silentMinutes" type="number" min="0" step="1" data-field="silent" />
        </label>
        <label class="filter-item">
          <span>规则版本</span>
          <input v-model="editing.version" data-field="version" />
        </label>
        <button class="btn primary" type="submit">按新口径保存</button>
        <button class="btn ghost" type="button" @click="editing = null">取消</button>
      </form>
      <p class="hint-text">
        下界必须小于上界，越界条件不允许保存；调整只影响后续判定，历史明细保留原阈值与版本。
      </p>
      <p v-if="editorMessage" class="error-text" data-role="editor-message">{{ editorMessage }}</p>
    </section>

    <section class="panel" data-panel="simulate">
      <h3 class="panel-title">阈值判定 · 读取异常检测结果</h3>
      <table class="data-table" data-table="readings-source">
        <thead>
          <tr><th>检测规则</th><th>监控指标</th><th>当前指标值</th><th>最近检测时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in anomalyRows" :key="String(item.id)">
            <td>{{ item['规则编号'] }}</td>
            <td>{{ item['监控指标'] }}</td>
            <td>{{ item['当前指标值'] }}</td>
            <td>{{ item['最近检测时间'] }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="fillFromAnomaly(item)">填入判定台</button>
              <button class="link" type="button" @click="judge(item)">按此结果判定</button>
            </td>
          </tr>
          <tr v-if="!anomalyRows.length">
            <td colspan="5" class="empty-state">暂无异常检测结果</td>
          </tr>
        </tbody>
      </table>

      <form class="filter-bar" @submit.prevent="judgeManual">
        <label class="filter-item">
          <span>关联指标</span>
          <input v-model="readingForm.metric" data-field="reading-metric" />
        </label>
        <label class="filter-item">
          <span>指标值</span>
          <input v-model.number="readingForm.value" type="number" step="any" data-field="reading-value" />
        </label>
        <label class="filter-item">
          <span>判定时间</span>
          <input v-model="readingForm.detectedAt" type="datetime-local" step="60" data-field="reading-time" />
        </label>
        <button class="btn primary" type="submit">执行阈值判定</button>
        <button class="btn" type="button" @click="judgeManualTwice">模拟并发判定</button>
      </form>
      <p class="hint-text">
        每次判定会生成新的检测结果编号；同一份检测结果重复投递只生效一次，同一分钟再次越界只更新活动告警。
      </p>
      <p v-if="judgeMessage" class="result-text" data-role="judge-message">{{ judgeMessage }}</p>
    </section>

    <section class="panel" data-panel="notifications">
      <h3 class="panel-title">预警通知记录数据明细</h3>
      <form class="filter-bar" @submit.prevent="reloadDetails">
        <label class="filter-item">
          <span>关联指标</span>
          <input v-model="detailFilters.metric" data-filter="metric" />
        </label>
        <label class="filter-item">
          <span>明细状态</span>
          <select v-model="detailFilters.state" data-filter="state">
            <option value="">全部</option>
            <option value="活动">活动</option>
            <option value="恢复">恢复</option>
          </select>
        </label>
        <label class="filter-item">
          <span>取舍来源</span>
          <select v-model="detailFilters.decision" data-filter="decision">
            <option value="">全部</option>
            <option value="主告警">主告警</option>
            <option value="冲突保留">冲突保留</option>
            <option value="静默更新">静默更新</option>
          </select>
        </label>
        <label class="filter-item">
          <span>规则编号</span>
          <input v-model="detailFilters.ruleCode" data-filter="rule" />
        </label>
        <button class="btn" type="submit">筛选明细</button>
        <button class="btn ghost" type="button" @click="resetDetailFilters">重置</button>
      </form>

      <table class="data-table" data-table="notifications">
        <thead>
          <tr>
            <th>明细编号</th>
            <th>规则编号</th>
            <th>规则版本</th>
            <th>关联指标</th>
            <th>指标值</th>
            <th>阈值下界</th>
            <th>阈值上界</th>
            <th>阈值版本</th>
            <th>越界方向</th>
            <th>告警级别</th>
            <th>静默分钟</th>
            <th>判定分钟</th>
            <th>明细状态</th>
            <th>静默吸收</th>
            <th>取舍来源</th>
            <th>活动告警</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in detailRows"
            :key="item.code"
            :data-detail="item.code"
            :title="item.conflictNote || item.recoveryCondition"
          >
            <td>{{ item.code }}</td>
            <td>{{ item.ruleCode }}</td>
            <td>{{ item.ruleVersion }}</td>
            <td>{{ item.metric }}</td>
            <td>{{ item.metricValue }}</td>
            <td>{{ item.thresholdLower }}</td>
            <td>{{ item.thresholdUpper }}</td>
            <td>{{ item.thresholdVersion }}</td>
            <td>{{ item.breachSide }}</td>
            <td>{{ item.severity }}</td>
            <td>{{ item.silentMinutes }}</td>
            <td>{{ item.detectedAt }}</td>
            <td>{{ item.state }}</td>
            <td>{{ item.silenced ? '是' : '否' }}</td>
            <td>{{ item.decision }}</td>
            <td>{{ item.alarmId }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="inspect(item)">核对来源</button>
            </td>
          </tr>
          <tr v-if="!detailRows.length">
            <td colspan="17" class="empty-state">还没有预警通知记录数据明细，可先按异常检测结果执行阈值判定</td>
          </tr>
        </tbody>
      </table>
      <div v-if="inspecting" class="detail-card" data-role="detail-card">
        <h4>明细核对 · {{ inspecting.code }}</h4>
        <dl class="detail-grid">
          <dt>原始规则</dt><dd>{{ inspecting.ruleCode }}（规则 ID {{ inspecting.ruleId }}）· 版本 {{ inspecting.ruleVersion }}</dd>
          <dt>阈值依据</dt><dd>{{ inspecting.thresholdVersion }}：下界 {{ inspecting.thresholdLower }} / 上界 {{ inspecting.thresholdUpper }}</dd>
          <dt>指标读数</dt><dd>{{ inspecting.metric }} = {{ inspecting.metricValue }}，越界方向 {{ inspecting.breachSide }}</dd>
          <dt>静默状态</dt><dd>{{ inspecting.silentMinutes }} 分钟，{{ inspecting.silenced ? '本次被静默窗口吸收' : '本次未被静默' }}</dd>
          <dt>恢复条件</dt><dd>{{ inspecting.recoveryCondition }}</dd>
          <dt>活动告警</dt><dd>{{ inspecting.alarmId }} · 取舍 {{ inspecting.decision }}</dd>
          <dt>冲突说明</dt><dd>{{ inspecting.conflictNote || '无冲突' }}</dd>
          <dt>判定 / 通知</dt><dd>{{ inspecting.detectedAt }} → {{ inspecting.notifiedAt }} · 明细版本 {{ inspecting.detailVersion }}</dd>
        </dl>
        <button class="btn ghost" type="button" @click="inspecting = null">收起</button>
      </div>
      <footer class="page-foot">
        <span data-role="detail-count">共 {{ detailRows.length }} 条明细（与导出同一筛选口径，明细已持久化，重新打开仍可核对）</span>
        <button class="link" type="button" @click="exportFilteredDetails">导出当前筛选明细</button>
      </footer>
    </section>

    <section class="panel" data-panel="alarms">
      <h3 class="panel-title">活动告警核对</h3>
      <table class="data-table" data-table="alarms">
        <thead>
          <tr>
            <th>活动告警编号</th>
            <th>关联指标</th>
            <th>主规则</th>
            <th>规则版本</th>
            <th>阈值下界</th>
            <th>阈值上界</th>
            <th>告警状态</th>
            <th>当前明细</th>
            <th>主告警明细</th>
            <th>最新指标值</th>
            <th>静默更新次数</th>
            <th>冲突明细</th>
            <th>明细核对</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in alarmRowsData" :key="item.alarm.id" :data-alarm="item.alarm.id">
            <td>{{ item.alarm.id }}</td>
            <td>{{ item.alarm.metric }}</td>
            <td>{{ item.alarm.ruleCode }}</td>
            <td>{{ item.alarm.ruleVersion }}</td>
            <td>{{ item.alarm.thresholdLower }}</td>
            <td>{{ item.alarm.thresholdUpper }}</td>
            <td>{{ item.alarm.state }}</td>
            <td>{{ item.alarm.notificationCode }}</td>
            <td>{{ item.alarm.primaryNotificationCode }}</td>
            <td>{{ item.alarm.lastValue }}</td>
            <td>{{ item.alarm.silencedUpdates }}</td>
            <td>{{ item.alarm.conflictCodes.join('、') || '—' }}</td>
            <td>
              <span :class="item.reconciled.matched ? 'ok-text' : 'error-text'" data-role="reconcile">
                {{ item.reconciled.matched ? `一致（${item.reconciled.notificationCount} 条明细）` : '未对上' }}
              </span>
            </td>
          </tr>
          <tr v-if="!alarmRowsData.length">
            <td colspan="13" class="empty-state">还没有活动告警</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel" data-panel="events">
      <h3 class="panel-title">判定事件流水（可检查）</h3>
      <table class="data-table" data-table="events">
        <thead>
          <tr><th>事件编号</th><th>时间</th><th>类型</th><th>检测结果</th><th>关联指标</th><th>指标值</th><th>明细</th><th>活动告警</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in eventRows" :key="item.code">
            <td>{{ item.code }}</td>
            <td>{{ item.at }}</td>
            <td>{{ item.kind }}</td>
            <td>{{ item.readingCode || '—' }}</td>
            <td>{{ item.metric }}</td>
            <td>{{ item.metricValue ?? '—' }}</td>
            <td>{{ item.detailCodes.join('、') || '—' }}</td>
            <td>{{ item.alarmId || '—' }}</td>
            <td>{{ item.note }}</td>
          </tr>
          <tr v-if="!eventRows.length">
            <td colspan="9" class="empty-state">暂无判定事件</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  alertStats,
  evaluateReading,
  evaluateReadingConcurrently,
  ledgerVersions,
  listAlarms,
  listEvents,
  listNotifications,
  loadAlertLedger,
  makeReadingCode,
  pushReadingsFromAnomaly,
  reconcileAlarms,
  resetAlertLedger,
  updateRuleThresholds,
} from '@/api/alert-service'
import { downloadLedgerJson, downloadNotificationCsv } from '@/api/alert-export'
import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import type { AlertDetailFilters } from '@/api/alert-service'
import type { AlertNotification, AnomalyReading, EntryRow } from '@/data/types'

const meta = moduleMeta('alert')
const columns = ["规则编号", "关联指标", "阈值上界", "阈值下界", "告警级别", "静默分钟", "通知渠道", "恢复条件", "规则版本"]
const actions = ["提交校验", "启用规则", "停用规则"]
const statuses = ["草稿", "待校验", "已启用", "已停用"]
const versions = ledgerVersions()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const judgeMessage = ref('')
const editorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const anomalyRows = ref<EntryRow[]>([])
const detailRows = ref<AlertNotification[]>([])
const detailFilters = ref<AlertDetailFilters>({ metric: '', state: '', decision: '', ruleCode: '' })
const alarmRowsData = ref<{ alarm: ReturnType<typeof listAlarms>[number]; reconciled: { matched: boolean; notificationCount: number } }[]>([])
const eventRows = ref<ReturnType<typeof listEvents>>([])
const stats = ref(alertStats())
const editing = ref<{ ruleId: number; ruleCode: string; upper: number; lower: number; silentMinutes: number; version: string } | null>(null)
const inspecting = ref<AlertNotification | null>(null)
const readingForm = ref({
  metric: '库存水位',
  value: 170,
  detectedAt: '2026-11-17T08:20',
})
let readingSeq = 0

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const statsCards = computed(() => [
  { label: '预警规则总数', value: stats.value.ruleTotal },
  { label: '已启用规则', value: stats.value.enabledRules },
  { label: '活动告警', value: stats.value.activeAlarms },
  { label: '通知明细', value: stats.value.notificationTotal },
  { label: '静默吸收', value: stats.value.silencedTotal },
  { label: '冲突保留', value: stats.value.conflictTotal },
])

function resetFilters() {
  filters.value = {}
  reloadRules()
}

function exportRules() {
  downloadEntries(meta.key)
}

function exportDetails() {
  downloadNotificationCsv(detailRows.value)
}

function exportFilteredDetails() {
  downloadNotificationCsv(detailRows.value)
}

function clearLedger() {
  resetAlertLedger()
  judgeMessage.value = '判定台账已重置，仅清空通知明细与活动告警，规则数据保留'
  reloadAll()
}

function exportLedger() {
  downloadLedgerJson(listNotifications(detailFilters.value), detailFilters.value)
}

function openCreate() {
  errorMessage.value = '预警规则登记入口尚未接入审批流'
}

function openThresholdEditor(row: EntryRow) {
  editorMessage.value = ''
  editing.value = {
    ruleId: Number(row.id),
    ruleCode: String(row['规则编号'] ?? ''),
    upper: Number(row['阈值上界']),
    lower: Number(row['阈值下界']),
    silentMinutes: Number(row['静默分钟']),
    version: String(row['规则版本'] ?? 'v1'),
  }
}

function saveThresholds() {
  if (!editing.value) return
  const result = updateRuleThresholds(editing.value.ruleId, {
    upper: Number(editing.value.upper),
    lower: Number(editing.value.lower),
    silentMinutes: Number(editing.value.silentMinutes),
    version: editing.value.version,
  })
  if (!result.ok) {
    editorMessage.value = result.message
    return
  }
  editorMessage.value = ''
  editing.value = null
  reloadAll()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reloadAll()
}

function toLocalInput(value: string): string {
  return value ? value.slice(0, 16) : ''
}

function nextReading(code: string, metric: string, value: number, detectedAt: string): AnomalyReading {
  readingSeq += 1
  return {
    id: readingSeq,
    code: makeReadingCode(code, metric, detectedAt),
    metric,
    value,
    detectedAt,
    sourceRuleCode: code,
  }
}

function fillFromAnomaly(item: EntryRow) {
  readingForm.value = {
    metric: String(item['监控指标'] ?? ''),
    value: Number(item['当前指标值']),
    detectedAt: toLocalInput(String(item['最近检测时间'] ?? '')),
  }
}

function judge(item: EntryRow) {
  fillFromAnomaly(item)
  const result = pushReadingsFromAnomaly(Number(item.id))
  judgeMessage.value = result.message
  reloadAll()
}

function judgeManual() {
  const form = readingForm.value
  const reading = nextReading('MANUAL', form.metric.trim(), Number(form.value), form.detectedAt)
  const result = evaluateReading(reading)
  judgeMessage.value = `${reading.code}：${result.message}`
  reloadAll()
}

function judgeManualTwice() {
  const form = readingForm.value
  const reading = nextReading('MANUAL', form.metric.trim(), Number(form.value), form.detectedAt)
  const { results, appliedCount } = evaluateReadingConcurrently(reading)
  judgeMessage.value = `并发判定 ${results.length} 次，实际生效 ${appliedCount} 次：${results.map((r) => r.message).join(' / ')}`
  reloadAll()
}

function inspect(item: AlertNotification) {
  inspecting.value = item
}

function resetDetailFilters() {
  detailFilters.value = { metric: '', state: '', decision: '', ruleCode: '' }
  reloadDetails()
}

function reloadRules() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '预警通知列表读取失败'
  }
}

function reloadDetails() {
  detailRows.value = listNotifications(detailFilters.value)
  const reconciled = reconcileAlarms(loadAlertLedger())
  alarmRowsData.value = listAlarms().map((alarm) => {
    const match = reconciled.find((item) => item.alarmId === alarm.id)
    return {
      alarm,
      reconciled: { matched: Boolean(match?.matched), notificationCount: match?.notificationCount ?? 0 },
    }
  })
  eventRows.value = listEvents()
  stats.value = alertStats()
}

function reloadAnomalyRows() {
  anomalyRows.value = listRows('anomaly')
}

function reloadAll() {
  reloadRules()
  reloadDetails()
  reloadAnomalyRows()
}

onMounted(reloadAll)
</script>

<style scoped>
.panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 14px 0;
}
.panel-title {
  font-size: 14px;
  margin: 0 0 10px;
}
.hint-text {
  color: var(--muted);
  font-size: 12px;
  margin: 8px 0 0;
}
.result-text {
  font-size: 12px;
  color: #1f6feb;
  margin: 8px 0 0;
}
.ok-text {
  color: #067647;
}
.detail-card {
  margin-top: 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: #f8fafc;
}
.detail-card h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 4px 10px;
  margin: 0 0 8px;
  font-size: 12px;
}
.detail-grid dt { color: var(--muted); }
.detail-grid dd { margin: 0; }
.link:disabled {
  color: var(--muted);
  cursor: not-allowed;
}
</style>
