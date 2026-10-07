# 网站探测与类型识别

抓取前必须先探测站点，判断四个维度：代理、Cloudflare、SSR/CSR、登录。这决定后续策略，避免在错误方向上浪费大量时间。

## 四个判断维度

### 1. 是否需要代理

`fetch` 目标 URL，若报 `ConnectTimeoutError` / `UND_ERR_CONNECT_TIMEOUT`，说明域名解析到的 IP 无法直连（常见于部署在境外 CDN 的站点）。

**处理**：
- Windows 上检查系统代理：`Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | Select ProxyEnable, ProxyServer`
- 若 `ProxyEnable=1`，说明用户有本地代理（如 Clash `127.0.0.1:xxxx`）。
- **Node 原生 `fetch` 不走系统代理**，必须改用 Playwright（Chrome 默认走系统代理）。

### 2. 是否有 Cloudflare 人机验证

`fetch` 返回的 HTML 若 `<title>` 为 `Just a moment...` / `请稍候…`，且 body 含 `challenges.cloudflare.com` / `cf-turnstile-response` / `安全验证`，则是 Cloudflare Turnstile 挑战。

**处理**：见 `anti-bot.md`。结论：无法纯自动绕过，优先换源。

### 3. SSR 还是 CSR

看 `fetch` 返回的 HTML：

- **SSR（服务端渲染）**：HTML 里直接包含正文/目录内容，去掉标签后能看到章节标题和正文文字。
- **CSR（客户端渲染 / SPA）**：HTML 是空壳，典型特征 `<div id="app"></div>` + 一堆 `<script src="...">`，正文通过 AJAX 加载。

判断技巧：`fetch` 后把 HTML 去标签取 `innerText` 长度，若 < 200 字基本是 CSR。

### 4. 是否需要登录

`fetch` 或 Playwright 访问章节页后，若 `final url` 变成 `.../login` 或 `members.xxx/login.php`，说明需要登录才能看正文。

**处理**：见 `anti-bot.md` 的登录态注入。

## 探测脚本用法

```
node scripts/probe_site.mjs <目标URL>
```

脚本会输出：HTTP 状态、content-type、title、body 可见文本长度、script 列表、是否含 Cloudflare 特征，帮助快速判断以上四维度。

## 快速判断表

| 现象 | 判定 | 下一步 |
|------|------|--------|
| 连接超时 | 需代理 | 用 Playwright |
| title="Just a moment"/"请稍候" | Cloudflare | 换源或半自动 |
| body 可见文本 > 500 字 | SSR | 直接解析 HTML |
| body 可见文本 < 200 字 + 大量 script | CSR | 逆向 API |
| 重定向到 login | 需登录 | 注入 cookies |
