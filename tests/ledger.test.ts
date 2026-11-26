import { describe, it, expect } from 'vitest';
import {
  prevM, isCredit, bmOf, flowOf, stockOf, walletNowOf, unpaidCardOf, cashNowOf, totalOf,
  type Tx, type Assets, type Ledger,
} from '../src/core/ledger';

const yen = (n: number) => '¥' + n;
let seq = 0;
const tx = (amt: number, method: string, date: string, extra: Partial<Tx> = {}): Tx => ({ id: ++seq, amt, method, date, ...extra });
const assets = (o: Partial<Assets> = {}): Assets => ({ cash: 0, start: '2026-11-01', inc: [], assets: [], ...o });
const led = (D: Tx[], A: Assets): Ledger => ({ D, A });

describe('日期和分类的小工具', () => {
  it('prevM 能跨年', () => {
    expect(prevM('2026-01')).toBe('2025-12');
    expect(prevM('2026-11')).toBe('2026-10');
  });
  it('现金和 PayPay 余额不是信用卡,其他都是', () => {
    expect(isCredit('cash')).toBe(false);
    expect(isCredit('paypay')).toBe(false);
    expect(isCredit('card')).toBe(true);
    expect(isCredit('rakuten')).toBe(true);
  });
  it('账单月份:有 bm 用 bm,否则用消费日期所在月', () => {
    expect(bmOf(tx(1, 'card', '2026-10-31', { bm: '2026-11' }))).toBe('2026-11');
    expect(bmOf(tx(1, 'card', '2026-10-31'))).toBe('2026-10');
  });
});

describe('钱包现金 walletNow', () => {
  it('没设钱包时是 0', () => {
    expect(walletNowOf(led([tx(500, 'cash', '2026-11-12')], assets()))).toBe(0);
  });
  it('只减「现金」支付、且晚于填写日期的消费;填写当天的只减没被排除的', () => {
    const a = tx(500, 'cash', '2026-11-10'), exd = tx(400, 'cash', '2026-11-10');
    const D = [
      a, exd,
      tx(300, 'cash', '2026-11-12'), // 之后:减
      tx(999, 'cash', '2026-11-09'), // 之前:不减
      tx(700, 'paypay', '2026-11-12'), // 不是现金:不减
    ];
    const A = assets({ cashW: { val: 10000, upd: '2026-11-10', ex: [exd.id] } });
    expect(walletNowOf(led(D, A))).toBe(10000 - 500 - 300);
  });
});

describe('收支和资产', () => {
  it('flow 只统计起算日(含)之后的收入和支出', () => {
    const A = assets({ start: '2026-11-01', inc: [{ id: 'i1', amt: 300000, method: '', date: '2026-11-05' }, { id: 'i2', amt: 9, method: '', date: '2026-10-31' }] });
    const D = [tx(20000, 'cash', '2026-11-02'), tx(5000, 'cash', '2026-10-31')];
    expect(flowOf(led(D, A))).toEqual({ i: 300000, o: 20000 });
  });
  it('投资资产是各项之和', () => {
    expect(stockOf(led([], assets({ assets: [{ name: 'a', val: 100000 }, { name: 'b', val: 50000 }] })))).toBe(150000);
  });
});

describe('还没扣款的信用卡 unpaidCard', () => {
  const D = [
    tx(3000, 'card', '2026-10-03'), tx(2000, 'card', '2026-10-20'),
    tx(1500, 'rakuten', '2026-10-15'),
    tx(800, 'other', '2026-10-10'), // 其他信用卡
    tx(9999, 'paypay', '2026-10-12'), // 不是信用卡
    tx(400, 'card', '2026-11-05'), // 截图当天之前、本月:还没扣
    tx(600, 'card', '2026-11-25'), // 截图之后:还没扣
  ];

  it('没有截图日期时是空', () => {
    expect(unpaidCardOf(led(D, assets()), null, yen)).toEqual({ items: [], v: 0 });
  });

  it('27 日之前:上月各张卡 + 其他卡 + 本月信用卡都要减', () => {
    const r = unpaidCardOf(led(D, assets()), '2026-11-20', yen);
    expect(r.items.map((i) => [i.nm, i.v])).toEqual([['PayPay卡', 5000], ['乐天卡', 1500], ['其他卡', 800], ['本月信用卡', 1000]]);
    expect(r.v).toBe(8300);
    expect(r.items[0].sub).toBe('本月27日扣款');
  });

  it('27 日及以后:上月的已经扣走了,只剩本月的', () => {
    const r = unpaidCardOf(led([...D, tx(100, 'card', '2026-11-28')], assets()), '2026-11-27', yen);
    expect(r.items.map((i) => i.nm)).toEqual(['本月信用卡']);
    expect(r.v).toBe(400 + 600 + 100);
  });

  it('账单金额和记账一致:标「一致」,不标红', () => {
    const A = assets({ bills: { ppc: { val: 5000, pay: '2026-11-27' } } });
    const it0 = unpaidCardOf(led(D, A), '2026-11-20', yen).items[0];
    expect(it0.sub).toBe('账单 ¥5000 · 一致');
    expect(it0.bad).toBe(false);
  });

  it('账单比记账少:提示差额并标红(多记了)', () => {
    const A = assets({ bills: { ppc: { val: 4800, pay: '2026-11-27' } } });
    const it0 = unpaidCardOf(led(D, A), '2026-11-20', yen).items[0];
    expect(it0.df).toBe(200);
    expect(it0.sub).toBe('账单 ¥4800 · 差 +¥200');
    expect(it0.bad).toBe(true);
  });

  it('不是这个月扣款的账单不参与对照', () => {
    const A = assets({ bills: { ppc: { val: 1, pay: '2026-12-27' } } });
    expect(unpaidCardOf(led(D, A), '2026-11-20', yen).items[0].bill).toBeNull();
  });

  it('利用日在上月、晚入账进下月账单的(bm),算在下月', () => {
    const late = tx(700, 'card', '2026-10-31', { bm: '2026-11' });
    const r = unpaidCardOf(led([late], assets()), '2026-11-20', yen);
    expect(r.items.map((i) => i.nm)).toEqual(['本月信用卡']); // 不在上月的 PayPay卡 里
    expect(r.v).toBe(700);
  });
});

describe('现金 cashNow', () => {
  const D = [
    tx(3000, 'card', '2026-10-05'), // 上月信用卡
    tx(400, 'card', '2026-11-05'), // 本月信用卡
    tx(1000, 'cash', '2026-11-22'),
    tx(777, 'paypay', '2026-11-22'),
  ];
  const inc = [
    { id: 'a', amt: 99999, method: '', date: '2026-11-10' }, // 截图之前:不再算
    { id: 'b', amt: 50000, method: '', date: '2026-11-25' }, // 截图之后:算
  ];

  it('没有任何截图:起算余额 + 收入 − 支出', () => {
    const A = assets({ cash: 100000, inc: [{ id: 'i', amt: 300000, method: '', date: '2026-11-05' }] });
    expect(cashNowOf(led([tx(20000, 'cash', '2026-11-02'), tx(5000, 'cash', '2026-10-31')], A), yen)).toBe(380000);
  });

  it('只有ゆうちょ截图:截图余额 − 没扣的信用卡 − 截图后的现金消费 + 截图后的收入', () => {
    const A = assets({ inc, cashSS: { val: 500000, upd: '2026-11-20' } });
    expect(cashNowOf(led(D, A), yen)).toBe(500000 - (3000 + 400) - 1000 + 50000);
  });

  it('再加 PayPay 余额截图:减去截图后的 PayPay 消费', () => {
    const A = assets({ inc, cashSS: { val: 500000, upd: '2026-11-20' }, cashPP: { val: 20000, upd: '2026-11-21' } });
    expect(cashNowOf(led(D, A), yen)).toBe(545600 + 20000 - 777);
  });

  it('设了钱包现金:现金消费改从钱包里减,不再从ゆうちょ减', () => {
    const A = assets({ inc, cashSS: { val: 500000, upd: '2026-11-20' }, cashW: { val: 10000, upd: '2026-11-18' } });
    expect(cashNowOf(led(D, A), yen)).toBe(500000 - 3400 + 50000 + (10000 - 1000));
  });

  it('总资产 = 投资 + 现金', () => {
    const A = assets({ cash: 100000, assets: [{ name: 'x', val: 150000 }] });
    expect(totalOf(led([], A), yen)).toBe(250000);
  });
});
