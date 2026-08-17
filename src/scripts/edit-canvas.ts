// 線上編輯器的載入與渲染骨架：讀正本 SVG（複製自 /data，見 tools/build-data.ts）＋三份
// 輔助資料，畫成 SVG 掛進 #edit-canvas-host。後續任務（表單編輯、圖示/關鍵字新增、驗證、
// 下載）都疊在 editorState 與 rerender() 之上，唯一的重繪路徑固定是
// svgText → buildTreeDataWith → renderTree（見 rerender() 的說明），不另寫第二套。
import rawTreeMeta from '../generated/tree.json';
import { buildTreeDataWith } from '../lib/build-tree.js';
import { parseXmlInBrowser } from '../lib/dom.js';
import { renderTree } from '../lib/render.js';
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
  rerender(unlockExceptions);
  bindNodeClicks();
  bindViewportInteractions();
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
 * #edit-validation 讓玩家知道剛剛的操作有問題。這也是為什麼 Viewport 只在成功分支重建——
 * 畫面沒換，就不該建立一個指向新（其實沒套用成功）狀態的平移縮放物件。
 *
 * 每次成功都會建一個新的 Viewport 並立刻 fitTo() 整棵樹（跟 tree-canvas.ts 桌機初始視角
 * 同一招：`vp.fitTo([0, 0, viewBox.w, viewBox.h])`）。這代表 Task 12+ 一旦開始在編輯欄位時
 * 呼叫 rerender()，玩家目前平移/縮放到哪裡都會被重置回「整棵樹置中塞滿」——這是刻意先選的
 * 「兩害相權取其輕」：新建的 Viewport 預設 x=0,y=0,s=1（沒有 fitTo 的話只會顯示 viewBox
 * 左上角一小塊，多數情況下畫面是空的），比起保留舊視角，重置到「至少看得到整棵樹」還是比較
 * 不糟的預設值。「編輯時保留玩家原本的平移/縮放狀態」是這個取捨明確留下的缺口，本輪修正
 * 範圍以外，故意不在這裡解——Task 12 接上編輯功能、真的會頻繁重繪時，若這個重置感覺不好用，
 * 屆時再決定要不要把舊 Viewport 的 x/y/s 抄到新的上面。
 */
function rerender(unlockExceptions: UnlockExceptions): void {
  const host = document.querySelector<HTMLElement>('#edit-canvas-host');
  const validation = document.querySelector<HTMLElement>('#edit-validation');
  if (!host) throw new Error('找不到 #edit-canvas-host，編輯器畫布無法掛載');

  try {
    const data = buildTreeDataWith(
      editorState.svgText,
      {
        keywords: editorState.keywords,
        unlockExceptions,
        spriteIndex: treeMeta.meta.sprite.index,
        spriteSize: treeMeta.meta.sprite.size,
      },
      parseXmlInBrowser,
    );
    const svg = renderTree(data, document);
    host.replaceChildren(svg);
    const viewportGroup = svg.querySelector<SVGGElement>('#viewport');
    if (viewportGroup) {
      currentViewport = new Viewport(svg, viewportGroup);
      currentViewport.fitTo([0, 0, data.meta.viewBox[2], data.meta.viewBox[3]]);
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
 * 點一個節點時，在右側面板顯示它的欄位（本任務先只顯示名稱；完整欄位表單是 Task 12 的事）。
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

    let nameEl = panel.querySelector<HTMLElement>('#edit-node-name');
    if (!nameEl) {
      nameEl = document.createElement('h2');
      nameEl.id = 'edit-node-name';
      panel.prepend(nameEl);
    }
    // node.name 是 buildTreeDataWith 解析出來的乾淨名稱（不是 render.ts 畫進 <title> 的
    // hover tooltip——那段文字是「名稱＋描述第一行」再截斷到 24 字，會把後面的描述文字也
    // 混進來，不是單純的節點名稱，見 render.ts 的 tooltipText()）。用 textContent 而不是
    // innerHTML：名稱本來就不含標記，也不需要處理逃逸。
    nameEl.textContent = node.name;
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

boot();
