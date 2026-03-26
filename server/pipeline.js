const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./db');
const { broadcast } = require('./ws');
const { generatePrompts, generateNegativePrompts } = require('./services/llm');
const { generateImage } = require('./services/imageGen');
const { labelImage } = require('./services/vision');
const { buildDatasetStructure, trainRTDETR } = require('./services/rtdetr');

const CONCURRENCY_IMAGE = 5;
const CONCURRENCY_LABEL = 2;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 3000;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
}

async function runParallel(items, concurrency, taskId, fn) {
  let index = 0;
  let aborted = false;

  async function worker() {
    while (!aborted) {
      const i = index++;
      if (i >= items.length) break;
      if (isAborted(taskId)) { aborted = true; break; }
      await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
}

async function startPipeline(taskId) {
  activePipelines.set(taskId, true);

  try {
    const db = getDB();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    const classes = JSON.parse(task.classes);
    const targetCount = task.image_count;

    let existingImages = db.prepare(
      'SELECT * FROM task_images WHERE task_id = ? ORDER BY created_at'
    ).all(taskId);

    // 如果记录数超过目标数(历史重复)，只保留前 targetCount 条
    if (existingImages.length > targetCount) {
      const toKeep = existingImages.slice(0, targetCount);
      const toRemove = existingImages.slice(targetCount);
      const keepIds = new Set(toKeep.map(r => r.id));
      const removeStmt = db.prepare('DELETE FROM task_images WHERE id = ?');
      db.transaction(() => {
        for (const r of toRemove) {
          removeStmt.run(r.id);
        }
      })();
      existingImages = toKeep;
      appendLog(taskId, `🧹 清理了 ${toRemove.length} 条重复记录，保留 ${toKeep.length} 条`);
    }

    const hasExistingData = existingImages.length > 0;
    appendLog(taskId, `🚀 流水线${hasExistingData ? '恢复' : '启动'} | 类别: ${classes.join(', ')} | 目标: ${targetCount} 张`);

    // ============================================================
    // Step 1: 生成提示词 (含正样本 + 负样本)
    // ============================================================
    let imageRecords;
    const negativeRatio = parseFloat(process.env.NEGATIVE_SAMPLE_RATIO) || 0;
    const negativeCount = Math.floor(targetCount * negativeRatio);
    const positiveCount = targetCount - negativeCount;

    if (hasExistingData) {
      imageRecords = existingImages;
      const labeled = existingImages.filter(r => r.label_path && fs.existsSync(r.label_path)).length;
      const generated = existingImages.filter(r => r.image_path && fs.existsSync(r.image_path)).length;
      const negCount = existingImages.filter(r => r.is_negative).length;
      appendLog(taskId, `📝 Step 1: 复用已有 ${existingImages.length} 条记录 (${generated} 张图片, ${labeled} 条标注, ${negCount} 张负样本)`);
    } else {
      updateTask(taskId, { status: 'generating_prompts', progress: 5 });
      appendLog(taskId, '📝 Step 1: 正在生成提示词...');

      const prompts = await withRetry(() => generatePrompts(task.description, classes, positiveCount));
      appendLog(taskId, `✅ 已生成 ${prompts.length} 个正样本提示词`);

      if (isAborted(taskId)) return;

      let negativePrompts = [];
      if (negativeCount > 0) {
        appendLog(taskId, `📝 正在生成 ${negativeCount} 个负样本提示词...`);
        negativePrompts = await withRetry(() => generateNegativePrompts(task.description, classes, negativeCount));
        appendLog(taskId, `✅ 已生成 ${negativePrompts.length} 个负样本提示词`);
      }

      if (isAborted(taskId)) return;

      imageRecords = [
        ...prompts.map(prompt => ({
          id: uuidv4(),
          task_id: taskId,
          prompt,
          status: 'pending',
          image_path: null,
          label_path: null,
          is_negative: 0,
        })),
        ...negativePrompts.map(prompt => ({
          id: uuidv4(),
          task_id: taskId,
          prompt,
          status: 'pending',
          image_path: null,
          label_path: null,
          is_negative: 1,
        })),
      ];

      const insertStmt = db.prepare(
        'INSERT INTO task_images (id, task_id, prompt, status, is_negative) VALUES (?, ?, ?, ?, ?)'
      );
      db.transaction(() => {
        for (const r of imageRecords) {
          insertStmt.run(r.id, r.task_id, r.prompt, 'pending', r.is_negative || 0);
        }
      })();
    }

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 2: 并行生成图片
    // ============================================================
    const needGenerate = imageRecords.filter(r => !r.image_path || !fs.existsSync(r.image_path));
    const alreadyGenerated = imageRecords.length - needGenerate.length;
    const total = imageRecords.length;

    updateTask(taskId, { status: 'generating_images', progress: 15 });

    if (needGenerate.length === 0) {
      appendLog(taskId, `🎨 Step 2: 全部 ${total} 张图片已存在，跳过`);
    } else {
      appendLog(taskId, `🎨 Step 2: 生成图片 ${needGenerate.length}/${total} (并发 ${CONCURRENCY_IMAGE})...`);
      const imgDir = path.join(__dirname, '..', 'data', 'images', taskId);
      fs.mkdirSync(imgDir, { recursive: true });

      let doneCount = alreadyGenerated;
      let failCount = 0;

      await runParallel(needGenerate, CONCURRENCY_IMAGE, taskId, async (record) => {
        const imgPath = path.join(imgDir, `${record.id}.png`);
        try {
          await withRetry(() => generateImage(record.prompt, imgPath));
          record.image_path = imgPath;
          record.status = 'generated';
          db.prepare("UPDATE task_images SET image_path = ?, status = 'generated' WHERE id = ?")
            .run(imgPath, record.id);
          doneCount++;
          updateTask(taskId, { progress: 15 + Math.floor(doneCount / total * 30) });
          appendLog(taskId, `🖼️ [${doneCount}/${total}] 图片生成完成`);
        } catch (err) {
          failCount++;
          db.prepare("UPDATE task_images SET status = 'failed' WHERE id = ?").run(record.id);
          appendLog(taskId, `⚠️ 图片生成失败(已重试${MAX_RETRIES}次): ${err.message}`);
        }
      });

      appendLog(taskId, `🎨 生图完成: 成功 ${doneCount}/${total}, 失败 ${failCount}`);
    }

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 3: 并行视觉标注 (低并发 + 重试) + 负样本空标签
    // ============================================================
    const allGenerated = imageRecords.filter(r => r.image_path && fs.existsSync(r.image_path));
    const needLabel = allGenerated.filter(r => !r.label_path || !fs.existsSync(r.label_path));
    const alreadyLabeled = allGenerated.length - needLabel.length;

    updateTask(taskId, { status: 'labeling', progress: 50 });

    if (needLabel.length === 0) {
      appendLog(taskId, `🏷️ Step 3: 全部 ${allGenerated.length} 张已标注，跳过`);
    } else {
      const negInBatch = needLabel.filter(r => r.is_negative).length;
      const posInBatch = needLabel.length - negInBatch;
      appendLog(taskId, `🏷️ Step 3: 标注 ${posInBatch} 张正样本 + ${negInBatch} 张负样本(空标签) (并发 ${CONCURRENCY_LABEL}, 自动重试)...`);
      const labelDir = path.join(__dirname, '..', 'data', 'labels', taskId);
      fs.mkdirSync(labelDir, { recursive: true });

      let doneCount = alreadyLabeled;
      let failCount = 0;
      const labelTotal = allGenerated.length;

      await runParallel(needLabel, CONCURRENCY_LABEL, taskId, async (record) => {
        try {
          const labelPath = path.join(labelDir, `${record.id}.txt`);

          if (record.is_negative) {
            fs.writeFileSync(labelPath, '');
          } else {
            const labelContent = await withRetry(() => labelImage(record.image_path, classes));
            fs.writeFileSync(labelPath, labelContent);
          }

          record.label_path = labelPath;
          record.status = 'labeled';
          db.prepare("UPDATE task_images SET label_path = ?, status = 'labeled' WHERE id = ?")
            .run(labelPath, record.id);
          doneCount++;
          updateTask(taskId, { progress: 50 + Math.floor(doneCount / labelTotal * 20) });
          appendLog(taskId, `🏷️ [${doneCount}/${labelTotal}] ${record.is_negative ? '负样本' : '标注'}完成`);
        } catch (err) {
          failCount++;
          appendLog(taskId, `⚠️ 标注失败(已重试${MAX_RETRIES}次): ${err.message}`);
        }

        if (!record.is_negative) await sleep(1000);
      });

      appendLog(taskId, `🏷️ 标注完成: 成功 ${doneCount}/${labelTotal}, 失败 ${failCount}`);
    }

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 4: 构建数据集 + 训练
    // ============================================================
    updateTask(taskId, { status: 'training', progress: 75 });
    appendLog(taskId, '🏗️ Step 4: 构建RT-DETR数据集并训练...');

    const labeledImages = db.prepare(
      "SELECT * FROM task_images WHERE task_id = ? AND status = 'labeled'"
    ).all(taskId);
    const negativeInDataset = labeledImages.filter(r => r.is_negative).length;

    if (labeledImages.length < 2) {
      throw new Error(`有效标注图片不足（当前 ${labeledImages.length} 张，至少需要2张），无法训练`);
    }

    if (negativeInDataset > 0) {
      appendLog(taskId, `📊 数据集含 ${negativeInDataset} 张负样本（空标签背景图，降低误报率）`);
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
    appendLog(taskId, `📂 数据集: 训练 ${trainCount} 张, 验证 ${valCount} 张`);
    appendLog(taskId, `🏃 开始RT-DETR训练 (epochs: ${task.epochs})...`);

    const { metrics, modelPath } = await trainRTDETR(
      yamlPath, task.epochs, taskId,
      (logLine) => {
        broadcast({ type: 'task_log', taskId, message: logLine });
      }
    );

    if (isAborted(taskId)) return;

    // ============================================================
    // Step 5: 完成
    // ============================================================
    updateTask(taskId, {
      status: 'completed',
      progress: 100,
      model_path: modelPath,
      metrics: metrics,
    });

    appendLog(taskId, '✅ 训练完成！');
    if (metrics) {
      appendLog(taskId, `📊 Precision=${metrics.precision?.toFixed(4)} Recall=${metrics.recall?.toFixed(4)} mAP50=${metrics.mAP50?.toFixed(4)} mAP50-95=${metrics.mAP50_95?.toFixed(4)}`);
    }
    appendLog(taskId, `📦 模型: ${modelPath}`);

  } catch (err) {
    if (!isAborted(taskId)) {
      appendLog(taskId, `❌ 流水线失败: ${err.message}`);
      updateTask(taskId, { status: 'failed', error: err.message });
    }
  } finally {
    activePipelines.delete(taskId);
  }
}

function abortPipeline(taskId) {
  activePipelines.delete(taskId);
}

module.exports = { startPipeline, abortPipeline };
