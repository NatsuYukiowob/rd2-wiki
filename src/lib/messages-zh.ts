/**
 * 介面文字（正體中文，預設語言）。這份同時是型別的來源：`messages-vi.ts` 必須逐鍵對上，
 * 漏一個鍵 typecheck 就紅。
 *
 * 帶數字的句子寫成函式，不要用字串拼接——各語言的語序不同。
 */
export const zh = {
  site: {
    description: 'Random Dice 2 骰子樹非官方玩家攻略站：收錄全部節點、解鎖條件與前置關係。',
  },
  nav: {
    tree: '骰子樹',
    dice: '圖鑑',
    board: '骰盤',
    sim: '骰子樹-模擬器(beta)',
    guide: '遊戲介紹',
    guideIndex: '總覽',
    keywords: '遊戲名詞',
    tactic: '戰術',
    boss: '怪物圖鑑',
    riftShop: '裂縫商店',
    events: '活動',
    rewards: '獎勵系統',
    about: '貢獻',
    updated: (date: string) => `上次更新 ${date}`,
    language: '語言',
  },
  footer: {
    disclaimer: '本站為非官方（fan-made）玩家攻略站，與 111% 無隸屬關係。',
    copyright: '遊戲圖示與文字著作權屬 111 Percent Inc.，程式碼採 MIT 授權。',
    /** 非預設語言才印：遊戲資料還沒翻譯。 */
    partial: '',
  },
  pages: {
    home: {
      title: '首頁',
      description: 'Random Dice 2 非官方玩家攻略站：骰子樹、骰子圖鑑、骰盤與骰子樹模擬器，以及戰術、怪物、活動與獎勵資料。',
    },
    tree: { title: '骰子樹', heading: '骰子樹' },
    dice: {
      title: '骰子圖鑑',
      description: (n: number) => `Random Dice 2 骰子圖鑑：${n} 顆骰子的基本效果、7 骰點覺醒效果與數值。`,
    },
    board: {
      title: '骰盤',
      description: 'Random Dice 2 骰盤模擬工具：選擇骰子拖進骰盤，對戰與合作模式都能排。',
    },
    sim: {
      title: '骰子樹-模擬器(beta)',
      heading: '骰子樹模擬器',
      description: 'Random Dice 2 骰子樹模擬器：在骰子樹上規劃解鎖順序，計算還需要多少金幣與核心。',
    },
    tactic: {
      title: '戰術',
      description: 'Random Dice 2 對戰與合作模式的戰術效果，可依階段與模式篩選。',
    },
    boss: {
      title: '怪物圖鑑',
      description: 'Random Dice 2 怪物圖鑑：對戰與合作模式的怪物與首領，以及各自的特性與技能效果。',
    },
    riftShop: {
      title: '裂縫商店',
      description: (n: number) => `Random Dice 2 合作困難模式的裂縫商店：用討伐硬幣兌換的 ${n} 種裂縫效果。`,
    },
    events: {
      title: '活動',
      description: 'Random Dice 2 期間限定活動的內容整理。',
    },
    event: {
      description: (name: string, summary: string) => `Random Dice 2「${name}」：${summary}`,
    },
    rewards: {
      title: '獎勵系統',
      description: 'Random Dice 2 各模式、活動與成就的里程碑獎勵，以及全部領完可拿到的資源總量。',
    },
    guide: {
      title: '總覽',
      description: 'Random Dice 2 遊戲介紹總覽：遊戲名詞、戰術、怪物圖鑑、裂縫商店、活動與獎勵。',
    },
    keywords: {
      title: '遊戲名詞',
      description: (n: number) => `Random Dice 2 骰子描述裡 # 標記的遊戲名詞解釋，共 ${n} 條，依官方底色分類。`,
    },
    about: {
      title: '貢獻',
      description: '如何回報 Random Dice 2 wiki 的資料錯誤、參與資料維護與送出修改。',
    },
    notFound: {
      title: '找不到頁面',
      heading: '找不到這一頁',
      lede: '網址可能打錯了，或這一頁已經搬走。',
      openTree: '開啟骰子樹',
      home: '回首頁',
    },
  },
  guidePage: {
    heading: '總覽',
    lede: '遊戲裡的名詞、戰術、怪物、商店、活動與獎勵。',
    cards: {
      keywords: { title: '遊戲名詞', intro: '骰子描述裡帶 # 的正式標記，依官方底色碼分成四類：骰子機制與觸發、召喚物與投射物、狀態效果與增減益、怪物與基本名詞。', count: (n: number) => `${n} 條` },
      tactic: { title: '戰術', intro: '對戰與合作模式中的戰術效果，可依階段篩選，也能切換看合作模式的版本。', count: (n: number) => `${n} 條` },
      boss: { title: '怪物圖鑑', intro: '對戰與合作模式中會出現的怪物與首領，以及各自的特性與技能效果。', count: (n: number) => `${n} 種` },
      riftShop: { title: '裂縫商店', intro: '合作困難模式的局內商店。擊殺首領與 SP 魔像取得討伐硬幣，兌換裂縫效果。', count: (n: number) => `${n} 種` },
      events: { title: '活動', intro: '遊戲裡辦過的期間限定活動，逐場列出完整內容。', count: (n: number) => `${n} 場` },
      rewards: { title: '獎勵系統', intro: '各模式、活動與成就的里程碑獎勵，並列出每個分類全部領完可拿到的資源總量。', count: (n: number) => `${n} 類` },
    },
  },
  home: {
    cards: {
      tree: { title: '骰子樹', desc: '可平移縮放的全樹畫布，點節點看前置鏈與累計解鎖成本。' },
      dice: { title: '骰子圖鑑', desc: (n: number) => `${n} 顆骰子的基本效果、7 骰點覺醒與數值，一頁看完。` },
      board: { title: '骰盤', desc: '把骰子擺上骰盤，看每一格的面板數值與盤面加成。' },
      sim: { title: '骰子樹模擬器', desc: '在骰子樹上逐顆解鎖、調等級，算出整套規劃要花多少、手上還差多少。' },
      events: { title: '活動', desc: '遊戲裡辦過的期間限定活動，逐場列出完整內容。' },
      guide: { title: '遊戲介紹', desc: '骰子描述裡那些帶 # 的官方標記是什麼意思。' },
    },
    version: (game: string, updated: string) => `遊戲版本v${game}（更新於 ${updated}）`,
    repo: '原始碼在 GitHub',
    changelog: '更新日誌',
    stamp: (game: string) => `遊戲 v${game}`,
    dataVersion: '資料版本',
    dataVersionNote: (date: string, title: string) => `（${date} ${title} 對過資料表）`,
    older: (n: number) => `另有 ${n} 筆較早的更新。`,
    visitorBefore: '你是第',
    visitorAfter: '位訪客',
  },
};

export type Messages = typeof zh;
