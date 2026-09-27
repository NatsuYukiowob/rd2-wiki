import { describe, it, expect } from 'vitest';
import data from '../../data/tactics.json';
import type { Tactic, TacticMode } from '../../src/lib/types';
import { DEFAULT_TACTIC_MODE, TACTIC_MODES, TACTIC_STAGES, tacticMatches, toggleAllTacticStages } from '../../src/lib/tactics';

const tactics = data as Tactic[];
// RD2資料交接「戰術系統驗證」A5:V80，v1.1.2 已驗證候選池；不從網站 coop 文本反推。
const verifiedPools: Record<TacticMode, string[]> = {
  "versus": [
    "6",
    "7",
    "9",
    "10",
    "11",
    "12",
    "14",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
    "27",
    "28",
    "29",
    "30",
    "31",
    "32",
    "33",
    "34",
    "35",
    "36",
    "37",
    "38",
    "39",
    "40",
    "41",
    "42",
    "43",
    "44",
    "45",
    "46",
    "47",
    "48",
    "49",
    "50",
    "51",
    "52",
    "53",
    "54",
    "55",
    "56",
    "57",
    "62",
    "64",
    "67",
    "68",
    "69",
    "71",
    "127",
    "128"
  ],
  "coopNormal": [
    "7",
    "9",
    "10",
    "11",
    "12",
    "14",
    "18",
    "19",
    "20",
    "25",
    "26",
    "27",
    "28",
    "29",
    "30",
    "31",
    "32",
    "33",
    "34",
    "35",
    "36",
    "37",
    "38",
    "39",
    "41",
    "43",
    "44",
    "45",
    "47",
    "48",
    "49",
    "50",
    "51",
    "53",
    "54",
    "55",
    "57",
    "62",
    "64",
    "67",
    "68",
    "69",
    "71"
  ],
  "coopHard": [
    "1",
    "6",
    "7",
    "9",
    "10",
    "11",
    "12",
    "14",
    "18",
    "19",
    "20",
    "25",
    "26",
    "27",
    "28",
    "29",
    "30",
    "31",
    "32",
    "33",
    "34",
    "36",
    "37",
    "38",
    "39",
    "41",
    "43",
    "44",
    "45",
    "47",
    "48",
    "49",
    "51",
    "53",
    "54",
    "55",
    "57",
    "62",
    "64",
    "67",
    "68",
    "69",
    "71"
  ]
};

describe('v1.1.2 tactics', () => {
  it('預設合作一般，固定三模式與四階段，不含選項', () => {
    expect(DEFAULT_TACTIC_MODE).toBe('coopNormal');
    expect(TACTIC_MODES.map(mode => mode.label)).toEqual(['合作一般', '合作困難', '對戰']);
    expect(TACTIC_STAGES).toEqual(['前期', '中期', '後期', '終盤']);
    expect(tactics).toHaveLength(58);
  });
  it.each(TACTIC_MODES)('$label 的完整 availability 與驗證池一致', ({ key }) => {
    expect(tactics.filter(t => tacticMatches(t, key, TACTIC_STAGES)).map(t => t.id)).toEqual(verifiedPools[key]);
  });
  it('未選任何階段就是零筆，部分全選操作不做逐項反轉', () => {
    expect(tactics.filter(t => tacticMatches(t, 'coopNormal', []))).toEqual([]);
    expect(toggleAllTacticStages(TACTIC_STAGES)).toEqual([]);
    expect(toggleAllTacticStages(['前期', '中期'])).toEqual(TACTIC_STAGES);
    expect(toggleAllTacticStages([])).toEqual(TACTIC_STAGES);
  });
  it('合作文字存在不代表合作可用', () => {
    const sample = { ...tactics.find(t => t.id === '17')!, coop: '合作文本' };
    expect(tacticMatches(sample, 'coopNormal', TACTIC_STAGES)).toBe(false);
    expect(tacticMatches(sample, 'coopHard', TACTIC_STAGES)).toBe(false);
  });
  it('ID 1 / 9 / 35 修正並保留 127 / 128', () => {
    expect(tactics.find(t => t.id === '1')).toMatchObject({ gameId: 'InitialSP', coop: '遊戲開始時，初始SP為500', availability: { versus: false, coopNormal: false, coopHard: true } });
    expect(tactics.find(t => t.id === '9')!.icon).toBe(tactics.find(t => t.id === '40')!.icon);
    expect(tactics.find(t => t.id === '35')).toMatchObject({ gameId: 'FieldDiceCountSPUp', versus: '當骰盤上骰子低於4個以下時，怪物擊殺SP獲得量+75%' });
    for (const id of ['127', '128']) expect(tactics.find(t => t.id === id)).toMatchObject({ stage: '終盤', availability: { versus: true, coopNormal: false, coopHard: false } });
  });
  it('15 個未啟用 ID 不收錄', () => {
    const inactive = ['2','3','4','5','8','13','15','58','59','60','61','63','65','66','70'];
    expect(tactics.filter(t => inactive.includes(t.id))).toEqual([]);
  });
  it('Augment 是 69 的三個子項，不是獨立階段', () => {
    const parent = tactics.find(t => t.id === '69')!;
    expect(parent.stage).toBe('前期');
    expect(parent.options?.map(({ id, name, text, gameId, icon }) => ({ id, name, text, gameId, icon }))).toEqual([
      { id: '69-1', name: '豐饒開始', text: '立即獲得1000 SP。', gameId: 'GainSP1000', icon: '56324e783903' },
      { id: '69-2', name: '炸彈支援', text: '持有2個炸彈骰子開始遊戲。', gameId: 'StartWithBomb2', icon: '1f7343ac9f46' },
      { id: '69-3', name: '獲得骰子', text: '選擇時，獲得1~4骰點隨機骰子。', gameId: 'RandomDiceGain', icon: '0fb0095b19cb' },
    ]);
    expect(tactics.some(t => t.id.includes('-'))).toBe(false);
  });
});
