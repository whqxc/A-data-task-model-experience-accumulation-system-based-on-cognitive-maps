function buildGraph(tasks, experiments) {
  const nodes = [];
  const links = [];
  const modelIds = new Set();
  tasks.forEach((task) => {
    nodes.push({ id: task.id, type: 'task', label: task.name, subtitle: task.task_type });
    nodes.push({ id: task.dataset_id, type: 'dataset', label: task.dataset_name, subtitle: `${Number(task.dataset_size).toLocaleString()} 条样本` });
    links.push({ source: task.dataset_id, target: task.id, type: 'supports' });
  });
  experiments.forEach((experiment) => {
    if (!modelIds.has(experiment.model_id)) {
      modelIds.add(experiment.model_id);
      nodes.push({ id: experiment.model_id, type: 'model', label: experiment.model_name, subtitle: experiment.model_family });
    }
    if (!links.some((link) => link.source === experiment.task_id && link.target === experiment.model_id)) {
      links.push({ source: experiment.task_id, target: experiment.model_id, type: 'evaluated' });
    }
  });
  return { nodes, links };
}

module.exports = { buildGraph };
