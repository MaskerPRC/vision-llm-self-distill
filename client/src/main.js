import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

const routes = [
  { path: '/', name: 'home', component: () => import('./views/Home.vue') },
  { path: '/task/:id', name: 'task', component: () => import('./views/TaskDetail.vue') },
  { path: '/predict', name: 'predict', component: () => import('./views/Predict.vue') },
  { path: '/predict/:taskId', name: 'predict-task', component: () => import('./views/Predict.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
