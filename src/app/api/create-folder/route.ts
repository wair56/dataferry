import { NextRequest, NextResponse } from 'next/server';
import { getAppAccessToken } from '@/lib/lark-client';
import type { Side } from '@/lib/types';

async function safeJson(resp: Response) {
  const text = await resp.text();
  try { return JSON.parse(text); }
  catch(e) { return { code: resp.status || 500, msg: text || resp.statusText }; }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { side, appId, appSecret, userToken, name, folderToken, spaceId, nodeToken } = body as { side: Side, appId: string, appSecret: string, userToken?: string, name: string, folderToken?: string, spaceId?: string, nodeToken?: string };
  
  if (!side || !name) return NextResponse.json({ error: '参数错误' }, { status: 400 });

  try {
    const token = userToken || await getAppAccessToken(side, appId, appSecret);
    const base = side === 'feishu' ? 'https://open.feishu.cn' : 'https://open.larksuite.com';

    if (spaceId === '__create_space__') {
      const resp = await safeJson(await fetch(`${base}/open-apis/wiki/v2/spaces`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: 'Created via DataFerry' })
      }));
      
      if (resp.code !== 0) return NextResponse.json({ error: `知识库创建失败 (${resp.code}): ${resp.msg}` }, { status: 502 });
      return NextResponse.json({ folder_token: resp.data?.space?.space_id });
    }

    if (spaceId) {
      const docHttp = await fetch(`${base}/open-apis/docx/v1/documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: name, folder_token: '' })
      });
      const docResp = await safeJson(docHttp);
      
      if (docResp.code !== 0) return NextResponse.json({ error: `文档创建失败 (${docResp.code}): ${docResp.msg}` }, { status: 502 });
      const newDocId = docResp.data?.document?.document_id;

      const payload: Record<string, unknown> = { node_type: 'obj', obj_type: 'docx', obj_token: newDocId };
      if (nodeToken) payload.parent_node_token = nodeToken;
      
      const bindHttp = await fetch(`${base}/open-apis/wiki/v2/spaces/${spaceId}/nodes`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const bindResp = await safeJson(bindHttp);

      if (bindResp.code !== 0) return NextResponse.json({ error: `节点挂载失败 (${bindResp.code}): ${bindResp.msg}` }, { status: 502 });
      return NextResponse.json({ folder_token: bindResp.data?.node?.node_token, url: bindResp.data?.node?.url });
    }

    let resolvedFolderToken = folderToken || '';
    if (!resolvedFolderToken) {
       const rootResp = await safeJson(await fetch(`${base}/open-apis/drive/explorer/v2/root_folder/meta`, {
         headers: { 'Authorization': `Bearer ${token}` }
       }));
       if (rootResp.code === 0) {
         resolvedFolderToken = rootResp.data?.token || rootResp.data?.folder_token || '';
       } else {
         return NextResponse.json({ error: `根目录寻址失败 (${rootResp.code}): ${rootResp.msg}` }, { status: 502 });
       }
    }

    const data = await safeJson(await fetch(`${base}/open-apis/drive/v1/files/create_folder`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder_token: resolvedFolderToken })
    }));

    if (data.code !== 0) {
      return NextResponse.json({ error: `创建失败 (${data.code}): ${data.msg}` }, { status: 502 });
    }

    return NextResponse.json({ folder_token: data.data?.folder_token, url: data.data?.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '未知错误' }, { status: 500 });
  }
}
