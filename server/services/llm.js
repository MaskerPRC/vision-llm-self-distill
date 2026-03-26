const axios = require('axios');

function getLLMClient() {
  return axios.create({
    baseURL: process.env.LLM_API_BASE || 'https://api.openai.com/v1',
    headers: {
      'Authorization': `Bearer ${process.env.LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });
}

async function generatePrompts(description, classes, count) {
  const client = getLLMClient();
  const model = process.env.LLM_MODEL || 'gpt-4o';

  const systemPrompt = `你是一个专业的AI图片生成提示词专家。用户会告诉你需要识别的视觉元素（类别），你需要为文本生图模型生成多样化的提示词。

要求：
1. 每个提示词必须包含用户指定的一个或多个目标类别的物体
2. 场景、光照、角度、背景要尽量多样化
3. 提示词用英文，尽量详细描述场景
4. 物体应在图中清晰可见、大小适中
5. 确保各种不同的环境和构图：室内/室外、近景/远景、不同天气/时间
6. 每个提示词独立一行，不要编号`;

  const userPrompt = `我需要训练一个YOLO模型来识别以下类别：${classes.join(', ')}

需求描述：${description}

请生成 ${count} 个多样化的英文生图提示词，每行一个，不要编号或前缀。`;

  const resp = await client.post('/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 1.0,
    max_tokens: 4096,
  });

  const text = resp.data.choices[0].message.content.trim();
  const prompts = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 10)
    .slice(0, count);

  return prompts;
}

module.exports = { generatePrompts };
