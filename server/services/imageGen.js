const axios = require('axios');
const fs = require('fs');
const path = require('path');

function getImageClient() {
  return axios.create({
    baseURL: process.env.IMAGE_API_BASE || 'https://api.openai.com/v1',
    headers: {
      'Authorization': `Bearer ${process.env.IMAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });
}

async function generateImage(prompt, outputPath) {
  const client = getImageClient();
  const model = process.env.IMAGE_MODEL || 'dall-e-3';
  const size = process.env.IMAGE_SIZE || '1024x1024';

  const resp = await client.post('/images/generations', {
    model,
    prompt,
    n: 1,
    size,
    response_format: 'b64_json',
  });

  const b64 = resp.data.data[0].b64_json;
  const buffer = Buffer.from(b64, 'base64');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

module.exports = { generateImage };
