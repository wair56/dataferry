'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Side, FileEntry } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { checkHasDataCache, getDataCache } from '@/lib/indexeddb';
import { fetchWithIdbCache } from '@/lib/idb-cache';
import { convertCachedDataToMarkdown } from '@/lib/ast-to-markdown';

interface FilePanelProps {
  panelId: string; // 'left' | 'right'
  onSelect: (files: FileEntry[]) => void;
}

// 权限批量导入 JSON
const SCOPES_JSON = JSON.stringify({
  scopes: {
    tenant: ["drive:drive", "drive:drive:readonly", "wiki:wiki:readonly"],
    user: [
      "drive:drive", "drive:drive:readonly", "drive:file:upload",
      "drive:export:readonly", "docs:document:export",
      "contact:user.base:readonly", "docx:document", "docx:document:readonly",
      "sheets:spreadsheet", "sheets:spreadsheet:readonly", 
      "bitable:app", "bitable:app:readonly", "wiki:wiki", "wiki:wiki:readonly"
    ]
  }
}, null, 2);

// 树节点
interface TreeNode {
  token: string;
  name: string;
  type: string;
  source: 'drive' | 'wiki';
  created_time?: string;
  modified_time?: string;
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  children: TreeNode[];
  space_id?: string;
  has_child?: boolean;
  node_token?: string;
  url?: string;
  cached?: boolean;
}

const FILE_ICONS: Record<string, string> = {
  folder: '📁', docx: '📄', doc: '📄', docs: '📄',
  sheet: '📊', bitable: '📋', mindnote: '🧠', slides: '📽️',
  file: '📎', wiki_space: '📚', wiki_node: '📖',
  root_drive: '📁', root_wiki: '📚',
};

const TYPE_NAMES: Record<string, string> = {
  folder: '文件夹', docx: '文档', doc: '文档', docs: '文档',
  sheet: '表格', bitable: '多维表格', mindnote: '思维笔记',
  slides: '演示文稿', file: '文件', wiki_space: '知识库',
  wiki_node: '知识库节点', root_drive: '云空间', root_wiki: '知识库',
};

function formatDate(ts?: string): string {
  if (!ts) return '';
  const num = parseInt(ts, 10);
  if (isNaN(num)) return '';
  const d = new Date(num * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isExpandable(node: TreeNode): boolean {
  if (['folder', 'wiki_space', 'root_drive', 'root_wiki'].includes(node.type)) return true;
  if (node.source === 'wiki' && node.token !== '__root_wiki__' && node.has_child) return true;
  return false;
}

function createRootNodes(): TreeNode[] {
  return [
    { token: '__root_drive__', name: '云空间', type: 'root_drive', source: 'drive', expanded: false, loaded: false, loading: false, children: [] },
    { token: '__root_wiki__', name: '知识库', type: 'root_wiki', source: 'wiki', expanded: false, loaded: false, loading: false, children: [] },
  ];
}

// 面板配置信息
interface PanelConfig {
  side: Side;
  appId: string;
  appSecret: string;
  alias?: string;
  configured: boolean;
}

const SIDE_INFO = {
  feishu: { flag: '🇨🇳', name: '飞书', consoleUrl: 'https://open.feishu.cn/app/', domain: 'open.feishu.cn' },
  lark: { flag: '🌏', name: 'Lark', consoleUrl: 'https://open.larksuite.com/app/', domain: 'open.larksuite.com' },
};

export default function FilePanel({ panelId, onSelect }: FilePanelProps) {
  const { t } = useI18n();
  // 面板配置状态
  const [config, setConfig] = useState<PanelConfig>({ side: 'feishu', appId: '', appSecret: '', alias: '', configured: false });
  const [configMode, setConfigMode] = useState(false); // 是否在配置模式
  const [configStep, setConfigStep] = useState(1); // 1=选平台, 2=填凭证, 3=权限提示
  const [copied, setCopied] = useState(false);

  // 树状态
  const [tree, setTree] = useState<TreeNode[]>(createRootNodes());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [virtualRoot, setVirtualRoot] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<PanelConfig[]>([]);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewData, setPreviewData] = useState<{ title: string; content: string } | null>(null);

  // 从 localStorage 恢复配置
  useEffect(() => {
    try {
      // 恢复单边持久化配置
      const raw = localStorage.getItem(`panel_config_${panelId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.configured) {
          setConfig(saved);
        }
      }
      
      // 恢复 OAuth user token
      const savedToken = localStorage.getItem(`user_token_${panelId}`);
      if (savedToken) {
        setUserToken(savedToken);
      }

      // 读取历史连接
      const rawHistory = localStorage.getItem('connection_history');
      if (rawHistory) {
        setHistory(JSON.parse(rawHistory));
      }
    } catch { /* ignore */ }
  }, [panelId]);

  // 当 userToken 变化时（授权/注销），重置树状态
  useEffect(() => {
    setTree(createRootNodes());
  }, [userToken]);

  // 保存配置到 localStorage
  const saveConfig = useCallback(async (cfg: PanelConfig) => {
    setConfig(cfg);
    localStorage.setItem(`panel_config_${panelId}`, JSON.stringify(cfg));
    
    // 更新历史记录
    try {
      const rawHist = localStorage.getItem('connection_history');
      let histList: PanelConfig[] = rawHist ? JSON.parse(rawHist) : [];
      histList = histList.filter((h) => h.appId !== cfg.appId);
      histList.unshift(cfg);
      if (histList.length > 5) histList.length = 5;
      localStorage.setItem('connection_history', JSON.stringify(histList));
      setHistory(histList);
    } catch { /* ignore */ }
  }, [panelId]);

  // 完成配置
  const finishConfig = useCallback(() => {
    const newCfg = { ...config, configured: true };
    saveConfig(newCfg);
    setConfigMode(false);
    setConfigStep(1);
    setTree(createRootNodes());
    setSelected(new Set());
    setVirtualRoot(null);
  }, [config, saveConfig]);

  // 快速使用历史记录
  const applyHistory = useCallback((h: PanelConfig) => {
    const newCfg = { ...h, configured: true };
    saveConfig(newCfg);
    setConfigMode(false);
    setConfigStep(1);
    setTree(createRootNodes());
    setSelected(new Set());
    setVirtualRoot(null);
  }, [saveConfig]);

  // 编辑历史记录并进入凭证填写页
  const editHistory = useCallback((h: PanelConfig) => {
    setConfig({ ...h, configured: false });
    setConfigStep(2);
  }, []);

  // 移除历史记录
  const removeHistory = useCallback((appId: string) => {
    try {
      const rawHist = localStorage.getItem('connection_history');
      let histList: PanelConfig[] = rawHist ? JSON.parse(rawHist) : [];
      histList = histList.filter((h) => h.appId !== appId);
      localStorage.setItem('connection_history', JSON.stringify(histList));
      setHistory(histList);
    } catch { /* ignore */ }
  }, []);

  // 加载云空间
  const fetchDriveChildren = useCallback(async (folderToken: string): Promise<TreeNode[]> => {
    const params = new URLSearchParams({ side: config.side, appId: config.appId, appSecret: config.appSecret });
    if (folderToken && folderToken !== '__root_drive__') params.set('folder_token', folderToken);
    if (userToken) params.set('user_token', userToken);
    const data = await fetchWithIdbCache(`/api/files?${params}`, undefined, isRefreshing);
    if (data.error) throw new Error(data.error);
    const files = data.files || [];
    const cacheMap = await checkHasDataCache(files.map((f: FileEntry) => f.token));
    return files.map((f: FileEntry, i: number) => ({
      token: f.token || `drive_${i}`, name: f.name, type: f.type, source: 'drive' as const,
      created_time: f.created_time, modified_time: f.modified_time,
      url: f.url,
      cached: cacheMap[f.token],
      expanded: false, loaded: false, loading: false, children: [],
    }));
  }, [config.side, config.appId, config.appSecret, userToken]);

  // 加载知识库
  const fetchWikiChildren = useCallback(async (nodeToExpand: string, parentNode?: TreeNode): Promise<TreeNode[]> => {
    const params = new URLSearchParams({ side: config.side, appId: config.appId, appSecret: config.appSecret });
    
    if (parentNode && parentNode.source === 'wiki' && parentNode.space_id) {
       params.set('space_id', parentNode.space_id);
       params.set('parent_node_token', parentNode.node_token || nodeToExpand);
    } else {
       if (nodeToExpand && nodeToExpand !== '__root_wiki__') params.set('space_id', nodeToExpand);
    }

    if (userToken) params.set('user_token', userToken);
    const data = await fetchWithIdbCache(`/api/wiki?${params}`, undefined, isRefreshing);
    if (data.error) throw new Error(data.error);
    const files = data.files || [];
    const cacheMap = await checkHasDataCache(files.map((f: FileEntry) => f.token));
    return files.map((f: FileEntry, i: number) => ({
      token: f.token || `wiki_${i}`, node_token: f.node_token, name: f.name, type: f.type, source: 'wiki' as const,
      created_time: f.created_time, modified_time: f.modified_time,
      url: f.url,
      space_id: f.space_id,
      has_child: f.has_child,
      cached: cacheMap[f.token],
      expanded: false, loaded: false, loading: false, children: [],
    }));
  }, [config.side, config.appId, config.appSecret, userToken]);

  // 递归更新节点
  const updateNode = useCallback((nodes: TreeNode[], token: string, updater: (n: TreeNode) => TreeNode): TreeNode[] => {
    return nodes.map((n) => {
      if (n.token === token) return updater(n);
      if (n.children.length > 0) {
        const nc = updateNode(n.children, token, updater);
        if (nc !== n.children) return { ...n, children: nc };
      }
      return n;
    });
  }, []);

  // 展开/折叠
  const toggleExpand = useCallback(async (node: TreeNode) => {
    if (!isExpandable(node)) return;
    if (node.expanded) {
      setTree((p) => updateNode(p, node.token, (n) => ({ ...n, expanded: false })));
      return;
    }
    if (!node.loaded) {
      setTree((p) => updateNode(p, node.token, (n) => ({ ...n, loading: true })));
      try {
        let children: TreeNode[];
        if (node.source === 'drive' || node.type === 'root_drive') {
          children = await fetchDriveChildren(node.token);
        } else {
          children = await fetchWikiChildren(node.node_token || node.token, node);
        }
        const src = node.type === 'root_drive' ? 'drive' : node.type === 'root_wiki' ? 'wiki' : node.source;
        children = children.map((c) => ({ ...c, source: src }));
        setTree((p) => updateNode(p, node.token, (n) => ({ ...n, expanded: true, loaded: true, loading: false, children })));
      } catch (err) {
        const msg = err instanceof Error ? err.message : '加载失败';
        setError(msg);
        if (msg.includes('99991677') || msg.toLowerCase().includes('expired')) {
          localStorage.removeItem(`user_token_${panelId}`);
          setUserToken(null);
        }
        setTree((p) => updateNode(p, node.token, (n) => ({ ...n, loading: false })));
      }
    } else {
      setTree((p) => updateNode(p, node.token, (n) => ({ ...n, expanded: true })));
    }
  }, [updateNode, fetchDriveChildren, fetchWikiChildren]);

  const findNode = useCallback((nodes: TreeNode[], token: string): TreeNode | null => {
    for (const n of nodes) {
      if (n.token === token) return n;
      const found = findNode(n.children, token);
      if (found) return found;
    }
    return null;
  }, []);

  // 递归刷新保持展开状态
  const refreshNodeTree = useCallback(async (nodes: TreeNode[]): Promise<TreeNode[]> => {
    const promises = nodes.map(async (node) => {
      if (node.loaded) {
        try {
           let newChildren = node.source === 'drive' || node.type === 'root_drive' 
             ? await fetchDriveChildren(node.token) 
             : await fetchWikiChildren(node.node_token || node.token, node);
           const src = node.type === 'root_drive' ? 'drive' : node.type === 'root_wiki' ? 'wiki' : node.source;
           newChildren = newChildren.map(c => ({ ...c, source: src }));
           
           const oldChildrenMap = new Map(node.children.map(c => [c.token, c]));
           newChildren = newChildren.map(nc => {
             const oc = oldChildrenMap.get(nc.token);
             if (oc) return { ...nc, expanded: oc.expanded, loaded: oc.loaded, children: oc.children };
             return nc;
           });

           newChildren = await refreshNodeTree(newChildren);
           return { ...node, children: newChildren };
        } catch { return node; }
      }
      return node;
    });
    return Promise.all(promises);
  }, [fetchDriveChildren, fetchWikiChildren]);

  // 刷新当前视图
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const newTree = await refreshNodeTree(tree);
      setTree(newTree);
    } finally {
      setIsRefreshing(false);
    }
  }, [tree, refreshNodeTree]);

  // 新建文件夹
  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt(t('panel.newFolderPrompt') || '请输入新建文件夹名称：');
    if (!name) return;

    let targetFolder = '';
    let targetSpaceId = undefined;
    let targetNodeToken = undefined;

    const selectedArr = Array.from(selected);
    let tgtNode = null;

    if (selectedArr.length === 1) {
      tgtNode = findNode(tree, selectedArr[0]);
    } else if (virtualRoot) {
      tgtNode = findNode(tree, virtualRoot);
    } else {
      tgtNode = tree.find(n => n.type === 'root_drive');
    }

    if (tgtNode) {
      if (tgtNode.type === 'root_drive' || tgtNode.type === 'folder') {
        targetFolder = tgtNode.token === '__root_drive__' ? '' : tgtNode.token;
      } else if (tgtNode.type === 'root_wiki') {
        targetSpaceId = '__create_space__';
      } else if (tgtNode.source === 'wiki') {
        targetSpaceId = tgtNode.space_id;
        if (tgtNode.type !== 'wiki_space') {
          targetNodeToken = tgtNode.node_token || tgtNode.token;
        }
      } else {
        alert(t('panel.newFolderErrType') || '只允许在云空间文件夹或知识库内新建');
        return;
      }
    } else {
      return;
    }

    setIsRefreshing(true);
    try {
      const params = { 
        side: config.side, appId: config.appId, appSecret: config.appSecret, userToken: userToken || undefined, 
        name, folderToken: targetFolder, spaceId: targetSpaceId, nodeToken: targetNodeToken 
      };
      const resp = await fetch('/api/create-folder', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params) 
      });
      let data: any;
      try {
        data = await resp.json();
      } catch {
        throw new Error(`服务器异常响应 (${resp.status})`);
      }
      if (!resp.ok || data.error) throw new Error(data.error || '创建操作受阻，可能暂无此权限或节点受限');

      const newTree = await refreshNodeTree(tree);
      setTree(newTree);
    } catch (e) {
      alert((t('panel.createFailed') || '操作失败: ') + (e as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  }, [tree, selected, virtualRoot, findNode, config, userToken, refreshNodeTree, t]);

  // OAuth 授权登录
  const handleOAuthLogin = useCallback(() => {
    const domain = config.side === 'feishu' ? 'open.feishu.cn' : 'open.larksuite.com';
    const redirectUri = encodeURIComponent(`${window.location.origin}/api/auth/callback`);
    const state = encodeURIComponent(JSON.stringify({ side: config.side }));
    const url = `https://${domain}/open-apis/authen/v1/index?redirect_uri=${redirectUri}&app_id=${config.appId}&state=${state}`;
    
    window.open(url, 'lark_auth', 'width=600,height=800');
    
    const listener = async (e: MessageEvent) => {
      if (e.data?.type === 'lark-oauth' && e.data.code) {
        window.removeEventListener('message', listener);
        try {
          const res = await fetch('/api/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: e.data.code, side: config.side, appId: config.appId, appSecret: config.appSecret })
          });
          const data = await res.json();
          if (data.access_token) {
            setUserToken(data.access_token);
            // 持久化 token 到 localStorage
            localStorage.setItem(`user_token_${panelId}`, data.access_token);
            // 重置视图以触发重新加载
            setVirtualRoot(null);
            setTree(createRootNodes());
            setError('');
          } else {
            // 授权码已使用？如果已有 token 则静默忽略
            const errMsg = data.error || '未知错误';
            if (errMsg.includes('20003') || errMsg.includes('has been used')) {
              if (userToken) return; // 已有 token，无需报错
              setError('授权码已过期，请重新点击授权按钮');
            } else {
              setError('授权失败: ' + errMsg);
            }
          }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch(err: any) {
          setError(err.message);
        }
      }
    };
    window.addEventListener('message', listener);
  }, [config.appId, config.side]);

  // 扁平化
  const flattenTree = useCallback((nodes: TreeNode[], depth: number = 0, ancestors: string[] = []): (TreeNode & { depth: number, ancestors: string[] })[] => {
    const result: (TreeNode & { depth: number, ancestors: string[] })[] = [];
    for (const node of nodes) {
      result.push({ ...node, depth, ancestors });
      if (node.expanded && node.children.length > 0) {
        result.push(...flattenTree(node.children, depth + 1, [...ancestors, node.token]));
      }
    }
    return result;
  }, []);

  const displayNodes = virtualRoot
    ? (() => { const r = findNode(tree, virtualRoot); return r ? flattenTree(r.children, 0, [r.token]) : []; })()
    : flattenTree(tree, 0, []);
  const virtualRootNode = virtualRoot ? findNode(tree, virtualRoot) : null;

  const toggleSelect = useCallback((token: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(token)) n.delete(token); else n.add(token);
      return n;
    });
  }, []);

  useEffect(() => {
    const all = flattenTree(tree, 0, []);
    const sf: FileEntry[] = all
      .filter((n) => selected.has(n.token))
      .filter((n) => !n.ancestors.some(a => selected.has(a))) // Skip if any parent is also selected
      .map((n) => ({ token: n.token, node_token: n.node_token, name: n.name, type: n.type, created_time: n.created_time, modified_time: n.modified_time, space_id: n.space_id, has_child: n.has_child, source: n.source, url: n.url }));
    onSelect(sf);
  }, [selected, tree, flattenTree, onSelect]);

  const info = SIDE_INFO[config.side];
  const permUrl = config.appId ? `https://${info.domain}/app/${config.appId}/auth` : '';

  // ===================== 渲染 =====================

  // 未配置 + 不在配置模式 → 显示配置入口
  if (!config.configured && !configMode) {
    return (
      <div className="panel">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔌</div>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 8, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{t('panel.notConfigured')}</p>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 20, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{t('panel.configHint')}</p>
          <button className="btn btn-primary" onClick={() => setConfigMode(true)}>{t('panel.configure')}</button>
        </div>
      </div>
    );
  }

  // 配置模式
  if (configMode) {
    return (
      <div className="panel" style={{ position: 'relative' }}>
        {/* 配置标题栏 */}
        <div className="panel-config-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
          <span style={{ fontWeight: 600, fontSize: 14, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>🔧 {t('panel.configTitle')}</span>
          <button className="btn btn-sm" onClick={() => { setConfigMode(false); }} style={{ borderRadius: '50%', width: 28, height: 28, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto', padding: 24 }}>
          {/* 步骤 1: 选平台 */}
          {configStep === 1 && (
            <div className="config-step" style={{ width: '100%', margin: 'auto' }}>
              <p style={{ fontWeight: 600, marginBottom: 16, textShadow: '0 1px 3px rgba(0,0,0,0.8)', fontSize: 18 }}>{t('panel.selectPlatform')}</p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className={`platform-card ${config.side === 'feishu' ? 'active' : ''}`} onClick={() => setConfig((p) => ({ ...p, side: 'feishu' }))}>
                  <span style={{ fontSize: 28 }}>🇨🇳</span>
                  <span>Feishu</span>
                </button>
                <button className={`platform-card ${config.side === 'lark' ? 'active' : ''}`} onClick={() => setConfig((p) => ({ ...p, side: 'lark' }))}>
                  <span style={{ fontSize: 28 }}>🌏</span>
                  <span>Lark</span>
                </button>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 16, justifyContent: 'center', fontSize: 14 }}
                onClick={() => setConfigStep(2)}>
                {t('panel.next')}
              </button>

              {/* 历史配置 */}
              {history.length > 0 && (
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'rgba(255,255,255,0.8)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                    {t('panel.savedConnections')}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {history.map((h, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 20 }}>{h.side === 'feishu' ? '🇨🇳' : '🌏'}</span>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                              {h.side === 'feishu' ? 'Feishu' : 'Lark'}
                              {h.alias ? <span style={{ color: 'var(--accent)', marginLeft: 6 }}>({h.alias})</span> : ''}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }} title={h.appId}>
                              {h.appId.substring(0, 8)}...{h.appId.substring(h.appId.length - 4)}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm" onClick={() => removeHistory(h.appId)} title={t('panel.removeHistory')}>
                            🗑️
                          </button>
                          <button className="btn btn-sm" onClick={() => editHistory(h)} title={t('panel.editHistory')}>
                            ✏️
                          </button>
                          <button className="btn btn-sm btn-primary" onClick={() => applyHistory(h)}>
                            {t('panel.quickUse')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 步骤 2: 填凭证 */}
          {configStep === 2 && (
            <div className="config-step" style={{ width: '100%', margin: 'auto' }}>
              <p style={{ fontWeight: 600, marginBottom: 8, fontSize: 16, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{info.flag} {info.name} — {t('panel.credentials')}</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 16, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                <a href={info.consoleUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('panel.consoleLink')}</a> — {t('panel.credentialsHint')}
              </p>
              <div className="config-field" style={{ marginBottom: 16 }}>
                <label style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{t('panel.alias')} / 备注</label>
                <input className="input" type="text" placeholder={t('panel.aliasPlaceholder')}
                  value={config.alias || ''} onChange={(e) => setConfig((p) => ({ ...p, alias: e.target.value }))} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)' }} />
              </div>
              <div className="config-field" style={{ marginBottom: 16 }}>
                <label style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>App ID</label>
                <input className="input" type="text" placeholder="cli_xxxxxxxxxxxx"
                  value={config.appId} onChange={(e) => setConfig((p) => ({ ...p, appId: e.target.value }))} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)' }} />
              </div>
              <div className="config-field" style={{ marginBottom: 20 }}>
                <label style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>App Secret</label>
                <input className="input" type="password" placeholder="App Secret xxxxxxxxx"
                  value={config.appSecret} onChange={(e) => setConfig((p) => ({ ...p, appSecret: e.target.value }))} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setConfigStep(1)}>{t('panel.back')}</button>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}
                  disabled={!config.appId || !config.appSecret}
                  onClick={() => setConfigStep(3)}>
                  {t('panel.next')}
                </button>
              </div>
            </div>
          )}

          {/* 步骤 3: 权限提示 + 完成 */}
          {configStep === 3 && (
            <div className="config-step" style={{ width: '100%', margin: 'auto' }}>
              <p style={{ fontWeight: 600, marginBottom: 8, fontSize: 16, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{t('panel.permTitle')}</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 16, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{t('panel.permHint')}</p>
              
              <div style={{ padding: 12, background: 'rgba(255,255,255,0.1)', borderRadius: 'var(--radius-sm)', marginBottom: 16, fontSize: 12, border: '1px solid rgba(255,255,255,0.2)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                <strong style={{ color: '#fff' }}>⚠️ {t('panel.redirectHint')}</strong><br />
                {t('panel.redirectDesc')}<br />
                <code style={{ userSelect: 'all', color: 'var(--accent)', background: 'rgba(0,0,0,0.4)', padding: '4px 8px', marginTop: 8, borderRadius: 4, display: 'inline-block' }}>{typeof window !== 'undefined' ? `${window.location.origin}/api/auth/callback` : 'https://dataferry.helper.is/api/auth/callback'}</code>
              </div>

              <div className="json-import-block" style={{ marginBottom: 16 }}>
                <div className="json-import-header" style={{ background: 'transparent' }}>
                  <span style={{ fontSize: 12, textShadow: '0 1px 2px rgba(0,0,0,0.8)', fontWeight: 500 }}>{t('panel.permJson')}</span>
                  <button className="btn btn-sm btn-primary" onClick={() => { navigator.clipboard.writeText(SCOPES_JSON); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                    {copied ? t('panel.copied') : t('panel.copy')}
                  </button>
                </div>
                <pre className="json-code" style={{ fontSize: 10, maxHeight: 120, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>{SCOPES_JSON}</pre>
              </div>
              {permUrl && (
                <a href={permUrl} target="_blank" rel="noreferrer" className="btn" style={{ width: '100%', justifyContent: 'center', marginBottom: 16, fontSize: 14 }}>
                  {t('panel.openPermPage')}
                </a>
              )}
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn" onClick={() => setConfigStep(2)}>{t('panel.back')}</button>
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', fontSize: 14 }}
                  onClick={finishConfig}>
                  {t('panel.finishConfig')}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  const canRefresh = !!virtualRootNode;
  
  const selectedNodes = Array.from(selected).map(t => findNode(tree, t)).filter(Boolean);
  const singleSelectedName = selectedNodes.length === 1 ? selectedNodes[0]?.name : null;

  return (
    <div className="panel">
      {/* 面板头部 */}
      <div className="panel-toolbar">
        <button className="nav-btn" onClick={() => setConfigMode(true)} title={t('panel.editConfig')}>
          ⚙️
        </button>
        <div className="platform-tag" style={{ margin: '0 4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title={t('panel.editConfig')}>
          <div onClick={() => setConfigMode(true)}>
            {config.side === 'feishu' ? '🇨🇳 Feishu' : '🌏 Lark'}
            {config.alias ? <span style={{ opacity: 0.8, marginLeft: 4 }}>({config.alias})</span> : ''}
          </div>
          <span 
            onClick={(e) => { 
              e.stopPropagation(); 
              setConfig(p => ({ ...p, configured: false })); 
              setUserToken(null); 
            }}
            style={{ marginLeft: 8, padding: '0 6px', cursor: 'pointer', opacity: 0.5, fontSize: 16 }}
            title="断开连接"
          >
            ×
          </span>
        </div>
        <button className={`nav-btn ${!virtualRoot ? 'active' : ''}`} style={{ marginLeft: 6 }} onClick={() => { setVirtualRoot(null); setSelected(new Set()); }} disabled={!virtualRoot} title={t('panel.resetTop')}>
          🏠
        </button>

        <div className="breadcrumb" style={{ flex: 1, marginLeft: 4, display: 'flex', alignItems: 'center' }}>
          {virtualRootNode && (
            <>
              <span className="breadcrumb-sep" style={{ margin: '0 4px', color: 'var(--text-muted)' }}>›</span>
              <span className="breadcrumb-item active" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {FILE_ICONS[virtualRootNode.type] || '📁'} {virtualRootNode.name}
              </span>
            </>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="nav-btn" onClick={handleCreateFolder} title={t('panel.newFolder') || '新建文件夹'}>
            ➕
          </button>
          <button className="nav-btn" style={{ opacity: isRefreshing ? 0.5 : 1 }} onClick={handleRefresh} disabled={isRefreshing} title={t('panel.refreshState') || '原样刷新状态'}>
            🔄
          </button>

          {!userToken && config.configured && (
            <button className="btn btn-sm btn-primary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={handleOAuthLogin}>
              {t('panel.authPull') || '👤 授权拉取全部'}
            </button>
          )}
          {userToken && (
             <button 
               className="btn btn-sm" 
               style={{ padding: '2px 8px', fontSize: 12, color: 'var(--success)', background: 'rgba(0,255,0,0.1)', border: '1px solid rgba(0,255,0,0.3)' }} 
               onClick={() => { localStorage.removeItem(`user_token_${panelId}`); setUserToken(null); }}
               title={t('panel.cancelAuth') || '点击取消授权'}
             >
               ✅ {t('panel.authorized') || '已授权 (可点击注销)'}
             </button>
          )}
        </div>
      </div>

      {/* 表头 */}
      <div className="file-table-header">
        <span style={{ width: 24 }}></span>
        <span style={{ width: 20 }}></span>
        <span>{t('table.name')}</span>
        <span>{t('table.date')}</span>
        <span>{t('table.type')}</span>
      </div>

      {error && (
        <div style={{ 
          padding: '8px 12px', 
          fontSize: '0.8rem', 
          color: 'var(--error)', 
          background: 'linear-gradient(90deg, rgba(255, 60, 60, 0.15) 0%, rgba(255, 60, 60, 0.05) 100%)', 
          backdropFilter: 'blur(12px)', 
          WebkitBackdropFilter: 'blur(12px)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          borderBottom: '1px solid rgba(255, 100, 100, 0.2)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, letterSpacing: '0.3px', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
            <span style={{ fontSize: '1rem' }}>⚠️</span>
            <span>{error}</span>
          </div>
          <button className="btn btn-sm" style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: '#eee' }} onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* 树状列表 */}
      <div className="file-table">
        {displayNodes.length === 0 && !virtualRoot ? (
          // 根目录 — 显示根节点提示
          <div style={{ padding: 16, textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('panel.expandHint')}</p>
          </div>
        ) : null}

        {(virtualRoot ? displayNodes : flattenTree(tree, 0)).map((node) => {
          const expandable = isExpandable(node);
          return (
            <div
              key={`${node.token}-${node.depth}`}
              className={`file-row ${selected.has(node.token) ? 'selected' : ''}`}
              style={{ paddingLeft: 8 + node.depth * 20 }}
              onDoubleClick={() => {
                if (expandable) {
                  if (!node.expanded) {
                    toggleExpand(node).then(() => setVirtualRoot(node.token));
                  } else {
                    setVirtualRoot(node.token);
                  }
                }
              }}
            >
              <span
                className="tree-toggle"
                onClick={(e) => { e.stopPropagation(); toggleExpand(node); }}
                style={{ width: 20, display: 'inline-flex', justifyContent: 'center', cursor: expandable ? 'pointer' : 'default', opacity: expandable ? 1 : 0.3, fontSize: 11 }}
              >
                {node.loading ? '⏳' : expandable ? (node.expanded ? '▼' : '▶') : '·'}
              </span>
              {!(node.type === 'root_drive' || node.type === 'root_wiki') ? (
                <input type="checkbox" className="checkbox"
                  checked={selected.has(node.token)} onChange={() => toggleSelect(node.token)} />
              ) : (
                <span style={{ display: 'inline-block', width: 16, margin: '0 4px' }} />
              )}
              <div className="file-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="file-icon">{FILE_ICONS[node.type] || '📎'}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={node.name}>{node.name}</span>
                {node.cached && (
                  <span 
                    title="已完全离线归档至 IndexedDB (点击以纯脱机预览 Markdown)" 
                    style={{ fontSize: 13, cursor: 'pointer', opacity: 0.8, transition: 'all 0.2s', display: 'inline-block' }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      const d = await getDataCache(node.token);
                      if (d) {
                         const md = convertCachedDataToMarkdown(node.type, d.payload, node.name);
                         setPreviewData({ title: node.name, content: md });
                      }
                    }}
                    onMouseOver={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.2)' }}
                    onMouseOut={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'scale(1)' }}
                  >💾</span>
                )}
                {node.url && (
                  <a href={node.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} 
                     style={{ 
                       color: 'rgba(255, 255, 255, 0.8)', padding: '5px', display: 'flex', alignItems: 'center', 
                       justifyContent: 'center', borderRadius: '4px', transition: 'all 0.2s', marginLeft: '6px'
                     }}
                     onMouseOver={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)'; }}
                     onMouseOut={e => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)'; e.currentTarget.style.background = 'transparent'; }}
                     title={t('transfer.openInBrowser') || '在浏览器中打开'}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                )}
                {node.expanded && node.children.length > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>({node.children.length})</span>
                )}
              </div>
              <span className="file-date">{formatDate(node.modified_time || node.created_time)}</span>
              <span className="file-type">{t(`type.${node.type}`) || node.type}</span>
            </div>
          );
        })}
      </div>
      {previewData && typeof document !== 'undefined' ? createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }} onClick={() => setPreviewData(null)}>
          <div style={{ 
              width: '80%', maxWidth: 800, height: '80%', 
              background: 'linear-gradient(135deg, rgba(30,30,45,0.65), rgba(20,20,30,0.85))', 
              backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
              borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', 
              display: 'flex', flexDirection: 'column', overflow: 'hidden', 
              boxShadow: '0 24px 64px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)' 
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.15)' }}>
               <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#e0e0e0', display: 'flex', alignItems: 'center', gap: 8 }}>
                 <span style={{ fontSize: 18 }}>💾</span> 脱机全量 Markdown 快照预览 - {previewData.title}
               </h3>
               <button className="btn btn-sm" onClick={() => setPreviewData(null)} style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none' }}>✕ 退出</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '24px 30px' }}>
               <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.6, color: '#c9d1d9', fontFamily: 'Consolas, Monaco, monospace' }}>
                 {previewData.content || '该节点所属大类尚未配置适用的 Markdown 转译器，或是属于尚未抓取实体的逻辑外壳容器。'}
               </pre>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
