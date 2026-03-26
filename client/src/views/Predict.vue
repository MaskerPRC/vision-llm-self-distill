<template>
  <div class="container">
    <div class="back-row">
      <router-link to="/" class="btn-ghost back-btn">← 返回列表</router-link>
    </div>

    <div class="predict-header card">
      <h1>模型预测审核</h1>
      <p class="desc">上传图片测试训练好的模型效果，支持粘贴截图、URL、本地文件</p>
      <div class="task-select" v-if="!selectedTask">
        <label>选择已完成的任务</label>
        <div class="task-select-grid">
          <div
            v-for="t in completedTasks"
            :key="t.id"
            class="task-option card"
            @click="selectTask(t)"
          >
            <h3>{{ t.name }}</h3>
            <div class="task-option-classes">
              <span class="class-tag" v-for="c in t.classes" :key="c">{{ c }}</span>
            </div>
            <div class="task-option-meta" v-if="t.metrics">
              mAP50: {{ (t.metrics.mAP50 * 100).toFixed(1) }}%
            </div>
          </div>
        </div>
        <div v-if="completedTasks.length === 0" class="empty-hint">
          暂无已完成训练的任务
        </div>
      </div>

      <div v-else class="selected-task-bar">
        <div class="selected-info">
          <strong>{{ selectedTask.name }}</strong>
          <span class="class-tag" v-for="c in selectedTask.classes" :key="c">{{ c }}</span>
        </div>
        <button class="btn-ghost" @click="selectedTask = null">切换任务</button>
      </div>
    </div>

    <!-- Drop / Paste Zone -->
    <div
      v-if="selectedTask"
      class="drop-zone card"
      :class="{ dragging: isDragging }"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="handleDrop"
      @paste="handlePaste"
      @click="triggerFileInput"
      @mouseenter="pasteListening = true"
      tabindex="0"
      @keydown.prevent
    >
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="handleFileSelect" />
      <div class="drop-content">
        <div class="drop-icon">📷</div>
        <h3>拖拽图片到这里 / 点击选择文件</h3>
        <p>或直接 <strong>Ctrl+V</strong> 粘贴截图 / 图片URL</p>
        <div class="drop-url-row">
          <input
            v-model="urlInput"
            placeholder="粘贴图片URL，按回车添加"
            @keydown.enter.prevent="addFromUrl"
            @click.stop
            class="url-input"
          />
          <button class="btn-primary" @click.stop="addFromUrl" :disabled="!urlInput.trim()">添加</button>
        </div>
      </div>
    </div>

    <!-- Results -->
    <div v-if="results.length > 0" class="results-section">
      <div class="results-header">
        <h2>预测结果 <span class="count">({{ results.length }})</span></h2>
        <button class="btn-ghost" @click="results = []">清空</button>
      </div>
      <div class="results-grid">
        <div
          v-for="(item, idx) in results"
          :key="idx"
          class="result-card card"
          @click="openPreview(item)"
        >
          <div class="result-image-wrapper">
            <img :src="item.imageUrl" />
            <svg v-if="item.detections" class="bbox-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
              <template v-for="(d, di) in item.detections" :key="di">
                <rect
                  :x="d.cx - d.w / 2"
                  :y="d.cy - d.h / 2"
                  :width="d.w"
                  :height="d.h"
                  :stroke="classColors[d.class % classColors.length]"
                  stroke-width="0.005"
                  fill="none"
                />
              </template>
            </svg>
            <div v-if="item.loading" class="result-loading">
              <div class="spinner-sm"></div>
              分析中...
            </div>
            <div v-if="item.error" class="result-error">{{ item.error }}</div>
          </div>
          <div class="result-info">
            <div v-if="item.detections" class="detection-tags">
              <span
                v-for="(d, di) in item.detections"
                :key="di"
                class="det-tag"
                :style="{ borderColor: classColors[d.class % classColors.length], color: classColors[d.class % classColors.length] }"
              >
                {{ d.class_name }} {{ (d.confidence * 100).toFixed(0) }}%
              </span>
            </div>
            <div v-if="item.detections && item.detections.length === 0" class="no-det">未检测到目标</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview Modal -->
    <div class="modal-overlay" v-if="previewItem" @click.self="previewItem = null">
      <div class="modal-content preview-modal">
        <button class="modal-close" @click="previewItem = null">✕</button>
        <div class="preview-image-wrapper">
          <img :src="previewItem.imageUrl" />
          <svg v-if="previewItem.detections" class="bbox-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
            <template v-for="(d, di) in previewItem.detections" :key="di">
              <rect
                :x="d.cx - d.w / 2"
                :y="d.cy - d.h / 2"
                :width="d.w"
                :height="d.h"
                :stroke="classColors[d.class % classColors.length]"
                stroke-width="0.003"
                fill="none"
              />
              <text
                :x="d.cx - d.w / 2 + 0.004"
                :y="d.cy - d.h / 2 + 0.025"
                :fill="classColors[d.class % classColors.length]"
                font-size="0.018"
                font-weight="bold"
              >{{ d.class_name }} {{ (d.confidence * 100).toFixed(0) }}%</text>
            </template>
          </svg>
        </div>
        <div class="preview-detail-info">
          <h3>检测结果</h3>
          <div v-if="previewItem.detections && previewItem.detections.length > 0" class="det-list">
            <div v-for="(d, di) in previewItem.detections" :key="di" class="det-row">
              <span class="det-color" :style="{ background: classColors[d.class % classColors.length] }"></span>
              <span class="det-name">{{ d.class_name }}</span>
              <span class="det-conf">{{ (d.confidence * 100).toFixed(1) }}%</span>
              <span class="det-pos">{{ d.cx.toFixed(3) }}, {{ d.cy.toFixed(3) }}</span>
            </div>
          </div>
          <div v-else class="no-det">未检测到目标</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import * as api from '../api'

const classColors = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316']

const completedTasks = ref([])
const selectedTask = ref(null)
const results = ref([])
const isDragging = ref(false)
const urlInput = ref('')
const fileInput = ref(null)
const previewItem = ref(null)
const pasteListening = ref(false)

onMounted(async () => {
  const tasks = await api.getTasks()
  completedTasks.value = tasks.filter(t => t.status === 'completed' && t.model_path)
  if (completedTasks.value.length === 1) {
    selectedTask.value = completedTasks.value[0]
  }
  document.addEventListener('paste', globalPaste)
})

onUnmounted(() => {
  document.removeEventListener('paste', globalPaste)
})

function selectTask(t) {
  selectedTask.value = t
  results.value = []
}

function triggerFileInput() {
  fileInput.value?.click()
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files || [])
  files.forEach(f => processFile(f))
  e.target.value = ''
}

function handleDrop(e) {
  isDragging.value = false
  const files = Array.from(e.dataTransfer.files || [])
  const textData = e.dataTransfer.getData('text')

  if (files.length > 0) {
    files.forEach(f => {
      if (f.type.startsWith('image/')) processFile(f)
    })
  } else if (textData && (textData.startsWith('http://') || textData.startsWith('https://'))) {
    processUrl(textData.trim())
  }
}

function globalPaste(e) {
  if (!selectedTask.value) return
  const active = document.activeElement
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    if (!active.classList.contains('url-input')) return
    const text = e.clipboardData?.getData('text')
    if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
      e.preventDefault()
      processUrl(text.trim())
      return
    }
  }

  const items = Array.from(e.clipboardData?.items || [])
  const imageItem = items.find(i => i.type.startsWith('image/'))
  if (imageItem) {
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (file) processFile(file)
    return
  }

  const text = e.clipboardData?.getData('text')
  if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
    if (active?.classList.contains('url-input')) return
    e.preventDefault()
    processUrl(text.trim())
  }
}

function handlePaste(e) {
  // handled by globalPaste
}

function addFromUrl() {
  const url = urlInput.value.trim()
  if (!url) return
  processUrl(url)
  urlInput.value = ''
}

function processFile(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    const base64 = e.target.result
    const idx = results.value.length
    results.value.push({ imageUrl: base64, loading: true, detections: null, error: null })
    predictBase64(base64, idx)
  }
  reader.readAsDataURL(file)
}

function processUrl(url) {
  const idx = results.value.length
  results.value.push({ imageUrl: url, loading: true, detections: null, error: null })
  predictUrl(url, idx)
}

async function predictBase64(base64, idx) {
  try {
    const res = await api.predictBase64(selectedTask.value.id, base64)
    results.value[idx].detections = res.detections
    if (res.image_url) results.value[idx].serverUrl = res.image_url
  } catch (err) {
    results.value[idx].error = err.message
  } finally {
    results.value[idx].loading = false
  }
}

async function predictUrl(url, idx) {
  try {
    const res = await api.predictUrl(selectedTask.value.id, url)
    results.value[idx].detections = res.detections
    if (res.image_url) {
      results.value[idx].imageUrl = res.image_url
      results.value[idx].serverUrl = res.image_url
    }
  } catch (err) {
    results.value[idx].error = err.message
  } finally {
    results.value[idx].loading = false
  }
}

function openPreview(item) {
  if (!item.loading) previewItem.value = item
}
</script>

<style scoped>
.predict-header {
  margin-bottom: 24px;
}
.predict-header h1 {
  font-size: 24px;
  font-weight: 800;
}
.desc {
  color: var(--text-secondary);
  font-size: 14px;
  margin-top: 4px;
  margin-bottom: 16px;
}

.task-select label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.task-select-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.task-option {
  cursor: pointer;
  transition: all 0.2s;
  padding: 16px;
}
.task-option:hover {
  background: var(--bg-card-hover);
  transform: translateY(-2px);
}
.task-option h3 {
  font-size: 15px;
  margin-bottom: 8px;
}
.task-option-classes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.class-tag {
  background: rgba(99, 102, 241, 0.12);
  color: var(--primary-hover);
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}
.task-option-meta {
  font-size: 12px;
  color: var(--success);
  font-weight: 600;
}
.empty-hint {
  color: var(--text-secondary);
  text-align: center;
  padding: 24px;
}

.selected-task-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.selected-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.selected-info strong {
  font-size: 15px;
}

/* Drop Zone */
.drop-zone {
  border: 2px dashed var(--border);
  text-align: center;
  padding: 48px 24px;
  margin-bottom: 24px;
  cursor: pointer;
  transition: all 0.3s;
  outline: none;
}
.drop-zone:hover, .drop-zone:focus {
  border-color: var(--primary);
  background: rgba(99, 102, 241, 0.04);
}
.drop-zone.dragging {
  border-color: var(--primary);
  background: rgba(99, 102, 241, 0.08);
  transform: scale(1.01);
}
.drop-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.drop-icon {
  font-size: 48px;
}
.drop-content h3 {
  font-size: 16px;
}
.drop-content p {
  color: var(--text-secondary);
  font-size: 13px;
}
.drop-url-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  width: 100%;
  max-width: 500px;
}
.url-input {
  flex: 1;
  text-align: left;
}

/* Results */
.results-section {
  margin-bottom: 24px;
}
.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.results-header h2 {
  font-size: 18px;
}
.count {
  font-weight: 400;
  color: var(--text-secondary);
  font-size: 14px;
}
.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.result-card {
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
}
.result-card:hover {
  transform: scale(1.02);
}
.result-image-wrapper {
  position: relative;
  aspect-ratio: 1;
  background: #000;
}
.result-image-wrapper img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.bbox-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.result-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.5);
  color: white;
  font-size: 14px;
  gap: 8px;
}
.spinner-sm {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.result-error {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(239,68,68,0.9);
  color: white;
  font-size: 12px;
  padding: 8px;
  text-align: center;
}
.result-info {
  padding: 10px 12px;
}
.detection-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.det-tag {
  padding: 2px 8px;
  border: 1.5px solid;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.no-det {
  color: var(--text-secondary);
  font-size: 12px;
  font-style: italic;
}

/* Preview Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.preview-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  max-width: 900px;
  max-height: 90vh;
  width: 100%;
  overflow: auto;
  position: relative;
}
.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 16px;
}
.preview-image-wrapper {
  position: relative;
  width: 100%;
  background: #000;
}
.preview-image-wrapper img {
  width: 100%;
  display: block;
}
.preview-detail-info {
  padding: 16px 20px;
}
.preview-detail-info h3 {
  font-size: 15px;
  margin-bottom: 12px;
}
.det-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.det-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--bg);
  border-radius: 6px;
  font-size: 13px;
}
.det-color {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.det-name {
  font-weight: 600;
  flex: 1;
}
.det-conf {
  color: var(--success);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.det-pos {
  color: var(--text-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.back-row {
  margin-bottom: 20px;
}
.back-btn {
  font-size: 14px;
}
</style>
