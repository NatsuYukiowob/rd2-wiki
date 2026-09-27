import rewardsRaw from '../../data/rewards.json';
import { rewardDisplay } from '../lib/reward-display';
import {
  achievementProgressAfterToggle,
  completedAchievementStages,
  completedRewardTiers,
  isRewardTierComplete,
  modeTotals,
  normalizeRewardProgress,
  progressAfterTierToggle,
  rewardGrantKey,
  rewardGrantsInMode,
  rewardTotalsAcrossModes,
  splitRewardTotals,
} from '../lib/rewards';
import {
  deserializeRewardProgress,
  emptyRewardProgress,
  hasRewardProgress,
  LEGACY_REWARDS_STORAGE_KEY,
  migrateLegacyRewardProgress,
  REWARDS_STORAGE_KEY,
  serializeRewardProgress,
  withAchievementProgress,
  withModeProgress,
  withoutAchievementProgress,
  withoutModeProgress,
} from '../lib/rewards-io';
import type { RewardCatalog, RewardMode } from '../lib/types';

const catalog = rewardsRaw as RewardCatalog;
const modes = new Map(catalog.modes.map(mode => [mode.id, mode]));
const validThresholdIds = new Set(catalog.modes.filter(mode => mode.kind === 'threshold').map(mode => mode.id));
const validAchievementIds = new Set(catalog.modes.flatMap(mode =>
  mode.kind === 'achievement' ? mode.groups.map(group => group.id) : []));
const page = document.querySelector<HTMLElement>('[data-rewards-page]');

if (page && catalog.modes.length > 0) {
  const root = page;
  const firstMode = catalog.modes[0]!;
  const input = root.querySelector<HTMLInputElement>('[data-reward-progress-input]');
  const form = root.querySelector<HTMLFormElement>('[data-reward-progress-form]');
  const clear = root.querySelector<HTMLButtonElement>('[data-reward-clear]');
  const clearAchievements = root.querySelector<HTMLButtonElement>('[data-reward-clear-achievements]');
  const clearAll = root.querySelector<HTMLButtonElement>('[data-reward-clear-all]');
  const clearDialog = root.querySelector<HTMLDialogElement>('[data-reward-clear-dialog]');
  const select = root.querySelector<HTMLSelectElement>('[data-reward-mode-select]');
  const title = root.querySelector<HTMLElement>('[data-reward-mode-title]');
  const note = root.querySelector<HTMLElement>('[data-reward-mode-note]');
  const completedCount = root.querySelector<HTMLElement>('[data-reward-completed-count]');
  const tierCount = root.querySelector<HTMLElement>('[data-reward-tier-count]');
  const status = root.querySelector<HTMLElement>('[data-reward-status]');
  const thresholdControls = root.querySelector<HTMLElement>('[data-reward-threshold-controls]');
  const achievementControls = root.querySelector<HTMLElement>('[data-reward-achievement-controls]');
  const taskToggles = [...root.querySelectorAll<HTMLButtonElement>('[data-reward-task-toggle]')];
  const controls = root.querySelector<HTMLElement>('.reward-controls');
  const globalSummary = root.querySelector<HTMLElement>('.reward-global-summary');
  const taskPanels = [...root.querySelectorAll<HTMLElement>('[data-reward-task-panel]')];
  const modeButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-reward-mode-option]')];
  const modePanels = [...root.querySelectorAll<HTMLElement>('[data-reward-mode-panel]')];
  const totalTemplates = new Map([...root.querySelectorAll<HTMLTemplateElement>('[data-reward-total-template]')]
    .map(template => [template.dataset.rewardTotalTemplate ?? '', template]));
  const allGrants = new Map(catalog.modes.flatMap(mode => rewardGrantsInMode(mode))
    .map(reward => [rewardGrantKey(reward), reward]));

  let saved = emptyRewardProgress();
  try {
    const current = deserializeRewardProgress(
      localStorage.getItem(REWARDS_STORAGE_KEY), validThresholdIds, validAchievementIds);
    const legacy = current ? null : migrateLegacyRewardProgress(
      localStorage.getItem(LEGACY_REWARDS_STORAGE_KEY), validThresholdIds);
    saved = current ?? legacy ?? emptyRewardProgress();
    // v1 的紀錄只是最高紀錄，升版後仍有語意；成功寫入 v2 才移除舊 key。
    if (legacy && hasRewardProgress(legacy)) {
      localStorage.setItem(REWARDS_STORAGE_KEY, serializeRewardProgress(saved));
      localStorage.removeItem(LEGACY_REWARDS_STORAGE_KEY);
    }
  } catch {
    // Safari 私密模式／封鎖 storage 時頁面仍能操作，本次操作不會跨 reload 保留。
  }

  let activeModeId = modes.has(root.dataset.activeMode ?? '') ? root.dataset.activeMode as string : firstMode.id;
  const currentMode = (): RewardMode => modes.get(activeModeId) ?? firstMode;
  const currentProgress = (): number => saved.currentProgress[activeModeId] ?? 0;
  function announce(message: string): void { if (status) status.textContent = message; }

  function persist(): void {
    try {
      if (hasRewardProgress(saved)) localStorage.setItem(REWARDS_STORAGE_KEY, serializeRewardProgress(saved));
      else localStorage.removeItem(REWARDS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_REWARDS_STORAGE_KEY);
    } catch {
      announce('瀏覽器目前無法保存進度；本次操作仍可使用。');
    }
  }

  function render(): void {
    const readOnly = activeModeId === catalog.repeatable?.id;
    const heading = title?.closest<HTMLElement>('.reward-mode-heading');
    if (heading) heading.hidden = readOnly;
    title?.classList.toggle('sec-title', !readOnly);
    if (title) title.hidden = readOnly;
    if (controls) controls.hidden = readOnly;
    if (globalSummary) globalSummary.hidden = readOnly;
    if (readOnly) {
      if (title) title.textContent = catalog.repeatable!.name;
      if (note) note.textContent = '';
      return;
    }
    const mode = currentMode();
    const progress = currentProgress();
    const currentTotals = modeTotals(mode, progress, saved.achievementProgress);
    const currentGrants = new Map(rewardGrantsInMode(mode).map(reward => [rewardGrantKey(reward), reward]));
    const totalsByScope = {
      current: { totals: currentTotals, grants: currentGrants },
      all: { totals: rewardTotalsAcrossModes(catalog.modes, saved.currentProgress, saved.achievementProgress), grants: allGrants },
    };

    if (input) input.value = String(progress);
    if (title) title.textContent = mode.name;
    if (note) note.textContent = mode.kind === 'threshold' ? `${mode.requirementLabel}進度` : '各成就獨立追蹤';
    if (thresholdControls) thresholdControls.hidden = mode.kind !== 'threshold';
    if (achievementControls) achievementControls.hidden = mode.kind !== 'achievement';
    const completed = mode.kind === 'threshold'
      ? completedRewardTiers(mode, progress).length
      : mode.groups.reduce((sum, group) => sum + completedAchievementStages(group, saved.achievementProgress[group.id] ?? 0).length, 0);
    const total = mode.kind === 'threshold' ? mode.tiers.length : mode.groups.reduce((sum, group) => sum + group.stages.length, 0);
    if (completedCount) completedCount.textContent = String(completed);
    if (tierCount) tierCount.textContent = String(total);

    modePanels.forEach(panel => {
      const panelMode = modes.get(panel.dataset.rewardModePanel ?? '');
      if (!panelMode) return;
      if (panelMode.kind === 'threshold') {
        const panelProgress = saved.currentProgress[panelMode.id] ?? 0;
        panel.querySelectorAll<HTMLInputElement>('[data-reward-tier-checkbox]').forEach(box => {
          const tier = panelMode.tiers.find(candidate => candidate.requirement === Number(box.value));
          box.checked = tier ? isRewardTierComplete(tier, panelProgress) : false;
          box.closest<HTMLElement>('[data-reward-tier]')?.classList.toggle('is-complete', box.checked);
        });
      } else {
        panel.querySelectorAll<HTMLElement>('[data-reward-achievement-group]').forEach(element => {
          const group = panelMode.groups.find(candidate => candidate.id === element.dataset.rewardAchievementGroup);
          if (!group) return;
          const groupProgress = saved.achievementProgress[group.id] ?? 0;
          const count = element.querySelector<HTMLElement>('[data-reward-group-completed]');
          if (count) count.textContent = String(completedAchievementStages(group, groupProgress).length);
          element.querySelectorAll<HTMLInputElement>('[data-reward-stage-checkbox]').forEach(box => {
            box.checked = Number(box.value) <= groupProgress;
            box.closest<HTMLElement>('[data-reward-stage]')?.classList.toggle('is-complete', box.checked);
          });
        });
      }
    });

    for (const scopeId of ['current', 'all'] as const) {
      const scope = totalsByScope[scopeId];
      const split = splitRewardTotals([...scope.grants.values()], scope.totals);
      for (const kind of ['currency', 'collectible'] as const) {
        const rows: HTMLElement[] = [];
        for (const { key, reward, amount } of split[kind]) {
          const row = totalTemplates.get(key)?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
          if (!row) continue;
          const value = row.querySelector<HTMLElement>('dd');
          const label = rewardDisplay(reward).label;
          if (kind === 'currency') {
            const formatted = amount.toLocaleString('en-US');
            const amountNode = row.querySelector<HTMLElement>('strong');
            if (amountNode) amountNode.textContent = formatted;
            value?.setAttribute('aria-label', `${label} ${formatted}`);
          } else {
            if (amount > 1) {
              const count = document.createElement('span');
              count.className = 'reward-collected-count';
              count.textContent = `×${amount.toLocaleString('en-US')}`;
              value?.append(count);
            }
            value?.setAttribute('aria-label', amount > 1 ? `${label} ×${amount}` : label);
          }
          rows.push(row);
        }
        const section = root.querySelector<HTMLElement>(`[data-reward-summary-kind="${scopeId}-${kind}"]`);
        section?.querySelector<HTMLElement>('[data-reward-totals]')?.replaceChildren(...rows);
        if (section) section.hidden = rows.length === 0;
      }
      const empty = root.querySelector<HTMLElement>(`[data-reward-empty="${scopeId}"]`);
      if (empty) empty.hidden = split.currency.length + split.collectible.length > 0;
    }
  }

  function updateProgress(nextProgress: number): void {
    if (activeModeId === catalog.repeatable?.id) return;
    const mode = currentMode();
    if (mode.kind !== 'threshold') return;
    saved = withModeProgress(saved, mode.id, normalizeRewardProgress(nextProgress));
    persist(); render();
    announce(`${mode.name}進度已更新為 ${nextProgress.toLocaleString('en-US')}。`);
  }

  function setMode(modeId: string, shouldAnnounce = true): void {
    if (!modes.has(modeId) && modeId !== catalog.repeatable?.id) return;
    activeModeId = modeId;
    root.dataset.activeMode = modeId;
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.rewardModeOption === modeId)));
    modePanels.forEach(panel => { panel.hidden = panel.dataset.rewardModePanel !== modeId; });
    taskPanels.forEach(panel => { panel.hidden = true; });
    for (const taskToggle of taskToggles) {
      const taskPanel = taskPanels.find(panel => panel.dataset.rewardTaskPanel === modeId);
      const isOwner = taskToggle.dataset.rewardTaskOwner
        ? taskToggle.dataset.rewardTaskOwner === modeId : modes.has(modeId);
      taskToggle.hidden = !taskPanel || !isOwner;
      taskToggle.setAttribute('aria-expanded', 'false');
      taskToggle.textContent = '查看每日任務與點數';
      if (taskPanel) taskToggle.setAttribute('aria-controls', taskPanel.id);
      else taskToggle.removeAttribute('aria-controls');
    }
    if (select) select.value = modeId;
    render();
    if (shouldAnnounce) announce(`已切換至${modeId === catalog.repeatable?.id ? catalog.repeatable.name : currentMode().name}。`);
  }

  modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.rewardModeOption ?? '')));
  select?.addEventListener('change', () => setMode(select.value));
  taskToggles.forEach(taskToggle => taskToggle.addEventListener('click', () => {
    const taskPanel = taskPanels.find(panel => panel.dataset.rewardTaskPanel === activeModeId);
    if (!taskPanel) return;
    taskPanel.hidden = !taskPanel.hidden;
    const open = !taskPanel.hidden;
    taskToggle.setAttribute('aria-expanded', String(open));
    taskToggle.textContent = open ? '收起每日任務與點數' : '查看每日任務與點數';
  }));
  form?.addEventListener('submit', event => {
    event.preventDefault();
    updateProgress(normalizeRewardProgress(Number(input?.value ?? 0)));
  });
  modePanels.forEach(panel => panel.addEventListener('change', event => {
    if (!(event.target instanceof HTMLInputElement) || panel.dataset.rewardModePanel !== activeModeId) return;
    const mode = currentMode();
    if (mode.kind === 'threshold' && event.target.matches('[data-reward-tier-checkbox]')) {
      updateProgress(progressAfterTierToggle(mode, Number(event.target.value), event.target.checked));
    } else if (mode.kind === 'achievement' && event.target.matches('[data-reward-stage-checkbox]')) {
      const groupId = event.target.closest<HTMLElement>('[data-reward-achievement-group]')?.dataset.rewardAchievementGroup;
      const group = mode.groups.find(candidate => candidate.id === groupId);
      if (!group) return;
      const next = achievementProgressAfterToggle(group, Number(event.target.value), event.target.checked);
      saved = withAchievementProgress(saved, group.id, next);
      persist(); render(); announce(`${group.name}已完成 ${next} 個階段。`);
    }
  }));
  clear?.addEventListener('click', () => {
    if (activeModeId === catalog.repeatable?.id) return;
    saved = withoutModeProgress(saved, activeModeId);
    persist(); render(); announce(`已清除${currentMode().name}進度。`);
  });
  clearAchievements?.addEventListener('click', () => {
    saved = withoutAchievementProgress(saved);
    persist(); render(); announce('已清除成就進度。');
  });
  clearAll?.addEventListener('click', () => {
    if (!clearDialog) return;
    clearDialog.returnValue = '';
    clearDialog.showModal();
  });
  clearDialog?.addEventListener('close', () => {
    if (clearDialog.returnValue === 'clear') {
      saved = emptyRewardProgress();
      persist(); render(); announce('已清除全部獎勵分類的進度。');
    }
    clearAll?.focus();
  });
  setMode(activeModeId, false);
}
