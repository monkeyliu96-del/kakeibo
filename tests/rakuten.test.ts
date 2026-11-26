import { describe, it, expect } from 'vitest';
import { rkParse, type TextItem } from '../src/core/rakuten';

/* 做一行明细:日期 | 店名 | 本人/支払区分 | 金额 | 支払回数 | 手数料 */
const row = (y: number, date: string, shop: string, amount: string, extra: string[] = ['本人']): TextItem[] => [
  { s: date, x: 10, y },
  { s: shop, x: 60, y },
  ...extra.map((s, i) => ({ s, x: 150 + i * 20, y })),
  { s: amount, x: 300, y },
  { s: '0', x: 350, y },
  { s: '1,234', x: 400, y },
];
const header: TextItem[] = [{ s: '楽天カード', x: 10, y: 800 }, { s: '*1234', x: 80, y: 800 }];

describe('乐天卡明细 PDF 解析', () => {
  it('读出卡号后 4 位和每笔消费(日期补零)', () => {
    const r = rkParse([[...header, ...row(700, '2026/1/5', 'ローソン', '1,280')]]);
    expect(r.card).toBe('1234');
    expect(r.rows).toEqual([{ date: '2026-01-05', note: 'ローソン', amt: 1280, neg: false }]);
  });

  it('店名:全角转半角、去掉「利用国JP」、去掉「本人/家族/〜払い/リボ/分割」这些列', () => {
    const r = rkParse([[...row(700, '2026/11/3', 'ＡＭＡＺＯＮ.CO.JP 利用国JP', '3,000', ['本人', '1回払い', 'リボ', '分割'])]]);
    expect(r.rows[0].note).toBe('AMAZON.CO.JP');
  });

  it('金额前面带负号(退款)→ neg 为 true,金额取绝对值', () => {
    const r = rkParse([[...row(700, '2026/11/3', '楽天市場', '-1,500')]]);
    expect(r.rows[0]).toMatchObject({ amt: 1500, neg: true });
  });

  it('同一行里纵坐标差不到 2.5 的文字块会合并成一行', () => {
    const items = row(700, '2026/11/3', 'ローソン', '500').map((it, i) => ({ ...it, y: it.y + (i % 2) * 2 }));
    expect(rkParse([items]).rows).toHaveLength(1);
  });

  it('不是明细行的(数字不够 3 个、金额为 0、日期格式不对)会被跳过', () => {
    const noNums: TextItem[] = [{ s: '2026/11/3', x: 10, y: 600 }, { s: '合計', x: 60, y: 600 }, { s: '5,000', x: 300, y: 600 }];
    const zero = row(500, '2026/11/4', '店', '0');
    const badDate = row(400, '2026年11月5日', '店', '800');
    expect(rkParse([[...noNums, ...zero, ...badDate]]).rows).toEqual([]);
  });

  it('多页、多行都能读出,卡号只取第一次出现的', () => {
    const p1 = [...header, ...row(700, '2026/11/3', 'A店', '100'), ...row(680, '2026/11/4', 'B店', '200')];
    const p2 = [{ s: '楽天カード', x: 10, y: 800 }, { s: '*9999', x: 80, y: 800 }, ...row(700, '2026/11/5', 'C店', '300')];
    const r = rkParse([p1, p2]);
    expect(r.card).toBe('1234');
    expect(r.rows.map((x) => x.note)).toEqual(['A店', 'B店', 'C店']);
  });

  it('什么都读不出时返回空结果', () => {
    expect(rkParse([[]])).toEqual({ card: '', rows: [] });
  });
});
