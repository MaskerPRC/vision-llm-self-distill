const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    llm_model: process.env.LLM_MODEL || 'gpt-4o',
    vision_model: process.env.VISION_MODEL || 'gpt-4o',
    image_model: process.env.IMAGE_MODEL || 'dall-e-3',
    image_size: process.env.IMAGE_SIZE || '1024x1024',
    default_image_count: parseInt(process.env.DEFAULT_IMAGE_COUNT) || 50,
    default_epochs: parseInt(process.env.DEFAULT_EPOCHS) || 50,
    test_split_ratio: parseFloat(process.env.TEST_SPLIT_RATIO) || 0.2,
    python_path: process.env.PYTHON_PATH || 'python',
  });
});

module.exports = router;
