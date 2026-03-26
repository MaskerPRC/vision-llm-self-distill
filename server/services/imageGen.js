const axios = require('axios');
const fs = require('fs');
const path = require('path');

const FAL_BASE = 'https://queue.fal.run/fal-ai/z-image/turbo';

function getFalClient() {
  return axios.create({
    headers: {
      'Authorization': `Key ${process.env.FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });
}

async function generateImage(prompt, outputPath) {
  const client = getFalClient();
  const imageSize = process.env.FAL_IMAGE_SIZE || 'square_hd';

  const submitResp = await client.post(FAL_BASE, {
    prompt,
    image_size: imageSize,
    num_inference_steps: 8,
    num_images: 1,
    output_format: 'png',
    enable_safety_checker: false,
  });

  const requestId = submitResp.data.request_id;
  if (!requestId) {
    if (submitResp.data.images && submitResp.data.images.length > 0) {
      return await downloadImage(submitResp.data.images[0].url, outputPath);
    }
    throw new Error('fal API 未返回 request_id 或 images');
  }

  let result = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);

    const statusResp = await client.get(`${FAL_BASE}/requests/${requestId}/status`);
    const status = statusResp.data.status;

    if (status === 'COMPLETED') {
      const resultResp = await client.get(`${FAL_BASE}/requests/${requestId}`);
      result = resultResp.data;
      break;
    }
    if (status === 'FAILED') {
      throw new Error(`fal 生图失败: ${JSON.stringify(statusResp.data)}`);
    }
  }

  if (!result) {
    throw new Error('fal 生图超时 (120s)');
  }

  if (!result.images || result.images.length === 0) {
    throw new Error('fal 未返回图片');
  }

  return await downloadImage(result.images[0].url, outputPath);
}

async function downloadImage(url, outputPath) {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(resp.data));
  return outputPath;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { generateImage };
