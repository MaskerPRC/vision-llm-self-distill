const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./db');
const { broadcast } = require('./ws');
const { generatePrompts } = require('./services/llm');
const { generateImage } = require('./services/imageGen');
const { labelImage } = require('./services/vision');
const { buildDatasetStructure, trainYOLO } = require('./services/yolo');

const CONCURRENCY_IMAGE = 5;
const CONCURRENCY_LABEL = 5;

const activePipelines = new Map();

function updateTask(taskId, updates) {
  const db = getDB();
  const sets = Object.entries(updates)
    .map(([k]) => `${k} = ?`)
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

async function runParallel(items, concurrency, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i).catch(err => ({ error: err }));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function startPipeline(taskId) {
  activePipelines.set(taskId, true);

  try {
    const db = getDB();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    const classes = JSON.parse(task.classes);

    const existingImages = db.prepare(
      'SELECT * FROM task_images WHERE task_id = ? ORDER BY created_at'
    ).all(taskId);

    const hasExistingData = existingImages.length > 0;

    appendLog(taskId, `🚀 流水线${hasExistingData ? '恢复' : '启动'} | 类别: ${classes.join(', ')} | 图片数: ${task.image_count}`);

    // ============================================================
    // Step 1: 生成提示词（如果已有记录则跳过）
    // ============================================================
    let imageRecords;

    if (hasExistingData) {
      imageRecords = existingImages;
      const doneCount = existingImages.filter(r => r.status !== 'pending' && r.status !== 'failed').length;
      appendLog(taskId, `📝 Step 1/5: 已有 ${existingImages.length} 条记录 (${doneCount} 条已完成)，跳过提示词生成`);
    } else {
      updateTask(taskId, { status: 'generating_prompts', progress: 5 });
      appendLog(taskId, '📝 Step 1/5: 正在使用LLM生成生图提示词...');

      const prompts = await generatePrompts(task.description, classes, task.image_count);
      appendLog(taskId, `✅ 已生成 ${prompts.length} 个提示词`);

      if (isAborted(taskId)) return;

      imageRecords = prompts.map(prompt => ({
        id: uuidv4(),
        task_id: taskId,
        prompt,
        status: 'pending',
        image_path: null,
        label_path: null,
      }));

      const insertStmt = db.prepare(
        'INSERT INTO task_images (id, task_id, prompt, status) VALUES (?, ?, ?, ?)'
      );
      db.transaction(() => {
        for (const r of imageRecords) {
          insertStmt.run(r.id, r.task_id, r.prompt, 'pending');
        }
      })();
    }

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 2: 并行生成图片（跳过已生成的）
    // ============================================================
    const needGenerate = imageRecords.filter(r => !r.image_path || !fs.existsSync(r.image_path));
    const alreadyGenerated = imageRecords.length - needGenerate.length;

    updateTask(taskId, { status: 'generating_images', progress: 15 });

    if (needGenerate.length === 0) {
      appendLog(taskId, `🎨 Step 2/5: 全部 ${imageRecords.length} 张图片已存在，跳过生图`);
    } else {
      appendLog(taskId, `🎨 Step 2/5: 需生成 ${needGenerate.length} 张图片 (已有 ${alreadyGenerated} 张)，并发 ${CONCURRENCY_IMAGE}...`);

      const imgDir = path.join(__dirname, '..', 'data', 'images', taskId);
      fs.mkdirSync(imgDir, { recursive: true });

      let doneCount = alreadyGenerated;
      const total = imageRecords.length;

      await runParallel(needGenerate, CONCURRENCY_IMAGE, async (record, _i) => {
        if (isAborted(taskId)) return;

        const imgPath = path.join(imgDir, `${record.id}.png`);
        try {
          await generateImage(record.prompt, imgPath);
          record.image_path = imgPath;
          record.status = 'generated';
          db.prepare("UPDATE task_images SET image_path = ?, status = 'generated' WHERE id = ?")
            .run(imgPath, record.id);
          doneCount++;
          const progress = 15 + Math.floor(doneCount / total * 30);
          updateTask(taskId, { progress });
          appendLog(taskId, `🖼️ [${doneCount}/${total}] 图片生成完成`);
        } catch (err) {
          record.status = 'failed';
          db.prepare("UPDATE task_images SET status = 'failed' WHERE id = ?").run(record.id);
          doneCount++;
          appendLog(taskId, `⚠️ [${doneCount}/${total}] 图片生成失败: ${err.message}`);
        }
      });
    }

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 3: 并行视觉标注（跳过已标注的）
    // ============================================================
    const allGenerated = imageRecords.filter(r =>
      r.image_path && fs.existsSync(r.image_path)
    );
    const needLabel = allGenerated.filter(r =>
      !r.label_path || !fs.existsSync(r.label_path)
    );
    const alreadyLabeled = allGenerated.length - needLabel.length;

    updateTask(taskId, { status: 'labeling', progress: 50 });

    if (needLabel.length === 0) {
      appendLog(taskId, `🏷️ Step 3/5: 全部 ${allGenerated.length} 张图片已标注，跳过标注`);
    } else {
      appendLog(taskId, `🏷️ Step 3/5: 需标注 ${needLabel.length} 张图片 (已有 ${alreadyLabeled} 张)，并发 ${CONCURRENCY_LABEL}...`);

      const labelDir = path.join(__dirname, '..', 'data', 'labels', taskId);
      fs.mkdirSync(labelDir, { recursive: true });

      let doneCount = alreadyLabeled;
      const total = allGenerated.length;

      await runParallel(needLabel, CONCURRENCY_LABEL, async (record, _i) => {
        if (isAborted(taskId)) return;

        try {
          const labelContent = await labelImage(record.image_path, classes);
          const labelPath = path.join(labelDir, `${record.id}.txt`);
          fs.writeFileSync(labelPath, labelContent);
          record.label_path = labelPath;
          record.status = 'labeled';
          db.prepare("UPDATE task_images SET label_path = ?, status = 'labeled' WHERE id = ?")
            .run(labelPath, record.id);
          doneCount++;
          const progress = 50 + Math.floor(doneCount / total * 20);
          updateTask(taskId, { progress });
          appendLog(taskId, `🏷️ [${doneCount}/${total}] 标注完成`);
        } catch (err) {
          doneCount++;
          appendLog(taskId, `⚠️ [${doneCount}/${total}] 标注失败: ${err.message}`);
        }
      });
    }

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 4: 构建数据集 + 训练
    // ============================================================
    updateTask(taskId, { status: 'training', progress: 75 });
    appendLog(taskId, '🏗️ Step 4/5: 正在构建YOLO数据集并开始训练...');

    const labeledImages = db.prepare(
      "SELECT * FROM task_images WHERE task_id = ? AND status = 'labeled'"
    ).all(taskId);

    if (labeledImages.length < 2) {
      throw new Error(`有效标注图片不足（当前 ${labeledImages.length} 张，至少需要2张），无法训练`);
    }

    const { yamlPath, splits } = buildDatasetStructure(
      taskId, labeledImages, classes, task.test_split
    );

    const updateSplit = db.prepare('UPDATE task_images SET split = ? WHERE id = ?');
    for (const s of splits) {
      updateSplit.run(s.split, s.id);
    }

    const trainCount = splits.filter(s => s.split === 'train').length;
    const valCount = splits.filter(s => s.split === 'val').length;
    appendLog(taskId, `📂 数据集构建完成 | 训练集: ${trainCount} | 验证集: ${valCount}`);
    appendLog(taskId, `🏃 开始YOLO训练 (epochs: ${task.epochs})...`);

    const { metrics, modelPath } = await trainYOLO(
      yamlPath, task.epochs, taskId,
      (logLine) => {
        broadcast({ type: 'task_log', taskId, message: logLine });
      }
    );

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 5: 结果
    // ============================================================
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

module.exports = { startPipeline, abortPipeline };
