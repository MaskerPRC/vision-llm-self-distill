# RT-DETR Pipeline - 自动化 RT-DETR 训练流水线

一站式自动化目标检测模型训练系统：**提出需求 → AI生图 → 自动标注 → RT-DETR训练 → 输出模型**

## 架构

```
用户需求 → LLM生成提示词 → 生图API生成图片 → 视觉LLM自动标注 → RT-DETR训练 → 模型输出
```

**技术栈**: Vue 3 + Node.js (Express) + SQLite + RT-DETR (ultralytics)

## 流水线步骤

| 步骤 | 说明 | 使用的AI |
|------|------|----------|
| 1. 生成提示词 | 根据用户需求,LLM生成多样化的生图提示词 | GPT-4o / 兼容API |
| 2. 生成图片 | 调用文生图API,批量生成训练图片 | DALL-E 3 / SD API |
| 3. 自动标注 | 视觉LLM分析图片,输出标准标注格式 | GPT-4o Vision |
| 4. 训练模型 | 自动构建数据集,调用ultralytics训练RT-DETR | RT-DETR |
| 5. 评估输出 | 在验证集上测试,输出指标和模型文件 | RT-DETR |

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.8 + `pip install ultralytics`
- OpenAI API Key (或兼容API)

### 安装

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd client && npm install

# 安装 RT-DETR 训练依赖
pip install ultralytics
```

### 配置

复制 `.env.example` 为 `.env` 并填写 API 配置:

```bash
cp .env.example .env
```

关键配置项:
- `LLM_API_BASE` / `LLM_API_KEY` - 用于生成提示词的LLM
- `VISION_API_BASE` / `VISION_API_KEY` - 用于自动标注的视觉模型
- `IMAGE_API_BASE` / `IMAGE_API_KEY` - 文生图API
- `PYTHON_PATH` - Python可执行文件路径
- `RTDETR_MODEL` - RT-DETR预训练模型 (默认 `rtdetr-l.pt`)

### 启动

```bash
# 同时启动前后端
npm run dev

# 或分别启动
npm run dev:server  # 后端 http://localhost:3000
npm run dev:client  # 前端 http://localhost:5173
```

### 使用方式

1. 打开浏览器访问 `http://localhost:5173`
2. 点击「新建任务」
3. 填写任务名称、需求描述、检测类别
4. 点击「启动流水线」,等待自动完成
5. 训练完成后下载 `.pt` 模型文件

## 项目结构

```
rtdetr-pipeline/
├── server/                   # 后端
│   ├── index.js              # 入口
│   ├── db.js                 # SQLite 数据库
│   ├── ws.js                 # WebSocket 实时推送
│   ├── pipeline.js           # 流水线编排控制器
│   ├── routes/
│   │   ├── tasks.js          # 任务 CRUD API
│   │   └── config.js         # 配置 API
│   └── services/
│       ├── llm.js            # LLM 提示词生成
│       ├── imageGen.js       # 图片生成
│       ├── vision.js         # 视觉标注
│       ├── rtdetr.js         # RT-DETR 训练
│       └── yaml.js           # YAML 工具
├── client/                   # 前端 Vue 3
│   └── src/
│       ├── views/Home.vue    # 首页(任务列表+创建)
│       ├── views/TaskDetail.vue  # 任务详情(进度+日志+结果)
│       ├── stores/task.js    # Pinia状态管理
│       └── api.js            # API封装
├── data/                     # 运行时数据(自动创建)
│   ├── images/               # 生成的图片
│   ├── labels/               # 标注文件
│   ├── datasets/             # 训练数据集
│   └── models/               # 训练输出模型
└── .env                      # 环境变量配置
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/tasks | 获取所有任务 |
| POST | /api/tasks | 创建任务 |
| GET | /api/tasks/:id | 获取任务详情 |
| POST | /api/tasks/:id/start | 启动流水线 |
| POST | /api/tasks/:id/abort | 终止流水线 |
| DELETE | /api/tasks/:id | 删除任务 |
| GET | /api/config | 获取系统配置 |
| WS | /ws | 实时日志推送 |
