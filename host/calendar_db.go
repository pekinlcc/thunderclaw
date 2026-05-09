package main

// 直接 INSERT 到 Thunderbird 的 calendar SQLite，跳过导入对话框。
//
// 怎么走：
//   1. 解析 <profile>/prefs.js 找所有 type="storage" 的本地日历的 UUID
//   2. 打开 <profile>/calendar-data/local.sqlite（WAL 模式，能跟运行中的 TB 并发写）
//   3. INSERT 进 cal_events 或 cal_todos + 可选的 cal_properties（location / description）
//
// 已知限制：TB 内存里 calendar manager 不会立刻 reload —— 用户切到日历 tab
// 或重启 TB 才能看到新事件。这是 SQLite 直写绕不过去的代价；签名 + experiment_apis
// 才能拿到 in-process 的 cal.manager.refresh()，但那条路 Mozilla AMO unlisted 不放行。

import (
	"bufio"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type directCalendarParams struct {
	Type        string `json:"type"`        // "event" | "task"
	Title       string `json:"title"`
	StartISO    string `json:"startISO,omitempty"`
	EndISO      string `json:"endISO,omitempty"`
	DueISO      string `json:"dueISO,omitempty"`
	AllDay      bool   `json:"allDay,omitempty"`
	Location    string `json:"location,omitempty"`
	Description string `json:"description,omitempty"`
}

type directCalendarResult struct {
	OK           bool   `json:"ok"`
	CalendarID   string `json:"calendarId"`
	CalendarName string `json:"calendarName"`
	ItemID       string `json:"itemId"`
}

// 找用户 prefs.js 里所有 type="storage" 的本地日历。返回 [(uuid, name), ...]
func findStorageCalendars(profileDir string) ([]struct{ ID, Name string }, error) {
	prefsPath := filepath.Join(profileDir, "prefs.js")
	data, err := os.ReadFile(prefsPath)
	if err != nil {
		return nil, fmt.Errorf("read prefs.js: %w", err)
	}

	// 匹配 user_pref("calendar.registry.<uuid>.<key>", <value>);
	re := regexp.MustCompile(`user_pref\("calendar\.registry\.([a-f0-9-]+)\.(\w+)",\s*"?([^")]+)"?\);`)
	matches := re.FindAllStringSubmatch(string(data), -1)

	type calendarMeta struct {
		ctype string
		name  string
	}
	cals := map[string]*calendarMeta{}
	for _, m := range matches {
		uuid := m[1]
		key := m[2]
		val := m[3]
		if cals[uuid] == nil {
			cals[uuid] = &calendarMeta{}
		}
		switch key {
		case "type":
			cals[uuid].ctype = val
		case "name":
			cals[uuid].name = val
		}
	}

	out := []struct{ ID, Name string }{}
	for uuid, meta := range cals {
		if meta.ctype != "storage" {
			continue
		}
		out = append(out, struct{ ID, Name string }{ID: uuid, Name: meta.name})
	}
	if len(out) == 0 {
		return nil, errors.New("no local storage calendar found in prefs.js — please create a 'On This Computer' calendar in TB first")
	}
	return out, nil
}

func newUUID() string {
	var b [16]byte
	if _, err := io.ReadFull(rand.Reader, b[:]); err != nil {
		panic(err)
	}
	// 简化的 UUID v4
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	)
}

// TB 用 PRTime（自 1970-01-01 起的 microseconds）。Go time.UnixMicro() 直接给得到。
// 解析 ISO 8601；解不出来就返回 0（调用方把 0 当 "未指定"，不写这列）。
func isoToMicros(iso string) int64 {
	if iso == "" {
		return 0
	}
	// Try common formats; ISO 8601 with TZ vs without
	for _, layout := range []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, iso); err == nil {
			return t.UnixMicro()
		}
	}
	return 0
}

// 读取 stamp，写到 event_stamp / todo_stamp（DTSTAMP）字段
func nowMicros() int64 { return time.Now().UnixMicro() }

func tzOf(iso string) string {
	// 如果带 Z 是 UTC，否则我们当 floating
	if strings.HasSuffix(iso, "Z") {
		return "UTC"
	}
	if iso == "" {
		return ""
	}
	return "floating"
}

func openCalendarDB(profileDir string) (*sql.DB, error) {
	dbPath := filepath.Join(profileDir, "calendar-data", "local.sqlite")
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("calendar DB missing at %s: %w", dbPath, err)
	}
	// _journal_mode=WAL 让我们能跟运行中的 TB 并发写
	// _busy_timeout 给 SQLite 5 秒重试 SQLITE_BUSY
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open calendar DB: %w", err)
	}
	return db, nil
}

func directCalendarCreate(p directCalendarParams) (directCalendarResult, error) {
	if p.Title == "" {
		return directCalendarResult{}, errors.New("title required")
	}
	if p.Type != "event" && p.Type != "task" {
		return directCalendarResult{}, fmt.Errorf("unknown type: %s", p.Type)
	}
	profileDir, err := defaultProfilePath()
	if err != nil {
		return directCalendarResult{}, err
	}
	cals, err := findStorageCalendars(profileDir)
	if err != nil {
		return directCalendarResult{}, err
	}
	target := cals[0] // 第一个 storage 日历——用户多的话以后可以加挑选

	db, err := openCalendarDB(profileDir)
	if err != nil {
		return directCalendarResult{}, err
	}
	defer db.Close()

	itemID := newUUID() + "@thunderclaw"
	now := nowMicros()

	tx, err := db.Begin()
	if err != nil {
		return directCalendarResult{}, fmt.Errorf("begin tx: %w", err)
	}
	rollback := func() { _ = tx.Rollback() }

	if p.Type == "event" {
		startMicros := isoToMicros(p.StartISO)
		endMicros := isoToMicros(p.EndISO)
		// 没结束时间默认 +1 小时
		if startMicros != 0 && endMicros == 0 {
			endMicros = startMicros + 3600*1_000_000
		}
		startTz := tzOf(p.StartISO)
		endTz := tzOf(p.EndISO)
		if endTz == "" {
			endTz = startTz
		}

		_, err = tx.Exec(`
			INSERT INTO cal_events (
				cal_id, id, time_created, last_modified, title,
				priority, privacy, ical_status, flags,
				event_start, event_end, event_stamp,
				event_start_tz, event_end_tz,
				recurrence_id, recurrence_id_tz, alarm_last_ack, offline_journal
			) VALUES (?, ?, ?, ?, ?,  0, '', 'CONFIRMED', 0,  ?, ?, ?,  ?, ?,  NULL, NULL, NULL, NULL)`,
			target.ID, itemID, now, now, p.Title,
			startMicros, endMicros, now,
			startTz, endTz,
		)
		if err != nil {
			rollback()
			return directCalendarResult{}, fmt.Errorf("insert cal_events: %w", err)
		}
	} else { // task
		dueMicros := isoToMicros(p.DueISO)
		dueTz := tzOf(p.DueISO)
		_, err = tx.Exec(`
			INSERT INTO cal_todos (
				cal_id, id, time_created, last_modified, title,
				priority, privacy, ical_status, flags,
				todo_entry, todo_due, todo_completed, todo_complete,
				todo_entry_tz, todo_due_tz, todo_completed_tz,
				recurrence_id, recurrence_id_tz, alarm_last_ack, todo_stamp, offline_journal
			) VALUES (?, ?, ?, ?, ?,  0, '', 'NEEDS-ACTION', 0,  NULL, ?, NULL, NULL,  NULL, ?, NULL,  NULL, NULL, NULL, ?, NULL)`,
			target.ID, itemID, now, now, p.Title,
			dueMicros, dueTz, now,
		)
		if err != nil {
			rollback()
			return directCalendarResult{}, fmt.Errorf("insert cal_todos: %w", err)
		}
	}

	// 可选的 cal_properties: LOCATION + DESCRIPTION
	insertProp := func(key, value string) error {
		if value == "" {
			return nil
		}
		_, err := tx.Exec(`
			INSERT INTO cal_properties (item_id, key, value, recurrence_id, recurrence_id_tz, cal_id)
			VALUES (?, ?, ?, NULL, NULL, ?)`,
			itemID, key, value, target.ID,
		)
		return err
	}
	if err := insertProp("LOCATION", p.Location); err != nil {
		rollback()
		return directCalendarResult{}, fmt.Errorf("insert location property: %w", err)
	}
	if err := insertProp("DESCRIPTION", p.Description); err != nil {
		rollback()
		return directCalendarResult{}, fmt.Errorf("insert description property: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return directCalendarResult{}, fmt.Errorf("commit: %w", err)
	}

	return directCalendarResult{
		OK:           true,
		CalendarID:   target.ID,
		CalendarName: target.Name,
		ItemID:       itemID,
	}, nil
}

// 抑制未使用的 import 警告（bufio 是 profile.go 用的）
var _ = bufio.NewScanner
