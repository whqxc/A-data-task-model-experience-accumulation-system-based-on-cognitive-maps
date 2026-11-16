const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { resolve, extname, sep } = require('node:path');
const { ExperienceStore } = require('./src/database');
const { recommend } = require('./src/recommender');
const { enrichRecommendation } = require('./src/llm');

const PUBLIC_DIR = resolve(__dirname, 'public');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('请求 JSON 格式不正确'), { status: 400 });
  }
}

function validateExperience(input) {
  const required = [
    ['task', 'name', '任务名称'], ['task', 'description', '任务描述'],
    ['task', 'domain', '应用领域'], ['task', 'taskType', '任务类型'], ['task', 'metric', '评估指标'],
    ['dataset', 'name', '数据集名称'], ['dataset', 'features', '数据特征'], ['dataset', 'preprocessing', '预处理方法'],
    ['model', 'name', '模型名称'], ['model', 'family', '模型类别'],
    ['experiment', 'optimizer', '优化器'], ['experiment', 'trainingTime', '训练耗时'], ['experiment', 'notes', '经验总结']
  ];
  required.forEach(([section, field, label]) => {
    if (typeof input[section]?.[field] !== 'string' || !input[section][field].trim()) {
      throw Object.assign(new Error(`请填写${label}`), { status: 400 });
    }
    input[section][field] = input[section][field].trim();
  });
  if (!['image', 'text', 'tabular'].includes(input.task.modality)) throw Object.assign(new Error('请选择正确的数据模态'), { status: 400 });
  if (!['small', 'medium', 'large'].includes(input.task.dataScale)) throw Object.assign(new Error('请选择正确的数据规模'), { status: 400 });
  if (!['success', 'failed'].includes(input.experiment.status)) throw Object.assign(new Error('请选择实验结果'), { status: 400 });
  const numericRules = [
    ['dataset', 'size', '样本数量', 1, 1_000_000_000_000, true],
    ['experiment', 'score', '指标得分', 0, 100, false],
    ['experiment', 'learningRate', '学习率', 0, 100, false],
    ['experiment', 'batchSize', '批大小', 1, 1_000_000, true],
    ['experiment', 'epochs', '训练轮数', 1, 1_000_000, true]
  ];
  numericRules.forEach(([section, field, label, min, max, integer]) => {
    const value = Number(input[section]?.[field]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw Object.assign(new Error(`${label}数值不正确`), { status: 400 });
    }
    input[section][field] = value;
  });
  input.model.pretrained = Boolean(input.model.pretrained);
  return input;
}

function validateRecommendation(input) {
  const fields = ['name', 'description', 'domain', 'taskType'];
  fields.forEach((field) => {
    if (typeof input[field] !== 'string' || !input[field].trim()) throw Object.assign(new Error('请完整填写新任务信息'), { status: 400 });
    input[field] = input[field].trim();
  });
  if (!['image', 'text', 'tabular'].includes(input.modality) || !['small', 'medium', 'large'].includes(input.dataScale)) {
    throw Object.assign(new Error('请选择正确的数据模态和规模'), { status: 400 });
  }
  return input;
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    sendJson(response, 403, { error: '禁止访问' });
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') sendJson(response, 404, { error: '页面不存在' });
    else throw error;
  }
}

function createRequestHandler(store, options = {}) {
  return async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, { status: 'ok' });
      } else if (url.pathname === '/api/overview' && request.method === 'GET') {
        sendJson(response, 200, await store.getOverview());
      } else if (url.pathname === '/api/experiments' && request.method === 'GET') {
        sendJson(response, 200, await store.listExperiments());
      } else if (url.pathname === '/api/experiments' && request.method === 'POST') {
        const input = validateExperience(await readJson(request));
        sendJson(response, 201, await store.createExperience(input));
      } else if (url.pathname === '/api/graph' && request.method === 'GET') {
        sendJson(response, 200, await store.getGraph());
      } else if (url.pathname === '/api/recommend' && request.method === 'POST') {
        const input = validateRecommendation(await readJson(request));
        const localResult = recommend(input, await store.listTasks(), await store.listExperiments(1000));
        sendJson(response, 200, await enrichRecommendation(input, localResult, options.llm));
      } else if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: '接口不存在' });
      } else if (request.method === 'GET') {
        await serveStatic(response, url.pathname);
      } else {
        sendJson(response, 405, { error: '不支持的请求方法' });
      }
    } catch (error) {
      if (!error.status || error.status >= 500) console.error(error);
      if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : '服务器处理失败，请稍后重试' });
    }
  };
}

function createAppServer(options = {}) {
  const store = new ExperienceStore(options.databasePath || resolve(__dirname, 'data', 'experience.db'));
  const server = http.createServer(createRequestHandler(store, options));
  server.on('close', () => store.close());
  return server;
}

if (require.main === module) {
  const envFile = resolve(__dirname, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`知模经验中枢已启动：http://127.0.0.1:${port}`);
    console.log('按 Ctrl+C 停止服务');
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createAppServer, createRequestHandler, validateExperience, validateRecommendation };
