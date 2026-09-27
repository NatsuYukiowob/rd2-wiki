/**
 * 本機 dev-only 文字編輯器：只在 `astro dev` 掛上，`astro build` 時這個 integration 什麼都不做，
 * `dist/` 裡不會有 overlay 也不會有寫檔 API。用法見 CLAUDE.md 的「本機文字編輯器」。
 *
 * API（掛在 dev server 的 `/__dev-editor/*`，只收 127.0.0.1／::1 來的請求）：
 * - `POST /search`   { text, query?, file?, line? } → JSON 與原始碼的候選
 * - `POST /save`     { kind: 'json', file, path, expected, next } | { kind: 'source', file, start, end, expected, next }
 * - `POST /result`   { id } → 某次 /save 的結果（存檔後頁面被 Vite 重整，回應會收不到）
 * - `POST /validate` → `tools/validate.ts` 的輸出
 */
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import {
  candidateQueries,
  EditConflict,
  labelPath,
  maskComments,
  rankJsonHits,
  rankSourceHits,
  replaceJsonString,
  replaceSpan,
  scanJsonStrings,
  searchJson,
  searchSource,
  type JsonPath,
} from './core';

const MOUNT = '/__dev-editor';
const SOURCE_EXT = /\.(astro|ts|js|mjs)$/;
const LIMIT = 40;

const posix = (p: string) => p.split(sep).join('/');

export function listFiles(root: string) {
  const data = readdirSync(resolve(root, 'data'))
    .filter(f => f.endsWith('.json'))
    .map(f => `data/${f}`);
  const src = (readdirSync(resolve(root, 'src'), { recursive: true }) as string[])
    .map(f => `src/${posix(f)}`)
    .filter(f => SOURCE_EXT.test(f) && !f.startsWith('src/generated/'));
  return { data, src };
}

/**
 * 跑 package.json 的 script（不另抄一份 `tsx tools/…` 指令，免得兩邊漂移）。
 * Windows 的 npm 是 `npm.cmd`，沒有 shell 的 execFile 啟動不了它。
 */
function run(root: string, script: string): Promise<{ code: number; out: string }> {
  return new Promise(done => {
    execFile('npm', ['run', '-s', script], { cwd: root, maxBuffer: 8 << 20, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.trim() || (err ? String(err.message) : '');
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out });
    });
  });
}

/**
 * build:data 同一時間只跑一個：連存兩次的話兩個行程會同時改寫 tree.json 與 public/assets，
 * 晚開始的可能先結束、再被舊的蓋回去。跑的途中又有人要，就在這次結束後補跑一次（多次合併成一次），
 * 回傳的是補跑那次的結果——它才包含最後一次存檔。
 */
let building: Promise<{ code: number; out: string }> | null = null;
let rerun: Promise<{ code: number; out: string }> | null = null;
function rebuild(root: string): Promise<{ code: number; out: string }> {
  if (!building) {
    building = run(root, 'build:data').finally(() => { building = null; });
    return building;
  }
  rerun ??= building.catch(() => undefined).then(() => { rerun = null; return rebuild(root); });
  return rerun;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > 1 << 20) throw new Error('請求太大');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostnameOf = (hostPort: string) => {
  try { return new URL(`http://${hostPort}`).hostname; } catch { return ''; }
};

/**
 * 寫檔 API 的四道門：只收本機來源；`Host` 必須是 loopback 名稱（擋 DNS rebinding——被 rebind 的
 * 攻擊頁跟這裡同源、Origin 也等於 Host，只有主機名露餡；而這個 middleware 掛在 Vite 自己的
 * host check 之前，救不到）；必須帶自訂標頭（跨站要帶就得先過 CORS preflight，這裡從不回
 * CORS 標頭）；有 Origin 時必須跟 Host 同一個。
 */
export function allowed(req: IncomingMessage): string | null {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return '只接受本機（127.0.0.1）的編輯請求';
  const host = req.headers.host ?? '';
  if (!LOOPBACK_HOSTS.has(hostnameOf(host))) return `Host 必須是 localhost／127.0.0.1（收到 ${host}）`;
  if (req.method !== 'POST' || req.headers['x-dev-editor'] !== '1') return '缺少編輯器標頭';
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* 格式不對就當不符 */ }
    if (originHost !== host) return 'Origin 與 Host 不符';
  }
  return null;
}

function handler(root: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const denied = allowed(req);
    if (denied) return send(res, 403, { error: denied });
    try {
      const body = await readBody(req);

      if (req.url === '/search') {
        const files = listFiles(root);
        const text = String(body.text ?? '');
        const queries = typeof body.query === 'string' && body.query.trim() ? [body.query] : candidateQueries(text);
        const clicked = typeof body.file === 'string' ? posix(relative(root, body.file)) : undefined;
        const line = typeof body.line === 'number' ? body.line : undefined;
        // 壞掉的 JSON（正在別的編輯器裡改到一半）只跳過那一份並回報，不讓整次搜尋變 500。
        const warnings: string[] = [];
        const jsonFiles = files.data.flatMap(file => {
          const t = readFileSync(resolve(root, file), 'utf8');
          try {
            return [{ file, root: JSON.parse(t) as unknown, hits: scanJsonStrings(t) }];
          } catch (e) {
            warnings.push(`${file} 解析失敗，已略過：${e instanceof Error ? e.message : String(e)}`);
            return [];
          }
        });
        const srcFiles = files.src.map(file => {
          const text = readFileSync(resolve(root, file), 'utf8');
          return { file, text, masked: maskComments(text) };
        });
        for (const query of queries) {
          const json = rankJsonHits(jsonFiles.flatMap(f =>
            searchJson(f.hits, query).map(h => ({ file: f.file, root: f.root, path: h.path, value: h.value }))), query);
          // 先全部收集、排序再截斷：截在前面的話，點到的那個檔可能被目錄順序較前的檔擠出名單。
          const source = rankSourceHits(searchSource(srcFiles, query), clicked, line);
          if (json.length || source.length) {
            // 點到的元素所在的 .astro 裡就有這段字 → 幾乎一定是寫死在那裡，原始碼那組排前面。
            const sourceFirst = source[0]?.file === clicked;
            return send(res, 200, { query, sourceFirst, warnings, json: json.slice(0, LIMIT).map(({ root: r, ...h }) => ({ ...h, label: labelPath(r, h.path) })), source: source.slice(0, LIMIT), more: json.length > LIMIT || source.length > LIMIT });
          }
        }
        return send(res, 200, { query: queries[0] ?? '', sourceFirst: false, warnings, json: [], source: [], more: false });
      }

      if (req.url === '/result') {
        const pending = results.get(String(body.id));
        return send(res, 200, pending ? await pending : { error: '這次存檔的結果已經不在（dev server 重啟過？）' });
      }

      if (req.url === '/save') {
        // 寫檔後 Vite 會搶在回應之前整頁重整，瀏覽器等不到這個回應——結果另外存一份，
        // 重整後的頁面拿 id 來 /result 取回（見 client.ts 的 PENDING_KEY）。
        const id = String(body.id ?? '');
        const job = save(root, listFiles(root), body);
        if (id) {
          results.set(id, job);
          // client 只在存檔後一分鐘內來取（recoverPending），之後就不留著 build:data 的整段輸出。
          void job.finally(() => setTimeout(() => results.delete(id), 120_000).unref());
        }
        return send(res, 200, await job);
      }

      if (req.url === '/validate') return send(res, 200, await run(root, 'validate'));

      return send(res, 404, { error: 'unknown endpoint' });
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

type SaveResult =
  | { ok: true; rebuilt: { code: number; out: string } | null; written: string }
  | { ok: false; conflict: boolean; error: string };
const results = new Map<string, Promise<SaveResult>>();

export async function save(root: string, files: ReturnType<typeof listFiles>, body: Record<string, unknown>): Promise<SaveResult> {
  const file = String(body.file);
  // 只能寫到「搜尋列得出來的檔案」：路徑一律比對白名單，不做任何拼接後的前綴判斷。
  // 取代方式由檔案決定、不信 client 的 kind：data/*.json 只准換字串值（寫完一定是合法 JSON），
  // src/ 才准換原文片段。
  const isJson = files.data.includes(file);
  if (!isJson && !files.src.includes(file)) return { ok: false, conflict: false, error: `不允許寫入 ${file}` };
  if ((body.kind === 'json') !== isJson) return { ok: false, conflict: false, error: `${file} 不能用 ${String(body.kind)} 的方式寫入` };
  let written: string;
  try {
    const abs = resolve(root, file);
    const text = readFileSync(abs, 'utf8');
    const expected = String(body.expected);
    let next = String(body.next);
    // textarea 一律把換行正規化成 LF；檔案是 CRLF（Windows 上 autocrlf）時換回去，免得寫出混用換行。
    // 看整個檔不看片段：單行片段改成多行時，片段本身沒有換行可以參考。
    if (!isJson && text.includes('\r\n')) next = next.replace(/\r?\n/g, '\r\n');
    const out = isJson
      ? replaceJsonString(text, body.path as JsonPath, expected, next)
      : replaceSpan(text, Number(body.start), Number(body.end), expected, next);
    if (isJson) JSON.parse(out); // 保險：寫出去的一定是合法 JSON
    writeFileSync(abs, out);
    written = next;
  } catch (e) {
    return { ok: false, conflict: e instanceof EditConflict, error: e instanceof Error ? e.message : String(e) };
  }
  // /tree、/sim 讀的是 build:data 產的 src/generated/tree.json：data/ 與 src/lib/（build-data 會 import
  // 那裡的標籤與格式化函式）改了要重產才看得到。刻意不維護「build-data 讀哪幾份」的清單——漏一份
  // 就是無聲的舊資料，多跑幾秒比較便宜。
  const rebuilt = isJson || file.startsWith('src/lib/') ? await rebuild(root) : null;
  return { ok: true, rebuilt, written };
}

export default function devEditor(): AstroIntegration {
  let root = '';
  return {
    name: 'rd2-dev-editor',
    hooks: {
      'astro:config:setup': ({ command, config, injectScript }) => {
        if (command !== 'dev') return;
        root = fileURLToPath(config.root);
        const client = fileURLToPath(new URL('./client.ts', import.meta.url));
        injectScript('page', `import ${JSON.stringify(client)};`);
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(MOUNT, handler(root));
      },
    },
  };
}
