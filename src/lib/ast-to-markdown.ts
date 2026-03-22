export function convertCachedDataToMarkdown(fileType: string, cachedData: any, originalName: string = 'Document', sourceSide: string = 'feishu', sourceNodeToken?: string, sourceObjToken?: string, assets?: { token: string, type: string }[]): string {
  if (!cachedData) return '';

  if (fileType === 'docx' || fileType === 'doc') {
    return convertDocxToMarkdown(cachedData, sourceSide, sourceNodeToken, sourceObjToken, assets);
  } else if (fileType === 'sheet') {
    return convertSheetToMarkdown(cachedData, originalName);
  } else if (fileType === 'bitable') {
    return convertBitableToMarkdown(cachedData, originalName);
  }

  return `未知的可转换格式: ${fileType}`;
}

function convertDocxToMarkdown(cachedData: any, sourceSide: string, sourceNodeToken?: string, sourceObjToken?: string, assets?: { token: string, type: string }[]): string {
  if (!cachedData.blocks || !Array.isArray(cachedData.blocks)) {
    return '无文档内容';
  }

  const blocksMap = new Map<string, any>();
  cachedData.blocks.forEach((b: any) => blocksMap.set(b.block_id, b));

  const rootBlock = cachedData.blocks.find((b: any) => b.block_type === 1);
  if (!rootBlock) return '';

  let md = '';
  
  function processBlock(blockId: string, indent: number = 0) {
    const block = blocksMap.get(blockId);
    if (!block) return;

    let prefix = '  '.repeat(indent);
    let line = '';

    // 解析富文本内容
    const parseTextElements = (elements?: any[]) => {
      if (!elements) return '';
      return elements.map(el => {
        if (el.text_run) {
           let txt = el.text_run.content || '';
           const style = el.text_run.text_element_style || {};
           if (style.bold) txt = `**${txt}**`;
           if (style.italic) txt = `*${txt}*`;
           if (style.strikethrough) txt = `~~${txt}~~`;
           if (style.inline_code) txt = `\`${txt}\``;
           if (style.link && style.link.url) txt = `[${txt}](${style.link.url})`;
           return txt;
        }
        if (el.mention_user) return `@${el.mention_user.user_id || '用户'}`;
        if (el.mention_doc) return `[📄 ${el.mention_doc.title || '文档'}](${el.mention_doc.url || ''})`;
        return '';
      }).join('');
    };

    switch (block.block_type) {
      case 1: // Page
        line = `# ${parseTextElements(block.page?.elements) || '文档标题'}\n\n`;
        break;
      case 2: // Text
        line = `${prefix}${parseTextElements(block.text?.elements)}\n\n`;
        break;
      case 3: case 4: case 5: case 6: case 7: case 8: case 9: // Headings
        const hLevel = block.block_type - 2;
        line = `${prefix}${'#'.repeat(Math.min(hLevel, 6))} ${parseTextElements(block[`heading${hLevel}`]?.elements)}\n\n`;
        break;
      case 12: // Bullet
        line = `${prefix}- ${parseTextElements(block.bullet?.elements)}\n`;
        break;
      case 13: // Ordered
        line = `${prefix}1. ${parseTextElements(block.ordered?.elements)}\n`;
        break;
      case 14: // Code
        line = `${prefix}\`\`\`\n${parseTextElements(block.code?.elements)}\n${prefix}\`\`\`\n\n`;
        break;
      case 15: // Quote
        line = `${prefix}> ${parseTextElements(block.quote?.elements)}\n\n`;
        break;
      case 17: // Todo
        line = `${prefix}- [${block.todo?.style?.done ? 'x' : ' '}] ${parseTextElements(block.todo?.elements)}\n`;
        break;
      case 22: // Divider
        line = `${prefix}---\n\n`;
        break;
      case 27: // Image
        if (assets && block.image?.token) {
          assets.push({ token: block.image.token, type: 'image' });
          line = `${prefix}![图片](./assets/${block.image.token}.png)\n\n`;
        } else {
          line = `${prefix}![图片](${block.image?.token || 'unknown_image'})\n\n`;
        }
        break;
      case 28: // Board 画板/白板
        if (assets && (block.board?.token || block.whiteboard?.token)) {
          const t = block.board?.token || block.whiteboard?.token;
          assets.push({ token: t, type: 'board' });
          line = `${prefix}![🎨 画板](./assets/${t}.png)\n\n`;
        } else {
          line = `${prefix}![🎨 画板](${block.board?.token || block.whiteboard?.token || 'board'})\n\n`;
        }
        break;
      case 31: // Table
        line = `${prefix}[表格 ${block.table?.row_size}x${block.table?.column_size}]\n\n`;
        break;
      case 20: // Chat Card
      case 43: // OKR
      case 51: // Sub Page List
        const typeNames: Record<number, string> = {
            20: 'Chat Card 群组聊天记录片',
            43: 'OKR 目标管控组件',
            51: 'Sub Page List 知识库子页面导航树'
        };
        const typeName = typeNames[block.block_type];
        const webDomain = sourceSide === 'lark' ? 'larksuite.com' : 'feishu.cn';
        const docUrl = sourceNodeToken ? `https://${webDomain}/wiki/${sourceNodeToken}` : `https://${webDomain}/docx/${sourceObjToken}`;
        line = `${prefix}> [!WARNING]\n> **[${typeName}]**\n> *(系统组件不支持脱机导出，请[点此回到源平台查看原文](${docUrl}))*\n\n`;
        break;
      default: {
        // 白名单壳容器：如果是某些仅仅用于布局和嵌套而对内容阅读本身毫无破坏的纯净容器块，直接跳过其丑陋的包裹提示皮，令其子女元素裸奔输出以实现无缝对接。
        if ([24, 25, 33, 34].includes(block.block_type)) {
           line = ''; // 静默掠过，仅依赖其后的 children 遍历
        } else {
           // 不支持类型保留原始 JSON（参考 feishu-pages，保证信息不丢失）
           const rawJson = JSON.stringify(block, null, 2);
           line = `${prefix}> [!WARNING]\n${prefix}> **[未完全适配的挂件组件 Type: ${block.block_type}]**\n\n${prefix}\`\`\`json\n${rawJson}\n${prefix}\`\`\`\n\n`;
        }
        break;
      }
    }

    md += line;

    if (block.children && block.children.length > 0) {
       // Only indent children if the parent is a list item or quote
       const childIndent = [12, 13, 15, 17].includes(block.block_type) ? indent + 1 : indent;
       block.children.forEach((childId: string) => processBlock(childId, childIndent));
    }
  }

  processBlock(rootBlock.block_id);
  return md.trim() + '\n';
}

function convertSheetToMarkdown(cachedData: any, originalName: string): string {
  if (!cachedData.sheets) return '无表格内容';
  let md = `# ${originalName}\n\n`;

  cachedData.sheets.forEach((sheetObj: any, index: number) => {
    const title = sheetObj.meta?.title || `Sheet${index + 1}`;
    md += `## ${title}\n\n`;

    const values = sheetObj.values;
    if (!values || values.length === 0) {
      md += `*(空)*\n\n`;
      return;
    }

    values.forEach((row: any[], rIdx: number) => {
       md += '| ' + row.map(cell => {
          let str = '';
          if (cell === null || cell === undefined) str = '';
          else if (typeof cell === 'object') {
             if (cell.type === 'url') str = `[${cell.text}](${cell.link})`;
             else if (cell.type === 'mention') str = `@${cell.text}`;
             else str = JSON.stringify(cell);
          } else {
             str = String(cell);
          }
          return str.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
       }).join(' | ') + ' |\n';

       if (rIdx === 0) {
          md += '|' + row.map(() => '---').join('|') + '|\n';
       }
    });
    md += '\n';
  });

  return md;
}

/**
 * 按 ui_type 智能解析 Bitable 字段值（参考 feishu-docx 的 _parse_field_value）
 */
function parseBitableFieldValue(field: any, value: any): string {
  if (value === null || value === undefined) return '';

  const uiType = field.ui_type || field.type;

  // DateTime: 毫秒时间戳 → 人类可读格式
  if (uiType === 'DateTime' || uiType === 5 || uiType === 1005) {
    if (typeof value === 'number') {
      try {
        const d = new Date(value);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      } catch { return String(value); }
    }
  }

  // Checkbox: 布尔 → ✅/⬜
  if (uiType === 'Checkbox' || uiType === 7) {
    return value ? '✅' : '⬜';
  }

  // List 类型（多选、人员、附件等）→ 提取 text/name/full_name/url
  if (Array.isArray(value)) {
    return value.map((item: any) => {
      if (typeof item === 'object' && item !== null) {
        return item.text || item.name || item.full_name || item.en_name || item.url || item.link || JSON.stringify(item);
      }
      return String(item);
    }).join(', ');
  }

  // Dict 类型（单选、关联等）→ 提取 text/name
  if (typeof value === 'object' && value !== null) {
    if (value.text) return value.text;
    if (value.name) return value.name;
    if (value.full_name) return value.full_name;
    if (value.link) return `[${value.text || '链接'}](${value.link})`;
    if (value.value !== undefined) {
      // 公式字段嵌套 value
      return parseBitableFieldValue(field, value.value);
    }
    return JSON.stringify(value);
  }

  return String(value);
}

function convertBitableToMarkdown(cachedData: any, originalName: string): string {
  if (!cachedData.tables) return '无多维表格内容';
  let md = `# ${originalName}\n\n`;

  cachedData.tables.forEach((tableObj: any) => {
     const title = tableObj.meta?.name || '数据表';
     md += `## ${title}\n\n`;

     const fields = tableObj.fields || [];
     const records = tableObj.records || [];

     if (fields.length === 0) {
        md += `*(无字段)*\n\n`;
        return;
     }

     const headerFields = fields.map((f: any) => f.field_name);
     md += '| ' + headerFields.join(' | ') + ' |\n';
     md += '|' + headerFields.map(() => '---').join('|') + '|\n';

     records.forEach((rec: any) => {
        const row = fields.map((f: any) => {
           const val = rec.fields[f.field_name];
           // 使用智能解析替代原始的简单类型判断
           const parsed = parseBitableFieldValue(f, val);
           return parsed.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
        });
        md += '| ' + row.join(' | ') + ' |\n';
     });
     md += '\n';
  });

  return md;
}
