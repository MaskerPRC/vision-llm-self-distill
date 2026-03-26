const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function predictImage(modelPath, imagePath, classes) {
  return new Promise((resolve, reject) => {
    const pythonPath = process.env.PYTHON_PATH || 'python';

    const script = `
import sys, json
from ultralytics import RTDETR

model = RTDETR('${modelPath.replace(/\\/g, '/')}')
results = model.predict(
    source='${imagePath.replace(/\\/g, '/')}',
    imgsz=640,
    conf=0.25,
    verbose=False
)

detections = []
for r in results:
    boxes = r.boxes
    img_h, img_w = r.orig_shape
    for i in range(len(boxes)):
        cls_id = int(boxes.cls[i].item())
        conf = float(boxes.conf[i].item())
        x1, y1, x2, y2 = boxes.xyxy[i].tolist()
        cx = ((x1 + x2) / 2) / img_w
        cy = ((y1 + y2) / 2) / img_h
        bw = (x2 - x1) / img_w
        bh = (y2 - y1) / img_h
        detections.append({
            'class': cls_id,
            'confidence': round(conf, 4),
            'cx': round(cx, 6),
            'cy': round(cy, 6),
            'w': round(bw, 6),
            'h': round(bh, 6)
        })

print('DETECTIONS_JSON:' + json.dumps(detections))
`;

    const tempDir = path.join(__dirname, '..', '..', 'data', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const scriptPath = path.join(tempDir, `predict_${Date.now()}.py`);
    fs.writeFileSync(scriptPath, script);

    const proc = spawn(pythonPath, [scriptPath], {
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      try { fs.unlinkSync(scriptPath); } catch {}

      if (code !== 0) {
        return reject(new Error(`预测失败 (exit ${code}): ${stderr.slice(0, 500)}`));
      }

      const match = stdout.match(/DETECTIONS_JSON:(.+)/);
      if (!match) {
        return reject(new Error('未获取到预测结果'));
      }

      const detections = JSON.parse(match[1]);
      resolve(detections);
    });
  });
}

module.exports = { predictImage };
