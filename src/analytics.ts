import { bitable } from '@lark-base-open/js-sdk';

/**
 * 使用统计上报（后台静默）。
 *
 * 设计约束：
 * - 上报地址由构建期环境变量 VITE_ANALYTICS_ENDPOINT 注入，未配置时本模块不产生任何请求；
 * - 只上报使用元数据（谁、哪个 Base、生成多少条），不包含表格内容；
 * - 任何异常都被吞掉，不写 console、不弹提示、不影响生成主流程；
 * - 用 sendBeacon 发送，且 contentType 用 text/plain 规避 CORS 预检（beacon 无法处理预检失败）。
 */
const ENDPOINT = (import.meta.env.VITE_ANALYTICS_ENDPOINT ?? '').trim();

export interface UsagePayload {
  event: 'open' | 'generate';
  tableId?: string;
  tableName?: string;
  recordCount?: number;
  merged?: boolean;
  writeBack?: boolean;
}

/** 身份信息只取一次并缓存，避免每次上报都跨 iframe 通信 */
let identityPending: Promise<Record<string, string>> | null = null;

async function safeText(task: () => Promise<string>): Promise<string> {
  try {
    return (await task()) ?? '';
  } catch {
    return '';
  }
}

function identity(): Promise<Record<string, string>> {
  identityPending ??= (async () => ({
    userId: await safeText(() => bitable.bridge.getUserId()),
    tenantKey: await safeText(() => bitable.bridge.getTenantKey()),
    baseName: await safeText(() => bitable.base.getBaseName()),
  }))();
  return identityPending;
}

/** 静默上报一条使用记录 */
export function reportUsage(payload: UsagePayload): void {
  if (!ENDPOINT) return;
  void (async () => {
    try {
      const body = JSON.stringify({ ...(await identity()), ...payload });
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
    } catch {
      /* 静默失败：上报永远不影响主流程 */
    }
  })();
}