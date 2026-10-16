/* 使用统计后台页面逻辑：无框架，原生 DOM */

const PAGE_SIZE = 20;

const el = (id) => document.getElementById(id);

const state = {
  days: 30,
  page: 1,
  keyword: '',
  event: '',
  token: localStorage.getItem('usage_admin_token') || '',
  logsTotal: 0,
};

/** 统一请求封装：带上口令，401 时提示 */
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': state.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) throw new Error('口令不正确，请在右上角填入 ADMIN_TOKEN');
  if (!res.ok) throw new Error(`请求失败：${res.status}`);
  return res.status === 204 ? null : res.json();
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

function showError(message) {
  const box = el('error');
  if (!message) {
    box.hidden = true;
    return;
  }
  box.textContent = message;
  box.hidden = false;
}

function renderCards(data) {
  const items = [
    { label: '活跃使用人数', value: data.activeUsers },
    { label: '生成 PDF 次数', value: data.generateEvents },
    { label: '累计生成条数', value: data.totalRecords },
  ];
  el('cards').innerHTML = items
    .map(
      (item) =>
        `<div class="card"><div class="label">${item.label}</div>` +
        `<div class="value">${Number(item.value || 0).toLocaleString()}</div></div>`,
    )
    .join('');
}

function renderChart(rows) {
  const chart = el('chart');
  const empty = el('chart-empty');
  if (!rows.length) {
    chart.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const max = Math.max(...rows.map((row) => Number(row.generates) || 0), 1);
  chart.innerHTML = rows
    .map((row) => {
      const generates = Number(row.generates) || 0;
      const height = Math.round((generates / max) * 140) + 2;
      const tip = `${row.day}：生成 ${generates} 次 / 活跃 ${row.users} 人 / ${row.records} 条`;
      return (
        `<div class="bar-wrap" title="${escapeHtml(tip)}">` +
        `<div class="bar" style="height:${height}px"></div>` +
        `<div class="bar-label">${escapeHtml(row.day.slice(5))}</div>` +
        '</div>'
      );
    })
    .join('');
}

function renderTable(container, head, rows) {
  if (!rows.length) {
    container.innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }
  const headHtml = head
    .map((col) => `<th${col.num ? ' class="num"' : ''}>${escapeHtml(col.title)}</th>`)
    .join('');
  const bodyHtml = rows
    .map(
      (row) =>
        '<tr>' +
        head
          .map(
            (col) =>
              `<td${col.num ? ' class="num"' : ''}>${escapeHtml(col.value(row))}</td>`,
          )
          .join('') +
        '</tr>',
    )
    .join('');
  container.innerHTML = `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function renderUsers(rows) {
  renderTable(
    el('users'),
    [
      { title: '使用人', value: (row) => row.userId || '（匿名）' },
      { title: '生成次数', value: (row) => row.generates, num: true },
      { title: '生成条数', value: (row) => row.records, num: true },
      { title: '最近使用', value: (row) => row.lastAt },
    ],
    rows,
  );
}

function renderLogs(data) {
  state.logsTotal = data.total;
  const rows = data.rows.map((row) => ({
    ...row,
    eventText: row.event === 'open' ? '打开插件' : '生成 PDF',
    mergedText: row.merged ? '合并' : '逐条',
    writeBackText: row.writeBack ? '是' : '否',
  }));

  renderTable(
    el('logs'),
    [
      { title: '时间', value: (row) => row.createdAt },
      { title: '事件', value: (row) => row.eventText },
      { title: '使用人', value: (row) => row.userId || '（匿名）' },
      { title: 'Base', value: (row) => row.baseName },
      { title: '数据表', value: (row) => row.tableName },
      { title: '条数', value: (row) => row.recordCount, num: true },
      { title: '方式', value: (row) => row.mergedText },
      { title: '回写', value: (row) => row.writeBackText },
      { title: 'IP', value: (row) => row.ip },
    ],
    rows,
  );

  const totalPages = Math.max(Math.ceil(data.total / data.size), 1);
  el('page-info').textContent = `第 ${data.page} / ${totalPages} 页 · 共 ${data.total} 条`;
  el('prev').disabled = data.page <= 1;
  el('next').disabled = data.page >= totalPages;
}

function logQuery(extra = '') {
  const params = new URLSearchParams({ days: String(state.days) });
  if (state.keyword) params.set('keyword', state.keyword);
  if (state.event) params.set('event', state.event);
  return `/api/admin/logs?${params}${extra}`;
}

/** 导出当前筛选条件下的全部明细（最多 5000 行） */
async function exportCsv() {
  const rows = [];
  for (let page = 1; page <= 25; page += 1) {
    const data = await api(logQuery(`&page=${page}&size=200`));
    rows.push(...data.rows);
    if (rows.length >= data.total) break;
  }
  const header = [
    '时间', '事件', '使用人', 'Base', '数据表', '条数', '方式', '回写', 'IP',
  ];
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.event === 'open' ? '打开插件' : '生成 PDF',
      row.userId,
      row.baseName,
      row.tableName,
      row.recordCount,
      row.merged ? '合并' : '逐条',
      row.writeBack ? '是' : '否',
      row.ip,
    ]
      .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  // 加 BOM，避免 Excel 打开中文乱码
  const csv = `\uFEFF${[header.join(','), ...lines].join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `插件使用明细_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function load() {
  try {
    showError('');
    const days = `days=${state.days}`;
    const [summary, trendRows, users, logs] = await Promise.all([
      api(`/api/admin/stats/summary?${days}`),
      api(`/api/admin/stats/trend?${days}`),
      api(`/api/admin/stats/by-user?${days}`),
      api(logQuery(`&page=${state.page}&size=${PAGE_SIZE}`)),
    ]);

    renderCards(summary);
    renderChart(trendRows);
    renderUsers(users);
    renderLogs(logs);
  } catch (error) {
    showError(error.message);
  }
}

function bind() {
  const tokenInput = el('token');
  tokenInput.value = state.token;

  el('range').value = String(state.days);
  el('range').addEventListener('change', (event) => {
    state.days = Number(event.target.value);
    state.page = 1;
    void load();
  });

  el('refresh').addEventListener('click', () => {
    state.token = tokenInput.value.trim();
    localStorage.setItem('usage_admin_token', state.token);
    state.page = 1;
    void load();
  });

  tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') el('refresh').click();
  });

  el('filter-apply').addEventListener('click', () => {
    state.keyword = el('filter-keyword').value.trim();
    state.event = el('filter-event').value;
    state.page = 1;
    void load();
  });

  el('export').addEventListener('click', () => {
    void exportCsv().catch((error) => showError(error.message));
  });

  el('prev').addEventListener('click', () => {
    state.page = Math.max(state.page - 1, 1);
    void load();
  });

  el('next').addEventListener('click', () => {
    state.page += 1;
    void load();
  });
}

bind();
void load();