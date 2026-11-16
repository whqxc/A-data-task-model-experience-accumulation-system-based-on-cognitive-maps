# 知模：基于认知地图的数据—任务—模型经验沉淀系统

一个可直接运行的项目 Demo，覆盖“记录经验—查找经验—复用经验—推荐模型”的完整流程。

## 运行方式

要求：Node.js 22.5 或更高版本，推荐 Node.js 24。不配置大模型 API Key 也能使用本地推荐。

在项目目录执行：

```bash
npm install
npm start
```

然后在浏览器打开：

```text
http://127.0.0.1:3000
```

停止服务：在终端按 `Ctrl+C`。修改代码后可用 `npm run dev` 自动重启服务。

## Demo 功能

- **经验总览**：统计任务、数据集、模型和实验成功率，展示最近实验。
- **认知地图**：展示“数据集 → 任务 → 模型”关联，所有连线来自实验记录。
- **智能推荐**：输入新任务，返回相似历史任务、推荐模型、训练参数、成功经验和失败提醒。
- **经验录入**：一次表单保存任务、数据、模型和实验结果，提交后立即参与推荐。
- **实验档案**：搜索、筛选并查看每条推荐所依据的原始实验。

界面内置的实验指标是用于功能演示的虚构示例数据，不是实际训练结果。

## 学校大模型 API

系统使用学校提供的 OpenAI 兼容接口生成“经验解读”，默认模型为 `deepseek-flash-2`。模型与参数仍由本地可解释算法确定，大模型只能根据传入的历史证据进行总结。

本地启用时，在 PowerShell 中复制配置模板：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`，将 `SCHOOL_LLM_API_KEY` 设置为真实密钥。`.env` 已被 Git 忽略，不要提交或公开密钥。

接口未配置、超时或返回异常时，系统会保留本地推荐并自动降级。密钥只在服务端使用，不会发送到浏览器。

## 推荐逻辑

检索与排序使用本地、确定性的可解释算法：

1. 按数据模态（30%）、任务类型（20%）、应用领域（15%）、数据规模（10%）和描述文本相似度（25%）计算任务相似度。
2. 从相似任务中筛选成功实验。
3. 按任务相似度 75% 和历史指标 25% 对候选实验排序。
4. 将最优实验的模型、预处理方法和训练参数作为新任务的首轮实验起点。
5. 汇总相似任务中的失败记录，生成风险提醒。

“推荐依据强度”仅表示历史证据的匹配程度，不是新任务的预测准确率。没有成功实验时，系统不会生成无依据的模型推荐。

## 数据保存

- **本地开发**：使用 Node.js 内置 SQLite，数据保存在 `data/experience.db`。
- **Vercel 线上环境**：使用 PostgreSQL，通过 `DATABASE_URL` 连接。

两种环境首次启动都会自动建表并写入示例数据，后续新增记录持久保存。本地数据库文件已加入 `.gitignore`。

## 部署到 Vercel

1. 将项目推送到 GitHub，在 Vercel 中导入该仓库，框架选择 **Other**，无需额外构建命令。
2. 在 Vercel 的 Storage / Marketplace 中创建并连接 Neon PostgreSQL，或其他 PostgreSQL 数据库。
3. 在项目的 Environment Variables 中确认存在 `DATABASE_URL`。
4. 添加以下学校大模型环境变量：

```text
SCHOOL_LLM_API_KEY=你的真实密钥
SCHOOL_LLM_API_URL=https://api.llm.ustc.edu.cn/v1/chat/completions
SCHOOL_LLM_MODEL=deepseek-flash-2
```

5. 点击 Deploy。`api/` 中的 Serverless Functions 提供后端接口，`public/` 中的页面由 Vercel 托管。

学校 API 必须允许公网云服务器访问。如果接口仅限校园网或 VPN，Vercel 无法直接连接，需要由学校提供公网网关或将后端部署在校园网络内。

## 自动化测试

```bash
npm test
```

测试覆盖相似度计算、推荐结果、无证据场景、经验写入、主要 API，以及学校大模型调用和故障降级。测试使用模拟接口，不会消耗真实 API 额度。

## 目录结构

```text
server.js                 本地 HTTP 服务与共享请求处理
api/                      Vercel Serverless API 入口
src/database.js           SQLite 表结构、示例数据与查询
src/postgres-store.js     PostgreSQL 持久化实现
src/recommender.js        相似任务检索与可解释推荐
src/llm.js                学校大模型调用与降级
src/vercel-handler.js     Vercel 数据库连接复用
public/                   中文单页界面与交互
tests/                    Node.js 自动化测试
data/                     本地 SQLite 数据
```

## 后续可扩展方向

- 使用真实文本向量模型替换当前轻量文本相似度。
- 支持关联已有任务、数据集和模型，避免重复创建资产。
- 接入 MLflow 等实验平台，自动采集训练指标。
- 使用图数据库存储更复杂的认知关系，增加多跳推理。
- 支持上传非结构化实验报告，经人工审核后写入经验库。
