# 反爬应对：Cloudflare、登录态、代理

## 1. Cloudflare Turnstile

### 实测结论（重要，避免重复试错）

对 Cloudflare Turnstile **managed 挑战**（页面显示「请稍候…/Just a moment…/正在验证您是否是真人」），以下方案**均已实测失败**，不要再逐个重试：

| 方案 | 结果 |
|------|------|
| Node 原生 `fetch` | 失败（返回 challenge 页） |
| Playwright `headless:true` + Chrome | 失败 |
| Playwright `headless:false` + Chrome | 失败（`navigator.webdriver=true` 被识别） |
| patchright `headless:true` | 失败（`webdriver=false` 但仍被识别） |
| patchright `headless:false`（自带 Chromium） | 失败（Turnstile 反复验证循环） |
| patchright `headless:false` + 系统 Chrome | 失败（新窗口「零信誉」，仍反复验证） |
| 复制 `cf_clearance` cookie | 失败（`cf_clearance` 绑定 TLS 指纹 + UA，Node/自动化环境复现不了） |

**根本原因**：Turnstile 不只验证「是不是机器人」，还给「曾经通过验证的浏览器」发信誉分。用户自己的浏览器有信誉、秒过；任何新开的自动化窗口都是「零信誉陌生人」，会反复验证循环，**跟「点没点」无关**。

### 可行路径

1. **换源（首选）**：找镜像站或其他转载站（同一本书常被多个站转载），同书其他源通常无 Cloudflare。
2. **复用用户真实浏览器（最可靠，需用户配合）**：
   - `launchPersistentContext` 加载用户的 Chrome 用户数据目录（`C:\Users\<user>\AppData\Local\Google\Chrome\User Data`），以「用户本人浏览器」身份运行，指纹/登录态/信誉全在。**前提：用户需完全关闭 Chrome**（否则目录被锁）。
   - 或让用户以 `--remote-debugging-port` 重启 Chrome，用 `connectOverCDP` 连接其运行中的真实浏览器。
3. **用户导出 `cf_clearance` + 精确 UA**：仅当能用「与用户完全相同的浏览器 + UA + IP」时才可能生效；单纯复制 cookie 值到 Node/自动化环境基本无效（TLS 指纹不符）。

## 2. 登录态（cookies 注入）

需要登录的站点（如 po18.tw），让用户导出浏览器 cookies（JSON 数组），注入到 Playwright。

### 关键坑：domain 处理

用户导出的 cookies 中，域 cookie 的 `domain` 是 `.example.com`（带前导点）。Playwright `addCookies` 不接受前导点，去掉点后会被当作 **host-only cookie**，**不会发送到子域**（如 `www.example.com`），导致请求不带认证 cookie、被重定向到登录页。

**解决**：把 `.example.com` 域的 cookie **同时复制一份到 `www.example.com` 域**：

```js
const dotCookies = rawCookies.filter(c => c.domain === '.example.com');
const cookiesToAdd = [
  ...rawCookies.filter(c => c.domain === 'www.example.com'),
  ...dotCookies.map(c => ({ ...c, domain: 'example.com' })),
  ...dotCookies.map(c => ({ ...c, domain: 'www.example.com' })), // 关键：复制到 www 子域
];
await ctx.addCookies(cookiesToAdd);
```

### 调试方法

若注入后仍跳登录，用 `page.on('request', req => console.log(req.headers()['cookie']))` 打印实际发送的 Cookie 头，确认认证 cookie 是否真的发出去。

## 3. 代理

Node 原生 `fetch` 不走系统代理（undici 默认不读 `HTTP_PROXY` 环境变量）。需要代理的站点必须用 Playwright：

```js
const { chromium } = require('playwright'); // 或 patchright
await chromium.launch({ headless: true, channel: 'chrome' }); // Chrome 默认走系统代理
```

检查系统代理是否开启：`Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | Select ProxyEnable, ProxyServer`。

## 4. 工具选型

| 工具 | 适用 |
|------|------|
| Node `fetch` | 无代理、无 Cloudflare 的 SSR 站点（最轻量） |
| Playwright（`@playwright/cli`） | CSR 站点、需代理、需登录、需调用页面函数 |
| patchright | 需要隐藏 `navigator.webdriver` 指纹时（一般站点用不到） |

Playwright 全局安装路径引用方式：

```js
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/<user>/AppData/Roaming/npm/node_modules/@playwright/cli/');
const { chromium } = require('playwright');
```
