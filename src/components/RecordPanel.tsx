import { useEffect, useRef } from 'react';
import type { FieldInfo, RecordInfo } from '../types';

interface RecordPanelProps {
  /** 已按筛选条件过滤后的记录列表 */
  records: RecordInfo[];
  /** 「记录名称字段」选中的列：既作为明细表表头，也作为筛选可选列 */
  titleFields: FieldInfo[];
  /** 未筛选时的记录总数 */
  totalCount: number;
  /** 实际参与生成的记录数（已勾选 且 通过筛选） */
  selectedCount: number;
  selected: Set<string>;
  loading: boolean;
  filterFieldId: string;
  filterKeyword: string;
  onFilterFieldChange: (fieldId: string) => void;
  onFilterKeywordChange: (keyword: string) => void;
  onReload: () => void;
  onToggle: (recordId: string) => void;
  onSelectAll: (recordIds: string[]) => void;
  onClear: () => void;
  onPickInteractively: () => void;
}

/** 列表最多渲染条数，避免大表下一次性渲染上万行导致卡顿 */
const MAX_VISIBLE = 300;

/** 记录范围选择：按列筛选 / 全选 / 手动勾选 / 在表格中交互选择 */
export function RecordPanel({
  records,
  titleFields,
  totalCount,
  selectedCount,
  selected,
  loading,
  filterFieldId,
  filterKeyword,
  onFilterFieldChange,
  onFilterKeywordChange,
  onReload,
  onToggle,
  onSelectAll,
  onClear,
  onPickInteractively,
}: RecordPanelProps) {
  const rendered = records.slice(0, MAX_VISIBLE);
  const truncated = records.length - rendered.length;

  // 有选中列时渲染为明细表：表头列名横向排列，下方各行按列对齐
  const hasColumns = titleFields.length > 0;
  const gridStyle = hasColumns
    ? { gridTemplateColumns: `18px repeat(${titleFields.length}, minmax(0, 1fr))` }
    : undefined;

  // 表头复选框：全选/取消全选当前筛选结果
  const allSelected = records.length > 0 && records.every((record) => selected.has(record.id));
  const someSelected = !allSelected && records.some((record) => selected.has(record.id));
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const handleToggleAll = () => {
    if (allSelected) onClear();
    else onSelectAll(records.map((record) => record.id));
  };

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>
          <span className="step">3</span> 选择记录
        </h2>
        <div className="pane-actions">
          <span className="muted">
            已选 {selectedCount} / 共 {totalCount}
          </span>
          <button type="button" className="btn ghost" onClick={onReload} disabled={loading}>
            {loading ? '加载中…' : '重新加载'}
          </button>
        </div>
      </header>

      <div className="record-toolbar">
        <button
          type="button"
          className="btn ghost"
          title="在多维表格中勾选"
          onClick={onPickInteractively}
        >
          表格中勾选
        </button>
        <select
          className="filter-field"
          title="按列筛选"
          value={filterFieldId}
          onChange={(event) => onFilterFieldChange(event.target.value)}
        >
          <option value="">记录名称</option>
          {titleFields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
        <input
          className="search"
          placeholder="输入关键字筛选"
          value={filterKeyword}
          onChange={(event) => onFilterKeywordChange(event.target.value)}
        />
        <button
          type="button"
          className="btn ghost"
          title="清空筛选"
          onClick={() => onFilterKeywordChange('')}
          disabled={!filterKeyword}
        >
          重置
        </button>
      </div>

      <div className="record-list">
        <div className={hasColumns ? 'record-head' : 'record-head record-head-plain'} style={gridStyle}>
          <input
            ref={selectAllRef}
            type="checkbox"
            className="record-all"
            title="全选 / 取消全选当前筛选结果"
            aria-label="全选当前筛选结果"
            checked={allSelected}
            onChange={handleToggleAll}
          />
          {hasColumns &&
            titleFields.map((field) => (
              <span className="record-col" key={field.id} title={field.name}>
                {field.name}
              </span>
            ))}
        </div>
        {records.length === 0 && <div className="empty">没有匹配的记录</div>}
        {rendered.map((record) => (
          <label
            className={hasColumns ? 'record-item record-grid' : 'record-item'}
            style={gridStyle}
            key={record.id}
          >
            <input
              type="checkbox"
              checked={selected.has(record.id)}
              onChange={() => onToggle(record.id)}
            />
            {hasColumns ? (
              record.cells.map((cell) => (
                <span className="record-col" key={cell.fieldId} title={cell.value}>
                  {cell.value || '—'}
                </span>
              ))
            ) : (
              <span className="record-title">{record.title}</span>
            )}
          </label>
        ))}
        {truncated > 0 && (
          <div className="empty">另有 {truncated} 条未显示，请用筛选缩小范围</div>
        )}
      </div>
    </section>
  );
}