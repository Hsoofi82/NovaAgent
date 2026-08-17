# Third-Party Notices

Nova (AGPL-3.0-or-later) builds on, embeds, or interoperates with the
following third-party works and services. Each remains under its own license
and terms.

---

## Embedded works

### Vazirmatn font (subset)

* **Files:** `src/novaFont.ts` (embedded base85/base64 TTF subset)
* **License:** SIL Open Font License 1.1
* **Upstream:** https://github.com/rastikerdar/vazirmatn
* **Copyright:** The Vazirmatn Project Authors
  (https://github.com/rastikerdar/vazirmatn/blob/master/OFL.txt)

The embedded subset covers Latin, Arabic, Arabic Presentation Forms A+B and
Persian digits, and is used by the Nova Office PDF engine. The OFL 1.1 license
permits embedding and redistribution; the font itself is **not** relicensed
under the AGPL.

### Telegram Web App bridge script

* **Files:** `src/telegram-web-app.txt` (vendored, unmodified)
* **Origin:** https://telegram.org/js/telegram-web-app.js
* **Copyright:** Telegram Messenger Inc.

The standard Telegram Mini App bridge script served to Mini App clients. It is
vendored verbatim so the Mini App can load it from Nova's own origin and is
**not** part of the AGPL-licensed codebase.

---

## Services used at runtime (subject to their own terms)

Nova's operator (not the Nova authors) holds accounts/keys for these services.
Using them is subject to their terms of service, pricing, rate limits and
acceptable-use policies:

| Service | Used for |
| --- | --- |
| Telegram Bot API / Business / Mini Apps | user interface & automation |
| Google Gemini API | reasoning & function calling |
| Google Custom Search API | web/image search |
| Cloudflare Workers / D1 / AI | compute, database, image generation |
| Flux models (via Cloudflare AI) | image generation |

## Runtime-referenced assets in generated apps

Web apps and games generated *by* Nova commonly reference public CDNs at
runtime (e.g. Tailwind CSS via `cdn.tailwindcss.com`, Google Fonts). Nothing
from these CDNs is bundled with Nova's source distribution.
