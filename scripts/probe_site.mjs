// 网站探测脚本：判断 SSR/CSR、Cloudflare、登录、代理
// 用法: node probe_site.mjs <url>
// 依赖: 无（Node 18+ 原生 fetch）

const url = process.argv[2];
if (!url) {
  console.log('用法: node probe_site.mjs <url>');
  console.log('示例: node probe_site.mjs https://example.com/book/123/');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

try {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });

  const buf = Buffer.from(await res.arrayBuffer());
  const html = buf.toString('utf8');

  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || '';
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  const cf = /Just a moment|请稍候|安全验证|cf-turnstile|challenges\.cloudflare/i.test(html);
  const login = /login|登入|會員登入/i.test(title) || /login/i.test(res.url);

  console.log('=== 探测结果 ===');
  console.log('URL:', url);
  console.log('final URL:', res.url);
  console.log('status:', res.status, '| content-type:', res.headers.get('content-type'));
  console.log('html 大小:', buf.length, 'bytes');
  console.log('title:', title);
  console.log('可见文本长度:', visible.length);
  console.log('Cloudflare 特征:', cf);
  console.log('登录重定向:', login);
  console.log('script 数量:', scripts.length);
  scripts.slice(0, 15).forEach(s => console.log('  script:', s));
  console.log('--- 可见文本前 600 字 ---');
  console.log(visible.slice(0, 600));

  console.log('\n=== 初步判断 ===');
  if (cf) console.log('→ Cloudflare 挑战，无法纯自动绕过，建议换源或半自动（见 references/anti-bot.md）');
  if (login) console.log('→ 需要登录，让用户提供 cookies（见 references/anti-bot.md）');
  if (visible.length > 500) console.log('→ SSR（HTML 含正文），可直接 fetch + 解析');
  else if (!cf) console.log('→ CSR（SPA），需逆向 API（见 references/api-reverse.md）');
} catch (e) {
  const msg = e.message || '';
  if (/timeout|connect|ETIMEDOUT|UND_ERR|ECONNREFUSED/i.test(msg)) {
    console.log('=== 连接失败 ===');
    console.log('错误:', msg.split('\n')[0]);
    console.log('→ 可能需要代理。检查系统代理并改用 Playwright（Chrome 走系统代理），见 references/anti-bot.md');
  } else {
    console.log('错误:', e.message);
  }
}
