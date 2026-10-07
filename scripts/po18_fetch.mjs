#!/usr/bin/env node
// PO18 小说抓取脚本（novel-scraper skill）
// 核心机制：正文走 /books/{bid}/articlescontent/{pid} 纯文本接口，
//          需在章节页上下文中页面内 fetch（Referer 自动为章节页，直接访问会被 302 到首页）。
//
// 用法:
//   node po18_fetch.mjs <书籍URL或book_id> [--cookies <cookie.json>] [--state <storage.json>]
//                       [--out <目录>] [--paid] [--list]
// 示例:
//   node po18_fetch.mjs https://www.po18.tw/books/903172/articles --cookies po18_cookies.json
//   node po18_fetch.mjs 903172 --out ./小说
//
// 认证（三选一，优先级 state > cookies > 手动登录）:
//   --cookies  Chrome 导出的 cookie JSON 数组（推荐，见 references/po18.md）
//   --state    Playwright storageState JSON（浏览器登录一次后保存）
//   都没有    脚本会打开登录页让你手动登录，然后可加 --save-state 保存
//
// 依赖: npm install -g patchright（走系统代理，需能访问 po18.tw）

import fs from 'node:fs';
import path from 'node:path';

// ---------- 参数 ----------
function parseArgs(argv) {
  const opts = { book: null, cookies: 'po18_cookies.json', state: null, out: '.', paid: false, saveState: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cookies') opts.cookies = argv[++i];
    else if (a === '--state') opts.state = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--paid') opts.paid = true;
    else if (a === '--save-state') opts.saveState = true;
    else if (a === '--list') opts.list = true;
    else opts.book = a;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const BOOK = opts.book || (console.error('用法: node po18_fetch.mjs <书籍URL或book_id> [--cookies f.json] [--state s.json] [--out dir] [--paid] [--list]') || process.exit(1));
const BID = (String(BOOK).match(/books\/(\d+)/) || String(BOOK).match(/^(\d+)$/) || [])[1];
if (!BID) { console.error('无法从参数解析 book id:', BOOK); process.exit(1); }

async function loadPatchright() {
  try { return await import('patchright'); } catch {}
  try { return await import('file:///C:/Users/zouya/AppData/Roaming/npm/node_modules/patchright/index.mjs'); } catch {}
  console.error('未找到 patchright，请先: npm install -g patchright');
  process.exit(1);
}

// cookie JSON（Chrome 导出格式）→ Playwright cookie 数组
function toPlaywrightCookies(file) {
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
    httpOnly: !!c.httpOnly, secure: !!c.secure,
  }));
}

// ---------- 正文解析 ----------
// articlescontent 返回结构（<p> 不闭合）:
//   <h1>标题</h1><p>段落<blockquote class='copyright'>随机串</blockquote><p>段落…
function parseArticleHtml(html) {
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';
  let body = html
    .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '') // 防爬水印
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const paras = body.split('\n')
    .map(s => s
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[\u3000\u00a0]/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim())
    .filter(Boolean);
  return { title, paras };
}

// ---------- 主流程 ----------
const { chromium } = await loadPatchright();
const RAW_FILE = path.join(opts.out, `po18_${BID}_raw.json`);
const done = fs.existsSync(RAW_FILE) ? JSON.parse(fs.readFileSync(RAW_FILE, 'utf8')) : { title: '', author: '', chapters: [] };
const doneIds = new Set(done.chapters.map(c => c.pid));

const pwCookies = toPlaywrightCookies(opts.cookies);
const browser = await chromium.launch({ headless: !opts.saveState });
const ctx = await browser.newContext({
  locale: 'zh-TW',
  storageState: opts.state && fs.existsSync(opts.state) ? opts.state : undefined,
});
if (pwCookies) await ctx.addCookies(pwCookies);
const page0 = await ctx.newPage();
let page = page0;

// 1) 认证：无凭证时打开登录页手动登录
async function ensureLogin() {
  await page.goto(`https://www.po18.tw/books/${BID}/articles`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  let logged = await page.evaluate(() => !!document.querySelector('.logout, a[href*="logout"]'));
  if (!logged) {
    console.log('未检测到登录态，打开登录页…请手动登录后回车继续（headless 模式请改用 --cookies / --state）');
    await browser.close();
    const b2 = await chromium.launch({ headless: false });
    const c2 = await b2.newContext();
    if (pwCookies) await c2.addCookies(pwCookies);
    const p2 = await c2.newPage();
    await p2.goto('https://members.po18.tw/apps/login.php', { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('.logout, a[href*="logout"]', { timeout: 300000 });
    if (opts.saveState) {
      const st = await c2.storageState();
      fs.writeFileSync(opts.state || 'po18_state.json', JSON.stringify(st, null, 2), 'utf8');
      console.log('已保存登录态 →', opts.state || 'po18_state.json');
    }
    await b2.close();
    // 重新用保存的 state 建立上下文
    const ctx2 = await browser.newContext({ locale: 'zh-TW', storageState: opts.state || 'po18_state.json' });
    if (pwCookies) await ctx2.addCookies(pwCookies);
    return ctx2.newPage();
  }
  return page;
}

page = await ensureLogin();

// 2) 目录（含分页）
async function fetchCatalogPage(pg) {
  const url = `https://www.po18.tw/books/${BID}/articles` + (pg > 1 ? `?page=${pg}` : '');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return page.evaluate(() => {
    const q = s => document.querySelector(s);
    const meta = {
      title: q('.book_info>h1')?.innerText.trim() || '',
      author: q('.author>h2')?.innerText.trim() || '',
      items: [],
      maxPage: 1,
    };
    for (const li of document.querySelectorAll('#w0>div')) {
      const rawHref = li.querySelector('.l_btn>a')?.getAttribute('href') || '';
      const href = rawHref && !/^javascript/i.test(rawHref) ? rawHref : null;
      meta.items.push({
        counter: li.querySelector('.l_counter')?.innerText.trim() || '',
        name: li.querySelector('.l_chaptname')?.innerText.trim() || '',
        href,
        paid: !href, // 无真实链接（javascript:）= 付费/不可读
      });
    }
    const pages = [...document.querySelectorAll('.pagenum a')]
      .map(a => (a.getAttribute('href') || '').match(/page=(\d+)/))
      .filter(Boolean).map(m => +m[1]);
    meta.maxPage = pages.length ? Math.max(...pages) : 1;
    return meta;
  });
}

const c1 = await fetchCatalogPage(1);
const catalog = { title: c1.title, author: c1.author, items: [...c1.items] };
for (let p = 2; p <= c1.maxPage; p++) catalog.items.push(...(await fetchCatalogPage(p)).items);
done.title = done.title || catalog.title;
done.author = done.author || catalog.author;
console.log(`《${catalog.title}》 ${catalog.author} | 共 ${catalog.items.length} 章（付费 ${catalog.items.filter(i => i.paid).length}）`);

if (opts.list) {
  catalog.items.forEach(i => console.log(`${i.counter} ${i.name}${i.paid ? ' [付费]' : ''}`));
  await browser.close();
  process.exit(0);
}

// 3) 建立章节页上下文（articlescontent 的 Referer 依赖它）
const firstFree = catalog.items.find(i => !i.paid);
if (!firstFree) { console.error('没有可读的免费章节（可能未登录或 cookie 失效）'); process.exit(1); }
await page.goto(`https://www.po18.tw${firstFree.href}`, { waitUntil: 'domcontentloaded', timeout: 90000 });

// 4) 逐章抓取
// 关键：articlescontent 校验 Referer 必须是对应章节自身的 /articles/{pid} 页面。
// 页面内 fetch 无法伪造 Referer，所以每章先 goto 该章节页，再页面内 fetch；
// Referer 不匹配时服务器返回 GTM JS 壳页（window.dataLayer…），据此识别重试。
async function fetchChapter(pid, retries = 3) {
  for (let a = 1; a <= retries; a++) {
    try {
      await page.goto(`https://www.po18.tw/books/${BID}/articles/${pid}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const r = await page.evaluate(async (u) => {
        const resp = await fetch(u, { credentials: 'include' });
        return { status: resp.status, text: await resp.text() };
      }, `/books/${BID}/articlescontent/${pid}`);
      if (r.status === 200 && r.text.length > 300) {
        const { title, paras } = parseArticleHtml(r.text);
        const isShell = paras.some(p => /dataLayer|function\s*\(|<\/?script/i.test(p));
        if (paras.length && !isShell) return { title, paras };
      }
      if (r.status === 302 || r.status === 301) { console.log('  会话失效(302)，需更新 cookie'); return null; }
    } catch {}
    await page.waitForTimeout(1200 + Math.random() * 900);
  }
  return null;
}

const targets = catalog.items.filter(i => (opts.paid || !i.paid) && !doneIds.has(i.href?.split('/').pop()));
let okCount = 0, failList = [];
for (let idx = 0; idx < targets.length; idx++) {
  const it = targets[idx];
  const pid = it.href?.split('/').pop();
  process.stdout.write(`[${done.chapters.length + 1}/${catalog.items.filter(i => opts.paid || !i.paid).length}] ${it.counter} ${it.name} … `);
  const ch = await fetchChapter(pid);
  if (ch) {
    done.chapters.push({ pid, counter: it.counter, name: it.name, title: ch.title || it.name, paras: ch.paras });
    doneIds.add(pid); okCount++;
    console.log(`${ch.paras.length} 段 OK`);
  } else { failList.push(it); console.log('失败'); }
  fs.writeFileSync(RAW_FILE, JSON.stringify(done, null, 2), 'utf8'); // 每章落盘（断点续传）
  await page.waitForTimeout(600 + Math.random() * 500);
}

// 5) 生成 txt
if (done.chapters.length) {
  done.chapters.sort((a, b) => a.counter.localeCompare(b.counter));
  const out = [`《${done.title || catalog.title}》`, `作者：${done.author || catalog.author}`, '', ''];
  for (const ch of done.chapters) {
    const num = parseInt(ch.counter, 10);
    out.push(num ? `第${num}章 ${ch.name}` : ch.name);
    out.push('');
    out.push(ch.paras.join('\n\n'));
    out.push('', '');
  }
  const finalText = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const fname = `《${done.title || catalog.title}》by${done.author || catalog.author}.txt`.replace(/[\\/:*?"<>|]/g, '');
  const dest = path.join(opts.out, fname);
  fs.writeFileSync(dest, finalText, 'utf8');
  console.log(`\n完成：成功 ${done.chapters.length} 章（本次 ${okCount}，失败 ${failList.length}）`);
  console.log('txt →', dest, `(${finalText.length} 字)`);
  if (failList.length) console.log('失败章节:', failList.map(i => i.counter + ' ' + i.name).join('、'), '\n重跑脚本即可续传补抓');
}

await browser.close();
