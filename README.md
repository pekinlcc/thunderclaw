# ThunderClaw

> An AI mail assistant for Thunderbird, powered by your locally-logged-in Claude Code or Codex CLI.
>
> English (current) · [中文](./README.zh-CN.md)

Take the thousands of emails sitting in your Thunderbird, group them by contact, and let your local AI command-line tool reason over them one contact at a time. The result is a single daily briefing of "things you actually need to act on today" — surfaced as cards with suggested replies and AI rationale.

**Nothing leaves your machine.** No API keys, no cloud uploads. The extension talks over Native Messaging to a small Node helper that spawns your already-authenticated `claude` or `codex` CLI.

UI mockups in [`Mockup.html`](./Mockup.html) (open in any browser). Product spec (Chinese) in [`PRD.md`](./PRD.md).

---

## How it works

A three-stage agent pipeline:

1. **Roost** — Walks your local Thunderbird folders, pulls headers (last 30 days, 300 messages per folder cap), groups messages by contact, and scores each contact by `unread × recency × volume`.
2. **ContactPulse** — Iterates contacts in priority order. For each, lazily fetches the bodies of the most recent messages and asks the LLM to identify the most important pending matter (if any). Output is parsed JSON: title, priority, deadline, suggested reply, AI rationale, original-email IDs.
3. **Briefing** — Once all per-contact analyses are in, a final LLM pass merges related items across contacts, deduplicates, and produces the global briefing displayed as the AI view's main screen.

Per-contact cards stream into the UI as they're produced — no waiting for the full pipeline before you see anything.

## Highlights

- 100% local execution — your mail never leaves your machine
- Streaming UI — cards appear one by one as analysis progresses
- Priority-ordered scanning — high-signal contacts go first
- Top-50 cap for first scan, with a **Scan more** button for the long tail
- "Open in compose window" — suggested replies pre-fill Thunderbird's standard compose UI; **never auto-sent**
- Works on Linux / macOS / Windows (cross-platform native host installer)

## Requirements

- Thunderbird **128 ESR or newer** (140 ESR recommended)
- Node.js **18+** (used by the native messaging host)
- A logged-in [Claude Code CLI](https://docs.anthropic.com/claude/docs/claude-code) or [Codex CLI](https://github.com/openai/codex)

> ⚠️ **Ubuntu 24.04 users**: the snap build of Thunderbird cannot do native messaging because `xdg-desktop-portal` 1.18 ships without the WebExtensions backend. Use the official Mozilla tarball or the Flatpak build instead — see the Linux section below.

---

## Installation

ThunderClaw ships in two pieces:

1. A Thunderbird extension (`.xpi`)
2. A Native Messaging Host (a small Node program that spawns your CLI)

Both have to be installed.

### Common steps

1. Download the latest `thunderclaw-x.y.z.xpi` from [Releases](https://github.com/pekinlcc/thunderclaw/releases).
2. Clone this repo (the native host is run from your machine):
   ```bash
   git clone https://github.com/pekinlcc/thunderclaw
   cd thunderclaw
   ```

### Linux

```bash
# 1. Install the native messaging host
node scripts/install-native-host.mjs

# 2. Install the extension in Thunderbird:
#    Menu → Add-ons and Themes → gear icon → Install Add-on From File
#    → select thunderclaw-x.y.z.xpi
#
#    If Thunderbird refuses (signature required), set this in about:config:
#      xpinstall.signatures.required = false
#    (ESR builds support this preference.)
```

**Ubuntu 24.04 caveat**: the snap version of Thunderbird **cannot** do native messaging, because the WebExtensions portal backend wasn't added until `xdg-desktop-portal-gnome` 47 (Ubuntu 24.04 ships 46). Two workarounds:

- **Mozilla tarball (recommended)**:
  ```bash
  mkdir -p ~/opt && cd ~/opt
  wget -O tb.tar.xz "https://download.mozilla.org/?product=thunderbird-esr-latest-ssl&os=linux64&lang=en-US"
  tar xJf tb.tar.xz
  # Launch with ~/opt/thunderbird/thunderbird
  # If migrating from snap: rsync -a ~/snap/thunderbird/common/.thunderbird/<profile>/ ~/.thunderbird/<profile>/
  ```
- **Flatpak**: `flatpak install flathub org.mozilla.Thunderbird`

### macOS

```bash
# 1. Install the native messaging host
node scripts/install-native-host.mjs

# Files placed:
#   ~/Library/Application Support/ThunderClaw/                      (host library + wrapper)
#   ~/.local/bin/thunderclaw-host                                    (wrapper)
#   ~/Library/Application Support/Thunderbird/NativeMessagingHosts/thunderclaw.json
#   ~/Library/Mozilla/NativeMessagingHosts/thunderclaw.json

# 2. Install the extension:
#    Thunderbird Menu → Add-ons and Themes → gear icon → Install Add-on From File
#    → select thunderclaw-x.y.z.xpi
```

If Thunderbird refuses unsigned extensions, set `xpinstall.signatures.required = false` in `about:config` (ESR supports this).

> macOS hasn't been hand-tested by the author. Please file issues if anything breaks.

### Windows

```powershell
# Run from PowerShell or CMD (no admin needed — writes to HKCU)
node scripts\install-native-host.mjs

# What the script does:
#   - Copies host library to %LOCALAPPDATA%\ThunderClaw\
#   - Writes wrapper batch file: %LOCALAPPDATA%\ThunderClaw\thunderclaw-host.bat
#   - Writes registry key HKCU\Software\Mozilla\NativeMessagingHosts\thunderclaw
#     pointing at the manifest

# Then in Thunderbird:
#   Menu → Add-ons and Themes → gear icon → Install Add-on From File
#   → select thunderclaw-x.y.z.xpi
```

If Thunderbird refuses unsigned extensions, set `xpinstall.signatures.required = false` in `about:config` (ESR supports this).

> Windows hasn't been hand-tested either.

---

## Usage

1. Open Thunderbird. The spaces toolbar (left edge) gets a new blue/purple sparkle icon labelled **AI 助手** with a small "AI" badge.
2. Click the icon. On first run:
   - **CLI Picker** — pick Claude Code or Codex (defaults to Claude when both are logged in).
   - **Self-introduction (optional)** — write a short paragraph about yourself; it'll be passed as system-prompt context so suggested replies match your voice. Skip if you want.
   - The pipeline auto-starts: Roost → ContactPulse → Briefing.
3. The **Briefing** screen is the main view: priority-sorted cards on the left, full detail (summary, suggested reply, AI rationale) on the right.
4. Action buttons:
   - For items needing a reply: **Open in compose window** (pre-fills recipient, subject, body — you click Send) or **Copy to clipboard**.
   - For notifications: **I've seen this**.
   - For false positives: **Not important · don't show again** (suppresses that thread permanently).
5. The first scan analyses the top 50 most-active contacts. Once finished, a footer bar offers **Scan more** to process the long tail.

---

## Development

```bash
git clone https://github.com/pekinlcc/thunderclaw
cd thunderclaw
npm install
npm run build         # produces dist/thunderclaw.xpi
npm run watch         # rebuild on src/ changes
npm run typecheck     # tsc --noEmit
```

Repository layout:

```
thunderclaw/
├── src/
│   ├── manifest.json            # MailExtension manifest (MV2)
│   ├── background/              # background scripts
│   │   ├── index.ts             # entry point, message routing, space registration
│   │   ├── native-host.ts       # Native Messaging client
│   │   ├── orchestrator.ts      # Roost → Pulse → Briefing scheduler
│   │   ├── roost.ts             # local mail / contact aggregation
│   │   ├── pulse.ts             # ContactPulse + Briefing LLM calls
│   │   ├── compose.ts           # compose window prefill
│   │   └── store.ts             # browser.storage.local wrapper
│   ├── shared/protocol.ts       # types shared between extension and host
│   ├── ui/                      # React UI
│   └── icons/
├── native-host/                 # Native Messaging Host (Node)
│   ├── index.mjs                # stdio protocol main loop
│   ├── cli.mjs                  # CLI probing + spawning
│   └── protocol.mjs             # 4-byte length-prefix framing
├── scripts/
│   ├── build.mjs                # esbuild + zip into XPI
│   └── install-native-host.mjs  # cross-platform NMH installer
├── PRD.md                       # product requirements (Chinese)
├── Mockup.html                  # UI design reference
└── README.md
```

### Roadmap

Tracking PRD §8:

- [x] Manifest + minimal MailExtension (AI view tab)
- [x] Native Messaging Host + CLI spawn
- [x] Roost: enumerate local mail + address books + group by contact
- [x] ContactPulse + Briefing LLM calls + streaming output
- [x] UI screens (CLI Picker / Intro / Loading / Briefing)
- [x] Compose window prefill
- [ ] Calendar integration (the API is still partially experimental in TB 140)
- [ ] Rubric file (AI-maintained importance criteria, evolving with user feedback)
- [ ] Settings panel (CLI switch, clear data, edit self-intro)
- [ ] New-mail trigger for incremental analysis
- [ ] One-click platform installers (.pkg / .msi / .deb)

## Design tradeoffs

See [PRD §9](./PRD.md#9-v1-明确不做) for the full list. Highlights:

- ❌ No cloud APIs and no API keys (CLI-only by design)
- ❌ No auto-send (always opens the compose window for user review)
- ❌ No attachment parsing or HTML cleanup in v1
- ❌ No automatic contact creation (avoids polluting your address book)
- ❌ No concurrent CLI calls (assumes serial)

## Related

- [CCCPlayer](https://github.com/pekinlcc/CCCPlayer) — same author's prior project; validates the "Claude Code CLI as a model backend" pattern this project relies on.

## License

TBD. Currently alpha — use at your own risk.
