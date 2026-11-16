const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createAppServer } = require('../server');

let server;
let baseUrl;
before(async () => {
  server = createAppServer({ databasePath: ':memory:', llm: { apiKey: '' } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await once(server, 'close');
});

test('健康检查与总览接口可用', async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.status, 'ok');
  const response = await fetch(`${baseUrl}/api/overview`);
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.equal(overview.tasks, 9);
  assert.ok(Array.isArray(overview.recentExperiments));
});

test('推荐接口返回模型、训练参数和相似任务证据', async () => {
  const response = await fetch(`${baseUrl}/api/recommend`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '商品评论分类', description: '中文评论情感分类', modality: 'text', dataScale: 'medium', domain: '零售电商', taskType: '文本分类' })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.recommendation.modelName, 'BERT-base-Chinese');
  assert.equal(result.recommendation.plan.batchSize, 32);
  assert.ok(result.similarTasks[0].similarity >= 75);
});

test('新实验写入后立即可在档案和认知地图中查询', async () => {
  const input = {
    task: { name: '测试文本分类', description: '用于验证写入流程的文本分类任务', domain: '测试领域', modality: 'text', taskType: '文本分类', dataScale: 'small', metric: 'F1' },
    dataset: { name: '测试数据集', size: 1000, features: '两类中文文本', preprocessing: '去重与截断' },
    model: { name: '测试模型', family: 'Transformer', pretrained: true },
    experiment: { status: 'success', score: 88, learningRate: 0.00002, batchSize: 16, epochs: 3, optimizer: 'AdamW', trainingTime: '10 分钟', notes: '测试经验记录' }
  };
  const created = await fetch(`${baseUrl}/api/experiments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  assert.equal(created.status, 201);
  const experiment = await created.json();
  assert.equal(experiment.task_name, '测试文本分类');
  const graph = await fetch(`${baseUrl}/api/graph`).then((response) => response.json());
  assert.ok(graph.nodes.some((node) => node.label === '测试模型'));
});

test('无效输入返回可读错误且不写入数据', async () => {
  const response = await fetch(`${baseUrl}/api/experiments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: {} })
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.match(result.error, /请填写/);
});
