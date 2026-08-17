<div align="center">

<img src="assets/nova-banner.jpg" alt="ƝØVΛ — The AI Agent that ships" width="100%">

# ƝØVΛ

### The AI Agent that doesn't just talk — it **ships**. 🚀

**Free forever · Open Source · Self-hosted on Telegram**

<p>
  <a href="#english">🇬🇧 English</a> ·
  <a href="#persian">🇮🇷 فارسی</a>
</p>

<p>
  <a href="https://t.me/MyNovaChatBot"><img src="https://img.shields.io/badge/Reference_bot-%40MyNovaChatBot-2AABEE?style=for-the-badge&logo=telegram&logoColor=white" alt="Reference bot"></a>
  <a href="#-installation"><img src="https://img.shields.io/badge/Deploy_your_own-~10_min_guide-2ea44f?style=for-the-badge" alt="Deploy your own"></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Price-%240.00_forever-2ea44f?style=for-the-badge" alt="Price: $0.00 forever">
  <img src="https://img.shields.io/badge/License-AGPL--3.0-red?style=for-the-badge" alt="AGPL-3.0">
  <img src="https://img.shields.io/badge/Runtime-Cloudflare_Workers-orange?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers">
  <img src="https://img.shields.io/badge/Brain-Google_Gemini-purple?style=for-the-badge&logo=google" alt="Gemini">
  <img src="https://img.shields.io/badge/Language-TypeScript-blue?style=for-the-badge&logo=typescript" alt="TypeScript">
</p>

<p>
  <b>AI Agent · Function Calling · Long-Term Memory · Web Search · Image Studio · Web App Factory · Game Studio · TTS Voice · RTL PDF · Telegram Mini App</b>
</p>

### ⭐ If Nova blows your mind — star this repo. It really helps!

</div>

---

<a id="english"></a>

# 🇬🇧 English

## 🤯 This is NOT another ChatGPT wrapper

Most AI bots answer with text. **Nova answers with results.**

Ask it:

> *“Find the latest news about X, analyze it, build me a website from the data, host it, and send me the link.”*

**One message.** Nova plans the job, wakes up its tools, chains them end-to-end and replies with a **live public URL** — a real web app it wrote, deployed and hosted for you, seconds ago.

No copy-pasting. No “here's the code, do it yourself”. It. Just. Ships. ✅

---

## ⚡ Nova vs ordinary AI chatbots

| 😴 Ordinary chatbot | ⚡ ƝØVΛ Agent |
| --- | --- |
| Replies with text | **Ships real products** — websites, games, PDFs, voice notes |
| Forgets you the moment the chat closes | **Remembers you forever** — long-term memory & user profiles |
| Lives in one chat box | **Runs your Telegram** — groups, Business DMs, Mini App dashboard |
| One prompt → one answer | One prompt → **a finished multi-step workflow** |
| “Please upgrade to Pro 💸” | **$0.00 — forever**, engineered for free tiers |
| Closed black box | **Fully open source (AGPL)** — own the whole stack |
| One API key, dies at rate limits | **Key pool with auto-rotation** — never goes down |

---

## 🎁 100% free. Not “freemium”. Not a trial. **Zero.**

Nova is deliberately engineered to run **entirely on free tiers** — that's part of its architecture, not an afterthought:

| Service | What it does | Plan |
| --- | --- | --- |
| ☁️ Cloudflare Workers | Runs the whole agent | Free |
| 🗄️ Cloudflare D1 | Database & memory | Free |
| 🧠 Google Gemini | Reasoning & function calling | Free tier |
| 🎨 Cloudflare AI / Flux | Image generation | Free tier |
| ✈️ Telegram Bot API | The whole user interface | Free |

**Your monthly bill: `0.00` — in any currency. 😎**

And because Nova is self-hostable, *you* own the keys, the data and the memory. No middleman, no subscription, no lock-in.

---

## 🦸 Superpowers

| | |
| --- | --- |
| 🧠 **Agentic brain** — plans, selects and chains tools across multiple steps to finish real jobs | 🔑 **Never goes down** — Gemini key pool with health checks & automatic rotation |
| 🧠 **Total recall** — long-term memory, persistent profiles, group member awareness | 🎨 **Image studio** — generate (Flux), edit & search images on demand |
| 🌐 **Web surfer** — live web search + reads and analyzes full pages | 🏗️ **App factory** — builds single-file web apps and **hosts them at public URLs** |
| 🎮 **Game studio** — generates *playable* HTML5 games (canvas, physics, particles) | 📄 **Document engine** — RTL-aware PDFs with an embedded Persian font + DOCX export |
| 🗣️ **A voice of its own** — TTS voice notes & speech-to-text | 👥 **Group IQ** — per-group settings, memory & VIP controls |
| 🏢 **Business autopilot** — auto-replies on Telegram Business with per-customer prompts | 📱 **Mini App** — full dashboard: chats, image studio, hosted app manager |
| 👑 **Control Center** — admin panel: users, groups, media, diagnostics, live logs | 🛡️ **Fortress mode** — webhook secrets, `initData` validation, rate limiting, dedup, concurrency locks |

---

## 🚀 Deploy your OWN Nova — free, in ~10 minutes

Fork it, set your secrets, deploy:

```bash
git clone https://github.com/YOUR_USERNAME/NovaAgent.git
cd NovaAgent
npm install
npx wrangler login
npx wrangler d1 create nova-db        # put the ID in wrangler.toml
npx wrangler secret put TOKEN         # your bot token from @BotFather
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put GEMINI_KEY_1  # free tier key — done 🎉
npm run deploy
```

Full step-by-step guide (webhook, D1, all optional keys): [**Installation**](#-installation) below.

---

## ✨ Features

### 🧠 AI Agent

* Gemini-based reasoning
* Function calling
* Multi-step tool execution
* Automatic API key rotation
* Intelligent fallback between keys
* Short-term conversation memory
* Long-term user memory
* Persistent user profiles
* Group awareness
* Multi-language support
* Custom personas and prompts

### 🛠️ Agent Tools

| Tool             | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `generate_image` | Generate images using Cloudflare AI / Flux            |
| `edit_image`     | Edit images sent by Telegram users                    |
| `search_images`  | Search images using Google Custom Search              |
| `web_search`     | Search the live web                                   |
| `read_web_page`  | Read and analyze web pages                            |
| `create_pdf`     | Generate RTL-compatible PDFs                          |
| `host_web_app`   | Build and publicly host single-file HTML applications |
| `voice_response` | Generate Telegram voice responses                     |
| `set_persona`    | Change the active AI persona                          |

---

## 🎨 Media Engine

Nova includes a media layer capable of handling:

* AI image generation
* Image editing
* Image search
* Voice-to-text
* Text-to-speech
* PDF generation
* Smart file downloading
* Document handling
* Audio handling
* Font/file downloading

---

## 🎮 Built-in Game Engine

Nova contains its own experimental HTML5 game generation layer.

### Nova Game Engine

Features include:

* Canvas rendering
* Basic physics
* Particles
* Collision handling
* Easing functions
* Input handling
* Game loops
* Browser-compatible execution

AI-generated games can be packaged as single-file HTML applications and hosted through Nova.

---

## 🌐 Web App Builder

Nova can generate and host lightweight web applications and games.

Generated applications can include:

* Responsive layouts
* Tailwind CSS
* JavaScript logic
* Local storage
* Cloud state synchronization
* Public URLs
* Telegram Mini App compatibility

This allows Nova to act as both an AI assistant and a lightweight application-generation platform.

---

## 🧠 Memory System

Nova supports multiple levels of memory.

### Short-Term Memory

Conversation history used during active conversations.

### Long-Term Memory

Persistent information such as:

* User preferences
* Interests
* Projects
* Important facts
* Interaction history
* Group member information
* Relationship metadata

### Group Awareness

In groups, Nova can maintain contextual information about participants and use that information when generating responses.

---

## 👥 Telegram Groups

Nova can operate inside Telegram groups while maintaining:

* Per-group settings
* Group activation state
* Member awareness
* Group-specific memory
* Group-specific prompts
* VIP/group access controls

New groups can remain dormant until explicitly activated.

---

## 🏢 Telegram Business Automation

Nova can integrate with Telegram Business connections for automated private-message replies.

Features include:

* Automatic replies
* Global business prompt
* Per-customer prompt
* Manual override
* Loop detection
* Bot-to-bot protection
* Business connection status

---

## 📱 Telegram Mini App

Nova includes a Telegram Mini App dashboard.

### Dashboard capabilities

* Multiple conversations
* Theme support
* Image uploads
* Image editing
* Voice messages
* Web application builder
* Hosted application management
* Persistent state
* Telegram authentication

### Secure API

Web App endpoints validate Telegram `initData` before allowing authenticated operations.

---

## 👑 Nova Control Center

Administrators can access a dedicated control panel.

### User Management

* User statistics
* VIP management
* Blocking/unblocking
* Usage monitoring

### Group Management

* Group activation
* VIP status
* Dormancy controls
* Group configuration

### Media Management

* Hosted images
* Voice files
* Generated applications

### System Diagnostics

* Gemini key health
* Cloudflare AI account health
* Rate-limit monitoring
* Runtime diagnostics
* System logs

### Administration

Nova also supports natural-language configuration for selected settings.

---

# 🏗️ Architecture

```text
                         ┌──────────────────────┐
                         │      Telegram        │
                         │ Bot + Mini App       │
                         └──────────┬───────────┘
                                    │
                                    ▼
                       ┌────────────────────────┐
                       │   Cloudflare Worker     │
                       │                        │
                       │   Webhook Dispatcher   │
                       │          │             │
                       │          ▼             │
                       │     Gemini Agent       │
                       │   Function Calling     │
                       └──────────┬─────────────┘
                                  │
              ┌───────────────────┼────────────────────┐
              │                   │                    │
              ▼                   ▼                    ▼
        Cloudflare AI       Google Search          Nova Tools
        Flux / Images       Web / Images       PDF / Web / TTS
              │                   │                    │
              └───────────────────┼────────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   Cloudflare D1  │
                         │      SQLite      │
                         └──────────────────┘
```

---

# 🧩 Technology Stack

| Layer            | Technology               |
| ---------------- | ------------------------ |
| Runtime          | Cloudflare Workers       |
| Language         | TypeScript               |
| Database         | Cloudflare D1 / SQLite   |
| AI               | Google Gemini            |
| Image Generation | Cloudflare AI / Flux     |
| Search           | Google Custom Search API |
| Frontend         | Vanilla JavaScript + CSS |
| Telegram UI      | Telegram Mini App        |
| PDF              | Nova Office Engine       |
| Game Engine      | Nova Game Engine         |
| Web Builder      | Nova Web Builder         |

---

# ⚡ Performance & Reliability

Nova is designed specifically for serverless environments and Cloudflare free-tier constraints.

### Concurrency Protection

A keyed mutex is used to prevent conflicting state updates when multiple messages from the same chat arrive concurrently.

### Request Deduplication

Repeated Telegram webhook deliveries can be detected and ignored without unnecessarily executing the complete AI pipeline.

### API Key Pool

Multiple Gemini keys can be rotated automatically when a key becomes unavailable, rate-limited or otherwise unhealthy.

### Group Caching

Frequently requested Telegram group metadata can be cached to reduce unnecessary API requests.

### Write Optimization

State updates can be coalesced and buffered to reduce database/storage traffic.

### Synchronous Critical Operations

Critical operations are intentionally kept inside the request lifecycle rather than relying on background execution for operations that must complete reliably.

---

# 🔐 Security

Nova contains several security mechanisms:

* Telegram webhook secret validation
* Telegram Mini App `initData` validation
* Per-user rate limiting
* Per-chat concurrency protection
* Business loop detection
* API key rotation
* Authentication for administrative features
* Input validation
* Storage isolation

## Important

**Never commit secrets to Git.**

Do not upload:

```text
.env
.dev.vars
wrangler secrets
Telegram bot tokens
Gemini API keys
Cloudflare API tokens
Google Search API keys
Database credentials
Private signing keys
```

Use Cloudflare Worker Secrets instead (`wrangler secret put …`) and a local
`.dev.vars` file (see `.dev.vars.example`) for development.

> `npm test` includes an automated **secret-leak guard** that fails if any
> credential-looking value (bot tokens, `AIza…` keys, `cfat_…` tokens, long
> hex secrets) or credential entry in `wrangler.toml [vars]` is committed —
> run it before every push.

---

# 🚀 Installation

## Requirements

You need:

* Cloudflare account
* Cloudflare Workers
* Cloudflare D1
* Telegram Bot
* Gemini API key
* Node.js
* Wrangler CLI

Optional:

* Cloudflare AI
* Google Custom Search API

---

## 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/nova.git
cd nova
npm install
```

---

## 2. Authenticate Wrangler

```bash
npx wrangler login
```

---

## 3. Create D1

```bash
npx wrangler d1 create nova-db
```

Add the generated database ID to `wrangler.toml`.

Example:

```toml
[[d1_databases]]
binding = "DB"
database_name = "nova-db"
database_id = "<YOUR_DATABASE_ID>"
```

---

## 4. Configure secrets

Example:

```bash
wrangler secret put TOKEN
wrangler secret put BOT_OWNER_ID
wrangler secret put GEMINI_KEY_1
wrangler secret put GEMINI_KEY_2
wrangler secret put CF_ID_1
wrangler secret put CF_TOKEN_1
wrangler secret put GOOGLE_SEARCH_API_KEY
wrangler secret put GOOGLE_SEARCH_ENGINE_ID
wrangler secret put WEBHOOK_SECRET
```

Only configure the services you actually use.

> **Migrating from an older private deployment?** Older builds kept these
> values as inline `[vars]` in `wrangler.toml`. Deploying this version
> **removes** those inline vars, so run all the `wrangler secret put …`
> commands **before** you redeploy, otherwise the bot will stop responding.

---

## 5. Initialize the database

Example:

```sql
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value_text TEXT,
  value_blob BLOB,
  expires_at INTEGER,
  created_at INTEGER
);
```

Use the migration system shipped with the project for additional Nova tables.

---

## 6. Deploy

```bash
npm run deploy
```

---

## 7. Configure Telegram Webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<YOUR_WORKER>.workers.dev/webhook&secret_token=<WEBHOOK_SECRET>"
```

---

# 🧪 Development

Start the local development server:

```bash
cp .dev.vars.example .dev.vars   # then fill in your own test credentials
npm run dev
```

> `.dev.vars` is git-ignored — never commit real credentials.

Type checking:

```bash
npm run type-check
```

Source regression tests (license headers, required files, secret-leak guard):

```bash
npm test
```

Enable GitHub Actions CI (type-check + tests on every push/PR) by renaming
the shipped workflow into place:

```bash
mkdir -p .github/workflows
git mv .github/ci-workflow.example.yml .github/workflows/ci.yml
git commit -m "ci: enable workflow" && git push
```

Live logs:

```bash
npm run tail
```

---

# 💬 Commands

| Command      | Purpose                  |
| ------------ | ------------------------ |
| `/start`     | Start Nova               |
| `/new`       | Start a new conversation |
| `/img`       | Generate an image        |
| `/search`    | Search images            |
| `/web`       | Search the web           |
| `/pdf`       | Generate a PDF           |
| `/myapps`    | List hosted applications |
| `/prompt`    | Manage persona           |
| `/setprompt` | Set custom persona       |
| `/language`  | Change language          |
| `/help`      | Show help                |

## Owner Commands

| Command              | Purpose                            |
| -------------------- | ---------------------------------- |
| `/admin`             | Open admin panel                   |
| `/keys`              | API diagnostics                    |
| `/log`               | System logs                        |
| `/rebuild`           | Database maintenance               |
| `/webapps`           | Manage hosted apps                 |
| `/setvip`            | Enable group VIP                   |
| `/unsetvip`          | Disable group VIP                  |
| `/bizmode`           | Toggle Business automation         |
| `/bizprompt`         | Configure Business prompt          |
| `/bizcustomerprompt` | Configure customer-specific prompt |
| `/bizstatus`         | Business status                    |
| `/eval`              | Development-only code execution    |

> **Security recommendation:** `/eval` should be disabled or strongly restricted in public deployments.

---

# 📁 Project Structure

```text
NOVA/
├── src/
│   ├── index.ts               # Worker entrypoint: webhook, agent, admin, API
│   ├── exportEngine.ts        # Nova Office (PDF/DOCX export engine)
│   ├── gameEngine.ts          # Nova Game Engine
│   ├── webBuilder.ts          # Nova Web Builder prompts/packaging
│   ├── webSearch.ts           # Web search helpers
│   ├── designSkills.ts        # Design-quality heuristics for generated apps
│   ├── novaFont.ts            # Embedded Vazirmatn subset (OFL 1.1) for PDFs
│   ├── dashboard.html         # Telegram Mini App dashboard
│   ├── adminDashboard.html    # Nova Control Center (admin)
│   └── telegram-web-app.txt   # Vendored Telegram bridge script (3rd-party)
│
├── tests/
│   └── source-regression.mjs  # License/secret-leak hygiene tests (npm test)
│
├── .github/
│   ├── ci-workflow.example.yml # CI: rename to workflows/ci.yml to enable
│   ├── ISSUE_TEMPLATE/         # Bug report / feature request templates
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
│
├── package.json
├── tsconfig.json
├── wrangler.toml              # Non-secret configuration only!
├── globals.d.ts
├── .env.example               # Example env for generic tooling
├── .dev.vars.example          # Example secrets for local development
├── .gitignore
├── LICENSE                    # AGPL-3.0-or-later
├── CHANGELOG.md               # Release history
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── THIRD_PARTY_NOTICES.md     # Vazirmatn (OFL), Telegram bridge, services
└── README.md
```

---

# 🤝 Contributing

Nova is open source and contributions are welcome.

Before opening a Pull Request:

1. Read `CONTRIBUTING.md`
2. Run TypeScript checks
3. Test the affected functionality
4. Do not include credentials or secrets
5. Keep changes focused
6. Explain security-sensitive changes clearly

Pull requests affecting authentication, storage, API handling or deployment configuration may require additional review.

---

# 🛡️ Security Research

Do **not** publish exploitable vulnerabilities in GitHub Issues.

Use the private vulnerability reporting mechanism configured for the repository or follow `SECURITY.md`.

GitHub supports private vulnerability reporting for public repositories, allowing researchers to submit vulnerability reports privately to maintainers.

---

# 📜 License

Nova is licensed under:

**GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).**

This means users are free to use, study, modify and redistribute the software under the terms of the license.

For network-accessible modified versions, AGPL includes additional source-availability requirements intended specifically for server software.

See:

```text
LICENSE
```

for the complete license text.

---

# ™️ Nova Trademark

The **Nova**, **ƝØVΛ**, **Nova Control Center**, **Nova Game Engine**, and related project names and logos are project trademarks and branding.

The AGPL license covers the source code unless otherwise stated.

The license does **not** automatically grant permission to use Nova branding in a way that suggests official endorsement, ownership or affiliation.

Forks are welcome, but derivative distributions should clearly identify themselves as independent projects.

---

# ⚠️ Third-Party Services

Nova integrates with third-party services, which may have their own:

* Terms of Service
* API limits
* pricing
* licensing requirements
* acceptable-use policies
* privacy policies

These include, depending on the deployment:

* Telegram
* Cloudflare
* Google Gemini
* Google Custom Search
* Cloudflare AI
* Flux models

Using Nova does not grant rights to bypass or violate those services' policies.

---

# ⚠️ Disclaimer

Nova is provided **"AS IS"**, without warranties of any kind, to the maximum extent permitted by applicable law.

The maintainers are not responsible for:

* deployment problems
* third-party API outages
* API costs
* generated content
* user-created applications
* misuse of the software
* data loss
* security misconfiguration
* violations of third-party service policies

Operators are responsible for securing their own deployments and credentials.

---

# 🗺️ Roadmap

### Current

* [x] Gemini Agent
* [x] Function Calling
* [x] Multi-Key Rotation
* [x] Persistent Memory
* [x] Group Awareness
* [x] Image Generation
* [x] Image Editing
* [x] Web Search
* [x] Web App Hosting
* [x] Game Engine
* [x] TTS
* [x] PDF Engine
* [x] Telegram Mini App
* [x] Admin Dashboard
* [x] Business Automation

### Planned

* [ ] Better agent planning
* [ ] More AI providers
* [ ] Improved tool sandboxing
* [ ] Better observability
* [ ] More database backends
* [ ] Plugin architecture
* [ ] More Mini App features
* [ ] Advanced game-generation capabilities

---

# ❤️ Credits

Built and maintained by:

**Hsoofi82**

Telegram:

[@Hacker1382](https://t.me/Hacker1382)

Bot:

[@MyNovaChatBot](https://t.me/MyNovaChatBot)

---

<div align="center">

### ƝØVΛ

**Open Source AI Agent Platform for Telegram**

Made with 🖤 by Hsoofi82

</div>

---

<a id="persian"></a>

# 🇮🇷 فارسی

<div align="center">

### نوا فقط حرف نمی‌زنه — **کار تحویل می‌ده** 🚀

**۱۰۰٪ رایگان · متن‌باز · روی تلگرام خودت میزبانی کن**

یه پیام بده → وب‌اپ بساز، میزبانی کن، لینکش رو بفرست 🎯

**قبض ماهانه: ۰ تومان — تا همیشه 😎**

</div>

---

## نوا با بقیهٔ چت‌بات‌ها چه فرقی داره؟

| 😴 چت‌بات‌های معمولی | ⚡ ƝØVΛ |
| --- | --- |
| جواب متنی می‌ده | **محصول واقعی تحویل می‌ده** — سایت، بازی، PDF، ویس |
| بعد از هر چت یادش می‌ره | **برایت همیشه یادش می‌مونه** — حافظهٔ بلندمدت و پروفایل |
| فقط توی یه چت جواب می‌ده | **کل تلگرامت رو مدیریت می‌کنه** — گروه، پیام‌های بیزینس، Mini App |
| یک پیام → یک جواب | یک پیام → **یک کار چندمرحله‌ای تمام‌شده** |
| «پلن Pro بخریت 💸» | **۰ تومان — برای همیشه** |
| جعبهٔ سیاه بسته | **کاملاً متن‌باز (AGPL)** — همه‌چیز مال خودته |

---

## Nova چیست؟

**Nova فقط یک چت‌بات نیست.**

Nova یک **پلتفرم متن‌باز ایجنت هوش مصنوعی برای Telegram** است که روی Cloudflare Workers اجرا می‌شود و قابلیت‌های مختلفی مانند حافظه، Function Calling، جستجوی وب، تولید تصویر، ساخت وب‌اپلیکیشن، ساخت بازی، تولید PDF، تولید صدا و Telegram Mini App را در یک سیستم واحد ترکیب می‌کند.

هسته هوش مصنوعی Nova بر پایه Google Gemini طراحی شده و برای تولید تصویر از Cloudflare AI / Flux استفاده می‌کند.

هدف اصلی پروژه این است که Nova بتواند به‌جای اجرای دستورات ساده، **ابزارهای مختلف را به‌صورت چندمرحله‌ای انتخاب و ترکیب کند** تا یک مسئله کامل را حل کند.

---

## ✨ امکانات اصلی

### 🧠 هسته هوش مصنوعی

* Google Gemini
* Function Calling
* اجرای چندمرحله‌ای ابزارها
* چرخش خودکار API Key
* Fallback هوشمند
* حافظه کوتاه‌مدت
* حافظه بلندمدت
* پروفایل کاربر
* آگاهی از اعضای گروه
* پرسونا و Prompt سفارشی
* پشتیبانی فارسی، انگلیسی و عربی

### 🛠️ ابزارهای Agent

* تولید تصویر
* ویرایش تصویر
* جستجوی تصویر
* جستجوی وب
* خواندن صفحات وب
* ساخت PDF
* ساخت و میزبانی Web App
* ساخت بازی HTML5
* Text-to-Speech
* مدیریت Persona

---

## 🎮 موتور بازی Nova

Nova دارای یک Game Engine آزمایشی داخلی برای تولید بازی‌های HTML5 است.

قابلیت‌ها:

* Canvas
* Physics
* Collision
* Particles
* Easing
* Input
* Game Loop
* اجرای مستقیم در مرورگر

---

## 🌐 Web Builder

Nova می‌تواند Web App و بازی‌های HTML5 را تولید کرده و به‌صورت عمومی میزبانی کند.

امکانات:

* طراحی Responsive
* Tailwind CSS
* JavaScript
* localStorage
* Cloud State
* URL عمومی
* سازگاری با Telegram Mini App

---

## 🧠 سیستم حافظه

Nova از حافظه کوتاه‌مدت و بلندمدت استفاده می‌کند.

اطلاعات قابل نگهداری شامل مواردی مانند:

* علایق
* ترجیحات
* پروژه‌ها
* اطلاعات مهم
* سابقه تعامل
* اطلاعات اعضای گروه
* روابط و metadata

---

## 📱 Telegram Mini App

Nova یک داشبورد کامل Telegram Mini App دارد:

* چند مکالمه
* Theme
* آپلود تصویر
* ویرایش تصویر
* پیام صوتی
* Web Builder
* مدیریت Web App
* ذخیره State
* احراز هویت Telegram

---

## 👑 Nova Control Center

پنل مدیریتی Nova برای کنترل موارد زیر استفاده می‌شود:

* کاربران
* گروه‌ها
* VIP
* رسانه‌ها
* Web Appها
* API Keyها
* لاگ‌ها
* آمار مصرف
* وضعیت سرویس‌ها
* Business Automation

---

## 🔐 امنیت

Nova شامل مکانیزم‌هایی مانند:

* Webhook Secret
* Telegram `initData` validation
* Rate Limiting
* Keyed Mutex
* Duplicate Update Protection
* API Key Rotation
* Authentication
* Business Loop Protection

است.

**هیچ Secret، API Key یا Bot Token نباید داخل Git ذخیره شود.**

همه اعتبارنامه‌ها از طریق Worker Secrets (یا `.dev.vars` برای توسعه لوکال) تنظیم شوند؛ فایل `wrangler.toml` فقط باید مقادیر غیرحساس داشته باشد. تست `npm test` یک **گارد نشت سکرت** دارد و اگر مقداری شبیه Token یا API Key در ریپو کامیت شود، شکست می‌خورد.

---

## 🚀 نصب

```bash
git clone https://github.com/YOUR_USERNAME/nova.git
cd nova
npm install
npx wrangler login
```

سپس D1 را ایجاد کرده و Secrets موردنیاز را با Wrangler تنظیم کنید:

```bash
npx wrangler d1 create nova-db     # شناسه دیتابیس را در wrangler.toml بگذارید
npx wrangler secret put TOKEN      # Bot Token تلگرام
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put BOT_OWNER_ID
npx wrangler secret put GEMINI_KEY_1   # ... تا GEMINI_KEY_5
# و در صورت نیاز: CF_ID_1 / CF_TOKEN_1 ... و GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_ENGINE_ID
```

برای توسعه لوکال، فایل `.dev.vars.example` را به `.dev.vars` کپی کنید و مقادیر تست خودتان را داخلش بگذارید (این فایل در `.gitignore` است و هرگز کامیت نمی‌شود).

> **مهاجرت از نسخهٔ خصوصی قبلی؟** نسخه‌های قدیمی این مقادیر را به‌صورت `[vars]` داخل `wrangler.toml` داشتند. دپلوی این نسخه آن varهای قدیمی را **حذف می‌کند**؛ پس قبل از دپلوی دوباره، همه را با `wrangler secret put …` ست کنید وگرنه ربات از کار می‌افتد.

---

## 📜 مجوز

Nova تحت مجوز:

**GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)**

منتشر می‌شود.

هدف این مجوز این است که پروژه برای استفاده، مطالعه، تغییر و توسعه آزاد باشد و در عین حال تغییرات نسخه‌های سرویس‌محور نیز تحت شرایط AGPL قرار بگیرند.

متن کامل مجوز داخل فایل `LICENSE` قرار دارد.

---

## ™️ برند Nova

نام‌ها و برندهای:

* Nova
* ƝØVΛ
* Nova Control Center
* Nova Game Engine

و لوگوهای مرتبط، هویت برند پروژه هستند.

AGPL به‌تنهایی به معنی واگذاری حقوق Trademark نیست.

Fork کردن پروژه آزاد است، اما Forkها نباید طوری ارائه شوند که باعث ایجاد تصور مالکیت یا تأیید رسمی توسط توسعه‌دهنده اصلی شوند.

---

## 🤝 مشارکت

Pull Request و Contribution استقبال می‌شود.

قبل از Contribution:

1. `CONTRIBUTING.md` را بخوانید.
2. تست‌ها و Type Check را اجرا کنید.
3. Secretها را Commit نکنید.
4. تغییرات امنیتی را به‌وضوح توضیح دهید.
5. Pull Requestهای کوچک و متمرکز ایجاد کنید.

---

## 🛡️ گزارش آسیب‌پذیری

آسیب‌پذیری‌های امنیتی را در Issues عمومی منتشر نکنید.

از مکانیزم Private Vulnerability Reporting GitHub یا دستورالعمل‌های `SECURITY.md` استفاده کنید.

---

<div align="center">

# ƝØVΛ

### پلتفرم متن‌باز ایجنت هوش مصنوعی برای Telegram

ساخته شده توسط **Hsoofi82**

</div>
