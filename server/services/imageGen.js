const axios = require('axios');
const fs = require('fs');
const path = require('path');

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

  // fal 同步端点：直接返回结果，无需轮询
  const resp = await client.post('https://fal.run/fal-ai/z-image/turbo', {
    prompt,
    image_size: imageSize,
    num_inference_steps: 8,
    num_images: 1,
    output_format: 'png',
    enable_safety_checker: false,
  });

  const images = resp.data.images;
  if (!images || images.length === 0) {
    throw new Error('fal 未返回图片');
  }

  const imageUrl = images[0].url;
  return await downloadImage(imageUrl, outputPath);
}

async function downloadImage(url, outputPath) {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(resp.data));
  return outputPath;
}

module.exports = { generateImage };
