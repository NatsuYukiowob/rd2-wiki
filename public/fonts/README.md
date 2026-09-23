# Baloo 2（拉丁 subset）

`baloo2-latin-500-700.woff2` — 18.3 KB。掛在 `--font-num` 的位置（`.meta`／`.stat-v`／`.game-id`／
`.nav-updated` 等「數字與代號」），中文一律不走它（沒有中文字，會自動退回 `--font`）。
2026-09-23 骰桌改版取代 Archivo。

**自架不連 Google Fonts**：站台目前零第三方連線，不為了一個 display face 破例。

## 這個檔是怎麼來的

上游是 Google Fonts 供應的 Baloo 2 拉丁 subset（可變字體，wght 400–800，約 33 KB）。
兩道加工壓到 18.3 KB：

```sh
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
curl -A "$UA" "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&display=swap"
# → 取 /* latin */ 區段的 .woff2（三個字重指向同一個可變字體檔）

pip install fonttools brotli
fonttools varLib.instancer baloo2-latin.woff2 wght=500:700 -o inst.ttf
pyftsubset inst.ttf --output-file=baloo2-latin-500-700.woff2 --flavor=woff2 \
  --unicodes="U+0020-007E,U+00B7,U+00D7,U+2013-2014,U+2018-201D,U+2026,U+00A0" \
  --layout-features='kern,tnum,liga,rvrn' --no-hinting
```

⚠️ **`pyftsubset` 對來源沒有的碼位靜靜跳過**：加碼位之後要回頭驗 cmap（上游沒有 `U+2192` →
與 `U+201B` ‛，這兩個字會逐字退回 `--font`）。
⚠️ **`--layout-features` 不要留空**：留空會把 `kern` 與 `tnum` 一起砍掉。Baloo 2 的預設數字是
**比例寬**（`1` 比 `0` 窄將近四成），沒有 `tnum` 的話 `tabular-nums` 完全不會生效。
⚠️ `tnum` 不保證數字等寬：Chromium 把前進寬度四捨五入到整數像素。不要拿「換一天寬度不變」當斷言。

## 授權

SIL Open Font License 1.1，全文見 `OFL.txt`（上游 `google/fonts` 的 `ofl/baloo2/OFL.txt`）。
OFL 要求散布字型時附上授權，所以 `OFL.txt` 跟 `.woff2` 一起進 `public/`。
