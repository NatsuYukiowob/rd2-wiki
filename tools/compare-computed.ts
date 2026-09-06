/**
 * 「這次改動不該改變畫面」的驗收工具（2026-08-26，CSS 拆檔時建的）。
 *
 * 為什麼不用截圖像素比對：CLAUDE.md 已經記過「動版面要用幾何斷言驗收，不是看截圖」。
 * 像素比對只告訴你「有差」，這支直接告訴你「哪個元素的哪個屬性從什麼變成什麼」。
 *
 * 為什麼不比對 dist/_astro/*.css：拆檔之後 chunk 數量與檔名都會變，比不到同一個檔；
 * 就算把每頁的 stylesheet 依 <link> 順序串起來比規則序列，順序保留率也只有 19–31%
 * （檔案對照表本身是交錯的），「順序應該一致」這個條件寫不出來。
 *
 * 用法：兩個 port 各服務一份 dist，然後
 *   npm run compare -- http://localhost:4501 http://localhost:4502
 *
 * 開跑前會先比對兩端的 CSS 產物指紋（見 cssFingerprint()）：兩份 dist 若剛好指紋相同
 * （多半是兩個 port 其實指向同一份 dist，或忘了把 before 換成另一份 build），會直接
 * exit 2 並拒絕往下跑——不然「0 差異」既可能是真的沒有回歸，也可能是根本沒比到兩份
 * 不同的東西，兩者在輸出上完全分不出來（2026-08-26 code review 補的）。
 */
import { chromium, type Page } from 'playwright';

/** 要比的屬性。刻意逐條列出而不是掃全部 computed style：後者含大量衍生值，
 *  一個字型 fallback 的差異會噴出上千行雜訊，反而看不到真的回歸。
 *
 *  `inset`（2026-08-26 code review 補的）：sticky／fixed 元素的偏移量全部走這四個
 *  logical-adjacent 屬性（`top`/`right`/`bottom`/`left` 的合寫），沒有它時偏移量改變
 *  不會動到 width/height/margin 任何一項，比對工具一律回報 0 差異。實測案例：
 *  `#site-nav` 的 `position:sticky; inset` 錯位、`/dice` 的 `.filters`、
 *  `/tree` 的 `#detail`（`position:fixed`）都是這樣被 0 差異蓋過去的。 */
const PROPS = [
  'display', 'position', 'visibility', 'opacity', 'z-index', 'overflow-x', 'overflow-y',
  'width', 'height', 'inset', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'color', 'background-color', 'background-image', 'box-shadow', 'outline-width',
  'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing',
  'text-align', 'text-decoration-line', 'white-space', 'text-transform',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'transform', 'transition-duration', 'transition-property',
  'animation-name', 'animation-duration', 'animation-delay',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
] as const;

/** ::before／::after 專用、較短的屬性清單（不套用全部 59 個 PROPS，否則每個元素乘三份
 *  資料量會膨脹三倍）。content 是重點：沒有偽元素時 Chromium 讀出來就是 'none'，這條
 *  本身就是「有沒有東西被畫出來」的訊號。其餘挑的是絕對定位覆蓋層最常出包的幾項——
 *  位置、尺寸、顏色、透明度、變形。
 *
 *  背景（2026-08-26 code review 補的）：chrome.css 裡 `#site-nav [aria-current='page']::before`
 *  （目前分頁的金線）、`#site-nav .nav-menu > summary::after`（下拉箭頭）等三處都是純
 *  ::before/::after 覆蓋層，不佔真實 DOM 節點、不影響任何元素的 box model——原本的
 *  snapshot() 只走 el.children、只取 getComputedStyle(el)，完全不取樣偽元素，這三個
 *  規則不管怎麼壞掉都會被判定 0 差異。 */
const PSEUDO_PROPS = [
  'content', 'color', 'background-color', 'width', 'height', 'transform',
  'position', 'inset', 'top', 'left', 'opacity',
] as const;

/**
 * ⚠️ **每個載入獨立樣式檔的頁面都要在這裡有代表**，否則改動那個檔時這支工具會回報 0 差異
 * 而它其實一個相關頁面都沒開過。`/tactic` 與 `/boss` 是 2026-09-06 補的：它們是 `battle.css`
 * 的唯二消費者（當時），而這份清單從 2026-08-26 建立起就沒收過它們——動 `battle.css` 時
 * 跑這支等於什麼都沒比。
 *
 * `/rift-shop`（同樣吃 `battle.css`）**刻意不收**：這支要比的是「同一個頁面在兩份 dist 上
 * 長不長得一樣」，而新頁面在 before 那一側是 404，加進來只會讓每次比對都噴一頁導覽失敗。
 * 哪天它不再是新頁面（下一次改 CSS 時）再補進來。
 */
const PAGES = ['/', '/tree', '/dice', '/guide/status', '/board', '/sim', '/about', '/tactic', '/boss'];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'pixel7', width: 412, height: 915 },
];

/** 尾斜線正規化：Astro 靜態頁輸出的是 `/tree/index.html`，`page.url()` 與頁面自己烤進去的
 *  canonical 可能帶或不帶尾斜線（`trailingSlash` 設定），比對前先剝乾淨，避免這個維度本身
 *  的差異被誤判成導覽失敗。根路徑 `/` 剝完是空字串，補回 `/`。 */
function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * 導覽結果驗證（2026-08-26 code review 補的）。
 *
 * 原本 `snapshot()` 只 `await page.goto(...)`，不檢查 `response.status()` 也不比對最終網址。
 * 實測重現：用 `npx serve -s`（SPA rewrite 模式）服務 dist，伺服器對任何不存在的路徑一律
 * 回 200 並直接吐出首頁的 `index.html`——**這是伺服器端的內容置換，不是 HTTP redirect**，
 * `resp.status()` 仍是 200、`page.url()` 也仍停在原本要求的那個路徑，這兩者都看不出「其實拿到
 * 的是別頁的內容」。七個路徑全部被換成首頁時，兩邊比對照樣印「0 個差異」——這支工具存在的
 * 理由（「0 差異必須代表某件事」）就這樣靜默蒸發了。
 *
 * 真正戳得穿的是**頁面自己烤進 HTML 的 canonical**（見 `Base.astro` 的 `pageUrl`：
 * `new URL(Astro.url.pathname, Astro.site).href`，每個靜態頁在建置期就固定指向自己的路徑）：
 * 內容其實是首頁時，canonical 會照實說「這是首頁」而不是被要求的那個路徑。
 *
 * status 與網址列兩條檢查仍然留著，各自接住不同的失效模式：`resp.ok()` 接住單邊真的 404；
 * 網址列接住「有真的 HTTP redirect，但最終落點不對」（`trailingSlash` 設定改變、頁面被搬到
 * 別的路徑）。三條合起來才涵蓋「單邊 404」「頁面改名」「SPA rewrite」這整族失效模式——
 * 任一條不符就印清楚的錯誤並直接 `exit(2)`，不繼續往下比。
 */
async function assertNavigated(
  page: Page,
  resp: Awaited<ReturnType<Page['goto']>>,
  url: string,
): Promise<void> {
  const expectedPath = normalizePath(new URL(url).pathname);

  if (!resp || !resp.ok()) {
    console.error(`導覽失敗：${url} 回應 ${resp ? resp.status() : '(無回應)'}`);
    process.exit(2);
  }

  const actualUrlPath = normalizePath(new URL(page.url()).pathname);
  if (actualUrlPath !== expectedPath) {
    console.error(`導覽結果不對：要求 ${url}，最終網址卻落在 ${page.url()}`);
    process.exit(2);
  }

  const canonicalHref = await page.evaluate(
    () => document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
  );
  if (!canonicalHref) {
    console.error(
      `導覽結果可疑：${url} 沒有 <link rel="canonical">（PAGES 裡沒有 noIndex 頁，正常都該有）`,
    );
    process.exit(2);
  }
  const canonicalPath = normalizePath(new URL(canonicalHref).pathname);
  if (canonicalPath !== expectedPath) {
    console.error(`導覽結果不對：要求 ${url}，頁面自己的 canonical 卻說是 ${canonicalHref}`);
    console.error(
      '這通常是 SPA rewrite（例如 npx serve -s）把這個路徑的內容換成了別頁的 index.html——' +
        '網址列與 HTTP status 都看不出來（伺服器端置換不是 redirect），canonical 是唯一戳得穿的訊號。',
    );
    process.exit(2);
  }
}

/** 每個元素最多三個路徑鍵：body>div[0]>p[3]（本體）、同一個路徑加上 ::before／::after
 *  （偽元素）。本體用索引而不是 class，因為 class 正是這次可能改動的東西，拿它當鍵會讓
 *  比對自己失效。偽元素固定跟著本體一起收，兩邊快照的鍵集合天生對稱（每個本體鍵必然
 *  伴隨兩個偽元素鍵），所以「只存在於 b」的新鍵只可能來自真的新增的 DOM 元素，不會被
 *  偽元素的取樣方式污染。 */
async function snapshot(page: Page, url: string): Promise<Map<string, Record<string, string>>> {
  const resp = await page.goto(url, { waitUntil: 'networkidle' });
  await assertNavigated(page, resp, url);
  const raw = await page.evaluate(
    (args: { props: readonly string[]; pseudoProps: readonly string[] }) => {
      const { props, pseudoProps } = args;
      const out: [string, Record<string, string>][] = [];
      const walk = (el: Element, path: string) => {
        const cs = getComputedStyle(el);
        const rec: Record<string, string> = {};
        for (const p of props) rec[p] = cs.getPropertyValue(p);
        out.push([path, rec]);

        for (const pseudo of ['::before', '::after']) {
          const pcs = getComputedStyle(el, pseudo);
          const prec: Record<string, string> = {};
          for (const p of pseudoProps) prec[p] = pcs.getPropertyValue(p);
          out.push([`${path}${pseudo}`, prec]);
        }

        let i = 0;
        for (const child of Array.from(el.children)) {
          walk(child, `${path}>${child.tagName.toLowerCase()}[${i++}]`);
        }
      };
      walk(document.body, 'body');
      return out;
    },
    { props: PROPS as unknown as string[], pseudoProps: PSEUDO_PROPS as unknown as string[] },
  );
  return new Map(raw);
}

/** 偽元素鍵在兩邊都沒有實際內容（content: none，Chromium 對「沒有這個偽元素」的回報方式）
 *  時，代表這個位置本來就沒有 ::before/::after 在畫東西，continue 純粹是為了不要讓全頁
 *  每個元素乘二的空資料洗版輸出。只要有一邊不是 none——不管是消失、新增、還是內容變了——
 *  一律不能略過，那正是最該報的差異。 */
function isEmptyPseudo(key: string, rec: Record<string, string> | undefined): boolean {
  return (key.endsWith('::before') || key.endsWith('::after')) && rec?.content === 'none';
}

/**
 * build 指紋：**全部 `PAGES`**（不是只有首頁）實際載入的樣式表聯集，每個樣式表折成一個
 * 字串鍵：外部連結（`<link rel=stylesheet>`）用檔名（Astro 內容雜湊命名，兩份不同的 build
 * 幾乎必然不同），**inline `<style>` 沒有檔名可用，改用內容本身的長度＋簡單雜湊**（`page.evaluate()`
 * 裡直接算，不能拆成外面的函式呼叫——瀏覽器端只拿得到序列化後的那個 callback 本身，
 * 呼叫不到 Node 這一側定義的其他函式）。
 *
 * 為什麼要有這一步：這支工具本身無法分辨「兩份不同的 build 比出來剛好 0 差異」與
 * 「其實兩個 port 指向同一份 dist，跟自己比當然 0 差異」——這個 repo 已經發生過「以為收掉
 * server 其實沒收」的事，兩種情況在 diff 輸出上完全長一樣，只有指紋能分辨。
 *
 * ⚠️ **一定要走全部 PAGES，不能只看首頁。** 首頁只載 Base 五檔合併出的那個共用 chunk，
 * `/tree`／`/dice`／`/board`／`/sim` 各自額外載的頁面級檔（`detail`／`canvas`／`dice`／
 * `board`）完全不會出現在首頁的 `document.styleSheets` 裡。
 *
 * ⚠️ **一定要收 inline `<style>`，不能只收 `<link>` 的 href。** 實測：Astro 的
 * `inlineStylesheets: 'auto'`（預設）會把小到一個門檻以下的頁面級 CSS chunk 直接內聯成
 * `<style>` 標籤而不是外部連結——`/board` 的 `board.css`、`/sim` 頁面級的那塊都是這樣，
 * `document.styleSheets` 裡對應項目的 `.href` 是 `null`。只收 `href` 的話，任何只改這幾個
 * 被內聯的檔案的 PR，指紋會完全不變、被這條檢查誤判成「兩個 port 指向同一份 dist」而
 * exit 2，而真實差異完全沒機會被檢查到——這個誤判會在接下來任何只動
 * `detail.css`／`canvas.css`／`dice.css`／`board.css` 的 PR 上復發（複審實測案例：只改
 * `board.css` 一行邊框寬度，純看 `<link>` href 的版本仍然誤判成同一份 dist）。
 *
 * ⚠️ **已知限制：production build 會 minify 掉全部註解**（實測 `astro build` 產物裡
 * 0 個 `/*`），所以「兩份 build 只差在 CSS 檔案裡的註解」仍然會被判定成同一份指紋——
 * 這條檢查抓的是「你是不是忘了換一份完全沒改過任何選擇器/宣告的 dist」，不是萬能的
 * build 差異偵測。
 */
async function cssFingerprint(page: Page, origin: string): Promise<string[]> {
  const items = new Set<string>();
  for (const path of PAGES) {
    await page.goto(origin + path, { waitUntil: 'networkidle' });
    const parts = await page.evaluate(() => {
      const out: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.href) {
          out.push(sheet.href.split('/').pop()!);
        } else {
          // inline <style>：沒有內容雜湊檔名可用（Astro 的 inlineStylesheets: 'auto' 把
          // 小到門檻以下的頁面級 CSS chunk 直接內聯，/board、/sim 的頁面級樣式都是這樣），
          // 只能自己對內容算一個雜湊——不需要密碼學等級，只需要「內容變了值就幾乎必然變」，
          // 手寫一個 32-bit 滾動雜湊（同 Java String.hashCode() 的公式）。
          const text = (sheet.ownerNode as HTMLStyleElement | null)?.textContent ?? '';
          let hash = 0;
          for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
          out.push(`inline:${text.length}:${hash}`);
        }
      }
      return out;
    });
    for (const p of parts) items.add(p);
  }
  return [...items].sort();
}

const [before, after] = process.argv.slice(2);
if (!before || !after) {
  console.error('用法: npm run compare -- <beforeURL> <afterURL>');
  process.exit(2);
}

const browser = await chromium.launch();

const fpPage = await browser.newPage();
const beforeFingerprint = await cssFingerprint(fpPage, before);
const afterFingerprint = await cssFingerprint(fpPage, after);
await fpPage.close();

if (
  beforeFingerprint.length > 0 &&
  JSON.stringify(beforeFingerprint) === JSON.stringify(afterFingerprint)
) {
  console.error('build 指紋檢查失敗：before 與 after 全部頁面載入的 CSS 檔案聯集完全相同：');
  console.error(`  ${beforeFingerprint.join(', ')}`);
  console.error(
    '可能兩個 port 指向同一份 dist（忘了把 before 換成另一份 build，或兩邊其實服務同一個目錄）。',
  );
  console.error('這種情況下「0 個差異」不代表沒有回歸，只代表你根本沒比到兩份不同的東西。');
  await browser.close();
  process.exit(2);
}
console.log(`build 指紋檢查通過（before/after 不同）：`);
console.log(`  before: ${beforeFingerprint.join(', ') || '(無 <link> 樣式表)'}`);
console.log(`  after:  ${afterFingerprint.join(', ') || '(無 <link> 樣式表)'}`);

let diffs = 0;
let elements = 0;

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  // tsx 用 esbuild 轉譯時固定開 keepNames，會把 walk 包成 __name(walk, "walk")；
  // page.evaluate 靠 toString() 把函式序列化送進瀏覽器，那個 __name helper 不會跟著過去，
  // 於是 ReferenceError。這裡補一個無害的 shim（照抄 __name 的行為：原樣回傳函式）。
  await page.addInitScript(() => {
    (window as unknown as { __name?: (fn: unknown) => unknown }).__name = (fn) => fn;
  });
  for (const path of PAGES) {
    const a = await snapshot(page, before + path);
    const b = await snapshot(page, after + path);
    elements += a.size;
    if (a.size !== b.size) {
      console.log(`${path} ${vp.name}  元素數量不同: ${a.size} -> ${b.size}`);
      diffs++;
    }
    for (const [key, ra] of a) {
      const rb = b.get(key);
      if (!rb) {
        if (isEmptyPseudo(key, ra)) continue;
        console.log(`${path} ${vp.name}  ${key}  消失了`);
        diffs++;
        continue;
      }
      if (isEmptyPseudo(key, ra) && isEmptyPseudo(key, rb)) continue;
      const props = key.endsWith('::before') || key.endsWith('::after') ? PSEUDO_PROPS : PROPS;
      for (const p of props) {
        if (ra[p] !== rb[p]) {
          console.log(`${path} ${vp.name}  ${key}  ${p}: ${ra[p]} -> ${rb[p]}`);
          diffs++;
        }
      }
    }
    for (const [key, rb] of b) {
      if (a.has(key)) continue;
      if (isEmptyPseudo(key, rb)) continue;
      console.log(`${path} ${vp.name}  ${key}  新增了`);
      diffs++;
    }
    console.log(`${path} ${vp.name}: ${a.size} 個取樣點（${a.size / 3} 個元素）`);
  }
  await ctx.close();
}
await browser.close();

// a 的鍵集合是「本體 ＋ ::before ＋ ::after」，每個真的 DOM 元素固定佔 3 個鍵，
// 所以「元素數」要除 3——不除的話「總計 N 個元素」其實是 N/3 個元素乘三個取樣鍵，
// 這個數字會被貼進後續 PR 的驗收紀錄，用字要準。
console.log(`\n總計 ${elements} 個取樣點（${elements / 3} 個元素），${diffs} 個差異`);
process.exit(diffs === 0 ? 0 : 1);
