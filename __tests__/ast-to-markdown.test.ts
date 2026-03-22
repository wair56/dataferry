import { convertCachedDataToMarkdown } from '../src/lib/ast-to-markdown';

describe('AST to Markdown compiler extended suit', () => {
  it('should compile an empty document to safe string', () => {
    const payload = {
      document: { document_id: 'test' },
      blocks: [
        { block_id: '1', block_type: 1, page: { elements: [] } }
      ]
    };
    const md = convertCachedDataToMarkdown('docx', payload, '测试文档_空');
    // 如果没有任何文本注入，将产生基础头兜底
    expect(md).toContain('# 文档标题');
  });

  it('should gracefully handle unknown or unsupported block types like board and unknown ones', () => {
    const payload = {
      document: { document_id: 'test_unknown' },
      blocks: [
        { block_id: 'root', block_type: 1, page: { elements: [] }, children: ['unknown_block', 'board_block'] },
        { block_id: 'unknown_block', block_type: 9999, unknown_prop: { raw: 'data' } },
        { block_id: 'board_block', block_type: 28, board: { token: 'B123_456' } }
      ]
    };
    const md = convertCachedDataToMarkdown('docx', payload);
    // 未知件渲染不会崩溃失效
    expect(md).toContain('# 文档标题');
    // 画板(board) 会生成图片提取路径占位符
    expect(md).toContain('![🎨 画板](B123_456)');
  });

  it('should correctly format standard basic sheets payload', () => {
    const payload = {
      sheets: [
        {
          meta: { title: "主控表" },
          values: [
            ["Item", "Price", "Link"],
            ["Apple", 2, { type: "url", text: "buy now", link: "http://buy" }],
            ["Banana", null, "unknown"]
          ]
        }
      ]
    };
    const md = convertCachedDataToMarkdown('sheet', payload, '销售汇总');
    
    expect(md).toContain('# 销售汇总');
    expect(md).toContain('## 主控表');
    expect(md).toContain('| Item | Price | Link |');
    expect(md).toContain('|---|---|---|');
    expect(md).toContain('| Apple | 2 | [buy now](http://buy) |');
    expect(md).toContain('| Banana |  | unknown |');
  });

  it('should format smart bitable structure by evaluating logical field formats', () => {
    const payload = {
      tables: [
        {
          meta: { name: "管理表" },
          fields: [
             { field_name: "选项", ui_type: 'Checkbox' },
             { field_name: "时间", ui_type: 'DateTime' }
          ],
          records: [
             { fields: { "选项": true, "时间": 1715423819000 } },
             { fields: { "选项": false, "时间": 0 } }
          ]
        }
      ]
    };
    const md = convertCachedDataToMarkdown('bitable', payload, '项目里程碑');

    expect(md).toContain('# 项目里程碑');
    expect(md).toContain('## 管理表');
    expect(md).toContain('| 选项 | 时间 |');
    expect(md).toContain('|---|---|');
    expect(md).toContain('| ✅ |');  // truthy check rendering
    expect(md).toContain('| ⬜ |'); // falsy check rendering
  });
});
