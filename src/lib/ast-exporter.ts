import { api } from '@/lib/lark-client';
import { DocxEngine } from '@/lib/docx-engine';

export class AstExporter {
  /**
   * 导出文档结构树的所有原生 AST JSON 块
   * 包含对内嵌电子表格 (block_type: 22) 和多维表格 (block_type: 18) 的全息下钻抓取
   */
  static async exportDocx(base: string, token: string, docToken: string) {
    const blocksMap = await DocxEngine.fetchAllBlocks(base, token, docToken);
    const blocksArray = Array.from(blocksMap.values());

    // 递归下钻抓取内嵌组件数据
    for (const block of blocksArray) {
      if (block.block_type === 22 && block.sheet?.token) {
        try {
          block.sheet._extracted_data = await this.exportSheet(base, token, block.sheet.token);
        } catch (e: any) {
          block.sheet._extracted_error = String(e.message || e);
        }
      }
      if (block.block_type === 18 && block.bitable?.token) {
        try {
          block.bitable._extracted_data = await this.exportBitable(base, token, block.bitable.token);
        } catch (e: any) {
          block.bitable._extracted_error = String(e.message || e);
        }
      }
    }
    
    return {
      type: 'docx_ast',
      document_token: docToken,
      blocks: blocksArray,
    };
  }

  /**
   * 导出 Sheet 电子表格的所有元数据、标签页及内部全阵列单元格数据
   */
  static async exportSheet(base: string, token: string, sheetToken: string) {
    // 1. Get meta
    const metaResp = await api(base, token, `/sheets/v3/spreadsheets/${sheetToken}`);
    if (metaResp.code !== 0 && metaResp.code !== 99991401) {
      throw new Error(`获取 Sheet 元数据失败 (code: ${metaResp.code}): ${metaResp.msg}`);
    }
    const meta = metaResp.data?.spreadsheet || {};

    // 2. Get all sheets
    const sheetsResp = await api(base, token, `/sheets/v3/spreadsheets/${sheetToken}/sheets/query`);
    const sheets = sheetsResp.data?.sheets || [];
    
    const extractedSheets = [];
    for (const sheet of sheets) {
      const sheetId = sheet.sheet_id;
      // 为了防止超出单表行列上限，默认抓取 A1:ZZ10000 数据。大规模场景可能需要分页，此处以常见上限为准。
      const range = `${sheetId}!A1:ZZ10000`;
      const dataResp = await api(base, token, `/sheets/v2/spreadsheets/${sheetToken}/values/${encodeURIComponent(range)}`);
      extractedSheets.push({
        meta: sheet,
        values: dataResp.data?.valueRange?.values || []
      });
    }

    return {
       type: 'sheet_ast',
       spreadsheet_token: sheetToken,
       meta,
       sheets: extractedSheets
    };
  }

  /**
   * 导出 Bitable 多维表格的应用程序元信息、数据表结构体系与全部记录
   */
  static async exportBitable(base: string, token: string, appToken: string) {
    // 1. Get meta
    const metaResp = await api(base, token, `/bitable/v1/apps/${appToken}`);
    if (metaResp.code !== 0 && metaResp.code !== 99991401) {
      throw new Error(`获取 Bitable 元数据失败 (code: ${metaResp.code}): ${metaResp.msg}`);
    }
    const meta = metaResp.data?.app || {};
    
    // 2. Get tables
    const tablesResp = await api(base, token, `/bitable/v1/apps/${appToken}/tables`);
    const tables = tablesResp.data?.items || [];
    
    const extractedTables = [];
    for (const table of tables) {
       const tableId = table.table_id;
       // 获取 Schema Fields
       const fieldsResp = await api(base, token, `/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`);
       const fields = fieldsResp.data?.items || [];
       
       // 获取全量 Records
       let pageToken = '';
       let allRecords = [];
       do {
         const recordsUrl = `/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=100${pageToken ? `&page_token=${pageToken}` : ''}`;
         const recordsResp = await api(base, token, recordsUrl);
         const records = recordsResp.data?.items || [];
         allRecords.push(...records);
         pageToken = recordsResp.data?.page_token || '';
       } while (pageToken);

       extractedTables.push({
         meta: table,
         fields,
         records: allRecords
       });
    }

    return {
      type: 'bitable_ast',
      app_token: appToken,
      meta,
      tables: extractedTables
    };
  }
}
