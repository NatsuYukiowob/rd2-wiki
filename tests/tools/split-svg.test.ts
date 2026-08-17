import { describe, it, expect } from 'vitest';
import { splitSvg } from '../../tools/split-svg';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
<g class="node" transform="translate(1,2)" data-id="1001">
<image href="data:image/png;base64,iVBORw0KGgo=" x="-1" y="-1" width="2" height="2"/>
</g></svg>`;

describe('splitSvg', () => {
  it('把內嵌 base64 圖示抽成獨立檔案並改寫 href 為相對路徑', () => {
    const r = splitSvg(SAMPLE);
    expect(r.icons.size).toBe(1);
    const [hash] = [...r.icons.keys()];
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(r.svg).toContain(`href="icons/${hash}.png"`);
    expect(r.svg).not.toContain('base64');
  });

  it('內容相同的圖示只保留一份', () => {
    const dup = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
<g class="node" transform="translate(1,2)" data-id="1001">
<image href="data:image/png;base64,iVBORw0KGgo=" x="-1" y="-1" width="2" height="2"/>
</g>
<g class="node" transform="translate(3,4)" data-id="1002">
<image href="data:image/png;base64,iVBORw0KGgo=" x="-1" y="-1" width="2" height="2"/>
</g>
</svg>`;
    const r = splitSvg(dup);
    expect(r.icons.size).toBe(1);
  });
});
