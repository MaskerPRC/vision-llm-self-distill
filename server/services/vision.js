const axios = require('axios');
const fs = require('fs');
const path = require('path');

function getVisionClient() {
  return axios.create({
    baseURL: process.env.VISION_API_BASE || 'https://openrouter.ai/api/v1',
    headers: {
      'Authorization': `Bearer ${process.env.VISION_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });
}

async function labelImage(imagePath, classes) {
  const client = getVisionClient();
  const model = process.env.VISION_MODEL || 'google/gemini-3.1-pro-preview';

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).slice(1) || 'png';
  const dataUri = `data:image/${ext};base64,${base64Image}`;

  const classListStr = classes.map((c, i) => `${i}: ${c}`).join('\n');

  const systemPrompt = `你是一个精确的目标检测标注专家。用户提供图片和类别列表，你需要输出标准目标检测格式的标注。

类别索引：
${classListStr}

标注格式说明：每行一个目标，格式为：
class_index center_x center_y width height

其中所有坐标都是归一化到0-1范围的（相对于图片宽高）。
center_x, center_y 是边界框中心点坐标。
width, height 是边界框的宽高。

要求：
1. 仔细分析图片中的每个目标物体
2. 只标注属于给定类别的物体
3. 边界框要尽量精确地包围目标
4. 如果图中没有任何目标类别的物体，返回空内容
5. 只输出标注行，不要其他文字`;

  const resp = await client.post('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `请标注这张图片中属于以下类别的所有物体：${classes.join(', ')}\n只输出标注格式，不要任何其他文字。`,
          },
          {
            type: 'image_url',
            image_url: { url: dataUri, detail: 'high' },
          },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  });

  const text = resp.data.choices[0].message.content.trim();
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => /^\d+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+$/.test(l));

  const validLines = lines.filter(line => {
    const parts = line.split(/\s+/);
    const classIdx = parseInt(parts[0]);
    const coords = parts.slice(1).map(Number);
    return classIdx >= 0 && classIdx < classes.length &&
           coords.every(v => v >= 0 && v <= 1);
  });

  return validLines.join('\n');
}

module.exports = { labelImage };
