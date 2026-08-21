import type { RawGeomNode } from './svg-parse.js';

/**
 * 單一文字欄位的長度上限。規則 1／8(b)／14／18 與 build-data 的結構檢查共用同一個數字——
 * 兩邊各寫一份的話，會出現「validate 放行、build 炸掉」這種只有貢獻者踩得到的裂縫。
 */
export const MAX_TEXT_LENGTH = 500;

/**
 * `data/nodes.json` 的單筆內容：一個節點的全部文案。
 *
 * 2026-08-22（#21）之前這些欄位是正本 SVG 上的 `data-*`，而且 `<title>` 還存了 `name` ＋
 * `description` 的第二份副本（規則 1 就是在守那份副本）。搬到 JSON 之後副本消失、規則 1 改成
 * 驗這份結構本身，而「改一句描述」從「一行 500 字元的 `<g>` diff」變成一行。
 */
export interface NodeText {
  name: string;
  /** 中文原字（骰子／骰子符文／玩家被動／支援）；英文代碼由 `typeOfZh` 轉。 */
  type: string;
  /** 玩家被動的細分類，中文原字。只有玩家被動有——其餘節點必須整個省略這個鍵（規則 16）。 */
  category?: string;
  /** 遊戲資料表的管理 ID（D000／D0000／S0200）。站台不顯示，給貢獻者比對原始資料用。 */
  gameId: string;
  /**
   * 解鎖花費，單行（`核心 8`／`金幣 2,000`／`金幣 100,000／核心 10`）。
   *
   * ⚠️ **不要在這裡寫「最高 N 級」**。搬家前 123 個骰子符文的 `data-cost` 第二行寫著等級上限、
   * 另外 40 個玩家被動則寫在 `<title>` 的最後一行——同一件事兩種寫法、兩個位置。現在一律走
   * `maxLevel` 欄位，規則 4 會擋下重新混進 `cost` 的等級行。
   */
  cost: string;
  /** 等級上限；沒有升級概念的節點是 1。 */
  maxLevel: number;
  description: string;
  /** 7 骰點覺醒效果。只有骰子有——其餘節點必須整個省略這個鍵（規則 14）。 */
  awakening?: string;
}

export type NodeTextMap = Record<string, NodeText>;

/** 正本 SVG 的幾何與 `data/nodes.json` 的文案合併後的節點——規則 2–18 與 build-data 看到的形狀。 */
export interface RawNode extends RawGeomNode {
  typeZh: string;
  name: string;
  description: string;
  /** 非骰子節點是空字串（JSON 端省略該鍵）。 */
  awakening: string;
  gameId: string;
  /** 非玩家被動節點是空字串（JSON 端省略該鍵）。 */
  categoryZh: string;
  costRaw: string;
  maxLevel: number;
}

const REQUIRED = ['name', 'type', 'gameId', 'cost', 'maxLevel', 'description'] as const;
const OPTIONAL = ['category', 'awakening'] as const;
const KNOWN = new Set<string>([...REQUIRED, ...OPTIONAL]);

/**
 * 檢查 `data/nodes.json` 單筆的結構，回傳錯誤訊息陣列（空陣列＝通過）。規則 1 與 build-data
 * 共用這一份判斷：兩邊各寫一份的話，會出現「validate 全綠但 build 炸掉」或反過來的裂縫。
 *
 * 選用欄位刻意要求「不用就整個省略」而不是寫成 `""`：空字串在 JSON 裡看起來像「有這個欄位、
 * 只是還沒填」，而規則 14／16 的語意是「這種節點根本不該有這個欄位」。兩者混用的話，
 * `"awakening": ""` 會安靜地通過「骰子必須有覺醒」以外的所有檢查。
 */
export function checkNodeTextRecord(id: string, rec: unknown, maxTextLength: number): string[] {
  const errors: string[] = [];
  if (typeof rec !== 'object' || rec === null || Array.isArray(rec)) {
    return [`節點 ${id} 的內容不是物件`];
  }
  const r = rec as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!KNOWN.has(k)) errors.push(`節點 ${id} 有未知欄位 ${JSON.stringify(k)}`);
  }
  for (const k of REQUIRED) {
    if (!(k in r)) { errors.push(`節點 ${id} 缺少 ${k}`); continue; }
    if (k === 'maxLevel') {
      if (!Number.isInteger(r[k]) || (r[k] as number) < 1) errors.push(`節點 ${id} 的 maxLevel 不是 ≥1 的整數：${JSON.stringify(r[k])}`);
      continue;
    }
    if (typeof r[k] !== 'string' || r[k] === '') errors.push(`節點 ${id} 的 ${k} 不是非空字串`);
    else if ((r[k] as string).length > maxTextLength) errors.push(`節點 ${id} 的 ${k} 長度 ${(r[k] as string).length} 超過上限 ${maxTextLength}`);
  }
  for (const k of OPTIONAL) {
    if (!(k in r)) continue;
    if (typeof r[k] !== 'string' || r[k] === '') errors.push(`節點 ${id} 的 ${k} 若要有值必須是非空字串（不用就整個省略這個鍵，不要寫成 ""）`);
    else if ((r[k] as string).length > maxTextLength) errors.push(`節點 ${id} 的 ${k} 長度 ${(r[k] as string).length} 超過上限 ${maxTextLength}`);
  }
  return errors;
}

/**
 * 幾何（SVG）與文案（JSON）依 `id` 合併。
 *
 * join key 一律用 `data-id`，不用座標——浮點與 `transform` 一改就對不上，而且對不上的節點會
 * 靜默消失而不是報錯。兩邊的 id 集合必須完全相等；有殘餘就代表正本與 JSON 已經不同步，
 * 這裡直接丟錯（validate 端另有規則 19 把兩邊的殘餘都列出來，給的是可讀的錯誤而非例外）。
 */
export function mergeNodes(geom: RawGeomNode[], text: NodeTextMap): RawNode[] {
  const seen = new Set<string>();
  const merged = geom.map(g => {
    const t = text[g.id];
    if (!t) throw new Error(`節點 ${g.id} 在正本 SVG 裡有幾何，但 data/nodes.json 裡沒有對應文案`);
    seen.add(g.id);
    return {
      ...g,
      typeZh: t.type,
      name: t.name,
      description: t.description,
      awakening: t.awakening ?? '',
      gameId: t.gameId,
      categoryZh: t.category ?? '',
      costRaw: t.cost,
      maxLevel: t.maxLevel,
    };
  });
  const orphans = Object.keys(text).filter(id => !seen.has(id));
  if (orphans.length > 0) {
    throw new Error(`data/nodes.json 有 ${orphans.length} 筆在正本 SVG 裡找不到對應節點：${orphans.join('、')}`);
  }
  return merged;
}

/** 讀進整份 `data/nodes.json` 並做結構檢查；任何一筆不合法就丟錯（build-data 用，CI 端由規則 1 先擋）。 */
export function loadNodeText(raw: unknown, maxTextLength: number): NodeTextMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('data/nodes.json 的最外層必須是以 id 為鍵的物件');
  const errors = Object.entries(raw as Record<string, unknown>)
    .flatMap(([id, rec]) => checkNodeTextRecord(id, rec, maxTextLength));
  if (errors.length > 0) throw new Error(`data/nodes.json 結構有問題：\n${errors.join('\n')}`);
  return raw as NodeTextMap;
}
