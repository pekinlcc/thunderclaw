// Calendar / Task 创建。
// 优先用 messenger.calendar.* API（TB 140 仍然部分实验性，可能 undefined）；
// 不可用时退回到 .ics 文件下载或剪贴板兜底。

import type {
  CreateActionResult,
  ExtractedEvent,
  ExtractedTask,
} from '../shared/protocol';

// 是否能用 native calendar API（TB 140 ESR 起部分可用）
function calendarApiAvailable(): boolean {
  const cal = (browser as any).calendar;
  const ok = !!(
    cal &&
    cal.calendars &&
    typeof cal.calendars.query === 'function' &&
    cal.items &&
    typeof cal.items.create === 'function'
  );
  console.log('[ThunderClaw][calendar] native API available?', ok);
  return ok;
}

function fmtICSDate(iso: string | null, allDay: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  if (allDay) {
    // YYYYMMDD
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
  // YYYYMMDDTHHmmssZ (UTC)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// .ics 文件落到 Downloads/ThunderClaw/ 子文件夹做命名空间，
// 触发 TB 导入后 ~10s 自动从磁盘 + 下载历史里清掉，避免污染用户的 Downloads。
const ICS_SUBFOLDER = 'ThunderClaw';
const CLEANUP_DELAY_MS = 10_000;

async function downloadAndOpenICS(filename: string, ics: string): Promise<void> {
  console.log('[ThunderClaw][calendar] fallback: downloading .ics', filename);
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const downloadId = await browser.downloads.download({
    url,
    filename: `${ICS_SUBFOLDER}/${filename}`,
    saveAs: false,
  });
  console.log('[ThunderClaw][calendar] downloadId =', downloadId);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  // 让 TB 把文件读进内存触发导入对话框
  try {
    await browser.downloads.open(downloadId);
  } catch (err) {
    console.warn('[ThunderClaw] downloads.open failed, .ics 仍在 Downloads 子目录:', err);
  }

  // ~10s 后清掉磁盘文件 + 下载历史条目（此时 TB 已经把 .ics 内容读进对话框了）
  setTimeout(async () => {
    try {
      await browser.downloads.removeFile(downloadId);
    } catch (err) {
      console.warn('[ThunderClaw] downloads.removeFile failed:', err);
    }
    try {
      await browser.downloads.erase({ id: downloadId });
    } catch (err) {
      console.warn('[ThunderClaw] downloads.erase failed:', err);
    }
  }, CLEANUP_DELAY_MS);
}

export function buildICS(event: ExtractedEvent): string {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@thunderclaw`;
  const dtstamp = fmtICSDate(new Date().toISOString(), false);
  const dtstart = fmtICSDate(event.startISO, event.allDay);
  const dtend = fmtICSDate(event.endISO, event.allDay);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ThunderClaw//AI Mail Assistant//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `SUMMARY:${escapeICS(event.title || '(无标题)')}`,
  ];
  if (dtstart) {
    lines.push(event.allDay ? `DTSTART;VALUE=DATE:${dtstart}` : `DTSTART:${dtstart}`);
  }
  if (dtend) {
    lines.push(event.allDay ? `DTEND;VALUE=DATE:${dtend}` : `DTEND:${dtend}`);
  }
  if (event.location) lines.push(`LOCATION:${escapeICS(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export async function createCalendarEvent(
  event: ExtractedEvent,
): Promise<CreateActionResult> {
  // 1) Native API 路径
  if (calendarApiAvailable() && event.startISO) {
    try {
      const cal: any = (browser as any).calendar;
      const calendars = await cal.calendars.query({ type: 'event' });
      // 优先非只读的本地日历；没有就第一个可写的
      const writable = calendars.find((c: any) => !c.readOnly);
      if (writable) {
        await cal.items.create(writable.id, {
          type: 'event',
          title: event.title,
          startDate: event.startISO,
          endDate: event.endISO ?? event.startISO,
          description: event.description ?? '',
          location: event.location ?? '',
        });
        return {
          ok: true,
          via: 'native-api',
          detail: `已添加到日历 "${writable.name}"`,
        };
      }
    } catch (err) {
      console.warn('[ThunderClaw] calendar.items.create failed:', err);
      // fall through
    }
  }

  // 2) Fallback: 静默下到 Downloads/ThunderClaw/ 子文件夹 → 自动用 TB 打开 →
  //    TB 弹日历导入对话框 → 10s 后我们删掉文件 + 下载历史，不污染 Downloads
  try {
    const ics = buildICS(event);
    const filename = `event-${Date.now()}.ics`;
    await downloadAndOpenICS(filename, ics);
    return {
      ok: true,
      via: 'fallback-ics',
      detail: 'Thunderbird 会弹一个日历导入提示，点确认即可',
    };
  } catch (err) {
    // 3) 最终兜底：剪贴板
    return {
      ok: false,
      via: 'fallback-clipboard',
      detail: '无法创建日历事件',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createTask(task: ExtractedTask): Promise<CreateActionResult> {
  // 1) Native API
  if (calendarApiAvailable()) {
    try {
      const cal: any = (browser as any).calendar;
      const taskCals = await cal.calendars.query({ type: 'task' });
      const writable =
        taskCals.find((c: any) => !c.readOnly) ??
        (await cal.calendars.query({ type: 'event' })).find((c: any) => !c.readOnly);
      if (writable) {
        const item: any = {
          type: 'task',
          title: task.title,
          description: task.notes ?? '',
        };
        if (task.dueISO) item.dueDate = task.dueISO;
        await cal.items.create(writable.id, item);
        return {
          ok: true,
          via: 'native-api',
          detail: `已添加到任务 "${writable.name}"`,
        };
      }
    } catch (err) {
      console.warn('[ThunderClaw] task create failed:', err);
    }
  }

  // 2) 兜底：静默下 VTODO .ics → 自动用 TB 打开 → 任务导入对话框 → 10s 自清
  try {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@thunderclaw`;
    const due = task.dueISO ? fmtICSDate(task.dueISO, false) : '';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ThunderClaw//AI Mail Assistant//EN',
      'BEGIN:VTODO',
      `UID:${uid}`,
      `DTSTAMP:${fmtICSDate(new Date().toISOString(), false)}`,
      `SUMMARY:${escapeICS(task.title || '(无标题)')}`,
    ];
    if (due) lines.push(`DUE:${due}`);
    if (task.notes) lines.push(`DESCRIPTION:${escapeICS(task.notes)}`);
    lines.push('END:VTODO', 'END:VCALENDAR');
    await downloadAndOpenICS(`task-${Date.now()}.ics`, lines.join('\r\n'));
    return {
      ok: true,
      via: 'fallback-ics',
      detail: 'Thunderbird 会弹任务导入提示，点确认即可',
    };
  } catch (err) {
    return {
      ok: false,
      via: 'fallback-clipboard',
      detail: '无法创建任务',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
