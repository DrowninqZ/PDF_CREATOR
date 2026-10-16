import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import {
  byUser,
  insertUsage,
  listLogs,
  summary,
  trend,
} from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
/** 后台查询口令；配置后所有 /api/admin/* 都需要带上（建议在内网也配置） */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
/** 允许上报的来源白名单（逗号分隔）；留空表示不限制来源 */
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
/** 插件前端挂载路径 */
const PLUGIN_PATH = '/plugin';
/** 插件前端构建产物目录；默认取仓库根目录的 dist，可用 PLUGIN_DIST_DIR 覆盖 */
const PLUGIN_DIR = path.resolve(process.env.PLUGIN_DIST_DIR || path.join(here, '..', 'dist'));
const pluginReady = fs.existsSync(path.join(PLUGIN_DIR, 'index.html'));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(cors({ origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true }));
// 插件端用 sendBeacon 发送，content-type 为 text/plain（避免触发 CORS 预检），这里一并按 JSON 解析
app.use(express.json({ limit: '64kb', type: ['application/json', 'text/plain'] }));

/** 取字符串并限制长度，避免脏数据撑爆库 */
function text(value, max = 128) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function flag(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  return String(req.ip || '').slice(0, 64);
}

/** 解析时间范围：支持 days=N，默认近 30 天；days=0 表示全部 */
function resolveRange(query) {
  const raw = query.days;
  if (raw === undefined) {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400_000);
    return { from: fmt(from), to: fmt(to) };
  }
  const days = Number(raw);
  const to = new Date();
  if (!Number.isFinite(days) || days <= 0) return { from: '0000-01-01 00:00:00', to: fmt(to) };
  const from = new Date(to.getTime() - days * 86400_000);
  return { from: fmt(from), to: fmt(to) };
}

function fmt(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 后台接口鉴权 */
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.get('x-admin-token') || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: '未授权' });
  next();
}

// ---------------------------------------------------------------- 上报接口

app.post('/api/usage', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const event = body.event === 'open' ? 'open' : 'generate';

  insertUsage({
    event,
    userId: text(body.userId),
    tenantKey: text(body.tenantKey),
    baseName: text(body.baseName, 256),
    tableId: text(body.tableId),
    tableName: text(body.tableName, 256),
    recordCount: Math.min(Math.max(Number(body.recordCount) || 0, 0), 1_000_000),
    merged: flag(body.merged),
    writeBack: flag(body.writeBack),
    ip: clientIp(req),
  });

  res.status(204).end();
});

// ------------------------------------------------------------ 后台查询接口

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/stats/summary', (req, res) => {
  const { from, to } = resolveRange(req.query);
  res.json({ ...summary(from, to), from, to });
});

admin.get('/stats/trend', (req, res) => {
  const { from, to } = resolveRange(req.query);
  res.json(trend(from, to));
});

admin.get('/stats/by-user', (req, res) => {
  const { from, to } = resolveRange(req.query);
  res.json(byUser(from, to, Number(req.query.limit) || 50));
});

admin.get('/logs', (req, res) => {
  const { from, to } = resolveRange(req.query);
  res.json(
    listLogs({
      userId: text(req.query.userId),
      event: text(req.query.event),
      keyword: text(req.query.keyword),
      page: req.query.page,
      size: req.query.size,
      // 明细默认跟随所选时间范围；显式传 days=0 时也查全部
      from,
      to,
    }),
  );
});

app.use('/api/admin', admin);

// ------------------------------------------------------------------ 静态页

// 插件前端（vite 构建产物）。与统计接口同源，免去跨域配置
if (pluginReady) {
  app.use(PLUGIN_PATH, express.static(PLUGIN_DIR));
  // 补上结尾斜杠，否则 index.html 里的相对资源路径会解析到上一级
  app.get(PLUGIN_PATH, (_req, res) => res.redirect(301, `${PLUGIN_PATH}/`));
} else {
  app.use(PLUGIN_PATH, (_req, res) => {
    res
      .status(503)
      .type('html')
      .send(
        `<meta charset="utf-8"><h1>插件前端未构建</h1>` +
          `<p>未找到 <code>${PLUGIN_DIR}</code>。</p>` +
          `<p>请在项目根目录执行 <code>npm run build</code>，或用 PLUGIN_DIST_DIR 指定构建产物目录。</p>`,
      );
  });
}

// 统计后台页面
app.use(express.static(path.join(here, 'public')));

app.listen(PORT, () => {
  console.log(`使用统计服务已启动：http://localhost:${PORT}`);
  console.log(`统计后台：http://localhost:${PORT}/  上报接口：POST /api/usage`);
  console.log(
    pluginReady
      ? `插件前端：http://localhost:${PORT}${PLUGIN_PATH}/  （目录 ${PLUGIN_DIR}）`
      : `插件前端：未找到构建产物 ${PLUGIN_DIR}，${PLUGIN_PATH}/ 暂不可用`,
  );
  if (!ADMIN_TOKEN) console.log('提示：未配置 ADMIN_TOKEN，后台接口当前无口令保护');
});