// 在撰写窗口打开（带 AI 生成的回复草稿）。

import type { BriefingItem } from '../shared/protocol';

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bodyAsHTML(text: string): string {
  const escaped = htmlEscape(text).replace(/\n/g, '<br>');
  return `<div>${escaped}</div>`;
}

export async function openComposeFor({
  item,
  replyText,
  replyAll = false,
}: {
  item: BriefingItem;
  replyText: string;
  replyAll?: boolean;
}) {
  if (!replyText || !replyText.trim()) {
    throw new Error('replyText is empty');
  }
  // 用 pulse 算好的 replyToMessageId（最近一封"收到"，避免 reply-to-self）。
  // 如果整个 thread 都是用户自己发出的（follow-up 场景），强制 replyToAll
  // 才能把信发到原收件人，而不是发给自己。
  const messageId = item.replyToMessageId;
  const effectiveReplyAll = replyAll || item.replyTargetIsUserSent;

  if (typeof messageId === 'number') {
    try {
      const replyType = effectiveReplyAll ? 'replyToAll' : 'replyToSender';
      console.log('[ThunderClaw] beginReply', {
        messageId,
        replyType,
        targetIsUserSent: item.replyTargetIsUserSent,
      });
      await browser.compose.beginReply(messageId, replyType as any, {
        body: bodyAsHTML(replyText),
        plainTextBody: replyText,
        isPlainText: false,
      });
      console.log('[ThunderClaw] beginReply OK');
      return;
    } catch (err) {
      console.warn('[ThunderClaw] beginReply failed:', err);
    }
  } else {
    console.warn('[ThunderClaw] no replyToMessageId, fallback to beginNew');
  }

  const subject = item.title.startsWith('Re:') ? item.title : `Re: ${item.title}`;
  console.log('[ThunderClaw] beginNew', {
    to: [item.contactEmail],
    subject,
    bodyLen: replyText.length,
  });
  try {
    await browser.compose.beginNew({
      to: [item.contactEmail],
      subject,
      body: bodyAsHTML(replyText),
      plainTextBody: replyText,
      isPlainText: false,
    });
    console.log('[ThunderClaw] beginNew OK');
  } catch (err) {
    console.error('[ThunderClaw] beginNew failed:', err);
    throw err;
  }
}
