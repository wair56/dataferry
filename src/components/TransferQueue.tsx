'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { TransferItem } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

interface TransferQueueProps {
  items: TransferItem[];
  onClearCompleted: () => void;
  onRetry?: (item: TransferItem) => void;
}

// 文件类型图标映射
const TYPE_ICONS: Record<string, string> = {
  docx: '📄', doc: '📄', docs: '📄',
  sheet: '📊', bitable: '📋', mindnote: '🧠',
  slides: '📽️', file: '📎', folder: '📁',
  wiki_space: '📚', wiki_node: '📖',
};

// 按 batchId 分组
interface BatchGroup {
  batchId: string;
  items: TransferItem[];
  rootItems: TransferItem[];
  childItems: TransferItem[];
}

export default function TransferQueue({ items, onClearCompleted, onRetry }: TransferQueueProps) {
  const { t } = useI18n();
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());
  const [reportBatch, setReportBatch] = useState<BatchGroup | null>(null);
  const [panelHeight, setPanelHeight] = useState(25); // vh
  const isDragging = useRef(false);
  const knownBatchIds = useRef<Set<string>>(new Set());
  const completedCount = items.filter((i) => i.status === 'done').length;
  const errorCount = items.filter((i) => i.status === 'error').length;
  const activeCount = items.filter((i) => !['done', 'error', 'pending'].includes(i.status)).length;

  const STATUS_DISPLAY: Record<string, { icon: string; label: string; cls: string }> = {
    pending: { icon: '⏳', label: '队列中', cls: 'status-pending' },
    exporting: { icon: '📤', label: '导出中', cls: 'status-active' },
    downloading: { icon: '⬇️', label: '下载中', cls: 'status-active' },
    uploading: { icon: '⬆️', label: '上传中', cls: 'status-active' },
    done: { icon: '✅', label: '完成', cls: 'status-done' },
    error: { icon: '❌', label: '失败', cls: 'status-error' },
  };

  // 按 batchId 汇总分组
  const batches = useMemo<BatchGroup[]>(() => {
    const groups = new Map<string, TransferItem[]>();
    for (const item of items) {
      const bid = item.batchId || 'default';
      if (!groups.has(bid)) groups.set(bid, []);
      groups.get(bid)!.push(item);
    }
    return Array.from(groups.entries()).map(([batchId, batchItems]) => ({
      batchId,
      items: batchItems,
      rootItems: batchItems.filter(i => !i.parentId || !batchItems.find(p => p.id === i.parentId)),
      childItems: batchItems.filter(i => !!i.parentId && !!batchItems.find(p => p.id === i.parentId)),
    }));
  }, [items]);

  // 新批次自动折叠，不影响已有批次的展开/折叠状态
  useEffect(() => {
    const currentBatchIds = new Set(batches.map(b => b.batchId));
    const newIds: string[] = [];
    for (const id of currentBatchIds) {
      if (!knownBatchIds.current.has(id)) {
        newIds.push(id);
        knownBatchIds.current.add(id);
      }
    }
    if (newIds.length > 0) {
      setCollapsedBatches(prev => {
        const next = new Set(prev);
        newIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [batches]);

  const toggleBatch = (batchId: string) => {
    setCollapsedBatches(prev => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
      return next;
    });
  };

  // 拖拽调整高度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startY = e.clientY;
    const startH = panelHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newH = Math.min(80, Math.max(10, startH + (delta / window.innerHeight) * 100));
      setPanelHeight(newH);
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelHeight]);

  // 生成报告内容（丰富版：文件树 + 源→目标 + 异常）
  const generateReport = (batch: BatchGroup): string => {
    const successCount = batch.items.filter(i => i.status === 'done').length;
    const failCount = batch.items.filter(i => i.status === 'error').length;
    const pendingCount = batch.items.filter(i => i.status === 'pending').length;
    const activeCount = batch.items.filter(i => !['done','error','pending'].includes(i.status)).length;
    const totalCount = batch.items.length;
    const rootItem = batch.rootItems[0] || batch.items[0];
    const srcSide = rootItem?.sourceSide === 'feishu' ? 'Feishu (飞书)' : 'Lark (海外版)';
    const tgtSide = rootItem?.targetSide === 'local' ? '💾 本地下载' : rootItem?.targetSide === 'lark' ? 'Lark (海外版)' : 'Feishu (飞书)';
    
    let md = `# 📋 迁移批次报告\n\n`;
    md += `> **批次 ID:** \`${batch.batchId}\`\n`;
    md += `> **生成时间:** ${new Date().toLocaleString()}\n`;
    md += `> **传输路线:** ${srcSide} → ${tgtSide}\n\n`;
    md += `## 📊 统计概览\n\n`;
    md += `| 指标 | 数量 |\n|------|------|\n`;
    md += `| 总计 | ${totalCount} |\n`;
    md += `| ✅ 成功 | ${successCount} |\n`;
    md += `| ❌ 失败 | ${failCount} |\n`;
    md += `| ⏳ 排队 | ${pendingCount} |\n`;
    md += `| 🔄 进行中 | ${activeCount} |\n\n`;
    
    // 文件树
    md += `## 🌳 文件树\n\n`;
    md += '```\n';
    
    batch.items.forEach(child => {
      const level = child.sourcePath?.split('/').filter(Boolean).length || 1;
      const isVirtuallyRoot = level === 1;
      const prefix = isVirtuallyRoot ? '' : '  '.repeat(level - 1) + '├── ';
      const cIcon = TYPE_ICONS[child.fileType] || '📎';
      const cStatus = child.status === 'done' ? '✅' : child.status === 'error' ? '❌' : '⏳';
      md += `${prefix}${cStatus} ${cIcon} ${child.fileName} *(Type: ${child.fileType})*\n`;
    });
    md += '```\n\n';

    // 详情表
    md += `## 📝 详细清单\n\n`;
    md += `| 状态 | 类型 | 文件名 | Token | 原文链接 | 详情 |\n`;
    md += `|:---:|:---:|:---|:---|:---|:---|\n`;
    batch.items.forEach(i => {
      const statusIcon = i.status === 'done' ? '✅' : i.status === 'error' ? '❌' : i.status === 'pending' ? '⏳' : '🔄';
      const errMsg = i.error ? String(i.error).replace(/\n/g, ' ').replace(/\|/g, '\\|') : '';
      const msg = i.message ? String(i.message).replace(/\n/g, ' ').replace(/\|/g, '\\|') : '';
      const urlInfo = i.sourceUrl ? `[外链](${i.sourceUrl})` : '-';
      md += `| ${statusIcon} | ${i.fileType} | ${i.fileName || '-'} | \`${i.fileToken?.substring(0,12) || '-'}\` | ${urlInfo} | ${errMsg || msg || '-'} |\n`;
    });

    // 异常区
    const errorItems = batch.items.filter(i => i.status === 'error');
    if (errorItems.length > 0) {
      md += `\n## ⚠️ 异常情况 (${errorItems.length} 项)\n\n`;
      errorItems.forEach((item, idx) => {
        const icon = TYPE_ICONS[item.fileType] || '📎';
        md += `### ${idx + 1}. ${icon} ${item.fileName}\n\n`;
        md += `- **类型:** ${item.fileType}\n`;
        md += `- **Token:** \`${item.fileToken || '-'}\`\n`;
        md += `- **错误:** ${item.error || '未知错误'}\n\n`;
      });
    }

    return md;
  };

  // 下载报告
  const downloadReport = (batch: BatchGroup) => {
    const md = generateReport(batch);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `迁移报告_${batch.batchId}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  // 来源→目标 展示
  const routeLabel = (item: TransferItem) => {
    const src = item.sourceSide === 'feishu' ? 'Feishu' : 'Lark';
    const tgt = item.targetSide === 'local' ? '💾 本地' 
              : item.targetSide === 'lark' ? 'Lark' : 'Feishu';
    return `${src} → ${tgt}`;
  };

  // 渲染单行（匹配 7 列 grid: 图标 | 名称 | 路由 | 状态 | 进度 | 消息 | 操作）
  const renderItem = (item: TransferItem, level: number = 0) => {
    const statusInfo = STATUS_DISPLAY[item.status] || STATUS_DISPLAY.pending;
    const icon = TYPE_ICONS[item.fileType] || '📎';
    const isChild = level > 0;
    
    return (
      <div key={item.id} className="transfer-row" style={isChild ? { background: `rgba(255,255,255,${Math.max(0, 0.02 - level * 0.005)})` } : undefined}>
        {/* 列1: 类型图标 (纯净单字符，严禁换行) */}
        <span style={{ fontSize: 14, textAlign: 'center' }} title={item.fileType}>
          {icon}
        </span>

        {/* 列2: 文件名与深度缩进树呈现 */}
        <span style={{ 
          display: 'flex', alignItems: 'center', 
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', 
          color: isChild ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.95)',
          paddingLeft: level * 20
        }} title={item.sourcePath || item.fileName}>
          {isChild && <span style={{ opacity: 0.3, marginRight: 6 }}>└</span>}
          {(() => {
             const pathParts = (item.sourcePath || '').split('/');
             const bName = pathParts.pop();
             return <span style={{ fontWeight: isChild ? 400 : 500 }}>{bName || item.fileName}</span>;
          })()}
        </span>

        {/* 列3: 路由（从哪→到哪） */}
        <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
          {routeLabel(item)}
        </span>

        {/* 列4: 状态标签 */}
        <span className={`transfer-status ${statusInfo.cls}`}>
          {statusInfo.icon} {statusInfo.label}
        </span>

        {/* 列5: 进度条 */}
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${item.progress}%` }}></div>
        </div>

        {/* 列6: 消息/错误 */}
        <span style={{ 
          color: item.error ? 'var(--error)' : 'var(--text-muted)', 
          fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' 
        }} title={item.error || item.message || ''}>
          {item.error ? `⚠️ ${item.error}` : (item.message || '')}
        </span>

        {/* 列7: 操作按钮 */}
        <div style={{ display: 'flex', gap: 4 }}>
          {item.status === 'error' && onRetry && (
            <button className="btn btn-sm" style={{ padding: '0 6px', height: 24, fontSize: 11 }} onClick={() => onRetry(item)} title="重试">🔄</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="transfer-panel" style={{ height: `${panelHeight}vh` }}>
      {/* 拖拽手柄 */}
      <div className="transfer-resize-handle" onMouseDown={handleResizeStart} />
      {/* 面板头部 */}
      <div className="transfer-header">
        <span>
          📡 {t('transfer.queue')}
          {items.length > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 8, fontSize: 12 }}>
              {completedCount}/{items.length} {t('transfer.done')}
              {errorCount > 0 && ` · ${errorCount} ${t('transfer.failed')}`}
              {activeCount > 0 && ` · ${activeCount} ${t('transfer.inProgress')}`}
              {batches.length > 1 && ` · ${batches.length} 批次`}
            </span>
          )}
        </span>
        <div className="transfer-header-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }} title="清除 IndexedDB 缓存" onClick={() => {
            if (confirm('确认清除本地增量同步缓存？(这会让下次递归重新比对所有的文件)')) {
              import('@/lib/indexeddb').then(({ clearAllHistory }) => {
                clearAllHistory().then(() => alert('✅ 本地同步缓存已彻底清空。'));
              });
            }
          }}>
            🧹 增量缓存
          </button>
          {errorCount > 0 && onRetry && (
            <button className="btn btn-sm" onClick={() => {
              items.filter(i => i.status === 'error').forEach((item, idx) => {
                setTimeout(() => onRetry(item), idx * 700);
              });
            }}>🔄 重试全部失败</button>
          )}
          <button className="btn btn-sm" onClick={onClearCompleted} disabled={completedCount + errorCount === 0}>
            {t('transfer.clearDone')}
          </button>
        </div>
      </div>

      {/* 列表区 */}
      <div className="transfer-list">
        {items.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('transfer.hint')}
            </span>
          </div>
        ) : (
          batches.map((batch) => {
            const isCollapsed = collapsedBatches.has(batch.batchId);
            const batchDone = batch.items.filter(i => i.status === 'done').length;
            const batchErr = batch.items.filter(i => i.status === 'error').length;
            const batchTotal = batch.items.length;
            const allFinished = batch.items.every(i => i.status === 'done' || i.status === 'error');

            // 单批次 + 少量文件不显示批次头
            if (batches.length === 1 && batch.rootItems.length <= 1 && batch.childItems.length === 0) {
              return batch.items.map(item => renderItem(item, 0));
            }

            return (
              <div key={batch.batchId} className="batch-group">
                {/* 批次分组头 — 展示完整元信息 */}
                {(() => {
                  // 聚合批次元信息
                  const rootItem = batch.rootItems[0] || batch.items[0];
                  const rootIcon = TYPE_ICONS[rootItem?.fileType] || '📦';
                  const rootName = rootItem?.fileName || '未知文件';
                  const srcSide = rootItem?.sourceSide === 'feishu' ? 'Feishu' : 'Lark';
                  const tgtSide = rootItem?.targetSide === 'local' ? '💾 本地' 
                                : rootItem?.targetSide === 'lark' ? 'Lark' : 'Feishu';
                  const isRecursive = rootItem?.recursive;
                  const avgProgress = Math.round(batch.items.reduce((s, i) => s + i.progress, 0) / batchTotal);
                  const batchActive = batch.items.filter(i => !['done', 'error', 'pending'].includes(i.status)).length;
                  const batchPending = batch.items.filter(i => i.status === 'pending').length;
                  
                  // 批次整体状态
                  let batchStatus = '⏳ 排队中';
                  let batchStatusCls = 'status-pending';
                  if (allFinished && batchErr === 0) { batchStatus = '✅ 全部完成'; batchStatusCls = 'status-done'; }
                  else if (allFinished && batchErr > 0) { batchStatus = `⚠️ 完成(${batchErr}失败)`; batchStatusCls = 'status-error'; }
                  else if (batchActive > 0) { batchStatus = `🔄 进行中(${batchActive})`; batchStatusCls = 'status-active'; }

                  return (
                    <div 
                      className="batch-header"
                      style={{ 
                        cursor: 'pointer', display: 'grid', 
                        gridTemplateColumns: '20px 1.5fr 100px 90px 100px 1fr 80px',
                        alignItems: 'center', gap: 8,
                        padding: '8px 16px', fontSize: 12, fontWeight: 500,
                        background: 'rgba(255,255,255,0.04)', 
                        borderLeft: `3px solid ${batchErr > 0 ? 'var(--error)' : allFinished ? 'var(--success, #4ade80)' : 'var(--primary)'}`,
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                      }}
                      onClick={() => toggleBatch(batch.batchId)}
                    >
                      {/* 折叠指示器 */}
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isCollapsed ? '▶' : '▼'}</span>
                      
                      {/* 根文件名 + 类型图标 */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                        <span>{rootIcon}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }} title={rootName}>
                          {rootName}
                        </span>
                        {isRecursive && <span style={{ fontSize: 10, color: '#60a5fa', background: 'rgba(96,165,250,0.15)', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' }}>🔁 递归</span>}
                      </span>

                      {/* 来源 → 目标 */}
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {srcSide} → {tgtSide}
                      </span>

                      {/* 状态标签 */}
                      <span className={`transfer-status ${batchStatusCls}`} style={{ fontSize: 11 }}>
                        {batchStatus}
                      </span>

                      {/* 整体进度条 */}
                      <div className="progress-bar" style={{ height: 6 }}>
                        <div className="progress-bar-fill" style={{ width: `${avgProgress}%` }}></div>
                      </div>

                      {/* 文件数 + 完成数 */}
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {batchDone}/{batchTotal} 完成{batchErr > 0 ? ` · ${batchErr}❌` : ''}{batchPending > 0 ? ` · ${batchPending}⏳` : ''}
                      </span>

                      {/* 报告查看/下载 — 随时可用 */}
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button 
                          className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px', height: 22 }} 
                          onClick={(e) => { e.stopPropagation(); setReportBatch(batch); }}
                        >📋 报告</button>
                      </div>
                    </div>
                  );
                })()}

                {/* 批次内的任务行 — 展开后显示 */}
                {!isCollapsed && (
                  <>
                    {batch.rootItems.map(rootItem => {
                      const renderTree = (nodeId: string, level: number): React.ReactNode => {
                        const node = batch.items.find(i => i.id === nodeId);
                        if (!node) return null;
                        const children = batch.items.filter(i => i.parentId === nodeId);
                        return (
                          <React.Fragment key={nodeId}>
                            {renderItem(node, level)}
                            {children.map(c => renderTree(c.id, level + 1))}
                          </React.Fragment>
                        );
                      };
                      return renderTree(rootItem.id, 0);
                    })}
                    {/* 孤儿节点兜底: 找不到归属的深层异常碎片或挂载断层资源 */}
                    {batch.childItems.filter(c => !batch.items.find(parent => parent.id === c.parentId)).map(orphan => renderItem(orphan, 1))}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 报告弹窗 Modal */}
      {reportBatch && typeof document !== 'undefined' ? createPortal(
          <div style={{
            position: 'fixed', inset: 0, zIndex: 999999,
            background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => setReportBatch(null)}>
            {/* Modal Box */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(30, 30, 45, 0.65) 0%, rgba(20, 20, 30, 0.85) 100%)', 
              backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 16, width: '80vw', maxWidth: 900, maxHeight: '80vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 64px 0 rgba(0, 0, 0, 0.4), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
            }} onClick={e => e.stopPropagation()}>
              {/* Modal 头部 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                  📋 迁移报告 — {reportBatch.rootItems[0]?.fileName || reportBatch.batchId}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" style={{ fontSize: 11 }}
                    onClick={() => downloadReport(reportBatch)}
                  >⬇️ 下载 MD</button>
                  <button className="btn btn-sm" style={{ fontSize: 14, padding: '0 8px', opacity: 0.6 }}
                    onClick={() => setReportBatch(null)}
                  >✕</button>
                </div>
              </div>
              {/* Modal 正文...复用原来的无状态逻辑 */}
              <div style={{
                flex: 1, overflow: 'auto', padding: '16px 20px',
                fontSize: 13, lineHeight: 1.8, color: 'rgba(255,255,255,0.85)',
              }}>
                {(() => {
                  const batch = reportBatch;
                  const successCount = batch.items.filter(i => i.status === 'done').length;
                  const failCount = batch.items.filter(i => i.status === 'error').length;
                  const rootItem = batch.rootItems[0] || batch.items[0];
                  const srcSide = rootItem?.sourceSide === 'feishu' ? 'Feishu' : 'Lark';
                  const tgtSide = rootItem?.targetSide === 'local' ? '💾 本地' : rootItem?.targetSide === 'lark' ? 'Lark' : 'Feishu';
                  const errorItems = batch.items.filter(i => i.status === 'error');

                  return (
                    <>
                      {/* 路线 + 概览 */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
                        marginBottom: 20, padding: 12, borderRadius: 8,
                        background: 'rgba(255,255,255,0.04)',
                      }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>传输路线</div>
                          <div style={{ fontWeight: 600 }}>{srcSide} → {tgtSide}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>成功/总计</div>
                          <div style={{ fontWeight: 600 }}>✅ {successCount} / {batch.items.length}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>失败</div>
                          <div style={{ fontWeight: 600, color: failCount > 0 ? 'var(--error)' : 'inherit' }}>❌ {failCount}</div>
                        </div>
                      </div>

                      {/* 文件树 */}
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'rgba(255,255,255,0.7)' }}>🌳 文件树</div>
                        <div style={{
                          background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '12px 16px',
                          fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
                          maxHeight: 200, overflow: 'auto',
                        }}>
                          {batch.items.map(child => {
                            const level = child.sourcePath?.split('/').filter(Boolean).length || 1;
                            const isVirtuallyRoot = level === 1;
                            const paddingLeft = isVirtuallyRoot ? 0 : (level - 1) * 20;
                            const prefix = isVirtuallyRoot ? '' : '└── ';
                            const cIcon = TYPE_ICONS[child.fileType] || '📎';
                            const cS = child.status === 'done' ? '✅' : child.status === 'error' ? '❌' : '⏳';
                            return (
                              <div key={child.id} style={{ paddingLeft, display: 'flex', gap: 6, opacity: child.status === 'error' ? 0.8 : 1 }}>
                                <span style={{ whiteSpace: 'pre' }}>{prefix}{cS}</span>
                                <span title={child.fileType}>{cIcon}</span>
                                <span style={{ color: child.status === 'error' ? '#fca5a5' : 'inherit' }}>{child.fileName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 异常情况 */}
                      {errorItems.length > 0 && (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--error)' }}>⚠️ 异常情况 ({errorItems.length} 项)</div>
                          {errorItems.map((item, idx) => (
                            <div key={item.id} style={{
                              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                              borderRadius: 8, padding: '10px 14px', marginBottom: 8,
                            }}>
                              <div style={{ fontWeight: 600, fontSize: 12 }}>{idx+1}. {TYPE_ICONS[item.fileType] || '📎'} {item.fileName}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Token: <code>{item.fileToken || '-'}</code></div>
                              <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{item.error || '未知错误'}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 无异常提示 */}
                      {errorItems.length === 0 && successCount === batch.items.length && (
                        <div style={{
                          textAlign: 'center', padding: 20, color: '#4ade80',
                          fontSize: 14, fontWeight: 600,
                        }}>
                          🎉 全部迁移成功，零异常！
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>,
          document.body
      ) : null}
    </div>
  );
}
