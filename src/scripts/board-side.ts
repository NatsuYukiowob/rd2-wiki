// 「一盤」的狀態與 DOM 綁定。
//
// 一盤＝一個骰盤（#board-grid）＋它的隊伍列（#deck-row）＋它的局外加成切換（#offgame-mode）。
// 這一支只管這三塊：骰盤內容、隊伍、強化 Lv、局外模式，以及它們的拖曳與鍵盤操作。
//
// ⚠️ **全頁唯一的東西不在這裡**：數值卡片、加成明細面板、加成高亮、挑選網格、/sim 存檔與
// live region 都只有一份，留在 src/scripts/board.ts，由它透過 opts 的回呼接進來。分界的判準是
// 「這東西會不會因為多開一盤而多出一份」——會的在這裡，不會的在 board.ts。
import {
  COLS, DECK_SIZE, MAX_SP_LEVEL, ROWS, badgeKind, badgeText, cellPos, clampPips, clampSp, clear, cycleBadge,
  emptyBoard, emptyDeck, inBoard, place, setDeckSlot, swap,
  type Board, type Deck, type Placed,
} from '../lib/board.js';
import { boardRunes, type BuffSide } from '../lib/board-buffs.js';
import type { StatParams } from '../lib/dice-calc.js';
import type { NamedEffect } from '../lib/offgame.js';
import {
  appliedEffects, levelSource,
  type AppliedEffect, type OffgameMode, type SaveLevels,
} from '../lib/offgame-calc.js';
import type { SaveContextWire } from '../lib/sim-save-lite.js';
import type { Branch } from '../lib/types.js';

/** 這一盤的三塊 DOM。都是 board.astro 直接輸出的靜態元素，由 board.ts 抓好再傳進來。 */
export interface SideDom {
  grid: HTMLElement;
  deckRow: HTMLElement;
  offgameEl: HTMLElement;
  nosaveEl: HTMLElement;
}

/**
 * 這一盤的全部狀態。**公開給 board.ts 直接讀寫**：卡片、明細、挑選網格都要看它（挑選網格選完
 * 骰子就是寫 `deck`），包一層 getter／setter 只會多一份要維護的轉接。
 */
export interface SideState {
  board: Board;
  deck: Deck;
  /**
   * 局內 SP 強化 Lv，以骰子種類（節點 id）為鍵；沒有就是 1。只在記憶體裡，重整即清空（同骰盤）。
   *
   * ⚠️ 鍵是骰子 id 不是槽位：(1) 挑選網格沒擋重複，同一種骰子可以放在兩槽，兩槽必須顯示同一個值；
   * (2) 換掉槽裡的骰子不會清掉骰盤上的舊骰子（setDeckSlot 只改 deck），那些骰子要保留最後的 Lv。
   * 「清空骰盤」也不動它——Lv 屬於隊伍，不屬於骰盤。
   */
  spLevels: Map<string, number>;
  mode: OffgameMode;
}

/**
 * 建一盤要給的東西。
 *
 * 前六項是資料與設定；後面那幾個是**跨盤協調的回呼**——卡片／明細／挑選網格全頁只有一份，
 * 這一盤要動它們時一律經過 board.ts，不自己去抓那些元素。
 *
 * ⚠️ **`createSide()` 建構期間一個回呼都不准呼叫。** board.ts 傳進來的回呼讀得到它自己的
 * 模組級狀態（`cardIndex`、`detail`…），而那些宣告在 `const me = createSide(...)` **之後**
 * ——建構途中呼叫下去就是 `ReferenceError: Cannot access 'cardIndex' before initialization`，
 * 整頁的腳本直接死掉。現在安全，是因為建構最後只跑 `renderDeck()` 與 `renderMode()`，兩者都不碰
 * 回呼；要在建構期多做事，請先確定那條路徑走不到任何 `opts.*` 回呼。
 */
export interface SideOptions {
  offgame: { effects: Record<string, NamedEffect>; branches: Record<string, Branch>; save: SaveContextWire };
  statParams: Record<string, StatParams[]>;
  /** 目前的 /sim 存檔（全頁共用一份，可能在頁面開著時變，所以是取值函式不是值）。 */
  simSave: () => SaveLevels | null;
  defaultMode: OffgameMode;
  /** 骰子的顯示資料（名稱與圖）。來源是全頁唯一的挑選網格，由 board.ts 讀好再傳進來。 */
  diceMeta: ReadonlyMap<string, { name: string; icon: string }>;
  /**
   * 這一盤在**無障礙名稱**裡的前綴（我的那盤是空字串，隊友那盤是「隊友」）。
   *
   * ⚠️ 不是裝飾：合作模式下兩盤的格子與組合槽同時在無障礙樹裡，`第 1 列第 1 格，空` 會有兩顆
   * 完全同名的按鈕。board.astro 輸出的隊友端靜態標記本來就帶著這個前綴，renderDeck()／
   * renderCells() 第一次跑就會把它洗掉——所以這裡要拿得到它，不能只靠靜態標記。
   * 必填（沒有預設值）：多開一盤時「這盤叫什麼」是呼叫端必須回答的問題，漏掉會安靜地變成同名。
   */
  namePrefix: string;
  announce: (msg: string) => void;
  /**
   * 這一盤在**播報**裡的前綴（我的那盤是空字串，隊友那盤是「隊友盤：」）。
   *
   * ⚠️ live region 全頁只有一個，而兩盤共用同一組播報字串：不帶前綴的話
   * 「已移除第 1 列第 2 格的骰子」在兩盤上逐字相同，聽的人分不出動到的是哪一盤。
   * ⚠️ **跟 `namePrefix` 分開，不要合併**：`namePrefix` 接的是名詞片語（「第 1 列第 1 格，空」），
   * 這個接的是完整句子——「隊友已移除…」會讀成「是隊友做的」，而動手的是使用者自己。
   * 前綴帶到「盤」這個字也讓它跟卡片標題同一套詞彙。
   * ⚠️ 播報字串**兩盤共用**，對戰模式那一份必須逐字不變，所以讀不順時要調的是這個前綴、
   * 不是句子。必填（沒有預設值），理由同 `namePrefix`。
   */
  announcePrefix: string;
  /**
   * 這一盤的內容變了、但**卡片不該收**（改強化 Lv／切局外模式／切角標）：
   * 開著的那張原地重算（連帶重畫高亮），明細跟上——卡片收起後面板仍描述那顆骰子。
   */
  onChange: () => void;
  /**
   * **骰盤內容**變了（放下／交換／移除／清空）：卡片描述的那一格可能已經不是原本那顆，收掉；
   * 明細面板不收（它刻意保留），但那顆被移走或換掉時要回到空狀態。
   *
   * ⚠️ 跟 `onChange` 是兩件事，不要合併：差別就在卡片收不收。
   */
  onBoardChange: () => void;
  /** 開這一盤第 index 格的數值卡片。 */
  openCard: (index: number) => void;
  closeCard: () => void;
  /** 替這一盤的第 slot 個組合槽打開挑選網格。 */
  openPicker: (slot: number) => void;
  /** 焦點（:focus-visible）停在哪一格就開哪一格的卡片，否則關。 */
  syncCardToFocus: () => void;
}

export interface Side {
  dom: SideDom;
  state: SideState;
  spLevelOf(diceId: string): number;
  appliedFor(diceId: string): AppliedEffect[];
  runeOf(): (id: string) => number | null;
  buffSide(): BuffSide;
  renderDeck(): void;
  renderCells(): void;
  /** 重畫格子，並讓呼叫端收掉卡片、更新明細（＝`renderCells()` ＋ `onBoardChange`）。 */
  renderBoard(): void;
  /**
   * 清空這一盤的骰盤。**「骰盤已清空」的播報留給呼叫端**——清空鈕是全頁的工具列按鈕，
   * 播幾句、播什麼由 board.ts 決定。
   */
  clearBoard(): void;
  /**
   * 全頁共用的 /sim 存檔變了：正在用的存檔不見了就退回「不含」，並重畫這一盤的模式切換鈕。
   *
   * ⚠️ 名字講的是**事件**不是動作：`/board` 只讀不寫 localStorage（見 board.astro 開頭的注解），
   * 這一支不會、也不該把任何東西寫回存檔。讀存檔（readSimSave／refreshSave）留在 board.ts
   * ——存檔只有一份，不該每盤各讀一次；這裡只負責「我這一盤要跟著改什麼」。
   */
  onSaveChanged(): void;
}

const MODE_NAME: Record<OffgameMode, string> = { none: '不含', sim: '我的 /sim', max: '全滿' };

export function createSide(dom: SideDom, opts: SideOptions): Side {
  const state: SideState = {
    board: emptyBoard(),
    deck: emptyDeck(),
    spLevels: new Map<string, number>(),
    mode: opts.defaultMode,
  };

  const spLevelOf = (diceId: string): number => state.spLevels.get(diceId) ?? 1;

  /** 這一盤的播報。**這一支裡所有的播報都要走它**，直接呼叫 `opts.announce` 會掉了前綴。 */
  const say = (msg: string): void => opts.announce(opts.announcePrefix + msg);

  function appliedFor(diceId: string): AppliedEffect[] {
    const branch = opts.offgame.branches[diceId];
    return branch
      ? appliedEffects(diceId, branch, opts.offgame.effects, levelSource(state.mode, opts.simSave()))
      : [];
  }

  /** 盤面符文的取值函式，跟著這一盤目前的局外模式與存檔走。 */
  const runeOf = (): ((id: string) => number | null) =>
    boardRunes(opts.offgame.effects, levelSource(state.mode, opts.simSave()));

  /** 這一盤餵給 boardBuffs() 的樣子。要算跨盤加成時，兩盤各拿自己的這個當對方的 `partner`。 */
  const buffSide = (): BuffSide => ({
    board: state.board,
    params: id => opts.statParams[id] ?? [],
    spLevel: spLevelOf,
    applied: appliedFor,
    rune: runeOf(),
  });

  function renderMode(): void {
    for (const btn of dom.offgameEl.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
    }
    const simBtn = dom.offgameEl.querySelector<HTMLButtonElement>('button[data-mode="sim"]')!;
    if (opts.simSave()) simBtn.removeAttribute('aria-disabled');
    else simBtn.setAttribute('aria-disabled', 'true');
    dom.nosaveEl.hidden = opts.simSave() !== null;
  }

  function onSaveChanged(): void {
    if (state.mode === 'sim' && !opts.simSave()) state.mode = 'none';
    renderMode();
  }

  /**
   * 剛結束一次「有位移」的拖曳。**只有 `#deck-row` 的 click 委派會讀它；寫入在 `endDrag()`
   * 與 `attachDragHandlers()` 的 pointerdown。**
   *
   * ⚠️ 這不是防禦性程式碼，是修一個實測過的 bug：對 `pointerdown` 呼叫 `preventDefault()`
   * 只擋得掉相容滑鼠事件（mousedown／mouseup 實測都沒送出），**`click` 照樣會送達，
   * 而且 `setPointerCapture()` 會把它的 target 重新導回來源元素**。於是每一次
   * 「從組合列拖進骰盤」結束時，底下的 click 委派都會收到一發 click 並打開挑選網格。
   * 實測事件序：
   *   pointerdown → pointermove×N → pointerup → endDrag(target=6) → click(target=deck-dice) → openPicker
   *
   * 後果不只是難看：桌機 1280×720 上第一次 drop 之後挑選網格展開，`#board-grid` 被往下推
   * 400px，第二次拖曳算出的落點落在視窗外，那一次拖曳完全沒有落點。
   *
   * 判準必須是「有沒有位移」而不是「有沒有按下過」，否則「原地點一下＝開挑選網格」會壞掉。
   *
   * ⚠️ **全分支 review I1 成因 A**：這個旗標曾經只在 `startDrag()` 內部重置，而 `startDrag()`
   * 只在 `getPayload()` 非空時才會被呼叫。觸控拖曳結束後瀏覽器根本不送 `click`
   * （拖曳不是 tap，setPointerCapture 導回來源元素那條路只對滑鼠成立）——旗標會卡在 true，
   * 直到下一次真的觸發 `startDrag()` 才被重置。使用者緊接著點**空的**組合槽（`getPayload()`
   * 回 null，`startDrag()` 不會跑）就會被吃掉一次點擊。實測 Pixel 7（CDP
   * `Input.dispatchTouchEvent`）：觸控把骰子拖進第 6 格後，點空槽第 1 次沒開、第 2 次才開。
   * 修法：重置改放在 `pointerdown` handler 的最開頭（見下方 `attachDragHandlers`），
   * 在判斷 `getPayload()` 之前——`pointerdown` 一定先於同一次互動的 `click`，
   * 每次按下都清乾淨就不會被前一次互動的殘留值影響。
   */
  let justDragged = false;

  /**
   * ⚠️ **全分支 review I1 成因 B**：`pointermove` 一發就把 `moved` 設成 `true`，沒有任何
   * 位移門檻——滑鼠按下後只抖 1px、或觸控落指時手指自然滑了 1–2px，都會被誤判成「拖曳過」，
   * 導致 `endDrag()` 把 `justDragged` 設成 true、吃掉緊接著那發原本該開挑選網格的 click。
   * 5px（CSS px）是刻意選的：夠大到能過濾滑鼠手震與觸控落指的自然位移（實測案例都在
   * 1–2px），又遠小於任何一顆骰子／格子的尺寸（組合槽 4rem、骰盤格更大），不會讓「這是真的
   * 在拖」的判斷遲鈍到影響手感。⚠️ 拖曳影像與落點高亮不吃這個門檻——`moveGhost`／`highlight`
   * 在每一次 `pointermove` 都照跑，只有「算不算一次拖曳」（`dragging.moved`）延後到超過門檻
   * 才成立，否則影像會等使用者滑出 5px 才姍姍來遲地出現，手感會變差。
   */
  const DRAG_THRESHOLD_PX = 5;

  function renderDeck(): void {
    for (let slot = 0; slot < DECK_SIZE; slot++) {
      const p = state.deck[slot];
      const btn = dom.deckRow.querySelector<HTMLButtonElement>(`.deck-dice[data-slot="${slot}"]`)!;
      const value = dom.deckRow.querySelector<HTMLElement>(`.pips-value[data-slot="${slot}"]`)!;
      const dec = dom.deckRow.querySelector<HTMLButtonElement>(`.pips-dec[data-slot="${slot}"]`)!;
      const inc = dom.deckRow.querySelector<HTMLButtonElement>(`.pips-inc[data-slot="${slot}"]`)!;
      const spNum = dom.deckRow.querySelector<HTMLElement>(`.sp-value[data-slot="${slot}"] .sp-num`)!;
      const spDec = dom.deckRow.querySelector<HTMLButtonElement>(`.sp-dec[data-slot="${slot}"]`)!;
      const spInc = dom.deckRow.querySelector<HTMLButtonElement>(`.sp-inc[data-slot="${slot}"]`)!;

      if (p) {
        const meta = opts.diceMeta.get(p.diceId);
        btn.innerHTML = '';
        const img = document.createElement('img');
        img.src = meta?.icon ?? '';
        img.alt = '';
        img.draggable = false;
        btn.append(img);
        // I4（Yuki 拍板）：已填槽的 Enter 拿起、Space 才是換骰子——見下方 #deck-row 的
        // keydown 委派。aria-label 要照實描述兩個鍵各做什麼，不能再寫含糊的「按下更換」。
        btn.setAttribute('aria-label', `${opts.namePrefix}第 ${slot + 1} 槽，${meta?.name ?? p.diceId} ${p.pips} 骰點，Enter 拿起，Space 更換`);
        value.textContent = String(p.pips);
        const lv = spLevelOf(p.diceId);
        const name = meta?.name ?? p.diceId;
        spNum.textContent = String(lv);
        spDec.setAttribute('aria-label', `${opts.namePrefix}第 ${slot + 1} 槽${name}降低強化等級，目前 Lv.${lv}，最低 1`);
        spInc.setAttribute('aria-label', `${opts.namePrefix}第 ${slot + 1} 槽${name}提高強化等級，目前 Lv.${lv}，最高 ${MAX_SP_LEVEL}`);
      } else {
        btn.innerHTML = '<span class="deck-dice-empty" aria-hidden="true">＋</span>';
        btn.setAttribute('aria-label', `${opts.namePrefix}第 ${slot + 1} 槽，尚未選擇骰子，按下選擇`);
        value.textContent = '1';
        spNum.textContent = '1';
        spDec.setAttribute('aria-label', `${opts.namePrefix}第 ${slot + 1} 槽降低強化等級`);
        spInc.setAttribute('aria-label', `${opts.namePrefix}第 ${slot + 1} 槽提高強化等級`);
      }
      // 空槽不能調等級：等級是「這一槽的骰子」的屬性，沒有骰子就沒有等級可言。
      dec.disabled = !p;
      inc.disabled = !p;
      spDec.disabled = !p;
      spInc.disabled = !p;
    }
  }

  /**
   * 只重畫格子（圖示、骰點、角標、aria-label）。卡片與明細要不要跟著動由呼叫端決定：
   * 骰盤內容變了走 renderBoard()（收卡片），切換角標走 cycleAt()（卡片原地重算）。
   */
  function renderCells(): void {
    for (const cell of dom.grid.querySelectorAll<HTMLButtonElement>('.board-cell')) {
      const i = Number(cell.dataset.index);
      const p = state.board[i];
      const row = Math.floor(i / 5) + 1;
      const col = (i % 5) + 1;
      cell.innerHTML = '';
      if (p) {
        const meta = opts.diceMeta.get(p.diceId);
        const img = document.createElement('img');
        img.src = meta?.icon ?? '';
        img.alt = '';
        img.draggable = false;
        const pips = document.createElement('span');
        pips.className = 'cell-pips';
        pips.textContent = String(p.pips);
        cell.append(img, pips);
        // 角標：7 骰點以下的排序（方向）／齒輪二階（種類）。狀態由格子的 aria-label 說，角標本身 aria-hidden。
        const b = badgeText(p);
        if (b) {
          const el = document.createElement('span');
          el.className = b.glyph === '?' ? 'cell-badge unset' : 'cell-badge';
          el.setAttribute('aria-hidden', 'true');
          el.textContent = b.glyph;
          cell.append(el);
        }
        cell.setAttribute('aria-label', `${opts.namePrefix}第 ${row} 列第 ${col} 格，${meta?.name ?? p.diceId} ${p.pips} 骰點${b ? `，${b.spoken}，按 R 切換` : ''}`);
      } else {
        cell.setAttribute('aria-label', `${opts.namePrefix}第 ${row} 列第 ${col} 格，空`);
      }
    }
  }

  function renderBoard(): void {
    renderCells();
    // 卡片收不收、明細怎麼跟上，見 SideOptions.onBoardChange 的說明。
    opts.onBoardChange();
  }

  /**
   * 切換第 i 格的角標（排序方向／齒輪二階種類）。跟 renderBoard() 不同：**卡片不收**——開著的那張（不一定是這一格）
   * 原地重算，明細跟上，播報新狀態。指標（endDrag 的 onBadge）與鍵盤（R）共用這一支。
   */
  function cycleAt(i: number): void {
    const next = cycleBadge(state.board, i);
    if (next === state.board) return;
    state.board = next;
    renderCells();
    opts.onChange();
    say(badgeText(state.board[i])!.announce);
  }

  dom.deckRow.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const dice = target.closest<HTMLButtonElement>('.deck-dice');
    if (dice) {
      // 拖曳結束時瀏覽器補送的那一發 click，不是使用者要換骰子（見 justDragged 的說明）。
      if (justDragged) {
        justDragged = false;
        return;
      }
      opts.openPicker(Number(dice.dataset.slot));
      return;
    }
    // 強化列：改的是「這一種骰子」的 Lv（spLevels 以骰子 id 為鍵），所以重畫整條組合列——
    // 同一種骰子在別的槽也要跟著變。
    const spStep = target.closest<HTMLButtonElement>('.sp-inc, .sp-dec');
    if (spStep) {
      const p = state.deck[Number(spStep.dataset.slot)];
      if (spStep.disabled || !p) return;
      const lv = clampSp(spLevelOf(p.diceId) + (spStep.classList.contains('sp-inc') ? 1 : -1));
      state.spLevels.set(p.diceId, lv);
      renderDeck();
      // ⚠️ 改的是別種骰子也可能變：光的強化 Lv 會改到它照到的鄰格，所以整張卡片重算而不是只改這一列。
      opts.onChange();
      say(`${opts.diceMeta.get(p.diceId)?.name ?? p.diceId}強化 Lv.${lv}，同種骰子共用`);
      return;
    }
    const step = target.closest<HTMLButtonElement>('.pips-inc, .pips-dec');
    if (!step || step.disabled) return;
    const slot = Number(step.dataset.slot);
    const current = state.deck[slot];
    if (!current) return;
    const delta = step.classList.contains('pips-inc') ? 1 : -1;
    state.deck = setDeckSlot(state.deck, slot, { diceId: current.diceId, pips: clampPips(current.pips + delta) });
    renderDeck();
    say(`第 ${slot + 1} 槽改為 ${state.deck[slot]!.pips} 骰點`);
  });

  dom.offgameEl.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!btn) return;
    const next = btn.dataset.mode as OffgameMode;
    if (next === 'sim' && !opts.simSave()) {
      say('沒有找到 /sim 的存檔');
      return;
    }
    state.mode = next;
    renderMode();
    // 開著的卡片原地重算：切換鈕在 pointerdown／focusout 的豁免清單裡，卡片不會先被收掉。
    opts.onChange();
    say(`局外加成：${MODE_NAME[state.mode]}`);
  });

  /** 目前正在拖的東西。`from` 是來源格 index，來自組合列時為 null。
   *  `moved` 記「這一次按下之後指標有沒有超過 DRAG_THRESHOLD_PX」——原地點一下與拖曳要分得開。
   *  `pointerId` 與 `startX`／`startY` 是 I3／I1 成因 B 用的：見 `startDrag()` 與
   *  `attachDragHandlers()` 的說明。`onBadge`＝按下的點在格子的角標上（原地放開＝切換角標，見 endDrag）。 */
  let dragging: {
    payload: Placed; from: number | null; ghost: HTMLElement; moved: boolean;
    pointerId: number; startX: number; startY: number; onBadge: boolean;
  } | null = null;


  /**
   * 指標底下是哪一格。三態，缺一不可：**這一盤的第 i 格** ／ `'other'`＝另一盤的格子 ／
   * `null`＝任何一盤的格子都不是（骰盤外）。
   *
   * ⚠️ `'other'` 不能跟 `null` 合併：`null` 在 endDrag() 是「拖到骰盤外」，從格子起手時會把
   * 骰子**刪掉**；而放到另一盤的格子上是瞄準了一張盤，不是把骰子丟到空白處，判成移除就變成一個
   * 會刪資料的誤判。
   * ⚠️ 兩盤的格子 class 與 data-index 完全相同，而 `document.elementFromPoint()` 沒有 strict
   * mode——少了 `dom.grid.contains(cell)` 這個容器判斷，放到另一盤的格子上會靜靜地作用在**自己盤
   * 的同一個 index**（鏡像格），連拖曳途中的 `.drop-target` 都畫在自己盤上，放開前完全看不出來。
   */
  function cellUnder(x: number, y: number): number | 'other' | null {
    // ⚠️ 拖曳影像必須是 pointer-events: none，否則這裡永遠只會抓到影像自己。
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest<HTMLElement>('.board-cell');
    if (!cell) return null;
    if (!dom.grid.contains(cell)) return 'other';
    const i = Number(cell.dataset.index);
    return inBoard(i) ? i : null;
  }

  /** 落點高亮。`'other'`（指標在另一盤上）與 `null` 一樣：這一盤一格都不亮。 */
  function highlight(index: number | 'other' | null): void {
    for (const cell of dom.grid.querySelectorAll<HTMLElement>('.board-cell')) {
      cell.classList.toggle('drop-target', Number(cell.dataset.index) === index);
    }
  }

  function startDrag(e: PointerEvent, payload: Placed, from: number | null): void {
    // I3（全分支 review 實測）：`dragging` 是單一模組變數，第二根手指的 startDrag 會覆蓋
    // 第一根的參照——兩指同時從組合列拖向骰盤時，第一根手指落地會用到第二根手指的 payload、
    // 第一個 ghost 也永遠沒人 remove()（重整才消失）。這裡選擇忽略第二根手指：這一頁的操作
    // 模型本來就是單指拖放，多指同拖不是要支援的情境，「什麼都不做」比「兩指打架」安全；
    // 搭配 attachDragHandlers 用 pointerId 過濾 move／up／cancel，第二根手指自己的事件序
    // 不會被錯認成第一根手指的一部分（也不會被第二根手指的座標覆蓋第一根的落點）。
    if (dragging) return;
    // 滑鼠拖曳一旦開始，鍵盤「拿在手上」的那顆就過期了：held 只被鍵盤自己的三條路徑
    // （放置、Delete/Backspace、Escape）清空，不清的話跨模態操作完再回來按 Enter，
    // live region 會播報一個已經不存在的擺放結果（比沒有播報更糟）。
    held = null;
    const source = e.currentTarget as HTMLElement;
    const meta = opts.diceMeta.get(payload.diceId);
    const ghost = document.createElement('img');
    ghost.className = 'drag-ghost';
    ghost.src = meta?.icon ?? '';
    ghost.alt = '';
    document.body.append(ghost);
    dragging = {
      payload, from, ghost, moved: false, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      onBadge: from !== null && e.target instanceof Element && e.target.closest('.cell-badge') !== null,
    };
    moveGhost(e.clientX, e.clientY);
    // setPointerCapture：之後的 move／up 一定回到這個元素，指標滑出去也不會斷。
    source.setPointerCapture(e.pointerId);
  }

  function moveGhost(x: number, y: number): void {
    if (!dragging) return;
    dragging.ghost.style.left = `${x}px`;
    dragging.ghost.style.top = `${y}px`;
  }

  function endDrag(x: number, y: number): void {
    if (!dragging) return;
    const { payload, from, moved, onBadge } = dragging;
    // ⚠️ 只有 #deck-row 的 click 委派會消費 justDragged。從骰盤格起手的拖曳
    // （格↔格交換、格→骰盤外移除）結束後，setPointerCapture 導回的那發 click
    // 落在 .board-cell 上，那裡沒有監聽器會讀它——寫 true 進去只會讓旗標卡住，
    // 直到下一次 startDrag() 才被重置，使用者下一次點組合列的空槽要點兩次才開得了。
    justDragged = from === null && dragging.moved;
    dragging.ghost.remove();
    dragging = null;
    highlight(null);

    // 從格子起手、沒超過位移門檻＝點一下：按在角標上是切換角標，其餘開這一格的數值卡片——都不交換也不移除，
    // 門檻以下本來就是點擊（指標在門檻內跨進鄰格也一樣）。為什麼寫在這裡而不綁 click，見 cardIndex 的說明。
    if (from !== null && !moved) {
      if (onBadge) cycleAt(from);
      else opts.openCard(from);
      return;
    }

    const target = cellUnder(x, y);
    // 放到另一盤的格子上：兩盤各自獨立，不跨盤搬骰子（鍵盤的「拿在手上」也是每盤一份，
    // 指標做得到而鍵盤做不到的事這一頁不做）。什麼都不做＝骰子留在原處。
    // ⚠️ 不可以讓它落到下面那個 null 分支，那條是「拖到骰盤外」，從格子起手會把骰子刪掉。
    // ⚠️ 但**不能靜靜不作用**：畫面上骰子彈回原處看得出來，螢幕閱讀器使用者卻分不出
    // 「我沒瞄準」與「這一頁不理我」——所以這條路徑要自己說一句。
    if (target === 'other') {
      say('不能把骰子搬到另一盤，骰子留在原處');
      return;
    }
    if (target === null) {
      // 拖到骰盤外：來自格子＝移除，來自組合列＝什麼都不做。
      if (from !== null) {
        state.board = clear(state.board, from);
        renderBoard();
        say('已移除一顆骰子');
      }
      return;
    }
    if (from === null) {
      state.board = place(state.board, target, payload);
      say(`${opts.diceMeta.get(payload.diceId)?.name ?? payload.diceId} ${payload.pips} 骰點放到第 ${Math.floor(target / 5) + 1} 列第 ${(target % 5) + 1} 格`);
    } else {
      // ⚠️ swap() 在 from === target 時是 no-op（回原陣列）。無條件播報的話，在已有骰子的
      // 格子上「原地點一下」就會讓螢幕閱讀器收到一句「兩格已交換」，而畫面上什麼都沒動。
      const next = swap(state.board, from, target);
      if (next !== state.board) {
        state.board = next;
        say('兩格已交換');
      }
    }
    renderBoard();
  }

  function attachDragHandlers(el: HTMLElement, getPayload: () => Placed | null, from: number | null): void {
    el.addEventListener('pointerdown', e => {
      // I1 成因 A：重置放在 pointerdown 的最開頭、判斷 getPayload() 之前——不論這次按下
      // 最後有沒有真的觸發拖曳都要清乾淨。pointerdown 一定先於同一次互動的 click，
      // 而觸控拖曳結束後瀏覽器根本不會送 click（見 justDragged 宣告處的說明），
      // 舊寫法把重置放在 startDrag() 內部（只在 payload 非空時才跑）會讓旗標卡在 true，
      // 直到使用者下一次按在「有骰子」的來源上才被清掉——點空的組合槽永遠清不掉它。
      justDragged = false;
      const payload = getPayload();
      if (!payload) return;
      e.preventDefault();
      startDrag(e, payload, from);
    });
    el.addEventListener('pointermove', e => {
      // I3：只處理正在拖曳的那根手指／那顆指標，其餘 pointerId 的 move 一律忽略——
      // 否則第二根手指（startDrag 已經因為 `if (dragging) return` 被吃掉）的移動事件
      // 仍然會落到這個委派上，把第一根手指的 ghost 拖去第二根手指的座標。
      if (!dragging || e.pointerId !== dragging.pointerId) return;
      // I1 成因 B：只有超過門檻才算「真的拖過」，否則滑鼠手震／觸控落指的 1–2px 自然位移
      // 會被誤判成拖曳，讓 endDrag() 把 justDragged 設成 true、吃掉緊接著那發該開挑選網格
      // 的 click。拖曳影像與落點高亮不吃這個門檻，見 DRAG_THRESHOLD_PX 宣告處的說明。
      if (!dragging.moved) {
        const dx = e.clientX - dragging.startX;
        const dy = e.clientY - dragging.startY;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          dragging.moved = true;
          // 真的開始拖了：卡片描述的那一格馬上就會變，先收掉。
          opts.closeCard();
        }
      }
      moveGhost(e.clientX, e.clientY);
      highlight(cellUnder(e.clientX, e.clientY));
    });
    el.addEventListener('pointerup', e => {
      // I3：見上面 pointermove 的說明——第二根手指的落地不該被當成第一根手指的落地。
      if (!dragging || e.pointerId !== dragging.pointerId) return;
      endDrag(e.clientX, e.clientY);
    });
    // 指標被系統搶走（來電、手勢）時要收乾淨，否則影像會永遠留在畫面上。
    el.addEventListener('pointercancel', e => {
      if (!dragging || e.pointerId !== dragging.pointerId) return;
      dragging.ghost.remove();
      dragging = null;
      highlight(null);
    });
  }

  for (let slot = 0; slot < DECK_SIZE; slot++) {
    const btn = dom.deckRow.querySelector<HTMLElement>(`.deck-dice[data-slot="${slot}"]`)!;
    attachDragHandlers(btn, () => state.deck[slot] ?? null, null);
  }
  for (const cell of dom.grid.querySelectorAll<HTMLElement>('.board-cell')) {
    const i = Number(cell.dataset.index);
    attachDragHandlers(cell, () => state.board[i] ?? null, i);
  }

  function clearBoard(): void {
    state.board = emptyBoard();
    // 清空之後 held 若還指著一顆已經不存在的骰子，鍵盤 Enter 會把它憑空放回來。
    held = null;
    renderBoard();
  }

  /**
   * 鍵盤版的「拿在手上」。
   *
   * 這一段不是裝飾：設計階段否掉「全 canvas」方案的唯一理由就是它給不了鍵盤與螢幕閱讀器
   * 路徑。DOM 方案的代價就是這裡要真的寫完，不能只做滑鼠。
   */
  let held: { payload: Placed; from: number | null } | null = null;

  function focusCell(index: number): void {
    dom.grid.querySelector<HTMLElement>(`.board-cell[data-index="${index}"]`)?.focus();
  }

  dom.deckRow.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.deck-dice');
    if (!btn) return;
    const slot = Number(btn.dataset.slot);
    const p = state.deck[slot];
    // 空槽維持原本行為：Enter 與 Space 都打開挑選網格（click 事件會處理），不要攔。
    if (!p) return;
    // I4（全分支 review，Yuki 拍板）：已填槽以前 Enter／Space 兩個鍵都被攔下改成「拿起」，
    // click 從此不再派發，挑選網格永遠打不開——純鍵盤使用者填滿 5 槽之後再也換不掉任何一顆，
    // 而 aria-label 還寫著「按下更換」。現在 Space 改開挑選網格換骰子，Enter 維持「拿起」
    // 不變（放到骰盤上再按一次 Enter 放下）。空槽與滑鼠行為兩者都不動。
    if (e.key === ' ') {
      e.preventDefault();
      opts.openPicker(slot);
      return;
    }
    e.preventDefault();
    held = { payload: p, from: null };
    say(`拿起 ${opts.diceMeta.get(p.diceId)?.name ?? p.diceId} ${p.pips} 骰點，移到骰盤上按 Enter 放下`);
  });

  dom.grid.addEventListener('keydown', e => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.board-cell');
    if (!cell) return;
    const i = Number(cell.dataset.index);
    if (!inBoard(i)) return;
    const { row, col } = cellPos(i);

    // 方向鍵：撞到邊界就原地不動，不繞行到另一端（繞行在 5×3 上會讓人以為按錯了）。
    const moves: Record<string, number | undefined> = {
      ArrowLeft: col > 0 ? i - 1 : undefined,
      ArrowRight: col < COLS - 1 ? i + 1 : undefined,
      ArrowUp: row > 0 ? i - COLS : undefined,
      ArrowDown: row < ROWS - 1 ? i + COLS : undefined,
    };
    if (e.key in moves) {
      e.preventDefault();
      const next = moves[e.key];
      if (next !== undefined) focusCell(next);
      return;
    }

    // R：切換這一格的角標（排序方向／齒輪二階種類）。帶 Ctrl／Meta／Alt 的不攔——Ctrl+R 是重新整理。
    // held（鍵盤拿起中）不清：切換的是格子上的骰子，放下時 swap() 讀的是骰盤上的現況。
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!badgeKind(state.board[i])) return;
      e.preventDefault();
      cycleAt(i);
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (held) {
        const next = held.from === null ? place(state.board, i, held.payload) : swap(state.board, held.from, i);
        const name = opts.diceMeta.get(held.payload.diceId)?.name ?? held.payload.diceId;
        held = null;
        // ⚠️ 比照 endDrag：swap() 在 held.from === i 時是 no-op（回原陣列）。無條件播報的話，
        // 「拿起後在原地按 Enter」會讓螢幕閱讀器收到一句「放到第 X 列 Y 格」，畫面卻什麼都沒動。
        // place() 一定會真的寫入（組合列來源沒有「原地」這回事），只有 swap 分支需要這層保護。
        if (next !== state.board) {
          state.board = next;
          say(`${name} 放到第 ${row + 1} 列第 ${col + 1} 格`);
        }
        renderBoard();
        focusCell(i);
        // renderBoard() 收掉了卡片，而焦點本來就在這一格（focus() 不會再觸發 focusin）→ 手動同步。
        opts.syncCardToFocus();
      } else if (state.board[i]) {
        held = { payload: state.board[i]!, from: i };
        say(`拿起第 ${row + 1} 列第 ${col + 1} 格的骰子，移到目標格按 Enter 放下`);
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!state.board[i]) return;
      state.board = clear(state.board, i);
      held = null;
      renderBoard();
      focusCell(i);
      say(`已移除第 ${row + 1} 列第 ${col + 1} 格的骰子`);
      return;
    }

    if (e.key === 'Escape' && held) {
      e.preventDefault();
      held = null;
      say('已放下');
    }
  });

  renderDeck();
  renderMode();

  return { dom, state, spLevelOf, appliedFor, runeOf, buffSide, renderDeck, renderCells, renderBoard, clearBoard, onSaveChanged };
}
