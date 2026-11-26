/* 查重和对账:手动记的账和导入的明细对上、疑似重复扣款、自动记账与明细重复、收入查重。
   全部是纯函数:要看的记账数据通过参数传入。 */
import type { Tx } from './ledger';

export interface Entry extends Tx {
  note?: string;
  rid?: number | string;
  via?: string;
  difok?: boolean;
}
export interface Income { amt: number; date: string; note?: string; ref?: string; [k: string]: unknown }

/* 自动记账(Apple Pay / 邮件 / 截图)的 ref 前缀 */
export const AUTOR = /^(ap|ml|ss):/;

/* 两个日期相差几天 */
export const dd = (a: string, b: string): number => Math.abs((+new Date(a) - +new Date(b)) / 864e5);

/* 店名归一:全角转半角、大写、压缩空格 */
export const mkey = (n: unknown): string => String(n || '').normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();
/* 收入备注归一:去掉所有空白、小写 */
export const nkey = (n: unknown): string => String(n || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/* 导入明细时,找已有的手动 / 自动记的同一笔:
   同日同支付方式 → 直接认定(auto);同日,或同支付方式且相差 ≤1 天 → 让用户确认(ask) */
export function matchManual(
  D: Entry[], date: string, amt: number, method: string, claimed: Set<Tx['id']>,
): { auto: Entry } | { ask: Entry } | null {
  const pool = D.filter((z) => (!z.ref || AUTOR.test(z.ref)) && !z.rid && z.amt === amt && !claimed.has(z.id));
  const ex = pool.find((z) => z.date === date && z.method === method);
  if (ex) return { auto: ex };
  const nr = pool.find((z) => z.date === date) || pool.find((z) => z.method === method && dd(z.date, date) <= 1);
  return nr ? { ask: nr } : null;
}

/* 某支付方式「明细已导入到哪天」:只算真正从明细导入的,不算自动记的;
   截图记的那笔虽然带取引番号,但不算,否则同一天手动记的会被误标为明细里没有 */
export const stmtLast = (D: Entry[], m: string): string =>
  D.reduce((a, z) => (z.ref && !AUTOR.test(z.ref) && z.via !== 'ss' && z.method === m && z.date > a ? z.date : a), '');

/* 自动记的那笔,如果已经有从明细导入的同一笔(同金额、同支付方式、日期差 ≤1 天)→ 以导入的为准 */
export const stmtOf = (D: Entry[], amt: number, date: string, method: string, claimed: Set<Tx['id']>): Entry | undefined =>
  D.find((z) => z.ref && !AUTOR.test(z.ref) && z.amt === amt && z.method === method && dd(z.date, date) <= 1 && !claimed.has(z.id));

/* 应该删掉的自动记账的 id(它们在明细里已经有了) */
export function dedupAutoIds(D: Entry[]): Set<Tx['id']> {
  const claimed = new Set<Tx['id']>(), rm = new Set<Tx['id']>();
  D.filter((x) => x.ref && AUTOR.test(x.ref)).forEach((x) => {
    const z = stmtOf(D, x.amt, x.date, x.method, claimed);
    if (z) { claimed.add(z.id); rm.add(x.id); }
  });
  return rm;
}

/* 收入查重:同一天、同金额、同一个人(备注)就算同一笔 */
export const incDup = (inc: Income[], amt: number, date: string, note: string): Income | undefined => {
  const k = nkey(note);
  return inc.find((x) => x.amt === amt && x.date === date && nkey(x.note) === k);
};

/* ===== 疑似重复扣款:订阅服务 = 同一个月扣了多次;其他乐天卡消费 = 同一天同店同额多次 ===== */
export const SUBRE = /APPLE|ICLOUD|ITUNES|NETFLIX|SPOTIFY|AMAZON|PRIME|GOOGLE|YOUTUBE|DISNEY|HULU|U-NEXT|ADOBE|MICROSOFT|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|DAZN|ABEMA|NINTENDO|PLAYSTATION|DROPBOX|楽天モバイル|DOCOMO|SOFTBANK|AHAMO|POVO/i;

export interface DupGroup { k: string; b: string; n: string; amt: number; mo: string; xs: Entry[] }

/* dupok = 用户标记过「正常扣款」的组;m = 只看某个月(可选) */
export function dupCharges(D: Entry[], dupok: string[] | undefined, m?: string): DupGroup[] {
  const ok = new Set(dupok || []), g: Record<string, DupGroup> = {}, seen: Record<string, Set<string>> = {};
  D.forEach((x) => {
    if (!x.ref || !x.note || !(x.method === 'rakuten' || SUBRE.test(mkey(x.note)))) return;
    const b = mkey(x.note) + '|' + x.amt;
    (seen[b] = seen[b] || new Set()).add(x.date.slice(0, 7));
    if (m && !x.date.startsWith(m)) return;
    const k = b + '|' + (SUBRE.test(mkey(x.note)) ? x.date.slice(0, 7) : x.date);
    (g[k] = g[k] || { k, b, n: x.note, amt: x.amt, mo: x.date.slice(0, 7), xs: [] }).xs.push(x);
  });
  return Object.values(g).filter((o) => o.xs.length >= 2 && !ok.has(o.k)).sort((p, q) => q.mo.localeCompare(p.mo) || q.amt - p.amt);
}
