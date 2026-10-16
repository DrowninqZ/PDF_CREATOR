import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 数据库存放目录，可用 DATA_DIR 覆盖（默认 server/data） */
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, 'data');
/** 数据库文件，可用 DB_FILE 覆盖 */
const dbFile = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(dataDir, 'usage.db');

fs.mkdirSync(dataDir, { recursive: true });

// 使用 Node 内置的 node:sqlite，无需任何原生依赖，Windows 上也不用编译工具链
export const db = new DatabaseSync(dbFile);
// WAL 模式：读写并发更好，进程异常退出后恢复也更稳
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event        TEXT    NOT NULL DEFAULT 'generate',
    user_id      TEXT,
    tenant_key   TEXT,
    base_name    TEXT,
    table_id     TEXT,
    table_name   TEXT,
    record_count INTEGER NOT NULL DEFAULT 0,
    merged       INTEGER NOT NULL DEFAULT 0,
    write_back   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    ip           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_base    ON usage_log(base_name);
  CREATE INDEX IF NOT EXISTS idx_usage_user    ON usage_log(user_id);
`);

/** 服务端本地时间，格式 YYYY-MM-DD HH:mm:ss（便于按天分组） */
function localNow() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

const insertStmt = db.prepare(`
  INSERT INTO usage_log
    (event, user_id, tenant_key, base_name, table_id, table_name, record_count, merged, write_back, created_at, ip)
  VALUES
    (@event, @userId, @tenantKey, @baseName, @tableId, @tableName, @recordCount, @merged, @writeBack, @createdAt, @ip)
`);

/** 写入一条使用记录，时间与 IP 以服务端为准（不信任客户端上报值） */
export function insertUsage(row) {
  insertStmt.run({ ...row, createdAt: localNow() });
}

/** 明细查询：支持按使用人、事件、时间范围、关键字筛选 */
export function listLogs(params) {
  const where = [];
  const args = {};

  if (params.userId) {
    where.push('u.user_id = @userId');
    args.userId = params.userId;
  }
  if (params.event) {
    where.push('u.event = @event');
    args.event = params.event;
  }
  if (params.from) {
    where.push('u.created_at >= @from');
    args.from = params.from;
  }
  if (params.to) {
    where.push('u.created_at <= @to');
    args.to = params.to;
  }
  if (params.keyword) {
    where.push('(u.user_id LIKE @kw OR u.base_name LIKE @kw OR u.table_name LIKE @kw)');
    args.kw = `%${params.keyword}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM usage_log u ${clause}`).get(args);
  const size = Math.min(Math.max(Number(params.size) || 20, 1), 200);
  const page = Math.max(Number(params.page) || 1, 1);

  const rows = db
    .prepare(
      `SELECT u.id, u.event, u.user_id AS userId, u.tenant_key AS tenantKey,
              u.base_name AS baseName, u.table_name AS tableName,
              u.record_count AS recordCount, u.merged, u.write_back AS writeBack,
              u.created_at AS createdAt, u.ip
       FROM usage_log u ${clause}
       ORDER BY u.id DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...args, limit: size, offset: (page - 1) * size });

  return { total, page, size, rows };
}

/** 概览：活跃人数、生成次数、生成条数 */
export function summary(from, to) {
  return db
    .prepare(
      `SELECT
         COUNT(DISTINCT user_id) AS activeUsers,
         COALESCE(SUM(CASE WHEN event = 'generate' THEN 1 ELSE 0 END), 0) AS generateEvents,
         COUNT(*) AS totalEvents,
         COALESCE(SUM(record_count), 0) AS totalRecords
       FROM usage_log
       WHERE created_at >= @from AND created_at <= @to`,
    )
    .get({ from, to });
}

/** 按天趋势 */
export function trend(from, to) {
  return db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              COUNT(DISTINCT user_id) AS users,
              SUM(CASE WHEN event = 'generate' THEN 1 ELSE 0 END) AS generates,
              COALESCE(SUM(record_count), 0) AS records
       FROM usage_log
       WHERE created_at >= @from AND created_at <= @to
       GROUP BY day ORDER BY day`,
    )
    .all({ from, to });
}

/** 按使用人排行 */
export function byUser(from, to, limit = 50) {
  return db
    .prepare(
      `SELECT user_id AS userId,
              SUM(CASE WHEN event = 'generate' THEN 1 ELSE 0 END) AS generates,
              COALESCE(SUM(record_count), 0) AS records,
              MAX(created_at) AS lastAt
       FROM usage_log
       WHERE created_at >= @from AND created_at <= @to
       GROUP BY user_id
       ORDER BY generates DESC, records DESC
       LIMIT @limit`,
    )
    .all({ from, to, limit });
}