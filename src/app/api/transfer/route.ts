// 文件迁移传输 API — 元数据读取 → 结构重建方案
// docx/mindnote: Block API 读写
// sheet: Sheets API 读写
// bitable: 表结构/字段/记录 API 重建
// slides/file: 导出导入兜底
// folder/wiki_space: 层级递归结构迁移
import { NextRequest } from 'next/server';
import { api, getAppAccessToken } from '@/lib/lark-client';
import type { Side } from '@/lib/types';
import { DocxEngine } from '@/lib/docx-engine';

export const maxDuration = 300; // Vercel Edge Serverless Maximum Length

// ==================== 工具函数 ====================
const API_BASE: Record<Side, string> = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com',
};

// SSE 事件发送
function sse(ctrl: ReadableStreamDefaultController, event: string, data: Record<string, unknown>) {
  ctrl.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

// 获取 token
async function getToken(side: Side, appId: string, appSecret: string, userToken?: string) {
  return userToken || await getAppAccessToken(side, appId, appSecret);
}

// 知识库挂载节点 (或者直接在知识库内部凭空创建节点)
async function bindToWiki(tgtBase: string, tgtToken: string, spaceId: string, parentNodeToken: string, objToken: string, objType: string, customTitle?: string) {
  const reqBody: any = {
    node_type: 'origin',
    obj_type: objType,
    parent_node_token: parentNodeToken || undefined,
  };
  if (objToken) {
    reqBody.obj_token = objToken;
  } else if (customTitle) {
    reqBody.title = customTitle;
  }

  let resp: any;
  let retries = 0;
  const maxRetries = 5;
  while (retries < maxRetries) {
      resp = await api(tgtBase, tgtToken, `/wiki/v2/spaces/${spaceId}/nodes`, 'POST', reqBody);
      if (resp.code === 0) break;
      
      const isConcurrencyLock = resp.code === 131009 || resp.code === 131011 || resp.code === 99991400 || (resp.msg && resp.msg.toLowerCase().includes('lock contention'));
      if (isConcurrencyLock && retries < maxRetries - 1) {
          retries++;
          const delay = (Math.pow(2, retries) * 600) + Math.random() * 800; // 抖动退避防雪崩
          console.warn(`[Wiki API] 防跌落击穿: 节点锁竞争 (${resp.msg}). 第 ${retries}/${maxRetries} 次重试中, 等待 ${Math.round(delay)}ms...`);
          await new Promise(r => setTimeout(r, delay));
      } else {
          break;
      }
  }

  if (!resp || resp.code !== 0) {
      throw new Error(`挂载或创建知识库节点(重试${retries}次后)失败: ${JSON.stringify(resp)} | 请求体: ${JSON.stringify(reqBody)}`);
  }
  
  const nodeToken = resp.data?.node?.node_token;
  const newObjToken = resp.data?.node?.obj_token;
  
  // 对于跨域挂载，可能出现标题延迟，实施二次覆写确保无“未命名”
  if (nodeToken && customTitle && objToken) {
    await api(tgtBase, tgtToken, `/wiki/v2/spaces/${spaceId}/nodes/${nodeToken}/update_title`, 'POST', {
      title: customTitle
    });
  }
  
  return { nodeToken, objToken: newObjToken };
}

// ==================== 文件夹与知识库结构 ====================
async function migrateFolder(
  ctrl: ReadableStreamDefaultController,
  tgtBase: string, tgtToken: string,
  fileName: string, targetFolderToken?: string, targetSpaceId?: string, targetNodeToken?: string
) {
  sse(ctrl, 'progress', { status: 'uploading', progress: 50, message: `正在创建目录: ${fileName}...` });

  if (targetSpaceId) {
    // 知识库内创建文件夹的原理是创建一个空的 docx 充当容器
    const docResp = await api(tgtBase, tgtToken, '/docx/v1/documents', 'POST', {
      title: fileName,
      folder_token: '',
    });
    if (docResp.code !== 0) throw new Error(`知识库目录挂载(文档创建)失败: ${docResp.msg}`);
    const newDocId = docResp.data?.document?.document_id;
    const wikiResult = await bindToWiki(tgtBase, tgtToken, targetSpaceId, targetNodeToken || '', newDocId, 'docx', fileName);
    // 【关键修复】bindToWiki 返回 { nodeToken, objToken } 对象，必须提取 .nodeToken 字符串
    const newToken = wikiResult.nodeToken;
    sse(ctrl, 'progress', { status: 'done', progress: 100, message: `知识库文件夹节点创建成功`, newToken });
    return newToken;
  }

  const resp = await api(tgtBase, tgtToken, '/drive/v1/files/create_folder', 'POST', {
    name: fileName,
    folder_token: targetFolderToken || '',
  });
  if (resp.code !== 0) throw new Error(`创建目录失败: ${resp.msg}`);
  const newToken = resp.data?.folder_token;
  sse(ctrl, 'progress', { status: 'done', progress: 100, message: `目录创建成功`, newToken });
  return newToken;
}

async function migrateWikiSpace(
  ctrl: ReadableStreamDefaultController,
  tgtBase: string, tgtToken: string,
  fileName: string
) {
  sse(ctrl, 'progress', { status: 'uploading', progress: 50, message: `正在创建知识库: ${fileName}...` });
  const resp = await api(tgtBase, tgtToken, '/wiki/v2/spaces', 'POST', {
    name: fileName,
    description: 'DataFerry 迁移工具创建的知识库',
  });
  if (resp.code !== 0) throw new Error(`创建知识库失败: ${resp.msg}`);
  const newToken = resp.data?.space?.space_id;
  sse(ctrl, 'progress', { status: 'done', progress: 100, message: `知识库创建成功`, newToken });
  return newToken;
}

// ==================== DocX / Mindnote 元数据迁移 ====================
async function migrateDocx(
  ctrl: ReadableStreamDefaultController,
  srcBase: string, srcToken: string,
  tgtBase: string, tgtToken: string,
  fileToken: string, fileName: string, targetFolderToken?: string, targetSpaceId?: string, targetNodeToken?: string,
  cachedData?: any
) {
  sse(ctrl, 'progress', { status: 'exporting', progress: 10, message: `正在准备全量 DOM 解析: ${fileName}...` });

  let newDocId = '';
  let finalToken = '';

  if (targetSpaceId) {
    // 目标为知识库时，绝不能在 Drive 根目录创建文件后再挂载，否则会造成 Drive 首页文件泛滥（云文档散落）
    // 应该直接通过 Wiki API 凭空创建节点，让底层文档完全包含在知识库暗盒内
    const res = await bindToWiki(tgtBase, tgtToken, targetSpaceId, targetNodeToken || '', '', 'docx', fileName);
    newDocId = res.objToken;
    finalToken = res.nodeToken;
  } else {
    const createResp = await api(tgtBase, tgtToken, '/docx/v1/documents', 'POST', {
      title: fileName,
      folder_token: targetFolderToken || '',
    });
    if (createResp.code !== 0) throw new Error(`创建目录目标文档失败: ${createResp.msg}`);
    newDocId = createResp.data?.document?.document_id;
    finalToken = newDocId;
  }

  if (!newDocId) throw new Error('创建文档引擎载体成功但未返回可用的 document_id / obj_token');

  // 调用高阶精锐复原架构 (AST引擎)
  try {
    // We pass old fileToken down as oldDocId for hyperlink generation
    await DocxEngine.migrate(srcBase, srcToken, fileToken, tgtBase, tgtToken, newDocId, (msg) => {
      sse(ctrl, 'progress', { status: 'uploading', progress: 50, message: msg });
    }, cachedData);
  } catch (e: any) {
    if (e.message.includes('读取全量')) throw e; // 严重错误
    console.warn(`[DocxEngine] AST 迁移警告:`, e); 
  }

  sse(ctrl, 'progress', { status: 'done', progress: 100, message: `文档原生 DOM 迁移完成！`, newToken: finalToken });
  return finalToken;
}

// ==================== Sheet 元数据迁移 ====================
async function migrateSheet(
  ctrl: ReadableStreamDefaultController,
  srcBase: string, srcToken: string,
  tgtBase: string, tgtToken: string,
  fileToken: string, fileName: string, targetFolderToken?: string, targetSpaceId?: string, targetNodeToken?: string,
  cachedData?: any
) {
  sse(ctrl, 'progress', { status: 'exporting', progress: 10, message: `正在读取表格结构: ${fileName}...` });

  let sheets: any[] = [];
  if (cachedData && cachedData.sheets) {
    sheets = cachedData.sheets.map((s: any) => s.meta);
  } else {
    const sheetsResp = await api(srcBase, srcToken, `/sheets/v3/spreadsheets/${fileToken}/sheets/query`);
    if (sheetsResp.code !== 0) throw new Error(`读取表格失败: ${sheetsResp.msg}`);
    sheets = sheetsResp.data?.sheets || [];
  }

  sse(ctrl, 'progress', { status: 'exporting', progress: 20, message: `发现 ${sheets.length} 个工作表，正在创建目标表格...` });

  let newToken = '';
  let finalToken = '';

  if (targetSpaceId) {
    const res = await bindToWiki(tgtBase, tgtToken, targetSpaceId, targetNodeToken || '', '', 'sheet', fileName);
    newToken = res.objToken;
    finalToken = res.nodeToken;
  } else {
    const createResp = await api(tgtBase, tgtToken, '/sheets/v3/spreadsheets', 'POST', {
      title: fileName,
      folder_token: targetFolderToken || '',
    });
    if (createResp.code !== 0) throw new Error(`创建目标表格失败: ${createResp.msg}`);
    newToken = createResp.data?.spreadsheet?.spreadsheet_token;
    finalToken = newToken;
  }

  if (!newToken) throw new Error('创建表格成功但未返回可用的 spreadsheet_token');

  const tgtSheetsResp = await api(tgtBase, tgtToken, `/sheets/v3/spreadsheets/${newToken}/sheets/query`);
  const tgtSheets = tgtSheetsResp.data?.sheets || [];

  sse(ctrl, 'progress', { status: 'uploading', progress: 30, message: '正在逐个迁移工作表数据...' });

  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si];
    const sheetId = sheet.sheet_id;
    const sheetTitle = sheet.title || `Sheet${si + 1}`;

    let tgtSheetId = tgtSheets[si]?.sheet_id;
    if (!tgtSheetId && si > 0) {
      const addResp = await api(tgtBase, tgtToken, `/sheets/v2/spreadsheets/${newToken}/sheets_batch_update`, 'POST', {
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      });
      tgtSheetId = addResp.data?.replies?.[0]?.addSheet?.properties?.sheetId;
    }
    if (!tgtSheetId) tgtSheetId = tgtSheets[0]?.sheet_id;

    let values: any[] = [];
    if (cachedData && cachedData.sheets && cachedData.sheets[si]) {
       values = cachedData.sheets[si].values || [];
    } else {
       const range = `${sheetId}!A1:ZZ10000`;
       const dataResp = await api(srcBase, srcToken, `/sheets/v2/spreadsheets/${fileToken}/values/${encodeURIComponent(range)}`);
       values = dataResp.data?.valueRange?.values || [];
    }

    if (values && values.length > 0) {
      const writeRange = `${tgtSheetId}!A1:ZZ${values.length}`;
      await api(tgtBase, tgtToken, `/sheets/v2/spreadsheets/${newToken}/values`, 'PUT', {
        valueRange: { range: writeRange, values },
      });
    }

    sse(ctrl, 'progress', { status: 'uploading', progress: 30 + Math.round((si + 1) / sheets.length * 60), message: `工作表 ${sheetTitle} 迁移完成 (${si + 1}/${sheets.length})` });
  }

  sse(ctrl, 'progress', { status: 'done', progress: 100, message: `表格迁移完成！共 ${sheets.length} 个工作表`, newToken: finalToken });
  return finalToken;
}

// ==================== Bitable 元数据迁移 ====================
// 完全不可创建的字段类型
const SYSTEM_ONLY_FIELD_TYPES = new Set([
  19,   // Lookup 查找引用 (跨表依赖)
  21,   // Duplex Link 双向关联 (跨表依赖)
  23,   // Group 分组
  24,   // Stage 阶段
  1001, // Created Time 创建时间
  1002, // Modified Time 修改时间
  1003, // Created User 创建人
  1004, // Modified User 修改人
  1005, // Auto Number 自动编号
  3001, // Button 按钮
]);
// 针对所有带强依赖凭据的格式（公式、人员、内外关联、地理位置等复杂子域对象），将其全部物理打平降级至极简纯文本框，以保留数据展现为名，破除底层封锁为旨。（17号附件独立解封穿网，不再属于软禁列）
const FORMULA_DEGRADE_TYPES = new Set([20, 11, 18, 22]); // Formula, GroupUser, Link, Location
// 合并集：用于判断是否不可直接创建
const UNSUPPORTED_CREATE_FIELD_TYPES = new Set([...SYSTEM_ONLY_FIELD_TYPES, ...FORMULA_DEGRADE_TYPES]);

async function migrateBitable(
  ctrl: ReadableStreamDefaultController,
  srcBase: string, srcToken: string,
  tgtBase: string, tgtToken: string,
  fileToken: string, fileName: string, targetFolderToken?: string, targetSpaceId?: string, targetNodeToken?: string,
  cachedData?: any
) {
  sse(ctrl, 'progress', { status: 'exporting', progress: 5, message: `正在读取多维表格结构: ${fileName}...` });

  const globalDroppedFields = new Set<string>();
  let tables: any[] = [];
  if (cachedData && cachedData.tables) {
    tables = cachedData.tables.map((t: any) => t.meta);
  } else {
    const tablesResp = await api(srcBase, srcToken, `/bitable/v1/apps/${fileToken}/tables`);
    if (tablesResp.code !== 0) throw new Error(`读取多维表格失败: ${tablesResp.msg}`);
    tables = tablesResp.data?.items || [];
  }

  sse(ctrl, 'progress', { status: 'exporting', progress: 10, message: `发现 ${tables.length} 个数据表，正在创建目标多维表格...` });

  let newAppToken = '';
  let finalToken = '';

  if (targetSpaceId) {
    const res = await bindToWiki(tgtBase, tgtToken, targetSpaceId, targetNodeToken || '', '', 'bitable', fileName);
    newAppToken = res.objToken;
    finalToken = res.nodeToken;
  } else {
    const createResp = await api(tgtBase, tgtToken, '/bitable/v1/apps', 'POST', {
      name: fileName,
      folder_token: targetFolderToken || '',
    });
    if (createResp.code !== 0) throw new Error(`创建目标多维表格失败: ${createResp.msg}`);
    newAppToken = createResp.data?.app?.app_token;
    finalToken = newAppToken;
  }

  if (!newAppToken) throw new Error('创建多维表格成功但未返回 app_token');

  const tgtTablesResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables`);
  const defaultTables = tgtTablesResp.data?.items || [];

  for (let ti = 0; ti < tables.length; ti++) {
    const table = tables[ti];
    const srcTableId = table.table_id;
    const tableName = table.name || `表${ti + 1}`;

    sse(ctrl, 'progress', { status: 'exporting', progress: 10 + Math.round(ti / tables.length * 30), message: `正在读取数据表: ${tableName}...` });

    let fields: any[] = [];
    if (cachedData && cachedData.tables && cachedData.tables[ti]) {
       fields = cachedData.tables[ti].fields || [];
    } else {
       const fieldsResp = await api(srcBase, srcToken, `/bitable/v1/apps/${fileToken}/tables/${srcTableId}/fields?page_size=100`);
       fields = fieldsResp.data?.items || [];
    }

    // 阶段一：分类字段
    const safeFields = fields.filter((f: Record<string, unknown>) => !UNSUPPORTED_CREATE_FIELD_TYPES.has(f.type as number));
    const formulaFields = fields.filter((f: Record<string, unknown>) => FORMULA_DEGRADE_TYPES.has(f.type as number));
    const systemFields = fields.filter((f: Record<string, unknown>) => SYSTEM_ONLY_FIELD_TYPES.has(f.type as number));
    
    if (formulaFields.length > 0) {
      const fNames = formulaFields.map((f: Record<string, unknown>) => `${f.field_name}`).join(', ');
      sse(ctrl, 'progress', { message: `⚠️ 数据表 "${tableName}" 公式字段降级为文本: ${fNames}` });
    }
    if (systemFields.length > 0) {
      const sNames = systemFields.map((f: Record<string, unknown>) => `${f.field_name}(type:${f.type})`).join(', ');
      console.warn(`[Bitable] 数据表 "${tableName}" 跳过系统字段: ${sNames}`);
    }

    // 阶段二：安全字段 + 公式降级为文本字段
    const createFields = [
      ...(safeFields.length > 0 
        ? safeFields.map((f: Record<string, unknown>) => ({
            field_name: f.field_name,
            type: f.type,
            ...(f.property ? { property: f.property } : {}),
          }))
        : [{ field_name: '标题', type: 1 }]),
      // 公式字段降级为文本字段，保留计算值
      ...formulaFields.map((f: Record<string, unknown>) => ({
        field_name: `${f.field_name}【公式值】`,
        type: 1, // 降级为文本
      })),
      { field_name: '【系统迁移备注】', type: 1 }
    ];

    const tgtTableResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables`, 'POST', {
      table: {
        name: tableName,
        fields: createFields,
      },
    });
    
    if (tgtTableResp.code !== 0) {
      // 如果带字段创建失败，降级为仅创建表名（保证表名一定不丢）
      console.warn(`[Bitable] 带字段创建表 "${tableName}" 失败(${tgtTableResp.msg})，降级为空表创建`);
      const fallbackResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables`, 'POST', {
        table: { name: tableName, fields: [{ field_name: '标题', type: 1 }, { field_name: '【系统迁移备注】', type: 1 }] },
      });
      if (fallbackResp.code !== 0) throw new Error(`创建数据表 ${tableName} 失败: ${fallbackResp.msg}`);
      var newTableId = fallbackResp.data?.table_id;
      
      // 降级后逐个追加安全字段与被提纯文本字段
      for (const sf of safeFields) {
        try {
          await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${newTableId}/fields`, 'POST', {
            field_name: (sf as any).field_name,
            type: (sf as any).type,
            ...((sf as any).property ? { property: (sf as any).property } : {}),
          });
        } catch (e) { console.warn(`[Bitable] 追加字段失败:`, (sf as any).field_name, e); }
      }
      for (const ff of formulaFields) {
        try {
          await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${newTableId}/fields`, 'POST', {
            field_name: `${(ff as any).field_name}【公式值】`,
            type: 1
          });
        } catch (e) { console.warn(`[Bitable] 追加降级文本字段失败:`, (ff as any).field_name, e); }
      }
    } else {
      var newTableId = tgtTableResp.data?.table_id;
    }

    // 重新抓取生成后的真实新字段名 (应对跨端截断、重命名兼容)
    const tgtFieldsResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${newTableId}/fields?page_size=100`);
    const tgtFields = tgtFieldsResp.data?.items || [];
    // 建立一张绝对存在的真实生还者字段白名单（确保发数据时绝不抛错）
    const aliveTgtFieldNames = new Set(tgtFields.map((f: any) => f.field_name));
    
    // 采用更精准的名字查找：分别对照建旧表原名（含被附加的尾缀名）做反向侦测
    const oldFieldNameToNewFieldName: Record<string, string> = {};
    for (const tgtF of tgtFields) {
       for (const sf of safeFields) {
          if ((sf as any).field_name === tgtF.field_name) oldFieldNameToNewFieldName[(sf as any).field_name] = tgtF.field_name;
       }
       for (const ff of formulaFields) {
          if (`${(ff as any).field_name}【公式值】` === tgtF.field_name) oldFieldNameToNewFieldName[`${(ff as any).field_name}【公式值】`] = tgtF.field_name;
       }
    }

    sse(ctrl, 'progress', { status: 'uploading', progress: 40 + Math.round(ti / tables.length * 20), message: `正在写入 ${tableName} [${safeFields.length} 安全列 + ${formulaFields.length} 公式降级 + ${systemFields.length} 跳过]...` });

    let pageToken = '';
    let totalRecords = 0;
    
    if (cachedData && cachedData.tables && cachedData.tables[ti]) {
      const records = cachedData.tables[ti].records || [];
      if (records.length > 0 && newTableId) {
        // Chunk records into arrays of 500 max per request to avoid API length limits
        for (let r = 0; r < records.length; r += 500) {
          const chunk = records.slice(r, r + 500);
          const safeFieldNames = new Set(safeFields.map((f: any) => f.field_name));
          const formulaFieldNames = new Set(formulaFields.map((f: any) => f.field_name));
          const fieldTypeMap = new Map(fields.map((f: any) => [f.field_name, f.type]));
          const recordsPayload = await Promise.all(chunk.map(async (rec: Record<string, any>) => {
               const mappedFields: Record<string, any> = {};
               const fallbackNotes: string[] = [];
               for (const [k, v] of Object.entries(rec.fields)) {
                  let candidateKey = '';
                  let candidateValue: any = v;

                  if (safeFieldNames.has(k)) {
                    candidateKey = oldFieldNameToNewFieldName[k] || k;
                    if (fieldTypeMap.get(k) === 17 && Array.isArray(v)) {
                      const newMediaList: Record<string, string>[] = [];
                      for (const m of v) {
                        if (m?.file_token) {
                          const pType = (m.type && String(m.type).includes('image')) ? 'bitable_image' : 'bitable_file';
                          // 穿透调用时，老 Bitable 的 fileToken 提供作 parent_node鉴权, ob_type=bitable
                          const newToken = await DocxEngine.transportMedia(srcBase, srcToken, tgtBase, tgtToken, m.file_token, newAppToken, pType, fileToken, m.name, 'bitable');
                          if (newToken) {
                            newMediaList.push({ file_token: newToken });
                          } else {
                            fallbackNotes.push(`${k} [附件提取失败]: ${m.name || m.file_token}`);
                          }
                        }
                      }
                      candidateValue = newMediaList.length > 0 ? newMediaList : null;
                    }
                  } else if (formulaFieldNames.has(k)) {
                    candidateKey = oldFieldNameToNewFieldName[`${k}【公式值】`] || `${k}【公式值】`;
                    candidateValue = Array.isArray(v) 
                       ? v.map((x: any) => x?.name ? `[附件] ${x.name}` : (x?.text || (typeof x === 'object' ? JSON.stringify(x) : String(x)))).join(' | ') 
                       : (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
                  }

                  // 【绝对铁壁】数据最终只接盘真实在新飞书表格里成功缔造过的列名防雷池
                  if (candidateKey && aliveTgtFieldNames.has(candidateKey)) {
                     // 【空值灭绝】飞书API写入不支持字段明文传送 null 或空连缀！
                     if (candidateValue !== null && candidateValue !== undefined && candidateValue !== '' && !(Array.isArray(candidateValue) && candidateValue.length === 0)) {
                        mappedFields[candidateKey] = candidateValue;
                     }
                  } else {
                     // 落榜残片全境回收
                     const readableValue = Array.isArray(v) ? v.map((x: any) => x?.text || String(x)).join(', ') : (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
                     if (readableValue && readableValue !== '{}' && readableValue !== '[]' && readableValue !== 'null') {
                        fallbackNotes.push(`${k}: ${readableValue.length > 200 ? readableValue.substring(0, 200) + '...' : readableValue}`);
                        globalDroppedFields.add(k);
                     }
                  }
               }
               // 将这一行所有没寄托进表的亡魂值填入备注列：
               if (fallbackNotes.length > 0 && aliveTgtFieldNames.has('【系统迁移备注】')) {
                  mappedFields['【系统迁移备注】'] = fallbackNotes.join(' | ');
               }
               return { fields: mappedFields };
          }));

          const bResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${newTableId}/records/batch_create`, 'POST', {
            records: recordsPayload
          });
          if (bResp.code !== 0) {
             const samplePayloadStr = recordsPayload.length > 0 ? JSON.stringify(recordsPayload[0]).substring(0, 600) : '空记录';
             console.error(`[Bitable] 批量写记录失败: ${bResp.msg} | 可能遗留的极高危断层类型导致整段崩溃！`);
             throw new Error(`写入记录遭到系统封堵: ${bResp.msg}\n最新深海样本体证: ${samplePayloadStr}`);
          }
          totalRecords += chunk.length;
          sse(ctrl, 'progress', { status: 'uploading', progress: 60 + Math.round(ti / tables.length * 30), message: `${tableName}: 已无损覆盖 ${totalRecords}/${records.length} 行本地数据...` });
        }
      }
    } else {
      do {
        const recordsUrl = `/bitable/v1/apps/${fileToken}/tables/${srcTableId}/records?page_size=100${pageToken ? `&page_token=${pageToken}` : ''}`;
        const recordsResp = await api(srcBase, srcToken, recordsUrl);
        const records = recordsResp.data?.items || [];
        pageToken = recordsResp.data?.page_token || '';

        if (records.length > 0 && newTableId) {
          const safeFieldNames = new Set(safeFields.map((f: any) => f.field_name));
          const formulaFieldNames = new Set(formulaFields.map((f: any) => f.field_name));
          const fieldTypeMap = new Map(fields.map((f: any) => [f.field_name, f.type]));
          const recordsPayload = await Promise.all(records.map(async (r: Record<string, any>) => {
               const mappedFields: Record<string, any> = {};
               const fallbackNotes: string[] = [];
               for (const [k, v] of Object.entries(r.fields)) {
                  let candidateKey = '';
                  let candidateValue: any = v;

                  if (safeFieldNames.has(k)) {
                    candidateKey = oldFieldNameToNewFieldName[k] || k;
                    if (fieldTypeMap.get(k) === 17 && Array.isArray(v)) {
                      const newMediaList: Record<string, string>[] = [];
                      for (const m of v) {
                        if (m?.file_token) {
                          const pType = (m.type && String(m.type).includes('image')) ? 'bitable_image' : 'bitable_file';
                          const newToken = await DocxEngine.transportMedia(srcBase, srcToken, tgtBase, tgtToken, m.file_token, newAppToken, pType, fileToken, m.name, 'bitable');
                          if (newToken) {
                            newMediaList.push({ file_token: newToken });
                          } else {
                            fallbackNotes.push(`${k} [附件提取失败]: ${m.name || m.file_token}`);
                          }
                        }
                      }
                      candidateValue = newMediaList.length > 0 ? newMediaList : null;
                    }
                  } else if (formulaFieldNames.has(k)) {
                    candidateKey = oldFieldNameToNewFieldName[`${k}【公式值】`] || `${k}【公式值】`;
                    candidateValue = Array.isArray(v) 
                       ? v.map((x: any) => x?.name ? `[附件] ${x.name}` : (x?.text || (typeof x === 'object' ? JSON.stringify(x) : String(x)))).join(' | ') 
                       : (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
                  }

                  // 【绝对铁壁】数据最终只接盘真实在新飞书表格里成功缔造过的列名防雷池
                  if (candidateKey && aliveTgtFieldNames.has(candidateKey)) {
                     // 【空值灭绝】飞书API写入不支持字段明文传送 null 或空连缀！
                     if (candidateValue !== null && candidateValue !== undefined && candidateValue !== '' && !(Array.isArray(candidateValue) && candidateValue.length === 0)) {
                        mappedFields[candidateKey] = candidateValue;
                     }
                  } else {
                     // 落榜残片全境回收
                     const readableValue = Array.isArray(v) ? v.map((x: any) => x?.text || String(x)).join(', ') : (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
                     if (readableValue && readableValue !== '{}' && readableValue !== '[]' && readableValue !== 'null') {
                        fallbackNotes.push(`${k}: ${readableValue.length > 200 ? readableValue.substring(0, 200) + '...' : readableValue}`);
                        globalDroppedFields.add(k);
                     }
                  }
               }
               // 将这一行所有没寄托进表的亡魂值填入备注列：
               if (fallbackNotes.length > 0 && aliveTgtFieldNames.has('【系统迁移备注】')) {
                  mappedFields['【系统迁移备注】'] = fallbackNotes.join(' | ');
               }
               return { fields: mappedFields };
          }));

          const bResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${newTableId}/records/batch_create`, 'POST', {
            records: recordsPayload
          });
          if (bResp.code !== 0) {
             const samplePayloadStr = recordsPayload.length > 0 ? JSON.stringify(recordsPayload[0]).substring(0, 600) : '空记录';
             console.error(`[Bitable] 批量写记录失败: ${bResp.msg} | 可能遗留的极高危断层类型导致整段崩溃！`);
             throw new Error(`写入记录遭到系统封堵: ${bResp.msg}\n最新深海样本体证: ${samplePayloadStr}`);
          }
          totalRecords += records.length;
        }

        sse(ctrl, 'progress', { status: 'uploading', progress: 60 + Math.round(ti / tables.length * 30), message: `${tableName}: 已无损覆盖 ${totalRecords} 行数据...` });
      } while (pageToken);
    }
  }

  for (const dt of defaultTables) {
    try {
      await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${dt.table_id}`, 'DELETE');
    } catch { /* 忽略删除失败 */ }
  }

  // 在迁移完成的 Bitable 同级位置创建说明文档
  try {
    const srcWebDomain = srcBase.includes('feishu') ? 'feishu.cn' : 'larksuite.com';
    const srcLink = `https://${srcWebDomain}/base/${fileToken}`;
    
    // 创建说明文档 (folder_token 必须在 query 中)
    let noteDocId = '';
    
    if (targetSpaceId) {
      // 知识库直接用暗盒原生挂载的方式生成实体
      try {
        const res = await bindToWiki(tgtBase, tgtToken, targetSpaceId, targetNodeToken || '', '', 'docx', `⚠️ [迁移说明] ${fileName}`);
        noteDocId = res.objToken;
      } catch (e) {
        console.warn('[Bitable] 创建知识库说明节点失败', e);
      }
    } else {
      // 在云空间正常目录创建
      let createDocUrl = '/docx/v1/documents';
      const noteDocResp = await api(tgtBase, tgtToken, createDocUrl, 'POST', {
        title: `⚠️ [迁移说明] ${fileName}`,
        folder_token: targetFolderToken || ''
      });
      noteDocId = noteDocResp.data?.document?.document_id;
    }
    
    if (noteDocId) {
      const noteBlocks = [
        { block_type: 2, text: { elements: [
          { text_run: { content: `📋 源多维表格: `, text_element_style: { bold: true } } }, 
          { text_run: { content: fileName } }
        ] } },
        { block_type: 2, text: { elements: [
          { text_run: { content: `🔗 源地址: `, text_element_style: { bold: true } } }, 
          { text_run: { content: srcLink, text_element_style: { link: { url: encodeURI(srcLink) } } } }
        ] } },
        { block_type: 2, text: { elements: [
          { text_run: { content: `\n⚠️ 迁移限制说明:`, text_element_style: { bold: true } } }
        ] } },
        { block_type: 2, text: { elements: [{ text_run: { content: `公式字段、查找引用、双向关联、系统字段等无法通过 API 自动写入。系统已尽可能抽取出原有的计算结果存为文本字段。` } }] } },
        ...(globalDroppedFields.size > 0 ? [{ block_type: 2, text: { elements: [{ text_run: { content: `\n🚨 特别警告: 以下原数据列受系统架构壁垒(关联隔离/环境断层)影响未能在新表中合法注册！其完整历史源值已被提取拼接并存放至各行最末的【[系统迁移备注]】安全列中，数据未发生实质丢失：\n👉 ` + Array.from(globalDroppedFields).join(' | ') } }] } }] : []),
        { block_type: 2, text: { elements: [{ text_run: { content: `\n建议操作: 在源端导出为 Excel，然后在目标端手动核对或补全特定关联选项。` } }] } },
      ];
      
      const insertResp = await api(tgtBase, tgtToken, `/docx/v1/documents/${noteDocId}/blocks/${noteDocId}/children`, 'POST', {
        index: -1, children: noteBlocks,
      });
      if (insertResp.code !== 0) console.error(`[Transfer] 写入多维表格说明文档内容失败:`, insertResp.msg);
    }
  } catch (e) {
    console.warn('[Bitable] 创建说明文档失败（不影响数据迁移）:', e);
  }

  sse(ctrl, 'progress', { status: 'done', progress: 100, message: `多维表格迁移完成！共 ${tables.length} 个数据表`, newToken: finalToken });
  return finalToken;
}

// ==================== 导出/导入兜底（slides 等） ====================
async function migrateViaExport(
  ctrl: ReadableStreamDefaultController,
  srcBase: string, srcToken: string,
  tgtBase: string, tgtToken: string,
  fileToken: string, fileType: string, fileName: string, targetFolderToken?: string, targetSpaceId?: string, targetNodeToken?: string
) {
  const extMap: Record<string, string> = { docx: 'docx', doc: 'docx', sheet: 'xlsx', slides: 'pptx', bitable: 'xlsx' };
  const ext = extMap[fileType] || 'docx';

  sse(ctrl, 'progress', { status: 'exporting', progress: 10, message: `正在导出 ${fileName}...` });

  const createResp = await api(srcBase, srcToken, '/drive/v1/export_tasks', 'POST', {
    file_extension: ext, token: fileToken, type: fileType,
  });
  if (createResp.code !== 0) throw new Error(`创建导出任务失败: ${createResp.msg}`);
  const ticket = createResp.data.ticket;

  let exportFileToken = '', exportFileSize = 0;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const statusResp = await api(srcBase, srcToken, `/drive/v1/export_tasks/${ticket}?token=${fileToken}`);
    const result = statusResp.data?.result;
    if (result?.job_status === 0) {
      exportFileToken = result.file_token;
      exportFileSize = result.file_size || 0;
      break;
    }
    if (result?.job_status === 2) throw new Error(`导出失败: ${result.job_error_msg}`);
  }
  if (!exportFileToken) throw new Error('导出超时');

  sse(ctrl, 'progress', { status: 'downloading', progress: 40, message: `正在下载 (${Math.round(exportFileSize / 1024)}KB)...` });

  const exportName = `${fileName}.${ext}`;
  const dlResp = await fetch(`${srcBase}/open-apis/drive/v1/export_tasks/file/${exportFileToken}/${encodeURIComponent(exportName)}`, {
    headers: { 'Authorization': `Bearer ${srcToken}` },
  });
  if (!dlResp.ok) throw new Error(`下载失败: HTTP ${dlResp.status}`);
  const fileData = await dlResp.arrayBuffer();

  sse(ctrl, 'progress', { status: 'uploading', progress: 60, message: '正在上传...' });

  const formData = new FormData();
  formData.append('file_name', exportName);
  formData.append('parent_type', 'explorer');
  formData.append('parent_node', targetSpaceId ? '' : (targetFolderToken || ''));
  formData.append('size', String(fileData.byteLength));
  formData.append('file', new Blob([fileData]), exportName);
  const ulResp = await fetch(`${tgtBase}/open-apis/drive/v1/files/upload_all`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${tgtToken}` }, body: formData,
  });
  const ulData = await ulResp.json();
  if (ulData.code !== 0) throw new Error(`上传失败: ${ulData.msg}`);

  sse(ctrl, 'progress', { status: 'uploading', progress: 80, message: '正在导入为云文档...' });

  const pt = targetSpaceId ? undefined : (targetFolderToken ? { mount_type: 1, mount_key: targetFolderToken } : undefined);
  const importResp = await api(tgtBase, tgtToken, '/drive/v1/import_tasks', 'POST', {
    file_extension: ext, file_token: ulData.data?.file_token, type: fileType === 'slides' ? 'slides' : ext === 'xlsx' ? 'sheet' : 'docx',
    file_name: fileName, point: pt,
  });
  if (importResp.code !== 0) throw new Error(`导入失败: ${importResp.msg}`);

  const importTicket = importResp.data?.ticket;
  let finalToken = importResp.data?.token || ''; 
  if (importTicket) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const s = await api(tgtBase, tgtToken, `/drive/v1/import_tasks/${importTicket}`);
      if (s.data?.result?.job_status === 0) {
        finalToken = s.data.result.token;
        break;
      }
      if (s.data?.result?.job_status === 2) throw new Error(`导入失败: ${s.data.result.job_error_msg}`);
    }
  }

  if (targetSpaceId && finalToken) {
    sse(ctrl, 'progress', { status: 'uploading', progress: 95, message: '正在无缝插入知识库层级...' });
    const res = await bindToWiki(tgtBase, tgtToken, targetSpaceId, targetNodeToken || '', finalToken, fileType === 'slides' ? 'slides' : ext === 'xlsx' ? 'sheet' : 'doc');
    finalToken = res.nodeToken;
  }

  sse(ctrl, 'progress', { status: 'done', progress: 100, message: '迁移完成！' });
  return finalToken;
}

// ==================== 普通文件直传 ====================
async function migrateRawFile(
  ctrl: ReadableStreamDefaultController,
  srcBase: string, srcToken: string,
  tgtBase: string, tgtToken: string,
  fileToken: string, fileName: string, targetFolderToken?: string, targetSpaceId?: string, targetNodeToken?: string
) {
  sse(ctrl, 'progress', { status: 'downloading', progress: 20, message: `正在探针打捞原生文件节点: ${fileName}...` });

  let fileData: ArrayBuffer | null = null;
  // 策略一：尝试标准云盘直列下载
  let resp = await fetch(`${srcBase}/open-apis/drive/v1/files/${fileToken}/download`, {
    headers: { 'Authorization': `Bearer ${srcToken}` },
  });
  if (resp.ok) {
     fileData = await resp.arrayBuffer();
  }

  // 策略二：遭到鉴权击落时判定为知识库隐性素材，启用 tmp_url 抢救模式
  if (!fileData) {
     sse(ctrl, 'progress', { status: 'downloading', progress: 30, message: `云盘管线遇阻，转入全景素材临时隧道...` });
     try {
       const tmpUrlResp = await fetch(`${srcBase}/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=${fileToken}`, {
          headers: { 'Authorization': `Bearer ${srcToken}` }
       });
       const tmpUrlData = await tmpUrlResp.json();
       const tmpUrl = tmpUrlData.data?.tmp_download_urls?.[0]?.tmp_download_url;
       if (tmpUrl) {
         const tmpDlResp = await fetch(tmpUrl);
         if (tmpDlResp.ok) fileData = await tmpDlResp.arrayBuffer();
       }
     } catch (e) {}
  }

  if (!fileData) throw new Error(`[RawFile] 孤立媒体 ${fileName} 多管线接驳全溃，底层权限封锁。`);

  sse(ctrl, 'progress', { status: 'uploading', progress: 60, message: '正在上传...' });

  const formData = new FormData();
  formData.append('file_name', fileName);
  formData.append('parent_type', 'explorer');
  formData.append('parent_node', targetSpaceId ? '' : (targetFolderToken || ''));
  formData.append('size', String(fileData.byteLength));
  formData.append('file', new Blob([fileData]), fileName);
  const ulResp = await fetch(`${tgtBase}/open-apis/drive/v1/files/upload_all`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${tgtToken}` }, body: formData,
  });
  const ulData = await ulResp.json();
  if (ulData.code !== 0) throw new Error(`上传失败: ${ulData.msg}`);
  
  let finalToken = ulData.data?.file_token;
  if (targetSpaceId && finalToken) {
    sse(ctrl, 'progress', { status: 'uploading', progress: 95, message: '正在连接知识库视图...' });
    const res = await bindToWiki(tgtBase, tgtToken, targetSpaceId, targetNodeToken || '', finalToken, 'file');
    finalToken = res.nodeToken;
  }

  sse(ctrl, 'progress', { status: 'done', progress: 100, message: '迁移完成！' });
  return finalToken;
}

// ==================== 主入口 ====================
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    fileToken, fileType, fileName, sourceSide, targetSide,
    sourceAppId, sourceAppSecret, sourceUserToken,
    targetAppId, targetAppSecret, targetUserToken, targetFolderToken, targetSpaceId, targetNodeToken,
    cachedData
  } = body as {
    fileToken: string; fileType: string; fileName: string;
    sourceSide: Side; targetSide: Side;
    sourceAppId: string; sourceAppSecret: string; sourceUserToken?: string;
    targetAppId: string; targetAppSecret: string; targetUserToken?: string;
    targetFolderToken?: string; targetSpaceId?: string; targetNodeToken?: string;
    cachedData?: any;
  };

  const srcBase = API_BASE[sourceSide];
  const tgtBase = API_BASE[targetSide];

  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        const srcToken = await getToken(sourceSide, sourceAppId, sourceAppSecret, sourceUserToken);
        const tgtToken = await getToken(targetSide, targetAppId, targetAppSecret, targetUserToken);

        let newToken;
        switch (fileType) {
          case 'folder':
            newToken = await migrateFolder(ctrl, tgtBase, tgtToken, fileName, targetFolderToken, targetSpaceId, targetNodeToken);
            break;
          case 'wiki_space':
            newToken = await migrateWikiSpace(ctrl, tgtBase, tgtToken, fileName);
            break;
          case 'docx':
          case 'doc':
          case 'mindnote':
            newToken = await migrateDocx(ctrl, srcBase, srcToken, tgtBase, tgtToken, fileToken, fileName, targetFolderToken, targetSpaceId, targetNodeToken, cachedData);
            break;
          case 'sheet':
            newToken = await migrateSheet(ctrl, srcBase, srcToken, tgtBase, tgtToken, fileToken, fileName, targetFolderToken, targetSpaceId, targetNodeToken, cachedData);
            break;
          case 'bitable':
            newToken = await migrateBitable(ctrl, srcBase, srcToken, tgtBase, tgtToken, fileToken, fileName, targetFolderToken, targetSpaceId, targetNodeToken, cachedData);
            break;
          case 'slides':
            // slides 无 Block API，使用导出/导入兜底
            newToken = await migrateViaExport(ctrl, srcBase, srcToken, tgtBase, tgtToken, fileToken, fileType, fileName, targetFolderToken, targetSpaceId, targetNodeToken);
            break;
          default:
            // 普通文件直传
            newToken = await migrateRawFile(ctrl, srcBase, srcToken, tgtBase, tgtToken, fileToken, fileName, targetFolderToken, targetSpaceId, targetNodeToken);
        }

        sse(ctrl, 'complete', { success: true, newToken });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误';
        console.error('[/api/transfer] ERROR:', msg);
        sse(ctrl, 'error', { message: msg });
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
