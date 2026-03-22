'use client';

import React, { useState, useCallback, useEffect } from 'react';
import type { Side, ConfigStatusType, ScopeCheckResult } from '@/lib/types';

// 文档迁移所需的全部权限清单及说明
const REQUIRED_PERMISSIONS = [
  { scope: 'drive:drive', name: '云空间', desc: '访问云空间根目录', required: true },
  { scope: 'drive:drive:readonly', name: '云空间只读', desc: '浏览文件/文件夹列表', required: true },
  { scope: 'drive:file', name: '文件管理', desc: '管理文件（移动/复制/删除）', required: true },
  { scope: 'drive:file:readonly', name: '文件只读', desc: '⭐ 下载文件和图片/附件素材（图片迁移必须）', required: true },
  { scope: 'drive:export:readonly', name: '云空间导出', desc: '将文档导出为 ZIP/Office 格式', required: true },
  { scope: 'docs:document:export', name: '文档导出', desc: '将云文档导出为原生格式', required: true },
  { scope: 'drive:file:upload', name: '文件上传', desc: '上传迁移后的文件到目标端', required: true },
  { scope: 'docx:document', name: '文档读写', desc: '读取和创建云文档', required: true },
  { scope: 'docx:document:readonly', name: '文档只读', desc: '导出云文档内容', required: true },
  { scope: 'sheets:spreadsheet', name: '表格读写', desc: '读取和创建电子表格', required: true },
  { scope: 'sheets:spreadsheet:readonly', name: '表格只读', desc: '导出电子表格内容', required: true },
  { scope: 'bitable:app', name: '多维表格读写', desc: '读取和创建多维表格', required: true },
  { scope: 'bitable:app:readonly', name: '多维表格只读', desc: '导出多维表格内容', required: true },
  { scope: 'wiki:wiki', name: '知识库读写', desc: '读取和创建知识库节点', required: true },
  { scope: 'wiki:wiki:readonly', name: '知识库只读', desc: '浏览知识库文档列表', required: true },
  { scope: 'task:task:readonly', name: '任务只读', desc: '读取文档中嵌入的任务块详情', required: false },
  { scope: 'contact:user.id:readonly', name: '用户身份', desc: '获取当前登录用户信息', required: false },
];

// 批量导入 JSON
const SCOPES_JSON = JSON.stringify({
  scopes: {
    tenant: [
      "drive:drive",
      "drive:drive:readonly",
      "drive:file",
      "drive:file:readonly",
      "wiki:wiki:readonly"
    ],
    user: [
      "drive:drive",
      "drive:drive:readonly",
      "drive:file",
      "drive:file:readonly",
      "drive:file:upload",
      "drive:export:readonly",
      "docs:document:export",
      "contact:user.id:readonly",
      "docx:document",
      "docx:document:readonly",
      "sheets:spreadsheet",
      "sheets:spreadsheet:readonly",
      "bitable:app",
      "bitable:app:readonly",
      "wiki:wiki",
      "wiki:wiki:readonly",
      "task:task:readonly"
    ]
  }
}, null, 2);

interface SetupPageProps {
  onSetupComplete: () => void;
}

interface SideConfig {
  status: ConfigStatusType;
  appId: string;
  appSecret: string;
  scopes: ScopeCheckResult;
  permissionUrl: string;
  error: string;
}

const SIDE_INFO = {
  feishu: {
    flag: '🇨🇳',
    name: '飞书 (Feishu)',
    consoleUrl: 'https://open.feishu.cn/app/',
    domain: 'open.feishu.cn',
  },
  lark: {
    flag: '🌏',
    name: 'Lark (国际版)',
    consoleUrl: 'https://open.larksuite.com/app/',
    domain: 'open.larksuite.com',
  },
};

// 流程顺序：飞书完整3步 → Lark完整3步
const FLOW: Side[] = ['feishu', 'lark'];

const LS_KEY = 'feishu_lark_setup';

function loadSavedState(): { sideIndex: number; step: number; configs: Record<Side, SideConfig> } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export default function SetupPage({ onSetupComplete }: SetupPageProps) {
  const saved = typeof window !== 'undefined' ? loadSavedState() : null;
  const [sideIndex, setSideIndex] = useState(saved?.sideIndex ?? 0);
  const [step, setStep] = useState(saved?.step ?? 1);
  const [configs, setConfigs] = useState<Record<Side, SideConfig>>(saved?.configs ?? {
    feishu: { status: 'unchecked', appId: '', appSecret: '', scopes: { granted: [], missing: [] }, permissionUrl: '', error: '' },
    lark: { status: 'unchecked', appId: '', appSecret: '', scopes: { granted: [], missing: [] }, permissionUrl: '', error: '' },
  });
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [permTab, setPermTab] = useState<'batch' | 'manual'>('batch');

  // 自动保存到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ sideIndex, step, configs }));
    } catch { /* ignore */ }
  }, [sideIndex, step, configs]);

  const currentSide = FLOW[sideIndex];
  const currentInfo = SIDE_INFO[currentSide];
  const currentConfig = configs[currentSide];

  // 检测权限
  const checkPermissions = useCallback(async () => {
    const cfg = configs[currentSide];
    if (!cfg.appId.trim() || !cfg.appSecret.trim()) return;

    setChecking(true);
    try {
      const params = new URLSearchParams({
        side: currentSide,
        appId: cfg.appId.trim(),
        appSecret: cfg.appSecret.trim(),
      });
      const resp = await fetch(`/api/config/check?${params}`);
      const data = await resp.json();

      setConfigs((prev) => ({
        ...prev,
        [currentSide]: {
          ...prev[currentSide],
          status: data.status,
          scopes: data.scopes || { granted: [], missing: [] },
          permissionUrl: data.permission_url || '',
          error: data.error || '',
        },
      }));
    } catch (err) {
      setConfigs((prev) => ({
        ...prev,
        [currentSide]: {
          ...prev[currentSide],
          status: 'invalid',
          error: err instanceof Error ? err.message : '检测失败',
        },
      }));
    } finally {
      setChecking(false);
    }
  }, [configs, currentSide]);

  // 更新凭证
  const updateField = (field: 'appId' | 'appSecret', value: string) => {
    setConfigs((prev) => ({
      ...prev,
      [currentSide]: { ...prev[currentSide], [field]: value, status: 'unchecked' },
    }));
  };

  // 复制 JSON
  const copyJson = () => {
    navigator.clipboard.writeText(SCOPES_JSON);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 下一步逻辑 — 不强制验证通过才能继续
  const handleNext = () => {
    if (step < 3) {
      if (step === 1) checkPermissions(); // 填完凭证自动预检
      setStep(step + 1);
    } else {
      // 步骤 3：无论是否验证通过都允许继续
      if (sideIndex < FLOW.length - 1) {
        setSideIndex(sideIndex + 1);
        setStep(1);
      }
    }
  };

  // 上一步逻辑
  const handlePrev = () => {
    if (step > 1) {
      setStep(step - 1);
    } else if (sideIndex > 0) {
      // 回到上一个平台的最后一步
      setSideIndex(sideIndex - 1);
      setStep(3);
    }
  };

  // 保存配置并进入主界面
  const handleComplete = async () => {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feishu: { appId: configs.feishu.appId, appSecret: configs.feishu.appSecret },
          lark: { appId: configs.lark.appId, appSecret: configs.lark.appSecret },
        }),
      });
      onSetupComplete();
    } catch (err) {
      console.error('保存配置失败:', err);
    } finally {
      setSaving(false);
    }
  };

  const bothReady = configs.feishu.status === 'ready' && configs.lark.status === 'ready';
  const currentReady = currentConfig.status === 'ready';
  // 全局步骤 = sideIndex * 3 + step (用于进度计算)
  const globalStep = sideIndex * 3 + step;
  const totalSteps = FLOW.length * 3;

  const statusMap: Record<ConfigStatusType, { icon: string; label: string; cls: string }> = {
    unchecked: { icon: '⚪', label: '未检测', cls: 'status-unchecked' },
    checking: { icon: '🔄', label: '检测中...', cls: 'status-checking' },
    ready: { icon: '🟢', label: '就绪', cls: 'status-ready' },
    partial: { icon: '🟡', label: '缺少权限', cls: 'status-partial' },
    invalid: { icon: '🔴', label: '凭证无效', cls: 'status-invalid' },
  };
  const st = statusMap[currentConfig.status];

  // 权限管理页 URL
  const permUrl = currentConfig.permissionUrl || (currentConfig.appId ? `https://${currentInfo.domain}/app/${currentConfig.appId}/auth` : '');

  return (
    <div className="setup-page">
      {/* 标题 */}
      <div className="setup-title">⚙️ 飞书 / Lark 文档迁移工具</div>

      {/* 全局进度 */}
      <div className="wizard-steps">
        {FLOW.map((side, si) => {
          const info = SIDE_INFO[side];
          const cfg = configs[side];
          const isDone = cfg.status === 'ready';
          const isActive = si === sideIndex;
          return (
            <React.Fragment key={side}>
              {si > 0 && <div className="wizard-step-line" style={{ width: 24 }}></div>}
              {[1, 2, 3].map((s) => {
                const stepLabels = ['创建应用', '配置权限', '验证连接'];
                const gStep = si * 3 + s;
                const done = isDone || (isActive && step > s) || si < sideIndex;
                const active = isActive && step === s;
                return (
                  <React.Fragment key={`${side}-${s}`}>
                    {s > 1 && <div className="wizard-step-line" style={{ width: 16 }}></div>}
                    <div className={`wizard-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
                      <span className="wizard-step-num">{done ? '✓' : gStep}</span>
                      {s === 1 && <span style={{ fontSize: 11, opacity: 0.7 }}>{info.flag}</span>}
                      <span>{stepLabels[s - 1]}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* 当前平台标识 */}
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
        {currentInfo.flag} 正在配置：<strong style={{ color: 'var(--text-primary)' }}>{currentInfo.name}</strong>
        {configs.feishu.status === 'ready' && <span className="status-badge status-ready" style={{ marginLeft: 8 }}>🇨🇳 飞书 ✓</span>}
        {configs.lark.status === 'ready' && <span className="status-badge status-ready" style={{ marginLeft: 4 }}>🌏 Lark ✓</span>}
      </div>

      {/* 步骤内容 */}
      <div className="wizard-content">
        {/* ========== 步骤 1: 创建应用 & 填入凭证 ========== */}
        {step === 1 && (
          <div className="step-card">
            <h3>在 {currentInfo.name} 创建自建应用</h3>
            <div className="step-instructions">
              <div className="instruction-item">
                <span className="instruction-num">①</span>
                <div>
                  <p>打开开发者控制台，点击「创建企业自建应用」：</p>
                  <a href={currentInfo.consoleUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginTop: 8 }}>
                    🔗 打开 {currentInfo.name} 开发者控制台
                  </a>
                </div>
              </div>
              <div className="instruction-item">
                <span className="instruction-num">②</span>
                <div>
                  <p>填写应用名称（如&quot;文档迁移工具&quot;），创建成功后复制 <strong>App ID</strong> 和 <strong>App Secret</strong> 到下方：</p>
                </div>
              </div>
            </div>

            <div className="credential-fields">
              <div className="config-field">
                <label>App ID</label>
                <input
                  className="input"
                  type="text"
                  placeholder="cli_xxxxxxxxxxxx"
                  value={currentConfig.appId}
                  onChange={(e) => updateField('appId', e.target.value)}
                />
              </div>
              <div className="config-field">
                <label>App Secret</label>
                <input
                  className="input"
                  type="password"
                  placeholder="点击凭证与基础信息中的 App Secret 复制"
                  value={currentConfig.appSecret}
                  onChange={(e) => updateField('appSecret', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========== 步骤 2: 配置权限 ========== */}
        {step === 2 && (
          <div className="step-card">
            <h3>为 {currentInfo.name} 应用添加云文档权限</h3>

            {/* Tab 切换 */}
            <div className="perm-tabs">
              <button
                className={`perm-tab ${permTab === 'batch' ? 'active' : ''}`}
                onClick={() => setPermTab('batch')}
              >
                🚀 批量导入 JSON
              </button>
              <button
                className={`perm-tab ${permTab === 'manual' ? 'active' : ''}`}
                onClick={() => setPermTab('manual')}
              >
                📝 手动逐项开通
              </button>
            </div>

            {/* Tab: 批量导入 */}
            {permTab === 'batch' && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  复制下方 JSON，在开放平台「权限管理」页面点击「批量开通」粘贴即可一次性开通所有权限。
                </p>
                <div className="json-import-block">
                  <div className="json-import-header">
                    <span>📋 权限配置 JSON</span>
                    <button className="btn btn-sm btn-primary" onClick={copyJson}>
                      {copied ? '✅ 已复制!' : '📋 一键复制'}
                    </button>
                  </div>
                  <pre className="json-code">{SCOPES_JSON}</pre>
                </div>

                {permUrl && (
                  <a href={permUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>
                    🔗 打开 {currentInfo.name} 权限管理页 → 粘贴上方 JSON
                  </a>
                )}
              </div>
            )}

            {/* Tab: 手动逐项 */}
            {permTab === 'manual' && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  在开发者控制台的「权限管理」页面，搜索并逐一开通以下权限：
                </p>
                <div className="permission-table">
                  <div className="permission-header">
                    <span>权限 Scope</span>
                    <span>名称</span>
                    <span>用途</span>
                    <span>必须</span>
                    <span>状态</span>
                  </div>
                  {REQUIRED_PERMISSIONS.map((p) => {
                    const isGranted = currentConfig.scopes.granted.includes(p.scope);
                    return (
                      <div key={p.scope} className="permission-row">
                        <code>{p.scope}</code>
                        <span>{p.name}</span>
                        <span className="permission-desc">{p.desc}</span>
                        <span>{p.required ? '✳️ 必须' : '可选'}</span>
                        <span className={isGranted ? 'scope-granted' : 'scope-missing'}>
                          {currentConfig.status === 'unchecked' ? '—' : isGranted ? '✅ 已开通' : '❌ 未开通'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {permUrl && (
                  <a href={permUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>
                    🔗 打开 {currentInfo.name} 权限管理页
                  </a>
                )}
              </div>
            )}

            <div className="instruction-item" style={{ marginTop: 16 }}>
              <span className="instruction-num">②</span>
              <div>
                <p>添加完权限后，<strong>需要创建应用版本并发布</strong>，由管理员审核通过后权限才生效。</p>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                  💡 提示：使用「测试企业和用户」功能可跳过管理员审核，直接测试。
                </p>
              </div>
            </div>

            {/* 即时检查按钮 */}
            <button
              className="btn"
              onClick={checkPermissions}
              disabled={checking || !currentConfig.appId || !currentConfig.appSecret}
              style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
            >
              {checking ? '检测中...' : '🔍 即时检查权限状态'}
            </button>
            {currentConfig.status !== 'unchecked' && (
              <div style={{ marginTop: 8, textAlign: 'center' }}>
                <span className={`status-badge ${statusMap[currentConfig.status].cls}`}>
                  {statusMap[currentConfig.status].icon} {statusMap[currentConfig.status].label}
                  {currentConfig.scopes.granted.length > 0 && ` · ${currentConfig.scopes.granted.length} 项已开通`}
                  {currentConfig.scopes.missing.length > 0 && ` · ${currentConfig.scopes.missing.length} 项缺失`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ========== 步骤 3: 验证 ========== */}
        {step === 3 && (
          <div className="step-card">
            <h3>验证 {currentInfo.name} 连接状态</h3>

            <div className={`verify-card ${currentConfig.status === 'ready' ? 'ready' : currentConfig.status === 'partial' ? 'partial' : currentConfig.status === 'invalid' ? 'invalid' : ''}`}
              style={{ marginBottom: 16 }}
            >
              <div className="verify-card-header">
                <span>{currentInfo.flag} {currentInfo.name}</span>
                <span className={`status-badge ${st.cls}`}>{st.icon} {st.label}</span>
              </div>
              <div className="config-field" style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11 }}>App ID</label>
                <input
                  className="input"
                  type="text"
                  placeholder="cli_xxxxxxxxxxxx"
                  value={currentConfig.appId}
                  onChange={(e) => updateField('appId', e.target.value)}
                  style={{ fontSize: 12, padding: '5px 8px' }}
                />
              </div>
              <div className="config-field" style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11 }}>App Secret</label>
                <input
                  className="input"
                  type="password"
                  placeholder="AppSecret"
                  value={currentConfig.appSecret}
                  onChange={(e) => updateField('appSecret', e.target.value)}
                  style={{ fontSize: 12, padding: '5px 8px' }}
                />
              </div>
              {currentConfig.scopes.granted.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--success)', marginBottom: 4 }}>
                  ✅ {currentConfig.scopes.granted.length} 个权限已开通
                </div>
              )}
              {currentConfig.scopes.missing.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--error)', marginBottom: 4 }}>
                  ❌ {currentConfig.scopes.missing.length} 个权限缺失
                  {permUrl && (
                    <> · <a href={permUrl} target="_blank" rel="noreferrer">前往开通</a></>
                  )}
                </div>
              )}
              {currentConfig.error && (
                <div style={{ fontSize: 11, color: 'var(--error)', marginBottom: 4 }}>{currentConfig.error}</div>
              )}
              <button
                className="btn"
                onClick={checkPermissions}
                disabled={checking || !currentConfig.appId || !currentConfig.appSecret}
                style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}
              >
                {checking ? '检测中...' : '🔍 检测连接'}
              </button>
            </div>

            {/* 提示信息 */}
            <div style={{ padding: 12, background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border-color)', marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                💡 <strong>提示</strong>：在开放平台添加完权限后，需要<strong>创建应用版本并发布上线</strong>，权限才会生效。
                如果应用尚未发布，可以先点「下一步」继续配置另一端，等应用审核通过后再回来检测。
              </p>
            </div>

            {currentReady && sideIndex < FLOW.length - 1 && (
              <div style={{ textAlign: 'center', padding: 12, background: '#51cf6610', borderRadius: 'var(--radius)', border: '1px solid var(--success)' }}>
                <p style={{ color: 'var(--success)', fontWeight: 600 }}>✅ {currentInfo.name} 配置完成！点击「下一步」配置 {SIDE_INFO[FLOW[sideIndex + 1]].name}</p>
              </div>
            )}

            {bothReady && (
              <div style={{ textAlign: 'center', padding: 12, background: '#51cf6610', borderRadius: 'var(--radius)', border: '1px solid var(--success)' }}>
                <p style={{ color: 'var(--success)', fontWeight: 600 }}>🎉 两端均已就绪！可以进入文件管理器了。</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部导航 */}
      <div className="wizard-footer">
        <button
          className="btn"
          onClick={handlePrev}
          disabled={sideIndex === 0 && step === 1}
        >
          ← 上一步
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
          <span>飞书: {configs.feishu.status === 'ready' ? '🟢' : configs.feishu.status === 'partial' ? '🟡' : configs.feishu.status === 'invalid' ? '🔴' : '⚪'}</span>
          <span>Lark: {configs.lark.status === 'ready' ? '🟢' : configs.lark.status === 'partial' ? '🟡' : configs.lark.status === 'invalid' ? '🔴' : '⚪'}</span>
        </div>

        {bothReady ? (
          <button className="btn btn-primary" onClick={handleComplete} disabled={saving}>
            {saving ? '保存中...' : '🚀 进入文件管理器'}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleNext}
            disabled={step === 1 && (!currentConfig.appId || !currentConfig.appSecret)}
          >
            {step === 3 && currentReady && sideIndex < FLOW.length - 1
              ? `配置 ${SIDE_INFO[FLOW[sideIndex + 1]].name} →`
              : '下一步 →'
            }
          </button>
        )}
      </div>
    </div>
  );
}
