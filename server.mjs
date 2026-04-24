#!/usr/bin/env node
/**
 * ix-browser server — Headful Chrome automation for autonomous agents.
 *
 * Launches REAL Chrome.app with a persistent user profile, connects via CDP.
 * No automation fingerprints. No headless. Indistinguishable from human browsing.
 *
 * Fully portable — all paths derived from IX_BROWSER_HOME (default: ~/.ix-browser).
 *
 * Port: 18840 (configurable via BROWSER_PORT env)
 */

import { chromium } from 'playwright-core';
import express from 'express';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config (all derived from IX_BROWSER_HOME) ---
const IX_HOME = process.env.IX_BROWSER_HOME || path.join(process.env.HOME, '.ix-browser');
const PORT = parseInt(process.env.BROWSER_PORT || '18840');
const CHROME_DEBUG_PORT = parseInt(process.env.CHROME_DEBUG_PORT || '9222');
const PROFILE_DIR = process.env.BROWSER_PROFILE || path.join(IX_HOME, 'profiles/default');
const SCREENSHOT_DIR = path.join(IX_HOME, 'screenshots');
const CHROME_PATH = process.env.CHROME_PATH || detectChrome();

function detectChrome() {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
      ];
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch {}
  }
  return candidates[0]; // fallback — will error clearly at launch
}

// --- State ---
let browser = null;
let activePageIndex = 0;

// --- Setup directories ---
for (const dir of [PROFILE_DIR, SCREENSHOT_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Human-like timing ---
function humanDelay(min = 80, max = 200) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

// --- Chrome lifecycle ---
function isChromeRunning() {
  try {
    execSync(
      `curl -sf http://localhost:${CHROME_DEBUG_PORT}/json/version`,
      { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return true;
  } catch { return false; }
}

function launchChrome() {
  if (isChromeRunning()) {
    console.log(`[ix-browser] Chrome already running on debug port ${CHROME_DEBUG_PORT}`);
    return;
  }

  console.log(`[ix-browser] Launching Chrome: ${CHROME_PATH}`);
  const chromeArgs = [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1440,900',
    '--window-position=0,0',
  ];
  if (process.platform === 'linux') {
    chromeArgs.push('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage');
  }
  const proc = spawn(CHROME_PATH, chromeArgs, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
  });
  proc.unref();
}

async function connectBrowser() {
  if (browser?.isConnected()) return;
  browser = null;

  launchChrome();

  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP(
        `http://localhost:${CHROME_DEBUG_PORT}`
      );
      console.log('[ix-browser] Connected to Chrome via CDP');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('Failed to connect to Chrome after 15s');
}

// --- Page management ---
async function getPages() {
  await connectBrowser();
  const contexts = browser.contexts();
  const pages = [];
  for (const ctx of contexts) {
    pages.push(...ctx.pages());
  }
  return pages;
}

async function getActivePage() {
  const pages = await getPages();
  if (pages.length === 0) {
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    activePageIndex = 0;
    return page;
  }
  if (activePageIndex >= pages.length) activePageIndex = pages.length - 1;
  return pages[activePageIndex];
}

// --- DOM extraction ---
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="textbox"]',
  '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
  '[role="menuitem"]', '[role="switch"]', '[role="combobox"]',
  '[contenteditable="true"]', '[tabindex]',
  'summary', 'details',
].join(', ');

async function extractPage(page) {
  const title = await page.title();
  const url = page.url();

  const extraction = await page.evaluate((selector) => {
    const interactive = [];
    const seen = new Set();
    const allEls = document.querySelectorAll(selector);

    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.opacity === '0') continue;

      const posKey = `${Math.round(rect.x)},${Math.round(rect.y)}`;
      if (seen.has(posKey)) continue;
      seen.add(posKey);

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || '';
      const text = (el.innerText || el.textContent || '').trim().substring(0, 80);
      const placeholder = el.getAttribute('placeholder') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const name = el.getAttribute('name') || '';
      const href = tag === 'a' ? (el.getAttribute('href') || '').substring(0, 150) : '';
      const value = ('value' in el) ? (el.value || '').substring(0, 80) : '';
      const checked = el.checked;
      const disabled = el.disabled;
      const role = el.getAttribute('role') || '';

      let label = ariaLabel || text || placeholder || name || role || tag;
      if (label.length > 80) label = label.substring(0, 77) + '...';

      interactive.push({
        i: interactive.length,
        tag, type, label, href, value,
        checked: checked || undefined,
        disabled: disabled || undefined,
      });
    }

    const walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const t = p.tagName.toLowerCase();
          if (['script','style','noscript','svg'].includes(t)) return NodeFilter.FILTER_REJECT;
          const s = window.getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const texts = [];
    let totalLen = 0;
    const MAX_TEXT = 8000;
    while (walker.nextNode() && totalLen < MAX_TEXT) {
      const t = walker.currentNode.textContent.trim();
      if (t.length > 1) {
        texts.push(t);
        totalLen += t.length;
      }
    }

    return { interactive, bodyText: texts.join('\n') };
  }, INTERACTIVE_SELECTOR);

  return { title, url, elements: extraction.interactive, bodyText: extraction.bodyText };
}

function formatPage(content) {
  let md = `# ${content.title || '(no title)'}\n`;
  md += `**URL:** ${content.url}\n\n`;

  if (content.elements.length > 0) {
    md += '## Interactive Elements\n';
    for (const el of content.elements) {
      let line = `[${el.i}] ${el.tag}`;
      if (el.type) line += `[${el.type}]`;
      line += `: ${el.label}`;
      if (el.href) line += ` → ${el.href}`;
      if (el.value) line += ` (value: ${el.value})`;
      if (el.checked) line += ' ✓';
      if (el.disabled) line += ' (disabled)';
      md += `- ${line}\n`;
    }
  }

  md += `\n## Page Content\n${content.bodyText}\n`;
  return md;
}

// --- Element targeting ---
async function findElement(page, target) {
  const idx = parseInt(target);

  if (!isNaN(idx)) {
    const found = await page.evaluate((args) => {
      const { selector, idx } = args;
      const interactive = [];
      const seen = new Set();
      for (const el of document.querySelectorAll(selector)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (style.opacity === '0') continue;
        const posKey = `${Math.round(rect.x)},${Math.round(rect.y)}`;
        if (seen.has(posKey)) continue;
        seen.add(posKey);
        interactive.push(el);
      }
      if (idx < 0 || idx >= interactive.length) return false;
      document.querySelectorAll('[data-ix-target]').forEach(e => e.removeAttribute('data-ix-target'));
      interactive[idx].setAttribute('data-ix-target', 'true');
      interactive[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }, { selector: INTERACTIVE_SELECTOR, idx });

    if (!found) throw new Error(`Element index ${idx} not found (out of range)`);
    return '[data-ix-target="true"]';
  }

  const textTarget = String(target);

  const strategies = [
    () => page.getByText(textTarget, { exact: false }),
    () => page.getByRole('button', { name: textTarget }),
    () => page.getByRole('link', { name: textTarget }),
    () => page.getByLabel(textTarget),
    () => page.getByPlaceholder(textTarget),
  ];

  for (const strategy of strategies) {
    const locator = strategy();
    if (await locator.count() > 0) {
      const first = locator.first();
      if (await first.isVisible()) return first;
    }
  }

  throw new Error(`Could not find element matching: ${textTarget}`);
}

async function cleanupMarkers(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-ix-target]').forEach(e => e.removeAttribute('data-ix-target'));
  }).catch(() => {});
}

// --- Express server ---
const app = express();
app.use(express.json());

// TIME_WAIT mitigation: force server-initiated close so TIME_WAITs land on
// the server's 18840 tuple instead of the client's ephemeral pool. Combined
// with SO_LINGER=0 below (RST-close on connection end), this keeps heavy
// automation loops (Selena PIV cycles, Finn browser ops) from saturating
// the kernel's ephemeral port range. See memory/2026-04-23.md for the
// incident that surfaced this — M3 hit 45K TIME_WAITs, kernel refused to
// allocate source ports, selena-ui's runner became unreachable from itself.
app.use((req, res, next) => {
  res.setHeader('Connection', 'close');
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connected: browser?.isConnected() || false,
    chromeRunning: isChromeRunning(),
    port: PORT,
    chromeDebugPort: CHROME_DEBUG_PORT,
    profile: PROFILE_DIR,
    screenshotDir: SCREENSHOT_DIR,
    home: IX_HOME,
  });
});

app.get('/status', async (req, res) => {
  try {
    const pages = await getPages();
    const active = await getActivePage();
    res.json({
      connected: true,
      tabs: pages.map((p, i) => ({
        index: i,
        title: p.url(),
        active: i === activePageIndex,
      })),
      activeTab: activePageIndex,
      currentUrl: active.url(),
      currentTitle: await active.title(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/navigate', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const page = await getActivePage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(300, 800);
    const content = await extractPage(page);
    res.json({ ok: true, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/read', async (req, res) => {
  try {
    const page = await getActivePage();
    const content = await extractPage(page);
    res.json({ ok: true, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/read', async (req, res) => {
  try {
    const page = await getActivePage();
    const content = await extractPage(page);
    res.json({ ok: true, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/click', async (req, res) => {
  try {
    const { target } = req.body;
    if (target === undefined) return res.status(400).json({ error: 'target required (index or text)' });
    const page = await getActivePage();
    const locator = await findElement(page, target);

    await humanDelay(100, 250);

    if (typeof locator === 'string') {
      await page.click(locator);
    } else {
      await locator.click();
    }

    await cleanupMarkers(page);
    await humanDelay(300, 600);
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

    const content = await extractPage(page);
    res.json({ ok: true, clicked: String(target), page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/type', async (req, res) => {
  try {
    const { target, value, clear } = req.body;
    if (target === undefined || value === undefined)
      return res.status(400).json({ error: 'target and value required' });

    const page = await getActivePage();
    const locator = await findElement(page, target);

    await humanDelay(80, 200);

    if (typeof locator === 'string') {
      if (clear !== false) await page.fill(locator, '');
      await page.type(locator, String(value), { delay: 30 + Math.random() * 50 });
    } else {
      if (clear !== false) await locator.fill('');
      await locator.type(String(value), { delay: 30 + Math.random() * 50 });
    }

    await cleanupMarkers(page);
    await humanDelay(100, 300);

    const content = await extractPage(page);
    res.json({ ok: true, typed: value, into: String(target), page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/screenshot', async (req, res) => {
  try {
    const page = await getActivePage();
    const filename = `screenshot-${Date.now()}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: req.body?.fullPage || false });
    res.json({ ok: true, path: filepath, filename });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/scroll', async (req, res) => {
  try {
    const { direction = 'down', amount = 500 } = req.body || {};
    const page = await getActivePage();
    const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
    await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), delta);
    await humanDelay(300, 500);
    const content = await extractPage(page);
    res.json({ ok: true, scrolled: direction, amount, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/wait', async (req, res) => {
  try {
    const { text, selector, timeout = 10000 } = req.body;
    const page = await getActivePage();

    if (text) {
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t),
        text,
        { timeout }
      );
    } else if (selector) {
      await page.waitForSelector(selector, { timeout, state: 'visible' });
    } else {
      return res.status(400).json({ error: 'text or selector required' });
    }

    const content = await extractPage(page);
    res.json({ ok: true, found: text || selector, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/back', async (req, res) => {
  try {
    const page = await getActivePage();
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await humanDelay(300, 600);
    const content = await extractPage(page);
    res.json({ ok: true, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/forward', async (req, res) => {
  try {
    const page = await getActivePage();
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await humanDelay(300, 600);
    const content = await extractPage(page);
    res.json({ ok: true, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/tab', async (req, res) => {
  try {
    const { action = 'list', index, url } = req.body;
    const pages = await getPages();

    switch (action) {
      case 'list':
        res.json({
          ok: true,
          tabs: pages.map((p, i) => ({
            index: i,
            url: p.url(),
            active: i === activePageIndex,
          })),
        });
        return;

      case 'switch':
        if (index === undefined) return res.status(400).json({ error: 'index required' });
        if (index < 0 || index >= pages.length)
          return res.status(400).json({ error: `index out of range (0-${pages.length - 1})` });
        activePageIndex = index;
        await pages[index].bringToFront();
        const switchContent = await extractPage(pages[index]);
        res.json({ ok: true, switched: index, page: formatPage(switchContent) });
        return;

      case 'new': {
        const ctx = browser.contexts()[0];
        const newPage = await ctx.newPage();
        if (url) await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const allPages = await getPages();
        activePageIndex = allPages.indexOf(newPage);
        const newContent = await extractPage(newPage);
        res.json({ ok: true, opened: activePageIndex, page: formatPage(newContent) });
        return;
      }

      case 'close': {
        const closeIdx = index ?? activePageIndex;
        if (pages.length <= 1)
          return res.status(400).json({ error: 'cannot close last tab' });
        await pages[closeIdx].close();
        if (activePageIndex >= closeIdx && activePageIndex > 0) activePageIndex--;
        res.json({ ok: true, closed: closeIdx });
        return;
      }

      default:
        res.status(400).json({ error: `unknown action: ${action}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/select', async (req, res) => {
  try {
    const { target, value } = req.body;
    if (target === undefined || value === undefined)
      return res.status(400).json({ error: 'target and value required' });
    const page = await getActivePage();
    const locator = await findElement(page, target);

    if (typeof locator === 'string') {
      await page.selectOption(locator, value);
    } else {
      await locator.selectOption(value);
    }

    await cleanupMarkers(page);
    const content = await extractPage(page);
    res.json({ ok: true, selected: value, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evaluate', async (req, res) => {
  try {
    const { script } = req.body;
    if (!script) return res.status(400).json({ error: 'script required' });
    const page = await getActivePage();
    const result = await page.evaluate(script);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/key', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'key required (e.g. Enter, Escape, Tab)' });
    const page = await getActivePage();
    await humanDelay(50, 150);
    await page.keyboard.press(key);
    await humanDelay(200, 400);
    const content = await extractPage(page);
    res.json({ ok: true, pressed: key, page: formatPage(content) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Auto-reconnect ---
async function ensureConnection() {
  if (!browser?.isConnected()) {
    console.log('[ix-browser] Connection lost, reconnecting...');
    browser = null;
    await connectBrowser();
  }
}
setInterval(ensureConnection, 10000);

// --- Start ---
async function start() {
  await connectBrowser();
  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`[ix-browser] Server listening on http://127.0.0.1:${PORT}`);
    console.log(`[ix-browser] Home: ${IX_HOME}`);
    console.log(`[ix-browser] Chrome profile: ${PROFILE_DIR}`);
    console.log(`[ix-browser] Screenshots: ${SCREENSHOT_DIR}`);
    console.log(`[ix-browser] Chrome debug port: ${CHROME_DEBUG_PORT}`);
  });

  // Pair with the `Connection: close` middleware above — server initiates
  // FIN so TIME_WAITs accumulate on the server's 18840 tuple instead of the
  // client's ephemeral pool. Heavy automation loops (Selena PIV, Finn
  // browser ops) no longer saturate the kernel's ephemeral port range. See
  // memory/2026-04-23.md for the M3 port-exhaustion incident that surfaced
  // this.
  server.on('connection', (socket) => { socket.setNoDelay(true); });
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;
}

start().catch(e => {
  console.error('[ix-browser] Failed to start:', e.message);
  process.exit(1);
});
