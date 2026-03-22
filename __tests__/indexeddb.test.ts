import "fake-indexeddb/auto";
(global as any).window = global;
import { saveDataCache, getDataCache, clearAllDetailsCache, saveTransferHistory, DataCacheItem } from '../src/lib/indexeddb';

describe('IndexedDB operations', () => {
   // 清理防止单测间污染
   beforeEach(async () => {
      await clearAllDetailsCache();
   });

   it('should be able to save and retrieve complex payload data cache', async () => {
      const item: DataCacheItem = { id: 'test_token', type: 'docx', payload: { a: 1, text: "Some long JSON text content that will fallback correctly" }, fetchedAt: 12345678 };
      await saveDataCache(item);
      const retrieved = await getDataCache('test_token');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('test_token');
      expect(retrieved?.type).toBe('docx');
      expect(retrieved?.payload.text).toBe("Some long JSON text content that will fallback correctly");
   });

   it('should return null if token does not exist in store', async () => {
      const retrieved = await getDataCache('non_existent');
      expect(retrieved).toBeNull();
   });

   it('should clear caches when clearAllDetailsCache is triggered', async () => {
      const item: DataCacheItem = { id: 'token2', type: 'sheet', payload: [], fetchedAt: 123 };
      await saveDataCache(item);
      let r = await getDataCache('token2');
      expect(r).not.toBeNull();

      await clearAllDetailsCache();
      
      r = await getDataCache('token2');
      expect(r).toBeNull();
   });
});
