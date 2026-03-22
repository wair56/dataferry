// 知识库 API — 绕过 SDK 直接调飞书 REST API
import { NextRequest, NextResponse } from 'next/server';
import { getAppAccessToken } from '@/lib/lark-client';
import type { Side } from '@/lib/types';

const API_BASE: Record<Side, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
};

export async function GET(req: NextRequest) {
  const side = (req.nextUrl.searchParams.get('side') || 'feishu') as Side;
  const spaceId = req.nextUrl.searchParams.get('space_id') || '';
  const parentNodeToken = req.nextUrl.searchParams.get('parent_node_token') || '';
  const userAccessToken = req.nextUrl.searchParams.get('user_token') || '';
  const appId = req.nextUrl.searchParams.get('appId') || '';
  const appSecret = req.nextUrl.searchParams.get('appSecret') || '';

  if (!appId || !appSecret) {
    return NextResponse.json({ error: '未配置凭证', files: [] });
  }

  try {
    // 确定使用哪种 token
    let token: string;
    if (userAccessToken) {
      token = userAccessToken;
    } else {
      token = await getAppAccessToken(side, appId, appSecret);
    }

    const base = API_BASE[side];
    const headers = { 'Authorization': `Bearer ${token}` };

    // 如果没有指定 space_id，列出所有知识库空间
    if (!spaceId) {
      const resp = await fetch(`${base}/open-apis/wiki/v2/spaces?page_size=50`, { headers });
      const data = await resp.json();

      if (data.code !== 0) {
        return NextResponse.json({ error: `飞书 API 错误: ${data.msg}`, files: [] });
      }

      const spaces = data.data?.items || [];
      const files = spaces.map((s: Record<string, unknown>) => ({
        token: s.space_id as string,
        name: s.name as string,
        type: 'wiki_space',
        has_child: true, // 知识库内部必然可以有子节点
        created_time: '',
        modified_time: '',
        url: side === 'feishu' ? `https://feishu.cn/wiki/space/${s.space_id}` : `https://larksuite.com/wiki/space/${s.space_id}`,
      }));

      return NextResponse.json({ files });
    }

    // 列出知识库节点（支持 parent_node_token 展开子节点）
    let url = `${base}/open-apis/wiki/v2/spaces/${spaceId}/nodes?page_size=50`;
    if (parentNodeToken) {
      url += `&parent_node_token=${parentNodeToken}`;
    }

    const resp = await fetch(url, { headers });
    const data = await resp.json();

    if (data.code !== 0) {
      return NextResponse.json({ error: `飞书 API 错误: ${data.msg}`, files: [] });
    }

    const nodes = data.data?.items || [];
    const files = nodes.map((n: Record<string, unknown>) => ({
      token: (n.obj_token || n.node_token) as string,
      node_token: n.node_token as string,
      name: (n.title || '未命名节点') as string,
      type: (n.obj_type || 'wiki_node') as string,
      has_child: !!n.has_child,
      // 传递 space_id 供子节点展开时使用
      space_id: spaceId,
      created_time: (n.obj_create_time || '') as string,
      modified_time: (n.obj_edit_time || '') as string,
      url: (n.url || (side === 'feishu' ? `https://feishu.cn/wiki/${n.node_token}` : `https://larksuite.com/wiki/${n.node_token}`)) as string,
    }));

    return NextResponse.json({ files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '获取知识库失败';
    return NextResponse.json({ error: msg, files: [] });
  }
}
