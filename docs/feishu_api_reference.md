# 飞书云文档 API 全量接口理解文档

> 基于 [飞书官方文档](https://open.feishu.cn/document/server-docs/docs/docs-overview) + [clawdbot-feishu 参考实现](https://skills.sh/m1heng/clawdbot-feishu/feishu-doc) 研究整理

---

## 一、全局认知

### 1.1 资源标识体系（Token 系统）

| 资源 | 标识名 | 示例格式 | 说明 |
|------|--------|----------|------|
| 云空间根目录 | `root_token` | `fldcnXXXX` | 获取：`GET /drive/v1/files/root_meta` |
| 文件夹 | `folder_token` | `fldcnXXXX` | 可嵌套 |
| 文件/文档 | `file_token` | 各类型前缀不同 | 泛指云空间内所有文件 |
| 新版文档 | `document_id` | `doxcnXXXX` | Docx 专用 |
| 电子表格 | `spreadsheet_token` | `shtcnXXXX` | Sheets 专用 |
| 多维表格 | `app_token` | `bascnXXXX` | Bitable 专用 |
| 知识库 | `space_id` | 纯数字字符串 | Wiki Space |
| 知识库节点 | `node_token` | `wikcnXXXX` | 挂载点，关联 `obj_token` |
| 评论 | `comment_id` | `cmt_XXXX` | 文档评论 |

> [!IMPORTANT]
> **obj_token vs node_token**: 知识库节点的 `node_token` 是挂载点标识，`obj_token` 才是实际文档/表格的标识。迁移时必须用 `obj_token` 调用文档 API。

### 1.2 访问凭证

| 凭证类型 | 获取端点 | 适用场景 |
|----------|----------|----------|
| `tenant_access_token` | `POST /auth/v3/tenant_access_token/internal` | 应用身份访问（自建应用） |
| `user_access_token` | OAuth 2.0 授权码流程 | 用户身份访问 |

### 1.3 通用频率限制

- **单个应用**: 5 QPS（部分接口更低）
- **单文档**: 3 并发
- **超限返回**: HTTP 400 + code `99991400`
- **应对策略**: 指数退避 + 节流队列

---

## 二、云空间（Drive）

> API 前缀: `/open-apis/drive/v1`

### 2.1 文件夹操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/files/root_meta` | GET | 获取"我的空间"根文件夹 meta |
| `/files/create_folder` | POST | 创建文件夹 |
| `/files/:file_token/children` | GET | 列出文件夹下内容 (⚠️ 分页: `has_more` + `page_token`) |
| `/files/:file_token` | DELETE | 删除文件/文件夹 |
| `/files/:file_token/move` | POST | 移动文件到目标文件夹 |
| `/files/:file_token/copy` | POST | 复制文件 |

> [!WARNING]
> 云空间文件夹**单层文件个数有限制**（约 1500 个）。超出将无法继续添加。

### 2.2 文件操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/files/upload_all` | POST | 上传文件（< 20MB） |
| `/files/upload_prepare` | POST | 分片上传：准备阶段 |
| `/files/upload_part` | POST | 分片上传：上传分片 |
| `/files/upload_finish` | POST | 分片上传：完成 |
| `/files/:file_token/download` | GET | 下载文件 |
| `/files/:file_token` | GET | 获取文件元信息 |
| `/metas/batch_query` | POST | 批量获取文件元数据 |

### 2.3 素材操作（Media）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/medias/upload_all` | POST | 上传素材（文档内图片/附件，需 `parent_type` + `parent_node`） |
| `/medias/download` | GET | 下载素材（`?file_token=XXX`） |
| `/medias/batch_get_tmp_download_url` | GET | 获取临时下载 URL |

> [!IMPORTANT]
> **迁移关键**：文档内的图片 token 在跨租户/跨域时无效，必须 **下载 → 重新上传** 获取新 token。`parent_type` 可选值: `docx_image`、`docx_file`。

### 2.4 导入导出

| 端点 | 方法 | 说明 |
|------|------|------|
| `/export_tasks` | POST | 创建导出任务（将飞书文档导出为 docx/pdf/xlsx 等） |
| `/export_tasks/:ticket` | GET | 查询导出任务状态 |
| `/export_tasks/file/:file_token/download` | GET | 下载导出结果 |
| `/import_tasks` | POST | 创建导入任务（将本地文件导入为飞书文档） |
| `/import_tasks/:ticket` | GET | 查询导入任务状态 |

> [!TIP]
> 导出任务是**异步**的：创建 → 轮询状态 → 下载结果。`type` 可选: `docx`、`pdf`、`xlsx`、`csv` 等。

---

## 三、知识库（Wiki）

> API 前缀: `/open-apis/wiki/v2`

### 3.1 知识空间

| 端点 | 方法 | 说明 |
|------|------|------|
| `/spaces` | GET | 获取有权限的知识空间列表 (⚠️ 分页) |
| `/spaces` | POST | 创建知识空间 |
| `/spaces/:space_id` | GET | 获取指定空间信息 |

### 3.2 节点操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/spaces/:space_id/nodes` | GET | 获取空间子节点列表 (⚠️ 分页 + `parent_node_token` 参数定位层级) |
| `/spaces/:space_id/nodes` | POST | 创建节点 / 将已有文档挂载到知识库 |
| `/spaces/:space_id/nodes/:node_token/move` | POST | 移动节点 |
| `/spaces/get_node` | GET | 通过 `token` 获取节点详情（返回 `obj_token` + `obj_type`） |
| `/tasks/move` | POST | 跨空间移动节点 |

> [!IMPORTANT]
> **迁移核心逻辑**：创建 Wiki 节点时可以：  
> 1. `obj_type=docx` + `obj_token=已有文档token` → 挂载已有文档到知识库  
> 2. 不传 `obj_token` → 在知识库中创建新的空白文档节点  

### 3.3 空间成员

| 端点 | 方法 | 说明 |
|------|------|------|
| `/spaces/:space_id/members` | GET | 获取成员列表 |
| `/spaces/:space_id/members` | POST | 添加成员 |
| `/spaces/:space_id/members/:member_id` | DELETE | 移除成员 |

### 3.4 空间设置

| 端点 | 方法 | 说明 |
|------|------|------|
| `/spaces/:space_id/setting` | GET | 获取空间设置 |
| `/spaces/:space_id/setting` | PUT | 更新空间设置 |

---

## 四、新版文档（Docx）

> API 前缀: `/open-apis/docx/v1`

### 4.1 文档操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/documents` | POST | 创建新文档（可指定 `folder_token`） |
| `/documents/:document_id` | GET | 获取文档基本信息（标题） |
| `/documents/:document_id/raw_content` | GET | 获取纯文本内容 |
| `/documents/:document_id/blocks` | GET | **获取全部块** (⚠️ 分页: `page_size=500`) |
| `/documents/:document_id/blocks/:block_id` | GET | 获取单个块 |
| `/documents/:document_id/blocks/:block_id/children` | GET | 获取块的子块 |
| `/documents/:document_id/blocks/:block_id/children` | POST | **添加子块**（核心写入接口） |
| `/documents/:document_id/blocks/:block_id` | PATCH | 更新块内容 |
| `/documents/:document_id/blocks/:block_id/children/batch_delete` | DELETE | 批量删除子块 |

### 4.2 Block 类型完整列表

> [!IMPORTANT]
> 这是迁移引擎的核心——每个 block_type 决定了数据结构和迁移策略。

| block_type | 类型名 | 数据键名 | 可创建 | 迁移策略 |
|------------|--------|----------|--------|----------|
| 1 | **Page** (根节点) | — | — | 自动创建 |
| 2 | **Text** (文本段落) | [text](file:///c:/Users/wair5/Downloads/feishu-lark/src/lib/i18n.tsx#217-222) | ✅ | 直接复制 elements |
| 3 | **Heading 1** | `heading1` | ✅ | 直接复制 |
| 4 | **Heading 2** | `heading2` | ✅ | 直接复制 |
| 5 | **Heading 3** | `heading3` | ✅ | 直接复制 |
| 6 | **Heading 4** | `heading4` | ✅ | 直接复制 |
| 7 | **Heading 5** | `heading5` | ✅ | 直接复制 |
| 8 | **Heading 6** | `heading6` | ✅ | 直接复制 |
| 9 | **Heading 7** | `heading7` | ✅ | 直接复制 |
| 10 | **Heading 8** | `heading8` | ✅ | 直接复制 |
| 11 | **Heading 9** | `heading9` | ✅ | 直接复制 |
| 12 | **Bullet** (无序列表) | `bullet` | ✅ | 直接复制 |
| 13 | **Ordered** (有序列表) | `ordered` | ✅ | 直接复制 |
| 14 | **Code** (代码块) | `code` | ✅ | 直接复制 |
| 15 | **Quote** (引用块) | `quote` | ✅ | 容器块，内容在 children 中 |
| 16 | **QuoteContainer** | `quote_container` | ✅ | **空对象**，内容全在子块 |
| 17 | **TodoList** (待办) | `todo` | ✅ | 带 `done` 字段 |
| 18 | **Bitable** | `bitable` | ❌ | 🔴 嵌入式多维表格，需全量数据搬运 |
| 19 | **Callout** (高亮块) | `callout` | ✅ | 容器块 |
| 20 | **ChatCard** | `chat_card` | ❌ | 🔴 私有数据，文本降级 |
| 21 | **Diagram** (流程图) | `diagram` | ❌ | 🔴 无法读取 |
| 22 | **Divider** (分割线) | `divider` | ✅ | 空内容 |
| 23 | **File** (附件) | `file` | ✅ | 需 transport media |
| 24 | **Grid** (分栏) | `grid` | ✅ | 容器块 |
| 25 | **GridColumn** | `grid_column` | ✅ | Grid 子容器 |
| 26 | **Iframe** | `iframe` | ✅ | 直接复制 URL |
| 27 | **Image** (图片) | `image` | ✅ | 🔴 需 transport media |
| 28 | **ISV** (插件块) | `isv` | ❌ | 🔴 第三方插件，完全无法迁移 |
| 29 | **Mindnote** | `mindnote` | ❌ | 🔴 思维笔记不开放 |
| 30 | **Sheet** (嵌入表格) | `sheet` | ❌ | 🔴 嵌入式电子表格，需数据搬运 |
| 31 | **Table** (简单表格) | [table](file:///c:/Users/wair5/Downloads/feishu-lark/src/lib/ast-exporter.ts#73-120) | ✅ | 容器块 + TableCell 子块 |
| 32 | **TableCell** | `table_cell` | ✅ | Table 子容器 |
| 33 | **View** (视图) | `view` | ❌ | 🔴 内嵌视图 |
| 34 | **Undefined** | — | — | 跳过 |
| 35 | **QuoteContainer** | `quote_container` | ✅ | 同 16 |
| 36 | **Task** (任务块) | `task` | ❌ | 尝试读取任务详情 |
| 37 | **OKR** | `okr` | ❌ | 🔴 私有数据 |
| 38 | **OKR Objective** | `okr_objective` | ❌ | OKR 子节点 |
| 39 | **OKR Key Result** | `okr_key_result` | ❌ | OKR 子节点 |
| 40 | **OKR Progress** | `okr_progress` | ❌ | OKR 子节点 |
| 99 | **Add-ons** | `addons` | ❌ | 🔴 扩展块 |

> [!TIP]
> **text elements 结构**：每个文本块的 `elements` 数组包含 `text_run`（纯文本）、`mention_user`（@用户）、`mention_doc`（@文档）、`equation`（公式）等子元素。跨域迁移时 `mention_user` 和 `mention_doc` 需降级处理。

### 4.3 权限要求

| 权限 Scope | 说明 |
|------------|------|
| `docx:document` | 创建及编辑文档 |
| `docx:document:readonly` | 查看文档内容 |
| `docx:document.block:convert` | 块类型转换 |
| `drive:drive` | 云空间基础权限 |
| `drive:drive:readonly` | 云空间只读 |
| `drive:file:media_readonly` | 素材下载（图片/附件） |

---

## 五、电子表格（Sheets）

> API 前缀: `/open-apis/sheets/v3` 和 `/open-apis/sheets/v2`

### 5.1 表格操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `v3/spreadsheets` | POST | 创建电子表格 |
| `v3/spreadsheets/:token` | GET | 获取表格基本信息 |
| `v3/spreadsheets/:token/sheets/query` | GET | 获取所有子工作表列表 |
| `v3/spreadsheets/:token/sheets/:sheet_id` | GET | 获取单个工作表信息 |

### 5.2 数据读写

| 端点 | 方法 | 说明 |
|------|------|------|
| `v2/spreadsheets/:token/values/:range` | GET | 读取指定范围（A1 格式: `sheet_id!A1:Z100`） |
| `v2/spreadsheets/:token/values_prepend` | POST | 表头前插入数据 |
| `v2/spreadsheets/:token/values_append` | POST | 尾部追加数据 |
| `v2/spreadsheets/:token/values_batch_update` | POST | 批量写入多范围 |
| `v2/spreadsheets/:token/values_batch_get` | GET | 批量读取多范围 |

> [!IMPORTANT]
> **迁移电子表格数据**：读取用 `values_batch_get`，写入用 `values_batch_update`。Range 格式为 `sheetId!A:Z` 或 `sheetId!A1:Z100`。

### 5.3 工作表管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `v2/spreadsheets/:token/sheets_batch_update` | POST | 批量操作工作表（增/删/复制/重命名） |
| `v2/spreadsheets/:token/dimension_range` | PUT | 插入/删除行列 |

---

## 六、多维表格（Bitable）

> API 前缀: `/open-apis/bitable/v1`

### 6.1 多维表格管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/apps` | POST | 创建多维表格 |
| `/apps/:app_token` | GET | 获取多维表格信息 |
| `/apps/:app_token` | PUT | 更新多维表格信息 |
| `/apps/:app_token/copy` | POST | 复制多维表格 |

### 6.2 数据表操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/apps/:app_token/tables` | GET | 列出数据表 (⚠️ 分页) |
| `/apps/:app_token/tables` | POST | 创建数据表（可携带 `fields`） |
| `/apps/:app_token/tables/:table_id` | DELETE | 删除数据表 |
| `/apps/:app_token/tables/batch_create` | POST | 批量创建数据表 |
| `/apps/:app_token/tables/batch_delete` | POST | 批量删除数据表 |

### 6.3 字段操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/apps/:app_token/tables/:table_id/fields` | GET | 获取字段列表 (⚠️ 分页) |
| `/apps/:app_token/tables/:table_id/fields` | POST | 新增字段 |
| `/apps/:app_token/tables/:table_id/fields/:field_id` | PUT | 更新字段 |
| `/apps/:app_token/tables/:table_id/fields/:field_id` | DELETE | 删除字段 |

### 6.4 记录操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/apps/:app_token/tables/:table_id/records` | GET | 获取记录列表 (⚠️ 分页: `page_size` + `page_token`) |
| `/apps/:app_token/tables/:table_id/records` | POST | 新增记录 |
| `/apps/:app_token/tables/:table_id/records/batch_create` | POST | 批量新增（每次最多 500 条） |
| `/apps/:app_token/tables/:table_id/records/batch_update` | POST | 批量更新 |
| `/apps/:app_token/tables/:table_id/records/batch_delete` | POST | 批量删除 |

### 6.5 视图 / 仪表盘

| 端点 | 方法 | 说明 |
|------|------|------|
| `/apps/:app_token/tables/:table_id/views` | GET | 获取视图列表 |
| `/apps/:app_token/tables/:table_id/views` | POST | 创建视图 |
| `/apps/:app_token/dashboards` | GET | 获取仪表盘列表 |

> [!WARNING]
> **不可迁移的字段类型**: type 19(查找引用), 20(公式), 21(自动编号), 23(创建人), 24(更新人), 1001-1005(系统字段), 3001(按钮)。这些字段在创建时会被飞书拒绝。

---

## 七、画板（Board / Whiteboard）

> API 前缀: `/open-apis/board/v1`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/whiteboards/:whiteboard_id/download_as_image` | GET | 将画板导出为图片下载 |

> 画板 API 当前开放能力极其有限，仅支持导出为图片。无法读取/写入画板内部元素。

---

## 八、权限（Permission）

> API 前缀: `/open-apis/drive/v1/permissions`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/:token/members` | GET | 获取文档协作者列表 |
| `/:token/members` | POST | 添加协作者 |
| `/:token/members/:member_id` | PUT | 更新协作者权限 |
| `/:token/members/:member_id` | DELETE | 移除协作者 |
| `/:token/public` | GET | 获取公共访问设置 |
| `/:token/public` | PATCH | 更新公共访问设置 |
| `/members/transfer_owner` | POST | 转移文档所有者 |

> [!TIP]
> `token` 参数是任意资源的 token（doc_token / spreadsheet_token / app_token 等），需配合 `type` 查询参数指定资源类型（`doc` / `sheet` / `bitable` / `file` / `wiki`）。

---

## 九、评论（Comment）

> API 前缀: `/open-apis/drive/v1/files`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/:file_token/comments` | GET | 获取文档评论列表 (⚠️ 分页) |
| `/:file_token/comments` | POST | 创建评论 |
| `/:file_token/comments/:comment_id` | GET | 获取单个评论 |
| `/:file_token/comments/:comment_id` | PATCH | 更新评论 |
| `/:file_token/comments/:comment_id/replies` | GET | 获取评论的回复列表 |
| `/:file_token/comments/:comment_id/replies` | POST | 创建回复 |

> 评论区分 `is_whole: true`（全文评论）和 `is_whole: false`（块级别/选区评论）。

---

## 十、云文档助手

> API 前缀: `/open-apis/drive/v1`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/files/task/check` | GET | 检查异步任务（导入/导出）状态 |

> 云文档助手模块较小，主要是异步任务状态检查的辅助接口。

---

## 十一、通用操作

### 11.1 搜索

| 端点 | 方法 | 说明 |
|------|------|------|
| `POST /open-apis/suite/docs-api/search/object` | POST | 搜索云文档（按关键词、类型、所有者等） |

### 11.2 订阅/事件

| 事件类型 | 说明 |
|----------|------|
| `drive.file.bitable_field_changed_v1` | Bitable 字段变更 |
| `drive.file.title_updated_v1` | 文件标题更新 |
| `drive.file.read_v1` | 文件被阅读 |
| `drive.file.edit_v1` | 文件被编辑 |
| `drive.file.permission_member_added_v1` | 文件协作者添加 |

---

## 十二、迁移专用注意事项

### 12.1 跨域/跨租户迁移的核心挑战

| 资源类型 | 挑战 | 解决方案 |
|----------|------|----------|
| 图片/附件 | Token 跨域失效 | 下载→上传获取新 token |
| Mention（@用户） | user_id 跨域不存在 | 降级为文本 `@用户名` |
| Mention（@文档） | doc_token 跨域不存在 | 降级为文本 `[📎 文档名]` |
| 嵌入式 Sheet/Bitable | 嵌入 token 跨域失效 | 全量数据搬运→新建→链接 |
| ChatCard / OKR / ISV | 私有数据，API 无法读取 | 降级为告警文本 |
| 知识库节点 | node_token ≠ obj_token | 必须转换为 obj_token 再操作 |

### 12.2 分页处理清单

以下 API **必须做分页循环**，否则数据会丢失：

```
✅ GET /drive/v1/files/:token/children       → has_more + page_token
✅ GET /wiki/v2/spaces/:id/nodes             → has_more + page_token  
✅ GET /docx/v1/documents/:id/blocks         → has_more + page_token
✅ GET /bitable/v1/apps/:id/tables           → has_more + page_token
✅ GET /bitable/v1/.../fields                → has_more + page_token
✅ GET /bitable/v1/.../records               → has_more + page_token
✅ GET /sheets/v3/.../sheets/query           → 通常无分页（子表少）
```

### 12.3 频率限制与最佳实践

```
文档块操作 (Docx Blocks): 5 QPS, 单文档 3 并发
Bitable Records:           10 QPS, 批量上限 500 条/次
Sheets Values:             5 QPS
Media Upload:              5 QPS
Wiki Nodes:                5 QPS
```

> [!CAUTION]
> 超频会返回 `99991400` 错误码。**必须** 在循环中加入 `await sleep(200-400)` 节流，以及实现指数退避重试。

---

*文档版本: 2026-03-22 | 基于飞书开放平台 v1 API*
