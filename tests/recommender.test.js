const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ExperienceStore } = require('../src/database');
const { calculateSimilarity, recommend } = require('../src/recommender');

let store;
before(() => { store = new ExperienceStore(':memory:'); });
after(() => store.close());

test('示例经验库包含完整的任务、数据、模型和实验关联', () => {
  const overview = store.getOverview();
  assert.equal(overview.tasks, 9);
  assert.equal(overview.datasets, 9);
  assert.equal(overview.models, 13);
  assert.equal(overview.experiments, 13);
  assert.ok(overview.successRate > 0);
  const graph = store.getGraph();
  assert.ok(graph.nodes.some((node) => node.type === 'task'));
  assert.ok(graph.links.some((link) => link.type === 'supports'));
  assert.ok(graph.links.some((link) => link.type === 'evaluated'));
});

test('相同任务特征的相似度高于不同模态任务', () => {
  const steel = store.listTasks().find((task) => task.id === 'task-steel');
  const input = { name: '钢材缺陷分类', description: '工业图像缺陷识别', modality: 'image', dataScale: 'small', domain: '工业制造', taskType: '图像分类' };
  const same = calculateSimilarity(input, steel);
  const different = calculateSimilarity(input, { ...steel, modality: 'text', task_type: '文本分类', domain: '法律合同' });
  assert.ok(same.score >= 75);
  assert.ok(same.score > different.score);
  assert.ok(same.reasons.includes('同为图像任务'));
});

test('工业小样本缺陷任务推荐有历史证据的 ResNet-50', () => {
  const result = recommend({
    name: '轴承表面缺陷分类', description: '少量工业质检图像中的裂纹与磨损分类', modality: 'image', dataScale: 'small', domain: '工业制造', taskType: '图像分类'
  }, store.listTasks(), store.listExperiments());
  assert.equal(result.recommendation.modelName, 'ResNet-50');
  assert.equal(result.recommendation.sourceTaskName, '钢铁表面缺陷识别');
  assert.equal(result.recommendation.plan.learningRate, 0.0001);
  assert.ok(result.similarTasks.length > 0);
  assert.ok(result.risks.some((risk) => risk.modelName === 'ViT-B/16'));
});

test('没有成功实验时明确拒绝生成无依据推荐', () => {
  const tasks = store.listTasks().filter((task) => task.id === 'task-steel');
  const result = recommend({ name: '钢材缺陷分类', description: '工业图像分类', modality: 'image', dataScale: 'small', domain: '工业制造', taskType: '图像分类' }, tasks, []);
  assert.equal(result.recommendation, null);
  assert.match(result.message, /没有可复用的成功实验/);
});
