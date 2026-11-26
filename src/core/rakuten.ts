/* 乐天卡 e-NAVI 请款明细 PDF 的解析。
   输入:pdf.js 读出来的每页文字块(内容 s、横坐标 x、纵坐标 y);输出:卡号后 4 位和每笔消费。
   不依赖 pdf.js 本身,所以能直接用假数据测试。 */

export interface TextItem { s: string; x: number; y: number }
export interface RkRow { date: string; note: string; amt: number; neg: boolean }

const pad = (n: number): string => String(n).padStart(2, '0');

export function rkParse(pages: TextItem[][]): { card: string; rows: RkRow[] } {
  let card = '';
  const rows: RkRow[] = [];
  pages.forEach((items) => {
    /* 纵坐标相差不到 2.5 的文字块算同一行 */
    const L: { y: number; a: { s: string; x: number }[] }[] = [];
    items.forEach((it) => {
      const s = ((it as { s?: string }).s || '').trim();
      if (!s) return;
      let l = L.find((l) => Math.abs(l.y - it.y) < 2.5);
      if (!l) { l = { y: it.y, a: [] }; L.push(l); }
      l.a.push({ s, x: it.x });
    });
    L.forEach((l) => {
      l.a.sort((p, q) => p.x - q.x);
      const a = l.a;
      const cm = a.map((x) => x.s).join(' ').match(/(\S*カード\S*)\s*[*-]+(\d{4})/);
      if (cm && !card) card = cm[2];
      const dm = a[0].s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (!dm) return;
      const nums = a.filter((x) => /^[-−△▲]?[\d,]+$/.test(x.s));
      if (nums.length < 3) return;
      const shop = a
        .filter((x) => x.x > a[0].x + 20 && x.x < nums[0].x && !/^(本人|家族)|払い$|^リボ|^分割/.test(x.s))
        .map((x) => x.s)
        .join(' ');
      const v = nums[0].s, amt = parseInt(v.replace(/[^\d]/g, ''), 10);
      if (!(amt > 0)) return;
      rows.push({
        date: dm[1] + '-' + pad(+dm[2]) + '-' + pad(+dm[3]),
        note: shop.normalize('NFKC').replace(/利用国[A-Z]{2}$/, '').replace(/\s+/g, ' ').trim(),
        amt,
        neg: /^[-−△▲]/.test(v),
      });
    });
  });
  return { card, rows };
}
