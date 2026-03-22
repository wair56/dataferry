import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || '';
  const state = req.nextUrl.searchParams.get('state') || '';
  const error = req.nextUrl.searchParams.get('error') || '';

  const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <title>授权结果</title>
      <style>
        body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #0f172a; color: white; }
        .box { padding: 30px; background: #1e293b; border-radius: 12px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
      </style>
    </head>
    <body>
      <div class="box">
        <h3 id="msg">✅ 授权成功，正在返回...</h3>
        <p style="color:#94a3b8; font-size:14px;">如果窗口未自动关闭，请手动关闭此页面。</p>
        <script>
          const error = "${error}";
          if (error) {
            document.getElementById('msg').innerText = "❌ 授权失败或被取消";
          } else {
            if (window.opener) {
              window.opener.postMessage({ type: 'lark-oauth', code: '${code}', state: '${state}' }, '*');
              setTimeout(() => window.close(), 500);
            }
          }
        </script>
      </div>
    </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
