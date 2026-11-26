import { describe, it, expect } from 'vitest';
import { dd, mkey, nkey, matchManual, stmtLast, stmtOf, dedupAutoIds, incDup, dupCharges, type Entry } from '../src/core/dedupe';

let seq = 0;
const e = (o: Partial<Entry> & { amt: number; method: string; date: string }): Entry => ({ id: ++seq, ...o });

describe('小工具', () => {
  it('dd:两个日期相差几天,可以跨月', () => {
    expect(dd('2026-11-05', '2026-11-05')).toBe(0);
    expect(dd('2026-11-06', '2026-11-05')).toBe(1);
    expect(dd('2026-12-01', '2026-11-30')).toBe(1);
  });
  it('mkey:全角转半角、大写、压缩空格', () => {
    expect(mkey('ＡＰＰＬＥ.COM')).toBe('APPLE.COM');
    expect(mkey('  netflix   inc ')).toBe('NETFLIX INC');
    expect(mkey(undefined)).toBe('');
  });
  it('nkey:去掉所有空白、转小写', () => {
    expect(nkey('Taro  Yamada ')).toBe('taroyamada');
  });
});

describe('matchManual:导入明细时找手动记的同一笔', () => {
  const manual = e({ amt: 500, method: 'rakuten', date: '2026-11-05', note: 'スタバ' });
  const D = [manual];
  const none = new Set<number | string>();

  it('同金额、同日、同支付方式 → 直接认定', () => {
    expect(matchManual(D, '2026-11-05', 500, 'rakuten', none)).toEqual({ auto: manual });
  });
  it('同日但支付方式不同 → 让用户确认', () => {
    expect(matchManual(D, '2026-11-05', 500, 'card', none)).toEqual({ ask: manual });
  });
  it('支付方式相同、相差 1 天 → 让用户确认;相差 2 天 → 不算', () => {
    expect(matchManual(D, '2026-11-06', 500, 'rakuten', none)).toEqual({ ask: manual });
    expect(matchManual(D, '2026-11-07', 500, 'rakuten', none)).toBeNull();
  });
  it('金额不同 → 不算', () => {
    expect(matchManual(D, '2026-11-05', 501, 'rakuten', none)).toBeNull();
  });
  it('已经被别的明细认领过的不能再认领', () => {
    expect(matchManual(D, '2026-11-05', 500, 'rakuten', new Set([manual.id]))).toBeNull();
  });
  it('已经是明细导入的、或定期记账生成的,不当作手动记的', () => {
    expect(matchManual([e({ amt: 500, method: 'rakuten', date: '2026-11-05', ref: 'rk:1234:x:1' })], '2026-11-05', 500, 'rakuten', none)).toBeNull();
    expect(matchManual([e({ amt: 500, method: 'rakuten', date: '2026-11-05', rid: 3 })], '2026-11-05', 500, 'rakuten', none)).toBeNull();
  });
  it('自动记账(Apple Pay / 邮件 / 截图)的可以被明细认领', () => {
    const auto = e({ amt: 500, method: 'rakuten', date: '2026-11-05', ref: 'ap:99' });
    expect(matchManual([auto], '2026-11-05', 500, 'rakuten', none)).toEqual({ auto });
  });
});

describe('stmtLast / dedupAuto:明细已导入到哪天、自动记账去重', () => {
  it('stmtLast 只看真正从明细导入的那种支付方式,不算自动记的和截图记的', () => {
    const D = [
      e({ amt: 1, method: 'card', date: '2026-11-10', ref: 'pp:1' }),
      e({ amt: 1, method: 'card', date: '2026-11-20', ref: 'ap:9' }), // 自动记:不算
      e({ amt: 1, method: 'card', date: '2026-11-25', ref: 'pp:2', via: 'ss' }), // 截图:不算
      e({ amt: 1, method: 'rakuten', date: '2026-11-28', ref: 'rk:1' }), // 别的支付方式
    ];
    expect(stmtLast(D, 'card')).toBe('2026-11-10');
    expect(stmtLast(D, 'cash')).toBe('');
  });

  it('自动记的那笔,明细里已有同一笔(差 ≤1 天)→ 删掉自动记的', () => {
    const auto = e({ amt: 700, method: 'rakuten', date: '2026-11-05', ref: 'ap:1' });
    const imp = e({ amt: 700, method: 'rakuten', date: '2026-11-06', ref: 'rk:1:x:1' });
    expect([...dedupAutoIds([auto, imp])]).toEqual([auto.id]);
  });
  it('一笔明细只能认领一笔自动记账', () => {
    const a1 = e({ amt: 700, method: 'rakuten', date: '2026-11-05', ref: 'ap:1' });
    const a2 = e({ amt: 700, method: 'rakuten', date: '2026-11-05', ref: 'ap:2' });
    const imp = e({ amt: 700, method: 'rakuten', date: '2026-11-05', ref: 'rk:1:x:1' });
    expect(dedupAutoIds([a1, a2, imp]).size).toBe(1);
  });
  it('金额不同或差 2 天以上的不算重复', () => {
    const auto = e({ amt: 700, method: 'rakuten', date: '2026-11-05', ref: 'ap:1' });
    expect(dedupAutoIds([auto, e({ amt: 701, method: 'rakuten', date: '2026-11-05', ref: 'rk:1' })]).size).toBe(0);
    expect(dedupAutoIds([auto, e({ amt: 700, method: 'rakuten', date: '2026-11-08', ref: 'rk:2' })]).size).toBe(0);
  });
  it('stmtOf:找得到同一笔明细', () => {
    const imp = e({ amt: 700, method: 'rakuten', date: '2026-11-05', ref: 'rk:1' });
    expect(stmtOf([imp], 700, '2026-11-06', 'rakuten', new Set())).toBe(imp);
    expect(stmtOf([imp], 700, '2026-11-06', 'card', new Set())).toBeUndefined();
  });
});

describe('incDup:收入查重', () => {
  const inc = [{ amt: 30000, date: '2026-11-25', note: 'Taro Yamada' }];
  it('同一天、同金额、同一个人(忽略空格和大小写)算同一笔', () => {
    expect(incDup(inc, 30000, '2026-11-25', 'taro  yamada')).toBe(inc[0]);
  });
  it('金额、日期或人不同就不是', () => {
    expect(incDup(inc, 30001, '2026-11-25', 'Taro Yamada')).toBeUndefined();
    expect(incDup(inc, 30000, '2026-11-26', 'Taro Yamada')).toBeUndefined();
    expect(incDup(inc, 30000, '2026-11-25', 'Hanako')).toBeUndefined();
  });
});

describe('dupCharges:疑似重复扣款', () => {
  const imp = (amt: number, date: string, note: string, method = 'rakuten', n = 1): Entry =>
    e({ amt, method, date, note, ref: `rk:1234:${date}:${amt}:${note}:${n}` });

  it('订阅服务:同一个月同金额扣了两次 → 一组', () => {
    const g = dupCharges([imp(1200, '2026-11-03', 'APPLE.COM/BILL'), imp(1200, '2026-11-20', 'APPLE.COM/BILL', 'rakuten', 2)], undefined);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ n: 'APPLE.COM/BILL', amt: 1200, mo: '2026-11' });
    expect(g[0].xs).toHaveLength(2);
  });
  it('订阅服务:每个月一次是正常的', () => {
    expect(dupCharges([imp(1200, '2026-10-03', 'Netflix'), imp(1200, '2026-11-03', 'Netflix')], undefined)).toEqual([]);
  });
  it('乐天卡普通消费:同一天同店同金额多次才算', () => {
    expect(dupCharges([imp(980, '2026-11-05', 'ローソン'), imp(980, '2026-11-05', 'ローソン', 'rakuten', 2)], undefined)).toHaveLength(1);
    expect(dupCharges([imp(980, '2026-11-05', 'ローソン'), imp(980, '2026-11-09', 'ローソン')], undefined)).toEqual([]);
  });
  it('手动记的(没有明细导入编号)不参与', () => {
    const a = e({ amt: 980, method: 'rakuten', date: '2026-11-05', note: 'ローソン' });
    const b = e({ amt: 980, method: 'rakuten', date: '2026-11-05', note: 'ローソン' });
    expect(dupCharges([a, b], undefined)).toEqual([]);
  });
  it('用户标记过「正常扣款」的组不再提醒', () => {
    const D = [imp(980, '2026-11-05', 'ローソン'), imp(980, '2026-11-05', 'ローソン', 'rakuten', 2)];
    const k = dupCharges(D, undefined)[0].k;
    expect(dupCharges(D, [k])).toEqual([]);
  });
  it('可以只看某个月;结果按月份新→旧、金额大→小排序', () => {
    const D = [
      imp(500, '2026-10-05', 'A店'), imp(500, '2026-10-05', 'A店', 'rakuten', 2),
      imp(800, '2026-11-05', 'B店'), imp(800, '2026-11-05', 'B店', 'rakuten', 2),
      imp(900, '2026-11-06', 'C店'), imp(900, '2026-11-06', 'C店', 'rakuten', 2),
    ];
    expect(dupCharges(D, undefined).map((g) => g.n)).toEqual(['C店', 'B店', 'A店']);
    expect(dupCharges(D, undefined, '2026-10').map((g) => g.n)).toEqual(['A店']);
  });
});
