import { NextRequest, NextResponse } from 'next/server';
import { api, getAppAccessToken } from '@/lib/lark-client';
import type { Side } from '@/lib/types';

export const maxDuration = 300;

const API_BASE: Record<Side, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
};

export async function POST(request: NextRequest) {
  try {
    const { sourceSide, fileToken, fileType, fileName, sourceUserToken, sourceAppId, sourceAppSecret } = await request.json();
    const srcBase = API_BASE[sourceSide as Side];
    
    // Auth token resolution
    const srcToken = sourceUserToken || await getAppAccessToken(sourceSide as 'feishu' | 'lark', sourceAppId, sourceAppSecret);

    const extMap: Record<string, string> = { docx: 'docx', doc: 'docx', sheet: 'xlsx', slides: 'pptx', bitable: 'xlsx' };
    const ext = extMap[fileType] || (fileType === 'file' ? '' : 'docx');

    // 原生静态文件类型 (PDF, PNG, ZIP等) 不支持导出任务，直接从云盘打原生网络接口下拔
    if (fileType === 'file') {
      const dlResp = await fetch(`${srcBase}/open-apis/drive/v1/files/${fileToken}/download`, {
        headers: { 'Authorization': `Bearer ${srcToken}` },
      });
      if (!dlResp.ok) throw new Error(`原生文件流拉取失败: HTTP ${dlResp.status}`);
      const buffer = await dlResp.arrayBuffer();
      
      const cd = dlResp.headers.get('Content-Disposition') || '';
      let extractedName = fileName;
      const fnMatch = cd.match(/filename="?([^"]+)"?/);
      if (fnMatch) extractedName = decodeURIComponent(fnMatch[1]);
      
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': dlResp.headers.get('Content-Type') || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(extractedName)}"`,
        },
      });
    }

    // 1. 创建文档型导出任务
    const createResp = await api(srcBase, srcToken, '/drive/v1/export_tasks', 'POST', {
      file_extension: ext,
      token: fileToken,
      type: fileType,
    });
    if (createResp.code !== 0) throw new Error(`创建导出任务失败: ${createResp.msg}`);
    const ticket = createResp.data.ticket;

    // 2. 轮询等待导出完成
    let exportFileToken = '';
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusResp = await api(srcBase, srcToken, `/drive/v1/export_tasks/${ticket}?token=${fileToken}`);
      const result = statusResp.data?.result;
      if (result?.job_status === 0) {
        exportFileToken = result.file_token;
        break;
      }
      if (result?.job_status === 2) throw new Error(`导出构建失败: ${result.job_error_msg}`);
    }
    if (!exportFileToken) throw new Error('导出任务超时(>120s)');

    // 3. 构造请求流直接桥接给浏览器
    const exportName = `${fileName}.${ext}`;
    const dlResp = await fetch(`${srcBase}/open-apis/drive/v1/export_tasks/file/${exportFileToken}/download`, {
      headers: { 'Authorization': `Bearer ${srcToken}` },
    });
    
    if (!dlResp.ok) throw new Error(`底层二进制下载失败: HTTP ${dlResp.status}`);

    const buffer = await dlResp.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(exportName)}"`,
      },
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
