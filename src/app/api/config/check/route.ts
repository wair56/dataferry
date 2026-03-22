// 权限自检 API
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Side } from '@/lib/types';
import { checkConfig } from '@/lib/scope-checker';

const CONFIG_PATH = path.join(process.cwd(), '.config.json');

// 从环境变量或配置文件读取凭证
async function getCredentials(side: Side): Promise<{ appId: string; appSecret: string }> {
  // 优先环境变量
  if (side === 'feishu' && process.env.FEISHU_APP_ID) {
    return { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET || '' };
  }
  if (side === 'lark' && process.env.LARK_APP_ID) {
    return { appId: process.env.LARK_APP_ID, appSecret: process.env.LARK_APP_SECRET || '' };
  }

  // 回退到配置文件
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    return {
      appId: config[side]?.appId || '',
      appSecret: config[side]?.appSecret || '',
    };
  } catch {
    return { appId: '', appSecret: '' };
  }
}

export async function GET(req: NextRequest) {
  const side = req.nextUrl.searchParams.get('side') as Side;
  if (!side || !['feishu', 'lark'].includes(side)) {
    return NextResponse.json({ error: '参数错误: side 需为 feishu 或 lark' }, { status: 400 });
  }

  // 支持前端直接传凭证（设置页面场景）
  const appId = req.nextUrl.searchParams.get('appId');
  const appSecret = req.nextUrl.searchParams.get('appSecret');

  let credentials: { appId: string; appSecret: string };
  if (appId && appSecret) {
    credentials = { appId, appSecret };
  } else {
    credentials = await getCredentials(side);
  }

  if (!credentials.appId || !credentials.appSecret) {
    return NextResponse.json({
      valid: false,
      scopes: { granted: [], missing: [] },
      status: 'invalid',
      error: '未配置 AppID 或 AppSecret',
    });
  }

  const result = await checkConfig(side, credentials.appId, credentials.appSecret);
  return NextResponse.json(result);
}
