const MODALITY_LABELS = { image: '图像', text: '文本', tabular: '表格' };
const SCALE_LABELS = { small: '小样本', medium: '中规模', large: '大规模' };
const SCALE_ORDER = ['small', 'medium', 'large'];
const SYNONYMS = [
  [/图片|影像|视觉/g, '图像'],
  [/瑕疵|缺损/g, '缺陷'],
  [/辨别|识别/g, '分类'],
  [/客户|用户/g, '客户'],
  [/小数据|少样本/g, '小样本'],
  [/情感分析/g, '情感分类'],
  [/预测风险/g, '风险预测']
];

function tokenize(value) {
  let text = String(value || '').toLowerCase();
  SYNONYMS.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
  const tokens = new Set();
  const parts = text.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  parts.forEach((part) => {
    if (/^[\u4e00-\u9fff]+$/.test(part)) {
      if (part.length <= 3) tokens.add(part);
      for (let index = 0; index < part.length - 1; index += 1) {
        tokens.add(part.slice(index, index + 2));
      }
    } else {
      tokens.add(part);
    }
  });
  return tokens;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach((token) => { if (right.has(token)) intersection += 1; });
  return intersection / (left.size + right.size - intersection);
}

function calculateSimilarity(input, task) {
  const textScore = jaccard(
    tokenize(`${input.name} ${input.description || ''} ${input.taskType}`),
    tokenize(`${task.name} ${task.description} ${task.task_type}`)
  );
  const modalityScore = input.modality === task.modality ? 1 : 0;
  const typeScore = input.taskType === task.task_type ? 1 : 0;
  const domainScore = input.domain === task.domain ? 1 : 0;
  const scaleDistance = Math.abs(SCALE_ORDER.indexOf(input.dataScale) - SCALE_ORDER.indexOf(task.data_scale));
  const scaleScore = scaleDistance === 0 ? 1 : scaleDistance === 1 ? 0.5 : 0;
  const score = Math.round((modalityScore * 0.3 + typeScore * 0.2 + domainScore * 0.15 + scaleScore * 0.1 + textScore * 0.25) * 100);
  const reasons = [];
  if (modalityScore) reasons.push(`同为${MODALITY_LABELS[task.modality]}任务`);
  if (typeScore) reasons.push(`任务类型均为${task.task_type}`);
  if (domainScore) reasons.push(`同属${task.domain}领域`);
  if (scaleScore === 1) reasons.push(`数据规模均为${SCALE_LABELS[task.data_scale]}`);
  if (textScore >= 0.2 && !typeScore) reasons.push('任务描述具有较高文本相似度');
  return { score, reasons, components: { modalityScore, typeScore, domainScore, scaleScore, textScore } };
}

function recommend(input, tasks, experiments) {
  const similarTasks = tasks
    .map((task) => ({ ...task, ...calculateSimilarity(input, task) }))
    .filter((task) => task.score >= 25)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  const candidates = [];
  similarTasks.forEach((task) => {
    experiments
      .filter((experiment) => experiment.task_id === task.id && experiment.status === 'success')
      .forEach((experiment) => {
        candidates.push({
          ...experiment,
          similarity: task.score,
          sourceTaskName: task.name,
          sourceTaskType: task.task_type,
          sourceDomain: task.domain,
          datasetPreprocessing: task.preprocessing,
          rankScore: Math.round((task.score * 0.75 + experiment.score * 0.25) * 10) / 10
        });
      });
  });
  candidates.sort((left, right) => right.rankScore - left.rankScore);

  const taskResults = similarTasks.map((task) => {
    const related = experiments
      .filter((experiment) => experiment.task_id === task.id)
      .sort((left, right) => right.score - left.score);
    const best = related.find((experiment) => experiment.status === 'success') || related[0];
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      domain: task.domain,
      modality: task.modality,
      taskType: task.task_type,
      dataScale: task.data_scale,
      datasetName: task.dataset_name,
      datasetSize: task.dataset_size,
      similarity: task.score,
      reasons: task.reasons,
      bestModel: best?.model_name || '暂无实验',
      bestScore: best?.score ?? null,
      metric: task.metric
    };
  });

  if (!candidates.length) {
    return {
      recommendation: null,
      similarTasks: taskResults,
      alternatives: [],
      experiences: [],
      risks: collectRisks(similarTasks, experiments),
      message: '当前经验库中没有可复用的成功实验。可以先录入一次实验，再获得有依据的推荐。'
    };
  }

  const primary = candidates[0];
  const evidenceStrength = Math.round(Math.min(95, primary.similarity * 0.85 + Math.min(candidates.length, 3) / 3 * 15));
  const recommendation = {
    modelName: primary.model_name,
    modelFamily: primary.model_family,
    pretrained: Boolean(primary.pretrained),
    sourceTaskId: primary.task_id,
    sourceTaskName: primary.sourceTaskName,
    sourceScore: primary.score,
    metric: primary.metric,
    similarity: primary.similarity,
    evidenceStrength,
    reasons: similarTasks.find((task) => task.id === primary.task_id)?.reasons || [],
    plan: {
      preprocessing: primary.datasetPreprocessing,
      pretrained: primary.pretrained ? '加载同源预训练权重，再针对当前数据微调' : '从头训练，并保留一个简单模型作为基线',
      learningRate: primary.learning_rate,
      batchSize: primary.batch_size,
      epochs: primary.epochs,
      optimizer: primary.optimizer,
      trainingTime: primary.training_time,
      note: primary.notes
    }
  };

  return {
    recommendation,
    similarTasks: taskResults,
    alternatives: candidates.slice(1, 4).map((candidate) => ({
      modelName: candidate.model_name,
      sourceTaskName: candidate.sourceTaskName,
      score: candidate.score,
      metric: candidate.metric,
      similarity: candidate.similarity
    })),
    experiences: candidates.slice(0, 3).map((candidate) => ({
      taskName: candidate.sourceTaskName,
      modelName: candidate.model_name,
      score: candidate.score,
      metric: candidate.metric,
      note: candidate.notes
    })),
    risks: collectRisks(similarTasks, experiments),
    message: `基于 ${similarTasks.length} 个相似历史任务和 ${candidates.length} 次成功实验生成，推荐结果是训练起点，不是效果保证。`
  };
}

function collectRisks(similarTasks, experiments) {
  const taskIds = new Set(similarTasks.map((task) => task.id));
  return experiments
    .filter((experiment) => taskIds.has(experiment.task_id) && experiment.status === 'failed')
    .slice(0, 3)
    .map((experiment) => ({
      taskName: experiment.task_name,
      modelName: experiment.model_name,
      note: experiment.notes
    }));
}

module.exports = { calculateSimilarity, recommend, tokenize };
