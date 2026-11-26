/* 三方合并:以上次同步成功时的内容(基准 b)为参照,把本机(l)和云端(r)的改动合在一起。
   两台设备离线各记的账都不会丢;一边删除、另一边没改的记录会被删除;两边都改的以本机为准。 */

export type Rec = { id?: number | string; ref?: string; rid?: number | string; date?: string; [k: string]: unknown };

export interface Doc {
  v?: number;
  D: Rec[];
  R: Rec[];
  A: Record<string, unknown>;
  B?: unknown;
  CC?: unknown;
  PM?: unknown;
  UI?: Record<string, unknown>;
}

export const J = JSON.stringify;

/* 一条账的身份:来自明细导入的用导入编号,定期记账的用「规则+日期」,其余用自己的 id */
export const keyD = (x: Rec): string => (x.ref ? 'f:' + x.ref : x.rid ? 'r:' + x.rid + '@' + x.date : 'i:' + x.id);

export function mergeArr<T extends object>(
  l: T[] | undefined,
  r: T[] | undefined,
  b: T[] | null | undefined,
  kf: (x: T) => string,
): T[] {
  const M = (a: T[] | undefined) => new Map((a || []).filter(Boolean).map((x) => [kf(x), x] as const));
  const L = M(l), R = M(r), B = b ? M(b) : null;
  const out: T[] = [];
  for (const k of new Set([...L.keys(), ...R.keys()])) {
    const lx = L.get(k), rx = R.get(k), bx = B && B.get(k);
    if (lx && rx) { out.push(bx && J(lx) === J(bx) ? rx : lx); continue; }
    const x = (lx || rx) as T;
    if (bx) { if (J(x) !== J(bx)) out.push(x); continue; }
    out.push(x);
  }
  return out;
}

/* 单个设置项:有基准时,本机改过就用本机的,否则用云端的;
   首次同步(没有基准)时,记录更多的一方(lw)优先,只有一方有的设置项也保留 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mergeVal = (l: any, r: any, b: any, hasB: boolean, lw: boolean): any =>
  hasB ? (J(l) !== J(b) ? l : r) : lw ? (l !== undefined ? l : r) : r !== undefined ? r : l;

export const docN = (d: Partial<Doc>): number =>
  (d.D || []).length +
  (((d.A || {}) as Record<string, unknown[]>).inc || []).length +
  (((d.A || {}) as Record<string, unknown[]>).assets || []).length +
  (((d.A || {}) as Record<string, unknown[]>).snaps || []).length;

export function mergeDoc(l: Doc, r: Doc | null | undefined, b?: Doc | null): Doc {
  if (!r) return l;
  const hb = !!b, lw = !hb && docN(l) > docN(r);
  const bb: Partial<Doc> = b || {};
  const o: Doc = JSON.parse(J(r));
  o.D = mergeArr(l.D, r.D, hb ? bb.D : null, keyD);
  o.R = mergeArr(l.R, r.R, hb ? bb.R : null, (x) => 'i:' + x.id);
  (['B', 'CC', 'PM'] as const).forEach((k) => (o[k] = mergeVal(l[k], r[k], bb[k], hb, lw)));
  {
    const lu = l.UI || {}, ru = r.UI || {}, bu = bb.UI || {};
    o.UI = {};
    new Set([...Object.keys(lu), ...Object.keys(ru)]).forEach((k) => {
      const v = mergeVal(lu[k], ru[k], bu[k], hb, lw);
      if (v !== undefined) o.UI![k] = v;
    });
  }
  const la = (l.A || {}) as Record<string, Rec[]>, ra = (r.A || {}) as Record<string, Rec[]>, ba = (bb.A || {}) as Record<string, Rec[]>;
  const oa: Record<string, unknown> = {};
  o.A = oa;
  new Set([...Object.keys(la), ...Object.keys(ra)]).forEach((k) => {
    if (k === 'inc' || k === 'assets') oa[k] = mergeArr(la[k], ra[k], hb ? ba[k] : null, (x) => (x.ref ? 'f:' + x.ref : 'i:' + x.id));
    else if (k === 'snaps') oa[k] = mergeArr(la[k], ra[k], hb ? ba[k] : null, (x) => 'd:' + x.date);
    else oa[k] = mergeVal(la[k], ra[k], ba[k], hb, lw);
  });
  return o;
}
