// 骰盤編輯器的客戶端行為。
//
// 這一支只做兩件事：把使用者的操作翻譯成 src/lib/board.ts 的純函式呼叫，然後把新狀態
// 畫回 DOM。任何「放哪、換哪、清哪」的判斷都不寫在這裡——那些在 lib 裡，有單元測試。
import {
  COLS, DECK_SIZE, ROWS, cellPos, clampPips, clear, emptyBoard, emptyDeck, inBoard, place, setDeckSlot, swap,
  type Board, type Deck, type Placed,
} from '../lib/board.js';
import { renderShareImage } from './board-export.js';

const grid = document.getElementById('board-grid');
const deckRow = document.getElementById('deck-row');
const picker = document.getElementById('dice-picker');
const pickerClose = document.getElementById('picker-close');
const live = document.getElementById('board-live');

// 這一頁的每一個元素都是 board.astro 直接輸出的靜態 DOM。任何一個抓不到都代表版面被改壞
// 了，這時候什麼都不做比做一半好——不要用 `?.` 一路吞下去，那會變成「畫面沒反應也沒錯誤」。
if (grid && deckRow && picker && pickerClose && live) {
  let board: Board = emptyBoard();
  let deck: Deck = emptyDeck();
  /** 目前正在挑骰子的組合槽；null＝挑選網格是關的。 */
  let pickingSlot: number | null = null;

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
      } else {
        btn.innerHTML = '<span class="deck-dice-empty" aria-hidden="true">＋</span>';
        btn.setAttribute('aria-label', `第 ${slot + 1} 槽，尚未選擇骰子，按下選擇`);
        value.textContent = '1';
      }
      // 空槽不能調等級：等級是「這一槽的骰子」的屬性，沒有骰子就沒有等級可言。
      dec.disabled = !p;
      inc.disabled = !p;
    }
  }

  function openPicker(slot: number): void {
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

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pickingSlot !== null) {
      e.preventDefault();
      closePicker();
    }
  });

  renderDeck();

  function renderBoard(): void {
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
        cell.setAttribute('aria-label', `第 ${row} 列第 ${col} 格，${meta?.name ?? p.diceId} ${p.pips} 骰點`);
      } else {
        cell.setAttribute('aria-label', `第 ${row} 列第 ${col} 格，空`);
      }
    }
  }

  /** 目前正在拖的東西。`from` 是來源格 index，來自組合列時為 null。
   *  `moved` 記「這一次按下之後指標有沒有超過 DRAG_THRESHOLD_PX」——原地點一下與拖曳要分得開。
   *  `pointerId` 與 `startX`／`startY` 是 I3／I1 成因 B 用的：見 `startDrag()` 與
   *  `attachDragHandlers()` 的說明。 */
  let dragging: {
    payload: Placed; from: number | null; ghost: HTMLElement; moved: boolean;
    pointerId: number; startX: number; startY: number;
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
    dragging = { payload, from, ghost, moved: false, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
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
    const { payload, from } = dragging;
    // ⚠️ 只有 #deck-row 的 click 委派會消費 justDragged。從骰盤格起手的拖曳
    // （格↔格交換、格→骰盤外移除）結束後，setPointerCapture 導回的那發 click
    // 落在 .board-cell 上，那裡沒有監聽器會讀它——寫 true 進去只會讓旗標卡住，
    // 直到下一次 startDrag() 才被重置，使用者下一次點組合列的空槽要點兩次才開得了。
    justDragged = from === null && dragging.moved;
    dragging.ghost.remove();
    dragging = null;
    highlight(null);

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
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragging.moved = true;
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
   * 表達狀態，視覺只換底色（見 global.css），不加尺寸會變的指示元素。
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
