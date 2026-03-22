// 文件列表 API — 绕过 SDK 直接调飞书 REST API
import { NextRequest, NextResponse } from 'next/server';
import { getAppAccessToken } from '@/lib/lark-client';
import type { Side } from '@/lib/types';

const API_BASE: Record<Side, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
};

export async function GET(req: NextRequest) {
  const side = req.nextUrl.searchParams.get('side') as Side;
  const folderToken = req.nextUrl.searchParams.get('folder_token') || undefined;
  const pageToken = req.nextUrl.searchParams.get('page_token') || undefined;
  const userAccessToken = req.nextUrl.searchParams.get('user_token') || undefined;
  const appId = req.nextUrl.searchParams.get('appId') || '';
  const appSecret = req.nextUrl.searchParams.get('appSecret') || '';

  if (!side || !['feishu', 'lark'].includes(side)) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }
  if (!appId) {
    return NextResponse.json({ error: '未配置凭证' }, { status: 400 });
  }

  try {
    // 确定使用哪种 token
    let token: string;
    let tokenType: string;
    if (userAccessToken) {
      token = userAccessToken;
      tokenType = 'user';
    } else {
      token = await getAppAccessToken(side, appId, appSecret);
      tokenType = 'tenant';
    }

    // 构建飞书 REST API URL
    const params = new URLSearchParams({
      page_size: '50',
      order_by: 'CreatedTime',
      direction: 'DESC',
    });
    if (folderToken && folderToken !== '__root_drive__') params.set('folder_token', folderToken);
    if (pageToken) params.set('page_token', pageToken);

    const apiUrl = `${API_BASE[side]}/open-apis/drive/v1/files?${params}`;
    console.log(`[/api/files] ${tokenType} token, url: ${apiUrl}`);

    const resp = await fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    const data = await resp.json();
    console.log(`[/api/files] status: ${resp.status}, code: ${data.code}, files: ${data.data?.files?.length || 0}`);

    if (data.code !== 0) {
      return NextResponse.json(
        { error: `飞书 API 错误 (${data.code}): ${data.msg}`, tokenType },
        { status: 502 }
      );
    }

    const files = (data.data?.files || []).map((f: Record<string, unknown>) => ({
      token: f.token,
      name: f.name,
      type: f.type,
      created_time: f.created_time,
      modified_time: f.modified_time,
      url: f.url,
      // Assuming 'obj_token' might be present in the API response for files,
      // or if this is intended for a different API response structure.
      // If 'obj_token' is not directly available in 'f', this will be undefined.
      objToken: f.obj_token,
    }));

    return NextResponse.json({
      files,
      has_more: data.data?.has_more || false,
      next_page_token: data.data?.next_page_token,
    });
  } catch (err) {
    console.error('[/api/files] ERROR:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '未知错误' },
      { status: 500 }
    );
  }
}
