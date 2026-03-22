// 飞书/Lark SDK 客户端工厂
// 根据 side 参数自动切换域名（feishu.cn / larksuite.com）

import * as lark from '@larksuiteoapi/node-sdk';
import type { Side } from './types';

// 域名映射
const DOMAINS: Record<Side, lark.Domain> = {
  feishu: lark.Domain.Feishu,
  lark: lark.Domain.Lark,
};

// app_access_token 接口地址
const TOKEN_URLS: Record<Side, string> = {
  feishu: 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
  lark: 'https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal',
};

// 权限管理接口基础地址
const OPEN_URLS: Record<Side, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
};

// OAuth 授权地址
const OAUTH_URLS: Record<Side, string> = {
  feishu: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
  lark: 'https://open.larksuite.com/open-apis/authen/v1/authorize',
};

// OAuth Token 接口
const OAUTH_TOKEN_URLS: Record<Side, string> = {
  feishu: 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
  lark: 'https://open.larksuite.com/open-apis/authen/v1/oidc/access_token',
};

/**
 * 创建 Lark SDK Client 实例
 */
export function createClient(side: Side, appId: string, appSecret: string): lark.Client {
  return new lark.Client({
    appId,
    appSecret,
    domain: DOMAINS[side],
    loggerLevel: lark.LoggerLevel.warn,
  });
}

/**
 * 获取 app_access_token
 * 参考 Lark-Document-Migration 的 auth.go
 */
export async function getAppAccessToken(side: Side, appId: string, appSecret: string): Promise<string> {
  const resp = await fetch(TOKEN_URLS[side], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const data = await resp.json() as { code: number; msg: string; app_access_token?: string };
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`获取 app_access_token 失败: ${data.msg || '未知错误'}`);
  }
  return data.app_access_token;
}

/**
 * 获取权限管理 URL
 */
export function getPermissionUrl(side: Side, appId: string): string {
  return `${OPEN_URLS[side]}/app/${appId}/auth`;
}

/**
 * 获取 OAuth 授权 URL
 */
export function getOAuthUrl(side: Side, appId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return `${OAUTH_URLS[side]}?${params.toString()}`;
}

/**
 * 通过 code 换取 user_access_token
 */
export async function exchangeCodeForToken(
  side: Side,
  appAccessToken: string,
  code: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  const resp = await fetch(OAUTH_TOKEN_URLS[side], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  });

  const data = await resp.json() as { code: number; msg: string; data?: Record<string, unknown> };
  if (data.code !== 0 || !data.data) {
    throw new Error(`换取 user_access_token 失败: ${data.msg || '未知错误'}`);
  }
  return data.data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
}

export { OPEN_URLS };

// 通用 API 请求包装器（含 RateLimit 自动重试，参考 feishu-pages 实现）
export async function api(base: string, token: string, path: string, method = 'GET', body?: unknown, _retries = 0): Promise<any> {
  const MAX_RETRIES = 3;
  const opts: RequestInit = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${base}/open-apis${path}`, opts);
  const data = await resp.json();

  // 检测飞书 RateLimit 错误码 99991400
  if (data.code === 99991400 && _retries < MAX_RETRIES) {
    // 从响应头读取重置时间（秒），默认 2 秒
    const resetSeconds = parseInt(resp.headers.get('x-ogw-ratelimit-reset') || '2', 10);
    const waitMs = Math.max(resetSeconds * 1000, 1000);
    console.warn(`[API] 频率限制(99991400)，等待 ${waitMs}ms 后第 ${_retries + 1} 次重试: ${path}`);
    await new Promise(r => setTimeout(r, waitMs));
    return api(base, token, path, method, body, _retries + 1);
  }

  return data;
}

