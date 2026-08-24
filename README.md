<div align="center">

# 🔔 BELLA 6.0

**Voice-first desktop AI — you talk, your computer listens, thinks, and does the work.**

*234+ voice-callable tools · 7 agent types · 3 personas · runs on your machine*

</div>

---

## What is BELLA?

Most assistants stop at conversation — they tell you which button to press.
BELLA presses it. She lives on your Windows desktop as a translucent HUD,
listens continuously for **"Hey Bella"**, and reaches into real applications:
your browser, WhatsApp, Excel, VS Code, the file system, the volume mixer,
even your Android phone. Big jobs get handed to background agents that keep
working while you carry on talking.

> Speech goes in. Work comes out.

## Quick start

```bash
npm install
npm run build        # vite (HUD) + esbuild (server)
start-bella.bat      # launches without elevation (mic/screen need this!)
```

First run: paste a Gemini API key in the gate screen. Everything else is voice.

| Say this | You get |
|---|---|
| "Open YouTube and play Believer" | Song in your real browser |
| "Brightness 40, volume 20" | PC obeys |
| "Find last month's invoice PDF and open it" | File search + open |
| "Every Monday at 9, remind me to invoice" | Recurring reminder, spoken |
| "At 6 p.m., send Rohit the report" | Scheduled *action*, not a nudge |
| "Research EV batteries, write a report" | Background research agent → cited report in `~/BellaReports` |
| "Build me a Flask API with JWT auth" | Coding agent ships it into `~/BellaProjects`, self-fixes build errors |
| "Explain how a transformer works, draw it" | Whiteboard lesson, drawn live |
| "This is Priya, remember her" | Face enrolled; "who is this?" works forever after |
| "Start recording… stop. Upload as Episode 12" | Screen recording → YouTube upload |
| "Ask my phone if I got an OTP" | Phone Link (QR pairing over LAN) |
| "Find my phone" | Locates your paired phone via the companion app |

## Capability map

| Area | Highlights |
|---|---|
| **PC control** | Apps, windows, keyboard/mouse, media keys, brightness, power (2-step confirm), temp cleanup, zip/unzip |
| **Files** | Search/fuzzy-open, batch-rename, sort-by-type, read aloud, properties |
| **Vision** | Live screen share (+GDI fallback), camera vision, OCR read-screen, diagram analysis, **face recognition** |
| **Agents** | Sub-agents (parallel), research deep-dives, coding agent (Claude Code / ManishCode engines, lessons learned), Hermes bridge, document jobs |
| **Documents** | Real Word/Excel/PDF creation & Excel editing, résumé builder, folder indexing Q&A |
| **Comms** | Email (IMAP/SMTP), WhatsApp automation, expense extraction from bank mails |
| **Phone** | QR-paired Android companion: installable PWA with full BELLA chat (voice + text), web-push notifications, PC remote control, photo/file drop, Android share receiving, find-my-phone — served by the PC's own HTTPS authority (`:4443`, local CA) with HTTP fallback |
| **Creator** | Screen recording, live commentary mode, YouTube analytics + OAuth uploads |
| **Memory** | Sentence-level facts, session continuity, temporal recall — all local JSON |
| **Growth** | Self-authored Python skills w/ sandbox testing + rollback, marketplace, plugins, macros (record/replay/schedule) |
| **Security** | Voice Guardian voiceprint, guest-mode tool blocking, encrypted key vault + pool failover |
| **Personas** | Bella 🌸 · Friday 🎖️ · Venom 🖤 — voice + personality switchable by voice or Settings |

## Architecture

```
electron/main.cjs ── spawns ──► dist/server.cjs  (Express :3000 + WS /live)
                                      │            └─ HTTPS :4443 (local CA → phone companion PWA)
         Gemini Live (voice↔voice) ◄──┘
             │ tool calls
             ├─ bella/* capability modules (this repo's brain)
             ├─ Python desktop_agent :8765 (pyautogui/pywin32/PIL/playwright)
             └─ HUD renderer (recorder, whiteboard canvas, face capture)
```

Everything personal stays on disk: memories, voiceprints, faces, mail config,
key vault (`keys_vault.enc`, AES-256-GCM). No middleman cloud.

## Dev

```bash
npm run dev      # tsx server.ts with HMR HUD via vite middleware
npm run lint     # tsc --noEmit
npm run app      # build + electron
npm run dist     # NSIS/portable installer
```

Launch note: always start BELLA non-elevated (double-click `start-bella.bat`
or the packaged installer shortcut) — Windows blocks microphone and
screen-capture APIs for admin Chromium processes.

---

*Built by [THE Manish AI](https://github.com/Manish632004) · Bella 6.0 · 2026*
