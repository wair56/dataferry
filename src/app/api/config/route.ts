// 凭证配置 API — 读写 AppID/AppSecret
import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_PATH = path.join(process.cwd(), '.config.json');

// 读取配置
export async function GET() {
  try {
    // 优先从环境变量读取
    const envConfig = {
      feishu: {
        appId: process.env.FEISHU_APP_ID || '',
        appSecret: process.env.FEISHU_APP_SECRET || '',
      },
      lark: {
        appId: process.env.LARK_APP_ID || '',
        appSecret: process.env.LARK_APP_SECRET || '',
      },
    };

    // 如果环境变量有值，返回环境变量配置
    if (envConfig.feishu.appId || envConfig.lark.appId) {
      return NextResponse.json({
        source: 'env',
        feishu: { appId: envConfig.feishu.appId, hasSecret: !!envConfig.feishu.appSecret },
        lark: { appId: envConfig.lark.appId, hasSecret: !!envConfig.lark.appSecret },
      });
    }

    // 尝试从本地配置文件读取
    try {
      const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw);
      return NextResponse.json({
        source: 'file',
        feishu: { appId: config.feishu?.appId || '', hasSecret: !!config.feishu?.appSecret, alias: config.feishu?.alias || '' },
        lark: { appId: config.lark?.appId || '', hasSecret: !!config.lark?.appSecret, alias: config.lark?.alias || '' },
      });
    } catch {
      return NextResponse.json({
        source: 'none',
        feishu: { appId: '', hasSecret: false },
        lark: { appId: '', hasSecret: false },
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '未知错误' },
      { status: 500 }
    );
  }
}

// 保存配置（仅本地开发有效，Vercel 上静默跳过）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 先读取现有配置
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let existingConfig: any = { feishu: { appId: '', appSecret: '' }, lark: { appId: '', appSecret: '' } };
    try {
      const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
      existingConfig = { ...existingConfig, ...JSON.parse(raw) };
    } catch { /* 忽略文件不存在或解析错误 */ }

    // 合并新配置
    const config = {
      feishu: {
        appId: body.feishu?.appId ?? existingConfig.feishu?.appId,
        appSecret: body.feishu?.appSecret ?? existingConfig.feishu?.appSecret,
        alias: body.feishu?.alias !== undefined ? body.feishu.alias : existingConfig.feishu?.alias,
      },
      lark: {
        appId: body.lark?.appId ?? existingConfig.lark?.appId,
        appSecret: body.lark?.appSecret ?? existingConfig.lark?.appSecret,
        alias: body.lark?.alias !== undefined ? body.lark.alias : existingConfig.lark?.alias,
      },
    };

    try {
      await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      return NextResponse.json({ success: true });
    } catch {
      // Vercel 只读文件系统 — 优雅降级，配置已存在 localStorage
      return NextResponse.json({ success: true, source: 'localStorage-only' });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '未知错误' },
      { status: 500 }
    );
  }
}
