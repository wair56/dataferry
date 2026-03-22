import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/lark-client';
import * as lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Side } from '@/lib/types';

const CONFIG_PATH = path.join(process.cwd(), '.config.json');

async function getCredentials(side: Side) {
  if (side === 'feishu' && process.env.FEISHU_APP_ID) {
    return { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET || '' };
  }
  if (side === 'lark' && process.env.LARK_APP_ID) {
    return { appId: process.env.LARK_APP_ID, appSecret: process.env.LARK_APP_SECRET || '' };
  }
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    return { appId: config[side]?.appId, appSecret: config[side]?.appSecret };
  } catch {
    return { appId: '', appSecret: '' };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, side, appId: bodyAppId, appSecret: bodyAppSecret } = body;
    
    if (!code || !side) return NextResponse.json({ error: '缺失参数 code 或 side' }, { status: 400 });

    // 优先使用前端传入的凭证（localStorage），回退到服务端配置
    const creds = bodyAppId ? { appId: bodyAppId, appSecret: bodyAppSecret } : await getCredentials(side as Side);
    if (!creds.appId || !creds.appSecret) return NextResponse.json({ error: '未配置此平台的应用凭证，无法授权' }, { status: 400 });

    const client = createClient(side as Side, creds.appId, creds.appSecret);

    // Call Feishu API to exchange token
    const resp = await client.request({
      method: 'POST',
      url: '/open-apis/authen/v1/oidc/access_token',
      data: {
        grant_type: 'authorization_code',
        code: code,
      }
    });

    if (resp.code !== 0) {
      return NextResponse.json({ error: resp.msg || JSON.stringify(resp) }, { status: 500 });
    }

    return NextResponse.json({
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_in: resp.data.expires_in,
      name: resp.data.name,
      avatar_url: resp.data.avatar_url
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
