import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DICE_CARD_ICON_PX } from '../../src/lib/dice-icon';

// `DICE_CARD_ICON_PX` 是 dice.css 那個 3rem 方框的第二份寫法（理由見該常數的說明）。
// 兩份各自漂移時畫面不會壞、也不會有任何既有測試說話——`<img width/height>` 只在 CSS
// 生效前那一瞬間被用到，事後量什麼都是對的。所以直接讀 CSS 比對。
describe('DICE_CARD_ICON_PX', () => {
  it('跟 dice.css 的 .dice-card header img 方框是同一個數字', () => {
    const css = readFileSync('src/styles/dice.css', 'utf8');
    const rule = css.match(/\.dice-card header img \{[^}]*\}/);
    expect(rule, 'dice.css 找不到 .dice-card header img 這條規則').not.toBeNull();
    const width = rule![0].match(/width:\s*([\d.]+)rem/);
    const height = rule![0].match(/height:\s*([\d.]+)rem/);
    expect(width, '那條規則沒有寫死 width（版面尺寸改用別的方式決定的話，這個常數就不該存在）').not.toBeNull();
    expect(height).not.toBeNull();
    // rem 換 px 走 base.css 的預設 16——站台沒有改 html 的字級（改了這裡要跟著改）。
    expect(Number(width![1]) * 16).toBe(DICE_CARD_ICON_PX);
    expect(Number(height![1]) * 16).toBe(DICE_CARD_ICON_PX);
    // contain 是這個常數成立的前提：改成 cover／fill 之後，長寬比就又有人讀了。
    expect(rule![0]).toMatch(/object-fit:\s*contain/);
  });
});
