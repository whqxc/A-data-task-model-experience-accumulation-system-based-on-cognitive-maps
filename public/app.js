const state = { overview: null, experiments: [], graph: null };
const modalityLabels = { image: '图像', text: '文本', tabular: '表格' };
const scaleLabels = { small: '小样本', medium: '中规模', large: '大规模' };
const pageTitles = { overview: '经验总览', recommend: '智能推荐', record: '沉淀新经验', archive: '实验档案' };
let toastTimer;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function truncate(value, length = 13) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

function showToast(message, error = false) {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function switchView(viewName) {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${viewName}`));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  document.getElementById('pageTitle').textContent = pageTitles[viewName];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadAll() {
  const [overview, experiments, graph] = await Promise.all([
    api('/api/overview'), api('/api/experiments'), api('/api/graph')
  ]);
  state.overview = overview;
  state.experiments = experiments;
  state.graph = graph;
  renderOverview();
  renderArchive();
}

function renderOverview() {
  const overview = state.overview;
  document.getElementById('statTasks').textContent = overview.tasks;
  document.getElementById('statDatasets').textContent = overview.datasets;
  document.getElementById('statModels').textContent = overview.models;
  document.getElementById('statSuccessRate').textContent = `${overview.successRate}%`;
  document.getElementById('statExperiments').textContent = `共 ${overview.experiments} 次实验`;
  document.getElementById('navExperimentCount').textContent = overview.experiments;
  document.getElementById('recentExperiments').innerHTML = overview.recentExperiments.map((experiment) => `
    <div class="recent-item">
      <div class="recent-model-icon">${escapeHtml(experiment.model_name.slice(0, 1))}</div>
      <div class="recent-main"><strong>${escapeHtml(experiment.task_name)}</strong><p>${escapeHtml(experiment.model_name)} · ${escapeHtml(experiment.dataset_name)}</p></div>
      <div class="recent-score ${experiment.status}"><strong>${experiment.score}%</strong><span>${escapeHtml(experiment.metric)}</span></div>
    </div>`).join('');
  renderGraph();
}

function renderGraph() {
  const { nodes, links } = state.graph;
  const groups = { dataset: [], task: [], model: [] };
  nodes.forEach((node) => groups[node.type]?.push(node));
  const spacing = 50;
  const height = Math.max(...Object.values(groups).map((group) => group.length)) * spacing + 70;
  const columns = { dataset: 20, task: 360, model: 700 };
  const positions = {};
  Object.entries(groups).forEach(([type, group]) => {
    const groupHeight = (group.length - 1) * spacing + 40;
    const offset = (height - groupHeight) / 2 + 25;
    group.forEach((node, index) => {
      positions[node.id] = { x: columns[type], y: offset + index * spacing, width: 180, height: 40 };
    });
  });
  const paths = links.map((link) => {
    const source = positions[link.source];
    const target = positions[link.target];
    if (!source || !target) return '';
    const x1 = source.x + source.width;
    const y1 = source.y + source.height / 2;
    const x2 = target.x;
    const y2 = target.y + target.height / 2;
    const middle = (x1 + x2) / 2;
    return `<path class="graph-link ${link.type}" d="M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}"/>`;
  }).join('');
  const labels = `<text class="graph-column-label" x="30" y="20">DATA / 数据</text><text class="graph-column-label" x="370" y="20">TASK / 任务</text><text class="graph-column-label" x="710" y="20">MODEL / 模型</text>`;
  const nodeMarkup = nodes.map((node) => {
    const position = positions[node.id];
    return `<g class="graph-node ${node.type}" transform="translate(${position.x}, ${position.y})"><title>${escapeHtml(node.label)} · ${escapeHtml(node.subtitle)}</title><rect width="180" height="40" rx="7"/><text class="node-title" x="11" y="16">${escapeHtml(truncate(node.label, 15))}</text><text class="node-subtitle" x="11" y="30">${escapeHtml(truncate(node.subtitle, 23))}</text></g>`;
  }).join('');
  const svg = document.getElementById('cognitiveGraph');
  svg.setAttribute('viewBox', `0 0 900 ${height}`);
  svg.innerHTML = labels + paths + nodeMarkup;
}

function renderArchive() {
  const query = document.getElementById('archiveSearch').value.trim().toLowerCase();
  const modality = document.getElementById('archiveModality').value;
  const status = document.getElementById('archiveStatus').value;
  const filtered = state.experiments.filter((experiment) => {
    const searchable = `${experiment.task_name} ${experiment.model_name} ${experiment.dataset_name}`.toLowerCase();
    return (!query || searchable.includes(query)) && (modality === 'all' || experiment.modality === modality) && (status === 'all' || experiment.status === status);
  });
  document.getElementById('archiveCount').textContent = `${filtered.length} 条记录`;
  document.getElementById('archiveEmpty').hidden = filtered.length > 0;
  document.getElementById('experimentTableBody').innerHTML = filtered.map((experiment) => `
    <tr data-experiment-id="${escapeHtml(experiment.id)}">
      <td class="task-cell"><strong>${escapeHtml(experiment.task_name)}</strong><small>${escapeHtml(experiment.dataset_name)} · ${Number(experiment.dataset_size).toLocaleString()} 条</small></td>
      <td class="model-cell"><strong>${escapeHtml(experiment.model_name)}</strong><small>${escapeHtml(experiment.model_family)}</small></td>
      <td><span class="modality-pill ${experiment.modality}">${modalityLabels[experiment.modality]}</span></td>
      <td class="score-cell"><strong>${experiment.score}</strong><small>${escapeHtml(experiment.metric)}</small></td>
      <td><span class="status-pill ${experiment.status}">${experiment.status === 'success' ? '成功' : '未达预期'}</span></td>
      <td>${formatDate(experiment.created_at)}</td><td class="row-arrow">›</td>
    </tr>`).join('');
}

const recommendationSamples = {
  steel: { name: '轴承表面缺陷分类', description: '在少量轴承质检图像中识别裂纹、磨损和点蚀，希望获得一个稳定的小样本训练起点。', modality: 'image', dataScale: 'small', domain: '工业制造', taskType: '图像分类' },
  review: { name: '售后评论情感分析', description: '对中文售后评论进行正面、负面和中性分类，文本长度不一，需要兼顾准确率与训练成本。', modality: 'text', dataScale: 'medium', domain: '零售电商', taskType: '文本分类' },
  churn: { name: '会员流失预警', description: '根据会员消费和活跃行为预测流失风险，数据为包含类别字段的结构化宽表。', modality: 'tabular', dataScale: 'medium', domain: '零售电商', taskType: '二分类' }
};

function fillRecommendationSample(key) {
  const sample = recommendationSamples[key];
  const form = document.getElementById('recommendForm');
  Object.entries(sample).forEach(([field, value]) => { form.elements[field].value = value; });
}

async function submitRecommendation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('recommendButton');
  const input = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  button.innerHTML = '正在检索历史经验…';
  try {
    const result = await api('/api/recommend', { method: 'POST', body: JSON.stringify(input) });
    renderRecommendation(result);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = '<svg viewBox="0 0 24 24"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/></svg>查找经验并生成推荐<span>→</span>';
  }
}

function renderRecommendation(result) {
  document.getElementById('recommendEmpty').hidden = true;
  const container = document.getElementById('recommendationResults');
  container.hidden = false;
  const similarTasks = result.similarTasks.length ? `
    <article class="card result-section"><div class="result-section-header"><h2>相似历史任务</h2><span>按多维度相似度排序</span></div><div class="similar-list">${result.similarTasks.map((task, index) => `
      <div class="similar-item"><div class="similar-top"><span class="similar-rank">0${index + 1}</span><strong>${escapeHtml(task.name)}</strong><span class="similarity-score">${task.similarity}%</span></div><div class="similar-meta">${escapeHtml(task.domain)} · ${escapeHtml(task.taskType)} · ${scaleLabels[task.dataScale]}　|　历史最优 ${escapeHtml(task.bestModel)} ${task.bestScore ?? '—'} ${escapeHtml(task.metric)}</div><div class="similar-reasons">${task.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join('')}</div></div>`).join('')}</div></article>` : '';
  const risks = result.risks.length ? `
    <article class="card result-section risk-section"><div class="result-section-header"><h2>历史失败经验提醒</h2><span>避免重复踩坑</span></div>${result.risks.map((risk) => `<div class="risk-item"><span class="risk-icon">△</span><div><strong>${escapeHtml(risk.taskName)} · ${escapeHtml(risk.modelName)}</strong><p>${escapeHtml(risk.note)}</p></div></div>`).join('')}</article>` : '';
  if (!result.recommendation) {
    container.innerHTML = `<div class="result-stack"><article class="card empty-card"><h2>暂时没有可复用的成功实验</h2><p>${escapeHtml(result.message)}</p><button class="button button-primary" data-go="record" style="margin-top:20px">录入一次实验</button></article>${similarTasks}${risks}</div>`;
    return;
  }
  const recommendation = result.recommendation;
  const plan = recommendation.plan;
  const alternatives = result.alternatives.length ? `<div class="plan-detail"><span>备选模型</span><p>${result.alternatives.map((item) => `${escapeHtml(item.modelName)}（来自${escapeHtml(item.sourceTaskName)}，${item.score} ${escapeHtml(item.metric)}）`).join('；')}</p></div>` : '';
  const experiences = result.experiences.length ? `
    <article class="card result-section"><div class="result-section-header"><h2>自动提炼的适配经验</h2><span>来自成功实验原始记录</span></div>${result.experiences.map((experience) => `<div class="experience-item"><strong>${escapeHtml(experience.modelName)} · ${experience.score} ${escapeHtml(experience.metric)}</strong><p>${escapeHtml(experience.note)}</p><small>来源：${escapeHtml(experience.taskName)}</small></div>`).join('')}</article>` : '';
  const aiInterpretation = result.aiSummary ? `
    <article class="card result-section ai-summary"><div class="result-section-header"><h2>学校大模型 · 经验解读</h2><span>${escapeHtml(result.aiModel)} · 仅依据上方历史证据</span></div><p>${escapeHtml(result.aiSummary)}</p></article>` : result.aiStatus === 'unavailable' ? `
    <article class="card result-section ai-summary fallback"><div class="result-section-header"><h2>本地经验推荐</h2><span>学校大模型暂时不可用，已自动降级</span></div></article>` : '';
  container.innerHTML = `<div class="result-stack">
    <article class="card result-primary"><div class="result-label"><span>RECOMMENDED STARTING POINT</span><span class="soft-badge">历史证据驱动</span></div><div class="result-top"><div class="model-emblem">${escapeHtml(recommendation.modelName.slice(0, 1))}</div><div class="result-model"><h2>${escapeHtml(recommendation.modelName)}</h2><p>${escapeHtml(recommendation.modelFamily)} · ${recommendation.pretrained ? '使用预训练权重' : '从头训练'}</p></div><div class="confidence"><strong>${recommendation.evidenceStrength}%</strong><span>推荐依据强度</span></div></div><div class="evidence-chips">${recommendation.reasons.map((reason) => `<span>✓ ${escapeHtml(reason)}</span>`).join('')}</div><div class="result-source">主要依据：相似任务 <strong>${escapeHtml(recommendation.sourceTaskName)}</strong>（相似度 ${recommendation.similarity}%）中的成功实验，历史 ${escapeHtml(recommendation.metric)} 为 <strong>${recommendation.sourceScore}</strong>。</div></article>
    <article class="card result-section"><div class="result-section-header"><h2>建议训练方案</h2><span>作为首轮实验起点</span></div><div class="plan-grid"><div class="plan-parameter"><span>学习率</span><strong>${plan.learningRate}</strong></div><div class="plan-parameter"><span>批大小</span><strong>${plan.batchSize}</strong></div><div class="plan-parameter"><span>训练轮数</span><strong>${plan.epochs}</strong></div><div class="plan-parameter"><span>优化器</span><strong>${escapeHtml(plan.optimizer)}</strong></div></div><div class="plan-details"><div class="plan-detail"><span>数据处理</span><p>${escapeHtml(plan.preprocessing)}</p></div><div class="plan-detail"><span>模型初始化</span><p>${escapeHtml(plan.pretrained)}</p></div><div class="plan-detail"><span>适配经验</span><p>${escapeHtml(plan.note)}</p></div><div class="plan-detail"><span>参考耗时</span><p>${escapeHtml(plan.trainingTime)}（受硬件与数据规模影响）</p></div>${alternatives}</div></article>
    ${aiInterpretation}${similarTasks}${experiences}${risks}<p class="recommend-disclaimer">${escapeHtml(result.message)} “推荐依据强度”表示历史证据的匹配程度，不代表新任务的预期准确率。</p>
  </div>`;
}

const recordSample = {
  taskName: '轴承表面缺陷分类', taskDomain: '工业制造', taskDescription: '在少量轴承质检图像中识别裂纹、磨损和点蚀，验证预训练模型的迁移效果。', taskModality: 'image', taskType: '图像分类', taskScale: 'small', taskMetric: 'F1', datasetName: '轴承质检图像集', datasetSize: 5000, datasetFeatures: '3 类表面缺陷，224×224 RGB 图像', preprocessing: '尺寸归一化、随机旋转、随机水平翻转', modelName: 'ResNet-50', modelFamily: 'CNN', experimentStatus: 'success', experimentScore: 91.5, learningRate: 0.0001, batchSize: 32, epochs: 30, optimizer: 'AdamW', trainingTime: '45 分钟', experimentNotes: '先冻结骨干网络训练 5 轮，再整体微调；轻度数据增强在小样本上更稳定。'
};

function fillRecordForm() {
  const form = document.getElementById('recordForm');
  Object.entries(recordSample).forEach(([name, value]) => { form.elements[name].value = value; });
  form.elements.pretrained.checked = true;
  showToast('示例已填入，可直接修改或提交');
}

async function saveExperience(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const input = {
    task: { name: data.taskName, description: data.taskDescription, domain: data.taskDomain, modality: data.taskModality, taskType: data.taskType, dataScale: data.taskScale, metric: data.taskMetric },
    dataset: { name: data.datasetName, size: data.datasetSize, features: data.datasetFeatures, preprocessing: data.preprocessing },
    model: { name: data.modelName, family: data.modelFamily, pretrained: form.elements.pretrained.checked },
    experiment: { status: data.experimentStatus, score: data.experimentScore, learningRate: data.learningRate, batchSize: data.batchSize, epochs: data.epochs, optimizer: data.optimizer, trainingTime: data.trainingTime, notes: data.experimentNotes }
  };
  const button = document.getElementById('saveExperienceButton');
  button.disabled = true;
  button.textContent = '正在写入经验库…';
  try {
    await api('/api/experiments', { method: 'POST', body: JSON.stringify(input) });
    form.reset();
    await loadAll();
    switchView('archive');
    showToast('实验已沉淀，认知地图与推荐经验同步更新');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = '沉淀到经验库 <span>→</span>';
  }
}

function openExperiment(id) {
  const experiment = state.experiments.find((item) => item.id === id);
  if (!experiment) return;
  document.getElementById('dialogContent').innerHTML = `
    <span class="dialog-eyebrow">EXPERIMENT EVIDENCE</span><h2 class="dialog-title">${escapeHtml(experiment.task_name)}</h2><p class="dialog-subtitle">${escapeHtml(experiment.description)}</p>
    <div class="dialog-score-row"><div class="dialog-score-box"><span>实验模型</span><strong>${escapeHtml(experiment.model_name)}</strong></div><div class="dialog-score-box"><span>实验结果</span><strong>${experiment.score} ${escapeHtml(experiment.metric)}</strong></div><div class="dialog-score-box"><span>状态</span><strong>${experiment.status === 'success' ? '成功' : '未达预期'}</strong></div></div>
    <div class="detail-grid"><div class="detail-item"><span>应用领域 / 任务类型</span><p>${escapeHtml(experiment.domain)} · ${escapeHtml(experiment.task_type)}</p></div><div class="detail-item"><span>数据模态 / 数据规模</span><p>${modalityLabels[experiment.modality]} · ${scaleLabels[experiment.data_scale]}</p></div><div class="detail-item full"><span>数据集</span><p>${escapeHtml(experiment.dataset_name)}（${Number(experiment.dataset_size).toLocaleString()} 条）<br>${escapeHtml(experiment.dataset_features)}</p></div><div class="detail-item full"><span>数据预处理</span><p>${escapeHtml(experiment.preprocessing)}</p></div><div class="detail-item"><span>训练参数</span><p>学习率 ${experiment.learning_rate} · 批大小 ${experiment.batch_size}<br>${experiment.epochs} 轮 · ${escapeHtml(experiment.optimizer)}</p></div><div class="detail-item"><span>模型信息</span><p>${escapeHtml(experiment.model_family)}<br>${experiment.pretrained ? '使用预训练权重' : '未使用预训练权重'} · ${escapeHtml(experiment.training_time)}</p></div></div>
    <div class="dialog-note"><strong>沉淀的适配经验</strong><p>${escapeHtml(experiment.notes)}</p></div>`;
  document.getElementById('experimentDialog').showModal();
}

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) switchView(viewButton.dataset.view);
  const goButton = event.target.closest('[data-go]');
  if (goButton) switchView(goButton.dataset.go);
  const sampleButton = event.target.closest('[data-sample]');
  if (sampleButton) fillRecommendationSample(sampleButton.dataset.sample);
  const row = event.target.closest('[data-experiment-id]');
  if (row) openExperiment(row.dataset.experimentId);
});

document.getElementById('recommendForm').addEventListener('submit', submitRecommendation);
document.getElementById('recordForm').addEventListener('submit', saveExperience);
document.getElementById('fillRecordSample').addEventListener('click', fillRecordForm);
document.getElementById('showMapButton').addEventListener('click', () => document.getElementById('mapSection').scrollIntoView({ behavior: 'smooth', block: 'center' }));
document.getElementById('refreshButton').addEventListener('click', async () => {
  try { await loadAll(); showToast('经验库已刷新'); } catch (error) { showToast(error.message, true); }
});
['archiveSearch', 'archiveModality', 'archiveStatus'].forEach((id) => {
  document.getElementById(id).addEventListener(id === 'archiveSearch' ? 'input' : 'change', renderArchive);
});
document.getElementById('closeDialog').addEventListener('click', () => document.getElementById('experimentDialog').close());
document.getElementById('experimentDialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

fillRecommendationSample('steel');
loadAll().catch((error) => showToast(`经验库加载失败：${error.message}`, true));
