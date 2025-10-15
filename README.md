# A股分析平台

一个基于Kronos AI预测引擎的A股分析平台，提供技术分析、估值计算和智能预测功能。

## 🚀 功能特色

- **Kronos AI预测引擎**: 基于NeoQuasar/Kronos-small模型的股票价格预测
- **技术分析**: 支持多种技术指标计算和K线图展示
- **估值计算**: 提供PE、PB、ROE等估值指标分析
- **实时数据**: 集成A股实时行情数据
- **现代化界面**: 基于React + TypeScript的响应式前端

## 📁 项目结构

```
a-stock-analysis-platform/
├── frontend/          # React前端应用
├── server/            # Node.js后端API
├── etl/              # 数据ETL处理脚本
├── ml-kronos/        # Kronos AI预测引擎
└── README.md         # 项目说明文档
```

## 🛠️ 技术栈

### 前端
- React 18 + TypeScript
- Vite构建工具
- Tailwind CSS样式
- Chart.js图表库

### 后端
- Node.js + Express
- TypeScript
- Prisma ORM
- SQLite数据库

### AI预测
- Kronos-small模型
- Python + FastAPI
- Hugging Face Transformers

## 🚀 快速开始

### 环境要求
- Node.js 18+
- Python 3.9+
- Git

### 安装步骤

1. **克隆仓库**
```bash
git clone https://github.com/你的用户名/a-stock-analysis-platform.git
cd a-stock-analysis-platform
```

2. **安装前端依赖**
```bash
cd frontend
npm install
```

3. **安装后端依赖**
```bash
cd ../server
npm install
```

4. **安装AI引擎依赖**
```bash
cd ../ml-kronos
pip install -r requirements.txt
```

5. **启动服务**
```bash
# 启动后端API
cd server && npm run dev

# 启动前端应用
cd frontend && npm run dev

# 启动AI预测引擎
cd ml-kronos && python main.py
```

## 📊 API接口

### 股票数据
- `GET /api/stocks` - 获取股票列表
- `GET /api/stocks/:code` - 获取股票详情
- `GET /api/stocks/:code/history` - 获取历史数据

### 技术分析
- `GET /api/technical/:code/indicators` - 获取技术指标
- `GET /api/technical/:code/signals` - 获取交易信号

### AI预测
- `POST /api/predict` - 股票价格预测
- `GET /api/predict/:code` - 获取预测结果

## 🔧 配置说明

### 环境变量
创建 `.env` 文件并配置：
```env
# 数据库
DATABASE_URL="file:./dev.db"

# API配置
PORT=3001
NODE_ENV=development

# AI模型配置
KRONOS_MODEL_ID="NeoQuasar/Kronos-small"
KRONOS_TOKENIZER_ID="NeoQuasar/Kronos-Tokenizer-base"
```

## 📈 使用说明

1. **查看股票列表**: 访问首页查看所有A股股票
2. **股票详情**: 点击股票卡片查看详细信息
3. **技术分析**: 查看K线图和技术指标
4. **AI预测**: 获取基于Kronos模型的股价预测
5. **估值分析**: 查看PE、PB等估值指标

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进项目！

## 📄 许可证

MIT License

## 🙏 致谢

- [NeoQuasar/Kronos](https://huggingface.co/NeoQuasar/Kronos-small) - AI预测模型
- [React](https://reactjs.org/) - 前端框架
- [Express](https://expressjs.com/) - 后端框架