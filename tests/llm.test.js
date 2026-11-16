const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enrichRecommendation, DEFAULT_API_URL, DEFAULT_MODEL } = require('../src/llm');

const input = { name: '轴承缺陷分类', description: '工业图像分类', domain: '工业制造', modality: 'image', taskType: '图像分类', dataScale: 'small' };
const localResult = {
  recommendation: { modelName: 'ResNet-50', sourceTaskName: '钢铁表面缺陷识别', plan: { learningRate: 0.0001 } },
  similarTasks: [{ name: '钢铁表面缺陷识别', similarity: 90 }],
  experiences: [{ note: '先冻结骨干网络，再整体微调' }],
  risks: [{ note: '过大学习率导致过拟合' }]
};

test('未配置密钥时不调用外部接口', async () => {
  let called = false;
  const result = await enrichRecommendation(input, localResult, { apiKey: '', fetchImpl: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.aiStatus, 'not_configured');
  assert.equal(result.aiSummary, null);
});

test('按学校接口格式发送鉴权请求并返回经验解读', async () => {
  let request;
  const result = await enrichRecommendation(input, localResult, {
    apiKey: 'test-secret',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: '历史相似任务支持从 ResNet-50 开始，先复用冻结骨干网络再微调的方案，并在当前数据上重新验证指标。' } }] }), { status: 200 });
    }
  });
  assert.equal(request.url, DEFAULT_API_URL);
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[1].content, /ResNet-50/);
  assert.equal(result.aiStatus, 'enabled');
  assert.match(result.aiSummary, /ResNet-50/);
});

test('外部接口失败时保留本地推荐并明确降级', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await enrichRecommendation(input, localResult, {
      apiKey: 'test-secret', fetchImpl: async () => new Response('unavailable', { status: 503 })
    });
    assert.equal(result.aiStatus, 'unavailable');
    assert.equal(result.aiSummary, null);
    assert.equal(result.recommendation.modelName, 'ResNet-50');
  } finally {
    console.error = originalError;
  }
});
