/* 记账本的核心计算:现金、总资产、信用卡还没扣的款。
   全部是纯函数:数据通过参数传入(Ledger = 记账 D + 资产设置 A),不读全局变量,所以可以直接写测试。 */

export type Id = number | string;

export interface Tx {
  id: Id;
  amt: number;
  method: string;
  date: string; // YYYY-MM-DD
  bm?: string; // 账单所属月份(利用日在上月、晚入账进下月账单的)
  ref?: string;
  [k: string]: unknown;
}
export interface Snap { val: number; upd: string }
export interface Wallet extends Snap { ex?: Id[] }
export interface Bill { val: number; pay?: string }
export interface Assets {
  cash: number;
  start: string;
  inc: Tx[];
  assets: { name: string; val: number }[];
  cashSS?: Snap | null; // ゆうちょ 截图
  cashPP?: Snap | null; // PayPay 余额截图
  cashW?: Wallet | null; // 钱包现金
  bills?: Record<string, Bill>;
  [k: string]: unknown;
}
export interface Ledger { D: Tx[]; A: Assets }

export interface CardItem {
  nm: string;
  v: number;
  m?: string;
  mth?: string;
  df?: number;
  bill?: number | null;
  lbl: string;
  sub: string;
  bad?: boolean;
}

export const sum = (a: { amt: number }[]): number => a.reduce((s, x) => s + x.amt, 0);

const pad = (n: number): string => String(n).padStart(2, '0');
export const prevM = (m: string): string => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
};

/* 每月 27 日从ゆうちょ扣上个月的信用卡,所以 27 日之前截的图要减去上个月的信用卡消费 */
export const CARD_DAY = 27;
export const isCredit = (m: string): boolean => m !== 'paypay' && m !== 'cash';
export const CARDS: [string, string, string][] = [['card', 'ppc', 'PayPay卡'], ['rakuten', 'rkc', '乐天卡']];
export const bmOf = (x: Tx): string => x.bm || x.date.slice(0, 7);

export const stockOf = ({ A }: Ledger): number => A.assets.reduce((s, x) => s + x.val, 0);

export const flowOf = ({ D, A }: Ledger) => ({
  i: sum(A.inc.filter((x) => x.date >= A.start)),
  o: sum(D.filter((x) => x.date >= A.start)),
});

/* 截图当天还没从银行扣走的信用卡账单。
   每张卡:扣的是按记账算出的上个月刷卡合计;截过账单页的话,旁边列出实际账单做对照,不一致就标红。
   yen 由调用方传入(显示格式取决于界面设置) */
export function unpaidCardOf({ D, A }: Ledger, d: string | null | undefined, yen: (n: number) => string): { items: CardItem[]; v: number } {
  const items: CardItem[] = [];
  if (!d) return { items, v: 0 };
  const B = A.bills || {}, pm = prevM(d.slice(0, 7));
  if (+d.slice(8) < CARD_DAY)
    CARDS.forEach(([mth, key, nm]) => {
      const v = sum(D.filter((x) => bmOf(x) === pm && x.method === mth)), b = B[key];
      const bill = b && b.pay && b.pay.slice(0, 7) === d.slice(0, 7) ? b : null;
      if (!v && !bill) return;
      const df = bill ? v - bill.val : 0;
      items.push({
        nm, v, m: pm, mth, df, bill: bill ? bill.val : null,
        lbl: nm + ' ' + +pm.slice(5) + '月消费',
        sub: bill ? '账单 ' + yen(bill.val) + (df ? ' · 差 ' + (df > 0 ? '+' : '−') + yen(Math.abs(df)) : ' · 一致') : '本月' + CARD_DAY + '日扣款',
        bad: !!(bill && df),
      });
    });
  if (+d.slice(8) < CARD_DAY) {
    const v = sum(D.filter((x) => x.date.startsWith(pm) && isCredit(x.method) && !CARDS.some((c) => c[0] === x.method)));
    if (v) items.push({ nm: '其他卡', v, m: pm, lbl: '其他信用卡 ' + +pm.slice(5) + '月消费', sub: '本月' + CARD_DAY + '日扣款' });
  }
  /* 截图时已刷、还没扣的本月信用卡 + 截图之后刷的信用卡:都还没从ゆうちょ扣走,要从现金里减掉 */
  {
    const cm = d.slice(0, 7);
    const v = sum(D.filter((x) => isCredit(x.method) && (x.date > d || (bmOf(x) === cm && x.date <= d))));
    if (v) items.push({ nm: '本月信用卡', v, lbl: '本月信用卡消费(还没扣款)', sub: '下月' + CARD_DAY + '日起扣款' });
  }
  return { items, v: items.reduce((a, x) => a + x.v, 0) };
}

/* 现金 = ゆうちょ(减去还没扣的上月信用卡)+ PayPay残高 + 钱包现金;
   两者都没截过图时才按「起算余额 + 收入 − 支出」推算 */
export const cashSSmOf = ({ A }: Ledger): boolean => !!(A.cashSS || A.cashPP);

/* 截图之后记的现金 / PayPay余额消费也要算进来(信用卡部分已在 unpaidCard 里) */
export const afterSSOf = ({ D }: Ledger, d: string | null | undefined, ms: string[]): number =>
  d ? sum(D.filter((x) => x.date > d && ms.includes(x.method))) : 0;

/* 钱包现金:手动填一次实际金额,之后用「现金」支付的消费自动减(设了它,「现金」就不再从ゆうちょ里扣) */
export const walletNowOf = ({ D, A }: Ledger): number => {
  const w = A.cashW;
  if (!w) return 0;
  return w.val - sum(D.filter((x) => x.method === 'cash' && (x.date > w.upd || (x.date === w.upd && !(w.ex || []).includes(x.id)))));
};

export const ppMOf = ({ A }: Ledger): string[] => (A.cashSS || A.cashW ? ['paypay'] : ['paypay', 'cash']);

export const cashNowOf = (L: Ledger, yen: (n: number) => string = String): number => {
  const { A } = L;
  if (cashSSmOf(L)) {
    const s = A.cashSS ? A.cashSS.upd : null, p = A.cashPP ? A.cashPP.upd : null;
    return (
      (A.cashSS
        ? A.cashSS.val - unpaidCardOf(L, s, yen).v - (A.cashW ? 0 : afterSSOf(L, s, ['cash'])) + sum(A.inc.filter((x) => x.date > (s as string)))
        : 0) +
      (A.cashPP ? A.cashPP.val - afterSSOf(L, p, ppMOf(L)) : 0) +
      walletNowOf(L)
    );
  }
  const f = flowOf(L);
  return A.cash + f.i - f.o;
};

export const totalOf = (L: Ledger, yen?: (n: number) => string): number => stockOf(L) + cashNowOf(L, yen);
