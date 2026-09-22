// /board 的盤面加成：骰盤上其他骰子給的增益（光、排序、共鳴、陰陽、齒輪、齒輪二階、霓虹）。純函式，不碰 DOM。
//
// 規則全部來自遊戲客戶端的逆向結果（PlayerComp.CheckStatBuff4Defender、DefenderComp.CheckStatBuff 與各骰子的技能）：
// - 效果掛在「格子」上。光（四鄰；有 1306 → 八鄰）、排序（自己往方向到盤緣的整條射線）、共鳴（同骰點的全部骰子，
//   含自己；7 骰點＝全盤）是施加者給別格；陰陽、齒輪、齒輪二階、霓虹是骰子看盤面組成給自己。
// - 施加者的數值＝施加者自己那一列在局外加成之後的值（offgame-calc.ts 的 rowValue()）：基礎增益就是
//   dice-stats.json 裡那顆骰子的一列，光增益攻擊速度%增加這類符文是加在那一列上的 statAdd。這裡不另寫成長式。
// - 同格的光（含 7 骰點）先相加成一個攻速來源；共鳴攻速也相加成一個（合作模式下連隊友盤的共鳴攻速
//   都併進同一個來源，不可以拆成本盤／隊友盤兩個元素分開扣）；陰陽橫排、齒輪相連、齒輪二階各自一個。
// - 攻擊%：排序、排序疊加強化（4307 × 該格排序層數，1 層也算）、三重共鳴（同骰點共鳴 ≥3 顆；7 骰點的共鳴數的是
//   盤上全部共鳴）進被動那個池；
//   陰陽直排進狀態效果池。怎麼合進卡片的數字見 offgame-calc.ts 的 bonusCardModel()。
// - 霓虹：盤上霓虹恰好 3／5／7 顆（該顆 7 骰點恆啟用；有 2305 時恰好 1 顆也啟用）→ 2205 在發射時 ÷(1+x)。
// - 排序方向、齒輪二階種類在 7 骰點以下是局內隨機：沒指定（角標「?」）就不套用，不猜。
// ⚠️ 命中時才結算的（齒輪相連傷害、齒輪二階動力、陰陽和諧、霓虹傷害、孤獨）與戰術的格子加成不在這裡。
import {
  ALIGNMENT_ID, CELLS, COLS, GEAR_SECOND_ID, MAX_PIPS, ROWS, badgeKind, badgeText, cellPos,
  type Board, type Dir, type Placed,
} from './board.js';
import { formatNumber, round9, type StatParams } from './dice-calc.js';
import { effectValue, type NamedEffect } from './offgame.js';
import { NO_BOARD, rowValue, type AppliedEffect, type BoardBonus } from './offgame-calc.js';

export const LIGHT_ID = '1006';
export const RESONANCE_ID = '3002';
export const BINGO_ID = '4008';
export const GEAR_ID = '2003';
export const NEON_ID = '2005';

/** 施加者自己的那一列（dice-stats.json 的列名，逐字）。 */
export const BUFF_ROWS = {
  light: '攻擊速度增益',
  alignment: '傷害增益量',
  resonance: '攻擊速度增益量',
  bingoRow: '橫排攻擊速度增加量',
  bingoCol: '直排傷害增加量',
  gearSpeed: '變速齒輪攻擊速度增益量',
} as const;

/** 盤面增益用的符文（offgame-effects.json 裡 target 是 board 的那幾筆）。 */
export const BOARD_RUNES = {
  /** 光增益範圍：四鄰 → 八鄰。 */
  lightArea: '1306',
  /** 霓虹啟用攻擊速度%。 */
  neonSpeed: '2205',
  /** 啟用 1 格霓虹。 */
  neonOne: '2305',
  /** 齒輪連接加速：相連數 × 5%。 */
  gearLink: '2403',
  /** 三重共鳴：同骰點共鳴 ≥3 顆時，每顆給 +10% 攻擊（7 骰點的共鳴數的是盤上全部共鳴，任何骰點）。 */
  resonanceTrio: '3402',
  /** 排序疊加強化：10% × 該格排序層數。 */
  alignmentStack: '4307',
} as const;

/** 7 骰點光給鄰格的暴擊率（客戶端 kind 17：每一個效果 CritPer += 10）。卡片不顯示暴擊，只列明細。 */
const LIGHT7_CRIT = 10;

export type BuffKind =
  | 'light' | 'lightCrit' | 'alignment' | 'alignmentStack' | 'resonanceSpeed' | 'resonanceAttack'
  | 'bingoRow' | 'bingoCol' | 'gear' | 'gearSecond' | 'neon';

/** 一格上的一個加成來源：明細面板的一行，以及開卡片時要標成 .buff-src 的格子。 */
export interface BuffEntry {
  kind: BuffKind;
  /** 給這個加成的**本盤**格子，不含自己（照 index 排序）。 */
  from: number[];
  /** 給這個加成的**隊友盤**格子（照 index 排序）。對戰模式永遠是空陣列。 */
  fromPartner: number[];
  text: string;
}

export interface CellBuffs extends BoardBonus {
  entries: BuffEntry[];
}

export const NO_BUFFS: CellBuffs = { ...NO_BOARD, entries: [] };

/** 一盤的取值來源。⚠️ 每一盤自帶 applied／spLevel／rune：隊友的局外加成是獨立切換，共用會少算。 */
export interface BuffSide {
  board: Board;
  /** 骰子的計算參數（board.astro 建置期注入的那份），以骰子 id 為鍵；沒有就是空陣列。 */
  params: (diceId: string) => readonly StatParams[];
  /** 局內強化 Lv（同種骰子共用）。 */
  spLevel: (diceId: string) => number;
  /** 局外節點（依那一盤目前的模式）：施加者那一列的 statAdd 符文從這裡進來。 */
  applied: (diceId: string) => readonly AppliedEffect[];
  /** 盤面符文的當前值；沒有（沒解開，或模式是「不含」）＝null。1306／2305 這種值是 0 的開關只看有沒有。 */
  rune: (id: string) => number | null;
}

export interface BuffInput extends BuffSide {
  /**
   * 合作模式的另一盤。對戰模式是 undefined——那條路徑與這個欄位出現之前逐項相同。
   * ⚠️ 只有排序（單一方向）與共鳴兩條規則讀得到它，其餘五條不跨盤（客戶端 IsCoop 的呼叫者掃過）。
   */
  partner?: BuffSide & {
    /**
     * 那一盤上「會跨盤打到這一盤」的排序方向（畫面方向）。**沒有預設，兩個呼叫端都要自己指定。**
     *
     * ⚠️ 客戶端只有一個方向會跨盤，而畫面上兩盤各自指向對方（實機 2026-09-22 驗過：上面那盤
     * 箭頭 ↓ 才加到下面那盤），所以這個值在兩份計算裡是相反的：算我的盤時隊友盤畫在上面 → 2，
     * 算隊友盤時我的盤畫在下面 → 0。給定值寫死成同一個的話，會有一盤靜靜地完全不生效。
     */
    crossDir: Dir;
  };
  /**
   * 跨盤來源在明細文字裡的稱呼（`排序（<這個字> 第 1 列第 2 格 ↑）：…`）。預設「隊友盤」。
   *
   * ⚠️ 它是**看的人**的視角，不是這份輸入的視角。呼叫端算的是「被點的那一盤」的加成，所以點
   * 隊友盤上的骰子時 `partner` 指的是使用者自己的盤——照預設印出來會把使用者自己盤上的來源
   * 說成「隊友盤」，指到相反的地方。替隊友那一盤算時要傳「我的盤」。
   */
  partnerLabel?: string;
}

/** 盤面符文的取值：等級來源跟局外加成同一個（offgame-calc.ts 的 levelSource()）。 */
export function boardRunes(
  effects: Readonly<Record<string, NamedEffect>>,
  levelOf: (id: string, e: NamedEffect) => number,
): (id: string) => number | null {
  return id => {
    const e = effects[id];
    if (!e) return null;
    const lv = Math.min(levelOf(id, e), e.maxLevel);
    return lv >= 1 ? effectValue(e, lv) : null;
  };
}

/** 方向 → 列／欄的位移（0 上、1 右、2 下、3 左，同 Dir）。 */
const STEP = [[-1, 0], [0, 1], [1, 0], [0, -1]] as const;

function at(row: number, col: number): number | null {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS ? row * COLS + col : null;
}

/** 四鄰或八鄰，不含自己、不出界，照 index 排序。 */
function neighbors(i: number, eight: boolean): number[] {
  const { row, col } = cellPos(i);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((dr === 0 && dc === 0) || (!eight && dr !== 0 && dc !== 0)) continue;
      const j = at(row + dr, col + dc);
      if (j !== null) out.push(j);
    }
  }
  return out;
}

/** 排序的射線：自己往 dir 一路到盤緣的每一格，不含自己，由近到遠。 */
export function ray(i: number, dir: Dir): number[] {
  const [dr, dc] = STEP[dir];
  const { row, col } = cellPos(i);
  const out: number[] = [];
  for (let k = 1; ; k++) {
    const j = at(row + dr * k, col + dc * k);
    if (j === null) return out;
    out.push(j);
  }
}

/** 從 i 出發、只經過同一種骰子的四鄰 flood-fill（含 i），照 index 排序。 */
function connected(board: Board, i: number, diceId: string): number[] {
  const seen = new Set([i]);
  const stack = [i];
  for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
    for (const j of neighbors(cur, false)) {
      if (!seen.has(j) && board[j]?.diceId === diceId) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return [...seen].sort((a, b) => a - b);
}

const pct = (n: number): string => formatNumber(n, 3);
const sum = (ns: readonly number[]): number => round9(ns.reduce((s, n) => s + n, 0));
const isSeven = (p: Placed): boolean => p.pips >= MAX_PIPS;
function where(i: number): string {
  const { row, col } = cellPos(i);
  return `第 ${row + 1} 列第 ${col + 1} 格`;
}

/**
 * 整個骰盤的盤面加成，每格一份（空格是 NO_BUFFS）。量很小（15 格），呼叫端每次要用就整盤重算，不做快取。
 * 明細面板的行在這裡就排好順序：光 → 7 點光暴擊 → 排序（依施加者位置）→ 排序疊加 → 共鳴攻速（依骰點）→
 * 三重共鳴 → 陰陽橫排 → 陰陽直排 → 齒輪 → 齒輪二階 → 霓虹。
 */
export function boardBuffs(input: BuffInput): CellBuffs[] {
  const { board, rune, partner } = input;
  const partnerLabel = input.partnerLabel ?? '隊友盤';
  /** 某一盤上、施加者那一列在**那一盤**局外加成之後的值；列不存在時當 0。 */
  const rowIn = (side: BuffSide, p: Placed, label: string): number =>
    rowValue(side.params(p.diceId), label, p.pips, side.spLevel(p.diceId), side.applied(p.diceId)) ?? 0;
  const rowOf = (p: Placed, label: string): number => rowIn(input, p, label);
  const cellsIn = (b: Board, diceId: string): number[] =>
    [...Array(CELLS).keys()].filter(j => b[j]?.diceId === diceId);
  const cellsOf = (diceId: string): number[] => cellsIn(board, diceId);

  return board.map((me, i): CellBuffs => {
    if (!me) return NO_BUFFS;
    let attackPct = 0;
    let statusPct = 0;
    let neonPct = 0;
    const intervalPcts: number[] = [];
    const entries: BuffEntry[] = [];
    // ⚠️ from 要排除自己（同一盤的同 index 就是這一格）；fromPartner 不排除——不同盤的同 index 是不同格。
    const add = (kind: BuffKind, from: readonly number[], text: string, fromPartner: readonly number[] = []): void => {
      entries.push({ kind, from: from.filter(j => j !== i), text, fromPartner: [...fromPartner] });
    };

    // 光：四鄰（有 1306 → 八鄰）的每一顆光，同格先相加成一個攻速來源。
    const lights = neighbors(i, rune(BOARD_RUNES.lightArea) !== null).filter(j => board[j]?.diceId === LIGHT_ID);
    if (lights.length > 0) {
      const v = sum(lights.map(j => rowOf(board[j]!, BUFF_ROWS.light)));
      intervalPcts.push(v);
      add('light', lights, `鄰格光 ×${lights.length}：攻速 +${pct(v)}%`);
      const sevens = lights.filter(j => isSeven(board[j]!));
      if (sevens.length > 0) {
        add('lightCrit', sevens, `鄰格 7 點光 ×${sevens.length}：暴擊率 +${pct(LIGHT7_CRIT * sevens.length)}%`);
      }
    }

    // 排序：射線蓋到這一格的每一顆排序（7 骰點四向；方向沒指定的不算）。
    const aligns = cellsOf(ALIGNMENT_ID).filter(j => {
      const a = board[j]!;
      const dirs: readonly Dir[] = isSeven(a) ? [0, 1, 2, 3] : a.dir === undefined ? [] : [a.dir];
      return j !== i && dirs.some(d => ray(j, d).includes(i));
    });
    for (const j of aligns) {
      const a = board[j]!;
      const v = rowOf(a, BUFF_ROWS.alignment);
      attackPct += v;
      add('alignment', [j], `排序（${where(j)} ${isSeven(a) ? '四向' : badgeText(a)!.glyph}）：攻擊 +${pct(v)}%`);
    }

    // 跨盤排序：另一盤上箭頭指著這一盤（crossDir；或 7 骰點四向）的排序骰，對我這一欄的整欄三格施加。
    // ⚠️ 不是射線延伸：客戶端無條件對同一欄（同 W）的 H'=0,1,2 三格施加，與施加者自己在哪一列無關。
    // ⚠️ 客戶端只有一個方向有 coop 分支（另外三個方向沒有），對到畫面上就是「指向對方那一盤」的
    //    那一個——所以方向要由呼叫端傳（crossDir），這裡不能寫死，見 BuffInput.partner 的說明。
    const myCol = cellPos(i).col;
    const acrossAligns = partner
      ? cellsIn(partner.board, ALIGNMENT_ID).filter(j => {
          const a = partner.board[j]!;
          return (isSeven(a) || a.dir === partner.crossDir) && cellPos(j).col === myCol;
        })
      : [];
    for (const j of acrossAligns) {
      const a = partner!.board[j]!;
      const v = rowIn(partner!, a, BUFF_ROWS.alignment);
      attackPct += v;
      add('alignment', [], `排序（${partnerLabel} ${where(j)} ${isSeven(a) ? '四向' : badgeText(a)!.glyph}）：攻擊 +${pct(v)}%`, [j]);
    }

    // 排序疊加強化（4307）：10% × 該格排序層數，1 層也算。
    // ⚠️【推論，高】跨盤掛上去的是同一格上同一種效果，所以層數一起數。客戶端沒有直接讀到
    //    這一段的計數方式（要讀對應的計數邏輯才能升等這個推論）。
    const layers = aligns.length + acrossAligns.length;
    const stack = rune(BOARD_RUNES.alignmentStack);
    if (layers > 0 && stack !== null) {
      const v = round9(stack * layers);
      attackPct += v;
      add('alignmentStack', aligns, `排序疊加強化 ×${layers}：攻擊 +${pct(v)}%`, acrossAligns);
    }

    // 共鳴：同骰點（7 骰點的共鳴＝全盤）的每一顆共鳴，含自己；攻速相加成一個來源，明細依施加者骰點分行。
    // ⚠️ 合作：客戶端把隊友盤的共鳴累加進同一組 buf，而且「同骰點」是跨盤比對的
    //    （比的是施加者的骰點 vs 我這一格的骰點），所以隊友那顆 5 骰點共鳴會加到我盤所有 5 骰點的格子。
    const matches = (b: Board, j: number): boolean => isSeven(b[j]!) || b[j]!.pips === me.pips;
    const res = cellsOf(RESONANCE_ID).filter(j => matches(board, j));
    const resThere = partner ? cellsIn(partner.board, RESONANCE_ID).filter(j => matches(partner.board, j)) : [];

    const pipsOf = (b: Board, js: readonly number[]): number[] =>
      [...new Set(js.map(j => b[j]!.pips))].sort((a, b2) => a - b2);

    let mineResSum = 0;
    let theirsResSum = 0;
    if (res.length > 0) {
      for (const p of pipsOf(board, res)) {
        const js = res.filter(j => board[j]!.pips === p);
        add('resonanceSpeed', js, `共鳴（${p} 骰點 ×${js.length}）：攻速 +${pct(sum(js.map(j => rowOf(board[j]!, BUFF_ROWS.resonance))))}%`);
      }
      mineResSum = sum(res.map(j => rowOf(board[j]!, BUFF_ROWS.resonance)));
    }
    if (resThere.length > 0) {
      const pb = partner!.board;
      for (const p of pipsOf(pb, resThere)) {
        const js = resThere.filter(j => pb[j]!.pips === p);
        add('resonanceSpeed', [], `共鳴（${partnerLabel} ${p} 骰點 ×${js.length}）：攻速 +${pct(sum(js.map(j => rowIn(partner!, pb[j]!, BUFF_ROWS.resonance))))}%`, js);
      }
      theirsResSum = sum(resThere.map(j => rowIn(partner!, pb[j]!, BUFF_ROWS.resonance)));
    }
    // ⚠️ 兩段（本盤／隊友盤）要合併成同一個攻速來源再推進去：intervalAfter() 對 intervalPcts 的
    //    每個元素各自扣 i0·r/(1+r)，拆成兩個元素會比合併扣得多（r/(1+r) 是凹函數），算出來的
    //    攻擊間隔會偏快。明細行仍照施加者分開列，只有這裡進位的數字要先加總。
    if (res.length > 0 || resThere.length > 0) intervalPcts.push(round9(mineResSum + theirsResSum));

    // 三重共鳴（3402）：同骰點共鳴 ≥3 顆時，每顆 +10% 攻擊；施加者是 7 骰點時數盤上全部共鳴。
    // ⚠️ 合作：≥3 顆的門檻**在施加者自己的那一盤內數**，兩盤不可以加起來再判
    //    （客戶端的共鳴累加是依施加者的來源盤各自計數）。
    // ⚠️ 符文要讀**共鳴骰自己那一盤**的：3402 的 scope 是 dice:3002，它是共鳴骰子的符文，
    //    跟「誰在看這張卡片」無關。兩盤的局外加成是各自切換的，而且預設就不一樣（隊友的符文
    //    等級拿不到，那一側預設取上界「全滿」），讀錯邊時隊友那幾顆共鳴骰的加成會整個消失，
    //    畫面上跟「客戶端本來就沒給」一模一樣。
    const applyTrio = (side: BuffSide, js: readonly number[], isPartner: boolean): void => {
      const trio = side.rune(BOARD_RUNES.resonanceTrio);
      if (trio === null) return;
      const b = side.board;
      const allRes = cellsIn(b, RESONANCE_ID).length;
      for (const p of pipsOf(b, js)) {
        const same = js.filter(j => b[j]!.pips === p);
        if ((p >= MAX_PIPS ? allRes : same.length) < 3) continue;
        const v = round9(trio * same.length);
        attackPct += v;
        if (isPartner) add('resonanceAttack', [], `三重共鳴（${partnerLabel} ${p} 骰點 ×${same.length}）：攻擊 +${pct(v)}%`, same);
        else add('resonanceAttack', same, `三重共鳴（${p} 骰點 ×${same.length}）：攻擊 +${pct(v)}%`);
      }
    };
    applyTrio(input, res, false);
    if (partner) applyTrio(partner, resThere, true);

    // 陰陽：只給自己——自己那一列 5 格全是陰陽（攻速）、自己那一欄 3 格全是陰陽（狀態效果池）。
    if (me.diceId === BINGO_ID) {
      const { row, col } = cellPos(i);
      const rowCells = [...Array(COLS).keys()].map(c => row * COLS + c);
      const colCells = [...Array(ROWS).keys()].map(r => r * COLS + col);
      if (rowCells.every(j => board[j]?.diceId === BINGO_ID)) {
        const v = rowOf(me, BUFF_ROWS.bingoRow);
        intervalPcts.push(v);
        add('bingoRow', rowCells, `陰陽橫排：攻速 +${pct(v)}%`);
      }
      if (colCells.every(j => board[j]?.diceId === BINGO_ID)) {
        const v = rowOf(me, BUFF_ROWS.bingoCol);
        statusPct += v;
        add('bingoCol', colCells, `陰陽直排：攻擊 +${pct(v)}%`);
      }
    }

    // 齒輪：只給自己——四鄰相連的齒輪數（含自己，1 顆＝0）× 2403。
    const link = rune(BOARD_RUNES.gearLink);
    if (me.diceId === GEAR_ID && link !== null) {
      const group = connected(board, i, GEAR_ID);
      if (group.length >= 2) {
        const v = round9(link * group.length);
        intervalPcts.push(v);
        add('gear', group, `齒輪相連 ×${group.length}：攻速 +${pct(v)}%`);
      }
    }

    // 齒輪二階：群組（只經由齒輪二階四鄰相連、含自己、≥2 顆）裡每一顆變速齒輪（7 骰點也算）的那一列加總，
    // 每一顆用它自己的骰點。群組裡的每一顆都拿到同一個數。
    if (me.diceId === GEAR_SECOND_ID) {
      const group = connected(board, i, GEAR_SECOND_ID);
      const speed = group.filter(j => isSeven(board[j]!) || board[j]!.gear === 'speed');
      if (group.length >= 2 && speed.length > 0) {
        const v = sum(speed.map(j => rowOf(board[j]!, BUFF_ROWS.gearSpeed)));
        intervalPcts.push(v);
        add('gearSecond', speed, `齒輪二階變速 ×${speed.length}：攻速 +${pct(v)}%`);
      }
    }

    // 霓虹：只給自己——盤上霓虹（任何骰點）恰好 3／5／7 顆；自己 7 骰點恆啟用；有 2305 時恰好 1 顆也啟用。
    const neonSpeed = rune(BOARD_RUNES.neonSpeed);
    if (me.diceId === NEON_ID && neonSpeed !== null && neonSpeed > 0) {
      const neons = cellsOf(NEON_ID);
      const n = neons.length;
      const byCount = n === 3 || n === 5 || n === 7 || (n === 1 && rune(BOARD_RUNES.neonOne) !== null);
      if (byCount || isSeven(me)) {
        neonPct = neonSpeed;
        // 只靠自己 7 骰點啟用時，盤上其他霓虹沒有貢獻：不列成來源格，文字也不寫顆數。
        if (byCount) add('neon', neons, `霓虹啟用（盤上 ${n} 顆）：子彈攻速 +${pct(neonSpeed)}%`);
        else add('neon', [], `霓虹啟用（7 骰點）：子彈攻速 +${pct(neonSpeed)}%`);
      }
    }

    return { attackPct: round9(attackPct), statusPct: round9(statusPct), intervalPcts, neonPct, entries };
  });
}

/**
 * 卡片開在第 index 格時的高亮：`src`／`dst` 是本盤（不含自己、照 index 排序），
 * `srcPartner`／`dstPartner` 是隊友盤（照 index 排序；**不排除自己**——不同盤的同 index 是不同格子，
 * 跟 `BuffEntry.fromPartner` 同一個道理）。陰陽、齒輪、霓虹這種「看盤面組成給自己」的，一起湊成
 * 條件的那幾格同時是 src 也是 dst（互相成全）。
 *
 * ⚠️ `partnerCells` 要傳**用對調參數算出來的那一份**（`boardBuffs({ ...partnerSide, partner: mySide })`）：
 * 它裡面的 `fromPartner` 裝的才是「從我這盤來的來源」。傳錯方向會讓 dstPartner 永遠是空的。
 */
export function buffHighlights(
  cells: readonly CellBuffs[],
  index: number,
  partnerCells?: readonly CellBuffs[],
): { src: number[]; dst: number[]; srcPartner: number[]; dstPartner: number[] } {
  const src = new Set<number>();
  const srcPartner = new Set<number>();
  for (const e of cells[index]?.entries ?? []) {
    for (const j of e.from) src.add(j);
    for (const j of e.fromPartner) srcPartner.add(j);
  }
  const dst: number[] = [];
  cells.forEach((c, j) => {
    if (j !== index && c.entries.some(e => e.from.includes(index))) dst.push(j);
  });
  const dstPartner: number[] = [];
  partnerCells?.forEach((c, j) => {
    if (c.entries.some(e => e.fromPartner.includes(index))) dstPartner.push(j);
  });
  const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);
  return { src: sorted(src), dst, srcPartner: sorted(srcPartner), dstPartner };
}

/** 角標「?」那顆自己的明細多一行：排序方向／齒輪二階種類還沒指定，它的加成沒有算進去。 */
export function pendingHint(p: Placed | null | undefined): string | null {
  const kind = badgeKind(p);
  if (kind === 'dir' && p?.dir === undefined) return '方向未指定，點左上角標切換';
  if (kind === 'gear' && p?.gear === undefined) return '種類未指定，點左上角標切換';
  return null;
}
