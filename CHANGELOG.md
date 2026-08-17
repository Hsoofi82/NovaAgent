# Changelog

All notable changes to Nova are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.949] — 2026-08-17 — 🌍 First public open-source release

This is the first public, open-source release of Nova under the
**GNU AGPL v3.0 or later** license.

### Added — the platform

* 🧠 Gemini-based AI agent with function calling and multi-step tool execution
* 🔑 Automatic Gemini API-key pool with health tracking and rotation
* 🧠 Short-term conversation memory + long-term user memory and profiles
* 👥 Telegram group awareness: per-group settings, memory, VIP controls
* 🏢 Telegram Business automation (auto-replies, per-customer prompts, loop detection)
* 📱 Telegram Mini App dashboard (conversations, image editing, voice, app builder)
* 👑 Nova Control Center: users, groups, media, diagnostics, logs
* 🎨 Media engine: image generation (Cloudflare AI / Flux), image editing,
  image search, voice-to-text, TTS voice responses
* 📄 Nova Office PDF engine (RTL-compatible, embedded Vazirmatn subset) + DOCX export
* 🌐 Nova Web Builder: generate & publicly host single-file HTML apps
* 🎮 Nova Game Engine: canvas, physics, particles — AI-generated HTML5 games
* 🌍 Multi-language support, custom personas and prompts
* 🛡️ Telegram webhook secret validation, Mini App `initData` validation,
  per-user rate limiting, per-chat concurrency mutex, request deduplication

### Added — open-source release packaging

* Full AGPL-3.0-or-later `LICENSE` + SPDX headers on every source file
* `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `THIRD_PARTY_NOTICES.md`
* `.dev.vars.example` / `.env.example` for local development
* GitHub CI (type-check + tests), Dependabot, issue/PR templates, CODEOWNERS
* `tests/source-regression.mjs` — license hygiene + **secret-leak guard**
  (`npm test` fails if credentials are ever committed)

### Security

* ⚠️ **BREAKING for old private deployments:** all credentials were removed from
  `wrangler.toml`. If you previously deployed with inline `[vars]` (TOKEN,
  GEMINI_KEY_*, CF_*, WEBHOOK_SECRET, …), you must re-add them as Worker
  Secrets (`wrangler secret put …`) **before** redeploying with this version —
  otherwise a deploy will remove the old inline vars and the bot will stop
  responding. See README → Installation → *Configure secrets*.

---

## Older internal versions

* 0.9x beta series — private development builds (not publicly released).
