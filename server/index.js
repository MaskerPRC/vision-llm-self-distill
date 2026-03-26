require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDB } = require('./db');
const { setupWebSocket } = require('./ws');
const taskRoutes = require('./routes/tasks');
const configRoutes = require('./routes/config');
const predictRoutes = require('./routes/predict');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

const dataDir = path.join(__dirname, '..', 'data');
const dirs = ['images', 'labels', 'datasets', 'models', 'temp'].map(d => path.join(dataDir, d));
dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

app.use('/data', express.static(dataDir));

initDB();

const { getDB } = require('./db');
(function recoverInterruptedTasks() {
  const db = getDB();
  const running = ['generating_prompts', 'generating_images', 'labeling', 'training', 'testing'];
  const placeholders = running.map(() => '?').join(',');
  const interrupted = db.prepare(
    `SELECT id, status FROM tasks WHERE status IN (${placeholders})`
  ).all(...running);

  if (interrupted.length > 0) {
    const stmt = db.prepare("UPDATE tasks SET status = 'paused', error = '服务器重启，任务已暂停，可点击继续' WHERE id = ?");
    for (const t of interrupted) {
      stmt.run(t.id);
      console.log(`[恢复] 任务 ${t.id} 状态 ${t.status} → paused`);
    }
  }
})();

app.use('/api/tasks', taskRoutes);
app.use('/api/config', configRoutes);
app.use('/api/predict', predictRoutes);

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'RT-DETR Pipeline API Server Running. Frontend not built yet.' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[RT-DETR Pipeline] 服务器启动: http://localhost:${PORT}`);
});

setupWebSocket(server);
