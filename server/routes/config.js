const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    llm_provider: 'OpenRouter',
    llm_model: process.env.LLM_MODEL || 'google/gemini-2.5-flash',
    vision_provider: 'OpenRouter',
    vision_model: process.env.VISION_MODEL || 'google/gemini-3.1-pro-preview',
    image_provider: 'fal.ai Z-Image Turbo',
    image_size: process.env.FAL_IMAGE_SIZE || 'square_hd',
    default_image_count: parseInt(process.env.DEFAULT_IMAGE_COUNT) || 50,
    default_epochs: parseInt(process.env.DEFAULT_EPOCHS) || 50,
    test_split_ratio: parseFloat(process.env.TEST_SPLIT_RATIO) || 0.2,
    python_path: process.env.PYTHON_PATH || 'python',
  });
});

module.exports = router;
