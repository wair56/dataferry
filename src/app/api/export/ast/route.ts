// \src\app\api\export\ast\route.ts
import { NextResponse } from 'next/server';
import { getAppAccessToken, OPEN_URLS } from '@/lib/lark-client';
import type { Side } from '@/lib/types';
import { AstExporter } from '@/lib/ast-exporter';

export const maxDuration = 300; // 5 minutes (Vercel max for Hobby is 10s, Pro 300s)
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // 兼容两种参数命名：直接传 side/appId 或通过 ...item 传 sourceSide/sourceAppId
    const side = body.side || body.sourceSide;
    const appId = body.appId || body.sourceAppId;
    const appSecret = body.appSecret || body.sourceAppSecret;
    const userToken = body.userToken || body.sourceUserToken;
    const { fileToken, fileType } = body;

    if (!side || !appId || !appSecret || !fileToken || !fileType) {
      return NextResponse.json({ code: 400, msg: `Missing required parameters: side=${side}, appId=${!!appId}, fileToken=${fileToken}, fileType=${fileType}` }, { status: 400 });
    }

    const srcBase = OPEN_URLS[side as Side];
    const srcToken = userToken || await getAppAccessToken(side as Side, appId, appSecret);

    let extractedData = null;

    if (fileType === 'docx') {
      extractedData = await AstExporter.exportDocx(srcBase, srcToken, fileToken);
    } else if (fileType === 'sheet') {
      extractedData = await AstExporter.exportSheet(srcBase, srcToken, fileToken);
    } else if (fileType === 'bitable') {
      extractedData = await AstExporter.exportBitable(srcBase, srcToken, fileToken);
    } else {
      return NextResponse.json({ code: 400, msg: `Format [${fileType}] AST extraction is not supported` }, { status: 400 });
    }

    return NextResponse.json({
      code: 0,
      msg: 'Success',
      data: extractedData
    });

  } catch (error: any) {
    return NextResponse.json(
      { code: 500, msg: error.message || '内部处理异常' },
      { status: 500 }
    );
  }
}
