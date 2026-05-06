// Roost: 枚举本地邮件 + 联系人聚合。
// 三层置信度：Personal Address Book → Collected Addresses → 裸地址（用 From Display Name 兜底）。

import { setPipeline } from './store';

const WINDOW_DAYS = 30;
const MAX_PER_FOLDER = 300;
const EXCLUDED_TYPES = new Set(['junk', 'trash', 'drafts', 'templates', 'archives']);

export type RoostMessage = {
  id: number;
  date: string; // ISO
  subject: string;
  fromEmail: string;
  fromName: string;
  toEmails: string[];
  ccEmails: string[];
  // body: 只在 Pulse 阶段需要分析这个联系人时才懒拉，Roost 不读
  isUserSent: boolean;
  isUnread: boolean;
  folderName: string;
  threadKey: string;
};

export type ContactBundle = {
  key: string; // canonical email (lowercased) or contact card id
  primaryEmail: string;
  displayName: string;
  emails: string[]; // all aliases
  source: 'personal' | 'collected' | 'bare';
  messages: RoostMessage[];
  // 排序用：综合得分越高越先 Pulse
  score: number;
  unreadCount: number;
  lastDate: string; // ISO，用于二次排序
};

function lowerEmail(e: string) {
  return (e || '').trim().toLowerCase();
}

function parseAddress(s: string | undefined): { name: string; email: string }[] {
  // 简单解析 "Name <a@b>, Other <c@d>" 形式
  if (!s) return [];
  const out: { name: string; email: string }[] = [];
  // 拆分按逗号但不要切到 quoted name 里——简化处理
  const parts = s.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const p of parts) {
    const m = p.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/) || p.match(/^\s*([^<\s][^<]*?)\s*$/);
    if (!m) continue;
    if (m[2]) {
      out.push({ name: (m[1] || '').trim(), email: m[2].trim() });
    } else {
      out.push({ name: '', email: m[1].trim() });
    }
  }
  return out;
}

async function getUserEmails(): Promise<Set<string>> {
  const accounts = await browser.accounts.list();
  const set = new Set<string>();
  for (const acc of accounts) {
    for (const id of acc.identities ?? []) {
      if (id.email) set.add(lowerEmail(id.email));
    }
  }
  return set;
}

type AddrBookIndex = {
  byEmail: Map<string, { contactId: string; displayName: string; bookId: string }>;
  collectedBookId: string | null;
};

async function loadAddressBooks(): Promise<AddrBookIndex> {
  const byEmail: AddrBookIndex['byEmail'] = new Map();
  let collectedBookId: string | null = null;

  let books: { id: string; name: string }[] = [];
  try {
    books = await browser.addressBooks.list(true);
  } catch (err) {
    console.warn('[ThunderClaw] addressBooks.list failed:', err);
    return { byEmail, collectedBookId };
  }

  for (const book of books) {
    if (/collect/i.test(book.name)) collectedBookId = book.id;
    let contacts: any[] = [];
    try {
      contacts = await browser.contacts.list(book.id);
    } catch {
      continue;
    }
    for (const c of contacts) {
      const props = c.properties ?? {};
      const displayName =
        props.DisplayName || `${props.FirstName ?? ''} ${props.LastName ?? ''}`.trim() || '';
      const emails = [props.PrimaryEmail, props.SecondEmail]
        .filter(Boolean)
        .map((e: string) => lowerEmail(e));
      for (const e of emails) {
        if (!byEmail.has(e)) {
          byEmail.set(e, { contactId: c.id, displayName, bookId: book.id });
        }
      }
    }
  }

  return { byEmail, collectedBookId };
}

async function* iterMessages(folder: any, opts: { sinceDate: Date; max: number }) {
  let yielded = 0;
  // queryInfo since: undefined; we filter manually post-fetch since `messages.list` doesn't accept date.
  let page: any = await browser.messages.list(folder.id ?? folder);
  while (page && yielded < opts.max) {
    for (const m of page.messages) {
      if (yielded >= opts.max) return;
      const d = new Date(m.date);
      if (d < opts.sinceDate) continue;
      yield m;
      yielded++;
    }
    if (!page.id) break;
    try {
      page = await browser.messages.continueList(page.id);
    } catch {
      break;
    }
  }
}

// body 由 Pulse 在分析具体联系人时按需懒拉。
// 加超时：IMAP 没本地缓存的消息 getFull 会触发整个文件夹的同步，
// 单封 >5s 直接放弃，让 Pulse 用 metadata 推理（priority 比拖死流水线重要）。
export async function decodeBody(messageId: number, timeoutMs = 5000): Promise<string> {
  try {
    const fullP = browser.messages.getFull(messageId);
    const result = await Promise.race([
      fullP.then((f) => ({ ok: true, full: f }) as const),
      new Promise<{ ok: false }>((resolve) =>
        setTimeout(() => resolve({ ok: false }), timeoutMs),
      ),
    ]);
    if (!result.ok) return '';
    return extractText(result.full);
  } catch {
    return '';
  }
}

function extractText(part: any): string {
  if (!part) return '';
  if (part.body) return part.body as string;
  if (Array.isArray(part.parts)) {
    return part.parts.map(extractText).join('\n');
  }
  return '';
}

const COLOR_PALETTE = [
  '#C44A2C', '#1373D9', '#2A8B3F', '#5A4FCF', '#A37911',
  '#FC5200', '#003DA5', '#D6249F', '#6B4B8E', '#0E7C7B',
  '#B8336A', '#41658A', '#945D5E', '#3F88C5',
];

function colorFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return COLOR_PALETTE[Math.abs(h) % COLOR_PALETTE.length]!;
}

export async function runRoost(progress: (msg: string) => void): Promise<ContactBundle[]> {
  await setPipeline({ phase: 'roost', message: '加载通讯簿…' });
  progress('加载通讯簿');
  const ab = await loadAddressBooks();
  const userEmails = await getUserEmails();

  await setPipeline({ phase: 'roost', message: '扫描邮件文件夹…' });
  progress('扫描邮件文件夹');

  const accounts = await browser.accounts.list();
  const allFolders: any[] = [];
  for (const acc of accounts) {
    walkFolders(acc.folders ?? [], allFolders);
  }
  const targets = allFolders.filter((f) => !EXCLUDED_TYPES.has((f.type || '').toLowerCase()));

  const since = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000);
  const all: RoostMessage[] = [];

  let processed = 0;
  for (const folder of targets) {
    await setPipeline({
      phase: 'roost',
      total: targets.length,
      processed,
      message: `读取 ${folder.name}…`,
    });
    try {
      for await (const m of iterMessages(folder, { sinceDate: since, max: MAX_PER_FOLDER })) {
        const fromList = parseAddress(m.author);
        const from = fromList[0] ?? { name: '', email: '' };
        const fromEmail = lowerEmail(from.email);
        const toEmails = (m.recipients ?? []).flatMap((r: string) =>
          parseAddress(r).map((x) => lowerEmail(x.email))
        );
        const ccEmails = (m.ccList ?? []).flatMap((r: string) =>
          parseAddress(r).map((x) => lowerEmail(x.email))
        );
        const isUserSent = userEmails.has(fromEmail);
        // 不调 getFull，纯 headers，所以这一圈非常快
        all.push({
          id: m.id,
          date: new Date(m.date).toISOString(),
          subject: m.subject || '',
          fromEmail,
          fromName: from.name,
          toEmails,
          ccEmails,
          isUserSent,
          isUnread: !m.read,
          folderName: folder.name,
          threadKey: (m.headerMessageId || `${fromEmail}:${m.subject}`).replace(/[<>]/g, ''),
        });
      }
    } catch (err) {
      console.warn('[ThunderClaw] folder read failed:', folder.name, err);
    }
    processed++;
  }

  await setPipeline({ phase: 'roost', message: '按联系人聚合…' });
  progress(`聚合 ${all.length} 封邮件`);

  // 按"对方邮箱地址"聚合：用户发的看 to/cc，非用户发的看 from
  const byEmail = new Map<string, RoostMessage[]>();
  for (const m of all) {
    const counterparts = m.isUserSent
      ? [...m.toEmails, ...m.ccEmails].filter((e) => e && !userEmails.has(e))
      : [m.fromEmail].filter((e) => e && !userEmails.has(e));
    for (const e of counterparts) {
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e)!.push(m);
    }
  }

  const now = Date.now();
  const bundles: ContactBundle[] = [];
  for (const [email, msgs] of byEmail) {
    if (msgs.length === 0) continue;
    const personal = ab.byEmail.get(email);
    const isCollected = personal?.bookId === ab.collectedBookId;
    const source: ContactBundle['source'] = personal && !isCollected
      ? 'personal'
      : isCollected ? 'collected' : 'bare';
    const display =
      (personal?.displayName) ||
      (msgs.find((m) => !m.isUserSent && m.fromName)?.fromName) ||
      email;
    const sorted = msgs.sort((a, b) => +new Date(b.date) - +new Date(a.date));
    const unreadCount = sorted.filter((m) => m.isUnread && !m.isUserSent).length;
    const lastDateMs = +new Date(sorted[0]?.date ?? 0);
    // 综合评分：未读数权重最高，最近 7 天内活跃 + 总邮件量
    const recencyDays = Math.max(0, (now - lastDateMs) / 86400000);
    const recencyBoost = recencyDays <= 7 ? 1 : recencyDays <= 30 ? 0.4 : 0.1;
    const sourceBoost = source === 'personal' ? 1.2 : source === 'collected' ? 1 : 0.7;
    const score =
      (unreadCount * 4 + Math.min(sorted.length, 30) * 0.3 + recencyBoost * 5) * sourceBoost;
    bundles.push({
      key: email,
      primaryEmail: email,
      displayName: display,
      emails: [email],
      source,
      messages: sorted,
      score,
      unreadCount,
      lastDate: sorted[0]?.date ?? new Date(0).toISOString(),
    });
  }

  // 按 score 倒序排（高分优先）；分数相等的按最近一封时间排
  bundles.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return +new Date(b.lastDate) - +new Date(a.lastDate);
  });

  await setPipeline({
    phase: 'roost',
    total: bundles.length,
    processed: bundles.length,
    message: `Roost 完成：${bundles.length} 联系人，${all.length} 封邮件`,
  });

  return bundles;
}

function walkFolders(folders: any[], acc: any[]) {
  for (const f of folders) {
    acc.push(f);
    if (Array.isArray(f.subFolders)) walkFolders(f.subFolders, acc);
  }
}

export function avatarFor(name: string): { char: string; color: string } {
  const trimmed = (name || '').trim();
  const char = trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  return { char, color: colorFor(trimmed) };
}
