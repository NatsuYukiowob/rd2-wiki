// 骰子基本能力值與強化數據的查表。
//
// 資料來自官方資料表 v1.0.3-v2 的兩個分頁：`骰子基本能力值`（基本面板，41 列）與
// `骰子強化數據`（會隨骰點／SP 強化改變的項目，97 列）。兩張表在 data/dice-stats.json
// 裡已經併成同一個形狀，這裡只負責「拿哪一檔的值」與「這一項會不會變」。
//
// ⚠️ 它刻意不進 tree.json：/dice 是靜態頁、建置期直接讀 data/，不吃 tree.json 的 gzip 預算
// （那個預算只剩不到 1.5KB，而這份資料 30KB）。
import { INTERVAL_GROWTH, formatNumber, parseNumber } from './dice-calc.js';
import type { DiceStat, DiceStatEntry, DiceStatsTable } from './types.js';

/** 四個檔位＝官方「骰子強化數據」分頁的四個數值欄。 */
export type StatMode = 'base' | 'dice7' | 'lv15' | 'lv15dice7';

/**
 * 檔位的顯示順序與名稱。**第一個就是頁面的預設**，改順序等於改預設。
 *
 * `Lv.15` 指的是對局內的 SP 強化 15 級，不是骰子樹上的節點等級——兩者在遊戲裡都叫「等級」，
 * 所以頁面上一定要另外寫一句說明，只靠這個標籤會被讀成骰子樹的等級。
 */
export const STAT_MODES: readonly { key: StatMode; label: string }[] = [
  { key: 'base', label: '基礎' },
  { key: 'dice7', label: '7 骰點' },
  { key: 'lv15', label: 'Lv.15' },
  { key: 'lv15dice7', label: 'Lv.15＋7 骰點' },
];

/**
 * 這一項在指定檔位的值。
 *
 * 固定項目（官方強化表沒收錄的）在每一檔都回基礎值，而不是回 undefined——切檔時 pill 的
 * 數量與順序必須完全不變，中間空一顆在畫面上跟「資料掉了」長得一模一樣。
 */
export function statValue(stat: DiceStat, mode: StatMode): string {
  if (mode === 'base') return stat.base;
  return stat[mode] ?? stat.base;
}

/**
 * 這一項會不會隨骰點或 SP 強化改變？
 *
 * 兩種都算固定：(a) 官方強化表根本沒收錄；(b) 收錄了但四檔值全等（例如陰陽骰子的攻擊力，
 * 官方寫的是「骰點不變」＋「無變化」）。只看 (a) 的話 (b) 那幾項會被標成會成長，
 * 玩家切了四檔看到同一個數字，只會以為是網站壞了。
 */
export function isFixed(stat: DiceStat): boolean {
  if (stat.dice7 === undefined) return true;
  return STAT_MODES.every(m => statValue(stat, m.key) === stat.base);
}

/**
 * pill 的 hover 提示：骰點軸的成長規則。固定項目沒有規則可寫，回 null。
 *
 * ⚠️ 強化軸刻意不寫在這裡：它由卡片上「局內升級」按鈕按住時顯示（levelStep()），
 * 同一份 spGrowth 印兩處，改格式時就得記得改兩處。
 */
export function growthNote(stat: DiceStat): string | null {
  if (isFixed(stat) || stat.diceGrowth === undefined) return null;
  return `骰點：${stat.diceGrowth}`;
}

/**
 * 查一顆骰子的數值列；查不到回 null。
 *
 * 三種「還沒有資料」的情形（整張表沒載入、這顆骰子不在表裡、節點根本沒有 gameId）都收斂成
 * null，呼叫端只要判一次就好。**不要在這裡丟例外**：這份 JSON 是社群改得到的，缺一筆的
 * 後果應該是那張卡片少一塊，不是整頁建置失敗。真正擋住缺漏的是 CI 規則 23。
 */
export function statsOf(table: DiceStatsTable | null, gameId: string | undefined): DiceStatEntry | null {
  if (table === null || gameId === undefined) return null;
  return table[gameId] ?? null;
}

/** spGrowth 的「會變」寫法；validate 規則 23(j) 也用這支拆出數值。 */
export const SP_STEP = /^每強化1級：(.+)$/;

/** 攻擊間隔 ÷ 骰點後的增減精度：-0.025s ÷ 7 ＝ -0.0036s，3 位會把它捨成 -0.004。 */
const INTERVAL_STEP_DECIMALS = 4;

/**
 * 局內 SP 強化再升 1 級，這一項在指定檔位加減多少（「+150」「-0.025s」）；固定項目與「無變化」回 null。
 * 卡片上「局內升級」按鈕按住時接在 pill 的數值後面。
 *
 * 值直接取 spGrowth——它就是客戶端 `DefenderTable`／`DefenderSkillTable`／`ProjectileAbilityTable`
 * 的 `*_UpAdd` 欄（2026-09-28 拿 1.1.2 解包表逐項對過）。⚠️ **不要改成從四檔反推**：上游給了原值
 * 就用原值。反過來「文字與四檔一致」由規則 23(j) 守，/board 用的反推值因此不會跟這裡分家。
 *
 * 唯一的換算是攻擊間隔：_UpAdd 加在 1 骰點的間隔上、再 ÷ 骰點，所以 7 骰點的檔位要 ÷ 7，
 * 否則 pill 寫 0.064 秒/次、旁邊卻寫 (-0.025s)，看起來大了 7 倍。
 */
export function levelStep(stat: DiceStat, mode: StatMode): string | null {
  if (isFixed(stat)) return null;
  const m = stat.spGrowth === undefined ? null : SP_STEP.exec(stat.spGrowth);
  if (!m) return null;
  const delta = m[1]!;
  if (stat.diceGrowth !== INTERVAL_GROWTH || (mode !== 'dice7' && mode !== 'lv15dice7')) return delta;
  const p = parseNumber(delta);
  if (!p) return delta;
  const v = p.value / 7;
  return `${v < 0 ? '-' : '+'}${formatNumber(Math.abs(v), INTERVAL_STEP_DECIMALS)}${p.unit}`;
}
