# 真实案例

两个「实战」记录，展示这套 skill 的方法论如何落地。每个案例都对应 `references/` 里的某几篇文档。

---

## 案例一：bqg997 —— 加密 API 的 SPA 站

**任务**：抓取 `d91.bqg997.xyz` 上的《合欢宗女修日记 [1vN H]》，剔除防盗广告。

### 1. 探测（site-detection.md）

`fetch` 主页返回 820 字节的空壳 `<div id="app"></div>` + 两个 JS → 判定为 **CSR（SPA）**，且无 Cloudflare、无登录。

### 2. 逆向 API（api-reverse.md）

从 `/js/common.js` 和 `/js/read.js` 里搜到关键函数：

```js
function url_chapter(id, chapterid) { return `/book/${id}/${chapterid}.html`; }
function get_api(action, params) {
  return gethost() + '/api/' + action + '?token=' + encodeURIComponent(enaes(JSON.stringify(params)));
}
```

`enaes` 是 AES-CBC 加密，但**不必手动还原**——直接在 Playwright 页面里调用：

```js
const url = await page.evaluate(p => get_api('chapter', p), { id: 121165, chapterid: 1 });
const data = await page.evaluate(async u => (await fetch(u)).json(), url);
// → { id, chapterid, chaptername, cs, txt, ... }
```

### 3. 清洗（cleaning.md）

正文 `txt` 里混入防盗广告，形如 `精-彩-收-藏：woo18.vip`、`尒説+影視：ρ○①⑧.run`。按**域名特征**过滤（而非关键词，因为广告词被符号分隔）：

```js
const urlPattern = /\.(vip|run|com|net|νρ|νiρ|σσ)|woo18|wоо|⒙|ρ○|①⑧|blσ/i;
text.split('\n').filter(line => !urlPattern.test(line)).join('\n');
```

### 结果

44 章、9.2 万字，剔除 11 处广告，输出 `合欢宗女修日记（1vN H）by亿盒好猪.txt`。

---

## 案例二：po18.tw —— 登录 + 代理 + 防盗水印

**任务**：补全《无冬之春》第 307 章「chapter101 夜雪」（原 txt 中是占位标记 `（本章在源站无正文内容）`）。

### 1. 三个障碍叠加

| 障碍 | 现象 | 应对（anti-bot.md） |
|------|------|-------------------|
| 代理 | `fetch` 连接超时（解析到美国 CDN） | 用 Playwright（Chrome 走系统代理） |
| 登录 | 章节页重定向到 `members.po18.tw/login` | 注入用户提供的 cookies |
| 水印 | 正文接口返回的 HTML 里每段后塞随机串 | 剔除 `<blockquote class='copyright'>` |

### 2. cookies 注入的 domain 坑（anti-bot.md）

用户导出的认证 cookie 的 `domain` 是 `.po18.tw`。Playwright `addCookies` 去掉前导点后会被当作 host-only cookie，**不发送到 `www.po18.tw` 子域**，导致仍被重定向登录。

**解法**：把 `.po18.tw` 域 cookie 同时复制一份到 `www.po18.tw` 域：

```js
const dotCookies = rawCookies.filter(c => c.domain === '.po18.tw');
const cookiesToAdd = [
  ...rawCookies.filter(c => c.domain === 'www.po18.tw'),
  ...dotCookies.map(c => ({ ...c, domain: 'po18.tw' })),
  ...dotCookies.map(c => ({ ...c, domain: 'www.po18.tw' })), // 关键
];
await ctx.addCookies(cookiesToAdd);
```

### 3. 正文提取（api-reverse.md + cleaning.md）

正文接口 `/books/853208/articlescontent/11754572` 返回 HTML，`<p>` 标签**不带闭合 `</p>`**，水印藏在 `<blockquote>` 里：

```js
let clean = html.replace(/<blockquote[\s\S]*?<\/blockquote>/g, ''); // 去水印
const paragraphs = clean.split(/<p[\s>]/).map(decodeEntities).filter(t => t.length > 0);
```

### 4. 增量补章（engineering.md）

用章节标题精确定位，把占位标记替换成正文：

```js
const marker = '第307章 chapter101 夜雪';
const nextMarker = '第308章 chapter102 春归';
const newTxt = txt.slice(0, txt.indexOf(marker) + marker.length)
  + '\n\n' + content + '\n\n' + txt.slice(txt.indexOf(nextMarker));
```

### 结果

补全 10944 字正文，无水印，段落格式与全书一致。

---

## 学到的通用教训（已固化进 SKILL.md）

1. Cloudflare Turnstile 无法纯自动绕过 → 换源优先。
2. 加密 API 用「页面内调用加密函数」而非手动逆向。
3. `.xxx.com` 域 cookie 要复制到 `www.xxx.com` 子域。
4. Node 原生 `fetch` 不走系统代理。
5. 广告用「域名特征」过滤比「关键词」更可靠。
