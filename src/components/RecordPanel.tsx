import { useMemo, useState } from 'react';
import type { RecordInfo } from '../types';

interface RecordPanelProps {
  records: RecordInfo[];
  selected: Set<string>;
  loading: boolean;
  onReload: () => void;
  onToggle: (recordId: string) => void;
  onSelectAll: (recordIds: string[]) => void;
  onClear: () => void;
  onPickInteractively: () => void;
}

/** 列表最多渲染条数，避免大表下一次性渲染上万行导致卡顿 */
const MAX_VISIBLE = 300;

/** 记录范围选择：全选 / 搜索 / 手动勾选 / 在表格中交互选择 */
export function RecordPanel({
  records,
  selected,
  loading,
  onReload,
  onToggle,
  onSelectAll,
  onClear,
  onPickInteractively,
}: RecordPanelProps) {
  const [keyword, setKeyword] = useState('');

  const visible = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return records;
    return records.filter((record) => record.title.toLowerCase().includes(key));
  }, [records, keyword]);

  const rendered = visible.slice(0, MAX_VISIBLE);
  const truncated = visible.length - rendered.length;

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>
          <span className="step">3</span> 选择记录
        </h2>
        <div className="pane-actions">
          <span className="muted">
            已选 {selected.size} / 共 {records.length}
          </span>
          <button type="button" className="btn ghost" onClick={onReload} disabled={loading}>
            {loading ? '加载中…' : '重新加载'}
          </button>
        </div>
      </header>

      <div className="pane-actions wrap">
        <button
          type="button"
          className="btn ghost"
          onClick={() => onSelectAll(visible.map((record) => record.id))}
        >
          全选当前列表
        </button>
        <button type="button" className="btn ghost" onClick={onClear}>
          清空选择
        </button>
        <button type="button" className="btn ghost" onClick={onPickInteractively}>
          在多维表格中勾选
        </button>
        <input
          className="search"
          placeholder="按记录名称搜索"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="record-list">
        {visible.length === 0 && <div className="empty">没有匹配的记录</div>}
        {rendered.map((record, index) => (
          <label className="record-item" key={record.id}>
            <input
              type="checkbox"
              checked={selected.has(record.id)}
              onChange={() => onToggle(record.id)}
            />
            <span className="record-index">{index + 1}</span>
            <span className="record-title">{record.title}</span>
          </label>
        ))}
        {truncated > 0 && (
          <div className="empty">另有 {truncated} 条未显示，请用搜索缩小范围</div>
        )}
      </div>
    </section>
  );
}