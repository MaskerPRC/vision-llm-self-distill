const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { startPipeline, abortPipeline } = require('../pipeline');

router.get('/', (req, res) => {
  const db = getDB();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  tasks.forEach(t => {
    t.classes = JSON.parse(t.classes);
    if (t.metrics) t.metrics = JSON.parse(t.metrics);
  });
  res.json(tasks);
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  task.classes = JSON.parse(task.classes);
  if (task.metrics) task.metrics = JSON.parse(task.metrics);

  const images = db.prepare('SELECT * FROM task_images WHERE task_id = ? ORDER BY created_at').all(req.params.id);
  task.images = images;
  res.json(task);
});

router.post('/', (req, res) => {
  const { name, description, classes, image_count, epochs, test_split } = req.body;
  if (!name || !description || !classes || !Array.isArray(classes) || classes.length === 0) {
    return res.status(400).json({ error: '请提供 name, description, classes(数组)' });
  }

  const db = getDB();
  const id = uuidv4();
  const imgCount = image_count || parseInt(process.env.DEFAULT_IMAGE_COUNT) || 50;
  const ep = epochs || parseInt(process.env.DEFAULT_EPOCHS) || 50;
  const split = test_split || parseFloat(process.env.TEST_SPLIT_RATIO) || 0.2;

  db.prepare(`
    INSERT INTO tasks (id, name, description, classes, image_count, epochs, test_split)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, description, JSON.stringify(classes), imgCount, ep, split);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  task.classes = JSON.parse(task.classes);
  res.status(201).json(task);
});

router.post('/:id/start', (req, res) => {
  const db = getDB();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const canStart = ['pending', 'failed', 'paused'].includes(task.status);
  if (!canStart) {
    return res.status(400).json({ error: '当前状态无法启动/继续' });
  }

  const existingImages = db.prepare(
    'SELECT COUNT(*) as cnt FROM task_images WHERE task_id = ?'
  ).get(req.params.id);

  const isResume = existingImages.cnt > 0;

  db.prepare("UPDATE tasks SET status = 'generating_prompts', error = NULL WHERE id = ?")
    .run(req.params.id);

  startPipeline(req.params.id);
  res.json({ message: isResume ? '流水线恢复运行（断点续跑）' : '流水线已启动' });
});

router.post('/:id/pause', (req, res) => {
  abortPipeline(req.params.id);
  const db = getDB();
  db.prepare("UPDATE tasks SET status = 'paused', error = '用户手动暂停' WHERE id = ?").run(req.params.id);
  res.json({ message: '任务已暂停，可随时继续' });
});

router.post('/:id/abort', (req, res) => {
  abortPipeline(req.params.id);
  const db = getDB();
  db.prepare("UPDATE tasks SET status = 'failed', error = '用户手动终止' WHERE id = ?").run(req.params.id);
  res.json({ message: '任务已终止' });
});

router.delete('/:id', (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM task_images WHERE task_id = ?').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ message: '任务已删除' });
});

module.exports = router;
