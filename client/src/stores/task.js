import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api'

export const useTaskStore = defineStore('task', () => {
  const tasks = ref([])
  const currentTask = ref(null)
  const loading = ref(false)
  const realtimeLogs = ref([])

  async function fetchTasks() {
    loading.value = true
    try {
      tasks.value = await api.getTasks()
    } finally {
      loading.value = false
    }
  }

  async function fetchTask(id) {
    loading.value = true
    realtimeLogs.value = []
    try {
      currentTask.value = await api.getTask(id)
    } finally {
      loading.value = false
    }
  }

  async function createTask(data) {
    const task = await api.createTask(data)
    tasks.value.unshift(task)
    return task
  }

  async function startTask(id) {
    await api.startTask(id)
    if (currentTask.value?.id === id) {
      currentTask.value.status = 'generating_prompts'
      currentTask.value.progress = 0
    }
  }

  async function pauseTask(id) {
    await api.pauseTask(id)
    if (currentTask.value?.id === id) {
      currentTask.value.status = 'paused'
    }
  }

  async function abortTask(id) {
    await api.abortTask(id)
  }

  async function deleteTask(id) {
    await api.deleteTask(id)
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  async function forkTask(id, fromStep) {
    const task = await api.forkTask(id, fromStep)
    tasks.value.unshift(task)
    return task
  }

  function handleWSMessage(data) {
    if (data.type === 'task_update' && data.taskId) {
      const idx = tasks.value.findIndex(t => t.id === data.taskId)
      if (idx !== -1) {
        Object.assign(tasks.value[idx], data.updates)
      }
      if (currentTask.value?.id === data.taskId) {
        Object.assign(currentTask.value, data.updates)
      }
    }
    if (data.type === 'task_log' && data.taskId) {
      if (currentTask.value?.id === data.taskId) {
        realtimeLogs.value.push(data.message)
      }
    }
  }

  return {
    tasks, currentTask, loading, realtimeLogs,
    fetchTasks, fetchTask, createTask, startTask, pauseTask, abortTask, deleteTask, forkTask,
    handleWSMessage,
  }
})
