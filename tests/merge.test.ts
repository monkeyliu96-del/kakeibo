import { describe, it, expect } from 'vitest';
import { mergeDoc, mergeArr, keyD, docN, type Doc } from '../src/sync/merge';

const doc = (o: Partial<Doc> = {}): Doc => ({ v: 1, D: [], R: [], A: { inc: [], assets: [], snaps: [] }, UI: {}, ...o });
const ids = (d: Doc) => d.D.map((x) => x.id).sort();

describe('keyD:一条账的身份', () => {
  it('导入的账用导入编号,换设备也认得是同一条', () => {
    expect(keyD({ id: 1, ref: 'abc' })).toBe(keyD({ id: 99, ref: 'abc' }));
  });
  it('定期记账用「规则 + 日期」', () => {
    expect(keyD({ id: 1, rid: 7, date: '2026-11-01' })).toBe('r:7@2026-11-01');
  });
  it('普通账用自己的 id', () => {
    expect(keyD({ id: 5 })).toBe('i:5');
  });
});

describe('mergeDoc:三方合并', () => {
  it('云端没有数据时,原样返回本机', () => {
    const l = doc({ D: [{ id: 1, amt: 100 }] });
    expect(mergeDoc(l, null)).toBe(l);
  });

  it('两台设备离线时各记一笔,合并后两笔都在', () => {
    const base = doc({ D: [{ id: 1, amt: 100 }] });
    const phone = doc({ D: [{ id: 1, amt: 100 }, { id: 2, amt: 200 }] });
    const pc = doc({ D: [{ id: 1, amt: 100 }, { id: 3, amt: 300 }] });
    expect(ids(mergeDoc(phone, pc, base))).toEqual([1, 2, 3]);
  });

  it('本机删除一笔、云端没改过它:删除生效', () => {
    const base = doc({ D: [{ id: 1, amt: 100 }, { id: 2, amt: 200 }] });
    const local = doc({ D: [{ id: 1, amt: 100 }] });
    const remote = doc({ D: [{ id: 1, amt: 100 }, { id: 2, amt: 200 }] });
    expect(ids(mergeDoc(local, remote, base))).toEqual([1]);
  });

  it('云端删除一笔、但本机改过它:保留改过的,不丢数据', () => {
    const base = doc({ D: [{ id: 1, amt: 100 }, { id: 2, amt: 200 }] });
    const local = doc({ D: [{ id: 1, amt: 100 }, { id: 2, amt: 250 }] });
    const remote = doc({ D: [{ id: 1, amt: 100 }] });
    const m = mergeDoc(local, remote, base);
    expect(m.D.find((x) => x.id === 2)?.amt).toBe(250);
  });

  it('两边都改了同一笔:以本机为准', () => {
    const base = doc({ D: [{ id: 1, amt: 100 }] });
    const local = doc({ D: [{ id: 1, amt: 111 }] });
    const remote = doc({ D: [{ id: 1, amt: 222 }] });
    expect(mergeDoc(local, remote, base).D[0].amt).toBe(111);
  });

  it('只有云端改了一笔:采用云端的', () => {
    const base = doc({ D: [{ id: 1, amt: 100 }] });
    const remote = doc({ D: [{ id: 1, amt: 222 }] });
    expect(mergeDoc(doc({ D: [{ id: 1, amt: 100 }] }), remote, base).D[0].amt).toBe(222);
  });

  it('首次同步(没有基准):两边的账取并集,不丢', () => {
    const local = doc({ D: [{ id: 1 }, { id: 2 }] });
    const remote = doc({ D: [{ id: 2 }, { id: 3 }] });
    expect(ids(mergeDoc(local, remote, null))).toEqual([1, 2, 3]);
  });

  it('同一个导入编号的账,在两边只会留一条', () => {
    const local = doc({ D: [{ id: 1, ref: 'PP-1', amt: 500 }] });
    const remote = doc({ D: [{ id: 9, ref: 'PP-1', amt: 500 }] });
    expect(mergeDoc(local, remote, null).D).toHaveLength(1);
  });

  it('资产快照按日期合并', () => {
    const l = doc({ A: { inc: [], assets: [], snaps: [{ date: '2026-11-01', v: 1 }] } });
    const r = doc({ A: { inc: [], assets: [], snaps: [{ date: '2026-11-02', v: 2 }] } });
    expect((mergeDoc(l, r, null).A.snaps as unknown[]).length).toBe(2);
  });

  describe('设置项', () => {
    it('有基准:本机改过的设置保留,没改过的跟随云端', () => {
      const base = doc({ UI: { theme: 'auto', accent: 'orange' } });
      const local = doc({ UI: { theme: 'dark', accent: 'orange' } });
      const remote = doc({ UI: { theme: 'auto', accent: 'blue' } });
      const m = mergeDoc(local, remote, base);
      expect(m.UI).toEqual({ theme: 'dark', accent: 'blue' });
    });
    it('首次同步:记录更多的一方的设置优先', () => {
      const local = doc({ D: [{ id: 1 }, { id: 2 }], UI: { theme: 'dark' } });
      const remote = doc({ D: [{ id: 3 }], UI: { theme: 'light' } });
      expect(mergeDoc(local, remote, null).UI).toEqual({ theme: 'dark' });
    });
    it('首次同步:只有一方有的设置项也保留(比如另一台设备设的头像)', () => {
      const local = doc({ D: [{ id: 1 }, { id: 2 }], UI: {} });
      const remote = doc({ D: [{ id: 3 }], UI: { avatar: 'x' } });
      expect(mergeDoc(local, remote, null).UI).toEqual({ avatar: 'x' });
    });
    it('预算在本机改过时保留本机的', () => {
      const base = doc({ B: { total: 200000 } });
      const m = mergeDoc(doc({ B: { total: 180000 } }), doc({ B: { total: 200000 } }), base);
      expect(m.B).toEqual({ total: 180000 });
    });
  });

  it('合并不会修改传入的数据', () => {
    const l = doc({ D: [{ id: 1, amt: 1 }] }), r = doc({ D: [{ id: 2, amt: 2 }] });
    const ls = JSON.stringify(l), rs = JSON.stringify(r);
    mergeDoc(l, r, null);
    expect(JSON.stringify(l)).toBe(ls);
    expect(JSON.stringify(r)).toBe(rs);
  });

  it('三份内容完全一样时,合并结果不变(重复同步是安全的)', () => {
    const d = doc({ D: [{ id: 1, amt: 100 }, { id: 2, ref: 'a', amt: 5 }], UI: { theme: 'dark' }, B: { total: 1 } });
    const same = () => JSON.parse(JSON.stringify(d)) as Doc;
    expect(mergeDoc(same(), same(), same())).toEqual(d);
  });
});

describe('mergeArr / docN', () => {
  it('忽略空值', () => {
    expect(mergeArr([null as never, { id: 1 }], [], null, (x: { id: number }) => 'i:' + x.id)).toHaveLength(1);
  });
  it('docN 统计记录总数', () => {
    expect(docN(doc({ D: [{ id: 1 }], A: { inc: [1, 2], assets: [1], snaps: [] } }))).toBe(4);
  });
});
