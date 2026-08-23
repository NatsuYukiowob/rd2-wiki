import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isFixed } from '../../src/lib/dice-stats';
import type { DiceStatsTable } from '../../src/lib/types';

// data/dice-stats.json 的黃金樣本。規則 23 守的是「表與正本對不對得上」與「每一筆的形狀」，
// 守不到的是「這份表是不是從官方分頁完整落地的」——它的來源是一份 xlsx，重新產生時漏掉幾列
// 完全不會有任何規則說話（規則 23(a) 只看骰子有沒有 entry，不看 entry 裡少了幾項）。
const table = JSON.parse(readFileSync('data/dice-stats.json', 'utf8')) as DiceStatsTable;

describe('data/dice-stats.json', () => {
  it('41 顆骰子，每顆至少有攻擊力、攻擊速度、目標三項', () => {
    expect(Object.keys(table)).toHaveLength(41);
    for (const [gameId, entry] of Object.entries(table)) {
      expect(entry.stats.map(s => s.label).slice(0, 3), gameId).toEqual(['攻擊力', '攻擊速度', '目標']);
    }
  });

  // 官方「骰子強化數據」分頁是 97 列，每一列在這裡就是一個帶四個檔位的項目。
  // 這個數字是那張分頁完整落地的唯一證據——少一列的症狀是「那一項在切檔時不會變」，
  // 而那跟「它本來就是固定值」在畫面上一模一樣。
  it('帶四個檔位的項目正好 97 個＝官方強化分頁的列數', () => {
    const scaling = Object.values(table).flatMap(e => e.stats).filter(s => s.dice7 !== undefined);
    expect(scaling).toHaveLength(97);
  });

  // 官方表自己空著的格子照原文寫成「待實測」。刻意逐格釘住而不是只數個數：上游哪天補了值，
  // 或哪天又多空一格，這條就會紅，有人會回頭看一眼。
  // ⚠️ 不用 CI 警告來做這件事——validate 的黃金樣本斷言 warnings 必須為零，一條永遠不會消失
  // 的警告會讓那個基線失效（每支 PR 都帶著它，久了就沒人看警告了）。
  it('只有 D208 原子旋轉速度的 Lv.15 兩檔是官方未填值的「待實測」', () => {
    const pending: string[] = [];
    for (const [gameId, entry] of Object.entries(table)) {
      for (const s of entry.stats) {
        for (const [k, v] of Object.entries(s)) {
          if (v === '待實測') pending.push(`${gameId}/${s.label}/${k}`);
        }
      }
    }
    expect(pending.sort()).toEqual(['D208/原子旋轉速度/lv15', 'D208/原子旋轉速度/lv15dice7']);
  });

  // 官方「骰子基本能力值」分頁的備註欄混了兩種東西，**不可以整欄照抄**：6 條在解釋遊戲機制
  // （為什麼這顆的攻擊速度或目標是「—」），1 條是資料表作者自己的校訂記錄
  // （`D401` 吞噬骰子的「原始目標文本：範圍前」——官方原文寫「範圍前」，那一欄被正規化成
  // 「範圍內」，和 nodes.json 的「擊殺範圍內怪物時」一致）。校訂記錄是給維護者看的，
  // 印在卡片上對玩家沒有意義，只會像個錯字。
  it('備註只收解釋機制的那 6 條，不收資料表自己的校訂記錄', () => {
    const noted = Object.entries(table).filter(([, e]) => e.note !== undefined);
    expect(noted.map(([g]) => g).sort()).toEqual(['D005', 'D102', 'D104', 'D201', 'D204', 'D208']);
    for (const [gameId, e] of noted) {
      expect(e.note, `${gameId} 的備註看起來是校訂記錄不是機制說明`).not.toMatch(/^原始.*文本/);
    }
  });

  // isFixed() 兩條路各自要有真實樣本，否則哪天判斷寫壞了，測試裡的假資料還是綠的。
  it('固定項目與會成長的項目都真實存在（含「四檔全等」那一種）', () => {
    const all = Object.values(table).flatMap(e => e.stats);
    expect(all.filter(isFixed).length).toBeGreaterThan(0);
    expect(all.filter(s => !isFixed(s)).length).toBeGreaterThan(0);
    // 陰陽骰子的攻擊力：官方寫「骰點不變」＋「無變化」，四檔全等但表裡真的有這一列。
    const flat = table['D100']!.stats.find(s => s.label === '攻擊力')!;
    expect(flat.dice7).toBeDefined();
    expect(isFixed(flat)).toBe(true);
  });
});
