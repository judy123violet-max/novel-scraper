---
name: novel-scraper
description: 抓取网络小说并清洗保存为 UTF-8 txt 的端到端工作流，支持两种使用方式：① 用户给网址的「精确下载」；② 用户只给书名的「全网搜索下载」。当用户要求抓取、爬取、下载某小说网站/书籍/章节，说"帮我抓取这个网站的小说""下载这本小说""补全某章"，或只提供一个书名/作者名要下载 txt 时使用。涵盖网站类型探测（SSR/CSR、Cloudflare、登录、代理）、SPA 的 API 逆向、全网搜索与资源比对、正版+盗版拼接、防盗广告与水印清洗、cookies 登录注入、增量更新与断点续传、txt 结果保存。适用于各类网文站点（SSR 站、SPA 站、需登录站、需代理站）。
---

# Novel Scraper

## Overview

抓取网络小说章节并清洗保存为 UTF-8 txt 的端到端流程。核心价值是用一套「探测 → 分类 → 抓取 → 清洗 → 保存」的决策树，避免在每个新站点上重复试错。最耗时的四类问题是：Cloudflare 验证、SPA 的加密 API、登录态/代理、广告与水印清洗。

## 使用方式（两种）

按用户提供的信息，自动选择其中一种：

### 方式一：精确下载（用户给了网址）

用户直接发小说网站链接（可附带 cookies / 登录信息）。直接跳到下方 Workflow Decision Tree，按 Step 0 起执行。

### 方式二：全网搜索下载（用户只给了书名）

用户只发书名（可能含作者名），没有网址。执行 `references/search-and-compare.md` 的流程：

1. 全网搜索候选资源（多关键词、多引擎）
2. 比对章节完整度、乱码、收费情况
3. 必要时正版 + 盗版拼接
4. 向用户汇报最优方案，征得同意后抓取

## 首次对话指引

当用户安装本 skill 后首次提及小说 / 下载 / 抓取相关需求时，主动用一句话告知两种使用方式，让用户选择：

- 「发我小说网站链接 → 我直接抓取下载成 txt」
- 「只发我书名 → 我全网搜索、比对资源、给你方案后再下载」

若用户只给书名，无需追问网址，直接进入方式二的全网搜索流程。

## Workflow Decision Tree

### Step 0 — Probe the site

写任何抓取逻辑前，先探测目标站点，回答四个问题：

1. 是否需要代理？（fetch 连接超时）
2. 是否有 Cloudflare 人机验证？（页面 title 含 `Just a moment` / `请稍候` / `安全验证`）
3. 返回是 SSR（HTML 含正文）还是 CSR（空壳 `#app` + JS 渲染）？
4. 是否需要登录？（重定向到 `login`）

运行 `scripts/probe_site.mjs <url>`，或手动 `fetch` 目标 URL 判断。详见 `references/site-detection.md`。

### Step 1 — Classify & choose strategy

| 特征 | 策略 |
|------|------|
| SSR、无防护 | 直接 `fetch` + 解析 HTML |
| CSR（SPA） | 从 JS 找 API 端点，用 Playwright 在页面内调用页面已有函数 |
| Cloudflare Turnstile | 优先换镜像站/其他源；否则半自动（有头浏览器 + 真人点验证） |
| 需要登录 | 让用户提供 cookies，用 Playwright `addCookies` 注入 |
| 需要代理 | 用 Playwright（Chrome 走系统代理），不要用 Node 原生 `fetch` |

### Step 2 — Check existing progress（增量更新）

抓取前先检查本地是否已有该书，避免重复全量抓取：

- 若工作区已有该书的 txt 或中间 JSON，读取已有章节列表，**只抓缺失的章节**。
- 补单章场景：用章节标题定位，替换原占位标记（如 `（本章在源站无正文内容）`）。
- 详见 `references/engineering.md`。

### Step 3 — Get catalog

- SSR：解析目录页 HTML，提取章节链接（`href` 含数字的 `.html` 链接，去重）。
- CSR：调用目录 API（在页面 JS 中定位 API 端点；加密参数用 Playwright 在页面内调用站点自身函数生成，不必逆向算法）。
- 目录抓取与正文抓取分离：先拿完整目录，再逐个抓正文。

### Step 4 — Get chapter content

- SSR：解析正文页，提取正文容器（依次尝试 `#content`、`.content`、`#chaptercontent`、`.read-content` 等，取 `innerText` 长度 > 100 的）。
- CSR：调用正文 API，或在页面内 `fetch` API 后从返回 JSON 提取正文字段（常见字段 `txt` / `content` / `data`）。

### Step 5 — Clean (ads / watermarks)

按 `references/cleaning.md` 的规则剔除广告语、防盗水印、随机字符串。

### Step 6 — Save（两段式 + 断点续传）

分两段保存，便于失败重试：

1. 先抓取全部章节，存为中间态 `raw.json`（含每章标题与正文）。
2. 再从 `raw.json` 生成最终 `书名 by作者.txt`（UTF-8），格式：书名 + 作者 + 章节标题 + 正文（段落间空行）。

批量抓取时把已抓章节写入进度文件，失败章节可重试，不必从头再来。补单章用标题定位替换原占位标记。详见 `references/engineering.md`。

## Key Lessons（实战沉淀）

> 以下为去站点化后的通用结论；站点专有的接口细节见对应 `references/` 文档。

- **Cloudflare Turnstile 的 managed 挑战无法纯自动绕过**（`fetch`、Playwright 有头/无头、patchright 均失败）。最快路径是换镜像站或让用户提供替代源。
- **加密 API 不必手动还原混淆算法**：用 Playwright 加载站点后，在页面内直接调用页面已有的加密函数（如 `get_api(action, params)`）生成 URL，再 `fetch` 该 URL 拿数据。
- **cookies 注入的 domain 坑**：`.example.com` 域的 cookie 要同时复制到 `www.example.com` 子域，否则请求不携带该 cookie，会被重定向到登录页。
- **Node 原生 `fetch` 不走系统代理**：需要代理的站点必须用 Playwright（Chrome 默认走系统代理）。
- **先探测再动手**：拿到目录页和第一章样本、确认正文结构与广告位置后，再写批量抓取，避免全量抓取后才发现正文选错容器。
- **正文接口的 Referer 校验**：部分站点要求 Referer 为对应章节页；不匹配时不报错，而是返回 JS 壳页（`window.dataLayer` 开头），必须显式检测。浏览器内 fetch 无法伪造 Referer，只能每章先 goto 章节页再 fetch。
- **接口返回的 HTML 可能不合规范**：部分站点正文 HTML 的 `<p>` 不闭合，DOM/语义解析会把整章并成一段；应改用「标签→换行」的正则替换式解析。
- **登录站 cookie 失效的静默表现**：cookie 过期不一定报错，可能表现为正文容器为空、302 跳首页或返回壳页；先验证登录态（如页面含「登出」/「xxx您好!」）再批量抓取，避免全量废数据。

## References

本仓库包含：

- `references/search-and-compare.md` — 全网搜索、资源比对、正版+盗版拼接、给用户出方案
- `references/site-detection.md` — 网站探测脚本与四类特征判断
- `references/cleaning.md` — 广告/水印清洗规则与正则
- `references/engineering.md` — 工程化实践（增量更新、断点续传、中间态保存、任务分离）
- `references/api-reverse.md` — SPA 的 API 逆向与加密参数应对
- `references/anti-bot.md` — Cloudflare、登录态注入、代理的实测结论
- `references/po18.md` — PO18 站点专案：正文接口、Referer 校验、认证三方式、付费判定、降级策略

## Scripts

- `scripts/probe_site.mjs` — 探测目标站点类型（SSR/CSR/Cloudflare/登录/代理），输出诊断信息
- `scripts/po18_fetch.mjs` — PO18 一键抓取脚本（断点续传 + txt 输出）
