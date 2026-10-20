/** 占位符语法：{{任意键}}，支持中文与下划线，键两侧空格会被忽略 */
const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** A4 基础样式，作为模板样式之外的安全兜底 */
const BASE_CSS = `
@page { size: A4; margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #ffffff; }
`;

export interface ParsedTemplate {
  /** 模板 <style> 中的 CSS */
  css: string;
  /** 模板 <body> 中的 HTML */
  body: string;
}

/** 从模板中解析出 CSS 与 body 片段，同时兼容「完整 HTML 文档」与「HTML 片段」两种写法 */
export function parseTemplate(raw: string): ParsedTemplate {
  const source = raw.trim();
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const css = Array.from(doc.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n');

  const isFullDocument = /<html[\s>]/i.test(source) || /<body[\s>]/i.test(source);
  const body = isFullDocument
    ? doc.body.innerHTML
    : doc.body.innerHTML.replace(/<style[\s\S]*?<\/style>/gi, '');

  return { css: css.trim(), body: body.trim() };
}

/** 提取模板中出现的全部占位符键（去重，保持出现顺序） */
export function extractPlaceholders(raw: string): string[] {
  const { body } = parseTemplate(raw);
  const keys = new Set<string>();
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(body)) !== null) {
    keys.add(match[1]);
  }
  return Array.from(keys);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 代入后的数据字段统一使用常规字重。
 * 承载字段的位置常带加粗（Word 里标签普遍加粗，单元格、段落标记也会带 w:b），
 * 纯文本替换会让值继承成加粗；用内联样式把值钉回常规字重，标签的加粗不受影响。
 */
const FIELD_VALUE_STYLE = 'font-weight:400';

/** 用数据填充模板正文中的占位符（值会做 HTML 转义并强制不加粗） */
export function fillTemplate(body: string, values: Record<string, string>): string {
  PLACEHOLDER_RE.lastIndex = 0;
  return body.replace(PLACEHOLDER_RE, (_full, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value === '') return '';
    return `<span style="${FIELD_VALUE_STYLE}">${escapeHtml(String(value))}</span>`;
  });
}

/**
 * 生成可直接写入 iframe 的完整 HTML 文档。
 * 预览与导出 PDF 使用同一份文档，保证所见即所得。
 */
export function buildDocument(raw: string, values: Record<string, string>): string {
  const { css, body } = parseTemplate(raw);
  const filled = fillTemplate(body, values);
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    `<style>${BASE_CSS}</style>`,
    `<style>${css}</style>`,
    '</head>',
    `<body>${filled}</body>`,
    '</html>',
  ].join('');
}

/** 内置占位符：无需映射字段，由插件自动填充 */
export const BUILTIN_PLACEHOLDERS: Record<string, string> = {
  _index: '序号（从 1 开始）',
  _now: '生成日期（YYYY-MM-DD）',
};

export function isBuiltinPlaceholder(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_PLACEHOLDERS, key);
}

/** 把 CSS 与 body 片段组装成完整 HTML 文档 */
export function composeTemplate(css: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8" />',
    `<style>\n${css}\n</style>`,
    '</head>',
    `<body>\n${body}\n</body>`,
    '</html>',
  ].join('\n');
}

/** 编辑器里占位符 chip 上存储 key 的属性名 */
export const CHIP_ATTR = 'data-ph-key';

/** 内置占位符在编辑器里的短标签，避免显示 _index 这类原始键 */
const CHIP_LABELS: Record<string, string> = {
  _index: '序号',
  _now: '日期',
};

export function chipLabel(key: string): string {
  return CHIP_LABELS[key] ?? key;
}

/** 创建编辑器里的占位符 chip（contenteditable=false，作为不可拆分的原子节点） */
export function createChipElement(doc: Document, key: string): HTMLElement {
  const span = doc.createElement('span');
  span.className = 'ph';
  span.setAttribute(CHIP_ATTR, key);
  span.setAttribute('contenteditable', 'false');
  span.textContent = chipLabel(key);
  return span;
}

/** 模板 body -> 编辑器显示用 HTML：把 {{key}} 文本换成可视化 chip */
export function bodyToEditorHtml(body: string): string {
  const doc = new DOMParser().parseFromString(`<div data-root>${body}</div>`, 'text/html');
  const root = doc.querySelector('[data-root]');
  if (!root) return body;

  // 先收集所有含占位符的文本节点，再统一替换，避免边遍历边改结构
  const texts: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/\{\{[^{}]*\}\}/.test(node.nodeValue ?? '')) texts.push(node as Text);
  }

  for (const text of texts) {
    const value = text.nodeValue ?? '';
    const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      if (match.index > last) {
        frag.appendChild(doc.createTextNode(value.slice(last, match.index)));
      }
      frag.appendChild(createChipElement(doc, match[1]));
      last = match.index + match[0].length;
    }
    if (last < value.length) {
      frag.appendChild(doc.createTextNode(value.slice(last)));
    }
    text.parentNode?.replaceChild(frag, text);
  }

  return root.innerHTML;
}

/** 编辑器 HTML -> 模板 body：把可视化 chip 还原成 {{key}} 文本 */
export function editorHtmlToBody(html: string): string {
  const doc = new DOMParser().parseFromString(`<div data-root>${html}</div>`, 'text/html');
  const root = doc.querySelector('[data-root]');
  if (!root) return html;
  root.querySelectorAll(`span[${CHIP_ATTR}]`).forEach((el) => {
    const key = el.getAttribute(CHIP_ATTR) ?? '';
    el.replaceWith(doc.createTextNode(`{{${key}}}`));
  });
  return root.innerHTML;
}