import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { Viewport, minReadableScale, effectiveDevicePx, HIRES_UPGRADE_AT, HIRES_DOWNGRADE_AT } from '../../src/lib/viewport';

function make() {
  const { document } = parseHTML('<html><body></body></html>');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as unknown as SVGGElement;
  svg.appendChild(g);
  return new Viewport(svg, g);
}

/**
 * fitTo() 現在完全依 svg 的 viewBox 屬性算縮放比例，不再碰
 * getBoundingClientRect()，所以測試環境（linkedom，沒有版面資訊）也能算出確定值。
 * 這裡用真正的 meta.viewBox 尺寸（3400×2850）建立 svg，讓下面幾個測試的手算
 * 預期值跟正式站台的實際比例一致。
 */
function makeForFitTo() {
  const { document } = parseHTML('<html><body></body></html>');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 3400 2850');
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as unknown as SVGGElement;
  svg.appendChild(g);
  return new Viewport(svg, g);
}

/**
 * linkedom 沒有實作 `getScreenCTM`，Viewport 在取不到時會退化為 1:1／位移 0（見 make()
 * 建立出的既有測試）。這裡手動掛一個假的 CTM 上去，模擬「畫布的 CSS 顯示尺寸與 viewBox
 * 使用者座標系比例不同、且畫布左上角不貼齊頁面原點」的情境。
 *
 * CTM 的 e/f（位移分量）一律給非零值：正式版面是側欄＋畫布＋詳情面板，畫布幾乎不可能
 * 貼齊頁面原點，e/f 在正式環境幾乎必然非零。用 e=f=0 的假 CTM 測不出「換算漏減 e/f」
 * 這種 bug——差值運算（pan 用的 movementX/Y）會讓 e/f 這個常數項自動抵消，只有用絕對
 * 座標當錨點的 zoomAt() 才會露餡。這正是上一輪審查抓到的 Critical：`screenToUserCtm`
 * 曾經只回傳 a/d、`zoomAt` 沒有先減掉 e/f，而測試當時的假 CTM 剛好都是 e=f=0，
 * 沒能抓到。往後這個檔案裡的假 CTM 一律帶非零 e/f，避免同一類 bug 再犯而測試繞過去。
 */
function makeWithCtm(ctm: { a: number; d: number; e: number; f: number }) {
  const { document } = parseHTML('<html><body></body></html>');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as unknown as SVGGElement;
  svg.appendChild(g);
  // getScreenCTM 的回傳型別是 DOMMatrix，但測試只需要 a/d/e/f 四個分量（b/c 是旋轉／
  // 斜切，這個畫布的縮放平移不會用到），用 unknown 中介轉型而不是 any，避免補齊整份
  // DOMMatrix 介面的無意義欄位。
  const fakeCtm = { ...ctm, b: 0, c: 0 } as unknown as DOMMatrix;
  Object.assign(svg, { getScreenCTM: () => fakeCtm });
  return new Viewport(svg, g);
}

describe('Viewport', () => {
  it('平移累加位移', () => {
    const v = make();
    v.pan(10, 20);
    v.pan(5, -5);
    expect(v.transform).toBe('translate(15,15) scale(1)');
  });
  it('縮放夾在 0.2 與 8 之間', () => {
    const v = make();
    v.zoomAt(10, 0, 0);
    expect(v.scale).toBe(8);
    v.zoomAt(0.001, 0, 0);
    expect(v.scale).toBe(0.2);
  });
  it('以游標為錨點縮放時，錨點下的內容座標不變', () => {
    const v = make();
    v.zoomAt(2, 100, 100);
    expect(v.transform).toBe('translate(-100,-100) scale(2)');
  });
  describe('fitTo：用 viewBox 尺寸（使用者座標）算縮放比例，不用 getBoundingClientRect', () => {
    // 以下數值都用 node -e 手算過（見 task-14-report.md），viewBox 固定是
    // '0 0 3400 2850'（makeForFitTo），pad 沿用預設值 0.9。

    it('傳入整個 viewBox 範圍時，scale 應為 1 * pad（未夾到上下限）', () => {
      const v = makeForFitTo();
      v.fitTo([0, 0, 3400, 2850]);
      // min(3400/3400, 2850/2850) * 0.9 = 1 * 0.9 = 0.9
      expect(v.scale).toBeCloseTo(0.9, 6);
      // x = 3400/2 - 0.9*(0+3400/2) = 1700 - 1530 = 170
      // y = 2850/2 - 0.9*(0+2850/2) = 1425 - 1282.5 = 142.5
      expect(v.transform).toBe('translate(170,142.5) scale(0.9)');
    });

    it('傳入某分支（nature）的真實 bounds 時，scale 與 translate 符合手算預期值', () => {
      // meta.bounds.nature = [1220.82, 244.18, 990.6099999999999, 1135.72]
      // raw = min(3400/990.61, 2850/1135.72) * 0.9 ≈ 2.258479202620364
      // 上限改成 8 之後，raw 沒被夾住，這條測試現在驗證的是「未夾制的真實分支縮放值」
      // （五個分支的 raw 都落在 2.17～2.36，全數小於 8，細節見報告）
      // x = 1700 - 2.258479202620364*(1220.82 + 990.6099999999999/2) = -2175.8326215968723
      // y = 1425 - 2.258479202620364*(244.18 + 1135.72/2) = -408.9754516958403（node -e 算出的原始浮點值）
      const v = makeForFitTo();
      v.fitTo([1220.82, 244.18, 990.6099999999999, 1135.72]);
      expect(v.scale).toBeCloseTo(2.258479202620364, 9);
      expect(v.transform).toBe('translate(-2175.8326215968723,-408.9754516958403) scale(2.258479202620364)');
    });

    it('bounds 極小時 scale 被夾在上限 8', () => {
      const v = makeForFitTo();
      v.fitTo([0, 0, 1, 1]);
      // raw = min(3400/1, 2850/1) * 0.9 = 2565 → 夾到 8
      expect(v.scale).toBe(8);
      // x = 1700 - 8*(0+0.5) = 1696；y = 1425 - 8*0.5 = 1421
      expect(v.transform).toBe('translate(1696,1421) scale(8)');
    });

    it('bounds 極大時 scale 被夾在下限 0.2', () => {
      const v = makeForFitTo();
      v.fitTo([0, 0, 100000, 100000]);
      // raw = min(3400/100000, 2850/100000) * 0.9 = 0.0285 * 0.9 ≈ 0.02565 → 夾到 0.2
      expect(v.scale).toBe(0.2);
      // x = 1700 - 0.2*(0+50000) = -8300；y = 1425 - 0.2*50000 = -8575
      expect(v.transform).toBe('translate(-8300,-8575) scale(0.2)');
    });

    it('svg 沒有有效 viewBox 屬性時丟出明確錯誤，而不是悄悄退化猜一個值', () => {
      const v = make(); // make() 沒有設 viewBox
      expect(() => v.fitTo([0, 0, 100, 100])).toThrow(/viewBox/);
    });
  });
  it('pan 用 getScreenCTM 的縮放分量換算成使用者座標，位移分量 e/f 不影響結果（防止換算方向寫反）', () => {
    // CTM {a:2, d:2, e:100, f:50}：螢幕縮放比為 2、且畫布左上角在頁面上偏移 (100,50)。
    // pan() 吃的是「差值」（movementX/Y），e/f 這種常數項在差值運算裡會自動抵消
    // （(s2-e)/a - (s1-e)/a = (s2-s1)/a），所以就算 CTM 帶了非零位移，移動 10 個
    // 螢幕 px 依然只換算成 5 個使用者座標單位——這條測試同時證明 pan() 不需要、
    // 也沒有誤用到 e/f。
    const v = makeWithCtm({ a: 2, d: 2, e: 100, f: 50 });
    v.pan(10, 0);
    expect(v.transform).toBe('translate(5,0) scale(1)');
  });

  it('zoomAt 用完整的 CTM 反解（含 e/f 位移）換算錨點，縮放前後錨點下的內容座標不變（Critical 回歸測試）', () => {
    // 這是審查抓到的 Critical bug 的回歸測試：舊版換算只除以 CTM 的 a/d、沒有先減掉
    // e/f，會讓 zoomAt() 在「畫布不貼齊頁面原點」（側欄＋畫布＋詳情面板的正式版面下
    // 幾乎必然如此）時算錯錨點，縮放時畫面會朝畫布在頁面上的偏移方向飄走。
    //
    // CTM {a:2, d:2, e:100, f:50}，螢幕錨點 (300, 250)：
    //   正確的使用者座標 = ((300-100)/2, (250-50)/2) = (100, 100)
    //   若漏減 e/f（舊 bug）：會誤算成 (300/2, 250/2) = (150, 125)
    const ctm = { a: 2, d: 2, e: 100, f: 50 };
    const v = makeWithCtm(ctm);

    // 從第一原理重新算一次「螢幕錨點 (300,250) 目前對應到哪個內容座標」：
    // 先用正確的 CTM 反解公式把螢幕座標換成使用者座標，再用 v 目前的 transform
    // （translate(x,y) scale(s)）反推使用者座標對應的內容座標 (ux-x)/s。這段刻意不呼叫
    // Viewport 的內部方法，只讀公開的 `.transform` 字串，才不會跟被測程式碼共用同一個
    // 潛在錯誤、測出「自己證明自己對」的假陽性。
    const contentUnderAnchor = (): { x: number; y: number } => {
      const ux = (300 - ctm.e) / ctm.a;
      const uy = (250 - ctm.f) / ctm.d;
      const m = /^translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)$/.exec(v.transform);
      if (!m) throw new Error(`transform 格式不符預期：${v.transform}`);
      const [, xStr, yStr, sStr] = m;
      return { x: (ux - Number(xStr)) / Number(sStr), y: (uy - Number(yStr)) / Number(sStr) };
    };

    const before = contentUnderAnchor();
    expect(before).toEqual({ x: 100, y: 100 });

    v.zoomAt(2, 300, 250);

    const after = contentUnderAnchor();
    expect(after).toEqual(before);
    // 同時鎖定精確的 transform 值，避免日後只靠上面的不變性斷言、又用另一種巧合方式
    // 通過測試：ux=uy=100 跟舊版「以游標為錨點縮放」測試的 zoomAt(2,100,100) 是同一組
    // 數字，正確答案應該一樣是 translate(-100,-100) scale(2)；若又漏減 e/f，
    // 會得到錯誤的 translate(-150,-125) scale(2)。
    expect(v.transform).toBe('translate(-100,-100) scale(2)');
  });
});

describe('minReadableScale（task-17/18 裁決：最小可讀縮放下限，純函式）', () => {
  // 公式推導、變數意義見 src/lib/viewport.ts 的函式註解。task-18 第二輪修正把函式簽章從
  // 「只吃容器寬度」改成「容器寬高都要」——preserveAspectRatio 預設值 xMidYMid meet 是
  // 「寬高兩個縮放比取較小值」，容器與 viewBox 的長寬比不同時，到底是寬還是高在限制縮放
  // 要看實際尺寸，只算寬度在手機直向容器（窄且高）剛好蒙混過關，桌機橫向容器（寬且扁，
  // 比 viewBox 更扁）就會算錯（見下面「1280x610 桌機」那條，這是 task-18 修正的核心案例）。
  // 以下三個是這一組純函式測試自己的**固定樣本**，不是站台當下的實際值（2026-08-18 換版面後
  // 正本的 viewBox 是 2000x1700、骰子圖示 46 單位寬）。minReadableScale() 是純算式，換成真實
  // 資料只會讓期望值跟著資料浮動、失去「這個算式算對了沒」的意義，所以刻意釘死在一組容易手算
  // 的數字上。要驗「站台實際用的值有沒有接對」，那是 tests/scripts/tree-canvas.test.ts 的事。
  const VIEWBOX_WIDTH = 3400;
  const VIEWBOX_HEIGHT = 2850;
  const DICE_ICON_WIDTH_UNITS = 48;

  it('390x800 手機直向（寬度限制縮放）：最小可讀縮放約 5.7×～5.9×（沿用 task-17 裁決原文手算約 5.7×，目標 32px）', () => {
    const s = minReadableScale(390, 800, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, DICE_ICON_WIDTH_UNITS, 32);
    expect(s).toBeGreaterThan(5.5);
    expect(s).toBeLessThan(6.0);
    // 精確值另外鎖死，避免公式日後被意外改動卻沒被上面的寬鬆範圍抓到。手機直向容器夠高
    // （800 遠大於 390*2850/3400≈326.9，也就是「寬度會是限制」的臨界高度），所以這個數字
    // 跟舊版只算寬度時完全一樣，不是巧合。
    expect(s).toBeCloseTo(5.811965811965812, 9);
  });

  it('768x1024 平板直向（寬度限制縮放）：最小可讀縮放約 2.95×（沒有裁決原文數字可核對，純粹補一個中間寬度的樣本點，目標 32px）', () => {
    const s = minReadableScale(768, 1024, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, DICE_ICON_WIDTH_UNITS, 32);
    expect(s).toBeCloseTo(2.9513888888888884, 9);
  });

  it('1280x610 桌機橫向（高度限制縮放，task-18 修正的核心案例）：最小可讀縮放約 2.34×（目標 24px）', () => {
    const s = minReadableScale(1280, 610, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, DICE_ICON_WIDTH_UNITS, 24);
    // 用高度換算（610/2850≈0.214），不是舊 bug 版本用寬度換算（1280/3400≈0.376）——若還在
    // 用舊公式，這裡會因為每單位 px 數被高估 76% 而算出遠小於正確值的下限（約 1.33x，
    // 對應到 fitTo() 給的 0.9x 桌機初始視角，仍然低於下限但幅度小很多，等於沒修好）。
    expect(s).toBeCloseTo(2.3360655737704916, 9);
  });

  it('容器高度比 viewBox 更扁（寬高比大於 viewBox）時，改由高度限制縮放，不是寬度', () => {
    // 兩個容器寬度相同（1280），只改高度：矮的（610，桌機常見比例）比高的（2850，正好跟
    // viewBox 一樣高、寬度轉為限制縮放的那個）需要更大的縮放下限——矮容器的高度限制更緊。
    const short = minReadableScale(1280, 610, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, DICE_ICON_WIDTH_UNITS, 24);
    const tall = minReadableScale(1280, 2850, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, DICE_ICON_WIDTH_UNITS, 24);
    expect(short).toBeGreaterThan(tall);
  });

  it('容器越寬（同高度），需要的縮放下限越小（同一顆圖示在大螢幕上不用放大也看得清）', () => {
    const mobile = minReadableScale(390, 800, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, DICE_ICON_WIDTH_UNITS, 32);
    const desktop = minReadableScale(1200, 800, VIEWBOX_WIDTH, VIEWBOX_HEIGHT, DICE_ICON_WIDTH_UNITS, 32);
    expect(mobile).toBeGreaterThan(desktop);
  });
});

describe('effectiveDevicePx（高解析升級的真正判準）', () => {
  // viewBox 固定 2000×1700（見 CLAUDE.md 的不變量）。
  const VB: [number, number] = [2000, 1700];
  const px = (w: number, h: number, scale: number, dpr: number) =>
    effectiveDevicePx(w, h, VB[0], VB[1], scale, dpr);

  it('1280×720 桌機 dpr1：初始視角不該升級——舊版在這裡白抓了 213 張圖', () => {
    // 畫布高 595（1280×720 扣掉 nav 與 footer），可讀性下限把 scale 拉到約 1.49。
    const v = px(1280, 595, 1.49, 1);
    expect(v).toBeCloseTo(0.52, 1);
    expect(v).toBeLessThan(HIRES_UPGRADE_AT);
  });

  it('2560×1440 dpr2：該升級——舊版在這裡一張都沒升', () => {
    const v = px(2560, 1315, 1.49, 2);
    expect(v).toBeGreaterThan(HIRES_UPGRADE_AT);
  });

  it('Pixel 7 手機（412×678 dpr2.625，分支視角 scale≈5.5）：該升級', () => {
    expect(px(412, 678, 5.5, 2.625)).toBeGreaterThan(HIRES_UPGRADE_AT);
  });

  it('桌機放大之後就會跨過門檻', () => {
    expect(px(1280, 595, 1.49, 1)).toBeLessThan(HIRES_UPGRADE_AT);
    expect(px(1280, 595, 4, 1)).toBeGreaterThan(HIRES_UPGRADE_AT);
  });

  it('遲滯：升級門檻高於降級門檻，避免在邊界反覆抖動', () => {
    expect(HIRES_UPGRADE_AT).toBeGreaterThan(HIRES_DOWNGRADE_AT);
  });

  it('viewBox 壞掉時回 0，不會變成 NaN 一路傳下去', () => {
    expect(effectiveDevicePx(1280, 595, 0, 1700, 2, 1)).toBe(0);
  });
});
