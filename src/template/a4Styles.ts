import { composeTemplate } from './engine';

/**
 * A4 表单基础样式。
 * 导入 Word / 裸 HTML 时统一套用，保证编辑器预览与导出 PDF 的版式一致。
 * 全部选择器都以 .page 作用域开头，避免影响模板之外的内容。
 */
export const A4_BASE_CSS = `
.page {
  width: 210mm;
  min-height: 297mm;
  padding: 16mm 15mm;
  box-sizing: border-box;
  background: #ffffff;
  font-family: "PingFang SC", "Microsoft YaHei", "Songti SC", sans-serif;
  color: #1f2329;
  font-size: 13px;
  line-height: 1.7;
}
.page h1 {
  margin: 0 0 6mm;
  font-size: 22px;
  font-weight: 700;
  text-align: center;
  letter-spacing: 4px;
}
.page h2 { margin: 5mm 0 2mm; font-size: 15px; font-weight: 600; }
.page h3 { margin: 4mm 0 2mm; font-size: 14px; font-weight: 600; }
.page p { margin: 0 0 3mm; }
.page ul, .page ol { margin: 0 0 3mm; padding-left: 6mm; }
.page img { max-width: 100%; height: auto; }
.page table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 0 0 4mm;
  font-size: 13px;
}
.page td, .page th {
  border: 1px solid #d5dae1;
  padding: 2.5mm 3mm;
  min-height: 11mm;
  vertical-align: middle;
  overflow-wrap: break-word;
  word-break: normal;
}
.page th { background: #f4f6fa; font-weight: 500; }
`;

/** 把 HTML 片段包装成带 A4 样式的完整模板文档 */
export function buildPageTemplate(bodyHtml: string): string {
  return composeTemplate(A4_BASE_CSS, `<div class="page">\n${bodyHtml}\n</div>`);
}