# ix-browser

**Headful Chrome automation that doesn't look like automation.**

Give your AI agent a real browser. Real Chrome, real profile, real cookies, real fingerprint. Talk to it over HTTP from any language — `curl`, a Claude Code skill, a Python script, a cron job. Your agent sees what a human sees and clicks what a human clicks.

Built by [INFINITX](https://infinitxai.com) to run the autonomous agents we ship to our customers. Open-sourced because every AI agent needs hands.

> **Building autonomous businesses on Claude Code?** ix-browser is one of the open tools from INFINITX. We share the full playbook and the private toolkit inside the **AI Agents For Everything** on Skool.
> **Join → https://www.skool.com/ai-growth-collective**

---

## Why ix-browser

Most "browser automation for AI" today is one of two things:

1. **Headless Playwright / Puppeteer** — fast, but every modern site fingerprints it. Cloudflare, hCaptcha, login walls, anti-bot heuristics. Your agent gets soft-blocked or hard-banned and you don't always find out.
2. **A SaaS scraping API** — pay per call, no profile, no session continuity, no logged-in state. Great for one-shot scrapes, useless for an agent that needs to *be somewhere* and *do something over time*.

ix-browser is the third option: **the actual Google Chrome.app on your machine, launched with a persistent user profile, controlled over the DevTools Protocol.** Same User-Agent as a real user, same TLS fingerprint, same JS engine quirks, same persistent cookies. Once you log in, you're logged in.

A single Node process exposes a tiny HTTP API on `localhost:18840`. Your agent POSTs `{"url": "..."}` to `/navigate` and gets back the page rendered as markdown with every interactive element numbered. Click element 7. Type into element 3. Take a screenshot. Read again.

## What you get

- **Real Chrome** — not Chromium, not headless. Launches `Google Chrome.app` (macOS) or `google-chrome` (Linux) with `--remote-debugging-port` and connects via CDP.
- **Persistent profile** — cookies, sessions, extensions, saved logins all survive restarts. Log in once.
- **Indexed markdown reads** — every page comes back as readable text with `[1]`, `[2]`, `[3]` markers on clickable elements. Agents click by index *or* by visible text — both work.
- **Human-paced input** — randomized delays on every keystroke and click. No "type 4000 chars in 12ms" tell.
- **Single endpoint per action** — `/navigate`, `/read`, `/click`, `/type`, `/screenshot`, `/scroll`, `/wait`, `/back`, `/forward`, `/tab`, `/select`, `/evaluate`. That's it. Curl-able from anywhere.
- **Bash CLI included** — `browser.sh navigate https://...`, `browser.sh read`, `browser.sh click 7`. Drop-in for any shell script or Claude Code skill.
- **Portable** — single repo, zero global state. Everything under `~/.ix-browser/` (or wherever you point `IX_BROWSER_HOME`). Move it, copy it, run multiple instances on different ports.
- **TIME_WAIT-safe** — server-initiated connection close keeps heavy automation loops from exhausting your kernel's ephemeral port range. (Yes, this matters once you start running real agents.)

## Quick start

```bash
git clone https://github.com/Trejon-888/ix-browser.git ~/.ix-browser
cd ~/.ix-browser
bash setup.sh
./browser.sh start
./browser.sh navigate https://news.ycombinator.com
./browser.sh read
./browser.sh click 7
```

That's the whole loop. `read` gives you the page; `click` takes the index it printed.

### From any language

```bash
curl -X POST http://localhost:18840/navigate \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'

curl http://localhost:18840/read

curl -X POST http://localhost:18840/click \
  -H 'Content-Type: application/json' \
  -d '{"target":"Sign in"}'
```

### From a Claude Code agent

Drop the `browser.sh` CLI on PATH and your agent can drive Chrome with normal shell calls. We ship it as part of every INFINITX autonoma — it's the difference between an agent that talks about the web and one that *uses* it.

## Configuration

All via environment variables. Sensible defaults — you usually don't need any of these.

| Variable | Default | What |
|----------|---------|------|
| `IX_BROWSER_HOME` | `~/.ix-browser` | Root for profile, screenshots, logs, pid file |
| `BROWSER_PORT` | `18840` | HTTP API port |
| `CHROME_DEBUG_PORT` | `9222` | Chrome remote-debugging port |
| `BROWSER_PROFILE` | `$IX_BROWSER_HOME/profiles/default` | Chrome user-data-dir |
| `CHROME_PATH` | auto-detected | Chrome executable |

Want multiple isolated browsers (one per agent identity)? Run multiple instances:

```bash
IX_BROWSER_HOME=~/.ix-browser-research BROWSER_PORT=18841 CHROME_DEBUG_PORT=9223 ./browser.sh start
IX_BROWSER_HOME=~/.ix-browser-sales    BROWSER_PORT=18842 CHROME_DEBUG_PORT=9224 ./browser.sh start
```

Each one has its own Chrome profile, its own cookies, its own logged-in state.

## API reference

| Method | Endpoint | Body | Returns |
|--------|----------|------|---------|
| GET  | `/health` | — | server + Chrome status |
| POST | `/navigate` | `{url}` | page markdown |
| GET  | `/read` | — | page markdown |
| POST | `/click` | `{target}` (index or visible text) | page markdown |
| POST | `/type` | `{target, value}` | page markdown |
| POST | `/key` | `{key}` (`Enter`, `Tab`, etc.) | page markdown |
| POST | `/select` | `{target, value}` | page markdown |
| POST | `/screenshot` | `{fullPage?}` | `{path}` |
| POST | `/scroll` | `{direction, amount}` | page markdown |
| POST | `/wait` | `{text, timeout}` | page markdown |
| POST | `/back` / `/forward` | — | page markdown |
| POST | `/tab` | `{action: list\|new\|close\|switch, ...}` | tab info |
| POST | `/evaluate` | `{script}` | `{result}` |

Page reads come back as markdown with interactive elements indexed inline (`[1] Sign in`, `[2] Search box`, etc.) — the format LLMs read well and can act on without parsing HTML.

## macOS LaunchAgent

`setup.sh` offers to install a LaunchAgent that auto-restarts the server on crash. Optional — skip it if you'd rather manage the process yourself.

## What this is *not*

- Not a scraper. It's a browser with an API. Build the scraper on top.
- Not headless. The Chrome window is visible by design (that's how anti-bot heuristics decide you're real). Run it on a desktop, a Mac mini, an RDP host — wherever you can keep a desktop session alive.
- Not a CAPTCHA solver. If a site throws hCaptcha at you, ix-browser lets you solve it manually once and the cookie persists. Subsequent runs sail through.

## INFINITX

ix-browser powers the autonomous agents we deploy for customers across sales, content, ops, and community work — every one of them needs hands on the web, and this is what we built. More on the platform at [infinitxai.com](https://infinitxai.com).

Want to build this way yourself? Join the **AI Agents For Everything** on Skool — the community and toolkit for building autonomous businesses on Claude Code: [skool.com/ai-growth-collective](https://www.skool.com/ai-growth-collective).

## License

MIT. Use it, fork it, ship it. PRs welcome.
