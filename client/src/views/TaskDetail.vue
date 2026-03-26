<template>
  <div class="container">
    <div class="back-row">
      <router-link to="/" class="btn-ghost back-btn">← 返回列表</router-link>
    </div>

    <div v-if="taskStore.loading && !task" class="loading-state">
      <div class="spinner"></div>
      <span>加载中...</span>
    </div>

    <template v-else-if="task">
      <!-- Header -->
      <div class="detail-header card">
        <div class="header-top">
          <div>
            <h1>{{ task.name }}</h1>
            <p class="desc">{{ task.description }}</p>
          </div>
          <span class="badge" :class="statusBadgeClass(task.status)">
            {{ statusText(task.status) }}
          </span>
        </div>
        <div class="header-classes">
          <span class="class-tag" v-for="c in task.classes" :key="c">{{ c }}</span>
        </div>
        <div class="progress-section" v-if="isRunning(task.status)">
          <div class="progress-info">
            <span>进度: {{ task.progress }}%</span>
            <span class="animate-pulse">处理中...</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" :style="{ width: task.progress + '%' }"></div>
          </div>
        </div>
        <div class="header-actions">
          <button
            v-if="task.status === 'pending' || task.status === 'failed'"
            class="btn-primary"
            @click="handleStart"
          >
            ▶ 启动流水线
          </button>
          <button
            v-if="isRunning(task.status)"
            class="btn-danger"
            @click="handleAbort"
          >
            ■ 终止
          </button>
          <a
            v-if="task.model_path"
            :href="modelDownloadUrl"
            class="btn-primary"
            download
          >
            ↓ 下载模型
          </a>
          <button
            v-if="task.status === 'pending' || task.status === 'completed' || task.status === 'failed'"
            class="btn-ghost danger-text"
            @click="handleDelete"
          >
            删除任务
          </button>
        </div>
      </div>

      <!-- Pipeline Steps -->
      <div class="steps-row">
        <div v-for="(step, i) in pipelineSteps" :key="i"
          class="step-item"
          :class="{ active: step.active, done: step.done }"
        >
          <div class="step-num">{{ step.done ? '✓' : i + 1 }}</div>
          <div class="step-label">{{ step.label }}</div>
        </div>
      </div>

      <!-- Metrics -->
      <div class="card metrics-card" v-if="task.metrics">
        <h2>训练指标</h2>
        <div class="metrics-grid">
          <div class="metric-item">
            <div class="metric-value">{{ formatNum(task.metrics.precision) }}</div>
            <div class="metric-label">Precision</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">{{ formatNum(task.metrics.recall) }}</div>
            <div class="metric-label">Recall</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">{{ formatNum(task.metrics.mAP50) }}</div>
            <div class="metric-label">mAP@50</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">{{ formatNum(task.metrics.mAP50_95) }}</div>
            <div class="metric-label">mAP@50-95</div>
          </div>
        </div>
      </div>

      <!-- Config -->
      <div class="config-row">
        <div class="card config-card">
          <h3>任务配置</h3>
          <div class="config-items">
            <div><span class="config-key">图片数量</span><span>{{ task.image_count }}</span></div>
            <div><span class="config-key">训练轮次</span><span>{{ task.epochs }}</span></div>
            <div><span class="config-key">测试集比例</span><span>{{ task.test_split }}</span></div>
            <div><span class="config-key">创建时间</span><span>{{ formatTime(task.created_at) }}</span></div>
          </div>
        </div>
        <div class="card config-card" v-if="task.error">
          <h3 class="danger-text">错误信息</h3>
          <pre class="error-msg">{{ task.error }}</pre>
        </div>
      </div>

      <!-- Sample Images -->
      <div class="card" v-if="task.images && task.images.length > 0">
        <h2>生成的图片 <span class="count">({{ task.images.length }})</span></h2>
        <div class="image-grid">
          <div
            v-for="img in task.images.slice(0, displayCount)"
            :key="img.id"
            class="image-item"
          >
            <div class="image-wrapper" v-if="img.image_path">
              <img :src="getImageUrl(img.image_path)" :alt="img.prompt" loading="lazy" />
              <span class="image-badge" :class="img.split === 'val' ? 'badge-warning' : 'badge-info'">
                {{ img.split }}
              </span>
            </div>
            <div class="image-info">
              <span class="image-status badge" :class="imgStatusClass(img.status)">{{ img.status }}</span>
            </div>
          </div>
        </div>
        <button
          v-if="task.images.length > displayCount"
          class="btn-ghost load-more"
          @click="displayCount += 20"
        >
          加载更多 ({{ task.images.length - displayCount }} 张)
        </button>
      </div>

      <!-- Logs -->
      <div class="card log-section">
        <h2>运行日志</h2>
        <div class="log-container" ref="logContainer">
          <div v-if="task.log" class="log-lines">
            <div v-for="(line, i) in logLines" :key="'h'+i" class="log-line">{{ line }}</div>
          </div>
          <div class="log-lines realtime" v-if="taskStore.realtimeLogs.length">
            <div v-for="(line, i) in taskStore.realtimeLogs" :key="'r'+i" class="log-line">{{ line }}</div>
          </div>
          <div v-if="!task.log && !taskStore.realtimeLogs.length" class="log-empty">
            暂无日志，启动流水线后将在此显示运行记录
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTaskStore } from '../stores/task'

const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const logContainer = ref(null)
const displayCount = ref(20)

const task = computed(() => taskStore.currentTask)

const logLines = computed(() => {
  if (!task.value?.log) return []
  return task.value.log.split('\n').filter(Boolean)
})

const pipelineSteps = computed(() => {
  const s = task.value?.status || 'pending'
  const order = ['generating_prompts', 'generating_images', 'labeling', 'training', 'completed']
  const idx = order.indexOf(s)
  return [
    { label: '生成提示词', active: s === 'generating_prompts', done: idx > 0 },
    { label: '生成图片', active: s === 'generating_images', done: idx > 1 },
    { label: '自动标注', active: s === 'labeling', done: idx > 2 },
    { label: 'YOLO训练', active: s === 'training', done: idx > 3 },
    { label: '完成', active: s === 'completed', done: s === 'completed' },
  ]
})

const modelDownloadUrl = computed(() => {
  if (!task.value?.model_path) return ''
  const rel = task.value.model_path.replace(/\\/g, '/').split('data/')[1]
  return rel ? `/data/${rel}` : ''
})

onMounted(() => {
  taskStore.fetchTask(route.params.id)
})

watch(() => taskStore.realtimeLogs.length, () => {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
})

async function handleStart() {
  try {
    await taskStore.startTask(task.value.id)
  } catch (err) {
    alert('启动失败: ' + err.message)
  }
}

async function handleAbort() {
  if (!confirm('确认终止当前流水线？')) return
  await taskStore.abortTask(task.value.id)
  taskStore.fetchTask(route.params.id)
}

async function handleDelete() {
  if (!confirm('确认删除此任务？所有数据将被清除。')) return
  await taskStore.deleteTask(task.value.id)
  router.push('/')
}

function getImageUrl(imgPath) {
  const rel = imgPath.replace(/\\/g, '/').split('data/')[1]
  return rel ? `/data/${rel}` : ''
}

function statusBadgeClass(s) {
  if (s === 'completed') return 'badge-success'
  if (s === 'failed') return 'badge-danger'
  if (s === 'pending') return 'badge-pending'
  return 'badge-running'
}

function imgStatusClass(s) {
  if (s === 'labeled') return 'badge-success'
  if (s === 'generated') return 'badge-info'
  if (s === 'failed') return 'badge-danger'
  return 'badge-pending'
}

function statusText(s) {
  const map = {
    pending: '待启动',
    generating_prompts: '生成提示词中',
    generating_images: '生成图片中',
    labeling: '自动标注中',
    training: '训练中',
    testing: '测试中',
    completed: '已完成',
    failed: '失败',
  }
  return map[s] || s
}

function isRunning(s) {
  return !['pending', 'completed', 'failed'].includes(s)
}

function formatTime(t) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN')
}

function formatNum(v) {
  return v != null ? v.toFixed(4) : '-'
}
</script>

<style scoped>
.back-row {
  margin-bottom: 20px;
}
.back-btn {
  font-size: 14px;
}

.detail-header {
  margin-bottom: 24px;
}
.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}
.header-top h1 {
  font-size: 24px;
  font-weight: 800;
}
.desc {
  color: var(--text-secondary);
  font-size: 14px;
  margin-top: 4px;
}
.header-classes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}
.class-tag {
  background: rgba(99, 102, 241, 0.12);
  color: var(--primary-hover);
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
}
.progress-section {
  margin-bottom: 16px;
}
.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 6px;
  color: var(--text-secondary);
}
.header-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.header-actions a {
  display: inline-flex;
  align-items: center;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  color: white;
}
.danger-text {
  color: var(--danger) !important;
}

/* Steps */
.steps-row {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
}
.step-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-secondary);
  transition: all 0.3s;
}
.step-item.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: var(--primary);
  color: var(--primary-hover);
}
.step-item.done {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.3);
  color: var(--success);
}
.step-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.step-item.active .step-num {
  background: var(--primary);
  color: white;
}
.step-item.done .step-num {
  background: var(--success);
  color: white;
}

/* Metrics */
.metrics-card {
  margin-bottom: 24px;
}
.metrics-card h2 {
  margin-bottom: 16px;
  font-size: 16px;
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.metric-item {
  text-align: center;
  padding: 16px;
  background: var(--bg);
  border-radius: var(--radius-sm);
}
.metric-value {
  font-size: 28px;
  font-weight: 800;
  color: var(--primary-hover);
  font-variant-numeric: tabular-nums;
}
.metric-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  font-weight: 600;
  text-transform: uppercase;
}

/* Config */
.config-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}
.config-card h3 {
  font-size: 15px;
  margin-bottom: 12px;
}
.config-items > div {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.config-items > div:last-child {
  border-bottom: none;
}
.config-key {
  color: var(--text-secondary);
}
.error-msg {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-sm);
  padding: 12px;
  font-size: 13px;
  color: var(--danger);
  white-space: pre-wrap;
  word-break: break-all;
}

/* Images */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.image-item {
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg);
}
.image-wrapper {
  position: relative;
  aspect-ratio: 1;
}
.image-wrapper img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.image-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
}
.image-info {
  padding: 6px 8px;
}
.image-status {
  font-size: 11px;
}
.load-more {
  width: 100%;
  margin-top: 16px;
}
.count {
  font-weight: 400;
  color: var(--text-secondary);
  font-size: 14px;
}

/* Logs */
.log-section {
  margin-top: 24px;
}
.log-section h2 {
  margin-bottom: 12px;
  font-size: 16px;
}
.log-container {
  background: #0a0f1a;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 16px;
  max-height: 500px;
  overflow-y: auto;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12.5px;
  line-height: 1.8;
}
.log-line {
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}
.log-empty {
  color: var(--text-secondary);
  text-align: center;
  padding: 20px;
  font-style: italic;
}

.loading-state {
  text-align: center;
  padding: 60px;
  color: var(--text-secondary);
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@media (max-width: 768px) {
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .config-row {
    grid-template-columns: 1fr;
  }
  .steps-row {
    flex-wrap: wrap;
  }
}
</style>
