// 骰子樹局外加成（符文／玩家被動）的語意表：型別與共用小工具。
//
// 資料在 data/offgame-effects.json（以節點 id 為鍵）：數字抄自遊戲客戶端的 RuneTable／PlayerPassiveTable，
// 「改哪一列、怎麼疊」（target）依客戶端逆向結果人工標註，規則 28（tools/validate.ts）守。
// /board 數值卡片的計算在 offgame-calc.ts；這一支只放 validate、建置期與計算層都要用的東西，不要複製第二份。
import { round9 } from './dice-calc.js';
import type { Branch } from './types.js';

/** 每一種 target 的語意與疊加順序見 offgame-calc.ts 的檔頭。 */
export const OFFGAME_TARGETS = [
  'attackPct', 'intervalPct', 'bulletPct', 'bulletIntervalPct', 'hitAttackMul', 'hitAttackFlat',
  'statAdd', 'statSet', 'statMul', 'critPct', 'mechanic', 'conditional', 'board', 'none',
] as const;
export type OffgameTarget = typeof OFFGAME_TARGETS[number];

/** 改 dice-stats.json 某一列的 target——只有它們帶 `label`。 */
export const ROW_TARGETS: readonly OffgameTarget[] = ['statAdd', 'statSet', 'statMul'];

/**
 * /board 不顯示也不計算的 target（建置期由 namedEffects() 整筆拿掉）。
 * - `conditional`：只在特定目標／情境生效（對冰凍、對首領…），沒有單一數字可合進列——Yuki 2026-09-19 裁決不顯示。
 * - `none`：不是骰子的數值（開局 SP、合成機率、支援冷卻）。
 *
 * ⚠️ `board`（光增益範圍、霓虹、齒輪連接、三重共鳴、排序疊加這類盤面增益用的符文）**不在這裡**：它們要送進頁面，
 * 由 board-buffs.ts 依骰盤擺位消費；offgame-calc.ts 的 appliedEffects() 不收它們（不是單顆骰子自己的局外加成）。
 */
export const HIDDEN_TARGETS: readonly OffgameTarget[] = ['conditional', 'none'];

export interface OffgameEffect {
  /** 客戶端 RuneTable.Kind／PlayerPassiveTable.StringId，追溯用。 */
  kind: string;
  target: OffgameTarget;
  /** `all`／`faction:<分支>`／`dice:<骰子節點 id>`。 */
  scope: string;
  value: number;
  rankAdd: number;
  value2?: number;
  rankAdd2?: number;
  maxLevel: number;
  /** ROW_TARGETS 才有：dice-stats.json 的列名（逐字）。 */
  label?: string;
  /** statAdd：-1＝減（客戶端存正數、效果是減，例：換位骰子冷卻 0.5 秒）。 */
  sign?: -1;
  /** statAdd／statSet：只取整數部分（客戶端的 int(V)）。 */
  int?: true;
  /** statAdd：套完之後的下限。 */
  min?: number;
  /** statSet：覆寫成 setBase + V。 */
  setBase?: number;
  /** mechanic 且等級會成長：明細面板的句子，`{V}`／`{V2}` 換成當前等級的值。 */
  template?: string;
  /** conditional／none：為什麼不算進卡片。 */
  reason?: string;
}

export interface OffgameFile { note: string; source: string; effects: Record<string, OffgameEffect> }

/**
 * 建置期給 /board 的版本：補上節點名，等級不會變的機制符文補上描述。
 * 拿掉 `kind`（執行期沒人讀，追溯用的那份留在 JSON、規則 28 守）與 `reason`（只有被濾掉的 target 才有）。
 */
export type NamedEffect = Omit<OffgameEffect, 'kind' | 'reason'> & { name: string; text?: string };

/** 等級 level 的值：value + rankAdd × (level − 1)（客戶端 GetRuneValue1／GetPlayerPassiveValue）。 */
export function effectValue(e: Pick<OffgameEffect, 'value' | 'rankAdd'>, level: number): number {
  return round9(e.value + e.rankAdd * (level - 1));
}

/** 第二個值（客戶端 Value2）。沒有 value2 的節點回 0。 */
export function effectValue2(e: Pick<OffgameEffect, 'value2' | 'rankAdd2'>, level: number): number {
  return round9((e.value2 ?? 0) + (e.rankAdd2 ?? 0) * (level - 1));
}

/** 這一筆作用在不在這顆骰子上。branch＝骰子的分支（＝客戶端 DefenderGroupType，2026-09-19 全數對過）。 */
export function scopeApplies(scope: string, diceId: string, branch: Branch): boolean {
  if (scope === 'all') return true;
  if (scope.startsWith('faction:')) return scope.slice('faction:'.length) === branch;
  if (scope.startsWith('dice:')) return scope.slice('dice:'.length) === diceId;
  return false;
}

/**
 * 明細面板用的純文字描述：拿掉 `#關鍵字` 的 `#`，換行攤平。
 * ⚠️ 只拿掉 `#` 這個字元、不去斷詞（關鍵字沒有結束符，斷詞要走 markup.ts 的白名單）——這裡只要純文字。
 */
export function plainDescription(desc: string): string {
  return desc.replaceAll('#', '').replaceAll('，\n', '，').replaceAll('\n', ' ');
}

/** 建置期：拿掉 /board 用不到的 target，補上顯示需要的名稱與描述。 */
export function namedEffects(
  file: OffgameFile,
  nodeText: Record<string, { name: string; description: string }>,
): Record<string, NamedEffect> {
  const out: Record<string, NamedEffect> = {};
  for (const [id, full] of Object.entries(file.effects)) {
    if (HIDDEN_TARGETS.includes(full.target)) continue;
    const n = nodeText[id];
    if (!n) continue;
    const { kind: _kind, reason: _reason, ...e } = full;
    const text = e.target === 'mechanic' && !e.template ? plainDescription(n.description) : undefined;
    out[id] = text === undefined ? { ...e, name: n.name } : { ...e, name: n.name, text };
  }
  return out;
}
