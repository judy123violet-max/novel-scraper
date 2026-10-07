# 广告与水印清洗规则

抓取到的正文常混入三类杂质：防盗广告、随机水印、作者话。清洗目标是保留正文，剔除前两类，作者话（作话）通常保留。

## 1. 防盗广告（正文末尾/每段后）

小说站的防盗广告形式多样，常见模式：

| 形式 | 示例 |
|------|------|
| 域名推广 | `请收藏：https://m.bqg78.com` |
| 「更多/精彩 + 收藏/章节」+ 域名 | `更┆多┆书┇本：woo18.vip(Woo18.vip)`、`精-彩-收-藏：woo18.vip` |
| 推书标题 | `禽兽老师哄骗女学生至其宿舍` |
| 作者防盗提示 | `亿盒好猪提示您:看后求收藏(心遥书屋网xinyaofs.com),接着再看更方便` |

### 清洗策略

广告关键词常被特殊符号分隔（`精☆彩☆收☆藏`、`精-彩-收-藏`、`更┆多`），按「关键词」匹配会漏。**更可靠的是按「域名特征」匹配**——所有广告行都含网址/域名后缀，而正文和作话不含：

```js
// 域名后缀特征：带点的后缀或混淆域名
const urlPattern = /\.(vip|run|com|net|cc|xyz|νρ|νiρ|σσ)|woo18|wоо|⒙|ρ○|①⑧|Рo|blσ/i;

function cleanAd(text) {
  return text.split('\n')
    .filter(line => !urlPattern.test(line))            // 删含网址的行
    .filter(line => !/亿盒好猪提示您/.test(line))       // 删用户指定的广告语
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');                        // 收敛多余空行
}
```

**技巧**：先抓取后打印每章正文结尾（`txt.slice(-80)`），人工扫一眼确认广告模式，再写正则。

## 2. 防盗水印（随机字符串）

部分站会在每段正文后插入一串随机字符作水印，再通过 CSS 隐藏（`color:transparent` 或塞进独立元素）。

### 识别

- 特征：40+ 字符的随机字母数字串，夹杂在正文段落之间。
- 常见形态：水印放在独立的语义容器里（如带 `copyright` 类名的 `<blockquote>`），正文 `<p>` 可能不闭合。

### 清洗

```js
// 先剔除水印 blockquote，再提取正文段落
let clean = html.replace(/<blockquote[\s\S]*?<\/blockquote>/g, '');
const paragraphs = clean.split(/<p[\s>]/).map(p =>
  p.replace(/<[^>]+>/g, '')
   .replace(/&nbsp;/g, ' ')
   .replace(/&amp;/g, '&')
   .replace(/&quot;/g, '"')
   .replace(/&#39;|&apos;/g, "'")
   .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .trim()
).filter(t => t.length > 0);
```

### 通用 HTML 实体解码

正文 HTML 常含实体，解码映射：`&nbsp;`→空格、`&amp;`→`&`、`&quot;`→`"`、`&#39;`/`&apos;`→`'`、`&lt;`→`<`、`&gt;`→`>`。

## 3. 作者话（作话）

正文后 `—————————` 分隔线之后的内容是作者留言（作话），**通常保留**（是内容的一部分）。若用户明确不要，再删除分隔线及之后内容。

## 4. HTML 正文容器提取

SSR 站点正文容器选择器常见：

```
#content, .content, #chaptercontent, .chapter-content, #booktxt, .read-content, #htmlContent
```

依次尝试，取 `innerText` 长度 > 100 的第一个；若都不命中，退回 `document.body.innerText` 再人工定位。

## 5. 空章节 / 占位

源站偶有空章节（只有标题无正文，正文长度 < 20 字）。如实保留，或标记为「（本章在源站无正文内容）」占位，等后续补全。
