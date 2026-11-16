const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { buildGraph } = require('./graph');

class ExperienceStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (filename !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        features TEXT NOT NULL,
        preprocessing TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        domain TEXT NOT NULL,
        modality TEXT NOT NULL,
        task_type TEXT NOT NULL,
        data_scale TEXT NOT NULL,
        metric TEXT NOT NULL,
        dataset_id TEXT NOT NULL REFERENCES datasets(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        family TEXT NOT NULL,
        pretrained INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        model_id TEXT NOT NULL REFERENCES models(id),
        status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
        score REAL NOT NULL,
        learning_rate REAL NOT NULL,
        batch_size INTEGER NOT NULL,
        epochs INTEGER NOT NULL,
        optimizer TEXT NOT NULL,
        training_time TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_experiments_task ON experiments(task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_modality ON tasks(modality);
    `);
    const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM tasks').get();
    if (count === 0) this.seed();
  }

  seed() {
    const datasets = [
      ['ds-steel', '钢材质检图像集', 6800, '6 类表面缺陷，224×224 RGB 图像', '尺寸归一化、随机翻转、随机擦除'],
      ['ds-pcb', 'PCB 缺陷检测集', 4200, '焊点与线路缺陷，带边界框标注', 'Mosaic 增强、尺度变换、色彩扰动'],
      ['ds-review', '中文商品评论集', 56000, '正面、负面、中性三类评论', '去重、清洗 HTML、长度截断至 256'],
      ['ds-log', '设备运维日志集', 32000, '12 类设备故障日志文本', '脱敏、分词、长度截断至 384'],
      ['ds-churn', '客户行为宽表', 48000, '86 个行为与账户特征，含类别特征', '缺失值填充、类别编码、分箱处理'],
      ['ds-sensor', '设备传感器时序宽表', 9600, '32 个传感器统计特征，异常样本占 8%', '滑动窗口统计、鲁棒缩放、异常值截断'],
      ['ds-remote', '遥感土地覆盖影像集', 120000, '10 类土地覆盖，多光谱图像', '通道标准化、随机旋转、裁剪至 224×224'],
      ['ds-chest', '胸部 X 光筛查集', 5200, '肺炎与正常两类，含脱敏影像', '直方图均衡化、 resize、轻度旋转'],
      ['ds-contract', '中文合同标注集', 18000, '甲乙方、金额、日期等 8 类实体', '条款切分、实体对齐、长度截断至 512']
    ];
    const tasks = [
      ['task-steel', '钢铁表面缺陷识别', '识别钢材表面的裂纹、划痕和凹坑等缺陷，重点关注小样本条件下的稳定分类。', '工业制造', 'image', '图像分类', 'small', 'F1', 'ds-steel', '2026-10-08T09:00:00.000Z'],
      ['task-pcb', 'PCB 微小缺陷检测', '定位电路板中的微小焊点和线路缺陷，兼顾漏检率与推理速度。', '工业制造', 'image', '目标检测', 'small', 'mAP', 'ds-pcb', '2026-10-11T09:00:00.000Z'],
      ['task-review', '商品评论情感分类', '将中文商品评论划分为正面、负面和中性，作为客服分析的基础能力。', '零售电商', 'text', '文本分类', 'medium', 'Accuracy', 'ds-review', '2026-10-14T09:00:00.000Z'],
      ['task-log', '设备故障日志分类', '根据设备运维日志识别故障类型，文本包含较多工业术语与缩写。', '工业制造', 'text', '文本分类', 'medium', 'F1', 'ds-log', '2026-10-17T09:00:00.000Z'],
      ['task-churn', '客户流失风险预测', '基于客户账户与行为特征预测流失风险，输出可比较的 AUC 指标。', '零售电商', 'tabular', '二分类', 'medium', 'AUC', 'ds-churn', '2026-10-20T09:00:00.000Z'],
      ['task-sensor', '工业设备异常识别', '使用传感器统计特征识别少数异常设备状态，关注类别不均衡问题。', '工业制造', 'tabular', '异常检测', 'small', 'AUC', 'ds-sensor', '2026-10-23T09:00:00.000Z'],
      ['task-remote', '遥感土地覆盖分类', '对多光谱遥感影像进行土地覆盖分类，训练数据规模较大。', '遥感测绘', 'image', '图像分类', 'large', 'Accuracy', 'ds-remote', '2026-10-26T09:00:00.000Z'],
      ['task-chest', '医疗影像肺炎筛查', '在有限脱敏 X 光影像上进行肺炎二分类，优先保证模型泛化能力。', '医疗健康', 'image', '图像分类', 'small', 'AUC', 'ds-chest', '2026-10-29T09:00:00.000Z'],
      ['task-contract', '合同关键信息抽取', '从中文合同中抽取主体、金额和日期等结构化实体。', '法律合同', 'text', '命名实体识别', 'medium', 'F1', 'ds-contract', '2026-11-01T09:00:00.000Z']
    ];
    const models = [
      ['model-resnet50', 'ResNet-50', 'CNN', 1],
      ['model-vit', 'ViT-B/16', 'Transformer', 1],
      ['model-yolo', 'YOLOv8s', 'One-stage Detector', 1],
      ['model-faster', 'Faster R-CNN', 'Two-stage Detector', 1],
      ['model-bert', 'BERT-base-Chinese', 'Transformer', 1],
      ['model-textcnn', 'TextCNN', 'CNN', 0],
      ['model-roberta', 'Chinese RoBERTa-wwm', 'Transformer', 1],
      ['model-xgboost', 'XGBoost', 'Gradient Boosting', 0],
      ['model-mlp', 'MLP', 'Neural Network', 0],
      ['model-iforest', 'Isolation Forest', 'Unsupervised Ensemble', 0],
      ['model-swin', 'Swin-Tiny', 'Transformer', 1],
      ['model-densenet', 'DenseNet-121', 'CNN', 1],
      ['model-roberta-crf', 'RoBERTa + CRF', 'Transformer + CRF', 1]
    ];
    const experiments = [
      ['exp-steel-resnet', 'task-steel', 'model-resnet50', 'success', 92.6, 0.0001, 32, 30, 'AdamW', '42 分钟', '先冻结骨干网络训练 5 轮，再整体微调；小样本下随机擦除带来稳定提升。', '2026-11-02T09:30:00.000Z'],
      ['exp-steel-vit', 'task-steel', 'model-vit', 'failed', 71.8, 0.001, 16, 20, 'AdamW', '58 分钟', '初始学习率过大且直接全量微调，验证集波动明显并出现过拟合。', '2026-11-02T11:00:00.000Z'],
      ['exp-pcb-yolo', 'task-pcb', 'model-yolo', 'success', 88.4, 0.001, 16, 80, 'SGD', '1.6 小时', '保留多尺度训练，小目标层对微小缺陷定位更有效。', '2026-11-03T09:30:00.000Z'],
      ['exp-pcb-faster', 'task-pcb', 'model-faster', 'success', 85.1, 0.0005, 8, 40, 'SGD', '2.8 小时', '精度稳定但推理耗时较高，适合作为精度对照方案。', '2026-11-03T14:00:00.000Z'],
      ['exp-review-bert', 'task-review', 'model-bert', 'success', 91.8, 0.00002, 32, 4, 'AdamW', '36 分钟', '采用线性学习率衰减和 10% warmup，截断长度设为 256。', '2026-11-04T09:30:00.000Z'],
      ['exp-review-textcnn', 'task-review', 'model-textcnn', 'success', 86.2, 0.001, 64, 12, 'Adam', '11 分钟', '训练速度快，可作为资源受限时的轻量基线。', '2026-11-04T11:00:00.000Z'],
      ['exp-log-roberta', 'task-log', 'model-roberta', 'success', 89.5, 0.00002, 16, 5, 'AdamW', '48 分钟', '将工业缩写加入分词词表，使用分层学习率后验证集更稳定。', '2026-11-05T10:00:00.000Z'],
      ['exp-churn-xgb', 'task-churn', 'model-xgboost', 'success', 87.3, 0.05, 256, 500, 'Gradient Boosting', '9 分钟', 'max_depth=6、subsample=0.8，并使用早停防止过拟合。', '2026-11-06T09:30:00.000Z'],
      ['exp-churn-mlp', 'task-churn', 'model-mlp', 'failed', 72.4, 0.01, 128, 60, 'Adam', '18 分钟', '未充分处理类别特征和异常值，训练损失快速下降但验证 AUC 停滞。', '2026-11-06T10:30:00.000Z'],
      ['exp-sensor-iforest', 'task-sensor', 'model-iforest', 'success', 85.6, 0, 256, 200, 'Unsupervised', '3 分钟', '仅用正常样本拟合， contamination 参考真实异常比例并通过验证集校准。', '2026-11-07T09:30:00.000Z'],
      ['exp-remote-swin', 'task-remote', 'model-swin', 'success', 93.4, 0.0003, 64, 40, 'AdamW', '3.2 小时', '使用多光谱通道适配和余弦学习率衰减，大数据量下充分训练。', '2026-11-08T09:30:00.000Z'],
      ['exp-chest-densenet', 'task-chest', 'model-densenet', 'success', 90.7, 0.0001, 16, 25, 'AdamW', '55 分钟', '加载 ImageNet 权重，使用类别权重与轻度增强，按患者划分数据集。', '2026-11-09T09:30:00.000Z'],
      ['exp-contract-crf', 'task-contract', 'model-roberta-crf', 'success', 88.9, 0.00002, 16, 8, 'AdamW', '1.2 小时', 'CRF 约束实体标签转移，长合同按条款切分并保留上下文重叠。', '2026-11-10T09:30:00.000Z']
    ];
    this.db.exec('BEGIN');
    try {
      const insertDataset = this.db.prepare('INSERT INTO datasets (id, name, size, features, preprocessing) VALUES (?, ?, ?, ?, ?)');
      const insertTask = this.db.prepare('INSERT INTO tasks (id, name, description, domain, modality, task_type, data_scale, metric, dataset_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insertModel = this.db.prepare('INSERT INTO models (id, name, family, pretrained) VALUES (?, ?, ?, ?)');
      const insertExperiment = this.db.prepare('INSERT INTO experiments (id, task_id, model_id, status, score, learning_rate, batch_size, epochs, optimizer, training_time, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      datasets.forEach((row) => insertDataset.run(...row));
      tasks.forEach((row) => insertTask.run(...row));
      models.forEach((row) => insertModel.run(...row));
      experiments.forEach((row) => insertExperiment.run(...row));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listExperiments(limit = 100) {
    return this.db.prepare(`
      SELECT e.*, t.name AS task_name, t.description, t.domain, t.modality,
             t.task_type, t.data_scale, t.metric, d.name AS dataset_name,
             d.size AS dataset_size, d.features AS dataset_features, d.preprocessing,
             m.name AS model_name, m.family AS model_family, m.pretrained
      FROM experiments e
      JOIN tasks t ON t.id = e.task_id
      JOIN datasets d ON d.id = t.dataset_id
      JOIN models m ON m.id = e.model_id
      ORDER BY e.created_at DESC LIMIT ?
    `).all(limit);
  }

  listTasks() {
    return this.db.prepare(`
      SELECT t.*, d.name AS dataset_name, d.size AS dataset_size,
             d.features AS dataset_features, d.preprocessing
      FROM tasks t JOIN datasets d ON d.id = t.dataset_id
      ORDER BY t.created_at DESC
    `).all();
  }

  getOverview() {
    const scalar = (sql) => this.db.prepare(sql).get().count;
    const experiments = scalar('SELECT COUNT(*) AS count FROM experiments');
    const successful = scalar("SELECT COUNT(*) AS count FROM experiments WHERE status = 'success'");
    return {
      tasks: scalar('SELECT COUNT(*) AS count FROM tasks'),
      datasets: scalar('SELECT COUNT(*) AS count FROM datasets'),
      models: scalar('SELECT COUNT(*) AS count FROM models'),
      experiments,
      successRate: experiments ? Math.round((successful / experiments) * 100) : 0,
      recentExperiments: this.listExperiments(5),
      modalities: this.db.prepare('SELECT modality, COUNT(*) AS count FROM tasks GROUP BY modality').all()
    };
  }

  createExperience(input) {
    const ids = {
      task: randomUUID(), dataset: randomUUID(), model: randomUUID(), experiment: randomUUID()
    };
    const createdAt = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO datasets (id, name, size, features, preprocessing) VALUES (?, ?, ?, ?, ?)')
        .run(ids.dataset, input.dataset.name, input.dataset.size, input.dataset.features, input.dataset.preprocessing);
      this.db.prepare('INSERT INTO tasks (id, name, description, domain, modality, task_type, data_scale, metric, dataset_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ids.task, input.task.name, input.task.description, input.task.domain, input.task.modality, input.task.taskType, input.task.dataScale, input.task.metric, ids.dataset, createdAt);
      this.db.prepare('INSERT INTO models (id, name, family, pretrained) VALUES (?, ?, ?, ?)')
        .run(ids.model, input.model.name, input.model.family, input.model.pretrained ? 1 : 0);
      this.db.prepare('INSERT INTO experiments (id, task_id, model_id, status, score, learning_rate, batch_size, epochs, optimizer, training_time, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ids.experiment, ids.task, ids.model, input.experiment.status, input.experiment.score, input.experiment.learningRate, input.experiment.batchSize, input.experiment.epochs, input.experiment.optimizer, input.experiment.trainingTime, input.experiment.notes, createdAt);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listExperiments(1000).find((item) => item.id === ids.experiment);
  }

  getGraph() {
    return buildGraph(this.listTasks(), this.listExperiments(1000));
  }

  close() {
    this.db.close();
  }
}

module.exports = { ExperienceStore };
