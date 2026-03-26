const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('./yaml');

function buildDatasetStructure(taskId, images, classes, testSplit) {
  const baseDir = path.join(__dirname, '..', '..', 'data', 'datasets', taskId);
  const dirs = [
    path.join(baseDir, 'images', 'train'),
    path.join(baseDir, 'images', 'val'),
    path.join(baseDir, 'labels', 'train'),
    path.join(baseDir, 'labels', 'val'),
  ];
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  const shuffled = [...images].sort(() => Math.random() - 0.5);
  const valCount = Math.max(1, Math.floor(shuffled.length * testSplit));
  const valImages = shuffled.slice(0, valCount);
  const trainImages = shuffled.slice(valCount);

  const splits = [];

  for (const img of trainImages) {
    if (!img.image_path || !fs.existsSync(img.image_path)) continue;
    const fname = path.basename(img.image_path);
    const baseName = path.parse(fname).name;
    fs.copyFileSync(img.image_path, path.join(baseDir, 'images', 'train', fname));
    if (img.label_path && fs.existsSync(img.label_path)) {
      fs.copyFileSync(img.label_path, path.join(baseDir, 'labels', 'train', baseName + '.txt'));
    }
    splits.push({ id: img.id, split: 'train' });
  }

  for (const img of valImages) {
    if (!img.image_path || !fs.existsSync(img.image_path)) continue;
    const fname = path.basename(img.image_path);
    const baseName = path.parse(fname).name;
    fs.copyFileSync(img.image_path, path.join(baseDir, 'images', 'val', fname));
    if (img.label_path && fs.existsSync(img.label_path)) {
      fs.copyFileSync(img.label_path, path.join(baseDir, 'labels', 'val', baseName + '.txt'));
    }
    splits.push({ id: img.id, split: 'val' });
  }

  const dataYaml = yaml.stringify({
    path: baseDir.replace(/\\/g, '/'),
    train: 'images/train',
    val: 'images/val',
    names: Object.fromEntries(classes.map((c, i) => [i, c])),
  });

  const yamlPath = path.join(baseDir, 'data.yaml');
  fs.writeFileSync(yamlPath, dataYaml);

  return { yamlPath, baseDir, splits };
}

function trainYOLO(yamlPath, epochs, taskId, onLog) {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || 'python';
    const modelDir = path.join(__dirname, '..', '..', 'data', 'models', taskId);
    fs.mkdirSync(modelDir, { recursive: true });

    const yoloModel = process.env.YOLO_MODEL || 'yolo11n.pt';
    const mosaic = parseFloat(process.env.AUGMENT_MOSAIC) || 1.0;
    const mixup = parseFloat(process.env.AUGMENT_MIXUP) || 0.3;
    const copyPaste = parseFloat(process.env.AUGMENT_COPY_PASTE) || 0.1;
    const scale = parseFloat(process.env.AUGMENT_SCALE) || 0.9;

    const script = `
import sys, json
from multiprocessing import freeze_support
from ultralytics import YOLO

def main():
    model = YOLO('${yoloModel}')
    model.train(
        data='${yamlPath.replace(/\\/g, '/')}',
        epochs=${epochs},
        imgsz=640,
        batch=16,
        project='${modelDir.replace(/\\/g, '/')}',
        name='train',
        exist_ok=True,
        verbose=True,
        workers=0,
        mosaic=${mosaic},
        mixup=${mixup},
        copy_paste=${copyPaste},
        scale=${scale},
    )

    metrics = model.val()
    results_dict = {
        'precision': float(metrics.box.mp),
        'recall': float(metrics.box.mr),
        'mAP50': float(metrics.box.map50),
        'mAP50_95': float(metrics.box.map)
    }

    best_model = '${modelDir.replace(/\\/g, '/')}/train/weights/best.pt'
    print('METRICS_JSON:' + json.dumps(results_dict))
    print('MODEL_PATH:' + best_model)

if __name__ == '__main__':
    freeze_support()
    main()
`;

    const scriptPath = path.join(modelDir, 'train.py');
    fs.writeFileSync(scriptPath, script);

    const proc = spawn(pythonPath, [scriptPath], {
      cwd: modelDir,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (onLog) onLog(text);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (onLog) onLog(text);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`YOLO训练失败 (exit code ${code}):\n${stderr}`));
      }

      let metrics = null;
      let modelPath = null;
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('METRICS_JSON:')) {
          metrics = JSON.parse(line.replace('METRICS_JSON:', ''));
        }
        if (line.startsWith('MODEL_PATH:')) {
          modelPath = line.replace('MODEL_PATH:', '').trim();
        }
      }

      resolve({ metrics, modelPath });
    });

    proc._taskId = taskId;
  });
}

module.exports = { buildDatasetStructure, trainYOLO };
