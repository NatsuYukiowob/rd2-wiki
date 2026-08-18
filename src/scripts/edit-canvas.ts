// 線上編輯器的載入與渲染骨架：讀正本 SVG（複製自 /data，見 tools/build-data.ts）＋三份
// 輔助資料，畫成 SVG 掛進 #edit-canvas-host。後續任務（表單編輯、圖示/關鍵字新增、驗證、
// 下載）都疊在 editorState 與 rerender() 之上，唯一的重繪路徑固定是
// svgText → buildTreeDataWith → renderTree（見 rerender() 的說明），不另寫第二套。
import rawTreeMeta from '../generated/tree.json';
import { applyFieldEdits, renderEditForm, type FieldEdits } from '../components/EditForm.js';
import { renderNewNodeForm } from '../components/NewNodeForm.js';
import { renderValidation } from '../components/ValidationPanel.js';
import { buildTreeDataWith } from '../lib/build-tree.js';
import { estimateGzipBytes } from '../lib/budget.js';
import { parseXmlInBrowser } from '../lib/dom.js';
import { allocateId } from '../lib/id-alloc.js';
import { checkIcon, sha256Hex12 } from '../lib/icon-hash.js';
import { diffTrees, type EditSummary } from '../lib/pr-summary.js';
import { renderTree } from '../lib/render.js';
import { locateNodeBlocks, replaceNode, insertNode, insertEdge, removeNode, removeEdge } from '../lib/svg-edit.js';
import { emitNodeBlock, emitEdgeLine, newNodeBlock, parseNodeBlock, setImageHref, type NodeBlock } from '../lib/svg-emit.js';
import { strokeOfElement } from '../lib/taxonomy.js';
import { validateWith, type IconSource } from '../lib/validate-rules.js';
import { Viewport } from '../lib/viewport.js';
import { mountSubmitPanel, type SubmitPanelHandle, type SubmitPayload } from '../components/SubmitPanel.js';
import type { Branch, NodeType, TreeData, TreeNode, UnlockVia } from '../lib/types.js';

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

// 目前畫布上疊在新圖示（editorState.newIcons，還沒進 sprite.webp）之上的 blob URL 清單，
// 供 overlayNewIcons() 在下一輪 rerender() 建立新 URL 之前先 revoke 用。跟
// currentNodesById／currentViewport 同一類「屬於目前這一輪畫面」的模組級狀態，見
// overlayNewIcons() 的說明——重點是「revoke 的時機」：只在正要建出新一輪畫面時才 revoke
// 上一輪的，rerender() 失敗（畫面沒換）時不會走到這裡，舊畫面用的 blob URL 因此不會被
// 提早收掉而變成破圖。
let activeIconBlobUrls: string[] = [];

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

/**
 * 編輯器的三種互斥模式（工具列 `#edit-mode-select`／`#edit-mode-add`／`#edit-mode-link`
 * 三顆按鈕，見 bindModeButtons()）。跟 currentEditId 一樣是模組級狀態：`bindNodeClicks()`
 * 掛在 `#edit-canvas-host` 上的單一 pointerup handler 要靠這個變數決定「這次點擊該做什麼」
 * ——選取模式點節點開表單、新增模式點畫布放節點、連線模式點兩個節點拉一條邊，三者共用同一套
 * 點擊判定（pointerdown/pointerup 量位移，理由見 bindNodeClicks() 開頭的說明），只是收尾
 * 動作不同，不需要也不該各自重新掛一套點擊判定邏輯。
 */
type EditMode = 'select' | 'add' | 'link';
let currentMode: EditMode = 'select';

/**
 * 連線模式「第一次點的節點記為前置」的暫存狀態。跟 currentEditId 不同：這個變數只在單一次
 * 「點前置 → 點目標」互動期間存在，成功拉一條邊或使用者取消（見 handleLinkModeNodeClick()）
 * 就會清空，不是跨模式存活的編輯 session 狀態。
 */
let linkFromId: string | null = null;

/**
 * Task 21 登入／送出面板（`src/components/SubmitPanel.ts`）的控制 handle，`boot()` 掛載
 * 時取得。跟 `currentViewport`／`currentUnlockExceptions` 同一類模組級狀態：`runValidation()`
 * 每次跑完都要用它把「有沒有驗證錯誤、有沒有改動」這個結果轉告面板，用來切換送出鍵的可用
 * 狀態（見該函式收尾那幾行）。掛載本身在 `#edit-submit-panel` 找不到時會是 `null`（理論上
 * 不會發生，edit.astro 的模板固定有這個容器），下游一律用 `?.` 保護，不假設它一定存在。
 */
let submitPanelHandle: SubmitPanelHandle | null = null;

/** `boot()` 一開始從 edit.astro 模板裡的初始 `#edit-hint` clone 下來的樣板，供
 *  `restoreHintIfEmpty()`（D15）在面板被清空後需要放回提示文字時使用，見該函式的說明。 */
let hintTemplate: Element | null = null;

/** `boot()` 一開始（在 `sha256Hex12` 算完之前）快取的「玩家開始編輯前」骰子樹雜湊，供
 *  `buildSubmitPayload()` 塞進送出 payload 的 `baseSvgHash`（I4）——伺服器收到後會用同一個
 *  演算法對 `baseSha`（PR 建 commit 用的上游基底）上的 `data/dice-tree.svg` 重算一次雜湊，
 *  兩者不同就代表玩家編輯期間上游又有新的合併，回 409 請玩家重新整理，避免 PR 靜默還原掉
 *  那段時間別人剛合併的改動（見 functions/api/github/submit.ts 的說明）。 */
let baseSvgHash: string | null = null;

/** `atob`／`btoa` 只吃字串，瀏覽器沒有 `Buffer.from(...).toString('base64')` 這條路——跟
 *  `functions/api/github/_lib/gh.ts` 的同名函式（伺服器端版本）是同一招，這裡重新寫一份
 *  而不是想辦法共用：那個檔案在 `functions/` 底下，是 Cloudflare Pages Functions 的程式，
 *  用另一套 tsconfig／打包單元，`src/` 不該（也不能）反向 import 它（Global Constraints）。
 *
 *  ⚠️ 不能寫成 `String.fromCharCode(...bytes)` 展開成一次函式呼叫的多個引數（任務簡報
 *  特別點名的坑）：`editorState.newIcons` 存的圖示約 20KB，展開等於一次呼叫塞 2 萬個
 *  引數，會直接超出 JS engine 對函式呼叫引數數量的限制而炸掉（不同瀏覽器的實際上限不同，
 *  但幾萬這個量級穩定會炸）。逐 byte 累加字串雖然多一層迴圈，沒有這個引數數量上限問題。 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * 組出送去 `/api/github/submit` 的 payload，由 SubmitPanel.ts 在玩家按下送出那一刻呼叫
 * （見 mountSubmitPanel() 的 `getPayload` 參數）。
 *
 * `summary` 用 `diffTrees` 比較 `editorState.original`（玩家開始編輯前、boot() 讀到的原始
 * SVG）與 `editorState.svgText`（目前狀態）算出來——`diffTrees` 吃的是 `TreeData`，不是
 * 原始 SVG 字串，所以兩邊都要重新跑一次 `buildTreeDataWith`，用跟 `rerender()`／
 * `runValidation()` 完全相同的一組 opts（keywords／unlockExceptions／spriteIndex／
 * spriteSize），才能保證這裡算出的 `TreeNode[]` 形狀跟其他地方一致，`diffTrees` 內部的
 * `JSON.stringify` 比對才有意義。
 *
 * `keywords`／`icons` 只在玩家本次真的有新增時才帶，對應 `functions/api/github/submit.ts`
 * 對這兩個欄位的 optional 處理（該檔 `body.keywords && body.keywords.length > 0`／
 * `body.icons ?? []` 那兩段）——沒有新增就完全不用碰 `data/keywords.json`／新增圖示檔案，
 * 送一個不存在的空陣列語意上等價但沒有必要。
 *
 * 送出鍵只在 `runValidation()` 判定「沒有 error 且有改動」時才會被 `submitPanelHandle`
 * 設成可按（見該函式收尾），所以呼叫這個函式時 `editorState.svgText` 理論上一定能被
 * `buildTreeDataWith` 成功解析；`editorState.original` 是從未被玩家修改過的正本，更不可能
 * 解析失敗。這裡仍不吞掉例外——SubmitPanel.ts 的 submit() 有 try/catch 接住任何意外，
 * 顯示可讀錯誤，好過在這裡默默塞一份假資料送出去。
 *
 * `baseSvgHash`（I4，全分支審查抓到、跟 keywords.json 早就修過的漂移問題是同一類）：伺服器
 * 端 `data/dice-tree.svg` 走的是「整份拿玩家頁面載入時的舊快照覆蓋」這條路，跟 keywords.json
 * 曾經被否決的做法一樣——玩家開著 `/edit` 編輯期間，若維護者剛好合併了另一個 PR，玩家送出
 * 時會靜默還原掉那個 PR 的改動。這裡把 `boot()` 讀到的原始 SVG 雜湊一起送給伺服器，讓伺服器
 * 用同一個 `baseSha` 重新讀一次上游現在的內容比對雜湊，不同就代表上游已經變了，回 409 並顯示
 * 「請重新整理頁面後再改一次」（見 functions/api/github/submit.ts 的說明）。
 */
function buildSubmitPayload(): SubmitPayload {
  if (!currentUnlockExceptions) throw new Error('buildSubmitPayload：unlockExceptions 尚未就緒');
  if (!baseSvgHash) throw new Error('buildSubmitPayload：baseSvgHash 尚未就緒');

  const opts = {
    keywords: editorState.keywords,
    unlockExceptions: currentUnlockExceptions,
    spriteIndex: treeMeta.meta.sprite.index,
    spriteSize: treeMeta.meta.sprite.size,
  };
  const before = buildTreeDataWith(editorState.original, opts, parseXmlInBrowser);
  const after = buildTreeDataWith(editorState.svgText, opts, parseXmlInBrowser);
  const summary: EditSummary = {
    ...diffTrees(before, after),
    newIcons: [...editorState.newIcons.keys()],
    newKeywords: editorState.newKeywords,
  };

  const payload: SubmitPayload = { svgText: editorState.svgText, summary, baseSvgHash };
  if (editorState.newKeywords.length > 0) payload.keywords = editorState.newKeywords;
  if (editorState.newIcons.size > 0) {
    payload.icons = [...editorState.newIcons].map(([hash, bytes]) => ({ hash, base64: toBase64(bytes) }));
  }
  return payload;
}

async function boot(): Promise<void> {
  // D15：在任何 clearPanelContent() 有機會執行之前，先把 edit.astro 模板裡的初始
  // #edit-hint clone 一份存起來，供之後 restoreHintIfEmpty() 需要「放回」提示文字時使用
  // （見該函式的說明）。這裡只 clone、不動 DOM，所以放在 boot() 最前面、比任何事件綁定都早
  // 執行沒有風險。
  hintTemplate = document.querySelector('#edit-panel #edit-hint')?.cloneNode(true) as Element ?? null;

  // 掛載跟其餘 boot() 流程平行、不互相依賴：登入狀態查詢（/api/github/me）不需要等
  // 樹狀資料（svgText／keywords／…）載完才開始，愈早掛出去，玩家愈早看到登入鈕或
  // 「已登入為 X」，不需要陪著等一份它根本用不到的資料。`buildSubmitPayload` 只在
  // 玩家真的按下送出時才會被呼叫，那時候下面的 Promise.all 早就完成了，不會有
  // currentUnlockExceptions 還沒就緒的競態（見該函式開頭的防禦性檢查）。
  const submitHost = document.querySelector<HTMLElement>('#edit-submit-panel');
  if (submitHost) submitPanelHandle = mountSubmitPanel(submitHost, buildSubmitPayload);

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
  // I4：算「玩家開始編輯前」這份骰子樹的雜湊，送出時一併帶給伺服器比對（見 baseSvgHash 的
  // 宣告、buildSubmitPayload() 的說明）。不併進上面的 Promise.all：這裡依賴的是剛拿到的
  // svgText 本身，不是另一個獨立的網路請求，沒有理由跟其他 fetch 搶跑。
  baseSvgHash = await sha256Hex12(new TextEncoder().encode(svgText));
  rerender();
  bindNodeClicks();
  bindViewportInteractions();
  bindFormEdits();
  bindIconUpload();
  bindValidationActions();
  bindModeButtons();
  bindNewNodeFormActions();
  bindDeleteShortcut();
  bindDownload();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 換圖示的畫布顯示（Task 14）：新圖示還沒進 `sprite.webp`（那是建置期批次打包的產物，
 * 見 CLAUDE.md「既有 202 張圖示是打包在 sprite 圖集裡渲染的」），`render.ts` 對雜湊查不到
 * `spriteIndex` 的圖示只會 `continue`、整個跳過那個雜湊的 `<pattern>`（見該檔 iconSizes
 * 迴圈的說明），節點的 `.icon` `<rect fill="url(#...)">` 因此指到一個不存在的 pattern，
 * 畫面上會是空白——這裡在每次 `rerender()` 成功建出新 svg 後，對雜湊落在
 * `editorState.newIcons` 的節點，疊一張 `URL.createObjectURL()` 生出的 `<image>` 蓋在
 * `.icon` 之上。不動 `.icon` 本身（不拔掉、不改它的 x/y/width/height）：`bindNodeClicks()`
 * 的點選判定是用 `closest('.node')` 找最近的節點群組，不管實際點到 `.icon` 還是蓋在它
 * 上面的這張 `<image>`，兩者都在同一個 `<g class="node">` 底下，判定不受影響。
 *
 * ⚠️ 每次呼叫都先 revoke 上一輪建立的 blob URL，再建這一輪的——這是任務簡報明講的坑：
 * 玩家反覆換圖示、改欄位都會觸發 `rerender()`，若不 revoke，每一輪都會新增一批不會被
 * 自動回收的 blob，分頁的記憶體會隨編輯次數線性成長。revoke 的時機刻意選在「正要建立
 * 新一輪畫面」的當下（`rerender()` 的 try 區塊成功跑到這裡才會呼叫這個函式）：`rerender()`
 * 失敗時完全不會走到這裡，上一輪成功畫面連同它用的 blob URL 原封不動留著繼續顯示，這是
 * 對的行為——沒有新畫面可以換上去時，還在用的 blob URL 不能被 revoke，否則畫面上正顯示
 * 中的圖示會直接消失變空白（見 rerender() 的 try/catch 說明：「失敗時完全不動 DOM」）。
 */
function overlayNewIcons(svg: SVGSVGElement, nodes: TreeNode[]): void {
  for (const url of activeIconBlobUrls) URL.revokeObjectURL(url);
  activeIconBlobUrls = [];
  if (editorState.newIcons.size === 0) return;

  for (const n of nodes) {
    const bytes = editorState.newIcons.get(n.icon);
    if (!bytes) continue; // 這個節點的圖示不是本次新增的，既有 sprite 查得到，不需要疊圖
    const iconRect = svg.querySelector(`.node[data-id="${n.id}"] .icon`);
    if (!iconRect) continue; // 理論上不會發生：n.id／n.icon 都是剛剛 renderTree() 用同一份 data 畫出來的

    // 包一層 new Uint8Array(bytes)：跟 icon-hash.ts 的 sha256Hex12() 同一個型別坑
    // （TS 5.7+ 把 TypedArray 的 buffer 泛型化成 ArrayBufferLike，含 SharedArrayBuffer，
    // 但 DOM 的 BlobPart 只收 ArrayBuffer-backed 的 TypedArray），內容不變，只是讓型別對得上。
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    activeIconBlobUrls.push(url);

    const [w, h] = n.size;
    const img = document.createElementNS(SVG_NS, 'image');
    img.setAttribute('x', String(-w / 2));
    img.setAttribute('y', String(-h / 2));
    img.setAttribute('width', String(w));
    img.setAttribute('height', String(h));
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    img.setAttribute('href', url);
    iconRect.after(img);
  }
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
    overlayNewIcons(svg, data.nodes); // 疊在 replaceChildren() 之前，畫面只換一次，不會閃一下空白圖示
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

/** 跟 ensureFormHost() 同一招，但用於「新增模式」的 #new-node（NewNodeForm.ts 的掛載點）。 */
function ensureNewNodeFormHost(panel: HTMLElement): HTMLElement {
  let formHost = panel.querySelector<HTMLElement>('#new-node');
  if (!formHost) {
    formHost = document.createElement('div');
    formHost.id = 'new-node';
    panel.prepend(formHost);
  }
  return formHost;
}

/**
 * 切換模式或切換選取目標前，先把面板裡「按需出現」的內容清乾淨：欄位表單（#edit-form）、
 * 新增節點表單（#new-node）、初始提示（#edit-hint）三者互斥，同一時間只該有一個顯示——
 * 不清乾淨的話，例如玩家在選取模式點開某節點的表單後切到新增模式，兩份表單會同時疊在
 * #edit-panel 裡，欄位 id 沒有衝突（各自用 data-field 委派，不靠 DOM id 選取單一表單），
 * 但畫面會很混亂。刻意不動 #edit-validation：那是 runValidation() 的地盤，跟「哪個表單
 * 顯示中」是獨立的兩件事，見 setMode() 的說明。
 *
 * ⚠️ 這個函式本身**不會**把 `#edit-hint` 放回去（D15，全分支審查抓到、22 輪任務審查都漏掉
 * 的 Minor→必修）：呼叫端有兩種收尾方式——「清空後馬上補新內容」（bindNodeClicks() 選取節點
 * 開表單、handleAddModeClick() 開新增節點表單）跟「清空後沒有新內容」（setMode() 切模式、
 * deleteSelectedNode() 刪掉正在編輯的節點、bindNewNodeFormActions() 取消／建立新節點）。
 * 若這裡自動補回 hint，前者會出現「hint 補回來、下一行馬上又被表單蓋掉」的閃爍，且
 * `ensureFormHost()`／`ensureNewNodeFormHost()` 只是 `prepend`，不會順手把這裡剛塞回去的
 * hint 移除，會變成表單跟 hint 同時顯示（違反「三者互斥」）。後者才需要補 hint，見
 * `restoreHintIfEmpty()`，由這些呼叫端自己決定要不要接著呼叫。
 */
function clearPanelContent(panel: HTMLElement): void {
  panel.querySelector('#edit-form')?.remove();
  panel.querySelector('#new-node')?.remove();
  panel.querySelector('#edit-hint')?.remove();
}

/**
 * `clearPanelContent()` 之後，面板陷入「三者（表單／新增表單／提示）都沒有」的空白狀態時，
 * 把初始提示放回去（D15）。修法前，玩家點過一次節點之後，切模式或取消新增節點，`#edit-panel`
 * 會永久留白、沒有任何引導文字——在編輯器的主流程上直接製造「我是不是把它弄壞了」的困惑。
 *
 * 只有「清空後不會馬上補新內容」的呼叫端（setMode()／deleteSelectedNode()／
 * bindNewNodeFormActions() 的取消與建立分支）需要呼叫這個函式，見 clearPanelContent() 的
 * 說明；`ensureFormHost()`／`ensureNewNodeFormHost()` 兩條「清空後馬上補新內容」的路徑不呼叫
 * 它，避免 hint 曇花一現又被蓋掉、或跟表單同時顯示。
 *
 * 提示文字不在這裡重新硬編碼一份字面量：`hintTemplate` 是 `boot()` 一開始（在任何
 * `clearPanelContent()` 有機會執行之前）從 edit.astro 模板裡的初始 `#edit-hint` clone
 * 下來的，這裡永遠 clone 一份新的插回去——提示文案只在 edit.astro 定義一次，不會因為兩處
 * 各自維護一份字串而漂移。
 */
function restoreHintIfEmpty(panel: HTMLElement): void {
  if (panel.querySelector('#edit-form') || panel.querySelector('#new-node')) return;
  if (panel.querySelector('#edit-hint')) return;
  if (!hintTemplate) return; // 理論上不會發生：boot() 一定會在任何呼叫端有機會執行前設好
  panel.prepend(hintTemplate.cloneNode(true) as Element);
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
 *
 * Task 13 起，同一套「pointerdown 記目標／pointerup 量位移判定點選」的機制依 currentMode
 * 分岔成三種收尾：選取模式（下面 else 分支，原本的行為）開欄位表單；新增模式（見
 * handleAddModeClick()）不管有沒有點到節點，都把點擊座標換算成 SVG 使用者座標開新增節點
 * 表單；連線模式（見 handleLinkModeNodeClick()）只在點到節點時才有動作。三者共用同一套
 * downTarget／downPos 判定，不必也不該各自重新掛一份 pointerdown/pointerup。
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

    if (currentMode === 'add') {
      handleAddModeClick(e, host, panel);
      return;
    }

    if (!downTarget) return;
    const id = downTarget.getAttribute('data-id');
    if (!id) return;

    if (currentMode === 'link') {
      handleLinkModeNodeClick(id);
      return;
    }

    const node = currentNodesById.get(id);
    if (!node) return;

    clearPanelContent(panel);
    currentEditId = id;
    renderEditForm(getNodeBlock(id), ensureFormHost(panel));
  });
}

/** 把數字取到小數點後兩位（新增節點時滑鼠座標換算的精度，見 handleAddModeClick()）。 */
function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * ⚠️ 新增模式的座標轉換陷阱（任務簡報特別點名）：把滑鼠螢幕座標換算成 SVG 使用者座標，
 * 必須用 `#viewport` 這個群組的 CTM，不能用根 `<svg>` 的：
 *
 *   錯：svg.getScreenCTM()!.inverse()
 *   對：viewportGroup.getScreenCTM()!.inverse()
 *
 * 差別在哪裡：`bindViewportInteractions()` 的拖曳／滾輪縮放是把平移縮放的 transform 掛在
 * `#viewport` 這個 `<g>` 上（不是根 svg 本身，見 rerender() 與 Viewport 類別的說明）。根 svg
 * 的 `getScreenCTM()` 只涵蓋「viewBox 使用者座標 → 容器 CSS 像素」這一層瀏覽器內建的縮放
 * （由 `viewBox`＋`preserveAspectRatio` 決定），完全不知道 `#viewport` 自己還疊了一層由
 * Task 11 拖曳／縮放產生的 transform。
 *
 * ⚠️ 實測過（用 `getScreenCTM()` 直接讀兩者的矩陣分量比較）：這兩種寫法在這個實作下**從
 * 第一次渲染起就不一樣**，不是只有「玩家手動平移縮放過」才會產生落差——`rerender()` 在
 * 第一次成功畫出畫面時就會呼叫 `Viewport.fitTo()`，把 `#viewport` 的 transform 設成
 * `translate(170,142.5) scale(0.9)`（見該函式的說明），這本來就不是單位矩陣，`svg` 自己的
 * CTM 從一開始就漏算了這一層。也就是說，即使 E2E 完全不平移縮放就點擊，用錯 CTM 這個 bug
 * 理論上也測得出來——但這是這個實作的巧合（`fitTo()` 剛好套了非單位矩陣），不是這個座標
 * 轉換陷阱本質上保證的事：任務簡報要求 E2E「必須先平移或縮放，再點畫布放節點」是對的原則
 * ——不能讓測試的鑑別力偷偷依賴一個實作細節（哪天 fitTo() 改成別的算法，剛好套出單位矩陣，
 * 沒有平移縮放的測試就會失去鑑別力而不自知）。tests/e2e/edit.spec.ts 對應案例因此仍然先
 * 縮放過（原因見該測試檔案的說明：縮放比平移更能在各種容器長寬比例下保持穩定，尤其是這個
 * 測試套件 mobile 專案的窄畫布），才點畫布放節點、斷言新節點座標。
 *
 * 回傳的座標取到小數點後兩位（`roundTo2`）——跟 `newNodeBlock`/`emitNodeBlock` 最終用
 * `.toFixed(2)` 寫進 SVG 的精度一致，這裡先做只是讓 NewNodeForm 顯示的「位置」文字跟實際寫
 * 入的座標一致，不是為了規避浮點誤差（`emitNodeBlock` 本來就會再 `.toFixed(2)` 一次）。
 *
 * 找不到 svg／#viewport／CTM（例如 boot() 還沒渲染出第一輪畫面）時回傳 null，呼叫端據此
 * 放棄這次點擊，不硬算出一個沒有意義的座標。
 */
function screenToViewportXY(host: HTMLElement, clientX: number, clientY: number): [number, number] | null {
  const svg = host.querySelector('svg');
  const viewportGroup = svg?.querySelector<SVGGElement>('#viewport');
  const ctm = viewportGroup?.getScreenCTM();
  if (!ctm) return null;
  const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return [roundTo2(pt.x), roundTo2(pt.y)];
}

const NODE_TRANSFORM_RE = /translate\(([-\d.]+),\s*([-\d.]+)\)/;

/**
 * 從渲染出來的節點 `<g>` 元素直接讀 `transform="translate(x,y)"` 的值，供連線模式／刪除節點
 * 時取得節點座標。這是任務簡報「連線由點前置節點→點目標節點產生，座標直接取兩個節點
 * transform 的值」的落地：不重新查表、不重新解析 editorState.svgText，直接讀畫面上這個
 * `<g>` 元素當下的 transform——這個值就是 render.ts 用 `n.x`/`n.y`（parseNodeBlock 解析
 * 原始 SVG 得到的座標，未經任何加工）寫進去的，跟 emitEdgeLine 最終要寫回 SVG 的端點座標
 * 是同一個數字，只是走了 DOM 屬性這條路徑，而不是重新解析字串。這保證連線的端點誤差恆為 0
 * ——不可能因為兩邊分別算一次座標而產生浮點或捨入的落差，CI 規則 5（邊端點要精準對齊節點
 * 中心）因此不可能被這個機制違反。
 */
function nodeTransformXY(g: Element): [number, number] {
  const m = NODE_TRANSFORM_RE.exec(g.getAttribute('transform') ?? '');
  if (!m) throw new Error(`節點缺少可解析的 transform，無法取得座標：${g.getAttribute('data-id')}`);
  return [Number(m[1]!), Number(m[2]!)];
}

/**
 * 新增模式下的畫布點擊：不管有沒有點到既有節點，都把點擊座標換算成 SVG 使用者座標（見
 * screenToViewportXY() 的陷阱說明），開出新增節點表單。「點畫布空白處」只是任務簡報描述的
 * 典型操作方式，不是強制要求——判定要不要開表單只看有沒有成功換算出座標，不檢查底下有沒有
 * 節點，這樣邏輯比較單純，也不會出現「點得剛好卡在節點邊緣、不知道算不算空白處」的模糊地帶。
 */
function handleAddModeClick(e: PointerEvent, host: HTMLElement, panel: HTMLElement): void {
  const xy = screenToViewportXY(host, e.clientX, e.clientY);
  if (!xy) return;
  const [x, y] = xy;

  clearPanelContent(panel);
  currentEditId = null;
  const formHost = ensureNewNodeFormHost(panel);
  // 建立節點時（bindNewNodeFormActions() 的 create 分支）要用到這次點擊換算出的座標，
  // 存成 dataset 屬性掛在表單容器本身，不另外開一個模組級變數——這個座標只在「這個表單
  // 開著」的期間有意義，跟著承載表單的 DOM 元素活，表單被移除（建立或取消）座標自然一起消失，
  // 不需要額外一步「記得清掉」。
  formHost.dataset.x = String(x);
  formHost.dataset.y = String(y);
  const existingIds = [...locateNodeBlocks(editorState.svgText).keys()];
  renderNewNodeForm({ x, y, existingIds }, formHost);
}

/**
 * 連線模式下點到一個節點：第一次點記為前置（linkFromId），第二次點記為目標，成功配對後
 * `insertEdge(emitEdgeLine(前置座標, 目標座標))`。座標直接讀畫面上的節點 transform
 * （nodeTransformXY()），理由見該函式的說明——這是規則 5「不可能違反」的落地機制。
 *
 * 兩次點到同一個節點：任務簡報要求「取消並提示」。這裡不把節點跟自己連起來（自迴圈對規則 6
 * 的無環檢查沒有意義，也幾乎不可能是玩家的真實意圖，多半是手滑點了兩次同一顆），改成清空
 * linkFromId、把提示寫進 #edit-validation——借用這個既有的訊息區塊而不是新開一個 DOM 元素，
 * 跟 rerender() 失敗時借用同一個區塊顯示「畫面更新失敗」是同一個做法（見該函式的說明）。
 * 這則提示是暫時性的：下一次任何真正的編輯動作（含成功拉一條邊）都會呼叫 runValidation()
 * 蓋掉它，不需要另外清除。
 */
function handleLinkModeNodeClick(id: string): void {
  const validation = document.querySelector<HTMLElement>('#edit-validation');

  if (!linkFromId) {
    linkFromId = id;
    if (validation) validation.textContent = `連線模式：已選前置節點 ${id}，請點選目標節點。`;
    return;
  }

  const fromId = linkFromId;
  linkFromId = null; // 不管接下來成功還是取消，這次「點前置」的狀態都結束了。

  if (fromId === id) {
    if (validation) validation.textContent = `已取消連線：前置與目標不能是同一個節點（${id}）。`;
    return;
  }

  const svg = document.querySelector<HTMLElement>('#edit-canvas-host')?.querySelector('svg');
  const fromEl = svg?.querySelector(`.node[data-id="${fromId}"]`);
  const toEl = svg?.querySelector(`.node[data-id="${id}"]`);
  // id 是從當下畫面上的 .node 讀出來的（bindNodeClicks() 的 downTarget），這裡理論上一定
  // 找得到對應元素；防禦性判斷，避免萬一（例如兩次點擊之間畫面被 rerender 換掉）撞上 null
  // 讓後面的座標讀取直接炸掉整個 handler。
  if (!fromEl || !toEl) return;

  const from = nodeTransformXY(fromEl);
  const to = nodeTransformXY(toEl);
  const next = insertEdge(editorState.svgText, emitEdgeLine(from, to));
  applyEdit(next, `${fromId}→${id}`);
}

/** 三顆模式按鈕的 id，供 setMode() 統一切換 aria-pressed／樣式用。 */
const MODE_BUTTON_ID: Record<EditMode, string> = {
  select: 'edit-mode-select', add: 'edit-mode-add', link: 'edit-mode-link',
};

/**
 * 切換編輯模式：更新 currentMode、清掉連線模式的暫存前置節點（切模式等於放棄這次未完成的
 * 連線操作）、清空面板上按需出現的表單（切到新模式時，上一個模式開著的表單沒有意義了）、
 * 並用 aria-pressed 同步三顆按鈕的視覺狀態（CSS 選一律吃 aria-pressed，不另外維護一個
 * class，單一事實來源，見 edit.astro 的樣式）。
 *
 * 刻意不清 #edit-validation：那裡顯示的是 validateWith() 對目前 svgText 的驗證結果（或
 * handleLinkModeNodeClick() 借位顯示的連線提示），跟「現在是哪個模式」是獨立的兩件事——
 * 玩家若還有未解決的規則錯誤，切模式不該讓那則訊息憑空消失。
 *
 * `restoreHintIfEmpty()`（D15）：切模式之後不會有任何呼叫端接著幫面板補新內容（跟
 * bindNodeClicks()／handleAddModeClick() 不同），清空後若不補回提示，面板就會永久留白。
 */
function setMode(mode: EditMode): void {
  currentMode = mode;
  linkFromId = null;
  const panel = document.querySelector<HTMLElement>('#edit-panel');
  if (panel) {
    clearPanelContent(panel);
    restoreHintIfEmpty(panel);
  }
  currentEditId = null;
  for (const [m, id] of Object.entries(MODE_BUTTON_ID) as [EditMode, string][]) {
    document.getElementById(id)?.setAttribute('aria-pressed', String(m === mode));
  }
}

function bindModeButtons(): void {
  for (const [mode, id] of Object.entries(MODE_BUTTON_ID) as [EditMode, string][]) {
    document.getElementById(id)?.addEventListener('click', () => setMode(mode));
  }
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
 * 每一種會改動 svgText 的操作提交後的唯一入口：套用一段已經算好的新 svgText，標記節點（或
 * Task 13 新增的邊／刪除操作，touchedId 借用某種可以唯一代表這次改動的字串，見各呼叫端）
 * 為已改動，重繪畫布，並跑一次即時驗證。拆成獨立函式（而不是直接寫在各自的事件委派 handler
 * 裡）是因為不同操作組出新 svgText 的方式不一樣——bindFormEdits() 走 getNodeBlock →
 * applyFieldEdits → emitNodeBlock → replaceNode，Task 13 的新增節點走 newNodeBlock →
 * emitNodeBlock → insertNode，拉連線走 emitEdgeLine → insertEdge，刪除節點走 removeEdge
 * （逐條）→ removeNode——但收尾這三步：記 dirty、重繪、驗證，是所有操作共用的，這個函式
 * 從一開始（task-12）就是為了讓後面這些呼叫端都能重用而獨立出來的（原始設計意圖見本檔
 * git 歷史，這裡不重複貼一份過期的「未來任務」預告）。
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
  // 任務簡報 Step 3 定死的條件：`errors.length > 0 || dirty.size === 0` 時停用。有 error
  // 不該讓玩家下載一份會被 CI 擋下的檔案；沒有任何改動（dirty 是空的）則單純沒有東西可下載
  // ——`#edit-download` 在 edit.astro 裡本來就預設 `disabled`（見該檔），這裡是每次驗證後
  // 重新算一次，讓「剛修好最後一個 error」「剛完成第一次編輯」這兩種情況都能即時轉為可用。
  //
  // Task 21 的送出鍵（submitPanelHandle.setEnabled）套用完全相同的條件，理由也相同：
  // 有 error 不該讓玩家送出一個會被 CI 擋下的 PR；沒有改動則沒有東西可送。跟下載鍵共用
  // 同一個布林值（而不是分別各寫一次判斷式），避免兩處各自維護一份「該不該擋住」的邏輯，
  // 日後這個條件要調整時只需要改一個地方。
  const blocked = result.errors.length > 0 || editorState.dirty.size === 0;
  const downloadBtn = document.querySelector<HTMLButtonElement>('#edit-download');
  if (downloadBtn) downloadBtn.disabled = blocked;
  submitPanelHandle?.setEnabled(!blocked);

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

    // 圖示欄位（<input type="file" data-field="icon">）也掛在 #edit-panel 底下，同樣會被
    // 這個委派的 closest('[data-field]') 撈到——但它的改動走的是 bindIconUpload() 的
    // 'change' 委派（讀檔、算雜湊、驗證尺寸），不是這裡的「讀 el.value 套進 FieldEdits」這條
    // 路：file input 的 `.value` 是瀏覽器出於安全性只給假路徑的字串（例如
    // `C:\fakepath\icon.png`），toFieldEdits() 也沒有 'icon' 這個 case（default 分支
    // throw）。主流程「玩家選圖 → 接著點名稱欄位打字」會讓 file input 先失焦，一路撞進這條
    // throw（I1，全分支審查抓到的 Important、22 輪任務審查都漏掉：E2E 測不到是因為
    // `setInputFiles()` 不會改變焦點，這個真實使用者路徑因此完全沒有自動化測試覆蓋過）。
    // 在這裡提早 return，讓圖示欄位的失焦事件單純被忽略——它的改動已經由 bindIconUpload()
    // 處理完了，這裡不需要（也不能）再對它做任何事。
    if (field === 'icon') return;

    const block = getNodeBlock(currentEditId);
    const edits = toFieldEdits(field, el.value);
    const nextBlockText = emitNodeBlock(applyFieldEdits(block, edits));
    const nextSvgText = replaceNode(editorState.svgText, currentEditId, nextBlockText);
    applyEdit(nextSvgText, currentEditId);
  });
}

/**
 * 換圖示（Task 14）：委派在 #edit-panel 上監聽 'change'（跟 bindFormEdits() 的 'focusout'
 * 委派同一個容器、同一個理由——#edit-form 是按需建立的，監聽器掛在活得比它久的 #edit-panel
 * 上才不會漏接）。`<input type="file">` 選好檔案後會觸發會冒泡的原生 'change' 事件，
 * 委派可以直接接住，不需要像 focusout 那樣改聽別的事件名。
 *
 * 玩家從頭到尾不需要知道「雜湊」是什麼（任務簡報的設計要點）：這裡只把 `checkIcon()` 算好
 * 的雜湊拿去命名／存檔／改 `<image href>`，不在畫面上印出雜湊字串本身——成功時只把它掛成
 * `data-icon-hash` 屬性（給自動化測試掛鉤用，見 EditForm.ts 的說明），不當文字內容顯示。
 *
 * 驗證失敗（`check.ok === false`）：**不進 dirty、不改 svgText**，原樣顯示 `check.reason`
 * 就直接 return（任務簡報 Step 4 明講）。這跟其餘欄位「先套用、讓 CI 規則說明哪裡錯」的
 * 哲學不同，是刻意的：圖示的合法性／尺寸不是那種「先套用、CI 規則訊息會講清楚怎麼修」的
 * 錯——玩家沒辦法在表單裡『打對』一張圖片，唯一的修法是重選一張檔案，提早在瀏覽器端擋下、
 * 給出跟 CI 逐字一致的原因，比讓它繞去 svgText 一圈、再被 runValidation() 報同一句話更直接，
 * 也才能滿足「狀態列在這種情況下仍顯示尚未修改」（見任務簡報自我審查清單）。
 *
 * `id`／`statusEl` 都在兩個 `await`（讀檔、算雜湊）之前先算好、存成區域變數，不是等到用的
 * 時候才去讀 `currentEditId`／重新查 DOM：玩家選檔案到瀏覽器讀完位元組、算完雜湊這段期間
 * 是非同步的，若中途切去選了別的節點（`clearPanelContent()` 會把 #edit-form 整個換掉），
 * 這次上傳的圖理應套用到「選檔案當下」那個節點，狀態訊息也該寫回「選檔案當下」那份表單
 * （即使它可能已經被拔出 DOM，寫入不會報錯，只是玩家看不到——這是可以接受的邊界情況，好過
 * 誤把訊息寫進「下一個」節點的表單、或誤把圖套用到「現在」選取的節點）。
 */
function bindIconUpload(): void {
  const panel = document.querySelector<HTMLElement>('#edit-panel');
  if (!panel) return;

  panel.addEventListener('change', async e => {
    const input = (e.target as Element).closest?.('[data-field="icon"]') as HTMLInputElement | null;
    if (!input || !currentEditId) return;
    const file = input.files?.[0];
    if (!file) return;

    const id = currentEditId;
    const statusEl = input.closest<HTMLElement>('#edit-form')?.querySelector<HTMLElement>('[data-icon-status]') ?? null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = await checkIcon(bytes);

    if (!check.ok) {
      if (statusEl) {
        statusEl.textContent = check.reason;
        statusEl.removeAttribute('data-icon-hash');
      }
      return; // 不進 dirty，不改 svgText
    }

    editorState.newIcons.set(check.hash, bytes);
    const block = getNodeBlock(id);
    const next = { ...block, imageXml: setImageHref(block.imageXml, check.hash) };
    if (statusEl) {
      statusEl.textContent = '圖示已更新';
      statusEl.setAttribute('data-icon-hash', check.hash);
    }
    applyEdit(replaceNode(editorState.svgText, id, emitNodeBlock(next)), id);
  });
}

/**
 * 「把『詞』加進白名單」按鈕（Task 14，規則 8）：`renderValidation()`（ValidationPanel.ts）
 * 對比對不到白名單的 `#` 標記提供這顆按鈕（純 DOM 寫入，不掛事件——理由同 EditForm.ts），
 * 這裡接住點擊，把按鈕上 `data-keyword` 帶的詞同時寫進 `editorState.newKeywords`
 * （送出時併入 `data/keywords.json`，見任務簡報「Produces」那行）與 `editorState.keywords`
 * （讓下一輪驗證立刻認得這個詞），再重繪＋重跑一次驗證讓面板轉綠。
 *
 * 委派掛在 #edit-validation（而不是逐一在按鈕上掛監聽器）：`renderValidation()` 每次都用
 * `host.innerHTML` 整段換掉內容，個別掛在按鈕上的監聽器會跟著被丟棄，跟 `bindNodeClicks()`
 * 對節點的事件委派同一個理由；#edit-validation 這個容器本身不會被換掉（只有它的 innerHTML
 * 被覆寫），掛在它上面的監聽器不會失效。
 *
 * 兩個 `includes()` 檢查是防重複，不是防競態：`runValidation()` 是非同步的，這個 handler
 * 不等它跑完就結束，若玩家在它跑完之前又點了同一顆按鈕（此時舊按鈕理論上還沒被新一輪
 * `renderValidation()` 換掉），沒有這兩個檢查會把同一個詞塞進陣列兩次。
 *
 * 這裡呼叫 `rerender()`（不只 `runValidation()`）：加入白名單前，`rerender()` 很可能因為
 * `buildTreeDataWith` 內部的 `extractKeywords` 對這個新詞丟例外而失敗過一次（見該函式的
 * try/catch 說明），畫布因此還停在「加詞之前」的最後一次成功畫面。白名單補上後
 * `buildTreeDataWith` 不會再因為這個詞失敗，重新呼叫 `rerender()` 才能讓畫布跟上這次修正
 * ——跟 `applyEdit()` 的收尾同一個組合（rerender 先、runValidation 後），只是這裡沒有新的
 * svgText／dirty 要記錄，所以不能直接呼叫 applyEdit()，得照抄它的收尾兩步。
 */
function bindValidationActions(): void {
  const validation = document.querySelector<HTMLElement>('#edit-validation');
  if (!validation) return;

  validation.addEventListener('click', e => {
    const btn = (e.target as Element).closest?.('[data-action="add-keyword"]') as HTMLElement | null;
    if (!btn) return;
    const word = btn.dataset.keyword;
    if (!word) return;

    if (!editorState.newKeywords.includes(word)) editorState.newKeywords.push(word);
    if (!editorState.keywords.includes(word)) editorState.keywords.push(word);
    rerender();
    runValidation();
  });
}

/**
 * 新增節點暫時沒有圖示上傳（那是 Task 14「新增圖示與新增關鍵字」的範圍——玩家選圖片、
 * checkIcon 驗證、算雜湊、存進 editorState.newIcons，是完全獨立的一段流程）。這裡固定用
 * repo 裡已經存在、也已經被其他節點引用的一張圖示（"a5caff6da1d2"，跟 tests/lib/
 * svg-edit.test.ts 的整合測試用同一張）當佔位圖：它已經在 editorState.iconHashes 裡，
 * 規則 7(a)「節點引用的圖示必須存在」對新節點必然通過，不需要玩家在能看到成果之前先解決
 * 「這張圖從哪來」的問題。玩家之後可以用 Task 14 的功能換成真正的圖示。
 */
const NEW_NODE_DEFAULT_ICON_HASH = 'a5caff6da1d2';

/**
 * NodeType → data-type 中文字串。跟 NodeDetail.ts 的 TYPE_ZH、NewNodeForm.ts 的 TYPE_ZH
 * 是同一份對照表的三份獨立副本——這個專案裡每個要顯示中文類型名稱的檔案都各自維護一份小
 * 常數表（NodeDetail.ts 已經是這個先例），不集中成共用模組；四個 entry 的小表格重複比多引入
 * 一層跨檔案相依划算，這裡沿用既有慣例。
 */
const NEW_NODE_TYPE_ZH: Record<NodeType, string> = {
  dice: '骰子', rune: '骰子符文', passive: '玩家被動', support: '支援',
};

/** 從 #new-node 表單讀出玩家填的所有欄位。純讀取，不做任何格式驗證——不合法的值（例如
 *  成本欄位打錯格式）留給 createNewNodeFromForm() 之後的 runValidation() 用規則 4 等
 *  對得上編號的錯誤訊息說明，不在這裡提前用另一套邏輯攔一次（EditForm.ts 的欄位提交也是
 *  同樣的「先套用、讓 CI 規則說明哪裡錯」哲學，這裡沿用一致的做法）。 */
function readNewNodeFields(form: HTMLElement): {
  branch: string; type: string; prefix: string;
  name: string; label: string; cost: string; description: string; maxLevel: number | null;
} {
  const value = (field: string): string =>
    form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-field="${field}"]`)?.value ?? '';
  const maxLevelRaw = value('maxLevel').trim();
  return {
    branch: value('branch'), type: value('type'), prefix: value('prefix'),
    name: value('name'), label: value('label'), cost: value('cost'), description: value('description'),
    maxLevel: maxLevelRaw === '' ? null : Number(maxLevelRaw),
  };
}

/**
 * 「建立節點」：讀表單欄位、配 id、決定 stroke、組出節點區塊並 insertNode。
 *
 * id 用「當下」（呼叫這個函式那一刻）重新掃描 editorState.svgText 配出來的 existingIds，
 * 不是 NewNodeForm 開啟當時傳入的 ctx.existingIds 快照——見 NewNodeForm.ts renderNewNodeForm()
 * 文件註解的說明，避免快照過期配出重複 id。
 *
 * stroke 用 strokeOfElement() 反查，不讓玩家選色：這是任務簡報的設計核心，讓 CI 規則 3
 * 「外框顏色要對應屬性分支」對編輯器使用者不可能違反。支援類型的 element 固定是 'support'
 * （不跟著分支選擇走，即使 newNodeBlock 對 support 類型的樣板其實根本不吃這個 stroke 參數、
 * 寫死 #f3c5ff，這裡仍然算出「語意正確」的值傳進去——不依賴呼叫端知道樣板的這個實作細節，
 * 也是 build-tree.ts 讀真實資料時 elementOfStroke() 反推出來的值，兩者要對得上）；其餘三種
 * 類型的 element 就是分支本身（實測驗證過現有 239 個節點的 branch／element 除了 support
 * 以外恆相等，沒有例外）。
 */
function createNewNodeFromForm(x: number, y: number, form: HTMLElement): void {
  const f = readNewNodeFields(form);
  const branch = f.branch as Branch;
  const type = f.type as NodeType;
  const element = type === 'support' ? 'support' : branch;

  const existingIds = [...locateNodeBlocks(editorState.svgText).keys()];
  const id = allocateId(existingIds, f.prefix);

  const block = emitNodeBlock(newNodeBlock({
    x, y, id, type, typeZh: NEW_NODE_TYPE_ZH[type],
    name: f.name, label: f.label, cost: f.cost, description: f.description,
    maxLevel: f.maxLevel, stroke: strokeOfElement(element), iconHash: NEW_NODE_DEFAULT_ICON_HASH,
  }));
  const next = insertNode(editorState.svgText, block);
  applyEdit(next, id);
}

/**
 * 委派在 #edit-panel 上監聽 #new-node 裡「建立」／「取消」兩顆按鈕的 click（跟
 * bindFormEdits() 的 focusout 委派同一個容器、同一個理由：#new-node 是按需建立的，
 * 監聽器掛在活得比它久的 #edit-panel 上才不會漏接）。
 *
 * 兩個分支收尾都呼叫 `restoreHintIfEmpty()`（D15）：`form.remove()` 之後面板沒有任何呼叫端
 * 會接著補新內容（不像選取節點／新增模式點畫布那兩條「清空後馬上補表單」的路徑），不補回
 * 提示的話，玩家取消新增節點、或成功建立節點後（新節點不會自動被選取、開出它的欄位表單，
 * 那是另一個問題，不在這次修的範圍），面板會永久留白。
 */
function bindNewNodeFormActions(): void {
  const panel = document.querySelector<HTMLElement>('#edit-panel');
  if (!panel) return;

  panel.addEventListener('click', e => {
    const target = e.target as Element;
    const form = target.closest<HTMLElement>('#new-node');
    if (!form) return;

    if (target.closest('[data-action="cancel"]')) {
      form.remove();
      restoreHintIfEmpty(panel);
      return;
    }
    if (target.closest('[data-action="create"]')) {
      // 座標是 handleAddModeClick() 開表單當下算好、存在表單容器自己的 dataset 上的
      // （見該函式的說明），這裡讀回來即可，不需要重新換算一次滑鼠座標。
      // 讀欄位（createNewNodeFromForm 內部呼叫 readNewNodeFields）要在 form.remove() 之前
      // 做——雖然 querySelector 在已經拔出 DOM 的元素上一樣能查到自己的子孫節點，這裡刻意
      // 保持「先讀、再移除」的直覺順序，不依賴這個不直觀的 DOM 行為。
      const x = Number(form.dataset.x);
      const y = Number(form.dataset.y);
      createNewNodeFromForm(x, y, form);
      form.remove();
      restoreHintIfEmpty(panel);
    }
  });
}

/**
 * 選取模式下按 Delete 鍵刪除目前選取的節點，連同所有以它為端點的邊，需二次確認
 * （`window.confirm`——最單純的原生二次確認機制，這個操作沒有復原機制，值得用瀏覽器原生、
 * 玩家一定認得的阻斷式對話框，不必為此另外做一個自訂確認 UI）。
 *
 * ⚠️ 只在 currentMode === 'select' 且事件目標不是輸入型欄位（input/textarea/select）時才
 * 觸發：玩家在表單欄位裡打字刪字元也會送出 Delete 鍵事件，若不排除，會變成「玩家想刪一個
 * 字，結果把整個節點刪掉」——這是判斷全域鍵盤事件時容易漏掉的陷阱，見 bindDeleteShortcut()。
 */
function deleteSelectedNode(): void {
  const id = currentEditId;
  if (!id) return;

  const confirmed = window.confirm(`確定要刪除節點 ${id} 嗎？將一併移除所有連到它的邊，此操作無法復原。`);
  if (!confirmed) return;

  const svg = document.querySelector<HTMLElement>('#edit-canvas-host')?.querySelector('svg');
  let next = editorState.svgText;
  // 連到這個節點的邊，用畫面上渲染出來的 <line class="edge" data-from data-to> 找——
  // render.ts 幫每條邊都寫了這兩個屬性，直接查比自己重新掃描 editorState.svgText 的原始
  // <path> 找端點簡單，且座標一樣走 nodeTransformXY() 讀畫面上的節點 transform，跟連線模式
  // 用同一套機制，保證找到的座標精準對應 removeEdge() 需要的值。
  const touchingEdges = svg?.querySelectorAll(`.edge[data-from="${id}"], .edge[data-to="${id}"]`) ?? [];
  for (const edge of touchingEdges) {
    const fromId = edge.getAttribute('data-from');
    const toId = edge.getAttribute('data-to');
    const fromEl = fromId ? svg?.querySelector(`.node[data-id="${fromId}"]`) : null;
    const toEl = toId ? svg?.querySelector(`.node[data-id="${toId}"]`) : null;
    if (!fromEl || !toEl) continue; // 理論上不會發生：data-from/data-to 是渲染時從同一份 data.edges 寫入的，端點節點必然存在
    next = removeEdge(next, nodeTransformXY(fromEl), nodeTransformXY(toEl));
  }
  next = removeNode(next, id);

  // restoreHintIfEmpty()（D15）：刪掉的正是目前開著表單的節點，清空後不會有任何呼叫端接著
  // 補新內容（applyEdit() 只重繪畫布／跑驗證，不碰 #edit-panel），不補回提示的話面板會永久
  // 留白。
  const panel = document.querySelector<HTMLElement>('#edit-panel');
  if (panel) {
    clearPanelContent(panel);
    restoreHintIfEmpty(panel);
  }
  currentEditId = null;
  applyEdit(next, id);
}

function bindDeleteShortcut(): void {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Delete') return;
    if (currentMode !== 'select') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select')) return; // 正在編輯欄位文字，這個 Delete 是刪字元，不是刪節點
    deleteSelectedNode();
  });
}

/**
 * 觸發瀏覽器原生下載：建一個不掛進 DOM 的 `<a download>`，設好 blob URL 就點一下丟掉。
 * 跟 overlayNewIcons() 的 blob URL 用法不同的地方：那邊的 URL 要跨渲染輪次存活（疊在畫布上
 * 顯示，玩家可能盯著看好一陣子），這裡的 URL 只需要活到「瀏覽器接手這次下載」那一刻，
 * `a.click()` 觸發下載是同步動作，緊接著 revoke 是安全的（跟任務簡報 Step 3 給的參考實作
 * 逐字一致），不需要像 activeIconBlobUrls 那樣另外用模組級陣列追蹤存活時間。
 */
function downloadBlob(filename: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * 下載按鈕（Task 11 就放進 DOM，這個任務才接功能）：這是 P1 的驗收點——玩家在 `/edit`
 * 完成所有編輯後，靠這顆按鈕把改好的 SVG 存下來手動送 PR；也是 P2（OAuth 一鍵送出）的
 * 安全網，萬一那段出意外，這條路徑仍然可用。啟用狀態由 runValidation() 依
 * `errors.length > 0 || dirty.size === 0` 統一控制（見該函式），這裡只管「被按下時做什麼」。
 *
 * 有新增圖示（`editorState.newIcons`，Task 14 換圖示流程還沒進 repo 的那些）時一併下載——
 * 檔名直接用雜湊（`${hash}.png`，跟 `data/icons/` 的既有命名規則相同），玩家不需要自己
 * 幫圖示命名，選好檔案存下來、整批丟進 `data/icons/` 即可（見更新後的 CONTRIBUTING.md
 * 第 0 節）。SVG 先下載、圖示照 Map 迭代順序接著下載，不特別排序：這批圖示本來就是玩家
 * 自己這次操作新增的，數量小（單一節點一次只能換一張），順序對玩家沒有意義。
 */
function bindDownload(): void {
  const downloadBtn = document.querySelector<HTMLButtonElement>('#edit-download');
  if (!downloadBtn) return;

  downloadBtn.addEventListener('click', () => {
    downloadBlob('dice-tree.svg', new Blob([editorState.svgText], { type: 'image/svg+xml' }));
    for (const [hash, bytes] of editorState.newIcons) {
      // new Uint8Array(bytes) 同一個型別坑（見 overlayNewIcons() 的說明）：TS 5.7+ 把
      // TypedArray 的 buffer 泛型化成 ArrayBufferLike，跟 DOM BlobPart 要的
      // ArrayBuffer-backed TypedArray 對不上，內容不變，只是讓型別對得上。
      downloadBlob(`${hash}.png`, new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    }
  });
}

boot();
