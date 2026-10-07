# SPA 的 API 逆向与加密参数应对

大部分新版小说站（笔趣阁类、PO18 阅读页）是 CSR（SPA），正文和目录通过 AJAX 加载。抓取关键是找到并调用其 API。

## 逆向步骤

### 1. 找 JS 入口

从首页/章节页 HTML 提取 `<script src>`：

```
<script src="/js/read.js?v=1.2606"></script>
<script src="/js/common.js?v=1.2606"></script>
```

### 2. 下载 JS 并搜 API 线索

在 JS 源码里搜索这些关键词（用 `search_content`）：

- `/api/` —— 直接的 API 路径
- `getJSON` / `$.getJSON` / `fetch(` —— AJAX 调用点
- `get_api` / `gethost` / `url_book` / `url_chapter` —— 自定义 API 构造函数

### 3. 找到 API 端点与参数

常见模式：

```js
function get_api(action, params) {
  return gethost() + '/api/' + action + '?token=' + encodeURIComponent(enaes(JSON.stringify(params)));
}
```

- 目录 API：`get_api('booklist', {id: bookId})`
- 正文 API：`get_api('chapter', {id: bookId, chapterid: chapterId})`
- 书籍信息：`get_api('book', {id: bookId})`

### 4. 应对加密参数（关键技巧）

**不必手动还原混淆的加密算法**。混淆代码（`_0x28fa40`、`_0x22def5` 这类字符串解密函数）手动还原极耗时且易错。

**正确做法**：用 Playwright 加载站点后，在页面上下文里直接调用页面已定义的加密函数：

```js
// 在页面内 evaluate，直接调用站点的 get_api 生成加密 URL
const url = await page.evaluate((p) => get_api('chapter', p), { id: 121165, chapterid: 1 });
// 再 fetch 该 URL 拿 JSON
const data = await page.evaluate(async (u) => (await fetch(u)).json(), url);
```

优点：加密逻辑由站点自己的 JS 执行，天然正确，无需逆向算法。

## 正文 JSON 字段

调用正文 API 后，返回 JSON 常见字段：

- `txt` —— 正文纯文本（po18 系列、笔趣阁类）
- `content` / `data` —— 正文
- `chaptername` / `title` —— 章节名
- `cs` / `total` —— 总章节数

## 目录数据

目录 API 返回通常形如：

```json
{ "list": ["1第一章标题", "2第二章标题", ...] }
```

章节 ID 通常是索引 `i+1` 或列表元素自带 ID。

## 示例（bqg997.xyz 真实案例）

- 章节链接规则：`url_chapter(id, chapterid)` = `/book/{id}/{chapterid}.html`
- 正文 API：`get_api('chapter', { id: 121165, chapterid: 1 })` → `/api/chapter?token=<加密>`
- 返回：`{ id, chapterid, chaptername, cs, txt, ... }`，`txt` 是干净正文。

## 示例（po18.tw 真实案例）

- 正文接口：`/books/{bookId}/articlescontent/{articleId}`（返回 HTML，非 JSON）
- 正文 `<p>` 标签**不带闭合 `</p>`**（HTML 省略闭合），水印藏在 `<blockquote class='copyright'>` 里。
- 提取方式：先 `replace(/<blockquote[\s\S]*?<\/blockquote>/g, '')` 剔除水印，再按 `<p` 分割取段落。
