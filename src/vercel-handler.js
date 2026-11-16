const { createRequestHandler } = require('../server');
const { PostgresStore } = require('./postgres-store');

let handler;

module.exports = async function handleVercel(request, response) {
  if (!process.env.DATABASE_URL) {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: '尚未配置 DATABASE_URL，请在 Vercel 环境变量中添加 PostgreSQL 连接字符串' }));
    return;
  }
  try {
    if (!handler) handler = createRequestHandler(new PostgresStore(process.env.DATABASE_URL));
    await handler(request, response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: '线上服务初始化失败，请检查数据库连接配置' }));
    }
  }
};
