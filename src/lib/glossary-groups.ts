// 關鍵字的分組與索引。
//
// 分組依據是**官方色碼**（data/keywords.json 的 color，抄自資料表「狀態效果」分頁的底色碼）：
// 遊戲自己就是用顏色把這些詞分類的，同色＝同一類機制。所以分組本身不是我們的判斷，
// 只有**組名**是本站取的——頁面上要註明這件事，不要讓讀者以為「召喚物與投射物」是官方用語。
//
// 一個顏色一個 slug，slug 決定它出現在哪一頁。⚠️ 加新關鍵字時若出現沒見過的色碼，
// `buildGlossary()` 會**直接丟例外**（建置當場失敗），不是收進某個要呼叫端自己記得檢查的
// 欄位——那種「文件說呼叫端該處理」的約定沒有人會遵守，而漏掉的後果是：那個詞從每一頁
// 消失，同時 239 個節點描述裡指向它的 `#關鍵字` 全部連到一個不存在的錨點。
// `tools/validate.ts` 的規則 8(b) 也對同一件事把關，兩道防線一前一後。
import { renderTaggedText } from './markup.js';
import type { GlossaryRecord, TreeNode } from './types.js';
import { isGlossaryAlias } from './types.js';

export interface GlossaryGroup {
  slug: 'mechanics' | 'summons' | 'status' | 'buffs' | 'monsters';
  title: string;
  /** 一句話說明這一組是什麼，印在該組標題底下。 */
  blurb: string;
  color: string;
}

/**
 * 五個官方色碼分組。順序就是頁面上的顯示順序。
 *
 * `buffs` 只有 2 條（攻擊速度增加／減少），撐不起一頁，所以它跟 `status` 共用 /guide/status
 * ——見 GUIDE_PAGES。分組本身仍然保留，因為那是官方分的；合併的只是「頁面」這層。
 */
export const GROUPS: readonly GlossaryGroup[] = [
  { slug: 'mechanics', color: '#FF8A3D', title: '骰子機制與觸發',
    blurb: '骰子自己的機制：合成、堆疊、觸發時機。骰子描述裡最常出現的一組。' },
  { slug: 'summons', color: '#4DA3FF', title: '召喚物與投射物',
    blurb: '骰子打出去的東西：投射物、召喚物、場上的實體。' },
  { slug: 'status', color: '#9B6BFF', title: '施加於怪物的效果',
    blurb: '掛在怪物身上的效果：減速、持續傷害、控制。' },
  { slug: 'buffs', color: '#4CD964', title: '增益與減益',
    blurb: '直接加減數值的增減益標記。' },
  { slug: 'monsters', color: '#A0A7B8', title: '怪物與基本名詞',
    blurb: '怪物種類與遊戲的基本名詞，不是效果本身。' },
] as const;

export type GroupSlug = GlossaryGroup['slug'];

export function groupOfColor(color: string): GlossaryGroup | undefined {
  return GROUPS.find(g => g.color === color);
}

/** 一個詞在頁面上的完整資料。`anchor` 是官方 code——ASCII，網址與錨點都安全。 */
export interface GlossaryItem {
  term: string;
  anchor: string;
  color: string;
  desc: string;
  group: GlossaryGroup;
  /** 指向這個詞的別名（例：播種 → 果實）。別名沒有自己的詞條，掛在本尊底下。 */
  aliases: string[];
  /** 描述或覺醒文案裡用到這個詞的節點，依 id 排序。 */
  usedBy: { id: string; name: string }[];
}

export interface GlossaryIndex {
  byGroup: Record<GroupSlug, GlossaryItem[]>;
  /** 詞 → 詞條。**別名也在裡面**，指向本尊那一筆（見 buildGlossary）。 */
  byTerm: Map<string, GlossaryItem>;
}

/**
 * 蒐集每個節點文案實際用到的關鍵字。
 *
 * 刻意重跑 `renderTaggedText()` 的斷詞而不是讀 `node.keywords`：後者只涵蓋 description，
 * 覺醒文案（`awakening`）裡的標記不在裡面，而覺醒在圖鑑頁是直接顯示的。共用同一支斷詞器
 * 也順便保證「頁面上被標成關鍵字的詞」與「這裡算進使用次數的詞」永遠是同一組。
 */
function collectTerms(text: string, whitelist: readonly string[]): Set<string> {
  const hits = new Set<string>();
  renderTaggedText(text, whitelist, {}, term => {
    hits.add(term);
    return '';
  });
  return hits;
}

/**
 * 把 data/keywords.json 與節點資料組成頁面要用的索引。
 *
 * 別名（`{ aliasOf }`）不會變成獨立詞條——它們在遊戲文案裡是同一件事的兩種寫法，
 * 各給一個詞條只會讓讀者以為是兩種機制。使用次數則算在本尊身上。
 */
export function buildGlossary(
  keywords: Record<string, GlossaryRecord>,
  nodes: readonly TreeNode[],
): GlossaryIndex {
  const whitelist = Object.keys(keywords);
  const canonical = (term: string): string => {
    const rec = keywords[term];
    return rec && isGlossaryAlias(rec) ? rec.aliasOf : term;
  };

  const byTerm = new Map<string, GlossaryItem>();
  const byGroup = Object.fromEntries(GROUPS.map(g => [g.slug, [] as GlossaryItem[]])) as Record<GroupSlug, GlossaryItem[]>;

  for (const [term, rec] of Object.entries(keywords)) {
    if (isGlossaryAlias(rec)) continue;
    const group = groupOfColor(rec.color);
    // 沒有對應分組就當場停下來。悄悄塞進某個「未分類」桶子的話，那個詞會從每一頁消失，
    // 而所有引用它的 `#關鍵字` 會連到一個不存在的錨點——兩件事在畫面上都不會報錯。
    if (!group) {
      throw new Error(
        `關鍵字「${term}」的色碼 ${rec.color} 不在已知的五組裡。`
        + '遊戲資料表新增了標記顏色時，要在 src/lib/glossary-groups.ts 的 GROUPS 補上這一組，'
        + '並決定它印在 GUIDE_PAGES 的哪一頁。',
      );
    }
    const item: GlossaryItem = {
      term, anchor: rec.code, color: rec.color, desc: rec.desc, group, aliases: [], usedBy: [],
    };
    byTerm.set(term, item);
    byGroup[group.slug].push(item);
  }

  for (const [term, rec] of Object.entries(keywords)) {
    if (!isGlossaryAlias(rec)) continue;
    const target = byTerm.get(rec.aliasOf);
    if (!target) continue;
    target.aliases.push(term);
    // 別名也要能被查到，而且查到的是**本尊那一筆**：`termHref()` 才不必自己再解一次別名，
    // 文案裡寫 `#播種` 時連結會直接指到 #FRUIT。共用同一個物件，不是複製一份。
    byTerm.set(term, target);
  }

  for (const node of nodes) {
    const used = collectTerms(`${node.description}\n${node.awakening ?? ''}`, whitelist);
    // 先把別名收斂成本尊再去重：同一個節點同時寫了 `#SP怪物` 與它的別名 `#傳送` 時
    // （5006 就是這樣），不去重會讓它在 usedBy 裡出現兩次，把「幾個節點用到」算成假數字。
    for (const term of new Set([...used].map(canonical))) {
      byTerm.get(term)?.usedBy.push({ id: node.id, name: node.name });
    }
  }
  // byTerm 現在含別名，同一個物件會被走到兩次；排序是冪等的，但去重比較誠實。
  for (const item of new Set(byTerm.values())) item.usedBy.sort((a, b) => a.id.localeCompare(b.id));

  // 組內排序：先照使用次數多到少（玩家最常撞到的詞排前面），同次數再照官方 code，
  // 讓輸出穩定——不排序的話 Object.entries 的順序一變，整頁 diff 就會炸開。
  for (const list of Object.values(byGroup)) {
    list.sort((a, b) => b.usedBy.length - a.usedBy.length || a.anchor.localeCompare(b.anchor));
  }
  return { byGroup, byTerm };
}

/** 「遊戲介紹」底下的頁面：一頁可以收不只一個分組（buffs 只有 2 條，併進 status）。 */
export const GUIDE_PAGES: readonly { slug: string; title: string; groups: GroupSlug[]; intro: string }[] = [
  { slug: 'mechanics', title: '骰子機制與觸發', groups: ['mechanics'],
    intro: '骰子自己的機制：合成、堆疊、觸發時機。骰子描述裡最常出現的一組——在骰子圖鑑的卡片上點任何一個標記，也會就地展開這裡的解釋。' },
  { slug: 'summons', title: '召喚物與投射物', groups: ['summons'],
    intro: '骰子打出去的東西。這些詞出現在骰子描述裡時，指的是場上一個實際存在的實體，而不是加在誰身上的效果。' },
  { slug: 'status', title: '狀態效果與增減益', groups: ['status', 'buffs'],
    intro: '掛在怪物或骰子身上的效果。前一組是施加在怪物身上的控制與持續傷害，後一組是直接加減數值的增減益標記。' },
  { slug: 'monsters', title: '怪物與基本名詞', groups: ['monsters'],
    intro: '怪物種類與遊戲的基本名詞。這些詞本身不是效果，但幾乎每個效果的說明都會引用到它們。' },
] as const;

/** 分組 slug → 那一組的詞條實際被印在哪一頁。 */
const PAGE_OF_GROUP: Record<GroupSlug, string> = {
  mechanics: '/guide/mechanics',
  summons: '/guide/summons',
  status: '/guide/status',
  buffs: '/guide/status',
  monsters: '/guide/monsters',
};

/**
 * 一個關鍵字的連結。同頁的錨點也照樣寫完整路徑——瀏覽器對同文件的 `/dice#COMBO` 就是
 * 純錨點跳轉、不會重新載入，換一種寫法只是多一條分支。查不到（不該發生，規則 8 擋著）
 * 時回 null，呼叫端就不要包連結。
 */
export function termHref(index: GlossaryIndex, term: string): string | null {
  const item = index.byTerm.get(term);
  if (!item) return null;
  return `${PAGE_OF_GROUP[item.group.slug]}#${item.anchor}`;
}

/**
 * 把 data/keywords.json 轉成渲染用的 `{ color, desc }` 對照表（別名不列入）。
 *
 * 靜態頁不能直接用 tree.json 的 `meta.glossary`：那份只收「骰子樹描述實際引用到的」41 條，
 * 圖鑑與遊戲介紹頁要印的是全部 62 條。
 */
export function displayGlossary(keywords: Record<string, GlossaryRecord>): Record<string, { color: string; desc: string }> {
  const out: Record<string, { color: string; desc: string }> = {};
  for (const [term, rec] of Object.entries(keywords)) {
    if (!isGlossaryAlias(rec)) out[term] = { color: rec.color, desc: rec.desc };
  }
  return out;
}
