import { NextRequest, NextResponse } from 'next/server';
import { getAppAccessToken, OPEN_URLS, api } from '@/lib/lark-client';

type Side = 'feishu' | 'lark';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sourceSide, items, sourceUserToken, sourceAppId, sourceAppSecret } = body;
    const base = OPEN_URLS[sourceSide as Side];
    const token = sourceUserToken || await getAppAccessToken(sourceSide as Side, sourceAppId, sourceAppSecret);

    const flatItems: any[] = [];
    const queue = items.map((i: any) => {
      // 保持源名称不做抹除用以展示；如需做路径拼接可用安全的 safePath
      const safePath = i.path ? i.path.replace(/[\\\\:*?"<>|]/g, '_') : (i.name || 'Unnamed');
      // 【关键修复】确保初始节点有有效 id，否则子节点 parentId 为 undefined 导致层级第一级丢失
      return { ...i, id: i.id || i.node_token || i.token, path: safePath };
    });
    console.log(`[Recurse] 开始递归展开，初始 ${queue.length} 个节点:`, items.map((i: any) => `${i.name}(${i.type})`));

    while (queue.length > 0) {
      const current = queue.shift()!;
      
      const isWikiType = current.source === 'wiki' || current.type === 'wiki_space' || current.type === 'wiki_node' || current.spaceId;

      // 非结构性节点（且不是 Wiki 节点）直接加入结果并跳过
      if (!isWikiType && !['folder', 'root_drive'].includes(current.type)) {
         flatItems.push(current);
         continue;
      }

      // 如果是实际文档（即不仅是个空盘子抽屉壳），则必须加入下载名单。
      // 【极至命修复】绝不排杀 wiki_node（知识库文档实录），因为其实它本尊就是篇文！如遭封杀全盘成无爹之孤儿系平推！
      if (!['folder', 'root_drive', 'wiki_space', 'root_wiki'].includes(current.type) && !current.fromChild) {
         flatItems.push(current);
      }
      
      // ===== Drive 文件夹展开（含分页） =====
      if (current.type === 'folder' || current.type === 'root_drive') {
        const folderToken = current.type === 'root_drive' ? '' : (current.token || '');
        let pageToken = '';
        let pageCount = 0;
        do {
          const url = `/drive/v1/files?folder_token=${folderToken}&page_size=200${pageToken ? `&page_token=${pageToken}` : ''}`;
          const resp = await api(base, token, url, 'GET');
          if (resp.code !== 0) {
            console.error(`[Recurse] Drive 列表失败: ${resp.msg} (folder=${folderToken})`);
            break;
          }
          const children = resp.data?.files || [];
          pageToken = resp.data?.has_more ? (resp.data?.page_token || '') : '';
          pageCount += children.length;
          
          for (const child of children) {
            const safeName = child.name ? child.name.replace(/[\/\\:*?"<>|]/g, '_') : 'Unnamed';
            queue.push({
              id: child.token,
              name: child.name || safeName, // UI展示用原名
              type: child.type,
              token: child.token,
              source: 'drive',
              path: `${current.path || ''}/${safeName}`.replace(/^\/+/, ''),
              parentId: current.id,
              modifiedTime: child.modified_time ? Number(child.modified_time) : undefined
            });
          }
        } while (pageToken);
        console.log(`[Recurse] 文件夹 "${current.name || current.path}" 展开 ${pageCount} 个子项`);
        
      // ===== 知识库展开（含分页） =====
      } else if (isWikiType) {
        // wiki_space: token === space_id; 其他节点: spaceId 从父节点传递
        const spaceId = current.type === 'wiki_space' ? current.token : (current.spaceId || current.space_id || '');
        // wiki_node 的 parent_node_token 必须用 node_token（壳子），不能用 token（obj_token/文档实体）
        const parentNodeToken = current.node_token || current.nodeToken || current.token;
        
        if (!spaceId) {
          console.error(`[Recurse] Wiki 节点 "${current.name}" 缺少 spaceId，无法展开子节点`);
          continue;
        }
        
        let pageToken = '';
        let pageCount = 0;
        do {
          let url = `/wiki/v2/spaces/${spaceId}/nodes?page_size=50${pageToken ? `&page_token=${pageToken}` : ''}`;
          // 致命修复：任何非知识库本身实体的下级（即使它是 docx、bitable，但在知识库中皆可挂载子页的 node），
          // 都必须拼接本尊的 node_token，绝不能不拼接而导致拿飞书的全根节点！
          if (current.type !== 'wiki_space' && parentNodeToken) {
             url += `&parent_node_token=${parentNodeToken}`;
          }
          
          console.log(`[Recurse] Wiki API 调用: space=${spaceId}, parentNode=${parentNodeToken}, type=${current.type}`);
          const resp = await api(base, token, url, 'GET');
          if (resp.code !== 0) {
            console.error(`[Recurse] Wiki 列表失败: ${resp.msg} (space=${spaceId}, parentNode=${parentNodeToken})`);
            break;
          }
          const nodes = resp.data?.items || [];
          pageToken = resp.data?.has_more ? (resp.data?.page_token || '') : '';
          pageCount += nodes.length;
          
          for (const child of nodes) {
            const objType = child.obj_type || 'wiki_node';
            const safeName = child.title ? child.title.replace(/[\/\\:*?"<>|]/g, '_') : 'Unnamed';
            const childPath = `${current.path || ''}/${safeName}`.replace(/^\/+/, '');
            
            // 有实际文档类型的节点加入结果
            if (objType !== 'wiki_node') {
              flatItems.push({
                id: child.node_token,
                name: child.title,
                type: child.obj_type,
                realType: child.obj_type,
                token: child.obj_token, // 下载用 obj_token
                objToken: child.obj_token,
                node_token: child.node_token,
                nodeToken: child.node_token,
                spaceId: spaceId,
                path: childPath,
                parentId: current.id,
                modifiedTime: child.obj_edit_time || child.node_edit_time ? Math.max(Number(child.obj_edit_time || 0), Number(child.node_edit_time || 0)) : undefined
              });
            }
            
            // 有子节点的继续递归
            if (child.has_child) {
              queue.push({
                id: child.node_token,
                name: child.title,
                type: 'wiki_node',
                token: child.obj_token,
                node_token: child.node_token,  // 关键：传递 node_token
                nodeToken: child.node_token,
                objToken: child.obj_token,
                spaceId: spaceId,
                parentId: current.id,
                path: childPath,
                fromChild: true
              });
            }
          }
        } while (pageToken);
        console.log(`[Recurse] 知识库 "${current.name || current.path}" 展开 ${pageCount} 个子节点`);
      }
    }

    console.log(`[Recurse] 递归展开完成，共 ${flatItems.length} 个可下载文件`);
    return NextResponse.json({ items: flatItems });
  } catch (error: any) {
    console.error(`[Recurse] 递归展开异常:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
