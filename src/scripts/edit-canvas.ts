// 線上編輯器的載入與渲染骨架：讀正本 SVG（複製自 /data，見 tools/build-data.ts）＋三份
// 輔助資料，畫成 SVG 掛進 #edit-canvas-host。後續任務（表單編輯、圖示/關鍵字新增、驗證、
// 下載）都疊在 editorState 與 rerender() 之上，唯一的重繪路徑固定是
// svgText → buildTreeDataWith → renderTree（見 rerender() 的說明），不另寫第二套。
import rawTreeMeta from '../generated/tree.json';
import { applyFieldEdits, renderEditForm, type FieldEdits } from '../components/EditForm.js';
import { renderValidation } from '../components/ValidationPanel.js';
import { buildTreeDataWith } from '../lib/build-tree.js';
import { estimateGzipBytes } from '../lib/budget.js';
import { parseXmlInBrowser } from '../lib/dom.js';
import { renderTree } from '../lib/render.js';
import { locateNodeBlocks, replaceNode } from '../lib/svg-edit.js';
import { emitNodeBlock, parseNodeBlock, type NodeBlock } from '../lib/svg-emit.js';
import { validateWith, type IconSource } from '../lib/validate-rules.js';
import { Viewport } from '../lib/viewport.js';
import type { TreeData, TreeNode, UnlockVia } from '../lib/types.js';

// tree.json 是建置期產物，結構保證符合 TreeData，但 TS 對 JSON 匯入的型別推論會把
// sprite.index 每一格的 tuple（[cx, cy, cw, ch]）寬鬆推成 number[]，跟 BuildOpts 要的
// tuple 型別對不上，因此這裡用雙重斷言而非 any——跟 tree-canvas.ts 讀同一份 tree.json
// 時的做法一致（見該檔開頭的說明）。
const treeMeta = rawTreeMeta as unknown as TreeData;

/** 編輯器的全域狀態。dirty 記的是被改過的節點 id，用來算狀態列的「已修改 N 處」。 */
export const editorState = {
  svgText: '',
  original: '',
  dirty: new Set<string>(),
  newIcons: new Map<string, Uint8Array>(),
  newKeywords: [] as string[],
  keywords: [] as string[],
  iconHashes: new Set<string>(),
};

type UnlockExceptions = Record<string, { unlockVia: UnlockVia }>;

// 最近一次成功渲染所用的節點清單，供 bindNodeClicks() 查完整欄位用（id → TreeNode）。
// 不放進 editorState（那個物件的形狀是跨任務 DOM 契約，見簡報，不能隨意加欄位）：這裡純粹
// 是「目前畫面上畫的是哪份資料」的內部快取，Task 12 的表單渲染會需要同一份查表，屆時再决定
// 要不要把這個查表邏輯抽出去共用。rerender() 失敗時刻意不更新它——連畫面都保留上一輪的了，
// 查表跟著保留上一輪的資料才是一致的（見 rerender() 的 try/catch 說明）。
let currentNodesById = new Map<string, TreeNode>();

// 目前這一輪畫面對應的 Viewport 實例（供 bindViewportInteractions() 的拖曳/滾輪事件
// handler 讀取）。跟 currentNodesById 是同一個理由：rerender() 每次都用 replaceChildren()
// 整批換掉 #edit-canvas-host 底下的 <svg>，舊的 Viewport 綁的是已經被丟棄的 <svg>／
// <g id="viewport">，不能再用；必須是可重新指派的模組級變數（不是綁死的 const），
// 事件 handler 每次觸發時讀的都是「當下」這個變數的值，才會操作到最新一輪畫面的座標系。
// rerender() 失敗時同樣不更新它，理由跟 currentNodesById 一致：畫面沒換，操作對象也不該換。
let currentViewport: Viewport | null = null;

// boot() 讀一次就固定不變的 unlockExceptions，之後 rerender()／runValidation() 都要用
// 同一份（buildTreeDataWith 的 BuildOpts 需要它）。放模組級變數而不是每次呼叫端各自傳
// 一份，理由跟 currentNodesById／currentViewport 一樣：這是「目前這個編輯 session」共用的
// 唯一一份設定，不是每次呼叫都可能不同的參數。
let currentUnlockExceptions: UnlockExceptions | null = null;

// 目前表單正在編輯哪個節點（bindNodeClicks() 選取節點時設定，bindFormEdits() 的
// focusout 委派讀它來決定要把欄位改動套進哪個節點）。跟 currentNodesById／currentViewport
// 同一類模組級狀態：表單本身沒有把「正在編輯誰」編碼進 DOM（data-field 只標記欄位名稱，
// 不重複標記節點 id），需要一個地方記錄。
let currentEditId: string | null = null;

async function boot(): Promise<void> {
  const [svgText, keywords, unlockExceptions, iconHashes] = await Promise.all([
    fetch('/data/dice-tree.svg').then(r => r.text()),
    fetch('/data/keywords.json').then(r => r.json()),
    fetch('/data/unlock-exceptions.json').then(r => r.json()) as Promise<UnlockExceptions>,
    fetch('/data/icon-hashes.json').then(r => r.json()) as Promise<string[]>,
  ]);
  editorState.svgText = svgText;
  editorState.original = svgText;
  editorState.keywords = keywords;
  editorState.iconHashes = new Set<string>(iconHashes);
  currentUnlockExceptions = unlockExceptions;
  rerender();
  bindNodeClicks();
  bindViewportInteractions();
  bindFormEdits();
}

/**
 * 唯一的重繪路徑：svgText → buildTreeDataWith → renderTree。刻意重用站台既有的 renderer
 * 而不是另寫一套，保證「編輯器裡看到的」跟「合併後站上看到的」是同一段程式算出來的。
 *
 * ⚠️ 這裡把整條 buildTreeDataWith → renderTree 包在 try/catch 裡（控制端裁決，簡報本身
 * 沒寫）：buildTreeDataWith 在「邊的端點對不到節點中心」時會 throw（見 src/lib/build-tree.ts
 * 的「邊端點未對齊節點中心」那行；renderTree 對「圖示被不同尺寸節點共用」也有類似的防禦性
 * throw，見 src/lib/render.ts）。玩家在編輯器裡操作 svgText 的過程中，只要中途出現「刪掉
 * 節點卻留著邊」這種暫時性不一致，就會踩到這類例外。這裡是編輯器唯一的重繪入口，讓例外冒
 * 出去會讓整個 boot() 的 Promise 鏈中斷，畫面停在「什麼都沒畫出來」的白畫面——玩家看不懂
 * 發生了什麼事，也無從復原，是非開發者能遇到最糟的失敗模式。
 *
 * 防護做法：只有 try 區塊成功跑到底、算出新的 svg，才呼叫 host.replaceChildren() 換掉畫面；
 * 失敗時完全不動 DOM，讓「上一次成功渲染」的畫面原封不動留著，只把錯誤訊息寫進
 * #edit-validation 讓玩家知道剛剛的操作有問題（這則訊息之後可能立刻被 runValidation() 的
 * renderValidation() 蓋掉，見該函式的說明——這裡的訊息是「連畫面都畫不出來」時的最後防線，
 * 不是常態）。這也是為什麼 Viewport 只在成功分支動——畫面沒換，就不該讓平移縮放狀態跟著換。
 *
 * ⚠️ Viewport 只在「這個分頁第一次成功畫出東西」（currentViewport 還是 null）才建新的並
 * fitTo() 整棵樹；之後每一輪成功渲染都呼叫 currentViewport.rebind()，保留玩家目前的
 * 平移縮放（task-12 對 task-11 已知取捨的修正，完整理由見 Viewport.rebind() 的說明）。
 * task-11 原本的做法是每次成功都重新 fitTo()：task-12 起 rerender() 會在玩家改動每一個
 * 欄位後被呼叫（見 applyEdit()），若每次都 fitTo()，等於玩家每改一個欄位、畫面就跳回
 * 整棵樹視角——他好不容易縮放到想改的節點，一打字就彈開，這對非開發者是很挫折的體驗。
 */
function rerender(): void {
  const host = document.querySelector<HTMLElement>('#edit-canvas-host');
  const validation = document.querySelector<HTMLElement>('#edit-validation');
  if (!host) throw new Error('找不到 #edit-canvas-host，編輯器畫布無法掛載');
  if (!currentUnlockExceptions) {
    throw new Error('rerender() 在 boot() 完成、unlockExceptions 就緒前被呼叫');
  }

  try {
    const data = buildTreeDataWith(
      editorState.svgText,
      {
        keywords: editorState.keywords,
        unlockExceptions: currentUnlockExceptions,
        spriteIndex: treeMeta.meta.sprite.index,
        spriteSize: treeMeta.meta.sprite.size,
      },
      parseXmlInBrowser,
    );
    const svg = renderTree(data, document);
    host.replaceChildren(svg);
    const viewportGroup = svg.querySelector<SVGGElement>('#viewport');
    if (viewportGroup) {
      if (currentViewport) {
        currentViewport.rebind(svg, viewportGroup);
      } else {
        currentViewport = new Viewport(svg, viewportGroup);
        currentViewport.fitTo([0, 0, data.meta.viewBox[2], data.meta.viewBox[3]]);
      }
    } else {
      currentViewport = null;
    }
    currentNodesById = new Map(data.nodes.map(n => [n.id, n]));
    if (validation) validation.textContent = '';
  } catch (err) {
    if (validation) {
      const msg = err instanceof Error ? err.message : String(err);
      validation.textContent = `畫面更新失敗，已保留上一次的畫面：${msg}`;
    }
  }
}

// 點選判定用 pointerdown/pointerup 自己量位移，不用 click（跟 tree-canvas.ts 選取判定
// 同一個理由，見 bindNodeClicks() 的說明）。5px 這個數字也直接沿用 tree-canvas.ts 的
// DRAG_THRESHOLD_PX——同一個網站、同一種手感，沒有理由訂不同的值。
const NODE_CLICK_DRAG_THRESHOLD_PX = 5;

/**
 * 從目前的 editorState.svgText 讀出一個節點的 NodeBlock，供表單編輯用。
 *
 * 不能重用 currentNodesById（bindNodeClicks() 查完整欄位用的那份 TreeNode 查表）：
 * TreeNode 是 buildTreeDataWith 算出來的衍生資料，經過 parseCost／parseGrowth 等規則
 * 加工，欄位形狀是給渲染／驗證用的（例如 unlockCost 是算好的 {core,gold}，不是原始成本
 * 字串）；NodeBlock 才是表單需要的「貼近原始 SVG 屬性」欄位（labelXml／titleMaxLevel
 * 這些欄位 TreeNode 裡沒有對應物）。兩者刻意不是同一份資料，見 svg-emit.ts 檔頭的說明。
 */
function getNodeBlock(id: string): NodeBlock {
  const loc = locateNodeBlocks(editorState.svgText).get(id);
  if (!loc) throw new Error(`getNodeBlock: 在目前的 svgText 中找不到節點 ${id}`);
  return parseNodeBlock(editorState.svgText.slice(loc[0], loc[1]));
}

/**
 * 找到（或視需要建立）表單的掛載點 `#edit-form`。跟 bindNodeClicks() 原本建立
 * `#edit-node-name` 的做法一樣，不在 edit.astro 裡預先寫死這個容器：`#edit-panel` 底下
 * 除了固定的 `#edit-hint`／`#edit-validation`，表單容器本來就是「選了節點才出現」的東西，
 * 用 JS 惰性建立、prepend 到 hint 原本的位置，跟這個「按需出現」的語意比較一致。
 */
function ensureFormHost(panel: HTMLElement): HTMLElement {
  let formHost = panel.querySelector<HTMLElement>('#edit-form');
  if (!formHost) {
    formHost = document.createElement('div');
    formHost.id = 'edit-form';
    panel.prepend(formHost);
  }
  return formHost;
}

/**
 * 點一個節點時，在右側面板顯示它的完整欄位表單（EditForm.ts 的 renderEditForm）。
 * 用事件委派掛在 #edit-canvas-host 上，而不是逐一在每個 .node 上掛監聽器：rerender()
 * 每次都會用 replaceChildren() 整批換掉畫布內容，掛在個別節點上的監聽器會跟著被丟棄，
 * 掛在容器上則不受影響（跟 tree-canvas.ts 的關鍵字 chip 事件委派是同一個理由）。
 *
 * 判定用 pointerdown/pointerup 量位移，**不用原生 'click' 事件**（審查回饋加上拖曳平移後
 * 才發現的真實 bug，修正時一併處理）：bindViewportInteractions() 在 pointerdown 時對
 * #edit-canvas-host 呼叫 setPointerCapture()，依 Pointer Events 規格，capture 生效後
 * 同一手指「後續」的 pointer 事件、以及為相容而補發的滑鼠事件（含 click 賴以判斷起訖點的
 * mousedown/mouseup）target 一律改標成 capture 的元素（#edit-canvas-host 本身），不再是
 * 實際被按到的 .node——用 `e.target.closest('.node')` 監聽原生 'click' 會永遠拿到 null，
 * 節點完全點不到（這裡最初就是這樣寫、被下面新補的 E2E 案例當場抓到）。改成在
 * pointerdown「當下」（setPointerCapture 生效前，target 還沒被改標）就記下被按到的節點，
 * pointerup 只用來量位移、判定是否為點選，不依賴事件自己的 target——跟 tree-canvas.ts
 * 的選取判定是同一套解法（那邊的註解記錄了同一個坑，這裡直接沿用結論，不重新踩一次）。
 *
 * data-id 讀的是 renderTree() 自己寫進 DOM 的固定屬性（見 src/lib/render.ts 的
 * g.setAttribute('data-id', n.id)），不是解析自玩家輸入的原始 SVG 文字，所以這裡用一般
 * getAttribute 就好，不需要 getAttributeNode（那個規範是給讀「作者輸入的文字」用的，
 * 見 src/lib/svg-parse.ts 的說明）。
 */
function bindNodeClicks(): void {
  const host = document.querySelector<HTMLElement>('#edit-canvas-host');
  const panel = document.querySelector<HTMLElement>('#edit-panel');
  if (!host || !panel) return;

  let downTarget: Element | null = null;
  let downPos = { x: 0, y: 0 };
  host.addEventListener('pointerdown', e => {
    downTarget = (e.target as Element).closest?.('.node') ?? null;
    downPos = { x: e.clientX, y: e.clientY };
  });

  host.addEventListener('pointerup', e => {
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (moved > NODE_CLICK_DRAG_THRESHOLD_PX) return; // 拖曳畫布放開，不是點選
    if (!downTarget) return;
    const id = downTarget.getAttribute('data-id');
    if (!id) return;
    const node = currentNodesById.get(id);
    if (!node) return;

    const hint = panel.querySelector('#edit-hint');
    if (hint) hint.remove();

    currentEditId = id;
    renderEditForm(getNodeBlock(id), ensureFormHost(panel));
  });
}

/**
 * 拖曳平移 + 滾輪縮放（審查回饋，2026-08-18：原本建完 Viewport 就丟，玩家完全無法平移
 * 縮放，239 個節點擠在畫面裡連點都點不準）。邏輯抄 tree-canvas.ts 對應段落（同一個
 * `Viewport.pan()`／`zoomAt()` 介面），但**不是**掛在 `svg` 本身——tree-canvas.ts 的 svg
 * 是頁面載入時建一次、之後不會換掉，這裡的 svg 每次 rerender() 都被 replaceChildren()
 * 整顆換掉，掛在 svg 上的監聽器會跟著舊 svg 一起被丟棄。改成掛在 #edit-canvas-host
 * 這個容器上（rerender() 只換它的子元素，容器本身活得比任何一輪畫面都久），透過事件冒泡
 * 委派接住畫布內的操作，跟 bindNodeClicks() 的點選委派同一個理由；handler 內一律讀
 * 模組級的 `currentViewport`（不是閉包捕捉某一輪的 Viewport 實例），確保操作的永遠是
 * 「當下畫面」對應的那個 Viewport。
 *
 * 這一輪明確不做的事（範圍限定，見審查回饋）：雙指 pinch 縮放、鍵盤方向鍵/+-——留給後續
 * 任務視實際需要再補。CSS 端也拿掉了 `#edit-canvas-host { touch-action: none }`
 * （src/pages/edit.astro）：這輪沒有接雙指縮放，關掉原生觸控卻不補等於連基本的單指滑動
 * 都廢掉，比什麼都不做更糟。
 *
 * ⚠️ 下面的 `host.setPointerCapture()` 有一個容易漏掉的副作用：capture 生效後，同一手指
 * 後續的滑鼠相容事件（含原生 'click' 賴以判斷的 mousedown/mouseup）target 都會被改標成
 * `host`，導致 bindNodeClicks() 原本掛的 'click' 監聽器完全失效（節點點不到）——這裡最初
 * 就是這樣寫、被新補的幾何斷言 E2E 當場抓到。已經把 bindNodeClicks() 改成不依賴 'click'
 * 事件、改用 pointerdown/pointerup 自己量位移判定（跟 tree-canvas.ts 的選取判定同一招，
 * 見該函式開頭的說明），這裡留這段註解是因為「接上 setPointerCapture 會連帶弄壞點選」
 * 這件事本身不直觀，容易在下一次改動時被獨立地重新踩到。
 */
function bindViewportInteractions(): void {
  const host = document.querySelector<HTMLElement>('#edit-canvas-host');
  if (!host) return;

  let dragging = false;
  host.addEventListener('pointerdown', e => {
    dragging = true;
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener('pointerup', e => {
    dragging = false;
    host.releasePointerCapture(e.pointerId);
  });
  host.addEventListener('pointercancel', () => {
    dragging = false;
  });
  host.addEventListener('pointermove', e => {
    if (dragging) currentViewport?.pan(e.movementX, e.movementY);
  });
  host.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      currentViewport?.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    },
    { passive: false },
  );
}

/**
 * 每次欄位編輯提交後的唯一入口：套用一段已經算好的新 svgText（呼叫端 bindFormEdits() 已經
 * 做完 getNodeBlock → applyFieldEdits → emitNodeBlock → replaceNode 這串外科手術），標記
 * 節點為已改動，重繪畫布，並跑一次即時驗證。拆成獨立函式（而不是直接寫在 bindFormEdits()
 * 的事件委派 handler 裡）是因為未來任務（圖示／關鍵字新增、Task 13 的節點重建）改動
 * svgText 的方式不一樣（不是走表單欄位），但收尾這三步——記 dirty、重繪、驗證——是共用的，
 * 這裡先把共用的部分獨立出來，不必等到真的有第二個呼叫端才重構。
 */
function applyEdit(nextSvgText: string, touchedId: string): void {
  editorState.svgText = nextSvgText;
  editorState.dirty.add(touchedId);
  rerender();
  runValidation();
}

/**
 * 送出前的即時驗證：跑一次 validateWith，把結果（連同 tree.json 的 gzip 體積預估）畫進
 * #edit-validation，並依錯誤是否存在切換 #edit-download 的可用狀態、更新 #edit-status
 * 的「已修改 N 處」文字。
 *
 * icons.toVerify 只放 editorState.newIcons（玩家本次新增、還沒進 repo 的圖示）：
 * icons.known 是 repo 既有雜湊（editorState.iconHashes）＋ newIcons 的雜湊聯集，規則
 * 7(a)/7(d) 只需要這個聯集；既有 202 張的內容早已由先前的 CI 驗過，規則 7(b)/7(c) 這種要
 * 讀位元組內容的檢查沒有理由對它們重跑一次——瀏覽器沒理由為了重驗而下載 4.6 MB
 * （見 validate-rules.ts 的 IconSource 說明）。
 */
async function runValidation(): Promise<void> {
  if (!currentUnlockExceptions) return; // boot() 尚未完成，不可能有欄位編輯觸發到這裡

  const icons: IconSource = {
    known: new Set([...editorState.iconHashes, ...editorState.newIcons.keys()]),
    toVerify: new Map(
      [...editorState.newIcons].map(([hash, bytes]) => [hash, { bytes, actualHash: hash }]),
    ),
  };
  const result = validateWith(
    editorState.svgText,
    { keywords: editorState.keywords, icons },
    parseXmlInBrowser,
  );

  // buildTreeDataWith 對某些規則違反是直接 throw，不像 validateWith 把每條規則包在自己的
  // try/catch 裡收斂成 errors 陣列——這是 build-tree.ts 既有的行為（例如節點的
  // costRaw／description 被改成 parseCost／extractKeywords／parseGrowth 判為不合法的格式，
  // 這三個呼叫在 build-tree.ts 裡都沒有包 try/catch，見該檔的節點映射），不是這裡新引入的
  // 問題。若不接住，會讓下面的 estimateGzipBytes／renderValidation 整段被跳過：玩家剛打的
  // 錯誤明明已經被上面的 validateWith 抓成正確的規則訊息（例如「規則 4: ...」），
  // #edit-validation 卻會停在 rerender() 留下的通用「畫面更新失敗」訊息，看不到真正對得上
  // 規則編號的訊息——這正是本任務 E2E 案例二（成本改成「八個核心」）在守的行為。
  // gzip 體積這時候本來就算不出來（連 tree.json 的資料都建不出來），用 NaN 當「無法估算」
  // 的哨兵值，renderValidation 看到 NaN 就跳過體積列，不顯示誤導性的 0 KB。
  let gzipBytes = NaN;
  try {
    const data = buildTreeDataWith(
      editorState.svgText,
      {
        keywords: editorState.keywords,
        unlockExceptions: currentUnlockExceptions,
        spriteIndex: treeMeta.meta.sprite.index,
        spriteSize: treeMeta.meta.sprite.size,
      },
      parseXmlInBrowser,
    );
    gzipBytes = await estimateGzipBytes(JSON.stringify(data));
  } catch {
    // 上面已經用 NaN 記錄「算不出來」，這裡不需要額外處理。
  }

  // 新增圖示的提醒是這裡才有的資訊（editorState.newIcons），不屬於 renderValidation() 的
  // 職責——那個函式的簽章（result／gzipBytes／host 三個參數）是任務簡報定死的介面，
  // 加第四個參數等於改介面。改成把提示併進 warnings 陣列一起送進去，renderValidation
  // 完全不需要知道「新增圖示」這個概念存在，維持它只管「顯示收到的東西」的單純職責。
  const warnings = editorState.newIcons.size > 0
    ? [...result.warnings, `本次新增了 ${editorState.newIcons.size} 張圖示，sprite.webp 的實際體積以 CI 為準`]
    : result.warnings;

  const validation = document.querySelector<HTMLElement>('#edit-validation');
  if (validation) renderValidation({ errors: result.errors, warnings }, gzipBytes, validation);

  // 停用送出跟「新增圖示」的提醒一樣，都是這裡（而不是 renderValidation 內部）的協調責任：
  // renderValidation 只管寫進它收到的 host，不伸手碰 #edit-panel 以外的元素，跟
  // NodeDetail.ts／EditForm.ts 的既有慣例一致（元件不知道自己以外還有哪些 DOM 節點）。
  const downloadBtn = document.querySelector<HTMLButtonElement>('#edit-download');
  if (downloadBtn) downloadBtn.disabled = result.errors.length > 0;

  const status = document.querySelector<HTMLElement>('#edit-status');
  if (status) {
    status.textContent = editorState.dirty.size === 0 ? '尚未修改' : `已修改 ${editorState.dirty.size} 處`;
  }
}

/** 把表單欄位（data-field 的值）跟玩家打進去的原始字串，轉成 applyFieldEdits 要的
 *  FieldEdits 局部物件。`maxLevel` 一律帶上這個 key（不管留白與否）——focusout 觸發代表
 *  「玩家確實碰過這一欄」，留白就是「把它清空」，對應 applyFieldEdits 需要用
 *  `'maxLevel' in edits` 才能分辨的那個「有沒有要改」語意（見 EditForm.ts 的說明）。 */
function toFieldEdits(field: string, value: string): FieldEdits {
  switch (field) {
    case 'name': return { name: value };
    case 'label': return { label: value };
    case 'cost': return { cost: value };
    case 'description': return { description: value };
    case 'maxLevel': return { maxLevel: value.trim() === '' ? null : Number(value) };
    default: throw new Error(`toFieldEdits: 未知的 data-field="${field}"`);
  }
}

/**
 * 表單欄位提交：委派在 #edit-panel 上監聽 'focusout'（會冒泡），不是 'blur'（不會冒泡）
 * ——事件委派本來就只能接住會冒泡的事件。Playwright 的 `locator.blur()`／玩家實際切到
 * 下一個欄位，都是呼叫原生 `HTMLElement.blur()`，依規範會同步觸發不冒泡的 'blur' 與
 * 冒泡的 'focusout' 兩個事件，這裡接住後者。
 *
 * 每個欄位獨立送出（讀觸發事件的 target 本身，不是整個表單一次序列化）：`getNodeBlock`
 * 都是從 editorState.svgText「當下」的狀態重新解析，多個欄位依序 focusout 時，後一個
 * 欄位的 applyFieldEdits 會疊在前一個欄位已經寫回 svgText 的結果上，天然支援連續改多欄。
 */
function bindFormEdits(): void {
  const panel = document.querySelector<HTMLElement>('#edit-panel');
  if (!panel) return;

  panel.addEventListener('focusout', e => {
    const el = (e.target as Element).closest?.('[data-field]') as
      | (HTMLInputElement | HTMLTextAreaElement)
      | null;
    if (!el || !currentEditId) return;
    const field = el.dataset.field;
    if (!field) return;

    const block = getNodeBlock(currentEditId);
    const edits = toFieldEdits(field, el.value);
    const nextBlockText = emitNodeBlock(applyFieldEdits(block, edits));
    const nextSvgText = replaceNode(editorState.svgText, currentEditId, nextBlockText);
    applyEdit(nextSvgText, currentEditId);
  });
}

boot();
