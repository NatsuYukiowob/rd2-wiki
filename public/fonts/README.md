# Archivo（拉丁 subset）

`archivo-latin-500-700.woff2` — 14.7 KB。掛在 `.meta`／`.stat-v`／`.game-id`／`.nav-updated`
這幾個「數字與代號」的位置，中文一律不走它（Archivo 沒有中文字，會自動退回 `--font`）。

**自架不連 Google Fonts**：站台目前零第三方連線，不為了一個 display face 破例。

## 這個檔是怎麼來的

上游是 Google Fonts 供應的 Archivo v25 拉丁 subset（可變字體，wght 100–900，34.1 KB）。
兩道加工把它壓到 14.7 KB：

```sh
# 1. 取得上游拉丁 subset（要用現代瀏覽器的 UA，否則 css2 會回 .ttf 全字集）
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
curl -A "$UA" "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&display=swap"
# → 三個字重的 latin 區段指向同一個檔（可變字體），下載那一個 .woff2

# 2. 砍掉用不到的字重區間，再砍掉用不到的字符
pip install fonttools brotli
fonttools varLib.instancer archivo-latin.woff2 wght=500:700 -o inst.ttf
pyftsubset inst.ttf --output-file=archivo-latin-500-700.woff2 --flavor=woff2 \
  --unicodes="U+0020-007E,U+00B7,U+00D7,U+2013-2014,U+2018-201D,U+2026,U+00A0" \
  --layout-features='kern,tnum,liga,rvrn' --no-hinting
```

字符範圍＝ASCII 可見字 ＋ 站上實際會出現的標點（`·`／`×`／破折號／引號／`…`／不斷行空白）。

⚠️ **`pyftsubset` 對「來源字型沒有的碼位」是靜靜跳過，不報錯。** 第一版這裡多寫了一個
`U+2192`（`→`），實際出貨的字型裡**根本沒有那個字**——Archivo 上游就沒有（2026-08-26
解 cmap 確認：上游 230 個碼位裡沒有 U+2192）。所以「要用到範圍外的字元就加進 `--unicodes`」
這句話只對了一半：加進去之後**要回頭驗 cmap**，上游沒有的字加了也不會出現。少了字符不會
報錯，只會靜靜地那一個字退回系統字型，跟旁邊的字寬對不起來。

⚠️ **`--layout-features` 不要留空。** 第一版寫 `--layout-features=''`，把 `kern`（字距對）與
`tnum`（等寬數字）一起砍掉了，於是 CSS 那句 `font-variant-numeric: tabular-nums` 變成一行
不可能生效的宣告，而 E2E 只斷言 computed style 是那個字串——那是把 CSS 抄回來，跟字型做不做得到
無關（2026-08-26 code review 抓到）。現在保留四個：`kern` 字距對、`tnum` 等寬數字、`liga` 連字、
`rvrn` 可變字體的必要替換。代價是 12.3 KB → 14.7 KB。

⚠️ 保留了 `tnum` **不代表數字就一定等寬**。實測（2026-08-26，Chromium headless、16px）：
Chrome 會把每個字形的前進寬度**四捨五入到整數像素**，Archivo 的數字在 16px 下因此仍然落在
9px 或 10px 兩種，`tabular-nums` 開不開都一樣。`tnum` 是在支援次像素前進寬度的環境才兌現的
保險，不是這個字級下的保證——**不要拿「日期換一天寬度不變」當成可以斷言的性質**（那句話
是錯的，實測 `2026-08-23` 是 90px、`1111-11-11` 是 84px）。

## 授權

SIL Open Font License 1.1，全文見 `OFL.txt`。OFL 要求散布字型時附上授權，
所以 `OFL.txt` 跟 `.woff2` 一起進 `public/`（會被一起部署）。
