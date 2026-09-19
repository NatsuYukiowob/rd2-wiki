// 骰盤編輯器的客戶端行為。
//
// 這一支只做兩件事：把使用者的操作翻譯成 src/lib/board.ts 的純函式呼叫，然後把新狀態
// 畫回 DOM。任何「放哪、換哪、清哪」的判斷都不寫在這裡——那些在 lib 裡，有單元測試。
import {
  COLS, DECK_SIZE, MAX_SP_LEVEL, ROWS, badgeKind, badgeText, cellPos, clampPips, clampSp, clear, cycleBadge,
  emptyBoard, emptyDeck, inBoard, place, setDeckSlot, swap,
  type Board, type Deck, type Placed,
} from '../lib/board.js';
import { renderShareImage } from './board-export.js';
import { boardBuffs, boardRunes, buffHighlights, pendingHint, type CellBuffs } from '../lib/board-buffs.js';
import { cardTitle, placeCard } from '../lib/board-card.js';
import type { StatParams } from '../lib/dice-calc.js';
import type { NamedEffect } from '../lib/offgame.js';
import {
  appliedEffects, bonusCardModel, detailLines, levelSource,
  type AppliedEffect, type OffgameMode, type SaveLevels,
} from '../lib/offgame-calc.js';
import { SIM_STORAGE_KEY, deserializeSim } from '../lib/sim-io.js';
import { ownedIds } from '../lib/sim.js';
import { decodeSaveContext, type SaveContextWire } from '../lib/sim-save-lite.js';
import type { Branch } from '../lib/types.js';

const grid = document.getElementById('board-grid');
const deckRow = document.getElementById('deck-row');
const picker = document.getElementById('dice-picker');
const pickerClose = document.getElementById('picker-close');
const live = document.getElementById('board-live');
const card = document.getElementById('dice-card');
const statsEl = document.getElementById('board-stats');
const offgameEl = document.getElementById('offgame-mode');
const nosaveEl = document.getElementById('offgame-nosave');
const offgameDataEl = document.getElementById('board-offgame');
const detailEl = document.getElementById('dice-detail');

// 這一頁的每一個元素都是 board.astro 直接輸出的靜態 DOM。任何一個抓不到都代表版面被改壞
// 了，這時候什麼都不做比做一半好——不要用 `?.` 一路吞下去，那會變成「畫面沒反應也沒錯誤」。
if (grid && deckRow && picker && pickerClose && live && card && statsEl && offgameEl && nosaveEl && offgameDataEl && detailEl) {
  let board: Board = emptyBoard();
  let deck: Deck = emptyDeck();
  /** 目前正在挑骰子的組合槽；null＝挑選網格是關的。 */
  let pickingSlot: number | null = null;

  /**
   * 局內 SP 強化 Lv，以骰子種類（節點 id）為鍵；沒有就是 1。只在記憶體裡，重整即清空（同骰盤）。
   *
   * ⚠️ 鍵是骰子 id 不是槽位：(1) 挑選網格沒擋重複，同一種骰子可以放在兩槽，兩槽必須顯示同一個值；
   * (2) 換掉槽裡的骰子不會清掉骰盤上的舊骰子（setDeckSlot 只改 deck），那些骰子要保留最後的 Lv。
   * 「清空骰盤」也不動它——Lv 屬於隊伍，不屬於骰盤。
   */
  const spLevels = new Map<string, number>();
  const spLevelOf = (diceId: string): number => spLevels.get(diceId) ?? 1;

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
  /** 頁面開著時存檔可能變（見 refreshSave()），所以是 let。 */
  let simSave = readSimSave();
  /** 預設：讀得到存檔就用它，否則「不含」。切換狀態不存（重整回到預設）。 */
  let mode: OffgameMode = simSave ? 'sim' : 'none';
  const MODE_NAME: Record<OffgameMode, string> = { none: '不含', sim: '我的 /sim', max: '全滿' };
  const MODE_NOTE: Record<OffgameMode, string> = {
    none: '未含骰子樹（符文／被動）加成',
    sim: '局外加成：我的 /sim 存檔',
    max: '局外加成：全部練滿',
  };

  function appliedFor(diceId: string): AppliedEffect[] {
    const branch = offgame.branches[diceId];
    return branch ? appliedEffects(diceId, branch, offgame.effects, levelSource(mode, simSave)) : [];
  }

  /**
   * 整盤的盤面加成（每格一份）。骰盤、強化 Lv、局外模式、存檔任一改變都可能改到任何一格——光的強化 Lv 會改到
   * 它照到的鄰格——所以每次要用就整盤重算（15 格，量很小），不做快取失效。
   */
  function currentBuffs(): CellBuffs[] {
    return boardBuffs({
      board,
      params: id => statParams[id] ?? [],
      spLevel: spLevelOf,
      applied: appliedFor,
      rune: boardRunes(offgame.effects, levelSource(mode, simSave)),
    });
  }

  function renderMode(): void {
    for (const btn of offgameEl!.querySelectorAll<HTMLButtonElement>('button[data-mode]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    }
    const simBtn = offgameEl!.querySelector<HTMLButtonElement>('button[data-mode="sim"]')!;
    if (simSave) simBtn.removeAttribute('aria-disabled');
    else simBtn.setAttribute('aria-disabled', 'true');
    nosaveEl!.hidden = simSave !== null;
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
   * 明細面板描述的是哪一格的哪一顆骰子；null＝空狀態。
   *
   * 跟 cardIndex 分開：卡片收起後面板**保留**最後那顆（手機的面板在頁面最底，要往下捲才看得到，
   * 收掉就來不及看）。記 diceId／pips 是為了分辨「那一格還是不是同一顆」——被拖走、被換掉之後回到
   * 空狀態，不讓面板描述一顆已經不在那裡的骰子。
   */
  let detail: { index: number; diceId: string; pips: number } | null = null;

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
    const p = detail ? board[detail.index] : null;
    if (!detail || !p || p.diceId !== detail.diceId || p.pips !== detail.pips) {
      detail = null;
      detailEmpty.hidden = false;
      detailBody.hidden = true;
      return;
    }
    const lv = spLevelOf(p.diceId);
    const lines = detailLines(statParams[p.diceId] ?? [], p.pips, lv, appliedFor(p.diceId));
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    detailTitle.textContent = cardTitle(diceMeta.get(p.diceId)?.name ?? p.diceId, p.pips, lv);
    fillList(detailOffgameH, detailOffgame, lines.offgame);
    fillList(detailMechanicH, detailMechanic, lines.mechanic);
    // 盤面：這一格拿到的每個來源一行；方向／種類還沒指定的排序、齒輪二階自己再多一行提示。
    const hint = pendingHint(p);
    fillList(detailBoardH, detailBoard, [...(currentBuffs()[detail.index]?.entries ?? []).map(e => e.text), ...(hint ? [hint] : [])]);
    detailNothing.hidden = lines.offgame.length + lines.mechanic.length > 0;
    detailNothing.textContent = mode === 'none' ? '局外加成設為「不含」' : '這顆骰子沒有局外加成';
  }

  /**
   * 數值卡片開在哪一格；null＝關著。
   *
   * ⚠️ 開卡片刻意**不綁 click**：拖曳結束時瀏覽器補送的那發 click 會被 setPointerCapture 導回來源格
   * （見 justDragged 的說明），綁 click 就得把 justDragged 的消費擴到骰盤，而觸控拖曳根本不送 click
   * ——這一頁為同一族問題修過三次。改在 endDrag() 裡判斷「從格子起手、沒超過位移門檻」：
   * 點格子本來就走 pointerdown → startDrag → pointerup → endDrag，滑鼠與觸控同一條路。
   * 鍵盤走 focusin（只認 :focus-visible），跟指標路徑共用 openCard()。
   */
  let cardIndex: number | null = null;

  function cellEl(i: number): HTMLElement | null {
    return grid!.querySelector<HTMLElement>(`.board-cell[data-index="${i}"]`);
  }

  function openCard(i: number): void {
    // 卡片與挑選網格互斥，這裡守「網格開著時不開卡片」（另一半在 openPicker()）。網格沒有焦點陷阱，
    // Tab 會從最後一顆骰子走進骰盤第 0 格（focusin）；網格是貼著視窗底部的浮層，上方露出來的格子也點得到
    // （endDrag）。⚠️ 不要改成 closePicker()：它會把焦點送回組合槽，正在 Tab 的鍵盤使用者會被拉出骰盤。
    if (pickingSlot !== null) {
      closeCard();
      return;
    }
    const p = board[i];
    if (!p) {
      closeCard();
      return;
    }
    if (cardIndex !== null && cardIndex !== i) cellEl(cardIndex)?.removeAttribute('aria-describedby');
    cardIndex = i;
    const buffs = currentBuffs();
    const here = buffs[i]!;
    const m = bonusCardModel(
      diceMeta.get(p.diceId)?.name ?? p.diceId, p.pips, spLevelOf(p.diceId), statParams[p.diceId] ?? [], appliedFor(p.diceId), here,
    );
    cardTitleEl.textContent = m.title;
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
    // 盤面加成不受局外模式影響：這一格有的話在模式說明後面補一句，否則「不含」下出現括號會跟註記矛盾。
    cardNote.textContent = here.entries.length > 0 ? `${MODE_NOTE[mode]}；含盤面加成` : MODE_NOTE[mode];
    card!.hidden = false;
    cellEl(i)?.setAttribute('aria-describedby', 'dice-card');
    renderHighlights(buffs, i);
    detail = { index: i, diceId: p.diceId, pips: p.pips };
    renderDetail();
    positionCard();
  }

  /** 卡片開著時標出盤面加成的來源格（.buff-src）與目標格（.buff-dst）；index 是 null 就全部清掉。 */
  function renderHighlights(buffs: readonly CellBuffs[], index: number | null): void {
    const hl: { src: number[]; dst: number[] } = index === null ? { src: [], dst: [] } : buffHighlights(buffs, index);
    for (const cell of grid!.querySelectorAll<HTMLElement>('.board-cell')) {
      const j = Number(cell.dataset.index);
      cell.classList.toggle('buff-src', hl.src.includes(j));
      cell.classList.toggle('buff-dst', hl.dst.includes(j));
    }
  }

  /** 依目前格子位置擺卡片。捲動與縮放時也要重擺：卡片是 fixed，格子不是。 */
  function positionCard(): void {
    if (cardIndex === null) return;
    const cell = cellEl(cardIndex);
    if (!cell) return;
    // 開在遠離隊伍列的那一側（桌機隊伍列在骰盤上方、手機沉到下方），改強化 Lv 時才看得到按鈕。
    const prefer = deckRow!.getBoundingClientRect().top < grid!.getBoundingClientRect().top ? 'below' : 'above';
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
    if (cardIndex === null) return;
    cellEl(cardIndex)?.removeAttribute('aria-describedby');
    cardIndex = null;
    card!.hidden = true;
    renderHighlights([], null);
  }

  /** 鍵盤路徑：焦點（:focus-visible）停在有骰子的格子上就開那一格，否則關。 */
  function syncCardToFocus(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.classList.contains('board-cell') && el.matches(':focus-visible')) {
      const i = Number(el.dataset.index);
      if (board[i]) {
        openCard(i);
        return;
      }
    }
    closeCard();
  }

  grid.addEventListener('focusin', e => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.board-cell');
    // 只認鍵盤焦點：滑鼠點格子（瀏覽器可能讓它取得焦點）走的是 endDrag() 那條路，這裡再處理一次
    // 會跟它打架（例如把剛開的卡片關掉）。:focus-visible 對滑鼠點按鈕不成立。
    if (!cell || !cell.matches(':focus-visible')) return;
    syncCardToFocus();
  });

  grid.addEventListener('focusout', e => {
    const next = e.relatedTarget;
    // 焦點還在骰盤裡（方向鍵換格）交給 focusin；去強化列或局外加成切換則留著卡片看即時重算。
    if (next instanceof Node && grid!.contains(next)) return;
    if (next instanceof Element && next.closest('.sp-row, #offgame-mode')) return;
    closeCard();
  });

  document.addEventListener('pointerdown', e => {
    if (cardIndex === null) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    // 例外一：有骰子的格子交給拖曳流程（點一下＝endDrag 開那一格、拖動＝pointermove 裡關）。
    const cell = t.closest<HTMLElement>('.board-cell');
    if (cell && board[Number(cell.dataset.index)]) return;
    // 例外二：強化列與局外加成切換——改了之後卡片要留著即時重算。
    if (t.closest('.sp-row, #offgame-mode')) return;
    closeCard();
  });

  window.addEventListener('resize', positionCard);
  window.addEventListener('scroll', positionCard, { passive: true });

  /**
   * 剛結束一次「有位移」的拖曳。**Task 3 只讀它，寫入在 Task 4 的拖曳那一段。**
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

  function renderDeck(): void {
    for (let slot = 0; slot < DECK_SIZE; slot++) {
      const p = deck[slot];
      const btn = deckRow!.querySelector<HTMLButtonElement>(`.deck-dice[data-slot="${slot}"]`)!;
      const value = deckRow!.querySelector<HTMLElement>(`.pips-value[data-slot="${slot}"]`)!;
      const dec = deckRow!.querySelector<HTMLButtonElement>(`.pips-dec[data-slot="${slot}"]`)!;
      const inc = deckRow!.querySelector<HTMLButtonElement>(`.pips-inc[data-slot="${slot}"]`)!;
      const spNum = deckRow!.querySelector<HTMLElement>(`.sp-value[data-slot="${slot}"] .sp-num`)!;
      const spDec = deckRow!.querySelector<HTMLButtonElement>(`.sp-dec[data-slot="${slot}"]`)!;
      const spInc = deckRow!.querySelector<HTMLButtonElement>(`.sp-inc[data-slot="${slot}"]`)!;

      if (p) {
        const meta = diceMeta.get(p.diceId);
        btn.innerHTML = '';
        const img = document.createElement('img');
        img.src = meta?.icon ?? '';
        img.alt = '';
        img.draggable = false;
        btn.append(img);
        // I4（Yuki 拍板）：已填槽的 Enter 拿起、Space 才是換骰子——見下方 #deck-row 的
        // keydown 委派。aria-label 要照實描述兩個鍵各做什麼，不能再寫含糊的「按下更換」。
        btn.setAttribute('aria-label', `第 ${slot + 1} 槽，${meta?.name ?? p.diceId} ${p.pips} 骰點，Enter 拿起，Space 更換`);
        value.textContent = String(p.pips);
        const lv = spLevelOf(p.diceId);
        const name = meta?.name ?? p.diceId;
        spNum.textContent = String(lv);
        spDec.setAttribute('aria-label', `第 ${slot + 1} 槽${name}降低強化等級，目前 Lv.${lv}，最低 1`);
        spInc.setAttribute('aria-label', `第 ${slot + 1} 槽${name}提高強化等級，目前 Lv.${lv}，最高 ${MAX_SP_LEVEL}`);
      } else {
        btn.innerHTML = '<span class="deck-dice-empty" aria-hidden="true">＋</span>';
        btn.setAttribute('aria-label', `第 ${slot + 1} 槽，尚未選擇骰子，按下選擇`);
        value.textContent = '1';
        spNum.textContent = '1';
        spDec.setAttribute('aria-label', `第 ${slot + 1} 槽降低強化等級`);
        spInc.setAttribute('aria-label', `第 ${slot + 1} 槽提高強化等級`);
      }
      // 空槽不能調等級：等級是「這一槽的骰子」的屬性，沒有骰子就沒有等級可言。
      dec.disabled = !p;
      inc.disabled = !p;
      spDec.disabled = !p;
      spInc.disabled = !p;
    }
  }

  function openPicker(slot: number): void {
    // 卡片與挑選網格互斥：卡片（z-index 45）會疊在挑選網格（40）上，而 Escape 的處理假設一次只有一個
    // 要關。兩個入口各守一半——這裡是「開網格時收掉卡片」，另一半「網格開著時不開卡片」在 openCard()。
    // 滑鼠點組合槽時 document 的 pointerdown 已經先關了卡片，但鍵盤（強化列 → 組合槽按 Space／空槽按
    // Enter）走不到那裡，所以收在每一條開網格路徑都會經過的這個函式。
    closeCard();
    pickingSlot = slot;
    picker!.hidden = false;
    picker!.querySelector<HTMLButtonElement>('.picker-dice')?.focus();
  }

  function closePicker(): void {
    const slot = pickingSlot;
    pickingSlot = null;
    picker!.hidden = true;
    if (slot !== null) {
      deckRow!.querySelector<HTMLButtonElement>(`.deck-dice[data-slot="${slot}"]`)?.focus();
    }
  }

  deckRow.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const dice = target.closest<HTMLButtonElement>('.deck-dice');
    if (dice) {
      // 拖曳結束時瀏覽器補送的那一發 click，不是使用者要換骰子（見 justDragged 的說明）。
      if (justDragged) {
        justDragged = false;
        return;
      }
      openPicker(Number(dice.dataset.slot));
      return;
    }
    // 強化列：改的是「這一種骰子」的 Lv（spLevels 以骰子 id 為鍵），所以重畫整條組合列——
    // 同一種骰子在別的槽也要跟著變。
    const spStep = target.closest<HTMLButtonElement>('.sp-inc, .sp-dec');
    if (spStep) {
      const p = deck[Number(spStep.dataset.slot)];
      if (spStep.disabled || !p) return;
      const lv = clampSp(spLevelOf(p.diceId) + (spStep.classList.contains('sp-inc') ? 1 : -1));
      spLevels.set(p.diceId, lv);
      renderDeck();
      // 開著的卡片即時重算——改的是別種骰子也可能變：光的強化 Lv 會改到它照到的鄰格。
      if (cardIndex !== null) openCard(cardIndex);
      renderDetail(); // 卡片收起後面板仍描述那顆骰子，Lv 變了要跟著變
      announce(`${diceMeta.get(p.diceId)?.name ?? p.diceId}強化 Lv.${lv}，同種骰子共用`);
      return;
    }
    const step = target.closest<HTMLButtonElement>('.pips-inc, .pips-dec');
    if (!step || step.disabled) return;
    const slot = Number(step.dataset.slot);
    const current = deck[slot];
    if (!current) return;
    const delta = step.classList.contains('pips-inc') ? 1 : -1;
    deck = setDeckSlot(deck, slot, { diceId: current.diceId, pips: clampPips(current.pips + delta) });
    renderDeck();
    announce(`第 ${slot + 1} 槽改為 ${deck[slot]!.pips} 骰點`);
  });

  picker.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.picker-dice');
    if (!btn || pickingSlot === null) return;
    const diceId = btn.dataset.diceId!;
    // 換骰子時保留這一槽原本的等級：使用者調好 5 骰點之後想換種類，不該被打回 1。
    const pips = deck[pickingSlot]?.pips ?? 1;
    deck = setDeckSlot(deck, pickingSlot, { diceId, pips });
    const slot = pickingSlot;
    closePicker();
    renderDeck();
    announce(`第 ${slot + 1} 槽選擇 ${diceMeta.get(diceId)?.name ?? diceId}`);
  });

  pickerClose.addEventListener('click', closePicker);

  offgameEl.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
    if (!btn) return;
    const next = btn.dataset.mode as OffgameMode;
    if (next === 'sim' && !simSave) {
      announce('沒有找到 /sim 的存檔');
      return;
    }
    mode = next;
    renderMode();
    // 開著的卡片原地重算：切換鈕在 pointerdown／focusout 的豁免清單裡，卡片不會先被收掉。
    if (cardIndex !== null) openCard(cardIndex);
    renderDetail();
    announce(`局外加成：${MODE_NAME[mode]}`);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pickingSlot !== null) {
      e.preventDefault();
      closePicker();
    }
  });

  document.addEventListener('keydown', e => {
    // held 的 Escape（放下）與挑選網格的 Escape 都會 preventDefault——先讓它們吃掉，這裡只收剩下的。
    if (e.key === 'Escape' && !e.defaultPrevented && cardIndex !== null) {
      e.preventDefault();
      closeCard();
    }
  });

  renderDeck();
  renderMode();

  /**
   * 頁面開著時 /sim 的存檔變了：另一個分頁的 /sim 存了檔，或去 /sim 排好再按上一頁（這一頁從 bfcache
   * 原封回來，腳本不會重跑）。重讀一次，讓「我的 /sim」能不能按、提示、開著的卡片與明細面板跟上。
   * ⚠️ 不自動切到「我的 /sim」、也不播報：使用者沒有動這一頁，模式不該自己變。只有正在用的存檔不見了
   * 才退回「不含」——否則卡片描述的是一份已經不存在的規劃。仍然只讀不寫。
   */
  function refreshSave(): void {
    simSave = readSimSave();
    if (mode === 'sim' && !simSave) mode = 'none';
    renderMode();
    if (cardIndex !== null) openCard(cardIndex);
    renderDetail();
  }
  window.addEventListener('pageshow', e => {
    if (e.persisted) refreshSave();
  });
  // storage 事件只送給「別的」分頁；key 是 null＝那邊呼叫了 clear()。
  window.addEventListener('storage', e => {
    if (e.key === SIM_STORAGE_KEY || e.key === null) refreshSave();
  });

  /**
   * 只重畫格子（圖示、骰點、角標、aria-label）。卡片與明細要不要跟著動由呼叫端決定：
   * 骰盤內容變了走 renderBoard()（收卡片），切換角標走 cycleAt()（卡片原地重算）。
   */
  function renderCells(): void {
    for (const cell of grid!.querySelectorAll<HTMLButtonElement>('.board-cell')) {
      const i = Number(cell.dataset.index);
      const p = board[i];
      const row = Math.floor(i / 5) + 1;
      const col = (i % 5) + 1;
      cell.innerHTML = '';
      if (p) {
        const meta = diceMeta.get(p.diceId);
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
        cell.setAttribute('aria-label', `第 ${row} 列第 ${col} 格，${meta?.name ?? p.diceId} ${p.pips} 骰點${b ? `，${b.spoken}，按 R 切換` : ''}`);
      } else {
        cell.setAttribute('aria-label', `第 ${row} 列第 ${col} 格，空`);
      }
    }
  }

  function renderBoard(): void {
    renderCells();
    // 骰盤內容變了（放下／交換／移除／清空）：卡片描述的那一格可能已經不是原本那顆，收掉。
    closeCard();
    // 明細面板不收（它刻意保留），但那顆被移走或換掉時要回到空狀態——renderDetail() 自己會判斷。
    renderDetail();
  }

  /**
   * 切換第 i 格的角標（排序方向／齒輪二階種類）。跟 renderBoard() 不同：**卡片不收**——開著的那張（不一定是這一格）
   * 原地重算，明細跟上，播報新狀態。指標（endDrag 的 onBadge）與鍵盤（R）共用這一支。
   */
  function cycleAt(i: number): void {
    const next = cycleBadge(board, i);
    if (next === board) return;
    board = next;
    renderCells();
    if (cardIndex !== null) openCard(cardIndex);
    renderDetail();
    announce(badgeText(board[i])!.announce);
  }

  /** 目前正在拖的東西。`from` 是來源格 index，來自組合列時為 null。
   *  `moved` 記「這一次按下之後指標有沒有超過 DRAG_THRESHOLD_PX」——原地點一下與拖曳要分得開。
   *  `pointerId` 與 `startX`／`startY` 是 I3／I1 成因 B 用的：見 `startDrag()` 與
   *  `attachDragHandlers()` 的說明。`onBadge`＝按下的點在格子的角標上（原地放開＝切換角標，見 endDrag）。 */
  let dragging: {
    payload: Placed; from: number | null; ghost: HTMLElement; moved: boolean;
    pointerId: number; startX: number; startY: number; onBadge: boolean;
  } | null = null;


  function cellUnder(x: number, y: number): number | null {
    // ⚠️ 拖曳影像必須是 pointer-events: none，否則這裡永遠只會抓到影像自己。
    const el = document.elementFromPoint(x, y);
    const cell = el?.closest<HTMLElement>('.board-cell');
    if (!cell) return null;
    const i = Number(cell.dataset.index);
    return inBoard(i) ? i : null;
  }

  function highlight(index: number | null): void {
    for (const cell of grid!.querySelectorAll<HTMLElement>('.board-cell')) {
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
    const meta = diceMeta.get(payload.diceId);
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
      else openCard(from);
      return;
    }

    const target = cellUnder(x, y);
    if (target === null) {
      // 拖到骰盤外：來自格子＝移除，來自組合列＝什麼都不做。
      if (from !== null) {
        board = clear(board, from);
        renderBoard();
        announce('已移除一顆骰子');
      }
      return;
    }
    if (from === null) {
      board = place(board, target, payload);
      announce(`${diceMeta.get(payload.diceId)?.name ?? payload.diceId} ${payload.pips} 骰點放到第 ${Math.floor(target / 5) + 1} 列第 ${(target % 5) + 1} 格`);
    } else {
      // ⚠️ swap() 在 from === target 時是 no-op（回原陣列）。無條件播報的話，在已有骰子的
      // 格子上「原地點一下」就會讓螢幕閱讀器收到一句「兩格已交換」，而畫面上什麼都沒動。
      const next = swap(board, from, target);
      if (next !== board) {
        board = next;
        announce('兩格已交換');
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
          closeCard();
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
    const btn = deckRow.querySelector<HTMLElement>(`.deck-dice[data-slot="${slot}"]`)!;
    attachDragHandlers(btn, () => deck[slot] ?? null, null);
  }
  for (const cell of grid.querySelectorAll<HTMLElement>('.board-cell')) {
    const i = Number(cell.dataset.index);
    attachDragHandlers(cell, () => board[i] ?? null, i);
  }

  document.getElementById('board-clear')?.addEventListener('click', () => {
    board = emptyBoard();
    // 清空之後 held 若還指著一顆已經不存在的骰子，鍵盤 Enter 會把它憑空放回來。
    held = null;
    renderBoard();
    announce('骰盤已清空');
  });

  /**
   * 鍵盤版的「拿在手上」。
   *
   * 這一段不是裝飾：設計階段否掉「全 canvas」方案的唯一理由就是它給不了鍵盤與螢幕閱讀器
   * 路徑。DOM 方案的代價就是這裡要真的寫完，不能只做滑鼠。
   */
  let held: { payload: Placed; from: number | null } | null = null;

  function focusCell(index: number): void {
    grid!.querySelector<HTMLElement>(`.board-cell[data-index="${index}"]`)?.focus();
  }

  deckRow.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.deck-dice');
    if (!btn) return;
    const slot = Number(btn.dataset.slot);
    const p = deck[slot];
    // 空槽維持原本行為：Enter 與 Space 都打開挑選網格（click 事件會處理），不要攔。
    if (!p) return;
    // I4（全分支 review，Yuki 拍板）：已填槽以前 Enter／Space 兩個鍵都被攔下改成「拿起」，
    // click 從此不再派發，挑選網格永遠打不開——純鍵盤使用者填滿 5 槽之後再也換不掉任何一顆，
    // 而 aria-label 還寫著「按下更換」。現在 Space 改開挑選網格換骰子，Enter 維持「拿起」
    // 不變（放到骰盤上再按一次 Enter 放下）。空槽與滑鼠行為兩者都不動。
    if (e.key === ' ') {
      e.preventDefault();
      openPicker(slot);
      return;
    }
    e.preventDefault();
    held = { payload: p, from: null };
    announce(`拿起 ${diceMeta.get(p.diceId)?.name ?? p.diceId} ${p.pips} 骰點，移到骰盤上按 Enter 放下`);
  });

  grid.addEventListener('keydown', e => {
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
      if (!badgeKind(board[i])) return;
      e.preventDefault();
      cycleAt(i);
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (held) {
        const next = held.from === null ? place(board, i, held.payload) : swap(board, held.from, i);
        const name = diceMeta.get(held.payload.diceId)?.name ?? held.payload.diceId;
        held = null;
        // ⚠️ 比照 endDrag：swap() 在 held.from === i 時是 no-op（回原陣列）。無條件播報的話，
        // 「拿起後在原地按 Enter」會讓螢幕閱讀器收到一句「放到第 X 列 Y 格」，畫面卻什麼都沒動。
        // place() 一定會真的寫入（組合列來源沒有「原地」這回事），只有 swap 分支需要這層保護。
        if (next !== board) {
          board = next;
          announce(`${name} 放到第 ${row + 1} 列第 ${col + 1} 格`);
        }
        renderBoard();
        focusCell(i);
        // renderBoard() 收掉了卡片，而焦點本來就在這一格（focus() 不會再觸發 focusin）→ 手動同步。
        syncCardToFocus();
      } else if (board[i]) {
        held = { payload: board[i]!, from: i };
        announce(`拿起第 ${row + 1} 列第 ${col + 1} 格的骰子，移到目標格按 Enter 放下`);
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!board[i]) return;
      board = clear(board, i);
      held = null;
      renderBoard();
      focusCell(i);
      announce(`已移除第 ${row + 1} 列第 ${col + 1} 格的骰子`);
      return;
    }

    if (e.key === 'Escape' && held) {
      e.preventDefault();
      held = null;
      announce('已放下');
    }
  });

  const exportBtn = document.getElementById('board-export') as HTMLButtonElement | null;
  const exportOut = document.getElementById('board-export-out');
  const exportImg = document.getElementById('board-export-img') as HTMLImageElement | null;

  /**
   * 「隱藏星數」：切換 `#board-grid` 的 `.cell-pips`（骰盤格右下角 1–7 那個數字）。
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
      grid!.classList.toggle('hide-pips', hidePips);
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
        const canvas = await renderShareImage({ board, deck, meta: diceMeta, hidePips });
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

  renderBoard();
}
