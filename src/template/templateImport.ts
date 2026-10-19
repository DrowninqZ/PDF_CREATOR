import { buildPageTemplate } from './a4Styles';

/** 导入模板文件：按扩展名自动识别 Word（.docx）或 HTML */
export async function importTemplateFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return importDocx(file);
  if (name.endsWith('.doc')) {
    throw new Error('不支持旧版 .doc，请先在 Word 中另存为 .docx 再导入');
  }
  if (name.endsWith('.html') || name.endsWith('.htm')) return importHtml(file);
  throw new Error('仅支持导入 .docx 或 .html 文件');
}

/** Word 文档 -> HTML：直接解析 OOXML，保留列宽、边框、字号等版式信息 */
async function importDocx(file: File): Promise<string> {
  // 解析器依赖 JSZip，动态加载避免打进首屏包
  const { docxToTemplate } = await import('./docxImport');
  return docxToTemplate(await file.arrayBuffer());
}

/** HTML 文件 -> 模板。完整文档直接用；片段则套用 A4 基础样式 */
async function importHtml(file: File): Promise<string> {
  const text = (await file.text()).trim();
  if (!text) throw new Error('HTML 文件内容为空');
  if (/<html[\s>]/i.test(text) || /<body[\s>]/i.test(text)) return text;
  return buildPageTemplate(text);
}