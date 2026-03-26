<template>
  <div class="container">
    <section class="hero">
      <h1>RT-DETR 自动化训练流水线</h1>
      <p>提出视觉识别需求 → AI生成图片 → 自动标注 → RT-DETR训练 → 输出模型</p>
    </section>

    <!-- 创建任务 -->
    <div class="card create-section" v-if="showCreate">
      <h2>创建新任务</h2>
      <form @submit.prevent="handleCreate">
        <div class="form-group">
          <label>任务名称</label>
          <input v-model="form.name" placeholder="例：交通标志检测" required />
        </div>
        <div class="form-group">
          <label>需求描述</label>
          <textarea v-model="form.description" placeholder="详细描述你需要识别的视觉元素，场景和用途..." required></textarea>
        </div>
        <div class="form-group">
          <label>检测类别 <span class="hint">（用逗号分隔）</span></label>
          <input v-model="form.classesStr" placeholder="例：stop_sign, traffic_light, speed_limit" required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>生成图片数</label>
            <input v-model.number="form.image_count" type="number" min="5" max="500" />
          </div>
          <div class="form-group">
            <label>训练轮数</label>
            <input v-model.number="form.epochs" type="number" min="5" max="300" />
          </div>
          <div class="form-group">
            <label>测试集比例</label>
            <input v-model.number="form.test_split" type="number" min="0.05" max="0.5" step="0.05" />
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary" :disabled="creating">
            {{ creating ? '创建中...' : '创建任务' }}
          </button>
          <button type="button" class="btn-ghost" @click="showCreate = false">取消</button>
        </div>
      </form>
    </div>

    <!-- 任务列表 -->
    <div class="task-list-header">
      <h2>任务列表</h2>
      <button class="btn-primary" @click="showCreate = true" v-if="!showCreate">+ 新建任务</button>
    </div>

    <div v-if="taskStore.loading && taskStore.tasks.length === 0" class="loading-state">
      <div class="spinner"></div>
      <span>加载中...</span>
    </div>

    <div v-else-if="taskStore.tasks.length === 0" class="empty-state">
      <div class="empty-icon">📦</div>
      <h3>暂无任务</h3>
      <p>点击「新建任务」开始你的第一个 RT-DETR 训练流水线</p>
    </div>

    <div class="task-grid" v-else>
      <div
        v-for="task in taskStore.tasks"
        :key="task.id"
        class="task-card card"
        @click="$router.push(`/task/${task.id}`)"
      >
        <div class="task-card-header">
          <h3>{{ task.name }}</h3>
          <span class="badge" :class="statusBadgeClass(task.status)">
            {{ statusText(task.status) }}
          </span>
        </div>
        <div v-if="task.forked_from" class="task-fork-tag">
          <span>&#9095;</span> Forked
        </div>
        <p class="task-desc">{{ task.description }}</p>
        <div class="task-classes">
          <span class="class-tag" v-for="c in task.classes" :key="c">{{ c }}</span>
        </div>
        <div class="progress-bar" v-if="isRunning(task.status)">
          <div class="progress-bar-fill" :style="{ width: task.progress + '%' }"></div>
        </div>
        <div class="task-meta">
          <span>图片: {{ task.image_count }}</span>
          <span>轮次: {{ task.epochs }}</span>
          <span>{{ formatTime(task.created_at) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTaskStore } from '../stores/task'

const router = useRouter()
const taskStore = useTaskStore()
const showCreate = ref(false)
const creating = ref(false)

const form = ref({
  name: '',
  description: '',
  classesStr: '',
  image_count: 50,
  epochs: 50,
  test_split: 0.2,
})

onMounted(() => {
  taskStore.fetchTasks()
})

async function handleCreate() {
  creating.value = true
  try {
    const classes = form.value.classesStr.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    if (classes.length === 0) return alert('请至少填写一个类别')

    const task = await taskStore.createTask({
      name: form.value.name,
      description: form.value.description,
      classes,
      image_count: form.value.image_count,
      epochs: form.value.epochs,
      test_split: form.value.test_split,
    })

    showCreate.value = false
    form.value = { name: '', description: '', classesStr: '', image_count: 50, epochs: 50, test_split: 0.2 }
    router.push(`/task/${task.id}`)
  } catch (err) {
    alert('创建失败: ' + err.message)
  } finally {
    creating.value = false
  }
}

function statusBadgeClass(s) {
  if (s === 'completed') return 'badge-success'
  if (s === 'failed') return 'badge-danger'
  if (s === 'paused') return 'badge-warning'
  if (s === 'pending') return 'badge-pending'
  return 'badge-running'
}

function statusText(s) {
  const map = {
    pending: '待启动',
    generating_prompts: '生成提示词',
    generating_images: '生成图片',
    labeling: '自动标注',
    training: '训练中',
    testing: '测试中',
    completed: '已完成',
    paused: '已暂停',
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
</script>

<style scoped>
.hero {
  text-align: center;
  padding: 40px 0 32px;
}
.hero h1 {
  font-size: 32px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--primary), var(--primary-hover), #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero p {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 15px;
}

.create-section {
  margin-bottom: 32px;
}
.create-section h2 {
  margin-bottom: 20px;
  font-size: 18px;
}
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.hint {
  font-weight: 400;
  opacity: 0.7;
}
.form-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.task-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.task-list-header h2 {
  font-size: 20px;
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}
.task-card {
  cursor: pointer;
  transition: all 0.2s;
}
.task-card:hover {
  background: var(--bg-card-hover);
  transform: translateY(-2px);
}
.task-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}
.task-card-header h3 {
  font-size: 16px;
  font-weight: 700;
}
.task-fork-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin-bottom: 6px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  font-size: 11px;
  color: var(--primary);
  font-weight: 600;
}
.task-desc {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.task-classes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.class-tag {
  background: rgba(99, 102, 241, 0.12);
  color: var(--primary-hover);
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}
.task-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 8px;
}
.progress-bar {
  margin-bottom: 8px;
}

.loading-state, .empty-state {
  text-align: center;
  padding: 60px 0;
  color: var(--text-secondary);
}
.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.empty-state h3 {
  margin-bottom: 6px;
  color: var(--text);
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
</style>
