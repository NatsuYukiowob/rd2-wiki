// 「用 GitHub 登入」／「送出 PR」面板（Task 21，功能的最後一塊）：把 P1（編輯）跟 P2
// （Task 17 加密 session／Task 18 OAuth／Task 19 GitHub API／Task 20 送出端點）接起來，
// 讓「下載檔案自己送 PR」變成「按一下送出」。
//
// 設計核心（spec §6.2）：**未登入也能編輯，登入只在按下「送出 PR」那一刻才要求**。玩家
// 第一次按登入時，GitHub 會顯示「此應用程式要求存取你的公開儲存庫」——對沒送過 PR 的手遊
// 玩家而言這是真實的信任門檻，處理不好會在最後一步流失貢獻者。讓他先確認自己改得出東西、
// 看得到成果，再決定要不要授權，比任何文案都有效。落地方式：載入時打一次
// `/api/github/me`，401 顯示登入鈕＋權限說明；200 顯示「已登入為 X」＋送出鍵。這裡完全
// 不會擋住編輯——`edit-canvas.ts` 的其餘流程不依賴這個面板的登入狀態，就算 `/api/github/me`
// 逾時或整段失敗，玩家仍然能繼續編輯，只是暫時看不到送出鍵（見 init() 的 catch）。
//
// 跟 EditForm.ts／NewNodeForm.ts／ValidationPanel.ts「元件只管畫、事件委派留給呼叫端」的
// 既有分工不完全一樣：這裡需要打 API（GET /me、POST /submit），沒有理由把 fetch 邏輯搬去
// edit-canvas.ts 再繞回來。NewNodeForm.ts 的 `wireReactivePrefixOptions()` 已經立過先例
// ——那條分工原則真正要保護的是「會改動 editorState.svgText 的動作集中在 edit-canvas.ts」，
// 這裡的 fetch 呼叫完全不碰 svgText（只讀呼叫端組好的 payload、只寫這個面板自己的 DOM），
// 沒有違反那個原則。
//
// 刻意不 import editorState：那會跟呼叫端形成循環相依（edit-canvas.ts 要 import 這裡的
// `mountSubmitPanel`，這裡若也 import edit-canvas.ts 的 `editorState`，兩個模組互相
// import——ESM 技術上撐得住循環相依，但沒有必要冒這個風險）。改成呼叫端傳一個
// `getPayload()` callback，只在送出當下才呼叫，讀到的永遠是「按下送出那一刻」最新的
// editorState，不是掛載當下的舊快照。
import type { EditSummary } from '../lib/pr-summary.js';

/** 送出端點 `/api/github/submit` 的 request body 形狀，跟
 *  `functions/api/github/submit.ts` 的 `SubmitBody` 手動保持一致（不直接 import 那個
 *  型別：`functions/` 是 Cloudflare Pages Functions 的程式，用的是另一套 tsconfig／
 *  打包單元，`src/` 也不該反向依賴 `functions/`，見 Global Constraints）。 */
export interface SubmitPayload {
  svgText: string;
  /** `editorState.original`（玩家開始編輯前那份骰子樹）的 sha256 前 12 碼——伺服器用同一個
   *  `baseSha` 重讀一次上游現在的 `data/dice-tree.svg` 比對雜湊，不同就代表上游在玩家編輯
   *  期間又有新的合併，回 409 請玩家重新整理（I4，見 edit-canvas.ts 的 `baseSvgHash` 說明與
   *  `functions/api/github/submit.ts`）。跟 `keywords`／`icons` 不同，這個欄位永遠會帶
   *  （不是「有新增才帶」），因為每次送出都要做這個比對，不是「玩家本次有沒有動到某樣東西」
   *  的條件式欄位。 */
  baseSvgHash: string;
  keywords?: string[];
  icons?: { hash: string; base64: string }[];
  summary: EditSummary;
}

export interface SubmitPanelHandle {
  /** 供呼叫端（edit-canvas.ts 的 runValidation()）依「有沒有驗證錯誤、有沒有改動」即時
   *  切換送出鍵可用狀態，跟 `#edit-download` 用同一個判斷條件（見該函式）。登入結果還沒
   *  查完、或玩家根本還沒登入時，`#edit-submit` 這個元素還不存在——這裡把「啟用與否」存成
   *  面板自己的狀態，不是直接找按鈕設 `disabled`，按鈕之後才被畫出來時會套用最後一次收到
   *  的值，不會因為呼叫順序而顯示錯誤的初始狀態。 */
  setEnabled(enabled: boolean): void;
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
/** 跟 EditForm.ts／ValidationPanel.ts 同名函式一樣：插進 innerHTML 的文字一律先過這道
 *  逃逸，不分辨來源是不是「使用者輸入」——伺服器回應的 login／PR 網址理論上可信，但
 *  「插進 DOM 的文字都要 escape」這條規則沒有例外條款。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch] ?? ch);
}

/** 給非開發者看的權限說明（spec §6.2 要求的內容）：不用「OAuth」「scope」這類術語，直接講
 *  「為什麼」——要幫你 fork 一份、把改動寫進「你自己的」那份、再送出 PR。這段文字固定顯示在
 *  登入鈕旁（不是藏在展開/tooltip 裡的次要資訊）：信任門檻要在玩家按下去之前就講清楚，不是
 *  按下去、看到 GitHub 授權頁才補救。
 *
 *  措辭上只承諾「不會」、不寫「沒有能力」：`public_repo` 這個 scope 技術上確實有寫入玩家所有
 *  公開 repo 的能力，寫成「沒有能力」是不實陳述——而這句話正是玩家按下授權鈕前看到的最後一句，
 *  講得比事實滿，被發現時傷的是同一份信任。改成解釋「為什麼範圍看起來這麼大」（GitHub 沒有
 *  單一 repo 的權限選項），跟 CONTRIBUTING.md 第 3 節對同一件事的說法一致。 */
const PERMISSION_NOTE =
  '按下「用 GitHub 登入」後，GitHub 會問你要不要讓這個網站存取你的公開儲存庫。看起來範圍很大，' +
  '是因為 GitHub 沒有「只能存取某一個 repo」這種選項，能要的最小範圍就是這個。實際上送出 PR ' +
  '只做三件事：幫你 fork 一份骰子樹的資料、把你的改動寫進「你自己的」那份 fork 裡、再拿它去開 ' +
  'PR——本站不會去碰你其他的 repo。';

/** `#edit-submit-result` 在登入前、後兩種畫面都要存在（送出成功／失敗的訊息才有地方
 *  顯示），兩個分支各自的 innerHTML 都以它收尾，抽成常數避免兩處字面重複、日後改動時
 *  漏改其中一處。 */
const RESULT_HOST_HTML = '<div id="edit-submit-result"></div>';

/**
 * 掛載登入／送出面板。載入時打一次 `/api/github/me`：401（或請求本身失敗）顯示登入鈕＋
 * 權限說明；200 顯示「已登入為 {login}」＋送出鍵。`getPayload` 是呼叫端在按下送出那一刻
 * 才會被呼叫的 callback，組出這次要送出的 `SubmitPayload`（見該型別的說明）。
 *
 * 回傳的 handle 只有一個方法：`setEnabled`。這個面板自己完全不知道「什麼時候該啟用送出
 * 鍵」——那是驗證結果（有沒有 error、有沒有改動）決定的，屬於 edit-canvas.ts 的
 * runValidation() 的職責，跟 ValidationPanel.ts／`#edit-download` 的協調方式一致：元件
 * 只管顯示收到的狀態，不伸手去問「現在能不能送出」。
 */
export function mountSubmitPanel(host: HTMLElement, getPayload: () => SubmitPayload): SubmitPanelHandle {
  // `enabled`：runValidation() 最後一次告知的「能不能送出」。`submitting`：這次送出的
  // fetch 是否還在進行中——兩者分開存，是因為送出中途玩家理論上可能又碰了別的欄位觸發
  // runValidation()（欄位沒有在送出期間被鎖住，只有送出鍵本身被鎖住），此時不該讓
  // setEnabled(true) 把「送出中」的 disabled 狀態蓋掉，變成同一次送出被連點兩次。
  // applyButtonState() 統一用這兩個旗標算出最終畫面，是這裡唯一寫 DOM disabled/文字的地方。
  const state = { enabled: false, submitting: false };

  function applyButtonState(): void {
    const btn = host.querySelector<HTMLButtonElement>('#edit-submit');
    if (!btn) return; // 還沒登入（沒有這顆按鈕）或 init() 尚未完成，沒有東西可更新
    if (state.submitting) {
      btn.disabled = true;
      btn.textContent = '送出中…';
    } else {
      btn.disabled = !state.enabled;
      btn.textContent = '送出 PR';
    }
  }

  async function init(): Promise<void> {
    // Task 18 的 `functions/api/github/callback.ts` 在 OAuth 流程任何一步失敗時（玩家在
    // GitHub 授權頁按取消、換 token 失敗、查使用者失敗……）會把玩家導回 `/edit?login=failed`
    // ——那份設計本來就預期前端要讀這個查詢參數、顯示可讀訊息（見該檔 `loginFailed()` 與
    // task-18-brief.md「讓前端顯示可讀的錯誤，不要把 GitHub 的原始錯誤丟給玩家」）。
    // Task 18-20 都只做後端，這裡是唯一、也是最後一個會消費這個參數的前端程式碼——不接的話，
    // 玩家在授權頁按了取消，會被導回 /edit 卻完全看不出剛剛發生了什麼事，直接讓 Task 18
    // 立下的承諾落空。任務簡報本身沒點名這個 DOM 契約，是自我審查時對照 Task 18 的設計文件
    // 才發現的落地缺口，見任務報告。
    //
    // 讀完立刻用 `history.replaceState` 把參數從網址列拿掉：這個查詢參數的語意是「剛剛那次
    // OAuth 嘗試失敗了」，只在這次頁面載入當下有意義，重新整理一次就該恢復成一般的未登入
    // 畫面，不該讓失敗訊息因為玩家重新整理就一直卡著、也不該留在瀏覽器歷史或分享網址裡。
    const params = new URLSearchParams(location.search);
    const loginFailed = params.get('login') === 'failed';
    if (loginFailed) {
      params.delete('login');
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
    }

    let login: string | null = null;
    try {
      const res = await fetch('/api/github/me');
      if (res.ok) {
        const body = (await res.json()) as { login: string };
        login = body.login;
      }
      // res 非 2xx（正常應該只有 401）：login 保持 null，走未登入畫面，不特別分辨狀態碼
      // ——`/api/github/me` 的契約就只有「登入了」跟「沒登入」兩種語意，見 functions/api/
      // github/me.ts。
    } catch {
      // 網路錯誤／端點異常：當成未登入處理。見檔頭「未登入也能編輯」——登入狀態查詢本身
      // 失敗，也不該讓玩家連編輯都做不了，退回最安全（最不會誤導人）的「未登入」畫面。
    }

    if (login === null) {
      host.innerHTML =
        (loginFailed ? `<p id="edit-login-failed">登入沒有成功，請再試一次。</p>` : '') +
        `<a id="edit-login" href="/api/github/login">用 GitHub 登入</a>` +
        `<p id="edit-permission-note">${escapeHtml(PERMISSION_NOTE)}</p>` +
        RESULT_HOST_HTML;
      return;
    }

    host.innerHTML =
      `<p id="edit-login-status">已登入為 <strong>${escapeHtml(login)}</strong></p>` +
      `<button id="edit-submit" type="button" disabled>送出 PR</button>` +
      RESULT_HOST_HTML;
    applyButtonState(); // 套用登入完成前就可能已經收到的 setEnabled() 結果，見 setEnabled 的說明
    host.querySelector<HTMLButtonElement>('#edit-submit')?.addEventListener('click', () => void submit());
  }

  async function submit(): Promise<void> {
    if (state.submitting) return; // 按鈕理論上已經 disabled，這裡是雙重保險，不吃虧
    state.submitting = true;
    applyButtonState();
    const resultEl = host.querySelector<HTMLElement>('#edit-submit-result');

    try {
      const payload = getPayload();
      const res = await fetch('/api/github/submit', {
        method: 'POST',
        // content-type 一定要帶：Task 20 的實作雖然只用 request.text() 再自己 JSON.parse，
        // 沒有嚴格檢查這個標頭，但省略它會讓 fetch 預設用 text/plain 送出——這不是「反正
        // 對方不檢查就無所謂」的事，是「送一個名實不符的請求」，跟任務簡報點名的「漏掉會讓
        // 真實 API 失敗的 Content-Type」是同一類坑，這裡明確帶上避免日後後端改嚴格就中招。
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { number: number; url: string }
        | { message: string }
        | null;

      if (res.ok && body && 'number' in body) {
        if (resultEl) {
          resultEl.innerHTML =
            `已送出 PR <a href="${escapeHtml(body.url)}" target="_blank" rel="noopener">` +
            `#${escapeHtml(String(body.number))}</a>！接下來 CI 會自動檢查，維護者會來看。`;
        }
      } else {
        // 顯示伺服器回的 `message` 字串，原樣顯示、不自己另外編一套措辭蓋掉它——
        // functions/api/github/submit.ts 已經把節流秒數、GitHub API 的原始錯誤都轉成
        // 人話塞在這個欄位裡（見該檔），這裡蓋掉的話玩家看到的可能跟伺服器實際判斷的
        // 原因對不上。
        //
        // ⚠️ 欄位名是 `message`，不是 `error`——這裡是照 functions/api/github/submit.ts
        // 的實際回應格式走（該檔所有錯誤分支：413/429/400/502 一律 `{ message }`，
        // tests/functions/submit.test.ts 也是這樣斷言的），跟這個任務簡報 Step 3 原文
        // 「顯示伺服器回的 `error` 字串」不一致——簡報這處寫錯了，已在任務報告記錄，
        // 這裡刻意不照抄錯的欄位名，否則生產環境送出失敗時，玩家只會看到 undefined。
        const fallback = res.status === 401
          ? '登入已失效，請重新整理頁面登入後再試一次'
          : '送出失敗，請稍後再試一次';
        const message = body && 'message' in body ? body.message : fallback;
        if (resultEl) resultEl.textContent = `送出失敗：${message}`;
      }
    } catch {
      // fetch 本身失敗（離線、逾時…）或 getPayload() 拋例外（理論上不會發生：送出鍵只在
      // runValidation() 判定「沒有驗證錯誤」時才會被啟用，見 edit-canvas.ts 的
      // buildSubmitPayload() 說明）都收斂到這裡，統一給一句可讀訊息，不讓例外冒出去變成
      // 只有瀏覽器主控台看得到、玩家完全看不懂發生什麼事的沉默失敗。
      if (resultEl) resultEl.textContent = '送出失敗：無法連上伺服器，請檢查網路連線後再試一次';
    } finally {
      state.submitting = false;
      applyButtonState();
    }
  }

  void init();

  return {
    setEnabled(enabled: boolean): void {
      state.enabled = enabled;
      applyButtonState();
    },
  };
}
