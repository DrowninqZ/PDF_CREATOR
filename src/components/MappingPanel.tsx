import type { FieldInfo, Mapping } from '../types';
import { isBuiltinPlaceholder } from '../template/engine';

interface MappingPanelProps {
  placeholders: string[];
  fields: FieldInfo[];
  mapping: Mapping;
  titleFieldId: string;
  onMappingChange: (key: string, fieldId: string) => void;
  onTitleFieldChange: (fieldId: string) => void;
  onAutoMap: () => void;
}

/** 字段映射：只列出尚未映射的占位符，插入占位符时已自动按名称完成映射 */
export function MappingPanel({
  placeholders,
  fields,
  mapping,
  titleFieldId,
  onMappingChange,
  onTitleFieldChange,
  onAutoMap,
}: MappingPanelProps) {
  const dataKeys = placeholders.filter((key) => !isBuiltinPlaceholder(key));
  const pending = dataKeys.filter((key) => !mapping[key]);
  const mappedCount = dataKeys.length - pending.length;

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>
          <span className="step">2</span> 字段映射
        </h2>
        <div className="pane-actions">
          <span className="muted">
            {pending.length === 0
              ? `${mappedCount} 项已映射`
              : `剩余 ${pending.length} 项待映射`}
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={onAutoMap}
            disabled={pending.length === 0}
          >
            按名称自动匹配
          </button>
        </div>
      </header>

      <p className="hint">
        在第 1 步点击字段插入占位符时会自动按名称完成映射，这里只列出仍未匹配上的占位符。
        每条记录生成 PDF 时，占位符会替换为该记录对应字段的值。
      </p>

      {dataKeys.length === 0 ? (
        <div className="empty">模板里还没有数据占位符，请在上方第 1 步点击字段插入。</div>
      ) : pending.length === 0 ? (
        <div className="ok-box">全部 {mappedCount} 个占位符已映射完成，可以直接生成 PDF 了。</div>
      ) : (
        <table className="mapping-table">
          <thead>
            <tr>
              <th>模板占位符</th>
              <th>多维表格字段</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((key) => (
              <tr key={key}>
                <td>
                  <code className="code-inline">{`{{${key}}}`}</code>
                </td>
                <td>
                  <select
                    value=""
                    onChange={(event) => onMappingChange(key, event.target.value)}
                  >
                    <option value="">— 请选择字段 —</option>
                    {fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="field-row">
        <label htmlFor="title-field">记录名称字段（用于文件名与列表展示）</label>
        <select
          id="title-field"
          value={titleFieldId}
          onChange={(event) => onTitleFieldChange(event.target.value)}
        >
          <option value="">— 使用记录 ID —</option>
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}