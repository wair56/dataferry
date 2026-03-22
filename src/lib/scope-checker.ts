// 权限自检逻辑
// 参考 openclaw-lark 的 getAppGrantedScopes 实现

import type { Side, ConfigCheckResponse } from './types';
import { getAppAccessToken, getPermissionUrl, OPEN_URLS } from './lark-client';

// 文档迁移工具所需的最小权限集
const REQUIRED_SCOPES: string[] = [
  'drive:drive',              // 云空间基础
  'drive:drive:readonly',     // 读取文件列表
  'drive:export:readonly',    // 云文档脱机导出
  'docs:document:export',     // 飞书云文档导出
];

// 可选但推荐的权限
const OPTIONAL_SCOPES: string[] = [
  'drive:file:upload',        // 上传文件
  'contact:user.id:readonly', // 获取用户 ID
];

/**
 * 获取应用已被授予的 scope 列表
 * 参考 openclaw-lark src/core/app-scope-checker.ts
 */
async function getAppGrantedScopes(
  side: Side,
  appAccessToken: string,
): Promise<string[]> {
  const baseUrl = OPEN_URLS[side];
  const url = `${baseUrl}/open-apis/auth/v3/app_access_scopes`;

  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${appAccessToken}`,
    },
  });

  const data = await resp.json() as {
    code: number;
    msg: string;
    data?: { scopes?: string[] };
  };

  if (data.code !== 0) {
    // 部分接口可能不支持此调用，降级返回空数组
    console.warn(`获取 app scopes 失败 (code=${data.code}): ${data.msg}`);
    return [];
  }

  return data.data?.scopes ?? [];
}

/**
 * 执行完整的权限检测
 */
export async function checkConfig(
  side: Side,
  appId: string,
  appSecret: string,
): Promise<ConfigCheckResponse> {
  try {
    // 步骤 1: 验证凭证 → 获取 app_access_token
    const appAccessToken = await getAppAccessToken(side, appId, appSecret);

    // 步骤 2: 获取已授予的 scopes
    let grantedScopes: string[] = [];
    try {
      grantedScopes = await getAppGrantedScopes(side, appAccessToken);
    } catch {
      // 如果获取 scopes 失败，不影响基本验证
      console.warn('获取 scopes 失败，跳过权限详细检测');
    }

    // 步骤 3: 计算缺失的权限
    const allRequired = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES];
    const grantedSet = new Set(grantedScopes);
    const missing = allRequired.filter((s) => !grantedSet.has(s));

    // 如果获取 scope 列表的 API 不可用（返回空），视为 ready（降级处理）
    const isApiAvailable = grantedScopes.length > 0;
    let status: 'ready' | 'partial' | 'invalid';

    if (!isApiAvailable) {
      // API不可用时降级：凭证本身有效就算 ready
      status = 'ready';
    } else if (missing.length === 0) {
      status = 'ready';
    } else {
      // 检查是否核心必要权限缺失
      const missingRequired = REQUIRED_SCOPES.filter((s) => !grantedSet.has(s));
      status = missingRequired.length > 0 ? 'partial' : 'ready';
    }

    return {
      valid: true,
      scopes: {
        granted: grantedScopes,
        missing,
      },
      status,
      permission_url: getPermissionUrl(side, appId),
    };
  } catch (err) {
    return {
      valid: false,
      scopes: { granted: [], missing: [] },
      status: 'invalid',
      error: err instanceof Error ? err.message : '未知错误',
    };
  }
}
