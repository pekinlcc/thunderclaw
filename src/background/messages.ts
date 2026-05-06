// Thunderbird 邮件操作的封装：预览正文、跳转到原邮件、标记已读 + 归档。

import type { EmailPreview } from '../shared/protocol';
import { decodeBody } from './roost';

const PREVIEW_BODY_CHARS = 1500;

export async function getEmailPreview(messageId: number): Promise<EmailPreview | null> {
  let header: any;
  try {
    header = await browser.messages.get(messageId);
  } catch (err) {
    console.warn('[ThunderClaw] messages.get failed:', err);
    return null;
  }
  if (!header) return null;

  const body = await decodeBody(messageId, 8000);
  // 把 HTML 简单脱皮成纯文本（粗暴但够用）
  const plain = stripHtml(body);
  const truncated = plain.length > PREVIEW_BODY_CHARS;
  return {
    messageId,
    subject: header.subject || '(无主题)',
    from: header.author || '',
    date: new Date(header.date).toISOString(),
    bodyText: truncated ? plain.slice(0, PREVIEW_BODY_CHARS) + '\n…[正文已截断]' : plain,
    bodyTruncated: truncated,
  };
}

function stripHtml(s: string): string {
  if (!s) return '';
  // 不严谨，但比直接渲染 HTML 安全：
  // 1) 把 <br>/<p> 换行
  // 2) 删 <script>/<style> 块
  // 3) 剥所有标签
  // 4) decode 几个常见 entity
  let t = s;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/p>/gi, '\n\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ');
  t = t.replace(/&amp;/g, '&');
  t = t.replace(/&lt;/g, '<');
  t = t.replace(/&gt;/g, '>');
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/&#39;/g, "'");
  // 收敛多余空行
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// 在 Thunderbird 的标准邮件视图里打开这封信。
export async function openOriginal(messageId: number): Promise<void> {
  // messageDisplay.open 是首选 API（TB 102+）
  const md = (browser as any).messageDisplay;
  if (md && typeof md.open === 'function') {
    try {
      await md.open({ messageId });
      return;
    } catch (err) {
      console.warn('[ThunderClaw] messageDisplay.open failed, fallback to mailTabs:', err);
    }
  }
  // 兜底：在 mail tab 中切到这封信
  try {
    const tabs = await browser.mailTabs.query({ active: true });
    const tab = tabs[0];
    if (tab) {
      await browser.mailTabs.setSelectedMessages(tab.id, [messageId]);
    } else {
      // 没有活的 mail tab，开一个
      await browser.tabs.create({ url: `mailbox-message://?messageId=${messageId}` });
    }
  } catch (err) {
    console.error('[ThunderClaw] openOriginal fallback failed:', err);
    throw err;
  }
}

// 标记一组邮件为已读 + 归档（用 TB 默认归档策略）。
// 失败的（比如 News 文件夹）静默跳过，不阻塞 acknowledge 流程。
export async function markReadAndArchive(messageIds: number[]): Promise<{
  marked: number;
  archived: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let marked = 0;
  for (const id of messageIds) {
    try {
      await browser.messages.update(id, { read: true });
      marked++;
    } catch (err) {
      errors.push(`update(${id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let archived = 0;
  if (messageIds.length > 0) {
    try {
      await browser.messages.archive(messageIds);
      archived = messageIds.length;
    } catch (err) {
      errors.push(`archive: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { marked, archived, errors };
}
