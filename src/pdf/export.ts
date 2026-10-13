import JSZip from 'jszip';

export interface NamedBlob {
  name: string;
  blob: Blob;
}

/** 把多个文件打包成一个 ZIP Blob */
export async function zipBlobs(files: NamedBlob[]): Promise<Blob> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const file of files) {
    let name = file.name;
    let index = 1;
    while (used.has(name)) {
      name = file.name.replace(/\.pdf$/i, `_${index}.pdf`);
      index += 1;
    }
    used.add(name);
    zip.file(name, file.blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}