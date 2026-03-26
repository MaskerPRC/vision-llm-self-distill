<template>
  <div class="app-layout">
    <header class="app-header">
      <div class="container header-inner">
        <router-link to="/" class="logo">
          <div class="logo-icon">YP</div>
          <div class="logo-text">
            <span class="logo-title">YOLO Pipeline</span>
            <span class="logo-subtitle">自动化训练流水线</span>
          </div>
        </router-link>
        <nav class="header-nav">
          <router-link to="/" class="nav-link">任务</router-link>
          <router-link to="/predict" class="nav-link">预测审核</router-link>
          <span class="nav-status">
            <span class="status-dot" :class="wsConnected ? 'connected' : ''"></span>
            {{ wsConnected ? '已连接' : '未连接' }}
          </span>
        </nav>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useTaskStore } from './stores/task'

const wsConnected = ref(false)
const taskStore = useTaskStore()
let ws = null

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws`)

  ws.onopen = () => { wsConnected.value = true }
  ws.onclose = () => {
    wsConnected.value = false
    setTimeout(connectWS, 3000)
  }
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      taskStore.handleWSMessage(data)
    } catch {}
  }
}

onMounted(connectWS)
onUnmounted(() => { if (ws) ws.close() })
</script>

<style scoped>
.app-header {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(12px);
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text);
}
.logo-icon {
  width: 38px;
  height: 38px;
  background: var(--primary);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 14px;
}
.logo-text {
  display: flex;
  flex-direction: column;
}
.logo-title {
  font-weight: 700;
  font-size: 16px;
  line-height: 1.2;
}
.logo-subtitle {
  font-size: 11px;
  color: var(--text-secondary);
}
.header-nav {
  display: flex;
  align-items: center;
  gap: 20px;
}
.nav-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 4px 0;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}
.nav-link:hover {
  color: var(--text);
}
.nav-link.router-link-active {
  color: var(--primary-hover);
  border-bottom-color: var(--primary);
}
.nav-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
}
.status-dot.connected {
  background: var(--success);
}
.app-main {
  flex: 1;
  padding: 32px 0;
}
</style>
