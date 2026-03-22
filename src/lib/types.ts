// 共享类型定义

// 平台侧标识
export type Side = 'feishu' | 'lark';

// 文件条目
export interface FileEntry {
  id?: string;
  token: string;
  name: string;
  type: string; // folder | docx | sheet | doc | bitable | file | mindnote | slides
  created_time?: string;
  modified_time?: string;
  modifiedTime?: number; // 跨端拉取的最新时间戳
  url?: string;
  owner_id?: string;
  has_child?: boolean;
  space_id?: string;
  node_token?: string;
  source?: 'drive' | 'wiki';
}

// 文件列表响应
export interface FileListResponse {
  files: FileEntry[];
  has_more: boolean;
  next_page_token?: string;
}

// 配置状态
export type ConfigStatusType = 'unchecked' | 'checking' | 'ready' | 'partial' | 'invalid';

export interface ScopeCheckResult {
  granted: string[];
  missing: string[];
}

export interface ConfigCheckResponse {
  valid: boolean;
  app_name?: string;
  scopes: ScopeCheckResult;
  status: ConfigStatusType;
  permission_url?: string;
  error?: string;
}

// 凭证配置
export interface AppConfig {
  appId: string;
  appSecret: string;
}

export interface FullConfig {
  feishu: AppConfig;
  lark: AppConfig;
}

// 传输任务
export type TransferStatus = 'pending' | 'exporting' | 'downloading' | 'uploading' | 'done' | 'error';

export interface TransferItem {
  id: string;              // 内部队列唯一ID
  batchId?: string;        // 批次组ID
  parentId?: string;       // 父级ID
  fileToken: string;       // 要同步的节点token
  fileType: string;        // 投送到目标端的转换后类型
  originalFileType: string;// 原始真实的源文件类型，用于取子节点依据
  fileName: string;
  sourceSide: Side;
  targetSide: Side | 'local';
  sourceType: 'drive' | 'wiki';
  sourcePath: string;      // 用户界面或 ZIP 显示的全路径
  sourceUrl?: string;      // 源文档直达 URL（仅部分项或根项具备）
  sourceSpaceId?: string;  // 源属于哪个知识空间
  sourceNodeToken?: string;// 源属于哪个知识库节点
  targetFolderToken?: string; // 如果同步到云空间，目录的 token
  targetSpaceId?: string;     // 如果同步到知识库，知识库的 space_id
  targetNodeToken?: string;   // 同步到的特定节点 token
  status: 'pending' | 'starting' | 'exporting' | 'downloading' | 'uploading' | 'done' | 'error';
  progress: number;
  recursive: boolean;      // 是否需要递归抓取子节点
  childrenFetched: boolean;// 是否已经发起并完成了子节点查询动作
  error?: string;
  message?: string;
  newToken?: string;
  objToken?: string;       // 返回新文档底层的实体 obj_token
  modifiedTime?: number;   // 云文档的最近修改时间（秒级时间戳），用于增量同步比对
}

// 导出任务
export interface ExportCreateResponse {
  ticket: string;
}

export interface ExportStatusResponse {
  status: 'processing' | 'ready' | 'failed';
  file_token?: string;
  file_size?: number;
}

// 前端状态
export interface PathEntry {
  name: string;
  token: string; // '' 代表根目录
}

export interface PanelState {
  files: FileEntry[];
  path: PathEntry[];
  selected: Set<string>;
  loading: boolean;
  hasMore: boolean;
  nextPageToken?: string;
}

export interface ConfigStatus {
  appId: string;
  appSecret: string;
  status: ConfigStatusType;
  scopes: ScopeCheckResult;
  permissionUrl?: string;
  error?: string;
}
