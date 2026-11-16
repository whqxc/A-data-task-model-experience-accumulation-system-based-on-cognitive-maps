const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { ExperienceStore } = require('../src/database');
const { createRequestHandler } = require('../server');
const handleVercel = require('../src/vercel-handler');

test('共享处理器兼容 PostgreSQL 所需的异步存储方法', async () => {
  const local = new ExperienceStore(':memory:');
  const asyncStore = {
    getOverview: async () => local.getOverview(),
    listExperiments: async (limit) => local.listExperiments(limit),
    listTasks: async () => local.listTasks(),
    getGraph: async () => local.getGraph(),
    createExperience: async (input) => local.createExperience(input)
  };
  const server = http.createServer(createRequestHandler(asyncStore, {
    llm: {
      apiKey: 'test-secret',
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '依据相似工业视觉任务，可复用预训练模型与分阶段微调经验，并在新数据上独立验证。' } }] }), { status: 200 })
    }
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const overview = await fetch(`${baseUrl}/api/overview`).then((response) => response.json());
    assert.equal(overview.tasks, 9);
    const result = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '钢材缺陷分类', description: '工业图像缺陷分类', modality: 'image', dataScale: 'small', domain: '工业制造', taskType: '图像分类' })
    }).then((response) => response.json());
    assert.equal(result.recommendation.modelName, 'ResNet-50');
    assert.equal(result.aiStatus, 'enabled');
    assert.match(result.aiSummary, /相似工业视觉任务/);
  } finally {
    server.close();
    await once(server, 'close');
    local.close();
  }
});

test('Vercel 缺少数据库配置时返回明确提示且不泄露内部信息', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const response = {
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(body) { this.body = body; }
  };
  try {
    await handleVercel({ url: '/api/health', method: 'GET' }, response);
    assert.equal(response.status, 500);
    assert.match(JSON.parse(response.body).error, /DATABASE_URL/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('所有 Vercel API 入口均可加载', () => {
  ['health', 'overview', 'experiments', 'graph', 'recommend'].forEach((name) => {
    assert.equal(typeof require(`../api/${name}`), 'function');
  });
});
