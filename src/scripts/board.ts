// 骰盤編輯器的客戶端行為。
//
// 這一支只做兩件事：把使用者的操作翻譯成 src/lib/board.ts 的純函式呼叫，然後把新狀態
// 畫回 DOM。任何「放哪、換哪、清哪」的判斷都不寫在這裡——那些在 lib 裡，有單元測試。
//
// 「一盤」（骰盤＋隊伍列＋局外加成切換）的狀態與綁定已經抽到 src/scripts/board-side.ts 的
// createSide()；留在這裡的是**全頁只有一份**的東西：數值卡片、加成明細面板、加成高亮、
// 挑選網格、/sim 存檔、live region、工具列，以及對戰／合作的模式切換與它要搬的 DOM。
import { setDeckSlot } from '../lib/board.js';
import { renderShareImage } from './board-export.js';
import { boardBuffs, buffHighlights, pendingHint, type CellBuffs } from '../lib/board-buffs.js';
import { cardTitle, placeCard } from '../lib/board-card.js';
import { createSide, type Side } from './board-side.js';
import type { StatParams } from '../lib/dice-calc.js';
import type { NamedEffect } from '../lib/offgame.js';
import {
  bonusCardModel, detailLines,
  type OffgameMode, type SaveLevels,
} from '../lib/offgame-calc.js';
import { SIM_STORAGE_KEY, deserializeSim } from '../lib/sim-io.js';
import { ownedIds } from '../lib/sim.js';
import { decodeSaveContext, type SaveContextWire } from '../lib/sim-save-lite.js';
import type { Branch } from '../lib/types.js';

const grid = document.getElementById('board-grid');
const deckH = document.getElementById('deck-h');
const deckRow = document.getElementById('deck-row');
const deckLegend = document.getElementById('deck-legend');
const picker = document.getElementById('dice-picker');
const pickerClose = document.getElementById('picker-close');
const live = document.getElementById('board-live');
const card = document.getElementById('dice-card');
const statsEl = document.getElementById('board-stats');
const offgameEl = document.getElementById('offgame-mode');
const nosaveEl = document.getElementById('offgame-nosave');
const offgameDataEl = document.getElementById('board-offgame');
const detailEl = document.getElementById('dice-detail');
const boardTools = document.getElementById('board-tools');
const boardStage = document.querySelector<HTMLElement>('.board-stage');
const boardPage = document.querySelector<HTMLElement>('.board-page');
// 隊友那一盤與模式切換鈕。DOM 永遠在（board.astro 直接輸出），對戰模式下只是 hidden。
const coopModeEl = document.getElementById('board-coop-mode');
const partnerDeckH = document.getElementById('partner-deck-h');
const partnerOffgameEl = document.getElementById('partner-offgame-mode');
const partnerNosaveEl = document.getElementById('partner-offgame-nosave');
const partnerDeckRow = document.getElementById('partner-deck-row');
const partnerLegend = document.getElementById('partner-deck-legend');
const partnerGrid = document.getElementById('partner-grid');
const divider = document.querySelector<HTMLElement>('.board-divider');

// 這一頁的每一個元素都是 board.astro 直接輸出的靜態 DOM。任何一個抓不到都代表版面被改壞
// 了，這時候什麼都不做比做一半好——不要用 `?.` 一路吞下去，那會變成「畫面沒反應也沒錯誤」。
if (grid && deckH && deckRow && deckLegend && picker && pickerClose && live && card && statsEl
  && offgameEl && nosaveEl && offgameDataEl && detailEl && boardTools && boardStage && boardPage
  && coopModeEl && partnerDeckH && partnerOffgameEl && partnerNosaveEl && partnerDeckRow
  && partnerLegend && partnerGrid && divider) {
  /** 目前正在替哪一盤的哪一個組合槽挑骰子；null＝挑選網格是關的。挑選網格全頁只有一個。 */
  let pickingSlot: { side: Side; slot: number } | null = null;

  /**
   * 合作模式（預設關＝對戰）。**不存 localStorage**，重整回到對戰——這一頁什麼都不存。
   *
   * 它只決定三件事：隊友那一組 DOM 顯不顯示、我的隊伍列擺在骰盤的哪一側（applyCoopLayout()），
   * 以及算盤面加成時要不要把另一盤當 partner 傳進去（buffsOf()）。對戰模式下每一條路徑都要
   * 跟這個模式出現之前逐項相同。
   */
  let coop = false;

  /**
   * 兩盤在畫面文字裡的稱呼。
   *
   * ⚠️ 同一個詞在這一頁有兩種用法，不要混：**標題前綴**（「隊友盤 火骰子 3 骰點」）說的是
   * 「這張卡片／這個面板現在描述的是哪一盤」；**明細裡的盤名**（board-buffs.ts 的 partnerLabel）
   * 說的是「這個加成的來源在哪一盤」。兩者在同一個畫面上同時出現，方向相反——所以看隊友盤的
   * 卡片時，明細裡的來源盤要寫「我的盤」（buffsOf() 負責傳），兩個詞才不會互相打架。
   */
  const MY_BOARD = '我的盤';
  const PARTNER_BOARD = '隊友盤';
  /** 隊友那一盤的播報前綴（見 board-side.ts 的 SideOptions.announcePrefix）。 */
  const PARTNER_SAY = `${PARTNER_BOARD}：`;

  /** 數值卡片的計算參數（board.astro 建置期注入），以骰子 id 為鍵。 */
  const statParams = JSON.parse(statsEl.textContent ?? '{}') as Record<string, StatParams[]>;
  const cardTitleEl = card.querySelector<HTMLElement>('.dice-card-title')!;
  const cardRows = card.querySelector<HTMLElement>('.dice-card-rows')!;
  const cardNote = card.querySelector<HTMLElement>('.dice-card-note')!;

  // ---- 局外加成（骰子樹符文／玩家被動）----
  // 語意表與讀存檔用的精簡 context 在建置期壓好（board.astro 的 #board-offgame）。計算全在
  // src/lib/offgame-calc.ts，這裡只決定「用哪一種等級來源」並把結果畫進卡片與明細面板。
  const offgame = JSON.parse(offgameDataEl.textContent ?? '{}') as {
    effects: Record<string, NamedEffect>; branches: Record<string, Branch>; save: SaveContextWire;
  };

  /**
   * 唯讀 /sim 的存檔。讀不到、壞掉、版本不符一律當作沒有存檔。
   *
   * ⚠️ 只讀不寫：/board 仍然不存任何東西。localStorage 在無痕模式、或使用者關掉網站資料時會直接
   * 丟例外（不是回 null），所以包 try。存檔的解讀（改版漂移：節點移除、上限調低、前置不齊、新增等級條件）
   * 全部交給 deserializeSim()，不在這裡另寫一份。
   */
  function readSimSave(): SaveLevels | null {
    let text: string | null;
    try {
      text = localStorage.getItem(SIM_STORAGE_KEY);
    } catch {
      return null;
    }
    const ctx = decodeSaveContext(offgame.save);
    const state = deserializeSim(text, ctx);
    return state ? { owned: ownedIds(state, ctx), levels: state.levels } : null;
  }
  /** 頁面開著時存檔可能變（見 refreshSave()），所以是 let。存檔全頁只有一份，兩盤共用。 */
  let simSave = readSimSave();
  const MODE_NOTE: Record<OffgameMode, string> = {
    none: '未含骰子樹（符文／被動）加成',
    sim: '局外加成：我的 /sim 存檔',
    max: '局外加成：全部練滿',
  };

  /** 骰子的顯示資料，直接從挑選網格的按鈕讀回來——那 41 顆已經在 HTML 裡了，
   *  再從別的地方載一次只會多一份會漂移的副本。 */
  const diceMeta = new Map<string, { name: string; icon: string }>();
  for (const btn of picker.querySelectorAll<HTMLButtonElement>('.picker-dice')) {
    const id = btn.dataset.diceId;
    const img = btn.querySelector('img');
    const name = btn.querySelector('span')?.textContent ?? '';
    if (id && img) diceMeta.set(id, { name, icon: img.getAttribute('src') ?? '' });
  }

  function announce(msg: string): void {
    live!.textContent = msg;
  }

  /**
   * 這兩個回呼**兩盤共用**。合作模式下任何一盤的改動都可能改到另一盤的數值（跨盤加成），
   * 所以「是誰變了」不影響要做什麼：開著的那張原地重算，明細跟上。
   * 兩者的差別（卡片收不收）見 SideOptions 的 doc。
   */
  const onChange = (): void => {
    if (openOn !== null) openCard(openOn.side, openOn.index);
    renderDetail();
  };
  const onBoardChange = (): void => {
    closeCard();
    renderDetail();
  };

  /**
   * 這一頁的兩盤：`me` 是我的，`partner` 是隊友的（合作模式才顯示，DOM 一直都在）。
   *
   * ⚠️ 傳進去的回呼都是「跨盤協調」：卡片、明細、挑選網格全頁各只有一份，由這裡決定它們
   * 要對哪一盤反應——每一盤各自 close 住自己，`openCard`／`openPicker` 才知道是誰在叫。
   */
  const me = createSide(
    { grid, deckRow, offgameEl, nosaveEl },
    {
      offgame,
      statParams,
      simSave: () => simSave,
      /** 預設：讀得到存檔就用它，否則「不含」。切換狀態不存（重整回到預設）。 */
      defaultMode: simSave ? 'sim' : 'none',
      diceMeta,
      namePrefix: '',
      announce,
      announcePrefix: '',
      onChange,
      onBoardChange,
      openCard: i => openCard(me, i),
      closeCard,
      openPicker: slot => openPicker(me, slot),
      syncCardToFocus,
    },
  );

  const partner = createSide(
    { grid: partnerGrid, deckRow: partnerDeckRow, offgameEl: partnerOffgameEl, nosaveEl: partnerNosaveEl },
    {
      offgame,
      statParams,
      simSave: () => simSave,
      /** 隊友的符文等級我們永遠拿不到，所以預設是「全滿」＝上界，不是「不含」。 */
      defaultMode: 'max',
      diceMeta,
      /** 無障礙名稱的前綴，跟 board.astro 輸出的隊友端靜態標記逐字相同（見 SideOptions）。 */
      namePrefix: '隊友',
      announce,
      announcePrefix: PARTNER_SAY,
      onChange,
      onBoardChange,
      openCard: i => openCard(partner, i),
      closeCard,
      openPicker: slot => openPicker(partner, slot),
      syncCardToFocus,
    },
  );

  /** 以某一盤為主角時，另一盤是誰。 */
  function sidesFor(active: Side): { self: Side; other: Side } {
    return active === me ? { self: me, other: partner } : { self: partner, other: me };
  }

  /**
   * 卡片與明細面板的標題前綴。
   *
   * ⚠️ 兩者全頁各只有一份、兩盤共用：「火骰子 3 骰點」在兩盤上逐字相同，不標的話使用者看不出
   * 眼前這一張講的是哪一盤——明細面板尤其要，它在卡片收起之後還留著最後那顆（見 detail 的說明）。
   * 隊友盤只在合作模式看得見，所以這個前綴不必再看 coop：對戰模式下走不到 side === partner。
   */
  const titlePrefix = (side: Side): string => (side === partner ? `${PARTNER_BOARD} ` : '');

  /** 這個元素在哪一盤的骰盤裡；兩盤都不是＝null。 */
  function sideOfCell(el: Node): Side | null {
    if (me.dom.grid.contains(el)) return me;
    if (partner.dom.grid.contains(el)) return partner;
    return null;
  }

  /**
   * 某一盤的盤面加成（每格一份）。骰盤、強化 Lv、局外模式、存檔任一改變都可能改到任何一格——光的強化 Lv 會改到
   * 它照到的鄰格——所以每次要用就整盤重算（15 格，量很小），不做快取失效。
   *
   * **合作模式才把另一盤傳進去**：對戰模式下傳的是 undefined，算出來的與 partner 這個欄位
   * 出現之前逐項相同。
   */
  function buffsOf(active: Side): CellBuffs[] {
    const { self, other } = sidesFor(active);
    return boardBuffs({
      ...self.buffSide(),
      // ⚠️ crossDir 是「另一盤上會跨盤打到這一盤的排序方向」，兩份剛好相反：算我的盤時隊友盤畫在
      // 上面，它箭頭往下（2）那顆才打到我；算隊友盤那一份時我的盤在下面，要的是箭頭往上（0）。
      // 兩邊寫同一個值的話，會有一盤靜靜地完全沒有跨盤排序。
      partner: coop ? { ...other.buffSide(), crossDir: other === me ? 0 : 2 } : undefined,
      // ⚠️ 明細文字裡的「另一盤」要照**使用者看到的**那一盤講：算隊友盤的加成時 other 就是
      // 使用者自己的盤，照 boardBuffs() 的預設印出來會寫成「隊友盤」，指到相反的地方。
      partnerLabel: other === me ? MY_BOARD : PARTNER_BOARD,
    });
  }

  const detailEmpty = detailEl.querySelector<HTMLElement>('.detail-empty')!;
  const detailBody = detailEl.querySelector<HTMLElement>('.detail-body')!;
  const detailTitle = detailEl.querySelector<HTMLElement>('.detail-title')!;
  const detailNothing = detailEl.querySelector<HTMLElement>('.detail-nothing')!;
  const detailOffgameH = detailEl.querySelector<HTMLElement>('.detail-offgame-h')!;
  const detailOffgame = detailEl.querySelector<HTMLElement>('.detail-offgame')!;
  const detailMechanicH = detailEl.querySelector<HTMLElement>('.detail-mechanic-h')!;
  const detailMechanic = detailEl.querySelector<HTMLElement>('.detail-mechanic')!;
  const detailBoardH = detailEl.querySelector<HTMLElement>('.detail-board-h')!;
  const detailBoard = detailEl.querySelector<HTMLElement>('.detail-board')!;

  /**
   * 明細面板描述的是哪一盤的哪一格的哪一顆骰子；null＝空狀態。
   *
   * 跟 openOn 分開：卡片收起後面板**保留**最後那顆（手機的面板在頁面最底，要往下捲才看得到，
   * 收掉就來不及看）。記 diceId／pips 是為了分辨「那一格還是不是同一顆」——被拖走、被換掉之後回到
   * 空狀態，不讓面板描述一顆已經不在那裡的骰子。記 side 是因為合作模式下同一個 index 在兩盤是
   * 不同的格子，而面板要描述的是被點的那一盤（盤面加成也要照那一盤算）。
   */
  let detail: { side: Side; index: number; diceId: string; pips: number } | null = null;

  function fillList(heading: HTMLElement, list: HTMLElement, lines: readonly string[]): void {
    list.replaceChildren(...lines.map(text => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
    heading.hidden = lines.length === 0;
    list.hidden = lines.length === 0;
  }

  function renderDetail(): void {
    const p = detail ? detail.side.state.board[detail.index] : null;
    if (!detail || !p || p.diceId !== detail.diceId || p.pips !== detail.pips) {
      detail = null;
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      return;
    }
    const side = detail.side;
    const lv = side.spLevelOf(p.diceId);
    const lines = detailLines(statParams[p.diceId] ?? [], p.pips, lv, side.appliedFor(p.diceId));
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailTitle.textContent = titlePrefix(side) + cardTitle(diceMeta.get(p.diceId)?.name ?? p.diceId, p.pips, lv);
    fillList(detailOffgameH, detailOffgame, lines.offgame);
    fillList(detailMechanicH, detailMechanic, lines.mechanic);
    // 盤面：這一格拿到的每個來源一行；方向／種類還沒指定的排序、齒輪二階自己再多一行提示。
    const hint = pendingHint(p);
    fillList(detailBoardH, detailBoard, [...(buffsOf(side)[detail.index]?.entries ?? []).map(e => e.text), ...(hint ? [hint] : [])]);
    detailNothing.hidden = lines.offgame.length + lines.mechanic.length > 0;
    detailNothing.textContent = side.state.mode === 'none' ? '局外加成設為「不含」' : '這顆骰子沒有局外加成';
  }

  /**
   * 數值卡片開在哪一盤的哪一格；null＝關著。
   *
   * ⚠️ 開卡片刻意**不綁 click**：拖曳結束時瀏覽器補送的那發 click 會被 setPointerCapture 導回來源格
   * （見 justDragged 的說明），綁 click 就得把 justDragged 的消費擴到骰盤，而觸控拖曳根本不送 click
   * ——這一頁為同一族問題修過三次。改在 endDrag() 裡判斷「從格子起手、沒超過位移門檻」：
   * 點格子本來就走 pointerdown → startDrag → pointerup → endDrag，滑鼠與觸控同一條路。
   * 鍵盤走 focusin（只認 :focus-visible），跟指標路徑共用 openCard()。
   */
  let openOn: { side: Side; index: number } | null = null;

  function cellEl(side: Side, i: number): HTMLElement | null {
    return side.dom.grid.querySelector<HTMLElement>(`.board-cell[data-index="${i}"]`);
  }

  function openCard(side: Side, i: number): void {
    // 卡片與挑選網格互斥，這裡守「網格開著時不開卡片」（另一半在 openPicker()）。網格沒有焦點陷阱，
    // Tab 會從最後一顆骰子走進骰盤第 0 格（focusin）；網格是貼著視窗底部的浮層，上方露出來的格子也點得到
    // （endDrag）。⚠️ 不要改成 closePicker()：它會把焦點送回組合槽，正在 Tab 的鍵盤使用者會被拉出骰盤。
    if (pickingSlot !== null) {
      closeCard();
      return;
    }
    const p = side.state.board[i];
    if (!p) {
      closeCard();
      return;
    }
    // 換格或換盤都要把上一格的關聯拿掉：aria-describedby 只能指著卡片現在描述的那一格。
    if (openOn !== null && (openOn.side !== side || openOn.index !== i)) {
      cellEl(openOn.side, openOn.index)?.removeAttribute('aria-describedby');
    }
    openOn = { side, index: i };
    const here = buffsOf(side)[i]!;
    const m = bonusCardModel(
      diceMeta.get(p.diceId)?.name ?? p.diceId, p.pips, side.spLevelOf(p.diceId), statParams[p.diceId] ?? [], side.appliedFor(p.diceId), here,
    );
    cardTitleEl.textContent = titlePrefix(side) + m.title;
    cardRows.replaceChildren(...m.rows.flatMap(r => {
      const dt = document.createElement('dt');
      dt.textContent = r.label;
      const dd = document.createElement('dd');
      dd.textContent = r.value;
      if (r.sub) {
        // 「子彈實際」：子彈%符文不在遊戲面板的攻擊力裡（發射時才乘），小一號附在攻擊力下面。
        dt.className = 'bullet';
        dd.className = 'bullet';
      }
      if (r.bonus) {
        // 照遊戲局內面板的「750 (+516)」：括號是局外加成＋盤面加成的貢獻（--bonus 綠色）。
        const b = document.createElement('span');
        b.className = 'bonus';
        b.textContent = r.bonus;
        dd.append(' ', b);
      }
      return [dt, dd];
    }));
    // 卡片底下那一句講的是「這個數字算了什麼、沒算什麼」，三段依序接：局外加成的模式 →
    // 合作限定的免責 → 盤面加成。
    // ⚠️ 合作那一段不可以省：客戶端有三條**只在合作模式生效**的規則不在這一頁的計算層裡
    // （依盤上 7 骰點的數量增傷、依空格數增傷、流效果反號），不寫的話合作玩家會以為卡片
    // 已經把合作模式的東西算全了。
    // 盤面加成不受局外模式影響：這一格有的話才補那一段，否則「不含」下出現括號會跟註記矛盾。
    cardNote.textContent = MODE_NOTE[side.state.mode]
      + (coop ? '；未含合作限定的局內規則' : '')
      + (here.entries.length > 0 ? '；含盤面加成' : '');
    card!.hidden = false;
    cellEl(side, i)?.setAttribute('aria-describedby', 'dice-card');
    renderHighlights();
    detail = { side, index: i, diceId: p.diceId, pips: p.pips };
    renderDetail();
    positionCard();
  }

  /**
   * 卡片開著時標出盤面加成的來源格（.buff-src）與目標格（.buff-dst）；卡片關著就兩盤都清掉。
   *
   * 合作模式下來源與目標可能在另一盤上，所以兩盤都要套：buffHighlights() 回傳的
   * srcPartner／dstPartner 就是另一盤那一份。⚠️ 第三個參數要傳**對調參數算出來的那一份**
   * （buffsOf(other) 自己就會把 self 當成它的 partner），方向才正確——見 board-buffs.ts 的說明。
   */
  function renderHighlights(): void {
    if (openOn === null) {
      applyHighlights(me, [], []);
      applyHighlights(partner, [], []);
      return;
    }
    const { self, other } = sidesFor(openOn.side);
    const h = buffHighlights(buffsOf(self), openOn.index, coop ? buffsOf(other) : undefined);
    applyHighlights(self, h.src, h.dst);
    applyHighlights(other, h.srcPartner, h.dstPartner);
  }

  function applyHighlights(side: Side, src: readonly number[], dst: readonly number[]): void {
    for (const cell of side.dom.grid.querySelectorAll<HTMLElement>('.board-cell')) {
      const j = Number(cell.dataset.index);
      cell.classList.toggle('buff-src', src.includes(j));
      cell.classList.toggle('buff-dst', dst.includes(j));
    }
  }

  /** 依目前格子位置擺卡片。捲動與縮放時也要重擺：卡片是 fixed，格子不是。 */
  function positionCard(): void {
    if (openOn === null) return;
    const { side, index } = openOn;
    const cell = cellEl(side, index);
    if (!cell) return;
    // 開在遠離**那一盤自己**隊伍列的那一側（桌機我的隊伍列在骰盤上方、手機沉到下方；合作模式下
    // 我的在骰盤下方、隊友的在他那盤上方），改強化 Lv 時才看得到按鈕。
    const prefer = side.dom.deckRow.getBoundingClientRect().top < side.dom.grid.getBoundingClientRect().top ? 'below' : 'above';
    // 導覽列是 sticky 的（z-index 40），卡片是 45：上緣要讓到導覽列的下緣，否則往上開會畫在導覽列上面
    // （手機 320px 點第一列的格子就會）。⚠️ 用量的、不寫死高度——這個 repo 不准有固定偏移量
    // （CLAUDE.md「版面沒有固定偏移量」），導覽列在窄螢幕會橫捲，高度也跟著字級走。
    const navBottom = document.getElementById('site-nav')?.getBoundingClientRect().bottom ?? 0;
    const { left, top } = placeCard(
      cell.getBoundingClientRect(),
      { width: card!.offsetWidth, height: card!.offsetHeight },
      { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      prefer,
      navBottom,
    );
    card!.style.left = `${left}px`;
    card!.style.top = `${top}px`;
  }

  function closeCard(): void {
    if (openOn === null) return;
    cellEl(openOn.side, openOn.index)?.removeAttribute('aria-describedby');
    openOn = null;
    card!.hidden = true;
    renderHighlights();
  }

  /** 鍵盤路徑：焦點（:focus-visible）停在有骰子的格子上就開那一格，否則關。 */
  function syncCardToFocus(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.classList.contains('board-cell') && el.matches(':focus-visible')) {
      const side = sideOfCell(el);
      const i = Number(el.dataset.index);
      if (side && side.state.board[i]) {
        openCard(side, i);
        return;
      }
    }
    closeCard();
  }

  /**
   * 焦點／指標落在局外加成切換上。
   *
   * ⚠️ 不可以寫成 `closest('#offgame-mode')`：那是 id，隊友那一組（#partner-offgame-mode）
   * 永遠配不到——改隊友的局外加成時，開著的卡片會被靜靜收掉，而同一個動作在我的那盤完全正常。
   * `.sp-row` 是 class，兩盤本來就都配得到，維持原樣。
   */
  const inOffgame = (el: Element): boolean =>
    me.dom.offgameEl.contains(el) || partner.dom.offgameEl.contains(el);

  // 兩盤各綁一份：只綁我的那盤的話，隊友盤的格子用鍵盤走過去永遠不會開卡片。
  for (const side of [me, partner]) {
    side.dom.grid.addEventListener('focusin', e => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.board-cell');
      // 只認鍵盤焦點：滑鼠點格子（瀏覽器可能讓它取得焦點）走的是 endDrag() 那條路，這裡再處理一次
      // 會跟它打架（例如把剛開的卡片關掉）。:focus-visible 對滑鼠點按鈕不成立。
      if (!cell || !cell.matches(':focus-visible')) return;
      syncCardToFocus();
    });

    side.dom.grid.addEventListener('focusout', e => {
      const next = e.relatedTarget;
      // 焦點還在同一盤裡（方向鍵換格）交給 focusin；去強化列或局外加成切換則留著卡片看即時重算。
      // 跨到另一盤的格子也不必特別處理：那一盤自己的 focusin 緊接著就會重開。
      if (next instanceof Node && side.dom.grid.contains(next)) return;
      if (next instanceof Element && (next.closest('.sp-row') !== null || inOffgame(next))) return;
      closeCard();
    });
  }

  document.addEventListener('pointerdown', e => {
    if (openOn === null) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    // 例外一：有骰子的格子交給拖曳流程（點一下＝endDrag 開那一格、拖動＝pointermove 裡關）。
    const cell = t.closest<HTMLElement>('.board-cell');
    const side = cell ? sideOfCell(cell) : null;
    if (cell && side && side.state.board[Number(cell.dataset.index)]) return;
    // 例外二：強化列與局外加成切換（兩盤各一組）——改了之後卡片要留著即時重算。
    if (t.closest('.sp-row') !== null || inOffgame(t)) return;
    closeCard();
  });

  window.addEventListener('resize', positionCard);
  window.addEventListener('scroll', positionCard, { passive: true });

  function openPicker(side: Side, slot: number): void {
    // 卡片與挑選網格互斥：卡片（z-index 45）會疊在挑選網格（40）上，而 Escape 的處理假設一次只有一個
    // 要關。兩個入口各守一半——這裡是「開網格時收掉卡片」，另一半「網格開著時不開卡片」在 openCard()。
    // 滑鼠點組合槽時 document 的 pointerdown 已經先關了卡片，但鍵盤（強化列 → 組合槽按 Space／空槽按
    // Enter）走不到那裡，所以收在每一條開網格路徑都會經過的這個函式。
    closeCard();
    pickingSlot = { side, slot };
    picker!.hidden = false;
    picker!.querySelector<HTMLButtonElement>('.picker-dice')?.focus();
  }

  /**
   * 收起挑選網格。`restoreFocus` 預設把焦點送回剛才那一槽——鍵盤使用者開完網格要回得去。
   *
   * ⚠️ 切換對戰／合作時要傳 false：那條路徑會把整組隊伍列 hidden 掉，而 `.focus()` 對
   * `display: none` 的元素是 no-op，焦點會掉回 `<body>`。那時焦點本來就在剛按下的切換鈕上，
   * 留在那裡才是對的。
   */
  function closePicker(restoreFocus = true): void {
    const picking = pickingSlot;
    pickingSlot = null;
    picker!.hidden = true;
    if (picking !== null && restoreFocus) {
      picking.side.dom.deckRow.querySelector<HTMLButtonElement>(`.deck-dice[data-slot="${picking.slot}"]`)?.focus();
    }
  }

  picker.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.picker-dice');
    if (!btn || pickingSlot === null) return;
    const diceId = btn.dataset.diceId!;
    const { side, slot } = pickingSlot;
    // 換骰子時保留這一槽原本的等級：使用者調好 5 骰點之後想換種類，不該被打回 1。
    const pips = side.state.deck[slot]?.pips ?? 1;
    side.state.deck = setDeckSlot(side.state.deck, slot, { diceId, pips });
    closePicker();
    side.renderDeck();
    // 挑選網格全頁只有一個、兩盤共用，所以這一句也要說清楚是替哪一盤選的（同 announcePrefix）。
    announce(`${side === partner ? PARTNER_SAY : ''}第 ${slot + 1} 槽選擇 ${diceMeta.get(diceId)?.name ?? diceId}`);
  });

  // ⚠️ 包一層：closePicker 現在收一個選用參數，直接當 handler 傳的話 MouseEvent 會被
  //    當成 restoreFocus（truthy，行為碰巧一樣），型別也對不起來。
  pickerClose.addEventListener('click', () => closePicker());

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pickingSlot !== null) {
      e.preventDefault();
      closePicker();
    }
  });

  document.addEventListener('keydown', e => {
    // held 的 Escape（放下）與挑選網格的 Escape 都會 preventDefault——先讓它們吃掉，這裡只收剩下的。
    if (e.key === 'Escape' && !e.defaultPrevented && openOn !== null) {
      e.preventDefault();
      closeCard();
    }
  });

  /**
   * 頁面開著時 /sim 的存檔變了：另一個分頁的 /sim 存了檔，或去 /sim 排好再按上一頁（這一頁從 bfcache
   * 原封回來，腳本不會重跑）。重讀一次，讓「我的 /sim」能不能按、提示、開著的卡片與明細面板跟上。
   * ⚠️ 不自動切到「我的 /sim」、也不播報：使用者沒有動這一頁，模式不該自己變。只有正在用的存檔不見了
   * 才退回「不含」——否則卡片描述的是一份已經不存在的規劃。仍然只讀不寫。
   * ⚠️ 兩盤都要通知：存檔只有一份，但「我這一盤要跟著改什麼」是每一盤各自的事（隊友那盤同樣有
   * 「我的 /sim」這個選項）。
   */
  function refreshSave(): void {
    simSave = readSimSave();
    me.onSaveChanged();
    partner.onSaveChanged();
    if (openOn !== null) openCard(openOn.side, openOn.index);
    renderDetail();
  }
  window.addEventListener('pageshow', e => {
    if (e.persisted) refreshSave();
  });
  // storage 事件只送給「別的」分頁；key 是 null＝那邊呼叫了 clear()。
  window.addEventListener('storage', e => {
    if (e.key === SIM_STORAGE_KEY || e.key === null) refreshSave();
  });

  document.getElementById('board-clear')?.addEventListener('click', () => {
    // 工具列只有一顆清空鈕，而合作模式下畫面上有兩盤——只清一盤會留下一整盤還在算跨盤加成的骰子。
    // 對戰模式下隊友盤是 hidden 的，清它看不出差別，所以動作不分支，只有播報分。
    me.clearBoard();
    partner.clearBoard();
    announce(coop ? '兩盤骰盤已清空' : '骰盤已清空');
  });

  const exportBtn = document.getElementById('board-export') as HTMLButtonElement | null;
  const exportOut = document.getElementById('board-export-out');
  const exportImg = document.getElementById('board-export-img') as HTMLImageElement | null;

  /**
   * 「隱藏星數」：切換兩盤骰盤的 `.cell-pips`（格子右下角 1–7 那個數字）。
   *
   * ⚠️ 按鈕文字固定不變（不要「隱藏星數」↔「顯示星數」互換），否則工具列寬度會跳動
   * ——CLAUDE.md「工具列的尺寸不准隨狀態改變」那段記過同一個問題。用 `aria-pressed`
   * 表達狀態，視覺只換底色（見 board.css），不加尺寸會變的指示元素。
   *
   * ⚠️ 用 `visibility: hidden` 而不是 `display: none`——後者會讓 `.board-cell` 內部重排
   * （`place-items: center` 的骰子圖示會因為少了 `.cell-pips` 佔位而輕微移動）。
   */
  const hidePipsBtn = document.getElementById('board-hide-pips') as HTMLButtonElement | null;
  let hidePips = false;
  if (hidePipsBtn) {
    hidePipsBtn.addEventListener('click', () => {
      hidePips = !hidePips;
      hidePipsBtn.setAttribute('aria-pressed', String(hidePips));
      me.dom.grid.classList.toggle('hide-pips', hidePips);
      partner.dom.grid.classList.toggle('hide-pips', hidePips);
      announce(hidePips ? '已隱藏星數' : '已顯示星數');
    });
  }

  if (exportBtn && exportOut && exportImg) {
    /** 上一張圖的 blob URL，換新圖時要收掉，不然每按一次就漏一份。 */
    let lastUrl: string | null = null;

    exportBtn.addEventListener('click', async () => {
      // 按鈕文字固定不變：改成「產生中…」會讓整條工具列的寬度跳動
      // （CLAUDE.md「工具列的尺寸不准隨篩選狀態改變」）。
      exportBtn.disabled = true;
      try {
        // 分享圖跟著隱藏（Yuki 拍板）：使用者按了隱藏就是不想看到那些數字，分享出去
        // 自然也不該有。只影響骰盤格，不影響組合列——見 ExportInput.hidePips 的說明。
        //
        // ⚠️ `coop` 與 `partner` 要跟著現在的模式走：漏傳的話合作模式產出的圖會安靜地
        // 只有自己那一盤——畫面上兩盤都在，圖裡少一盤，而沒有任何東西會報錯。
        // 隊友盤的內容**不看它是不是空的**照樣傳，那是 renderShareImage 的判斷。
        const canvas = await renderShareImage({
          board: me.state.board, deck: me.state.deck, meta: diceMeta, hidePips,
          coop, partner: { board: partner.state.board, deck: partner.state.deck },
        });
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
        if (!blob) {
          announce('分享圖產生失敗');
          return;
        }
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blob);
        exportImg.src = lastUrl;
        exportOut.hidden = false;

        // ⚠️ iOS Safari 對 <a download> 的行為不可靠，所以下載只是「順便」——
        // 圖本身已經顯示在頁面上，長按就能存。下載失敗不影響拿得到圖。
        const a = document.createElement('a');
        a.href = lastUrl;
        a.download = 'rd2-board.png';
        a.click();
        announce('分享圖已產生');
      } catch {
        // ⚠️ 沒有這個 catch 的話，繪製途中的任何例外都只會變成一個未捕捉的 rejection：
        // 按鈕被 finally 回復成可按、輸出區塊仍是 hidden、live region 是空的——
        // 使用者看到的是「按了完全沒反應」，而這一頁的唯一產出就是這張圖。
        announce('分享圖產生失敗');
      } finally {
        exportBtn.disabled = false;
      }
    });
  }

  // ---- 對戰／合作的模式切換 ----

  /** 隊友那一組：標題、局外加成、隊伍列、圖例、骰盤、中間的分隔線。合作模式才顯示。 */
  const partnerBlock = [partnerDeckH, partnerOffgameEl, partnerDeckRow, partnerLegend, partnerGrid, divider];

  /**
   * 「我的隊伍」那一組（標題、局外加成切換、隊伍列、圖例）裝進一個 DocumentFragment。
   *
   * append() 是**搬**不是複製：四個元素連同監聽器與內容一起離開原位置，插回去時順序不會錯，
   * 也只有一次 reflow（四次 insertBefore 就是四次，而且多三個把順序寫反的機會）。
   */
  function myDeckBlock(): DocumentFragment {
    const f = document.createDocumentFragment();
    f.append(deckH!, offgameEl!, deckRow!, deckLegend!);
    return f;
  }

  function renderCoopMode(): void {
    for (const btn of coopModeEl!.querySelectorAll<HTMLButtonElement>('button[data-coop]')) {
      btn.setAttribute('aria-pressed', String((btn.dataset.coop === 'on') === coop));
    }
  }

  /**
   * 把目前的模式套到版面上。
   *
   * ⚠️ 用**真的搬 DOM** 而不是 CSS order：order 不改 Tab 順序，而這一頁的鍵盤路徑是硬需求
   * （設計時就是因為全 canvas 方案給不了鍵盤與螢幕閱讀器路徑才選 DOM）。
   * 合作：隊友隊伍列 → 隊友盤 → 分隔線 → 我的盤 → 我的隊伍列 → 工具列，兩盤的隊伍列各自貼在
   * 自己那一盤的外側，就是遊戲裡兩人對坐的樣子。
   * 對戰：我的隊伍列搬回骰盤上方（＝這一頁本來的位置，挑選網格之前）。
   */
  function applyCoopLayout(): void {
    for (const el of partnerBlock) el.hidden = !coop;
    if (coop) boardStage!.insertBefore(myDeckBlock(), boardTools);
    else boardPage!.insertBefore(myDeckBlock(), picker);
    renderCoopMode();
    // 搬家不改狀態，但兩盤的畫面要跟新的模式一致：跨盤加成只在合作模式算，明細面板的「盤面」
    // 區塊會因此多幾行或少幾行（卡片在切換時已經收掉了）。
    me.renderDeck();
    partner.renderDeck();
    me.renderCells();
    partner.renderCells();
    // ⚠️ 離開合作模式時要**主動**清掉指著隊友盤的明細：隊友盤的內容刻意保留（切回去還在），
    // 所以 renderDetail() 的陳舊檢查（那一格還是不是同一顆骰子）永遠成立，面板會繼續描述一顆
    // 畫面上已經看不見的骰子——連同隊友那盤「全滿」的局外加成，而畫面上唯一的切換鈕可能寫著
    // 「不含」，正是 detailNothing 那句話要防的自相矛盾。
    if (!coop && detail?.side === partner) detail = null;
    renderDetail();
  }

  coopModeEl.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-coop]');
    if (!btn) return;
    const next = btn.dataset.coop === 'on';
    if (next === coop) return;
    coop = next;
    // 卡片指著一格，而那一格馬上會被搬到別的位置：先收掉，讓使用者重新點一次。
    closeCard();
    // ⚠️ 挑選網格也要收：它是貼著視窗底部的浮層，而切換鈕在頁面最上方——兩者同時點得到。
    // 不收的話 pickingSlot 會繼續指著剛剛被 hidden 掉的那一盤，接著挑一顆骰子就寫進看不見的
    // 那一組隊伍列，播報還說得出槽號，畫面上完全沒有反應。focus 不還（見 closePicker 的說明）。
    closePicker(false);
    applyCoopLayout();
    announce(coop ? '切換到合作模式，已加入隊友的骰盤' : '切換到對戰模式');
  });

  // 開頁的那一發：兩盤的格子都畫出來、卡片確定是關的、明細回到空狀態。
  // ⚠️ 這裡刻意不呼叫 applyCoopLayout()：board.astro 輸出的就是對戰模式的樣子（隊友那一組
  // hidden、切換鈕的 aria-pressed 指著「對戰」、我的隊伍列在骰盤上方），開頁再搬一次 DOM
  // 只是多一次 reflow。
  me.renderBoard();
  partner.renderBoard();
}
