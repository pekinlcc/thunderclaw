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
  return !!(
    cal &&
    cal.calendars &&
    typeof cal.calendars.query === 'function' &&
    cal.items &&
    typeof cal.items.create === 'function'
  );
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

  // 2) Fallback: 静默下载 .ics → 自动用 TB 打开 → TB 弹日历导入对话框
  try {
    const ics = buildICS(event);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const filename = `thunderclaw-event-${Date.now()}.ics`;
    const downloadId = await browser.downloads.download({
      url,
      filename,
      saveAs: false, // **关键**：不弹保存对话框，直接进 Downloads
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    // 自动用系统默认 app 打开 .ics —— 在 TB 内会触发 calendar import 对话框
    try {
      await browser.downloads.open(downloadId);
    } catch (err) {
      console.warn('[ThunderClaw] downloads.open failed, .ics 仍在 Downloads:', err);
    }
    return {
      ok: true,
      via: 'fallback-ics',
      detail: '已生成 .ics，Thunderbird 会弹一个日历导入提示，点确认即可',
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

  // 2) 兜底：静默下载 VTODO .ics → 自动用 TB 打开 → 任务导入对话框
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
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const filename = `thunderclaw-task-${Date.now()}.ics`;
    const downloadId = await browser.downloads.download({
      url,
      filename,
      saveAs: false,
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    try {
      await browser.downloads.open(downloadId);
    } catch (err) {
      console.warn('[ThunderClaw] downloads.open failed, .ics 仍在 Downloads:', err);
    }
    return {
      ok: true,
      via: 'fallback-ics',
      detail: '已生成 .ics，Thunderbird 会弹任务导入提示，点确认即可',
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
