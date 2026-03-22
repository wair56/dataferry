'use client';

import React, { useState, useCallback } from 'react';
import type { Side, ConfigStatusType, ScopeCheckResult } from '@/lib/types';

interface ConfigCardProps {
  side: Side;
  onStatusChange: (side: Side, status: ConfigStatusType, appId: string, appSecret: string) => void;
}

// 文件类型图标映射
const TYPE_LABELS: Record<string, string> = {
  feishu: '🇨🇳 飞书 (Feishu)',
  lark: '🌏 Lark (国际版)',
};

const STATUS_LABELS: Record<ConfigStatusType, { icon: string; label: string; cls: string }> = {
  unchecked: { icon: '⚪', label: '未检测', cls: 'status-unchecked' },
  checking: { icon: '🔄', label: '检测中...', cls: 'status-checking' },
  ready: { icon: '🟢', label: '就绪', cls: 'status-ready' },
  partial: { icon: '🟡', label: '缺少权限', cls: 'status-partial' },
  invalid: { icon: '🔴', label: '凭证无效', cls: 'status-invalid' },
};

export default function ConfigCard({ side, onStatusChange }: ConfigCardProps) {
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [status, setStatus] = useState<ConfigStatusType>('unchecked');
  const [scopes, setScopes] = useState<ScopeCheckResult>({ granted: [], missing: [] });
  const [permissionUrl, setPermissionUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [checking, setChecking] = useState(false);

  const checkPermissions = useCallback(async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setError('请填写 App ID 和 App Secret');
      setStatus('invalid');
      return;
    }

    setChecking(true);
    setStatus('checking');
    setError('');

    try {
      const params = new URLSearchParams({
        side,
        appId: appId.trim(),
        appSecret: appSecret.trim(),
      });
      const resp = await fetch(`/api/config/check?${params}`);
      const data = await resp.json();

      setStatus(data.status);
      setScopes(data.scopes || { granted: [], missing: [] });
      setPermissionUrl(data.permission_url || '');
      setError(data.error || '');
      onStatusChange(side, data.status, appId.trim(), appSecret.trim());
    } catch (err) {
      setStatus('invalid');
      setError(err instanceof Error ? err.message : '检测失败');
      onStatusChange(side, 'invalid', appId.trim(), appSecret.trim());
    } finally {
      setChecking(false);
    }
  }, [side, appId, appSecret, onStatusChange]);

  const statusInfo = STATUS_LABELS[status];

  return (
    <div className={`config-card ${status === 'ready' ? 'ready' : status === 'partial' ? 'partial' : status === 'invalid' ? 'invalid' : ''}`}>
      <div className="config-card-title">
        {TYPE_LABELS[side]}
      </div>

      <div className="config-field">
        <label>App ID</label>
        <input
          className="input"
          type="text"
          placeholder="cli_xxxxxxxxxxxx"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        />
      </div>

      <div className="config-field">
        <label>App Secret</label>
        <input
          className="input"
          type="password"
          placeholder="••••••••••••"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
        />
      </div>

      <button
        className="btn btn-sm"
        onClick={checkPermissions}
        disabled={checking || !appId.trim() || !appSecret.trim()}
        style={{ marginBottom: 12, width: '100%', justifyContent: 'center' }}
      >
        {checking ? (
          <><span className="spinner" style={{ width: 14, height: 14, marginRight: 4 }}></span> 检测中...</>
        ) : (
          <>🔍 检测权限</>
        )}
      </button>

      {/* 权限列表 */}
      {status !== 'unchecked' && status !== 'checking' && (
        <>
          {scopes.granted.length > 0 && (
            <ul className="scope-list">
              {scopes.granted.slice(0, 5).map((s) => (
                <li key={s} className="scope-granted">✅ {s}</li>
              ))}
              {scopes.granted.length > 5 && (
                <li className="scope-granted" style={{ color: 'var(--text-muted)' }}>
                  ...及其他 {scopes.granted.length - 5} 个权限
                </li>
              )}
            </ul>
          )}
          {scopes.missing.length > 0 && (
            <ul className="scope-list">
              {scopes.missing.map((s) => (
                <li key={s} className="scope-missing">❌ {s} (未开通)</li>
              ))}
            </ul>
          )}
          {error && <p style={{ color: 'var(--error)', fontSize: 12, marginTop: 8 }}>{error}</p>}
        </>
      )}

      {/* 状态栏 */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className={`status-badge ${statusInfo.cls}`}>
          {statusInfo.icon} {statusInfo.label}
        </span>
        {status === 'partial' && permissionUrl && (
          <a href={permissionUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
            前往开通 →
          </a>
        )}
      </div>
    </div>
  );
}
