// Calendar / Task 创建。
// 三层路径，从最优雅到兜底：
//   1) messenger.calendar.*    —— TB 内置 API；TB 128 标准表面其实没暴露这个 namespace，
//                                 大概率是 undefined，但留着以防未来 TB 把它正式开放
//   2) NMH open-calendar-ics    —— native host 写 tmp.ics + 显式 spawn TB 打开它，
//                                 TB 自己弹原生导入对话框，用户点一下"导入"就完事
//   3) browser.downloads        —— 最后兜底，文件落 ~/Downloads/，提示用户手动双击

import type {
  CreateActionResult,
  ExtractedEvent,
  ExtractedTask,
} from '../shared/protocol';
import { nativeHost } from './native-host';

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

// 返回 'opened' 表示 downloads.open 成功（TB 应该会弹导入对话框，可以放心 10s 后清理），
// 返回 'manual' 表示文件下到磁盘了但自动打开失败（用户需要手动双击），不能清理。
async function downloadAndOpenICS(
  filename: string,
  ics: string,
): Promise<{ status: 'opened' | 'manual'; relPath: string }> {
  console.log('[ThunderClaw][calendar] fallback: downloading .ics', filename);
  const relPath = `${ICS_SUBFOLDER}/${filename}`;
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const downloadId = await browser.downloads.download({
    url,
    filename: relPath,
    saveAs: false,
  });
  console.log('[ThunderClaw][calendar] downloadId =', downloadId);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  // 让 TB 把文件读进内存触发导入对话框。需要 manifest 里 downloads.open 权限。
  let opened = false;
  try {
    await browser.downloads.open(downloadId);
    opened = true;
  } catch (err) {
    // 权限缺失或系统级 reject。关键：不要假装成功——把"文件已下到磁盘需手动打开"如实告诉调用方。
    console.warn('[ThunderClaw] downloads.open failed; user must open file manually:', err);
  }

  if (opened) {
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
    return { status: 'opened', relPath };
  }
  // open 失败：文件留着，用户需要手动打开
  return { status: 'manual', relPath };
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

  // 2) NMH 路径：让 native host spawn TB 打开 .ics，TB 内部弹原生导入对话框
  const ics = buildICS(event);
  try {
    await nativeHost.openCalendarICS(ics);
    return {
      ok: true,
      via: 'native-api',
      detail: 'Thunderbird 已弹日历导入对话框，点"导入"即可',
    };
  } catch (err) {
    console.warn('[ThunderClaw][calendar] NMH open-calendar-ics failed:', err);
    // 老 host（pre-v0.1.20，没这个方法）→ 落到 downloads 兜底
  }

  // 3) Downloads 兜底：文件落进 ~/Downloads/ThunderClaw/ + 试着 downloads.open
  try {
    const filename = `event-${Date.now()}.ics`;
    const r = await downloadAndOpenICS(filename, ics);
    return {
      ok: true,
      via: 'fallback-ics',
      detail:
        r.status === 'opened'
          ? 'Thunderbird 会弹一个日历导入提示，点确认即可'
          : `已保存到 Downloads/${r.relPath}，请双击打开导入`,
    };
  } catch (err) {
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

  // 2) NMH 路径：和 createCalendarEvent 同样走 host spawn TB 打开 .ics
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
  const ics = lines.join('\r\n');

  try {
    await nativeHost.openCalendarICS(ics);
    return {
      ok: true,
      via: 'native-api',
      detail: 'Thunderbird 已弹任务导入对话框，点"导入"即可',
    };
  } catch (err) {
    console.warn('[ThunderClaw][calendar] NMH open-calendar-ics (task) failed:', err);
  }

  // 3) Downloads 兜底
  try {
    const r = await downloadAndOpenICS(`task-${Date.now()}.ics`, ics);
    return {
      ok: true,
      via: 'fallback-ics',
      detail:
        r.status === 'opened'
          ? 'Thunderbird 会弹任务导入提示，点确认即可'
          : `已保存到 Downloads/${r.relPath}，请双击打开导入`,
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
