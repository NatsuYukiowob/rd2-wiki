# 畫布（src/lib/canvas/）

`src/scripts/tree-canvas.ts` 與 `/sim` 的畫布也適用；全站規則見根目錄 CLAUDE.md。
成因與實測數字寫在各檔的註解裡，這裡只列結論與它住在哪。

## 結構

`/tree` 與 `/sim` 共用 `mountCanvasTree(host, data, opts)` → `TreeHandle`
（`setState`／`getState`／`nodeScreenRect`／`hitAt`／`fitAll`／`fitBounds`／`pan`／`requestRedraw`／
`onSelect`／`onViewChange`／`destroy`）。一個檔一件事：

| 檔 | 管什麼 |
|---|---|
| `view.ts` | 座標數學、`*_ICON_TARGET_PX`、高解析升降門檻 |
| `scene.ts` | 由 tree.json 組出不變的幾何 |
| `state.ts` | 每幀可能不同的互動狀態（`nodeAlpha()`、`centerAlpha()`） |
| `theme.ts` | 從 token 讀出的顏色與字級 |
| `assets.ts` | `AssetStore`：sprite 圖集（1×）＋每節點 2× WebP |
| `painter.ts` | 怎麼畫 |
| `cache.ts` | `StaticCache` 靜態層離屏位圖 |
| `hit.ts`／`a11y.ts`／`debug-api.ts` | 命中測試／隱形按鈕／給 E2E 問的介面 |

兩張 canvas 疊在 `#canvas-host`：`.tree-static`（節點、邊、常駐標籤、中央樞紐、`/sim` 等級牌）在下，
`.tree-overlay`（前置鏈光暈、hover／focus 標籤、焦點框）在上；**pointer 事件全掛互動層**、`touch-action: none`。
hover 不可讓靜態層重畫。

## 不變量

- **`pan()` 只給收尾用**：它會 `cache.invalidate()` 重置邊距。動畫中間幀用 `view.pan()` ＋ `requestRedraw()`
  （`canvas-tree.ts` 的 `pan` 註解、`animate-pan.ts`）。
- **任何新的平移路徑都要走 `endDrag()`**（放手、第二指、pointercancel、lostpointercapture、程式化平移收尾）。
  漏了 → 拖出去的區域永遠空白。拖曳中只改兩張元素的 CSS `transform`，超出邊距（`covers()` AND `layersCover()`）才當幀重畫。
- **快取 key＝`scale|dpr|視口尺寸|assetsVersion|stateSignature`，`tx/ty` 不進 key**。位圖＝視口外擴
  `PAN_MARGIN`，超過 `MAX_SIDE`／`MAX_AREA` 由 `marginPx()` 減半到 `[0, 0]`（`tests/lib/canvas/cache.test.ts`）。
- **縮放中不重繪**：設 `transform: … scale(k)`，停 150 ms 再補畫。已知取捨：那 150 ms 會糊、hover 要等 settle。
- **`shadowBlur`／`shadowOffsetY` 不吃 `setTransform`**：world 單位的半徑畫前要自己乘 `dpr * pxPerUnit`
  （`painter.ts` 檔頭、`painter.test.ts`）。
- **標籤字級與線寬是 world 單位**：`theme.labelPx` 不要照 CSS px 直覺調；先 `strokeText` 再 `fillText`。
- **高解析圖**：`updateLod()` 只對 `view.visibleWorldRect()`（純視口，不含邊距，Ruling X）呼叫 `wantHires()`；
  `painter` 只准呼叫唯讀的 `loadedHires()`。升降門檻不同（遲滯），失敗的圖不重試。
- **首屏 2× 圖示上限是 E2E 斷言**（`tests/e2e/tree.spec.ts`，門檻與由來見該處註解）。改版面、
  `*_ICON_TARGET_PX`、`fitAll()` 的 pad 後要重新校，**紅了不可直接調高上限**。
- **中央樞紐 `<g class="tree-center">` 不是節點**：無 id／花費，不進成本、高亮、篩選；選用（沒有時 `meta.center` 是 null，
  規則 10 守）。圖不進 sprite，走 `AssetStore.image(url)`。透明度只用 `centerAlpha()`，不要併進 `nodeAlpha()`。

## 無障礙（`a11y.ts`）

- 每顆節點一顆隱形 `<button data-id>`（`<ul class="tree-a11y">`）；**視覺隱藏只能用 `clip-path`**，
  `hidden`／`display: none`／`visibility: hidden` 會退出 Tab 順序與無障礙樹。焦點框畫在互動層，不在按鈕上。
- **`forced-colors: active` 只現形拿到焦點的那一顆**（`:focus-within`），不要改回整份清單現形；
  現形元素一律 `pointer-events: none`（`src/styles/canvas.css`、`tests/lib/canvas/a11y.test.ts`）。

## 圖檔本身

- **圖示的 alpha 輪廓＝投影與光暈的形狀**（`shadowBlur` 描 alpha；焦點框走 `focusRingPath()` 不受影響）。
  角色類圖示進來時跑一次 `tests/data/icon-silhouette.test.ts`——`tools/add-icon.ts` 只驗有效 PNG 與最長邊 ≥ 96px，不看裁切。
  補裁切時**畫布尺寸不可變**（長寬比一變就被拉扁）。這類細線用截圖比像素抓不到，判準看圖檔數字。
- **`withGutter()` 的透明邊不可拿掉**（`tools/lib/icons.ts`：圖集相鄰格子雙線性取樣滲色，`tests/tools/icons.test.ts`
  在 `GUTTER = 0` 會紅）；1× 傳 `GUTTER`、2× 傳 `GUTTER * 2`，否則升級瞬間圖示跳大。
- E2E 掃像素時座標要換算裝置像素（CSS px ≠ 截圖像素，Pixel 7 dpr 2.625）。
