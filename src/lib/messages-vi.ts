/**
 * 介面文字（越南文）。鍵與 `messages-zh.ts` 一一對應（型別守）。
 * 遊戲專有名詞盡量跟越南玩家社群的說法：骰子＝xúc xắc、符文＝rune、核心＝lõi。
 */
import type { Messages } from './messages-zh';

export const vi: Messages = {
  site: {
    description: 'Trang hướng dẫn Random Dice 2 không chính thức do người chơi lập: toàn bộ nút của cây xúc xắc, điều kiện mở khóa và quan hệ tiên quyết.',
  },
  nav: {
    tree: 'Cây xúc xắc',
    dice: 'Bách khoa',
    board: 'Bàn xúc xắc',
    sim: 'Mô phỏng (beta)',
    guide: 'Giới thiệu game',
    guideIndex: 'Tổng quan',
    keywords: 'Thuật ngữ',
    tactic: 'Chiến thuật',
    boss: 'Bách khoa quái vật',
    riftShop: 'Cửa hàng Khe nứt',
    events: 'Sự kiện',
    rewards: 'Phần thưởng',
    about: 'Đóng góp',
    updated: (date: string) => `Cập nhật ${date}`,
    language: 'Ngôn ngữ',
  },
  footer: {
    disclaimer: 'Đây là trang hướng dẫn không chính thức (fan-made) do người chơi lập, không liên kết với 111%.',
    copyright: 'Bản quyền hình ảnh và văn bản trong game thuộc 111 Percent Inc., mã nguồn theo giấy phép MIT.',
    partial: 'Bản tiếng Việt đang được dịch dần; một phần dữ liệu game vẫn hiển thị bằng tiếng Trung.',
  },
  pages: {
    home: {
      title: 'Trang chủ',
      description: 'Trang hướng dẫn Random Dice 2 không chính thức: cây xúc xắc, bách khoa xúc xắc, bàn xúc xắc, trình mô phỏng cây, cùng dữ liệu chiến thuật, quái vật, sự kiện và phần thưởng.',
    },
    tree: { title: 'Cây xúc xắc', heading: 'Cây xúc xắc' },
    dice: {
      title: 'Bách khoa xúc xắc',
      description: (n: number) => `Bách khoa xúc xắc Random Dice 2: hiệu ứng cơ bản, hiệu ứng thức tỉnh 7 chấm và chỉ số của ${n} viên xúc xắc.`,
    },
    board: {
      title: 'Bàn xúc xắc',
      description: 'Công cụ xếp bàn xúc xắc Random Dice 2: chọn xúc xắc kéo vào bàn, xếp được cả chế độ đối kháng lẫn hợp tác.',
    },
    sim: {
      title: 'Mô phỏng cây xúc xắc (beta)',
      heading: 'Mô phỏng cây xúc xắc',
      description: 'Trình mô phỏng cây xúc xắc Random Dice 2: lên kế hoạch thứ tự mở khóa và tính còn cần bao nhiêu vàng và lõi.',
    },
    tactic: {
      title: 'Chiến thuật',
      description: 'Hiệu ứng chiến thuật của Random Dice 2 trong chế độ đối kháng và hợp tác, lọc được theo giai đoạn và chế độ.',
    },
    boss: {
      title: 'Bách khoa quái vật',
      description: 'Bách khoa quái vật Random Dice 2: quái vật và boss của chế độ đối kháng và hợp tác, cùng đặc tính và kỹ năng của từng con.',
    },
    riftShop: {
      title: 'Cửa hàng Khe nứt',
      description: (n: number) => `Cửa hàng Khe nứt của chế độ hợp tác khó trong Random Dice 2: ${n} hiệu ứng khe nứt đổi bằng xu thảo phạt.`,
    },
    events: {
      title: 'Sự kiện',
      description: 'Tổng hợp nội dung các sự kiện giới hạn thời gian của Random Dice 2.',
    },
    event: {
      description: (name: string, summary: string) => `Sự kiện Random Dice 2 “${name}”: ${summary}`,
    },
    rewards: {
      title: 'Phần thưởng',
      description: 'Phần thưởng mốc của các chế độ, sự kiện và thành tựu trong Random Dice 2, cùng tổng tài nguyên nhận được khi lĩnh hết.',
    },
    guide: {
      title: 'Tổng quan',
      description: 'Tổng quan giới thiệu Random Dice 2: thuật ngữ, chiến thuật, bách khoa quái vật, cửa hàng Khe nứt, sự kiện và phần thưởng.',
    },
    keywords: {
      title: 'Thuật ngữ',
      description: (n: number) => `Giải thích ${n} thuật ngữ game được đánh dấu # trong mô tả xúc xắc Random Dice 2, phân loại theo màu nền chính thức.`,
    },
    about: {
      title: 'Đóng góp',
      description: 'Cách báo lỗi dữ liệu của Random Dice 2 wiki, tham gia duy trì dữ liệu và gửi chỉnh sửa.',
    },
    notFound: {
      title: 'Không tìm thấy trang',
      heading: 'Không tìm thấy trang này',
      lede: 'Có thể đường dẫn bị gõ sai, hoặc trang này đã được chuyển đi.',
      openTree: 'Mở cây xúc xắc',
      home: 'Về trang chủ',
    },
  },
  guidePage: {
    heading: 'Tổng quan',
    lede: 'Thuật ngữ, chiến thuật, quái vật, cửa hàng, sự kiện và phần thưởng trong game.',
    cards: {
      keywords: { title: 'Thuật ngữ', intro: 'Các ký hiệu chính thức có dấu # trong mô tả xúc xắc, chia thành bốn nhóm theo mã màu nền chính thức: cơ chế và kích hoạt của xúc xắc, vật triệu hồi và đạn bắn, hiệu ứng trạng thái và tăng/giảm, quái vật và thuật ngữ cơ bản.', count: (n: number) => `${n} mục` },
      tactic: { title: 'Chiến thuật', intro: 'Hiệu ứng chiến thuật trong chế độ đối kháng và hợp tác, lọc được theo giai đoạn và chuyển sang xem phiên bản của chế độ hợp tác.', count: (n: number) => `${n} mục` },
      boss: { title: 'Bách khoa quái vật', intro: 'Quái vật và boss xuất hiện trong chế độ đối kháng và hợp tác, cùng đặc tính và kỹ năng của từng con.', count: (n: number) => `${n} loại` },
      riftShop: { title: 'Cửa hàng Khe nứt', intro: 'Cửa hàng trong trận của chế độ hợp tác khó. Hạ boss và golem SP để nhận xu thảo phạt, dùng đổi hiệu ứng khe nứt.', count: (n: number) => `${n} loại` },
      events: { title: 'Sự kiện', intro: 'Các sự kiện giới hạn thời gian từng diễn ra trong game, liệt kê đầy đủ nội dung từng đợt.', count: (n: number) => `${n} sự kiện` },
      rewards: { title: 'Phần thưởng', intro: 'Phần thưởng mốc của các chế độ, sự kiện và thành tựu, kèm tổng tài nguyên nhận được khi lĩnh hết từng nhóm.', count: (n: number) => `${n} nhóm` },
    },
  },
  home: {
    cards: {
      tree: { title: 'Cây xúc xắc', desc: 'Toàn bộ cây trên một khung vẽ có thể kéo và phóng to; bấm vào nút để xem chuỗi tiên quyết và tổng chi phí mở khóa.' },
      dice: { title: 'Bách khoa xúc xắc', desc: (n: number) => `Hiệu ứng cơ bản, thức tỉnh 7 chấm và chỉ số của ${n} viên xúc xắc, xem hết trong một trang.` },
      board: { title: 'Bàn xúc xắc', desc: 'Đặt xúc xắc lên bàn, xem chỉ số từng ô và hiệu ứng cộng thêm từ bàn.' },
      sim: { title: 'Mô phỏng cây xúc xắc', desc: 'Mở khóa từng nút và chỉnh cấp trên cây, tính xem cả kế hoạch tốn bao nhiêu và bạn còn thiếu bao nhiêu.' },
      events: { title: 'Sự kiện', desc: 'Các sự kiện giới hạn thời gian từng diễn ra trong game, liệt kê đầy đủ nội dung từng đợt.' },
      guide: { title: 'Giới thiệu game', desc: 'Ý nghĩa của các ký hiệu # chính thức trong mô tả xúc xắc.' },
    },
    version: (game: string, updated: string) => `Phiên bản game v${game} (cập nhật ${updated})`,
    repo: 'Mã nguồn trên GitHub',
    changelog: 'Nhật ký cập nhật',
    stamp: (game: string) => `Game v${game}`,
    dataVersion: 'Phiên bản dữ liệu',
    dataVersionNote: (date: string, title: string) => ` (${date} ${title}, đã đối chiếu bảng dữ liệu)`,
    older: (n: number) => `Còn ${n} cập nhật cũ hơn.`,
    visitorBefore: 'Bạn là người truy cập thứ ',
    visitorAfter: '',
  },
};
