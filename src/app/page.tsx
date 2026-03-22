'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Rnd } from 'react-rnd';
import FilePanel from '@/components/FilePanel';
import TransferQueue from '@/components/TransferQueue';
import { useI18n } from '@/lib/i18n';
import WelcomeModal from '@/components/WelcomeModal';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { Side, FileEntry, TransferItem } from '@/lib/types';
import { convertCachedDataToMarkdown } from '@/lib/ast-to-markdown';

function RecursivePromptModal({ mode, onClose, onConfirm, downloadMedia, setDownloadMedia }: { mode: 'download' | 'transfer', onClose: () => void, onConfirm: (recursive: boolean) => void, downloadMedia?: boolean, setDownloadMedia?: (val: boolean) => void }) {
  const { t } = useI18n();
  const isDl = mode === 'download';
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ 
        background: 'linear-gradient(135deg, rgba(30, 32, 40, 0.75) 0%, rgba(20, 22, 28, 0.85) 100%)',
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 24px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
        borderRadius: '16px',
        color: '#fff'
      }}>
        <h2>{isDl ? '离线导出选项' : t('recursivePrompt.title')}</h2>
        <div className="modal-body">
          <p>{isDl ? '您勾选的源目录中包含多层级结构。是否连同内部的所有级联文档一并拍平、压缩打包下载？' : t('recursivePrompt.desc1')}</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            - <strong>{isDl ? '是，还原并打包全部子文件' : t('recursivePrompt.yes')}:</strong> {isDl ? '完美1:1还原云端目录树内所有嵌套节点至本地 ZIP 压缩包快速转存。' : t('recursivePrompt.yesDesc')}<br/>
            - <strong>{isDl ? '否，仅下载选中项' : t('recursivePrompt.no')}:</strong> {isDl ? '物理层切断子树遍历，仅抽离主干文档本身。' : t('recursivePrompt.noDesc')}
          </p>

          {isDl && setDownloadMedia && (
             <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0, opacity: 0.9 }}>
                   <input type="checkbox" checked={downloadMedia} onChange={e => setDownloadMedia(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                   <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>囊括多媒体附件原图 (离线图床)</span>
                </label>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6, marginLeft: 24, lineHeight: 1.5 }}>
                   开启此选项将在打包时跨域取回每一份富文本文档中的原始附带资源（图集、画板等），转存并替换为离线文件夹 `assets/` 后备依赖系。
                </div>
             </div>
          )}
        </div>
        <div className="modal-footer" style={{ gap: 12 }}>
          <button className="btn" onClick={onClose}>{t('recursivePrompt.cancel')}</button>
          <button className="btn" onClick={() => onConfirm(false)}>{isDl ? '否，仅下主文档' : t('recursivePrompt.noBtn')}</button>
          <button className="btn btn-primary" onClick={() => onConfirm(true)}>{isDl ? '是，下钻压缩全集' : t('recursivePrompt.yesBtn')}</button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { t, locale, setLocale } = useI18n();
  const [showWelcome, setShowWelcome] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [leftSelected, setLeftSelected] = useState<FileEntry[]>([]);
  const [rightSelected, setRightSelected] = useState<FileEntry[]>([]);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [recursivePrompt, setRecursivePrompt] = useState<{ transferable: FileEntry[], target: FileEntry | 'local', sourcePanel: 'left' | 'right', targetPanel: 'left' | 'right' | 'local' } | null>(null);
  const [downloadMedia, setDownloadMedia] = useState(false);

  const zipRef = useRef<JSZip | null>(null);
  const isZippingRef = useRef(false);

  // Use a ref to access latest transfers in async callbacks without dependency issues
  const transfersRef = useRef(transfers);
  useEffect(() => { transfersRef.current = transfers; }, [transfers]);

  useEffect(() => {
    if (!localStorage.getItem('hide_welcome')) setShowWelcome(true);
    setMounted(true);
  }, []);

  // 获取面板配置和 token
  const getPanelCreds = useCallback((panelId: 'left' | 'right') => {
    try {
      const raw = localStorage.getItem(`panel_config_${panelId}`);
      const cfg = raw ? JSON.parse(raw) : {};
      const userToken = localStorage.getItem(`user_token_${panelId}`) || '';
      return { side: cfg.side as 'feishu' | 'lark', appId: cfg.appId || '', appSecret: cfg.appSecret || '', userToken };
    } catch { return { side: 'feishu' as const, appId: '', appSecret: '', userToken: '' }; }
  }, []);

  const processTransferItem = useCallback(async (item: TransferItem) => {
    const src = getPanelCreds(item.sourceSide === getPanelCreds('left').side ? 'left' : 'right');
    const tgt = item.targetSide !== 'local' ? getPanelCreds(item.targetSide === getPanelCreds('right').side ? 'right' : 'left') : null;
    
    try {
      // ===== 阶段一：尝试从离线内存/远端抓取 Payload 至本地 =====
      let cachedData = null;
      let usedCache = false;

      // 只有复杂格式需要依赖底层 AST 或者 Record 数据抓取存盘
      if (['docx', 'sheet', 'bitable'].includes(item.fileType)) {
        const CacheDb = await import('@/lib/indexeddb');
        const tokenToCache = item.objToken || item.fileToken;
        
        const existingCache = await CacheDb.getDataCache(tokenToCache);
        // 若存在缓存且没指定 modifiedTime(散状传) 或 缓存时间 >= 修改时间，则命中
        if (existingCache && (!item.modifiedTime || existingCache.fetchedAt >= item.modifiedTime)) {
           cachedData = existingCache.payload;
           usedCache = true;
           setTransfers(p => p.map(t => t.id === item.id ? { ...t, status: 'exporting', message: '⚡ 命中完全离线缓存包' } : t));
        } else {
           setTransfers(p => p.map(t => t.id === item.id ? { ...t, status: 'exporting', message: '⬇️ 正在将源数据全量下潜进入离线池...' } : t));
           const resAst = await fetch('/api/export/ast', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ 
                ...item, 
                sourceAppId: src.appId, sourceAppSecret: src.appSecret, sourceUserToken: src.userToken,
                fileToken: tokenToCache
             })
           });
           if (!resAst.ok) throw new Error('提取原生数据矩阵失败 (AST Extraction Failed)');
           const d = await resAst.json();
           if (d.data) {
             cachedData = d.data;
             await CacheDb.saveDataCache({
                id: tokenToCache, type: item.fileType, payload: cachedData, fetchedAt: Date.now()
             });
           }
        }
      }

      // ===== 阶段二：分拨目标源 (下载本地方案 vs 注入远端方案) =====
      if (item.targetSide === 'local') {
        setTransfers(p => p.map(t => t.id === item.id ? { ...t, status: 'downloading', progress: 50, message: '正在构建基础物理文件流...' } : t));
        
        // 只有独立的物理文件流 (pdf/img/zip) 需要向服务器 /api/export 或 drive API 获取底层二进制
        // 而飞书自研的虚构复杂云文档 (docx/bitable/sheet) 现全面并入 IndexedDB 落盘方案，靠前端本地算力直接出排版内容
        if (!['folder', 'wiki_space', 'wiki_node', 'root_drive', 'root_wiki'].includes(item.fileType)) {
          const zipPath = `${item.sourcePath.replace(/^\/+/, '')}`;
          let finalZipPath = zipPath;

          if (item.fileType === 'file') {
            // 普通物理文件：向网络抓取
            const res = await fetch('/api/export', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                 ...item, sourceAppId: src.appId, sourceAppSecret: src.appSecret, sourceUserToken: src.userToken,
                 fileToken: item.objToken || item.fileToken 
              })
            });
            if (!res.ok) {
               let errMsg = '流转下载彻底失败';
               try { const d = await res.json(); if (d.error) errMsg = d.error; } catch {}
               throw new Error(errMsg);
            }
            setTransfers(p => p.map(t => t.id === item.id ? { ...t, progress: 85, message: '正在卷收远端二进制文件流...' } : t));
            const blob = await res.blob();
            if (zipRef.current) zipRef.current.file(finalZipPath, blob);
          } else if (cachedData && zipRef.current) {
            // 飞书专属文档：纯粹采用此前抓取到本地 IDB（秒切）出来的 AST Payload 生成。
            const extMap: Record<string, string> = { docx: 'docx', doc: 'docx', sheet: 'xlsx', slides: 'pptx', bitable: 'xlsx' };
            const ext = extMap[item.fileType] || 'docx';
            finalZipPath = zipPath.endsWith(`.${ext}`) ? zipPath : `${zipPath}.${ext}`;

            // 落盘源始巨 JSON（利于开发者检查）
            zipRef.current.file(`${finalZipPath}.feishu.json`, JSON.stringify(cachedData, null, 2));
            
            // 落盘基于前端算力编译的清爽版 Markdown
            try {
              const assets: any[] = [];
              const mdContent = convertCachedDataToMarkdown(item.fileType, cachedData, item.fileName, 'feishu', undefined, undefined, assets);
              if (mdContent) {
                zipRef.current.file(`${finalZipPath}.md`, mdContent);

                if (downloadMedia && assets.length > 0) {
                   setTransfers(p => p.map(t => t.id === item.id ? { ...t, message: `正在抓取并封填随文资源 (${assets.length}项)...` } : t));
                   
                   for (const asset of assets) {
                      try {
                         const res = await fetch(`/api/media?token=${asset.token}&side=${item.sourceSide}&appId=${src.appId}&appSecret=${src.appSecret}&user_token=${src.userToken}`);
                         if (res.ok) {
                            const blob = await res.blob();
                            const pathSegments = finalZipPath.split('/');
                            pathSegments.pop(); // 回退到该文件所处的同级文件夹
                            const dirPath = pathSegments.join('/');
                            const assetFinalDir = dirPath ? `${dirPath}/assets` : 'assets';
                            zipRef.current.file(`${assetFinalDir}/${asset.token}.png`, blob);
                         }
                      } catch (e) {
                         console.warn(`[ZIP静默捞包失败] ${asset.token}`, e);
                      }
                   }
                }
              }
            } catch(e) { console.warn('前端 AST 编译 Markdown 失败 (AST-to-MD compiler fallback):', e); }
          }
        }
        setTransfers(p => p.map(t => t.id === item.id ? { ...t, status: 'done', progress: 100, message: '彻底离线就绪' } : t));
        return;
      }

      // 目标为跨端远端的方案，进入上传注入阶段
      setTransfers(p => p.map(t => t.id === item.id ? { ...t, status: 'uploading', message: usedCache ? '🚀 极速断网注壳中...' : '🚚 正在挂载新实例...' } : t));
      
      fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileToken: item.fileToken, fileType: item.fileType, fileName: item.fileName,
          sourceSide: item.sourceSide, targetSide: item.targetSide,
          sourceAppId: src.appId, sourceAppSecret: src.appSecret, sourceUserToken: src.userToken,
          targetAppId: tgt!.appId, targetAppSecret: tgt!.appSecret, targetUserToken: tgt!.userToken,
          targetFolderToken: item.targetFolderToken,
          targetSpaceId: item.targetSpaceId,
          targetNodeToken: item.targetNodeToken,
          cachedData // 绝对重点：直接交卷！
        }),
      }).then(async (resp) => {
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let eventType = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress') {
                setTransfers((p) => p.map((t) => t.id === item.id
                  ? { ...t, status: data.status, progress: data.progress, message: data.message, ...(data.newToken ? { newToken: data.newToken } : {}) }
                  : t
                ));
              } else if (eventType === 'error') {
                setTransfers((p) => p.map((t) => t.id === item.id
                  ? { ...t, status: 'error', error: data.message, message: data.message }
                  : t
                ));
              } else if (eventType === 'complete') {
                setTransfers((p) => p.map((t) => t.id === item.id
                  ? { ...t, status: 'done', progress: 100, message: data.message, ...(data.newToken ? { newToken: data.newToken } : {}) }
                  : t
                ));
              }
            } catch { /* ignore parse errors */ }
            eventType = '';
          }
        }
      }
    }).catch((err) => {
      setTransfers((p) => p.map((t) => t.id === item.id
        ? { ...t, status: 'error', error: err.message, message: '传输链路异常' }
        : t
      ));
    });
    } catch (globalErr: any) {
      setTransfers((p) => p.map((t) => t.id === item.id
        ? { ...t, status: 'error', error: globalErr.message, message: `致命错误: ${globalErr.message}` }
        : t
      ));
    }
  }, [getPanelCreds]);

  // 获取子节点并入队
  const fetchChildrenAndEnqueue = useCallback(async (parentItem: TransferItem) => {
    try {
      const src = getPanelCreds(parentItem.sourceSide === getPanelCreds('left').side ? 'left' : 'right');
      let children: FileEntry[] | undefined = undefined;
      
      console.log(`[递归展开] 父节点: "${parentItem.fileName}" (type=${parentItem.fileType}, sourceType=${parentItem.sourceType}, token=${parentItem.fileToken}, newToken=${parentItem.newToken})`);
      
      if (parentItem.sourceType === 'wiki' || parentItem.originalFileType === 'wiki_space') {
        const params = new URLSearchParams({ side: parentItem.sourceSide, appId: src.appId, appSecret: src.appSecret });
        if (src.userToken) params.set('user_token', src.userToken);
        const spaceId = parentItem.originalFileType === 'wiki_space' ? parentItem.fileToken : (parentItem.sourceSpaceId || '');
        if (spaceId) params.set('space_id', spaceId);
        
        // 【关键修复】如果是一个具体的文档而不是容器，必须依赖其明确的 node_token 作为树节点往下查！
        if (parentItem.originalFileType === 'wiki_space') {
           // 知识库根目录不需传 parent_node_token
        } else if (parentItem.sourceNodeToken) {
           // 拥有确凿的 Wiki Node 身份，放行递归！
           params.set('parent_node_token', parentItem.sourceNodeToken);
        } else {
           // 既非知识库根，又无树节点身份（例如纯文本/被误传入的假节点）。
           console.log(`[递归跳过] 目标 "${parentItem.fileName}" 缺乏明确 Wiki 节点凭证，切断以防拉空全站: token=${parentItem.fileToken}`);
           children = [];
        }

        if (children === undefined) { 
          // 没有被上面的分支跳过
          console.log(`[递归展开] Wiki API: space_id=${spaceId}, parent_node_token=${params.get('parent_node_token') || 'ROOT'}`);
          const resp = await fetch(`/api/wiki?${params}`);
          const data = await resp.json();
          children = data.files || [];
        }
      } else {
        const params = new URLSearchParams({ side: parentItem.sourceSide, appId: src.appId, appSecret: src.appSecret });
        if (src.userToken) params.set('user_token', src.userToken);
        params.set('folder_token', parentItem.fileToken);
        console.log(`[递归展开] Drive API: folder_token=${parentItem.fileToken}`);
        const resp = await fetch(`/api/files?${params}`);
        const data = await resp.json();
        children = data.files || [];
      }

      if (!children) children = [];
      console.log(`[递归展开] "${parentItem.fileName}" 下发现 ${children.length} 个子节点:`, children.map(c => `${c.name}(${c.type})`));

      if (children.length > 0) {
        let fallbackFolderToken = '';

        // 【云盘结构守护】Wiki 里的复合文档在云盘中是不允许挂载子文档的。如果目标是云盘且父节点不是纯文件夹，必须当场建一个同名文件夹来接纳其子节点。
        if (parentItem.targetSide !== 'local' && !parentItem.targetSpaceId) {
            if (!['folder', 'wiki_space', 'root_drive'].includes(parentItem.fileType)) {
                setTransfers(p => p.map(t => t.id === parentItem.id ? { ...t, message: `✅ 展开 → 正在创建后代安置目录...` } : t));
                const tgtCreds = getPanelCreds(parentItem.targetSide === getPanelCreds('left').side ? 'left' : 'right');
                try {
                  const reqBody = {
                    side: tgtCreds.side, appId: tgtCreds.appId, appSecret: tgtCreds.appSecret, userToken: tgtCreds.userToken,
                    name: parentItem.fileName,
                    folderToken: parentItem.targetFolderToken || ''
                  };
                  const r = await fetch('/api/create-folder', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(reqBody) });
                  const d = await r.json();
                  if (d.folder_token) fallbackFolderToken = d.folder_token;
                } catch(e) { console.warn('Failed to create fallback folder for', parentItem.fileName); }
            }
        }

        // 更新父节点消息显示子节点数量
        setTransfers(p => p.map(t => t.id === parentItem.id ? { ...t, message: `✅ 完成 → 正在组装 ${children.length} 个子节点...` } : t));
        
        const newItems: TransferItem[] = children.map(f => {
          let childTargetFolderToken = '';
          let childTargetSpaceId = undefined;
          let childTargetNodeToken = undefined;

          if (parentItem.targetSpaceId) {
            // Parent is inside Wiki Workspace
            childTargetFolderToken = '';
            childTargetSpaceId = parentItem.targetSpaceId;
            childTargetNodeToken = parentItem.newToken;
          } else if (parentItem.fileType === 'wiki_space') {
            // Parent is a Wiki Space created as a Root Wiki Space
            childTargetFolderToken = '';
            childTargetSpaceId = parentItem.newToken;
            childTargetNodeToken = '';
          } else if (parentItem.fileType === 'folder' || parentItem.fileType === 'root_drive') {
            // Parent is a Drive Folder or casted Wiki Space
            childTargetFolderToken = parentItem.newToken!;
            childTargetSpaceId = undefined;
            childTargetNodeToken = undefined;
          } else {
            // Wiki 文档降级到 Drive：如果有刚才创建的空接盘同名文件夹，塞进去，否则退化为兄弟平级
            childTargetFolderToken = fallbackFolderToken || parentItem.targetFolderToken || '';
            childTargetSpaceId = undefined;
            childTargetNodeToken = undefined;
          }

          // Force type cast for Drive targets so wiki_spaces turn into Folders
          const isTargetWiki = !!childTargetSpaceId || (parentItem.fileType === 'wiki_space' && parentItem.targetSpaceId);
          const actualFileType = f.type === 'wiki_space' && !isTargetWiki ? 'folder' : f.type;
          
          const safeName = f.name ? f.name.replace(/[\/\\:*?"<>|]/g, '_') : 'Unnamed';

          return {
            id: Math.random().toString(36).substring(2, 9),
            batchId: parentItem.batchId,
            parentId: parentItem.id,
            fileToken: f.token,
            fileType: actualFileType,
            originalFileType: f.type,
            fileName: safeName,
            sourceSide: parentItem.sourceSide, targetSide: parentItem.targetSide,
            sourceType: f.source || (parentItem.sourceType === 'wiki' || parentItem.fileType === 'wiki_space' ? 'wiki' : 'drive'),
            sourceSpaceId: parentItem.fileType === 'wiki_space' ? parentItem.fileToken : parentItem.sourceSpaceId,
            sourceNodeToken: f.node_token,
            sourcePath: parentItem.sourcePath + '/' + safeName,
            sourceUrl: f.url,
            targetFolderToken: childTargetFolderToken,
            targetSpaceId: childTargetSpaceId,
            targetNodeToken: childTargetNodeToken, // Fallback if necessary
            status: 'pending' as const, progress: 0,
            recursive: true,
            childrenFetched: false,
            message: '排队中...'
          };
        });
        
        setTransfers(p => [...p, ...newItems]);
        // [修复点] 彻底剥离引发“散落分化与同级克隆”的提前 processTransferItem 并发暴力循坏。
        // 因为它们既然全量挂进了状态表且处于 'pending'，下方的 `useEffect` 自动依赖机就绝对会排排站把它们有条不紊按树图级次派发。提前抢发会导致子级因尚无父标牌而越权附着在了根部。
        setTimeout(() => setTransfers(p => p.map(t => t.id === parentItem.id ? { ...t, message: '✅ 子目录深度探索列队已分发就绪' } : t)), 100);
      } else {
        // 没有子节点 — 更新消息告知用户
        setTransfers(p => p.map(t => t.id === parentItem.id ? { ...t, message: `✅ 完成（无子文件）` } : t));
        console.log(`[递归展开] "${parentItem.fileName}" 没有子节点`);
      }
    } catch (e: any) {
      console.error(`[递归展开] "${parentItem.fileName}" 获取子节点失败:`, e);
      setTransfers(p => p.map(t => t.id === parentItem.id ? { ...t, status: 'error', error: `获取子节点失败: ${e.message}` } : t));
    }
  }, [getPanelCreds, processTransferItem]);

  // ================= 增量依赖智能编排发车引擎 (Delta-Sync Dependency Resolver) =================
  useEffect(() => {
    // 找出所有处于 pending 的车位
    const pendings = transfersRef.current.filter(t => t.status === 'pending');
    if (pendings.length === 0) return;

    const toProcess: TransferItem[] = [];
    const updates: TransferItem[] = [];

    pendings.forEach(child => {
       if (!child.parentId) {
           toProcess.push(child);
           return;
       }

       const dad = transfersRef.current.find(t => t.id === child.parentId);
       if (!dad) {
           toProcess.push(child);
           return;
       }

       if (dad.status === 'done') {
           const c = { ...child };
           if (c.targetSide !== 'local') {
               if (dad.targetSpaceId) {
                  c.targetSpaceId = dad.targetSpaceId;
                  c.targetNodeToken = dad.newToken;
                  c.targetFolderToken = '';
               } else if (dad.fileType === 'wiki_space') {
                  c.targetSpaceId = dad.newToken;
                  c.targetNodeToken = '';
                  c.targetFolderToken = '';
               } else { 
                  c.targetFolderToken = dad.newToken || dad.targetFolderToken || '';
               }
           }
           updates.push(c);
           toProcess.push(c);
       } else if (dad.status === 'error') {
           updates.push({ ...child, status: 'error', error: '上游地块建造失败', message: '❌ 父节点任务断裂撤销' } as TransferItem);
       }
    });

    if (toProcess.length > 0 || updates.length > 0) {
      // 瞬间冻结状态。凡是被推入发射阵列的车，状态强制扭转为 'starting'。防止这短短几十毫秒里被重复轮询导致疯狂开炮！
      setTransfers(p => p.map(t => { 
        const upd = updates.find(u => u.id === t.id); 
        if (upd) return { ...upd, status: upd.status === 'error' ? 'error' : 'starting' };
        if (toProcess.find(u => u.id === t.id)) return { ...t, status: 'starting' };
        return t; 
      }));
      
      // 真实发车
      toProcess.forEach(c => {
         const merged = updates.find(u => u.id === c.id) || c;
         processTransferItem({ ...merged, status: 'starting' });
      });
    }
  }, [transfers, processTransferItem]);

  // 初次启动传输 (全景增量发射系)
  const startTransfer = useCallback((
    sourceFiles: FileEntry[],
    targetLocation: FileEntry | 'local',
    sourcePanel: 'left' | 'right',
    targetPanel: 'left' | 'right' | 'local',
    recursive: boolean
  ) => {
    
    if (targetPanel === 'local') {
      zipRef.current = new JSZip(); 
      zipRef.current.file('metadata.json', JSON.stringify(sourceFiles, null, 2));
      isZippingRef.current = false;
    }

    if (recursive) {
      setTransfers(p => [...p, { id: 'recurse_loading', fileName: '正在极速并发全树测绘库与估算增量差分...', fileType: 'folder', status: 'downloading', progress: 50 } as any]);
      const src = getPanelCreds(sourcePanel);
      fetch('/api/export/recurse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceSide: src.side,
          items: sourceFiles.map(f => ({ ...f, path: f.name, spaceId: f.source === 'wiki' && f.type === 'wiki_space' ? f.token : f.space_id })),
          sourceAppId: src.appId,
          sourceAppSecret: src.appSecret,
          sourceUserToken: src.userToken
        })
      }).then(async res => {
          const data = await res.json();
          setTransfers(p => p.filter(t => t.id !== 'recurse_loading'));
          if (data.items && data.items.length > 0) {
             import('@/lib/indexeddb').then(async ({ checkNeedTransfer }) => {
                const mappedFiles = data.items.map((i: any) => ({
                  id: i.id || i.token, name: i.name, path: i.path || i.name, type: i.realType || i.type,
                  token: i.token, node_token: i.node_token, objToken: i.objToken || i.token,
                  source: sourceFiles[0]?.source, modifiedTime: i.modifiedTime, parentId: i.parentId
                }));
                
                const idbItems = mappedFiles.map((f: any) => ({
                   id: f.id as string, token: f.token, name: f.name, type: f.type, path: f.path, modifiedTime: f.modifiedTime
                }));
                
                // 这是全系重构点：绝对不在这里做保存（防止抹掉已有 targetFolderToken）。只取查询结果并构建！
                const checks = await checkNeedTransfer(idbItems);
                const batchId = "batch_" + new Date().getTime() + "_" + Math.random().toString(36).substring(2,6);

                const newItems = mappedFiles.map((f: any) => {
                   let tgtFolderToken = "";
                   let tgtSpaceId = undefined;
                   let tgtNodeToken = undefined;
                   
                   if (targetLocation !== 'local') {
                      tgtFolderToken = targetLocation.type === 'folder' || targetLocation.type === 'root_drive' ? targetLocation.token : '';
                      tgtSpaceId = targetLocation.type === 'wiki_space' ? targetLocation.token : (targetLocation.source === 'wiki' ? targetLocation.space_id : undefined);
                      tgtNodeToken = targetLocation.type === 'wiki_node' ? targetLocation.token : undefined;
                   }

                   // 长官怒斥：“点了就要发，建个球对比”。绝对服从指令，全量标记待令起跑！
                   let status = 'pending' as const;
                   let progress = 0;
                   let message = '列队部署中 (等待向上级节点挂载)...';
                   
                   if (f.parentId) {
                      tgtFolderToken = ''; tgtSpaceId = undefined; tgtNodeToken = undefined;
                   }

                   return {
                      id: f.id, batchId, parentId: f.parentId, fileToken: f.token, fileType: f.type,
                      originalFileType: f.type, fileName: f.name, sourceSide: src.side,
                      targetSide: targetPanel === 'local' ? 'local' : getPanelCreds(targetPanel as 'left' | 'right').side,
                      sourceType: f.source || 'drive', sourcePath: f.path, sourceSpaceId: f.source === 'wiki' && f.type === 'wiki_space' ? f.token : undefined,
                      sourceNodeToken: f.node_token, objToken: f.objToken, originalId: f.id,
                      modifiedTime: f.modifiedTime, targetFolderToken: tgtFolderToken,
                      targetSpaceId: tgtSpaceId, targetNodeToken: tgtNodeToken, newToken: undefined, status, progress,
                      recursive, childrenFetched: true, message
                   };
                });
                
                console.log("[AbsoluteTransfer] 全图阵列就绪，完全遵从军事指令，共 ", newItems.length, " 个新建落点。");
                setTransfers(p => [...newItems, ...p]);
             });
          }
      }).catch(err => {
         setTransfers(p => p.filter(t => t.id !== 'recurse_loading'));
         alert('远端目录全案解压失效: ' + err.message);
      });
      return;
    }

    // 只有单文件零碎转移或明确无孩子的才走这里
    const batchId = "batch_" + new Date().getTime() + "_" + Math.random().toString(36).substring(2,6);

    const items = sourceFiles.map((f: any) => {
      let tgtFolderToken = ''; let tgtSpaceId = undefined; let tgtNodeToken = undefined;
      if (targetLocation !== 'local') {
        tgtFolderToken = targetLocation.type === 'folder' || targetLocation.type === 'root_drive' ? targetLocation.token : '';
        tgtSpaceId = targetLocation.type === 'wiki_space' ? targetLocation.token : (targetLocation.source === 'wiki' ? targetLocation.space_id : undefined);
        tgtNodeToken = targetLocation.type === 'wiki_node' ? targetLocation.token : undefined;
      }
      const actualFileType = f.type === 'wiki_space' && !tgtSpaceId ? 'folder' : f.type;
      const safeName = f.name ? f.name.replace(/[\/\:*?"<>|]/g, '_') : 'Unnamed';
      let safePath = safeName;
      if (f.path) safePath = f.path.replace(/[:*?"<>|]/g, '_');

      return {
        id: Math.random().toString(36).substring(2, 9), batchId, fileToken: f.token, fileType: actualFileType,
        originalFileType: f.type, fileName: safeName, sourceSide: getPanelCreds(sourcePanel).side,
        targetSide: (targetPanel === 'local' ? 'local' : getPanelCreds(targetPanel as 'left' | 'right').side) as TransferItem['targetSide'],
        sourceType: f.source || 'drive', sourcePath: safePath,
        sourceUrl: f.url || f.url, sourceSpaceId: f.source === 'wiki' && f.type === 'wiki_space' ? f.token : f.space_id,
        sourceNodeToken: f.node_token, objToken: f.objToken, originalId: f.id,
        modifiedTime: f.modifiedTime, targetFolderToken: tgtFolderToken,
        targetSpaceId: tgtSpaceId, targetNodeToken: tgtNodeToken, status: 'pending' as const, progress: 0,
        recursive, childrenFetched: false, message: '排队中...'
      };
    });

    setTransfers(p => [...items as TransferItem[], ...p]);
  }, [getPanelCreds, processTransferItem]);

  const handleRetry = useCallback((item: TransferItem) => {
    if (['pending', 'exporting', 'downloading', 'uploading'].includes(item.status)) return;
    const updatedItem = { ...item, status: 'pending' as const, progress: 0, error: undefined };
    setTransfers(p => p.map(t => t.id === item.id ? updatedItem : t));
    processTransferItem(updatedItem);
  }, [processTransferItem]);

  const handlePreTransfer = (sourcePanel: 'left' | 'right', targetPanel: 'left' | 'right' | 'local', sourceFiles: FileEntry[], targetLocations: FileEntry[]) => {
    if (targetPanel !== 'local' && targetLocations.length > 0 && targetLocations[0].type === 'root_wiki') {
      alert(t('transfer.rootWikiError') || '不能直接发送到知识库根节点！请展开知识库并勾选一个具体的 Space 空间，或者点击 ➕ 号创建一个新的知识库空间。');
      return;
    }

    if (sourceFiles.some(f => f.has_child || f.type === 'folder' || f.type === 'wiki_space' || f.type === 'wiki_node')) {
      setRecursivePrompt({ transferable: sourceFiles, target: targetPanel === 'local' ? 'local' : targetLocations[0], sourcePanel, targetPanel });
    } else {
      startTransfer(sourceFiles, targetPanel === 'local' ? 'local' : targetLocations[0], sourcePanel, targetPanel, false);
    }
  };

  const getTransferableFiles = (files: FileEntry[]) => files.filter(f => !['root_drive', 'root_wiki'].includes(f.type));
  const getTargetLocation = (files: FileEntry[]) => files.filter(f => ['folder', 'wiki_space', 'wiki_node', 'root_drive', 'root_wiki'].includes(f.type) || f.source === 'wiki');

  const sourceLeftFiles = getTransferableFiles(leftSelected);
  const targetLeftLocation = getTargetLocation(leftSelected);

  const sourceRightFiles = getTransferableFiles(rightSelected);
  const targetRightLocation = getTargetLocation(rightSelected);

  const canTransferLeftToRight = sourceLeftFiles.length > 0 && targetRightLocation.length === 1;
  const canTransferRightToLeft = sourceRightFiles.length > 0 && targetLeftLocation.length === 1;

  const transferLeftToRight = () => handlePreTransfer('left', 'right', sourceLeftFiles, targetRightLocation);
  const transferRightToLeft = () => handlePreTransfer('right', 'left', sourceRightFiles, targetLeftLocation);
  
  const downloadLeftLocal = () => handlePreTransfer('left', 'local', sourceLeftFiles, []);
  const downloadRightLocal = () => handlePreTransfer('right', 'local', sourceRightFiles, []);

  // 检测 ZIP 是否下载完毕
  useEffect(() => {
    const localTransfers = transfers.filter(t => t.targetSide === 'local');
    if (localTransfers.length > 0) {
      const isDone = localTransfers.every(t => t.status === 'done' || t.status === 'error');
      if (isDone && zipRef.current && !isZippingRef.current) {
         isZippingRef.current = true;
         zipRef.current.generateAsync({ type: 'blob' }).then(blob => {
           saveAs(blob, `feishu-lark-archive-${new Date().getTime()}.zip`);
         });
         
         // 记录成功的文件到 IndexedDB 进行增量标记
         import('@/lib/indexeddb').then(({ saveTransferHistories }) => {
           const successful = localTransfers.filter(t => t.status === 'done');
           if (successful.length > 0) {
             const updates = successful.map(t => ({
                id: (t as any).originalId || t.id, 
                token: t.fileToken, 
                name: t.fileName, 
                type: t.fileType, 
                path: t.sourcePath || t.fileName, 
                modifiedTime: (t as any).modifiedTime,
                status: 'success'
             }));
             saveTransferHistories(updates).catch(console.error);
           }
         });
         
         // 当 Local 全部下载完成，如果是递归，还应该生成一份审计报告表
         if (localTransfers.length > 1) {
             const report = localTransfers.map(t => ({
                id: t.id, batchId: t.batchId, fileName: t.fileName, 
                sourcePath: t.sourcePath, status: t.status, error: t.error, objToken: t.objToken || t.fileToken 
             }));
             const jsonBlob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
             saveAs(jsonBlob, `feishu-lark-manifest-${new Date().getTime()}.json`);
         }
      }
    }
  }, [transfers]);

  const clearCompleted = useCallback(() => setTransfers((p) => p.filter((t) => t.status !== 'done' && t.status !== 'error')), []);
  const globalProgress = useMemo(() => {
    if (!transfers.length) return 0;
    return Math.round(transfers.reduce((s, t) => s + (['done', 'error'].includes(t.status) ? 100 : t.progress), 0) / transfers.length);
  }, [transfers]);
  const doneCount = transfers.filter((t) => t.status === 'done').length;

  // Rnd 尺寸和位置 state
  const [rndSize, setRndSize] = useState({ width: 800, height: 600 });
  const [rndPos, setRndPos] = useState({ x: 50, y: 50 });

  useEffect(() => {
    const calc = () => {
      const h = window.innerHeight * 0.85;
      const w = Math.min(window.innerWidth * 0.95, h * 1.618);
      const x = Math.max(0, (window.innerWidth - w) / 2);
      const y = Math.max(0, (window.innerHeight - h) / 2);
      setRndSize({ width: w, height: h });
      setRndPos({ x, y });
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  if (!mounted) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', width: '100vw', background: 'transparent', color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>{t('loading')}</div>;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 10 }}>
      {showWelcome && <div style={{ pointerEvents: 'auto' }}><WelcomeModal onClose={() => setShowWelcome(false)} /></div>}
      
      {recursivePrompt && (
        <div style={{ pointerEvents: 'auto' }}>
          <RecursivePromptModal 
            mode={recursivePrompt.targetPanel === 'local' ? 'download' : 'transfer'}
            downloadMedia={downloadMedia}
            setDownloadMedia={setDownloadMedia}
            onClose={() => setRecursivePrompt(null)} 
            onConfirm={(recursive) => {
              startTransfer(recursivePrompt.transferable, recursivePrompt.target, recursivePrompt.sourcePanel, recursivePrompt.targetPanel, recursive);
              setRecursivePrompt(null);
            }} 
          />
        </div>
      )}

      <Rnd
        size={rndSize}
        position={rndPos}
        onDragStop={(_e, d) => setRndPos({ x: d.x, y: d.y })}
        onResizeStop={(_e, _dir, ref, _delta, pos) => {
          setRndSize({ width: parseInt(ref.style.width), height: parseInt(ref.style.height) });
          setRndPos(pos);
        }}
        minWidth={600}
        minHeight={400}
        bounds="parent"
        dragHandleClassName="header"
        style={{ pointerEvents: 'auto', display: 'flex', maxWidth: '100vw', maxHeight: '100vh' }}
      >
        <div className="main-page" style={{ width: '100%', height: '100%' }}>

        <div className="header" style={{ cursor: 'grab' }}>
          <div className="header-side">
          <span style={{ fontWeight: 600, marginRight: 'auto' }}>{t('header.leftPanel')}</span>
          <button className="btn btn-sm" onClick={() => setShowWelcome(true)} title={t('header.help')}>❓</button>
          <button className="btn btn-sm lang-toggle" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')} title="中/EN" style={{ marginRight: 8, marginLeft: 6 }}>
            {locale === 'zh' ? 'EN' : '中'}
          </button>
        </div>

        <div className="header-actions" style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="btn btn-sm" style={{ background: 'var(--primary-dark)', opacity: sourceLeftFiles.length ? 1 : 0.5 }} onClick={downloadLeftLocal} disabled={!sourceLeftFiles.length} title={t('header.zipTitleLeft')}>
            {t('header.zipDownload')}
          </button>
          <button className="btn transfer-btn" onClick={transferLeftToRight} disabled={!canTransferLeftToRight} title={canTransferLeftToRight ? "" : "请在左侧勾选要发送的文件，在右侧勾选1个目标文件夹或知识库"}>
            {t('header.sendRight')}
          </button>
          
          <div className="center-divider" style={{ width: 2, height: 20, background: 'rgba(255, 255, 255, 0.25)', borderRadius: 2, margin: '0 8px' }} />
          
          <button className="btn transfer-btn" onClick={transferRightToLeft} disabled={!canTransferRightToLeft} title={canTransferRightToLeft ? "" : "请在右侧勾选要发送的文件，在左侧勾选1个目标文件夹或知识库"}>
            {t('header.sendLeft')}
          </button>
          <button className="btn btn-sm" style={{ background: 'var(--primary-dark)', opacity: sourceRightFiles.length ? 1 : 0.5 }} onClick={downloadRightLocal} disabled={!sourceRightFiles.length} title={t('header.zipTitleRight')}>
            {t('header.zipDownload')}
          </button>
        </div>

        <div className="header-side" style={{ justifyContent: 'flex-end' }}>
          <span style={{ fontWeight: 600 }}>{t('header.rightPanel')}</span>
        </div>
      </div>

      <div className="panels">
        <FilePanel panelId="left" onSelect={setLeftSelected} />
        <FilePanel panelId="right" onSelect={setRightSelected} />
      </div>

      <TransferQueue items={transfers} onClearCompleted={clearCompleted} onRetry={handleRetry} />

      {transfers.length > 0 && (
        <div className="global-progress">
          <div className="global-progress-bar">
            <div className="global-progress-fill" style={{ width: `${globalProgress}%` }}></div>
          </div>
          <span className="global-progress-text">{doneCount}/{transfers.length} {t('transfer.done')} · {globalProgress}%</span>
        </div>
      )}
      </div>
    </Rnd>
    </div>
  );
}
