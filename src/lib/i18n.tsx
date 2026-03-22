'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Locale = 'zh' | 'en';

// 翻译字典
const translations: Record<Locale, Record<string, string>> = {
  zh: {
    // 欢迎弹窗
    'welcome.title': '⚙️ 飞书 / Lark 文档迁移工具',
    'welcome.desc': '欢迎使用文档迁移工具！支持在飞书 ↔ Lark、飞书 ↔ 飞书、Lark ↔ Lark 之间同步云文档和知识库。',
    'welcome.quickstart': '🚀 快速开始：',
    'welcome.step1': '点击左/右面板的「🔧 配置连接」按钮',
    'welcome.step2': '选择平台 → 填入 App ID & Secret → 保存',
    'welcome.step3': '展开 📁 云空间 或 📚 知识库，选择文件',
    'welcome.step4': '点击「发送 →」或「← 发送」开始迁移',
    'welcome.tip': '💡 需要先到飞书/Lark 开发者控制台创建自建应用并添加云文档相关权限。',
    'welcome.dontShow': '以后不再显示',
    'welcome.gotIt': '👍 知道了，开始使用',
    // 主页面
    'header.leftPanel': '左侧面板',
    'header.rightPanel': '右侧面板',
    'header.sendRight': '发送 →',
    'header.sendLeft': '← 发送',
    'header.help': '帮助',
    'loading': '加载中...',
    // 传输
    'transfer.queue': '传输列表',
    'transfer.clearDone': '🗑 清除完结任务',
    'transfer.hint': '选择文件后点击"→发送"或"←发送"开始迁移',
    'transfer.done': '完成',
    // FilePanel
    'panel.notConfigured': '未配置连接',
    'panel.configHint': '点击下方按钮配置飞书或 Lark 应用凭证',
    'panel.configure': '🔧 配置连接',
    'panel.configTitle': '🔧 配置连接',
    'panel.selectPlatform': '选择要连接的平台：',
    'panel.next': '下一步 →',
    'panel.back': '← 返回',
    'panel.credentials': '应用凭证',
    'panel.alias': '配置备注（可选）',
    'panel.aliasPlaceholder': '例如：公司飞书主账号 / 部门 Lark',
    'panel.credentialsHint': '创建自建应用，复制凭证到下方。',
    'panel.consoleLink': '开发者控制台',
    'panel.permTitle': '添加云文档权限',
    'panel.permHint': '复制下方 JSON，在权限管理页「批量开通」粘贴：',
    'panel.permJson': '📋 权限 JSON',
    'panel.copy': '📋 复制',
    'panel.copied': '✅ 已复制',
    'panel.openPermPage': '🔗 打开权限管理页',
    'panel.permTip': '💡 权限需创建应用版本并发布后才生效。可先完成配置，稍后再验证。',
    'panel.redirectHint': 'OAuth 授权重定向配置',
    'panel.redirectDesc': '如果不配置，部分跨账号文件将无法读取。请在平台【安全设置】加入以下 URL：',
    'panel.finishConfig': '✅ 完成配置',
    'panel.resetTop': '重置到顶部',
    'panel.editConfig': '修改配置',
    'panel.expandHint': '点击 ▶ 展开查看内容',
    'panel.emptyNode': '该节点下为空',
    'panel.savedConnections': '已保存的连接：',
    'panel.quickUse': '⚡ 快速使用',
    'panel.editHistory': '✏️ 编辑',
    'panel.removeHistory': '🗑️ 移除',
    // 文件类型
    'type.folder': '文件夹',
    'type.docx': '文档',
    'type.doc': '文档',
    'type.docs': '文档',
    'type.sheet': '表格',
    'type.bitable': '多维表格',
    'type.mindnote': '思维笔记',
    'type.slides': '演示文稿',
    'type.file': '文件',
    'type.wiki_space': '知识库',
    'type.wiki_node': '知识库节点',
    'type.root_drive': '云空间',
    'type.root_wiki': '知识库',
    // 表头
    'table.name': '名称',
    'table.date': '修改日期',
    'table.type': '类型',
    'error.loadFailed': '加载失败',
    'error.refreshFailed': '刷新失败',
    // 传输状态
    'status.pending': '等待中',
    'status.exporting': '导出中...',
    'status.downloading': '下载中...',
    'status.uploading': '上传中...',
    'status.done': '✅ 完成',
    'status.error': '❌ 失败',
    'transfer.failed': '失败',
    'transfer.inProgress': '进行中',
    'panel.newFolderPrompt': '请输入新建文件夹名称：',
    'panel.newFolderErrType': '只能在云空间或文件夹内新建文件夹',
    'panel.createFailed': '创建失败: ',
    'panel.authorized': '已授权 (点击注销)',
    'panel.newFolder': '新建文件夹',
    'panel.refreshState': '原样刷新状态',
    'panel.authPull': '👤 授权拉取全部',
    'panel.cancelAuth': '点击取消授权',
    'transfer.rootWikiError': '不能直接发送到知识库根节点！请展开知识库并勾选一个具体的 Space 空间，或者点击 ➕ 号创建一个新的知识库空间。',
    'recursivePrompt.title': '确认发送子文件？',
    'recursivePrompt.desc1': '您勾选的源文件中包含了文件夹或知识库节点。是否需要将其内部的所有子文件和子结构也一并还原（发送）过去？',
    'recursivePrompt.yes': '是',
    'recursivePrompt.yesDesc': '将在此目标位置一比一还原文件夹/知识库树状结构，并自动包含所有内部文件。',
    'recursivePrompt.no': '否',
    'recursivePrompt.noDesc': '仅发送选中节点本身（如把空文件夹创建出来，或仅迁移该知识库文档本身）。',
    'recursivePrompt.cancel': '取消',
    'recursivePrompt.noBtn': '否，仅发送选中项',
    'recursivePrompt.yesBtn': '是，还原并发送全部子文件',
    'header.zipDownload': '⬇️ ZIP打包',
    'header.zipTitleLeft': '将左侧勾选项打包下载到本机',
    'header.zipTitleRight': '将右侧勾选项打包下载到本机'
  },
  en: {
    'welcome.title': '⚙️ Feishu / Lark Migration Tool',
    'welcome.desc': 'Welcome! Migrate docs & wikis between Feishu ↔ Lark, Feishu ↔ Feishu, or Lark ↔ Lark.',
    'welcome.quickstart': '🚀 Quick Start:',
    'welcome.step1': 'Click "🔧 Configure" on either panel',
    'welcome.step2': 'Select platform → Enter App ID & Secret → Save',
    'welcome.step3': 'Expand 📁 Drive or 📚 Wiki, select files',
    'welcome.step4': 'Click "Send →" or "← Send" to start migration',
    'welcome.tip': '💡 You need to create an app in the Feishu/Lark Developer Console and add cloud document permissions first.',
    'welcome.dontShow': "Don't show again",
    'welcome.gotIt': '👍 Got it, let\'s start',
    'header.leftPanel': 'Left Panel',
    'header.rightPanel': 'Right Panel',
    'header.sendRight': 'Send →',
    'header.sendLeft': '← Send',
    'header.help': 'Help',
    'loading': 'Loading...',
    'transfer.queue': 'Transfer Queue',
    'transfer.clearDone': '🗑 Clear Done',
    'transfer.hint': 'Select files and click "Send→" or "←Send" to migrate',
    'transfer.done': 'done',
    'panel.notConfigured': 'Not Configured',
    'panel.configHint': 'Click below to set up Feishu or Lark credentials',
    'panel.configure': '🔧 Configure',
    'panel.configTitle': '🔧 Configure Connection',
    'panel.selectPlatform': 'Select platform:',
    'panel.next': 'Next →',
    'panel.back': '← Back',
    'panel.credentials': 'App Credentials',
    'panel.alias': 'Alias / Remark (Optional)',
    'panel.aliasPlaceholder': 'e.g. My Company Feishu',
    'panel.credentialsHint': 'Create an app and paste credentials below.',
    'panel.consoleLink': 'Developer Console',
    'panel.permTitle': 'Add Document Permissions',
    'panel.permHint': 'Copy the JSON below and paste in "Bulk Enable" on the permissions page:',
    'panel.permJson': '📋 Permissions JSON',
    'panel.copy': '📋 Copy',
    'panel.copied': '✅ Copied',
    'panel.openPermPage': '🔗 Open Permissions Page',
    'panel.permTip': '💡 Permissions take effect after app version is published. You can finish config first.',
    'panel.redirectHint': 'OAuth Redirect URL Configuration',
    'panel.redirectDesc': 'Without this, cross-account files cannot be accessed. Add the following URL in Security Settings:',
    'panel.finishConfig': '✅ Done',
    'panel.resetTop': 'Reset to top',
    'panel.editConfig': 'Edit config',
    'panel.expandHint': 'Click ▶ to expand',
    'panel.emptyNode': 'This node is empty',
    'panel.savedConnections': 'Saved Connections:',
    'panel.quickUse': '⚡ Quick Use',
    'panel.editHistory': '✏️ Edit',
    'panel.removeHistory': '🗑️ Remove',
    'type.folder': 'Folder',
    'type.docx': 'Doc',
    'type.doc': 'Doc',
    'type.docs': 'Doc',
    'type.sheet': 'Sheet',
    'type.bitable': 'Bitable',
    'type.mindnote': 'Mindnote',
    'type.slides': 'Slides',
    'type.file': 'File',
    'type.wiki_space': 'Wiki',
    'type.wiki_node': 'Wiki Node',
    'type.root_drive': 'Drive',
    'type.root_wiki': 'Wiki',
    'table.name': 'Name',
    'table.date': 'Modified',
    'table.type': 'Type',
    'error.loadFailed': 'Failed to load',
    'error.refreshFailed': 'Failed to refresh',
    // Transfer statuses
    'status.pending': 'Pending',
    'status.exporting': 'Exporting...',
    'status.downloading': 'Downloading...',
    'status.uploading': 'Uploading...',
    'status.done': '✅ Done',
    'status.error': '❌ Failed',
    'transfer.failed': 'failed',
    'transfer.inProgress': 'in progress',
    'panel.newFolderPrompt': 'Please enter the name of the new folder:',
    'panel.newFolderErrType': 'Folders can only be created within Drive Space or other folders.',
    'panel.createFailed': 'Creation failed: ',
    'panel.authorized': 'Authorized (Logout)',
    'panel.newFolder': 'New Folder',
    'panel.refreshState': 'Refresh State',
    'panel.authPull': '👤 Authorize & Sync',
    'panel.cancelAuth': 'Click to unauthorize',
    'transfer.rootWikiError': 'Cannot send directly to Wiki Root! Please expand the Wiki and select a specific Space, or create a new Space.',
    'recursivePrompt.title': 'Send Child Files?',
    'recursivePrompt.desc1': 'The selected files include folders or wiki nodes. Do you want to clone their entire internal child structure to the destination?',
    'recursivePrompt.yes': 'Yes',
    'recursivePrompt.yesDesc': 'Will flawlessly reconstruct the entire folder/wiki hierarchy and all internal documents.',
    'recursivePrompt.no': 'No',
    'recursivePrompt.noDesc': 'Send ONLY the selected node itself (creates empty folder or migrates that single document).',
    'recursivePrompt.cancel': 'Cancel',
    'recursivePrompt.noBtn': 'No, Selected Only',
    'recursivePrompt.yesBtn': 'Yes, Clone Everything',
    'header.zipDownload': '⬇️ ZIP',
    'header.zipTitleLeft': 'Download left selected items to local ZIP',
    'header.zipTitleRight': 'Download right selected items to local ZIP'
  },
};

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'zh',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh');

  useEffect(() => {
    const saved = localStorage.getItem('app_locale') as Locale;
    if (saved && translations[saved]) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('app_locale', l);
  }, []);

  const t = useCallback((key: string) => {
    return translations[locale][key] || key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
