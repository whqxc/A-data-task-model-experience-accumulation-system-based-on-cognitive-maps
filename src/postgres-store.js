const postgres = require('postgres');
const { randomUUID } = require('node:crypto');
const { ExperienceStore } = require('./database');
const { buildGraph } = require('./graph');

class PostgresStore {
  constructor(connectionString) {
    this.sql = postgres(connectionString, { ssl: 'require', max: 1, prepare: false, connect_timeout: 15 });
    this.ready = this.initialize();
  }

  async initialize() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        size BIGINT NOT NULL,
        features TEXT NOT NULL,
        preprocessing TEXT NOT NULL
      )`;
    await this.sql`
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
        created_at TIMESTAMPTZ NOT NULL
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        family TEXT NOT NULL,
        pretrained BOOLEAN NOT NULL DEFAULT FALSE
      )`;
    await this.sql`
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        model_id TEXT NOT NULL REFERENCES models(id),
        status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
        score REAL NOT NULL,
        learning_rate DOUBLE PRECISION NOT NULL,
        batch_size INTEGER NOT NULL,
        epochs INTEGER NOT NULL,
        optimizer TEXT NOT NULL,
        training_time TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`;
    await this.sql`CREATE INDEX IF NOT EXISTS idx_experiments_task ON experiments(task_id)`;
    await this.sql`CREATE INDEX IF NOT EXISTS idx_tasks_modality ON tasks(modality)`;
    const [{ count }] = await this.sql`SELECT COUNT(*) AS count FROM tasks`;
    if (Number(count) === 0) await this.seed();
  }

  async seed() {
    const demo = new ExperienceStore(':memory:');
    const tasks = demo.listTasks();
    const experiments = demo.listExperiments(1000);
    demo.close();
    const models = new Map();
    experiments.forEach((experiment) => {
      models.set(experiment.model_id, {
        id: experiment.model_id,
        name: experiment.model_name,
        family: experiment.model_family,
        pretrained: Boolean(experiment.pretrained)
      });
    });
    await this.sql.begin(async (sql) => {
      for (const task of tasks) {
        await sql`INSERT INTO datasets (id, name, size, features, preprocessing) VALUES (${task.dataset_id}, ${task.dataset_name}, ${task.dataset_size}, ${task.dataset_features}, ${task.preprocessing}) ON CONFLICT (id) DO NOTHING`;
        await sql`INSERT INTO tasks (id, name, description, domain, modality, task_type, data_scale, metric, dataset_id, created_at) VALUES (${task.id}, ${task.name}, ${task.description}, ${task.domain}, ${task.modality}, ${task.task_type}, ${task.data_scale}, ${task.metric}, ${task.dataset_id}, ${task.created_at}) ON CONFLICT (id) DO NOTHING`;
      }
      for (const model of models.values()) {
        await sql`INSERT INTO models (id, name, family, pretrained) VALUES (${model.id}, ${model.name}, ${model.family}, ${model.pretrained}) ON CONFLICT (id) DO NOTHING`;
      }
      for (const experiment of experiments) {
        await sql`INSERT INTO experiments (id, task_id, model_id, status, score, learning_rate, batch_size, epochs, optimizer, training_time, notes, created_at) VALUES (${experiment.id}, ${experiment.task_id}, ${experiment.model_id}, ${experiment.status}, ${experiment.score}, ${experiment.learning_rate}, ${experiment.batch_size}, ${experiment.epochs}, ${experiment.optimizer}, ${experiment.training_time}, ${experiment.notes}, ${experiment.created_at}) ON CONFLICT (id) DO NOTHING`;
      }
    });
  }

  async listExperiments(limit = 100) {
    await this.ready;
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    return this.sql`
      SELECT e.*, t.name AS task_name, t.description, t.domain, t.modality,
             t.task_type, t.data_scale, t.metric, d.name AS dataset_name,
             d.size AS dataset_size, d.features AS dataset_features, d.preprocessing,
             m.name AS model_name, m.family AS model_family, m.pretrained
      FROM experiments e
      JOIN tasks t ON t.id = e.task_id
      JOIN datasets d ON d.id = t.dataset_id
      JOIN models m ON m.id = e.model_id
      ORDER BY e.created_at DESC LIMIT ${safeLimit}`;
  }

  async listTasks() {
    await this.ready;
    return this.sql`
      SELECT t.*, d.name AS dataset_name, d.size AS dataset_size,
             d.features AS dataset_features, d.preprocessing
      FROM tasks t JOIN datasets d ON d.id = t.dataset_id
      ORDER BY t.created_at DESC`;
  }

  async getOverview() {
    await this.ready;
    const [taskRows, datasetRows, modelRows, experimentRows, successRows] = await Promise.all([
      this.sql`SELECT COUNT(*) AS count FROM tasks`,
      this.sql`SELECT COUNT(*) AS count FROM datasets`,
      this.sql`SELECT COUNT(*) AS count FROM models`,
      this.sql`SELECT COUNT(*) AS count FROM experiments`,
      this.sql`SELECT COUNT(*) AS count FROM experiments WHERE status = 'success'`
    ]);
    const tasks = Number(taskRows[0].count);
    const datasets = Number(datasetRows[0].count);
    const models = Number(modelRows[0].count);
    const experiments = Number(experimentRows[0].count);
    const successful = Number(successRows[0].count);
    const recentExperiments = await this.listExperiments(5);
    const modalities = await this.sql`SELECT modality, COUNT(*) AS count FROM tasks GROUP BY modality`;
    return {
      tasks, datasets, models, experiments,
      successRate: experiments ? Math.round((successful / experiments) * 100) : 0,
      recentExperiments,
      modalities: modalities.map((item) => ({ ...item, count: Number(item.count) }))
    };
  }

  async createExperience(input) {
    await this.ready;
    const ids = { task: randomUUID(), dataset: randomUUID(), model: randomUUID(), experiment: randomUUID() };
    const createdAt = new Date().toISOString();
    await this.sql.begin(async (sql) => {
      await sql`INSERT INTO datasets (id, name, size, features, preprocessing) VALUES (${ids.dataset}, ${input.dataset.name}, ${input.dataset.size}, ${input.dataset.features}, ${input.dataset.preprocessing})`;
      await sql`INSERT INTO tasks (id, name, description, domain, modality, task_type, data_scale, metric, dataset_id, created_at) VALUES (${ids.task}, ${input.task.name}, ${input.task.description}, ${input.task.domain}, ${input.task.modality}, ${input.task.taskType}, ${input.task.dataScale}, ${input.task.metric}, ${ids.dataset}, ${createdAt})`;
      await sql`INSERT INTO models (id, name, family, pretrained) VALUES (${ids.model}, ${input.model.name}, ${input.model.family}, ${input.model.pretrained})`;
      await sql`INSERT INTO experiments (id, task_id, model_id, status, score, learning_rate, batch_size, epochs, optimizer, training_time, notes, created_at) VALUES (${ids.experiment}, ${ids.task}, ${ids.model}, ${input.experiment.status}, ${input.experiment.score}, ${input.experiment.learningRate}, ${input.experiment.batchSize}, ${input.experiment.epochs}, ${input.experiment.optimizer}, ${input.experiment.trainingTime}, ${input.experiment.notes}, ${createdAt})`;
    });
    const experiments = await this.listExperiments(1000);
    return experiments.find((item) => item.id === ids.experiment);
  }

  async getGraph() {
    await this.ready;
    return buildGraph(await this.listTasks(), await this.listExperiments(1000));
  }
}

module.exports = { PostgresStore };
