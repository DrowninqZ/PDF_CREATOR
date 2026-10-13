import { useEffect, useRef, useState } from 'react';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../pdf/render';

interface PreviewPaneProps {
  /** 完整 HTML 文档 */
  html: string;
  /** 预览对象说明，如「张三」 */
  label: string;
}

/** A4 预览：用 iframe 做样式隔离，按容器宽度等比缩放 */
export function PreviewPane({ html, label }: PreviewPaneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const available = el.clientWidth - 32;
      if (available > 0) {
        setScale(Math.min(1, Math.max(0.2, available / A4_WIDTH_PX)));
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="pane preview-pane">
      <header className="pane-head">
        <h2>预览</h2>
        <span className="muted">{label}</span>
      </header>
      <div className="preview-scroll" ref={wrapRef}>
        <div
          className="preview-stage"
          style={{ width: A4_WIDTH_PX * scale, height: A4_HEIGHT_PX * scale }}
        >
          <iframe
            title="A4 表单预览"
            className="preview-frame"
            srcDoc={html}
            style={{
              width: `${A4_WIDTH_PX}px`,
              height: `${A4_HEIGHT_PX}px`,
              transform: `scale(${scale})`,
            }}
          />
        </div>
      </div>
    </section>
  );
}