const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

export const getTasks = () => request('/tasks')
export const getTask = (id) => request(`/tasks/${id}`)
export const createTask = (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) })
export const startTask = (id) => request(`/tasks/${id}/start`, { method: 'POST' })
export const abortTask = (id) => request(`/tasks/${id}/abort`, { method: 'POST' })
export const deleteTask = (id) => request(`/tasks/${id}`, { method: 'DELETE' })
export const getConfig = () => request('/config')
