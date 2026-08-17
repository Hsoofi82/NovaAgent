# Contributing to Nova

Thanks for your interest in contributing! 🖤

Nova is free software licensed under the **GNU Affero General Public License
v3.0 or later (AGPL-3.0-or-later)** — see [`LICENSE`](LICENSE).

> **License note:** By submitting a contribution (pull request, patch, or
> commit) to this repository, you agree that your contribution is licensed
> under AGPL-3.0-or-later and can be redistributed under those terms.

---

## 🧰 Development setup

```bash
# 1. Clone
git clone https://github.com/Hsoofi82/NovaAgent.git
cd NOVA

# 2. Install dependencies
npm install

# 3. Create your local secrets file (git-ignored)
cp .dev.vars.example .dev.vars
# ... fill in your own values

# 4. Create a D1 database and put its ID in wrangler.toml
npx wrangler login
npx wrangler d1 create nova-db

# 5. Run the local dev server
npm run dev
```

---

## ✅ Before opening a Pull Request

1. Run the type checker:

   ```bash
   npm run type-check
   ```

2. Run the tests:

   ```bash
   npm test
   ```

3. Test the affected functionality locally (`npm run dev` + a Telegram bot
   token of your own).

4. **Never commit credentials or secrets.** Do not add real tokens, API keys,
   bot tokens, database IDs, or personal data to `wrangler.toml`, source
   files, tests, or screenshots. The regression test (`npm test`) fails if a
   secret-looking value is committed.

5. Keep changes small and focused. One PR = one topic.

6. Explain security-sensitive changes clearly (auth, storage, webhooks,
   admin features). These may require extra review.

---

## 📐 Code guidelines

* TypeScript, strict mode. No `any` unless there is no sane alternative.
* Follow the existing style of the file you are touching.
* Prefer small, well-named helpers over growing single functions further.
* Nova targets Cloudflare Workers — remember:
  * No Node-only APIs without `nodejs_compat` support.
  * Keep cold-start weight in mind for very large bundled assets.
  * D1/SQLite is the only persistent store.

---

## 🐛 Reporting bugs & requesting features

* Bugs: open an issue using the **Bug report** template.
* Features: open an issue using the **Feature request** template.
* Security vulnerabilities: **do not** open a public issue — follow
  [`SECURITY.md`](SECURITY.md).

---

## 🌿 Pull request process

1. Fork / branch from `main`.
2. Make your changes and commit with a clear message.
3. Push and open a Pull Request against `main`, filling in the PR template.
4. CI (type-check + tests) must pass.
5. Address review feedback.

Thank you for helping Nova grow! 🚀
