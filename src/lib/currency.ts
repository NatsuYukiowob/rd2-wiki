// 超越核心（遊戲 GoodsType `CORE_*`）的登記表：每一顆神話（超越）骰子各帶一種專屬貨幣，
// 只用在那顆骰子與它的符文上（1.1.0 太陽骰子的「太陽核心」、1.1.2 齒輪二階骰子的「齒輪二階核心」）。
//
// ⚠️ **新增一顆神話骰子＝在這裡加一筆，不改任何型別。** `Cost.mythic` 的鍵是這裡的 `kind`，
// 成本字串的解析（`parseCost`）、顯示（`formatCost`／`costHtml`）、`/sim` 的上限欄、
// 規則 22 的 special 表檢查全部從這份清單列舉——漏登記的貨幣在 `parseCost` 就會被擋下
// （「無法解析成本字串」），不會變成一個安靜的 0。
//
// **陣列順序＝顯示順序**（多種超越核心同時出現時，例如全樹解鎖成本、/sim 的合計）。
// 既有的放前面，新的往後接，已上線的顯示才會逐位元組不變。

export interface MythicCoreDef {
  /** `Cost.mythic` 的鍵，也是 `/sim` 上限欄的 id 後綴（`sim-limit-<kind>`）與貨幣圖檔名。 */
  kind: string;
  /** 成本字串與畫面上的名稱（`金幣 100,000／太陽核心 2,000`）。必須以「核心」結尾。 */
  label: string;
  /** 遊戲客戶端 `GoodsTable.GoodsType`，只當對照用，站台不讀。 */
  goodsType: string;
}

export const MYTHIC_CORES: readonly MythicCoreDef[] = [
  { kind: 'solar', label: '太陽核心', goodsType: 'CORE_SOLAR' },
];

const BY_KIND = new Map(MYTHIC_CORES.map(d => [d.kind, d]));
const BY_LABEL = new Map(MYTHIC_CORES.map(d => [d.label, d]));

export function mythicCoreByKind(kind: string): MythicCoreDef | undefined {
  return BY_KIND.get(kind);
}

export function mythicCoreByLabel(label: string): MythicCoreDef | undefined {
  return BY_LABEL.get(label);
}
