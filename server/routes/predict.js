const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { predictImage } = require('../services/predict');

const uploadDir = path.join(__dirname, '..', '..', 'data', 'temp', 'predict');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname || '.png')),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get('/:taskId', (req, res) => {
  const db = getDB();
  const rows = db.prepare(
    'SELECT * FROM predictions WHERE task_id = ? ORDER BY created_at DESC'
  ).all(req.params.taskId);
  rows.forEach(r => { r.detections = JSON.parse(r.detections || '[]'); });
  res.json(rows);
});

router.delete('/:taskId', (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM predictions WHERE task_id = ?').run(req.params.taskId);
  res.json({ message: '已清空' });
});

router.delete('/item/:id', (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM predictions WHERE id = ?').run(req.params.id);
  res.json({ message: '已删除' });
});

router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!req.file) return res.status(400).json({ error: '请上传图片' });
    const result = await runPrediction(taskId, req.file.path, req.file.filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/url', express.json(), async (req, res) => {
  try {
    const { taskId, url } = req.body;
    if (!url) return res.status(400).json({ error: '请提供图片URL' });

    const filename = uuidv4() + '.png';
    const filePath = path.join(uploadDir, filename);
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    fs.writeFileSync(filePath, Buffer.from(resp.data));

    const result = await runPrediction(taskId, filePath, filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/base64', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    const { taskId, base64 } = req.body;
    if (!base64) return res.status(400).json({ error: '请提供base64图片' });

    const matches = base64.match(/^data:image\/\w+;base64,(.+)$/);
    const b64Data = matches ? matches[1] : base64;

    const filename = uuidv4() + '.png';
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, Buffer.from(b64Data, 'base64'));

    const result = await runPrediction(taskId, filePath, filename);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runPrediction(taskId, imagePath, filename) {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error('任务不存在');
  if (!task.model_path || !fs.existsSync(task.model_path)) {
    throw new Error('模型文件不存在，请先完成训练');
  }

  const classes = JSON.parse(task.classes);
  const detections = await predictImage(task.model_path, imagePath, classes);
  const imageUrl = `/data/temp/predict/${filename}`;

  const enriched = detections.map(d => ({
    ...d,
    class_name: classes[d.class] || `class_${d.class}`,
  }));

  const id = uuidv4();
  db.prepare(
    'INSERT INTO predictions (id, task_id, image_url, detections) VALUES (?, ?, ?, ?)'
  ).run(id, taskId, imageUrl, JSON.stringify(enriched));

  return { id, image_url: imageUrl, detections: enriched };
}

module.exports = router;
