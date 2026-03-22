import { api } from './lark-client';

export class DocxEngine {
  /**
   * 拉取全量旧块
   */
  static async fetchAllBlocks(srcBase: string, srcToken: string, oldDocId: string) {
    const blocksMap = new Map<string, any>();
    let pageToken = '';
    do {
      const url = `/docx/v1/documents/${oldDocId}/blocks?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
      const resp = await api(srcBase, srcToken, url, 'GET');
      if (resp.code !== 0) throw new Error(`[DocxEngine] 读取全量文档块失败: ${resp.msg}`);
      
      const items = resp.data?.items || [];
      for (const item of items) {
        blocksMap.set(item.block_id, item);
      }
      pageToken = resp.data?.page_token || '';
    } while (pageToken);
    
    return blocksMap;
  }

  /**
   * 抓取图片并重新在新端上传获取有效 Token
   * 三级降级策略（参考 feishu-docx / lark_docx_md）：
   *   策略1: /medias/{token}/download 直接下载
   *   策略2: /medias/batch_get_tmp_download_url 获取临时 URL 后下载
   *   策略3: /files/{token}/download 旧版文件 API 回退
   */
  static async transportMedia(srcBase: string, srcToken: string, tgtBase: string, tgtToken: string, mediaToken: string, newDocId: string, parentType: string = 'docx_image', oldDocId: string = '', customFileName: string = '', srcObjType: string = 'docx'): Promise<string | null> {
    try {
      // 携带强制 Wiki 素材鉴权用的 extra 结构体
      const extraPayload = oldDocId ? `?extra=${encodeURIComponent(JSON.stringify({ obj_type: srcObjType, obj_token: oldDocId }))}` : '';
      
      let fileData: ArrayBuffer | null = null;
      let actualMimeStr: string | null = null;

      // ===== 策略1: 直接下载 media API =====
      let dlResp = await fetch(`${srcBase}/open-apis/drive/v1/medias/${mediaToken}/download${extraPayload}`, {
        headers: { 'Authorization': `Bearer ${srcToken}` }
      });
      
      if (!dlResp.ok && extraPayload) {
         console.warn(`[DocxEngine] 带 Extra 抓取失败(${dlResp.status})，尝试脱去权限服进行裸式下探 (token: ${mediaToken})`);
         dlResp = await fetch(`${srcBase}/open-apis/drive/v1/medias/${mediaToken}/download`, {
            headers: { 'Authorization': `Bearer ${srcToken}` }
         });
      }
      
      if (dlResp.ok) {
        const buf = await dlResp.arrayBuffer();
        if (buf.byteLength > 120) {
           fileData = buf; // 阻击：如果截包拿到不足百字，必为假200伪报错网页垃圾包！
           actualMimeStr = dlResp.headers.get('content-type') || null;
        }
      }

      // ===== 策略2: 临时下载 URL（参考 feishu-docx / lark_docx_md 的 BatchGetTmpDownloadUrl）=====
      if (!fileData) {
        console.warn(`[DocxEngine] 策略1失败(${dlResp.status})，尝试临时下载 URL... (token: ${mediaToken})`);
        try {
          const tmpUrlResp = await fetch(`${srcBase}/open-apis/drive/v1/medias/batch_get_tmp_download_url?file_tokens=${mediaToken}`, {
            headers: { 'Authorization': `Bearer ${srcToken}` }
          });
          const tmpUrlData = await tmpUrlResp.json();
          const tmpUrl = tmpUrlData.data?.tmp_download_urls?.[0]?.tmp_download_url;
          if (tmpUrl) {
            const tmpDlResp = await fetch(tmpUrl);
            if (tmpDlResp.ok) {
              const buf = await tmpDlResp.arrayBuffer();
              if (buf.byteLength > 120) {
                fileData = buf;
                actualMimeStr = tmpDlResp.headers.get('content-type') || null;
                console.log(`[DocxEngine] ✓ 临时 URL 下载成功 (token: ${mediaToken}, mime: ${actualMimeStr})`);
              }
            }
          }
        } catch (tmpErr: any) {
          console.warn(`[DocxEngine] 临时 URL 策略异常: ${tmpErr.message}`);
        }
      }

      // ===== 策略3: 回退到 files API（部分旧图片只在 files 接口上）=====
      if (!fileData) {
        console.warn(`[DocxEngine] 策略2也失败，回退 files API (token: ${mediaToken})`);
        dlResp = await fetch(`${srcBase}/open-apis/drive/v1/files/${mediaToken}/download`, {
          headers: { 'Authorization': `Bearer ${srcToken}` }
        });
        if (dlResp.ok) {
          const buf = await dlResp.arrayBuffer();
          if (buf.byteLength > 120) {
             fileData = buf;
             actualMimeStr = dlResp.headers.get('content-type') || null;
          }
        }
      }

      // 所有策略都失败
      if (!fileData) {
        let errStr = `所有下载策略均失败 (HTTP ${dlResp.status})`;
        try { const errBody = await dlResp.json(); errStr = JSON.stringify(errBody); } catch {}
        console.error(`[DocxEngine] ⚠️ [图片迁移失败] 三级降级全部失败 (token: ${mediaToken}): ${errStr}`);
        throw new Error(errStr);
      }
      
      // 上传到目标端
      const formData = new FormData();
      // 基于真二进制探针获取真实后缀（绝不只信 HTTP 头！）
      let extSuffix = '.bin';
      let formMime = 'application/octet-stream';
      
      const header = new Uint8Array(fileData).subarray(0, 4);
      let hex = '';
      for (let i = 0; i < header.length; i++) hex += header[i].toString(16).padStart(2, '0').toUpperCase();
      
      let isVerifiedMedia = false;
      if (hex.startsWith('89504E47')) { extSuffix = '.png'; formMime = 'image/png'; isVerifiedMedia = true; }
      else if (hex.startsWith('FFD8')) { extSuffix = '.jpg'; formMime = 'image/jpeg'; isVerifiedMedia = true; }
      else if (hex.startsWith('47494638')) { extSuffix = '.gif'; formMime = 'image/gif'; isVerifiedMedia = true; }
      else if (hex.startsWith('52494646')) { extSuffix = '.webp'; formMime = 'image/webp'; isVerifiedMedia = true; }
      else if (hex.startsWith('494433') || hex.startsWith('FFFB')) { extSuffix = '.mp3'; formMime = 'audio/mpeg'; isVerifiedMedia = true; }
      else if (hex.startsWith('00000018') || hex.startsWith('00000020')) { extSuffix = '.mp4'; formMime = 'video/mp4'; isVerifiedMedia = true; }
      else if (hex.startsWith('25504446')) { extSuffix = '.pdf'; formMime = 'application/pdf'; }

      // 绝杀拦截：如果目标系统指明要作为图像(docx_image/bitable_image)入库，却探测不到有效媒体指纹（比如这是一坨超大报错 HTML）！
      if (parentType.includes('image') && !isVerifiedMedia && !hex.startsWith('3C3F786D') /* 非SVG xml头 */) {
         console.error(`[DocxEngine] ⚠ 严重警告：拉取到虚假伪装数据！(魔数头: ${hex})。为阻止其在插入端爆出 invalid param，系统已强制将其堕为残片并拒签入云。`);
         throw new Error(`获取到飞书非合法图像体 (MagicNumber:${hex})，已被底层二进制防线成功拦截拦截。落地样本参考上方 dump_media 输出。`);
      }
      const actualFileName = customFileName || (parentType.includes('image') ? `image${extSuffix}` : `file${extSuffix}`);
      formData.append('file_name', actualFileName);
      formData.append('parent_type', parentType);
      formData.append('parent_node', newDocId);
      formData.append('size', String(fileData.byteLength));
      formData.append('file', new Blob([fileData], { type: formMime }), actualFileName);
      
      console.log(`[Test-Snoop] 正在上传图片 (token: ${mediaToken}, size: ${fileData.byteLength}, mime: ${formMime}, parentType: ${parentType}, parentNode: ${newDocId})...`);
      const ulResp = await fetch(`${tgtBase}/open-apis/drive/v1/medias/upload_all`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tgtToken}` },
        body: formData,
      });
      const ulData = await ulResp.json();
      if (ulData.code !== 0) {
        console.error(`[Test-Snoop] ❌ 图片上传向 Lark 发起失败！返回：`, JSON.stringify(ulData));
        throw new Error(ulData.msg || JSON.stringify(ulData));
      }
      console.log(`[Test-Snoop] ✅ 图片拿到目标新身份：${ulData.data?.file_token}`);
      return ulData.data?.file_token || null;
    } catch (e: any) {
      console.error(`[DocxEngine] ⚠️ [图片迁移异常] ${e.message} (token: ${mediaToken})`);
      return null;
    }
  }

  /**
   * 清洗 Block (剥离特殊跨端私有信息，执行媒体物理搬运，和隔离降级)
   */
  static async cleanAndTransformBlock(b: any, srcBase: string, srcToken: string, tgtBase: string, tgtToken: string, newDocId: string, oldDocId: string) {
   try {
    const bType = b.block_type;
    
    // 注意：Sheet(22) 和 Bitable(18) 已移除降级名单，改为主动迁移
    // Task(21) 尝试读取任务详情; Sub Page List(51) 降级为带源链接的纯文本
    const UNMIGRATABLE_TYPES = new Set([20, 43, 51]);
    const typeNames: Record<number, string> = {
      18: 'Bitable 多维表格',
      20: 'Chat Card 群组聊天记录片',
      21: 'Task 任务管控组件',
      22: 'Sheet 嵌入式电子表格',
      43: 'OKR 目标管控组件',
      51: 'Sub Page List 知识库子页面导航树'
    };

    if (UNMIGRATABLE_TYPES.has(bType)) {
      const typeName = typeNames[bType] || `未知私有组件(${bType})`;
      const webDomain = srcBase.includes('feishu') ? 'feishu.cn' : 'larksuite.com';
      const fallbackUrl = `https://${webDomain}/docx/${oldDocId}`;
      console.log(`[DocxEngine] 发现跨域不可迁移组件 [${typeName}]，执行带链接的文本安全降级。`);
      return {
        payload: { block_type: 2, text: { elements: [
          { text_run: { content: `[${typeName}] `, text_element_style: { italic: true, bold: true } } },
          { text_run: { content: `(系统组件不支持跨租户导出，请点此查看源平台原文)`, text_element_style: { link: { url: fallbackUrl }, italic: true } } },
        ] } },
        originalChildren: b.children || []
      };
    }

    // 1.5 Board 画板/白板 (type 28) — 下载为图片后迁移（参考 lark_docx_md）
    if (bType === 28) {
      const boardToken = b.board?.token || b.whiteboard?.token;
      if (boardToken) {
        try {
          console.log(`[DocxEngine] 画板 (${boardToken})：调用 download_as_image API...`);
          const boardResp = await fetch(`${srcBase}/open-apis/board/v1/whiteboards/${boardToken}/download_as_image`, {
            headers: { 'Authorization': `Bearer ${srcToken}` }
          });
          if (boardResp.ok) {
            const boardData = await boardResp.arrayBuffer();
            if (boardData.byteLength > 0) {
              // 上传画板图片到目标端
              const formData = new FormData();
              formData.append('file_name', 'board.png');
              formData.append('parent_type', 'docx_image');
              formData.append('parent_node', newDocId);
              formData.append('size', String(boardData.byteLength));
              formData.append('file', new Blob([boardData], { type: 'image/png' }), 'board.png');
              const ulResp = await fetch(`${tgtBase}/open-apis/drive/v1/medias/upload_all`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${tgtToken}` },
                body: formData,
              });
              const ulData = await ulResp.json();
              const newToken = ulData.data?.file_token;
              if (newToken) {
                console.log(`[DocxEngine] ✓ 画板已转为图片迁移成功 (token: ${newToken})`);
                return {
                  payload: { block_type: 27, image: { token: newToken, width: 800, height: 600 } },
                  originalChildren: b.children || []
                };
              }
            }
          }
          // 画板下载/上传失败 → 降级为带链的文本
          throw new Error(`画板下载失败: HTTP ${boardResp.status}`);
        } catch (e: any) {
          console.warn(`[DocxEngine] 画板迁移失败(降级):`, e.message);
          const webDomain = srcBase.includes('feishu') ? 'feishu.cn' : 'larksuite.com';
          return {
            payload: { block_type: 2, text: { elements: [
              { text_run: { content: `🎨 [画板/白板] 迁移失败: ${e.message}。` } },
              { text_run: { content: `查看源画板`, text_element_style: { link: { url: `https://${webDomain}/docx/${oldDocId}` }, bold: true } } },
            ] } }, originalChildren: b.children || []
          };
        }
      }
    }
    
    // 1.7 图片 (type 27) — 【关键】token 是只读属性，不能在创建时传入
    // 正确流程：先创建空 image block → 拿 block_id → 再上传图片到 block_id
    if (bType === 27) {
      const imgToken = b.image?.token;
      if (imgToken) {
         console.log(`[DocxEngine] 图片 (${imgToken})：标记为延迟上传（需先创建空 block）`);
         return {
            payload: { 
              block_type: 27,
              image: {} 
            },
            originalChildren: b.children || [],
            // 携带源图片信息，在 block 创建后执行延迟上传
            _deferredImage: { srcMediaToken: imgToken, oldDocId }
         };
      }
    }

    // 1.8 附件 (type 23) — 下载后转为新 Token
    if (bType === 23) {
      const fileToken = b.file?.token;
      if (fileToken) {
         console.log(`[DocxEngine] 附件 (${fileToken})：正在拉取中...`);
         const newToken = await DocxEngine.transportMedia(srcBase, srcToken, tgtBase, tgtToken, fileToken, newDocId, 'docx_file', oldDocId);
         if (newToken) {
            console.log(`[DocxEngine] ✓ 附件上传重组成功 (新token: ${newToken})`);
            return {
               payload: { block_type: 23, file: { token: newToken, name: b.file?.name || 'file.bin' } },
               originalChildren: b.children || []
            };
         }
         throw new Error(`无法从源端拉取或者向目标端注入文件流。拦截阻断已执行。`);
      }
    }

    // 2. Sheet 嵌入式电子表格 (type 22) — 真实数据迁移
    if (bType === 22) {
      const sheetToken = b.sheet?.token || b.sheet_block?.token;
      if (sheetToken) {
        try {
          let sheets: any[] = [];
          if (b.sheet?._extracted_data?.sheets) {
            sheets = b.sheet._extracted_data.sheets.map((s:any) => s.meta);
          } else {
            const sheetsResp = await api(srcBase, srcToken, `/sheets/v3/spreadsheets/${sheetToken}/sheets/query`);
            sheets = sheetsResp.data?.sheets || [];
          }
          const createResp = await api(tgtBase, tgtToken, '/sheets/v3/spreadsheets', 'POST', {
            title: `[迁移] 嵌入表格_${sheetToken.substring(0, 8)}`,
            folder_token: '',
          });
          const newSpreadsheetToken = createResp.data?.spreadsheet?.spreadsheet_token;
          if (newSpreadsheetToken && sheets.length > 0) {
            const tgtSheetsResp = await api(tgtBase, tgtToken, `/sheets/v3/spreadsheets/${newSpreadsheetToken}/sheets/query`);
            const tgtSheets = tgtSheetsResp.data?.sheets || [];
            for (let si = 0; si < sheets.length; si++) {
              const sheet = sheets[si];
              let tgtSheetId = tgtSheets[si]?.sheet_id;
              if (!tgtSheetId && si > 0) {
                const addResp = await api(tgtBase, tgtToken, `/sheets/v2/spreadsheets/${newSpreadsheetToken}/sheets_batch_update`, 'POST', {
                  requests: [{ addSheet: { properties: { title: sheet.title || `Sheet${si + 1}` } } }],
                });
                tgtSheetId = addResp.data?.replies?.[0]?.addSheet?.properties?.sheetId;
              }
              if (!tgtSheetId) tgtSheetId = tgtSheets[0]?.sheet_id;
              let values: any[] = [];
              if (b.sheet?._extracted_data?.sheets?.[si]?.values) {
                 values = b.sheet._extracted_data.sheets[si].values;
              } else {
                 const range = `${sheet.sheet_id}!A1:ZZ10000`;
                 const dataResp = await api(srcBase, srcToken, `/sheets/v2/spreadsheets/${sheetToken}/values/${encodeURIComponent(range)}`);
                 values = dataResp.data?.valueRange?.values;
              }

              if (values && values.length > 0 && tgtSheetId) {
                await api(tgtBase, tgtToken, `/sheets/v2/spreadsheets/${newSpreadsheetToken}/values`, 'PUT', {
                  valueRange: { range: `${tgtSheetId}!A1:ZZ${values.length}`, values },
                });
              }
              console.log(`[DocxEngine] Sheet "${sheet.title}" 迁移完成 (${values?.length || 0} 行)`);
            }
          }
          // [飞书官方封锁隔离] 飞书在写入 Blocks 层时，不支持将 22(Sheet) 与 18(Bitable) 等高级内嵌件通过 API 外挂！
          // 若强发此代码，会被拦截网格直判 `invalid param`。因此将其转为一条带目的应用跳转链接的 Text 替代件。
          const webDomain = tgtBase.includes('feishu') ? 'feishu.cn' : 'larksuite.com';
          const newLink = newSpreadsheetToken ? `https://${webDomain}/sheets/${newSpreadsheetToken}` : '';
          return {
            payload: { block_type: 2, text: { elements: [
              { text_run: { content: `📊 [电子表格已被深度提取并建立为独立应用] `, text_element_style: { bold: true } } },
              { text_run: { content: `${sheets.length} 个工作表数据搬运已完成。` } },
              ...(newLink ? [{ text_run: { content: ` 👉 点击此处打开目标表格查看`, text_element_style: { link: { url: newLink }, bold: true } } }] : []),
            ] } },
            originalChildren: b.children || []
          };
        } catch (e: any) {
          console.warn(`[DocxEngine] Sheet 迁移失败(继续):`, e.message);
          const webDomain = srcBase.includes('feishu') ? 'open.feishu.cn' : 'open.larksuite.com';
          return {
            payload: { block_type: 2, text: { elements: [
              { text_run: { content: `📊 [嵌入式表格] 迁移失败: ${e.message}。` } },
              { text_run: { content: `查看源表格`, text_element_style: { link: { url: `https://${webDomain}/sheets/${sheetToken}` }, bold: true } } },
            ] } }, originalChildren: b.children || []
          };
        }
      }
    }

    // 3. Bitable 嵌入块 (type 18) — 真实数据迁移
    if (bType === 18) {
      const bitableToken = b.bitable?.token || b.bitable_block?.token;
      if (bitableToken) {
        try {
          console.log(`[DocxEngine] 嵌入式 Bitable (${bitableToken})：启动跨域数据搬运...`);
          
          // 分页获取全部数据表
          let tables: any[] = [];
          
          if (b.bitable?._extracted_data?.tables) {
             tables = b.bitable._extracted_data.tables.map((t:any) => t.meta);
          } else {
             let tablePageToken = '';
             do {
               const tablesResp = await api(srcBase, srcToken, `/bitable/v1/apps/${bitableToken}/tables?page_size=100${tablePageToken ? `&page_token=${tablePageToken}` : ''}`);
               tables.push(...(tablesResp.data?.items || []));
               tablePageToken = tablesResp.data?.has_more ? (tablesResp.data?.page_token || '') : '';
             } while (tablePageToken);
          }
          
          console.log(`[DocxEngine] Bitable 共发现 ${tables.length} 个数据表: ${tables.map((t:any) => t.name).join(', ')}`);
          
          const createResp = await api(tgtBase, tgtToken, '/bitable/v1/apps', 'POST', {
            name: `[迁移] 嵌入多维表格_${bitableToken.substring(0, 8)}`, folder_token: '',
          });
          const newAppToken = createResp.data?.app?.app_token;
          if (newAppToken && tables.length > 0) {
            const defaultResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables`);
            const defaultTables = defaultResp.data?.items || [];
            
            for (const table of tables) {
              const tableName = table.name || '数据表';
              
              let fields: any[] = [];
              let tableIndex = tables.indexOf(table);
              if (b.bitable?._extracted_data?.tables?.[tableIndex]?.fields) {
                 fields = b.bitable._extracted_data.tables[tableIndex].fields;
              } else {
                 let fieldPageToken = '';
                 do {
                   const fieldsResp = await api(srcBase, srcToken, `/bitable/v1/apps/${bitableToken}/tables/${table.table_id}/fields?page_size=100${fieldPageToken ? `&page_token=${fieldPageToken}` : ''}`);
                   fields.push(...(fieldsResp.data?.items || []));
                   fieldPageToken = fieldsResp.data?.has_more ? (fieldsResp.data?.page_token || '') : '';
                 } while (fieldPageToken);
              }
              
              console.log(`[DocxEngine] 数据表 "${tableName}" 共 ${fields.length} 个字段: ${fields.map((f:any) => `${f.field_name}(t:${f.type})`).join(', ')}`);
              
              const safeFields = fields.filter((f: any) => ![19,21,23,24,1001,1002,1003,1004,1005,3001].includes(f.type));
              const formulaFields = fields.filter((f: any) => f.type === 20);
              
              // 尝试带字段创建数据表（含公式→文本降级字段）
              let newTableId = '';
              const allCreateFields = [
                ...(safeFields.length > 0 
                  ? safeFields.map((f: any) => ({ field_name: f.field_name, type: f.type, ...(f.property ? { property: f.property } : {}) }))
                  : [{ field_name: '标题', type: 1 }]),
                ...formulaFields.map((f: any) => ({ field_name: `${f.field_name}[公式值]`, type: 1 })),
              ];
              const tgtTableResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables`, 'POST', {
                table: { name: tableName, fields: allCreateFields },
              });
              newTableId = tgtTableResp.data?.table_id || '';
              
              // 如果带字段创建失败，降级为空表 + 逐个追加字段
              if (!newTableId) {
                console.warn(`[DocxEngine] 带字段创建表 "${tableName}" 失败(${tgtTableResp.msg})，降级为空表+逐字段`);
                const fallbackResp = await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables`, 'POST', {
                  table: { name: tableName, fields: [{ field_name: '标题', type: 1 }] },
                });
                newTableId = fallbackResp.data?.table_id || '';
                if (newTableId) {
                  for (const sf of [...safeFields, ...formulaFields.map((f: any) => ({ field_name: `${f.field_name}[公式值]`, type: 1 }))]) {
                    try {
                      await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${newTableId}/fields`, 'POST', {
                        field_name: sf.field_name, type: sf.type, ...(sf.property ? { property: sf.property } : {}),
                      });
                    } catch {}
                  }
                }
              }
              
              // 搬运记录数据（含公式值抽取）
              if (newTableId) {
                let pt = '';
                const sfn = new Set(safeFields.map((f: any) => f.field_name));
                const ffn = new Set(formulaFields.map((f: any) => f.field_name));
                let totalRecords = 0;
                do {
                  const rr = await api(srcBase, srcToken, `/bitable/v1/apps/${bitableToken}/tables/${table.table_id}/records?page_size=100${pt ? `&page_token=${pt}` : ''}`);
                  const recs = rr.data?.items || []; pt = rr.data?.has_more ? (rr.data?.page_token || '') : '';
                  if (recs.length > 0) {
                    totalRecords += recs.length;
                    await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${newTableId}/records/batch_create`, 'POST', {
                      records: recs.map((r: any) => {
                        const m: any = {};
                        for (const [k,v] of Object.entries(r.fields)) {
                          if (sfn.has(k)) { m[k] = v; }
                          else if (ffn.has(k)) { m[`${k}[公式值]`] = Array.isArray(v) ? (v as any[]).map((x: any) => x?.text || String(x)).join(', ') : String(v ?? ''); }
                        }
                        return { fields: m };
                      }),
                    });
                  }
                } while (pt);
                console.log(`[DocxEngine] 数据表 "${tableName}" 迁移完成: ${fields.length} 字段, ${totalRecords} 条记录`);
              }
            }
            for (const dt of defaultTables) { try { await api(tgtBase, tgtToken, `/bitable/v1/apps/${newAppToken}/tables/${dt.table_id}`, 'DELETE'); } catch {} }
          }
          const srcWebDomain = srcBase.includes('feishu') ? 'feishu.cn' : 'larksuite.com';
          const tgtWebDomain = tgtBase.includes('feishu') ? 'feishu.cn' : 'larksuite.com';
          const newLink = newAppToken ? `https://${tgtWebDomain}/base/${newAppToken}` : '';
          const srcLink = `https://${srcWebDomain}/base/${bitableToken}`;

          // [飞书官方特性限定] 不能用通过 API 创建原生 Bitable 块进文档，我们只能给一个漂亮的数据跳转入口
          return {
            payload: { block_type: 2, text: { elements: [
              { text_run: { content: `📋 [多维表格系统已全集映射为独立基地] `, text_element_style: { bold: true } } },
              { text_run: { content: `${tables.length} 个表头数据搬运已完成。` } },
              ...(newLink ? [{ text_run: { content: ` 👉 立即前往新的多维体系`, text_element_style: { link: { url: newLink }, bold: true } } }] : []),
              { text_run: { content: ` | ` } },
              { text_run: { content: `查看原始旧表`, text_element_style: { link: { url: srcLink } } } },
            ] } }, originalChildren: b.children || []
          };
        } catch (e: any) {
          console.warn(`[DocxEngine] Bitable 迁移失败(继续):`, e.message);
          const webDomain = srcBase.includes('feishu') ? 'open.feishu.cn' : 'open.larksuite.com';
          return {
            payload: { block_type: 2, text: { elements: [
              { text_run: { content: `📋 [嵌入式多维表格迁移失败] ${e.message}。` } },
              { text_run: { content: ` 查看源表格`, text_element_style: { link: { url: `https://${webDomain}/base/${bitableToken}` }, bold: true } } },
            ] } }, originalChildren: b.children || []
          };
        }
      }
    }

    // 4. Task 任务组件 (type 21) — 尝试读取任务详情
    if (bType === 21) {
      const taskId = b.task?.task_id || b.task_block?.task_id;
      if (taskId) {
        try {
          console.log(`[DocxEngine] Task 组件 (${taskId})：尝试读取任务详情...`);
          const taskResp = await api(srcBase, srcToken, `/task/v2/tasks/${taskId}`);
          const task = taskResp.data?.task;
          if (task) {
            const statusEmoji = task.completed_at ? '✅' : '⬜';
            const summary = task.summary || '(无标题任务)';
            const due = task.due ? ` | 截止: ${new Date(Number(task.due.timestamp) * 1000).toLocaleDateString()}` : '';
            return {
              payload: { block_type: 2, text: { elements: [
                { text_run: { content: `${statusEmoji} [任务] `, text_element_style: { bold: true } } },
                { text_run: { content: `${summary}${due}` } },
              ] } }, originalChildren: b.children || []
            };
          }
        } catch (e: any) {
          console.warn(`[DocxEngine] Task 读取失败(继续):`, e.message);
        }
      }
      // 如果读取失败，降级为带图标的占位
      return {
        payload: { block_type: 2, text: { elements: [
          { text_run: { content: `⬜ [任务组件] 原文档此处嵌有一个任务，因权限限制无法提取详情。` } },
        ] } }, originalChildren: b.children || []
      };
    }

    // 5. Sub Page List (type 51) — 直接透传子节点，不再显示降级警告
    if (bType === 51) {
      console.log(`[DocxEngine] Sub Page List：直接透传 ${(b.children || []).length} 个子节点`);
      // 飞书不允许 payload=text 的 elements 为空数组，会导致 invalid param
      return { payload: { block_type: 2, text: { elements: [{ text_run: { content: '📄 [子页面列表]' } }] } }, originalChildren: b.children || [] };
    }

    // 6. 仅保留真正无法通过任何 API 读取的类型作为降级
    if (UNMIGRATABLE_TYPES.has(bType)) {
      const cName = typeNames[bType] || `未知高级节点(Type: ${bType})`;
      const webDomain = srcBase.includes('feishu') ? 'open.feishu.cn' : 'open.larksuite.com';
      const link = `https://${webDomain}/docx/${oldDocId}`;
      return {
        payload: { block_type: 2, text: { elements: [
          { text_run: { content: `⚠️ [${cName}] 此组件为企业级私有数据，无法通过 API 读取。` } },
          { text_run: { content: ` 查看源文档`, text_element_style: { link: { url: encodeURI(link) }, bold: true } } },
        ] } }, originalChildren: b.children || []
      };
    }

    // === 以下是常规 block 处理 ===
    const typeKey = Object.keys(b).find(k => 
      !['block_id', 'parent_id', 'children', 'block_type', 'zone_id', 'comment_ids', 'text_elements'].includes(k) &&
      typeof b[k] === 'object' && 
      !Array.isArray(b[k]) && 
      b[k] !== null
    );

    if (typeKey) {
      let content = JSON.parse(JSON.stringify(b[typeKey])); // Deep copy
      
      // ==========================================
      // [系统性 Payload 清洗引擎]
      // 深度学习自 feishu-docx 和 cloud-document-converter 等 13 个库：
      // 飞书的 API 吐出的数据里包含了大量仅服务于客户端渲染的、不可写的系统字段（readonly attrs）。
      // 写入 API 会对这些冗余或内部跨界参数直接返回 invalid param！
      // ==========================================
      
      // 1. 全局脏数据过滤
      ['zone_id', 'parent_id', 'block_id', 'comment_ids'].forEach(k => delete content[k]);
      
      // 2. 按类型强力白名单精简 (避免 invalid param)
      if (bType === 31) {
        // Table (31): 开源库 (md_to_blocks.py) 显示，创建表格只需传递 property 中的行列大小，
        // 任何其他的如 column_width 的冗余信息如果和实际不符极易引发异常。
        if (content.property) {
          content.property = {
            row_size: content.property.row_size,
            column_size: content.property.column_size
          };
        }
      } else if (bType === 18 || bType === 30 || bType === 26) {
        // Bitable (18), Sheet (30), Iframe (26): 这种高级嵌套块的属性极为严格
        // 我们在之前的代码里遇到很多由于包含系统唯一 token 无法转移而死掉的，
        // 对于新建，通常只需最基础参数，Bitable/Sheet 的真实内容都是独立的 API 迁移的
        // 此处通常需要置空其内部只读 token 等待新建
        if (content.token) delete content.token;
      }
      
      // 3. 降级高危富文本控件 (仅处理明确的跨域私有引用)
      if (content.elements) {
        content.elements = content.elements.filter((el: any) => {
          // 跳过完全空的元素
          if (!el || Object.keys(el).length === 0) return false;
          return true;
        }).map((el: any) => {
          // 仅替换跨域不可用的 mention 引用
          if (el.mention_user) {
            return { text_run: { content: `@${el.mention_user.user_id || '未知人员'}`, text_element_style: el.text_element_style } };
          }
          if (el.mention_doc) {
            const docName = el.mention_doc?.title || '关联文档';
            return { text_run: { content: `[📎 ${docName}]`, text_element_style: el.text_element_style } };
          }
          // 特殊：如果遇到不可写的图素或者其它复杂系统标签
          if (el.mention_department || el.mention_folder || el.mention_workspace || el.mention_bot) {
             return { text_run: { content: `[@外部引用对象]`, text_element_style: el.text_element_style } };
          }
          // text_run / equation / 其他正常元素 → 原样保留
          return el;
        });
      }

      if ((bType === 27 || bType === 23) && content.token) {
        const parentType = bType === 27 ? 'docx_image' : 'docx_file';
        if (bType === 27) {
          // 图片 block 的 token 是只读属性，不能创建时传入，使用延迟上传
          console.log(`[DocxEngine] 通用路径图片 (${content.token})：标记为延迟上传`);
          const srcMediaToken = content.token;
          content = {};
          const payload = { block_type: bType, [typeKey!]: content };
          return { payload, originalChildren: b.children || [], _deferredImage: { srcMediaToken, oldDocId } };
        }
        // 文件 block (type 23) 保持原有逻辑
        console.log(`[DocxEngine] 侦测到媒体结构块(${parentType})正在穿透跨域沙盒 (token: ${content.token})...`);
        try {
          const newT = await this.transportMedia(srcBase, srcToken, tgtBase, tgtToken, content.token, newDocId, parentType, oldDocId);
          if (newT) {
            content = { 
               token: newT,
               name: content.name || 'file.bin'
            };
          } else {
            throw new Error(`系统提取或上传该媒体资源失败，内部返回空值。`);
          }
        } catch (mediaErr: any) {
          return {
            payload: { block_type: 2, text: { elements: [
              { text_run: { content: `⚠️ [附件迁移失败] 源端下载拒载 (token: ${content.token}). API 返回: ${mediaErr.message}` } },
            ] } },
            originalChildren: b.children || []
          };
        }
      }

      const payload = { block_type: bType, [typeKey]: content };
      return { payload, originalChildren: b.children || [] };
    }

    return { payload: { block_type: bType }, originalChildren: b.children || [] };
  } catch (blockError: any) {
    // ========== 终极安全网：任何 block 处理异常都不会让整个文档迁移崩溃 ==========
    console.error(`[DocxEngine] Block(type:${b?.block_type}) 处理中遭遇未预料异常，已安全跳过: ${blockError.message}`);
    return {
      payload: { block_type: 2, text: { elements: [
        { text_run: { content: `[块处理异常] 此内容块(type:${b?.block_type})处理失败: ${blockError.message}` } },
      ] } },
      originalChildren: b?.children || []
    };
  }
  }

  /**
   * 采用广度优先 (BFS) 加限流批处理将 DOM 树 1:1 塞回目标文档
   */
  static async migrate(
    srcBase: string, srcToken: string, oldDocId: string,
    tgtBase: string, tgtToken: string, newDocId: string,
    onProgress: (msg: string) => void,
    cachedData?: any
  ) {
    onProgress('正在提取源文档全部数据碎片...');
    let blocksMap = new Map<string, any>();
    
    if (cachedData && cachedData.blocks) {
      for (const block of cachedData.blocks) {
        blocksMap.set(block.block_id, block);
      }
    } else {
      blocksMap = await this.fetchAllBlocks(srcBase, srcToken, oldDocId);
    }
    
    let srcRootBlock = blocksMap.get(oldDocId);
    if (!srcRootBlock) {
      srcRootBlock = Array.from(blocksMap.values()).find(b => b.block_type === 1); // Fallback to explicitly searching for the 'page' node.
    }
    
    if (!srcRootBlock || !srcRootBlock.children || srcRootBlock.children.length === 0) {
      return; // 文档为空，只有标题块也即无需迁移
    }

    onProgress(`提取完成 (共 ${blocksMap.size} 块)，正在进行 DOM 重建及跨海图文置换...`);

    // 🔥 绝对防御：直接去目标端文档拉取其原生构建的 Root Block，杜绝 document_id != root_block_id 的悬空报错
    const newDocBlocksResp = await api(tgtBase, tgtToken, `/docx/v1/documents/${newDocId}/blocks?page_size=1`, 'GET');
    const newDocRootId = newDocBlocksResp.data?.items?.[0]?.block_id || newDocId;

    // BFS 队列 [ { targetParentId, srcChildIds } ]
    const queue = [{ targetParentId: newDocRootId, srcChildIds: srcRootBlock.children }];
    let processedCount = 0;

    let fatalErrors = [];

    while (queue.length > 0) {
      const batch = queue.shift()!;
      const { targetParentId, srcChildIds } = batch;

      // 飞书分批注入限制: 每请求不能超过 50 个 Block
      for (let i = 0; i < srcChildIds.length; i += 50) {
        const chunkIds = srcChildIds.slice(i, i + 50);
        
        // 并发清洗块 + 错误透明收集 + 保留原始 block_type
        const chunkNodes = await Promise.all(chunkIds.map(async (id: string) => {
          const block = blocksMap.get(id);
          if (!block) return null;
          const originalBlockType = block.block_type; // 保留原始类型（cleanAndTransform 后会变成 2）
          const result = await this.cleanAndTransformBlock(block, srcBase, srcToken, tgtBase, tgtToken, newDocId, oldDocId);
          // 附带原始类型以备后续降级报告
          if (result) (result as any)._originalBlockType = originalBlockType;
          // 检查是否包含失败/降级标记文本
          const txt = JSON.stringify(result?.payload?.text?.elements || []);
          if (txt.includes('迁移失败') || txt.includes('块处理异常') || txt.includes('权限限制') || txt.includes('无法导出')) {
            const typeName = ({18:'Bitable',20:'ChatCard',21:'Task',22:'Sheet',27:'图片',23:'附件',43:'OKR',51:'SubPageList'} as Record<number, string>)[originalBlockType] || `Block(${originalBlockType})`;
            const errDetail = txt.match(/迁移失败[\]：:]\s*([^。"\]]+)/)?.[1] || txt.match(/处理失败[\]：:]\s*([^。"\]]+)/)?.[1] || txt.match(/下载失败[^"]+/)?.[0] || '详见文档';
            const msg = `⚠️ [${typeName}] ${errDetail}`;
            onProgress(msg);
            fatalErrors.push(msg);
          }
          return result;
        }));

        const validNodes = chunkNodes.filter(n => n !== null) as any[];
        if (validNodes.length === 0) continue;

        const childrenPayload = validNodes.map(n => n.payload);

        // 飞书服务端拥有严格的并发限制：单文档最大 3 并发，全量最高 3 QPS。每次批装载也需休眠避开频率墙。
        await new Promise(r => setTimeout(r, 400));

        // API 批量挂载块
        const pResp = await api(tgtBase, tgtToken, `/docx/v1/documents/${newDocId}/blocks/${targetParentId}/children`, 'POST', {
          index: -1,
          children: childrenPayload
        });

        let createdChildren: any[] = [];

        // 若整批报错（通常因为内部夹杂了由特殊插件创建但新端不支持的专有节点格式）
        if (pResp.code !== 0) {
           console.warn(`[DocxEngine] 遇到格式封锁拦截，打散进行安全级单点直连解析... (原错误: ${pResp.msg}, docId: ${newDocId}, parentBlockId: ${targetParentId})`);
           
           // 降级为逐个单线程穿透注入 (⚠️ 极其关键的长效降速：防止触发 request trigger frequency limit 禁言)
           for (let j = 0; j < validNodes.length; j++) {
             await new Promise(r => setTimeout(r, 400)); // 强制 400 毫秒节流
             
             const sResp = await api(tgtBase, tgtToken, `/docx/v1/documents/${newDocId}/blocks/${targetParentId}/children`, 'POST', {
               index: -1,
               children: [validNodes[j].payload]
             });
                          if (sResp.code !== 0) {
                const origType = (validNodes[j] as any)._originalBlockType || validNodes[j].payload.block_type;
                const BLOCK_TYPE_NAMES: Record<number, string> = {
                  18:'多维表格',19:'高亮块',20:'群卡片',21:'流程图',22:'分割线',23:'附件',
                  24:'分栏',26:'内嵌网页',27:'图片',28:'插件块',29:'思维笔记',30:'电子表格',
                  31:'表格',33:'视图',36:'任务',37:'OKR',99:'扩展块'
                };
                const typeName = BLOCK_TYPE_NAMES[origType] || `Block(type:${origType})`;
                const blockErrMsg = `⚠️ [${typeName}] 写入目标文档失败: ${sResp.msg}`;
                // 打印完整 payload 和 API 响应用于诊断 invalid param
                console.error(`[DocxEngine] ${blockErrMsg}\n  → 完整 Payload: ${JSON.stringify(validNodes[j].payload, null, 2).substring(0, 2000)}\n  → API 完整返回: ${JSON.stringify(sResp).substring(0, 1000)}`);
                onProgress(blockErrMsg);
                fatalErrors.push(blockErrMsg);
                
                // 提取原始文本内容（如果有）
                const origElements = validNodes[j].payload?.text?.elements || [];
                const origText = origElements.map((el: any) => el?.text_run?.content || '').join('').trim();
                
                // 构建源文档链接
                const srcWebDomain = srcBase.includes('feishu') ? 'feishu.cn' : 'larksuite.com';
                const srcDocUrl = `https://${srcWebDomain}/docx/${oldDocId}`;
                
                // 降级为文本占位：包含原始类型、源链接和原始文本
                const fallbackPayload = {
                  block_type: 2,
                  text: {
                    elements: [
                      { text_run: { content: `⚠️ [${typeName}迁移失败] `, text_element_style: { bold: true } } },
                      { text_run: { content: `原始类型: ${typeName}(${origType}) | 错误: ${sResp.msg}\n` } },
                      { text_run: { content: `致命 Payload 探针: ${JSON.stringify(validNodes[j].payload, null, 2).substring(0, 1000)}\n`, text_element_style: { italic: true } } },
                      { text_run: { content: `🔗 源文档: `, text_element_style: { bold: true } } },
                      { text_run: { content: srcDocUrl, text_element_style: { link: { url: encodeURI(srcDocUrl) } } } },
                      ...(origText ? [{ text_run: { content: `\n📝 原始内容: ${origText}` } }] : []),
                    ]
                  }
                };

               await new Promise(r => setTimeout(r, 400)); // 继续强制节流
               const fallbackResp = await api(tgtBase, tgtToken, `/docx/v1/documents/${newDocId}/blocks/${targetParentId}/children`, 'POST', {
                 index: -1,
                 children: [fallbackPayload]
               });

               if (fallbackResp.code === 0 && fallbackResp.data?.children?.[0]) {
                 createdChildren.push(fallbackResp.data.children[0]);
               } else {
                 console.error(`[DocxEngine] 极致失败：连兜底文本都无法装载！！原因: ${fallbackResp.msg}`);
                 fatalErrors.push(`Block [${validNodes[j].payload.block_type}] Fallback Failed: ${fallbackResp.msg}`);
                 createdChildren.push(null); // 留下空洞以对齐节点索引
               }
             } else {
               createdChildren.push(sResp.data?.children?.[0]);
             }
           }
        } else {
           createdChildren = pResp.data?.children || [];
        }
        
        // 【图片延迟上传】对成功创建的空 image block：上传图片 → PATCH replace_image 关联
        for (let j = 0; j < validNodes.length; j++) {
           const deferred = (validNodes[j] as any)._deferredImage;
           const newBlock = createdChildren[j];
           if (deferred && newBlock?.block_id) {
              try {
                 console.log(`[DocxEngine] 图片延迟上传: 源图 ${deferred.srcMediaToken} → 文档 ${newDocId}`);
                 await new Promise(r => setTimeout(r, 400));
                 const newToken = await DocxEngine.transportMedia(
                   srcBase, srcToken, tgtBase, tgtToken,
                   deferred.srcMediaToken, newDocId, 'docx_image', deferred.oldDocId
                 );
                 if (newToken) {
                   // 通过 PATCH replace_image 把上传后的 token 关联到空 image block
                   const patchResp = await api(tgtBase, tgtToken,
                     `/docx/v1/documents/${newDocId}/blocks/${newBlock.block_id}`, 'PATCH', {
                       replace_image: { token: newToken }
                     }
                   );
                   if (patchResp.code === 0) {
                     console.log(`[DocxEngine] ✓ 图片关联成功 (block: ${newBlock.block_id}, token: ${newToken})`);
                   } else {
                     console.error(`[DocxEngine] ⚠ 图片 PATCH 关联失败: ${patchResp.msg} (code: ${patchResp.code})`);
                     fatalErrors.push(`⚠️ [图片] 关联失败: ${patchResp.msg}`);
                     onProgress(`⚠️ [图片] 关联失败: ${patchResp.msg}`);
                   }
                 } else {
                   console.warn(`[DocxEngine] ⚠ 图片上传返回空 token`);
                 }
              } catch (imgErr: any) {
                 console.error(`[DocxEngine] 图片延迟上传失败: ${imgErr.message}`);
                 fatalErrors.push(`⚠️ [图片] 上传失败: ${imgErr.message}`);
                 onProgress(`⚠️ [图片] 上传失败: ${imgErr.message}`);
              }
           }
        }

        // 为每一条成功写入且含有子节点的 Block 续加新一轮下钻任务进队列
        for (let j = 0; j < validNodes.length; j++) {
           const origChildren = validNodes[j].originalChildren;
           const newCreatedBlock = createdChildren[j];
           if (origChildren.length > 0 && newCreatedBlock?.block_id) {
             queue.push({ targetParentId: newCreatedBlock.block_id, srcChildIds: origChildren });
           }
        }
        
        processedCount += chunkIds.length;
        if (processedCount % 15 === 0) {
          onProgress(`引擎高压注入中... 已处理 ${processedCount} 个原生碎片`);
        }
      }
    }

    // 迁移完成后，输出完整的错误/降级汇总报告
    if (fatalErrors.length > 0) {
       const summary = `\n📋 迁移完成，但有 ${fatalErrors.length} 个问题需要注意:\n${fatalErrors.map((e, i) => `  ${i+1}. ${e}`).join('\n')}`;
       console.warn(summary);
       onProgress(summary);
       // 不再 throw —— 已通过 onProgress 上报给前端，用户可以看到每一条细节
    } else {
       onProgress('✅ 全部块迁移完成，零异常！');
    }
  }
}
