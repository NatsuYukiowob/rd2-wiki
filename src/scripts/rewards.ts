// /rewards 的分類切換。頁面是純瀏覽，內容與總計都在建置時印好；這裡只切換顯示哪一個分類。
const root = document.querySelector<HTMLElement>('[data-rewards-page]');

if (root) {
  const select = root.querySelector<HTMLSelectElement>('[data-reward-mode-select]');
  const status = root.querySelector<HTMLElement>('[data-reward-status]');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-reward-mode-option]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-reward-mode-panel]')];
  const names = new Map(buttons.map(button => [button.dataset.rewardModeOption ?? '', button.textContent?.trim() ?? '']));

  function setMode(modeId: string, announce = true): void {
    if (!names.has(modeId)) return;
    root!.dataset.activeMode = modeId;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rewardModeOption === modeId)));
    panels.forEach(panel => { panel.hidden = panel.dataset.rewardModePanel !== modeId; });
    if (select) select.value = modeId;
    if (announce && status) status.textContent = `已切換至${names.get(modeId)}。`;
  }

  buttons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.rewardModeOption ?? '')));
  select?.addEventListener('change', () => setMode(select.value));
  setMode(root.dataset.activeMode ?? '', false);
  // 切換選單只在腳本接手後出現；沒有 JS 時全部分類攤開（rewards.css 看這個屬性）。
  root.dataset.js = '';
}
