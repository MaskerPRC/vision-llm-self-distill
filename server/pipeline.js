const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./db');
const { broadcast } = require('./ws');
const { generatePrompts } = require('./services/llm');
const { generateImage } = require('./services/imageGen');
const { labelImage } = require('./services/vision');
const { buildDatasetStructure, trainYOLO } = require('./services/yolo');

const activePipelines = new Map();

function updateTask(taskId, updates) {
  const db = getDB();
  const sets = Object.entries(updates)
    .map(([k, v]) => `${k} = ?`)
    .join(', ');
  const values = Object.values(updates).map(v =>
    typeof v === 'object' ? JSON.stringify(v) : v
  );
  db.prepare(`UPDATE tasks SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, taskId);

  broadcast({ type: 'task_update', taskId, updates });
}

function appendLog(taskId, message) {
  const db = getDB();
  const task = db.prepare('SELECT log FROM tasks WHERE id = ?').get(taskId);
  const timestamp = new Date().toLocaleTimeString('zh-CN');
  const newLog = (task.log || '') + `[${timestamp}] ${message}\n`;
  db.prepare('UPDATE tasks SET log = ? WHERE id = ?').run(newLog, taskId);
  broadcast({ type: 'task_log', taskId, message: `[${timestamp}] ${message}` });
}

function isAborted(taskId) {
  return !activePipelines.has(taskId);
}

async function startPipeline(taskId) {
  activePipelines.set(taskId, true);

  try {
    const db = getDB();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    const classes = JSON.parse(task.classes);

    appendLog(taskId, `🚀 流水线启动 | 类别: ${classes.join(', ')} | 图片数: ${task.image_count}`);

    // === Step 1: 生成提示词 ===
    updateTask(taskId, { status: 'generating_prompts', progress: 5 });
    appendLog(taskId, '📝 Step 1/5: 正在使用LLM生成生图提示词...');

    const prompts = await generatePrompts(task.description, classes, task.image_count);
    appendLog(taskId, `✅ 已生成 ${prompts.length} 个提示词`);

    if (isAborted(taskId)) return;

    const imageRecords = prompts.map(prompt => ({
      id: uuidv4(),
      task_id: taskId,
      prompt,
    }));

    const insertStmt = db.prepare(
      'INSERT INTO task_images (id, task_id, prompt, status) VALUES (?, ?, ?, ?)'
    );
    const insertMany = db.transaction((records) => {
      for (const r of records) {
        insertStmt.run(r.id, r.task_id, r.prompt, 'pending');
      }
    });
    insertMany(imageRecords);

    // === Step 2: 生成图片 ===
    updateTask(taskId, { status: 'generating_images', progress: 15 });
    appendLog(taskId, '🎨 Step 2/5: 正在生成图片...');

    const imgDir = path.join(__dirname, '..', 'data', 'images', taskId);
    fs.mkdirSync(imgDir, { recursive: true });

    for (let i = 0; i < imageRecords.length; i++) {
      if (isAborted(taskId)) return;

      const record = imageRecords[i];
      const imgPath = path.join(imgDir, `${record.id}.png`);

      try {
        await generateImage(record.prompt, imgPath);
        record.image_path = imgPath;
        db.prepare("UPDATE task_images SET image_path = ?, status = 'generated' WHERE id = ?")
          .run(imgPath, record.id);

        const progress = 15 + Math.floor((i + 1) / imageRecords.length * 30);
        updateTask(taskId, { progress });
        appendLog(taskId, `🖼️ [${i + 1}/${imageRecords.length}] 图片生成完成`);
      } catch (err) {
        appendLog(taskId, `⚠️ [${i + 1}/${imageRecords.length}] 图片生成失败: ${err.message}`);
        db.prepare("UPDATE task_images SET status = 'failed' WHERE id = ?").run(record.id);
      }

      if (i < imageRecords.length - 1) {
        await sleep(500);
      }
    }

    // === Step 3: 视觉标注 ===
    updateTask(taskId, { status: 'labeling', progress: 50 });
    appendLog(taskId, '🏷️ Step 3/5: 正在使用视觉LLM进行自动标注...');

    const labelDir = path.join(__dirname, '..', 'data', 'labels', taskId);
    fs.mkdirSync(labelDir, { recursive: true });

    const generatedImages = imageRecords.filter(r => r.image_path);
    for (let i = 0; i < generatedImages.length; i++) {
      if (isAborted(taskId)) return;

      const record = generatedImages[i];
      try {
        const labelContent = await labelImage(record.image_path, classes);
        const labelPath = path.join(labelDir, `${record.id}.txt`);
        fs.writeFileSync(labelPath, labelContent);
        record.label_path = labelPath;

        db.prepare("UPDATE task_images SET label_path = ?, status = 'labeled' WHERE id = ?")
          .run(labelPath, record.id);

        const progress = 50 + Math.floor((i + 1) / generatedImages.length * 20);
        updateTask(taskId, { progress });
        appendLog(taskId, `🏷️ [${i + 1}/${generatedImages.length}] 标注完成`);
      } catch (err) {
        appendLog(taskId, `⚠️ [${i + 1}/${generatedImages.length}] 标注失败: ${err.message}`);
      }

      if (i < generatedImages.length - 1) {
        await sleep(300);
      }
    }

    // === Step 4: 构建数据集 + 训练 ===
    updateTask(taskId, { status: 'training', progress: 75 });
    appendLog(taskId, '🏗️ Step 4/5: 正在构建YOLO数据集并开始训练...');

    const labeledImages = db.prepare(
      "SELECT * FROM task_images WHERE task_id = ? AND status = 'labeled'"
    ).all(taskId);

    if (labeledImages.length < 2) {
      throw new Error('有效标注图片不足（至少需要2张），无法训练');
    }

    const { yamlPath, splits } = buildDatasetStructure(
      taskId, labeledImages, classes, task.test_split
    );

    const updateSplit = db.prepare('UPDATE task_images SET split = ? WHERE id = ?');
    for (const s of splits) {
      updateSplit.run(s.split, s.id);
    }

    appendLog(taskId, `📂 数据集构建完成 | 训练集: ${splits.filter(s => s.split === 'train').length} | 验证集: ${splits.filter(s => s.split === 'val').length}`);
    appendLog(taskId, `🏃 开始YOLO训练 (epochs: ${task.epochs})...`);

    const { metrics, modelPath } = await trainYOLO(
      yamlPath, task.epochs, taskId,
      (logLine) => {
        broadcast({ type: 'task_log', taskId, message: logLine });
      }
    );

    if (isAborted(taskId)) return;

    // === Step 5: 结果 ===
    updateTask(taskId, {
      status: 'completed',
      progress: 100,
      model_path: modelPath,
      metrics: metrics,
    });

    appendLog(taskId, '✅ Step 5/5: 训练完成！');
    appendLog(taskId, `📊 指标: Precision=${metrics?.precision?.toFixed(4)} Recall=${metrics?.recall?.toFixed(4)} mAP50=${metrics?.mAP50?.toFixed(4)} mAP50-95=${metrics?.mAP50_95?.toFixed(4)}`);
    appendLog(taskId, `📦 模型文件: ${modelPath}`);

  } catch (err) {
    appendLog(taskId, `❌ 流水线失败: ${err.message}`);
    updateTask(taskId, { status: 'failed', error: err.message });
  } finally {
    activePipelines.delete(taskId);
  }
}

function abortPipeline(taskId) {
  activePipelines.delete(taskId);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { startPipeline, abortPipeline };
