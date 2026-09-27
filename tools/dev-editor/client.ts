/**
 * dev-only 文字編輯器的瀏覽器端（由 integration.ts 在 `astro dev` 時注入每一頁）。
 * 右下角「✎ 編輯」打開編輯模式 → 點任何一段字 → 面板列出它在 data/*.json 與 src/ 的候選來源 →
 * 改完存檔，Vite 熱更新後頁面自己重整。UI 全放在 shadow DOM，站台 CSS 碰不到它、它也碰不到站台。
 */
type JsonHit = { file: string; path: (string | number)[]; label: string; value: string };
type SourceHit = { file: string; start: number; end: number; line: number; value: string };
type SearchResult = { query: string; sourceFirst: boolean; json: JsonHit[]; source: SourceHit[]; more: boolean };
type SaveResult = { ok: true; rebuilt: { code: number; out: string } | null } | { ok: false; conflict?: boolean; error: string };

const API = '/__dev-editor';
const ON_KEY = 'rd2-dev-editor-on';
/** 存檔中的那一筆 `{id, label}`：寫檔會讓 Vite 整頁重整、回應收不到，重整後拿 id 去 /result 取回結果。 */
const PENDING_KEY = 'rd2-dev-editor-pending';

async function call<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(API + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-editor': '1' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const STYLE = `
:host { all: initial; position: fixed; z-index: 2147483647; }
* { box-sizing: border-box; font: 14px/1.5 system-ui, "Noto Sans CJK TC", sans-serif; }
.toggle { position: fixed; right: 16px; bottom: 16px; z-index: 3; padding: 8px 14px; border-radius: 999px;
  border: 1px solid #888; background: #222; color: #eee; cursor: pointer; box-shadow: 0 2px 8px #0006; }
.toggle.on { background: #f5b700; color: #000; border-color: #f5b700; }
.hl { position: fixed; z-index: 1; pointer-events: none; outline: 2px dashed #f5b700; background: #f5b70018; display: none; }
.panel { position: fixed; top: 16px; right: 16px; bottom: 64px; width: min(560px, calc(100vw - 32px)); z-index: 2;
  display: none; flex-direction: column; background: #1b1b1f; color: #eee; border: 1px solid #555; border-radius: 10px;
  box-shadow: 0 8px 32px #000a; }
.panel.open { display: flex; }
.head { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid #444; }
.head input { flex: 1; min-width: 0; padding: 6px 8px; background: #111; color: #eee; border: 1px solid #555; border-radius: 6px; }
button { padding: 6px 10px; border-radius: 6px; border: 1px solid #666; background: #333; color: #eee; cursor: pointer; }
button:hover { background: #444; }
button.primary { background: #f5b700; color: #000; border-color: #f5b700; }
.statusBox { padding: 6px 10px; color: #bbb; white-space: pre-wrap; max-height: 30%; overflow: auto; }
.statusBox.err { color: #ff8a80; }
.list { flex: 1; overflow: auto; padding: 0 10px 10px; }
.group { margin: 12px 0 4px; color: #f5b700; font-weight: 600; }
.hit { margin: 8px 0; padding: 8px; border: 1px solid #444; border-radius: 8px; background: #232329; }
.label { color: #9ecbff; font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; margin-bottom: 6px; }
textarea { width: 100%; min-height: 64px; resize: vertical; padding: 6px; background: #111; color: #eee;
  border: 1px solid #555; border-radius: 6px; font-family: ui-monospace, "Noto Sans Mono CJK TC", monospace; }
.row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

const host = el('div');
host.id = 'rd2-dev-editor';
// host 自己建立最上層的 stacking context：否則裡面的 fixed 元素跟站台的 sticky 導覽列、
// 篩選列比 z-index 會輸（實測面板頂端的搜尋列被導覽列蓋住）。
host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647;';
const shadow = host.attachShadow({ mode: 'open' });
const toggle = el('button', { className: 'toggle', textContent: '✎ 編輯', title: '文字編輯模式（dev only）' });
const hl = el('div', { className: 'hl' });
const query = el('input', { placeholder: '搜尋 data/*.json 與 src/ 的文字' });
const statusBox = el('div', { className: 'statusBox' });
const list = el('div', { className: 'list' });
const panel = el('div', { className: 'panel' },
  el('div', { className: 'head' }, query,
    el('button', { textContent: '搜尋', onclick: () => void search({ query: query.value }) }),
    el('button', { textContent: '驗證', title: 'npm run validate', onclick: () => void validate() }),
    el('button', { textContent: '✕', title: '關閉（Esc）', onclick: () => closePanel() })),
  statusBox, list);
shadow.append(el('style', { textContent: STYLE }), hl, panel, toggle);
document.body.append(host);

// 面板裡的鍵盤與指標事件不外流：shadow DOM 裡的 textarea 對站台來說 activeElement 是 host <div>，
// 站台的全域快捷鍵（/tree 方向鍵平移、Esc 退視圖、點外面關選單）會把在編輯器裡的操作當成自己的。
for (const type of ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
  host.addEventListener(type, e => e.stopPropagation());
}
shadow.addEventListener('keydown', e => {
  if ((e as KeyboardEvent).key === 'Escape' && panel.classList.contains('open')) closePanel();
});

let on = false;
try { on = sessionStorage.getItem(ON_KEY) === '1'; } catch { /* 無痕或封鎖儲存：預設關 */ }

function setOn(v: boolean) {
  on = v;
  toggle.classList.toggle('on', v);
  toggle.textContent = v ? '✎ 編輯中（點字）' : '✎ 編輯';
  if (!v) { hl.style.display = 'none'; closePanel(); }
  try { sessionStorage.setItem(ON_KEY, v ? '1' : '0'); } catch { /* 同上 */ }
}
setOn(on);
toggle.onclick = () => setOn(!on);

const inOverlay = (e: Event) => e.composedPath().includes(host);

function setStatus(msg: string, err = false) {
  statusBox.textContent = msg;
  statusBox.classList.toggle('err', err);
}

function closePanel() {
  panel.classList.remove('open');
}

document.addEventListener('mousemove', e => {
  if (!on || inOverlay(e) || !(e.target instanceof Element)) { hl.style.display = 'none'; return; }
  const r = e.target.getBoundingClientRect();
  Object.assign(hl.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}, true);

/** 游標底下的文字節點；點在沒有直接文字的元素上時退回整個元素的可見文字。 */
function textAt(x: number, y: number, target: Element): { text: string; anchor: Element } {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null };
  const node = doc.caretPositionFromPoint?.(x, y)?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
  // caret 會吸附到最近的文字節點，可能落在旁邊的元素裡；只收高亮的那個元素底下的。
  if (node?.nodeType === Node.TEXT_NODE && node.textContent?.trim() && node.parentElement && target.contains(node)) {
    return { text: node.textContent, anchor: node.parentElement };
  }
  const own = [...target.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent ?? '').join(' ');
  return { text: own.trim() ? own : (target as HTMLElement).innerText ?? target.textContent ?? '', anchor: target };
}

// 編輯模式下站台的指標行為全部攔下（window 捕獲階段＝最早）：點連結不跳頁、/board 不開卡片不拖曳、
// /tree、/sim 的畫布不選取不平移。只放行 click 給下面那支做搜尋。
for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick', 'auxclick']) {
  window.addEventListener(type, e => {
    if (!on || inOverlay(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true, passive: false });
}
window.addEventListener('click', e => {
  if (!on || inOverlay(e) || !(e.target instanceof Element)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const { text, anchor } = textAt(e.clientX, e.clientY, e.target);
  if (!text.trim()) return;
  const src = anchor.closest('[data-astro-source-file]');
  const loc = src?.getAttribute('data-astro-source-loc') ?? '';
  query.value = text.replace(/\s+/g, ' ').trim();
  void search({ text, file: src?.getAttribute('data-astro-source-file') ?? undefined, line: Number.parseInt(loc, 10) || undefined });
}, true);

let searchSeq = 0;

async function search(req: { text?: string; query?: string; file?: string; line?: number }) {
  // 較早送出的搜尋可能比較晚回來（候選查詢退得比較多），只收最後一次的結果。
  const seq = ++searchSeq;
  panel.classList.add('open');
  list.replaceChildren();
  setStatus('搜尋中…');
  try {
    const r = await call<SearchResult>('/search', req);
    if (seq !== searchSeq) return;
    query.value = r.query;
    const n = r.json.length + r.source.length;
    setStatus(n
      ? `「${r.query}」找到 ${n} 處${r.more ? '（只列前幾筆，請把關鍵字打長一點）' : ''}。Ctrl+Enter 存檔。`
      : `找不到「${r.query}」。畫面上的字可能是組出來的，改成搜其中一小段試試。`);
    const jsonGroup = r.json.length ? [el('div', { className: 'group', textContent: '資料（data/*.json）' }), ...r.json.map(h =>
      card(`${h.file} › ${h.label}`, h.value, b =>
        call<SaveResult>('/save', { kind: 'json', file: h.file, path: h.path, expected: h.value, ...b })))] : [];
    const sourceGroup = r.source.length ? [el('div', { className: 'group', textContent: '原始碼（src/，寫死的字）' }), ...r.source.map(h =>
      card(`${h.file}:${h.line}`, h.value, b =>
        call<SaveResult>('/save', { kind: 'source', file: h.file, start: h.start, end: h.end, expected: h.value, ...b })))] : [];
    list.append(...(r.sourceFirst ? [...sourceGroup, ...jsonGroup] : [...jsonGroup, ...sourceGroup]));
  } catch (err) {
    if (seq !== searchSeq) return;
    setStatus(String(err instanceof Error ? err.message : err), true);
  }
}

type Pending = { id: string; label: string; at: number; result?: SaveResult; resultAt?: number };

function readPending(): Pending | null {
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null; } catch { return null; }
}
function writePending(p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* 無痕或封鎖儲存：只靠當下這一頁的回應 */ }
}

function showResult(p: Pending, r: SaveResult) {
  writePending({ ...p, result: r, resultAt: p.resultAt ?? Date.now() });
  panel.classList.add('open');
  if (!r.ok) setStatus(`${r.conflict ? '沒有存檔（衝突）' : '存檔失敗'}：${r.error}`, true);
  else if (r.rebuilt && r.rebuilt.code !== 0) setStatus(`已存檔：${p.label}\n但 build:data 失敗：\n${r.rebuilt.out}`, true);
  else setStatus(`已存檔：${p.label}${r.rebuilt ? '（已重跑 build:data）' : ''}`);
}

function card(label: string, value: string, save: (body: { next: string; id: string }) => Promise<SaveResult>) {
  const ta = el('textarea', { value });
  ta.rows = Math.min(12, value.split('\n').length + 1);
  const doSave = async () => {
    if (ta.value === value) { setStatus('內容沒有變動'); return; }
    const p: Pending = { id: crypto.randomUUID(), label, at: Date.now() };
    writePending(p);
    setStatus(`存檔中：${label}${label.startsWith('data/') ? '（接著重跑 build:data，約數秒）' : ''}`);
    try {
      showResult(p, await save({ next: ta.value, id: p.id }));
    } catch (err) {
      writePending(null);
      setStatus(String(err instanceof Error ? err.message : err), true);
    }
  };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void doSave(); });
  return el('div', { className: 'hit' },
    el('div', { className: 'label', textContent: label }), ta,
    el('div', { className: 'row' }, el('button', { className: 'primary', textContent: '存檔', onclick: () => void doSave() })));
}

/**
 * 存檔會觸發一到兩次整頁重整（寫檔一次；data/ 另有 build:data 重產 tree.json 一次，常在結果出來後
 * 幾十毫秒才到），所以結果存進 sessionStorage：還沒結果就去 /result 取，已有結果就在 5 秒內的重整
 * 再顯示一次。整個存檔超過一分鐘沒收尾就放棄，免得之後換頁還跳出舊訊息。
 */
async function recoverPending() {
  const p = readPending();
  if (!p) return;
  if (Date.now() - p.at > 60_000 || (p.resultAt && Date.now() - p.resultAt > 5_000)) { writePending(null); return; }
  if (p.result) { showResult({ ...p }, p.result); return; }
  panel.classList.add('open');
  setStatus(`取回存檔結果：${p.label}…`);
  try {
    showResult(p, await call<SaveResult>('/result', { id: p.id }));
  } catch (err) {
    writePending(null);
    setStatus(String(err instanceof Error ? err.message : err), true);
  }
}
void recoverPending();

async function validate() {
  panel.classList.add('open');
  setStatus('npm run validate 執行中…');
  try {
    const r = await call<{ code: number; out: string }>('/validate', {});
    setStatus(`validate exit ${r.code}\n${r.out.split('\n').slice(-20).join('\n')}`, r.code !== 0);
  } catch (err) {
    setStatus(String(err instanceof Error ? err.message : err), true);
  }
}

export {};
