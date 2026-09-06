import { describe, it, expect, vi } from 'vitest';
import { AssetStore } from '../../../src/lib/canvas/assets';

describe('AssetStore（沒有 Image／createImageBitmap 的環境）', () => {
  it('sprite 與 loadedHires 在載不到時回 null、不丟例外，onReady 不會被呼叫', () => {
    const onReady = vi.fn();
    const store = new AssetStore('/assets/sprite.webp', '/assets/icons', onReady);
    expect(store.sprite).toBeNull();
    expect(store.loadedHires('abc')).toBeNull();
    store.wantHires(['abc', 'def']);
    expect(onReady).not.toHaveBeenCalled();
  });

  // 控制者裁決（Task 4 併入原訂 Task 6 的範圍）：AssetStore 要多提供泛用單張圖快取
  // image()、以及給靜態層當快取 key 的 version。這裡驗的是「沒有 Image 建構子的環境」
  // 這個子集：兩者都要能安全地退化，不能因為環境缺失就丟例外或回傳假的已讀值。
  it("image('/x.webp') 在沒有 Image 的環境回 null、version 為 0", () => {
    const onReady = vi.fn();
    const store = new AssetStore('/assets/sprite.webp', '/assets/icons', onReady);
    expect(store.image('/x.webp')).toBeNull();
    expect(store.version).toBe(0);
  });

  // Task 12b（Task 12 報告 §5 ①）：「查已載好的」與「要求載入」是兩件事。painter 每一幀
  // 對每一顆節點問一次「載好了嗎」，那條路若會順手開始載，畫一幀就等於把整棵樹的 2× 圖
  // 全部要下來，`updateLod()` 依視錐挑的預載也就白做了。
  it('loadedHires() 只查不載：問過再多次也不會發出任何請求；wantHires() 才會', () => {
    const requested: string[] = [];
    class FakeImage {
      decoding = 'async';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(url: string) { requested.push(url); }
    }
    vi.stubGlobal('Image', FakeImage);
    try {
      const store = new AssetStore('/assets/sprite.webp', '/assets/icons', vi.fn());
      requested.length = 0;   // 建構子會先搶載 sprite，不算在這條測試裡
      expect(store.loadedHires('abc')).toBeNull();
      expect(store.loadedHires('abc')).toBeNull();
      expect(requested).toEqual([]);
      store.wantHires(['abc']);
      expect(requested).toEqual(['/assets/icons/abc.webp']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('wantHires 之後 version 仍為 0（沒有 Image 的環境裡沒有任何一張圖真的載好過）', () => {
    const onReady = vi.fn();
    const store = new AssetStore('/assets/sprite.webp', '/assets/icons', onReady);
    store.wantHires(['abc', 'def']);
    expect(store.version).toBe(0);
  });
});
