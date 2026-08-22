import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

/**
 * 角色圖示的底板必須自己收邊（2026-08-22）。
 *
 * 五個支援角色（青兒／里克／艾科／迪奇／伊安）的圖是一塊圓角底板加一個角色。原始擷取把
 * 底板下緣的圓弧切掉了 2–3 列，留下一條寬 166px 的平邊。平常看不出來——但
 * `#tree .node.in-chain` 的金色光暈與鍵盤 focus 的 `#focus-ring` 都是**描圖示的 alpha 輪廓**，
 * 描到那條平邊就變成一條橫的淡黃色條，從底板的圓角兩側戳出去（Yuki 2026-08-22 回報）。
 *
 * 為什麼不用截圖比對像素：實際試過，光暈是 6px 模糊、跟深色底混完之後亮度很低，用「金色」
 * 判定抓不到；放寬成「暖色」又會連角色自己的暖色像素與前置鏈的金色連線一起抓進來，
 * 修前修後的取樣圖幾乎一模一樣。判準回到圖檔本身，比值與落差都有清楚的分界。
 *
 * 骰子（矩形卡）與符文（六邊形）本來就有寬的平底，那是它們的形狀，不是缺陷，所以這條只看角色。
 */
const tree = JSON.parse(
  readFileSync(new URL('../../src/generated/tree.json', import.meta.url), 'utf8'),
) as { nodes: { id: string; name: string; type: string; icon: string }[] };

const characters = tree.nodes.filter(n => n.type === 'support');

/** 逐列的不透明寬度。 */
async function rowWidths(icon: string): Promise<number[]> {
  const { data, info } = await sharp(`data/icons/${icon}.png`)
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (data[(y * w + x) * c + 3]! > 32) n++;
    out.push(n);
  }
  return out;
}

describe('角色圖示的輪廓', () => {
  it('五個支援角色都在（不會因為抓不到節點而空跑）', () => {
    expect(characters).toHaveLength(5);
    expect(new Set(characters.map(n => n.name)))
      .toEqual(new Set(['青兒', '里克', '艾科', '迪奇', '伊安']));
  });

  it.each(characters.map(n => [n.name, n.icon] as const))(
    '%s 的底板下緣收成圓角，不是被切平的橫邊',
    async (name, icon) => {
      const widths = await rowWidths(icon);
      const max = Math.max(...widths);
      const last = widths.findLastIndex(n => n > 0);
      // 前提：真的讀到圖了。整張透明的話下面兩條會變成 NaN 比較而不是紅。
      expect(max, `${name} 的圖示是空的`).toBeGreaterThan(100);
      expect(last, `${name} 的圖示是空的`).toBeGreaterThan(0);

      // (1) 最底一列不能太寬。切平的原圖是 0.83，收好邊的是 0.72–0.74。
      expect(widths[last]! / max, `${name} 的底板下緣是一條寬平邊`).toBeLessThan(0.78);

      // (2) 更直接的判準：圓弧收尾時最後一列會**急遽**變窄（圓在切點附近的斜率趨近無限大）。
      //     切平的原圖每列只縮 6px，收好邊的縮 14px。中間切一刀在 10。
      expect(widths[last]! - widths[last - 1]!, `${name} 的底板下緣沒有收尾的圓弧`)
        .toBeLessThanOrEqual(-10);
    },
  );
});
