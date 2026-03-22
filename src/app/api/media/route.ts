import { NextRequest, NextResponse } from 'next/server';
import { getAppAccessToken } from '@/lib/lark-client';
import type { Side } from '@/lib/types';

export async function GET(req: NextRequest) {
  const side = (req.nextUrl.searchParams.get('side') || 'feishu') as Side;
  const token = req.nextUrl.searchParams.get('token');
  const appId = req.nextUrl.searchParams.get('appId') || '';
  const appSecret = req.nextUrl.searchParams.get('appSecret') || '';
  const userToken = req.nextUrl.searchParams.get('user_token') || '';

  if (!token || !appId || !appSecret) {
    return new NextResponse('缺少校验参数或资源 Token', { status: 400 });
  }

  try {
    const accessToken = userToken || await getAppAccessToken(side, appId, appSecret);
    const domain = side === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com';
    const url = `${domain}/open-apis/drive/v1/medias/${token}/download`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      console.warn(`[/api/media] 获取媒体 ${token} 失败: ${resp.status} ${errTxt}`);
      return new NextResponse(`上游媒体获取被飞书拦截: HTTP ${resp.status}`, { status: resp.status });
    }

    const headers = new Headers();
    const contentType = resp.headers.get('content-type');
    const contentDisp = resp.headers.get('content-disposition');
    
    if (contentType) headers.set('Content-Type', contentType);
    if (contentDisp) headers.set('Content-Disposition', contentDisp);
    
    // 把流直接反向导回给前端
    return new NextResponse(resp.body, {
      status: 200,
      headers
    });
  } catch (e: any) {
    return new NextResponse(`服务端转发异常: ${e.message}`, { status: 500 });
  }
}
