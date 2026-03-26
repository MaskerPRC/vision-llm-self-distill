require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDB } = require('./db');
const { setupWebSocket } = require('./ws');
const taskRoutes = require('./routes/tasks');
const configRoutes = require('./routes/config');

const app = express();
const PORT = process.env.PORT || 3015;

app.use(cors());
app.use(express.json());

const dataDir = path.join(__dirname, '..', 'data');
const dirs = ['images', 'labels', 'datasets', 'models', 'temp'].map(d => path.join(dataDir, d));
dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

app.use('/data', express.static(dataDir));

initDB();

app.use('/api/tasks', taskRoutes);
app.use('/api/config', configRoutes);

app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'YOLO Pipeline API Server Running. Frontend not built yet.' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[YOLO Pipeline] 服务器启动: http://localhost:${PORT}`);
});

setupWebSocket(server);
