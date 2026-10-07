# 案例记录

下面两个案例展示这套方法论如何在不同类型的站点上落地。已做去站点化处理，只保留可复用的技术结论。

---

## 案例一：加密 API 的 SPA 站

**任务**：抓取某 SPA 小说站的一本书，并剔除正文里的防盗广告。

### 1. 探测（site-detection.md）

`fetch` 主页只返回约 800 字节的空壳 `<div id="app"></div>` + 两个 JS → 判定为 **CSR（SPA）**，且无 Cloudflare、无登录。

### 2. 逆向 API（api-reverse.md）

从站点的 `common.js` / `read.js` 中搜到关键函数：

```js
function url_chapter(id, chapterid) { return `/book/${id}/${chapterid}.html`; }
function get_api(action, params) {
  return gethost() + '/api/' + action + '?token=' + encodeURIComponent(enaes(JSON.stringify(params)));
}
```

`enaes` 是 AES-CBC 加密，但**不必手动还原**——直接在 Playwright 页面里调用站点自己的函数：

```js
const url = await page.evaluate(p => get_api('chapter', p), { id: 121165, chapterid: 1 });
const data = await page.evaluate(async u => (await fetch(u)).json(), url);
// → { id, chapterid, chaptername, cs, txt, ... }
```

### 3. 清洗（cleaning.md）

正文 `txt` 里混入防盗广告，形如 `精-彩-收-藏：woo18.vip`、`尒説+影視：ρ○①⑧.run`。这类广告词被特殊符号分隔，按「关键词」匹配会漏，按**域名特征**过滤才稳：

```js
const urlPattern = /\.(vip|run|com|net|νρ|νiρ|σσ)|woo18|wоо|⒙|ρ○|①⑧|blσ/i;
text.split('\n').filter(line => !urlPattern.test(line)).join('\n');
```

### 结果

44 章、9.2 万字，剔除 11 处广告，输出规范化命名的 UTF-8 txt。

---

## 案例二：登录 + 代理 + 隐藏水印

**任务**：补全某正版站的一本书缺失的中间某一章（原 txt 中是占位标记 `（本章在源站无正文内容）`）。

### 1. 三个障碍叠加

| 障碍 | 现象 | 应对（anti-bot.md） |
|------|------|-------------------|
| 代理 | `fetch` 连接超时（域名解析到海外 CDN） | 用 Playwright（Chrome 走系统代理） |
| 登录 | 章节页被重定向到登录页 | 注入用户提供的 cookies |
| 水印 | 正文接口返回的 HTML 里每段后塞随机串 | 剔除 `<blockquote class='copyright'>` 整块 |

### 2. cookies 注入的 domain 坑（anti-bot.md）

用户导出的认证 cookie 的 `domain` 是 `.example.com`。Playwright `addCookies` 去掉前导点后会当作 host-only cookie，**不会发送到 `www.example.com` 子域**，导致仍被重定向到登录页。

**解法**：把 `.example.com` 域 cookie 同时复制一份到 `www.example.com` 域：

```js
const dotCookies = rawCookies.filter(c => c.domain === '.example.com');
const cookiesToAdd = [
  ...rawCookies.filter(c => c.domain === 'www.example.com'),
  ...dotCookies.map(c => ({ ...c, domain: 'example.com' })),
  ...dotCookies.map(c => ({ ...c, domain: 'www.example.com' })), // 关键
];
await ctx.addCookies(cookiesToAdd);
```

### 3. 正文提取（api-reverse.md + cleaning.md）

正文接口返回 HTML，`<p>` 标签**不带闭合 `</p>`**，水印藏在 `<blockquote>` 里：

```js
let clean = html.replace(/<blockquote[\s\S]*?<\/blockquote>/g, ''); // 去水印
const paragraphs = clean.split(/<p[\s>]/).map(decodeEntities).filter(t => t.length > 0);
```

### 4. 增量补章（engineering.md）

用章节标题精确定位，把占位标记替换成正文：

```js
const marker = '第307章 夜雪';
const nextMarker = '第308章 春归';
const newTxt = txt.slice(0, txt.indexOf(marker) + marker.length)
  + '\n\n' + content + '\n\n' + txt.slice(txt.indexOf(nextMarker));
```

### 结果

补全 1 万余字正文，无水印，段落格式与全书一致。

---

## 学到的通用教训（已固化进 SKILL.md）

1. Cloudflare Turnstile 无法纯自动绕过 → 换源优先。
2. 加密 API 用「页面内调用站点加密函数」，而非手动逆向混淆算法。
3. `.xxx.com` 域的 cookie 要复制到 `www.xxx.com` 子域。
4. Node 原生 `fetch` 不走系统代理。
5. 广告用「域名特征」过滤比用「关键词」更可靠。
6. 抓取与生成分离：先落 `raw.json` 中间态，再幂等生成 txt。
