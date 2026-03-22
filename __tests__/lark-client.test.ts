import fetchMock from 'jest-fetch-mock';
fetchMock.enableMocks();
import { api } from '../src/lib/lark-client';

describe('Lark API Client', () => {
   beforeEach(() => {
     fetchMock.resetMocks();
   });

   it('should fetch data successfully on standard 200 response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ code: 0, msg: 'success', data: { verified: true } }));
      const result = await api('https://feishu.cn', 'my_token', '/test_path', 'GET');
      expect(result.code).toBe(0);
      expect(result.data.verified).toBe(true);
      expect(fetchMock.mock.calls.length).toEqual(1);
   });

   it('should be able to parse regular error response properly without retrying', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ code: 40004, msg: 'Department ID invalid' }), { status: 400 });
      const result = await api('https://feishu.cn', 'my_token', '/test_path2', 'GET');
      expect(result.code).toBe(40004);
      expect(result.msg).toBe('Department ID invalid');
      expect(fetchMock.mock.calls.length).toEqual(1);
   });

   it('should handle 99991400 RateLimit intelligently with automatic delay based polling', async () => {
      // 模拟第一次碰壁 429
      fetchMock.mockResponseOnce(JSON.stringify({ code: 99991400, msg: 'too many request' }), { status: 400 });
      // 模拟第二次成功通行
      fetchMock.mockResponseOnce(JSON.stringify({ code: 0, msg: 'success from retry' }), { status: 200 });

      const start = Date.now();
      const result = await api('https://feishu.cn', 'mock_token', '/test_ratelimit', 'GET');
      const end = Date.now();

      expect(result.code).toBe(0);
      expect(result.msg).toBe('success from retry');
      expect(fetchMock.mock.calls.length).toEqual(2); // 第一个是失败，第二个是重试
      expect(end - start).toBeGreaterThanOrEqual(100); // api() 在缺掉 ratelimit 头时将降级默认等待 2000 毫秒，但在快速测试时它至少等出了一定间隙
   }, 15000);
});
