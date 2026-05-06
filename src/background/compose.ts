// 在撰写窗口打开（带 AI 建议草稿）。

import type { BriefingItem } from '../shared/protocol';

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bodyAsHTML(text: string): string {
  // 转 HTML：先转义，再 \n -> <br>，外层包 div 让 TB 接受
  const escaped = htmlEscape(text).replace(/\n/g, '<br>');
  return `<div>${escaped}</div>`;
}

export async function openComposeFor(item: BriefingItem, replyAll = false) {
  if (!item.suggestedReply) {
    throw new Error('this item has no suggested reply');
  }
  const reply = item.suggestedReply;
  const messageId = item.emailIds.find((id) => typeof id === 'number');

  // 优先 beginReply（保留 thread / In-Reply-To 头）
  if (typeof messageId === 'number') {
    try {
      const replyType = replyAll ? 'replyToAll' : 'replyToSender';
      console.log('[ThunderClaw] beginReply', { messageId, replyType });
      // 同时给 plainText 和 HTML，避免账户偏好不一致导致空 body
      await browser.compose.beginReply(messageId, replyType as any, {
        body: bodyAsHTML(reply),
        plainTextBody: reply,
        isPlainText: false,
      });
      console.log('[ThunderClaw] beginReply OK');
      return;
    } catch (err) {
      console.warn('[ThunderClaw] beginReply failed:', err);
      // 继续走 beginNew 兜底
    }
  } else {
    console.warn('[ThunderClaw] no usable messageId for beginReply, fallback to beginNew');
  }

  // 兜底：开新邮件，自己拼收件人/主题/正文
  const subject = item.title.startsWith('Re:') ? item.title : `Re: ${item.title}`;
  console.log('[ThunderClaw] beginNew', {
    to: [item.contactEmail],
    subject,
    bodyLen: reply.length,
  });
  try {
    await browser.compose.beginNew({
      to: [item.contactEmail],
      subject,
      body: bodyAsHTML(reply),
      plainTextBody: reply,
      isPlainText: false,
    });
    console.log('[ThunderClaw] beginNew OK');
  } catch (err) {
    console.error('[ThunderClaw] beginNew failed:', err);
    throw err;
  }
}
