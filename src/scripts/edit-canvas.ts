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
    if (viewportGroup) new Viewport(svg, viewportGroup);
    currentNodesById = new Map(data.nodes.map(n => [n.id, n]));
    if (validation) validation.textContent = '';
  } catch (err) {
    if (validation) {
      const msg = err instanceof Error ? err.message : String(err);
      validation.textContent = `畫面更新失敗，已保留上一次的畫面：${msg}`;
    }
  }
}

/**
 * 點一個節點時，在右側面板顯示它的欄位（本任務先只顯示名稱；完整欄位表單是 Task 12 的事）。
 * 用事件委派掛在 #edit-canvas-host 上，而不是逐一在每個 .node 上掛監聽器：rerender()
 * 每次都會用 replaceChildren() 整批換掉畫布內容，掛在個別節點上的監聽器會跟著被丟棄，
 * 掛在容器上則不受影響（跟 tree-canvas.ts 的關鍵字 chip 事件委派是同一個理由）。
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

  host.addEventListener('click', e => {
    const g = (e.target as Element).closest?.('.node');
    if (!g) return;
    const id = g.getAttribute('data-id');
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

boot();
