import { describe, it, expect } from 'vitest';
import { b64e, b64d, deriveKey, encryptDoc, decryptDoc } from '../src/sync/crypto';

const salt = b64e(new Uint8Array(16).fill(7));

describe('base64', () => {
  it('编码后能还原,包括超过 8192 字节的大数据', () => {
    const u = new Uint8Array(20000).map((_, i) => i % 256);
    expect(Array.from(b64d(b64e(u)))).toEqual(Array.from(u));
  });
});

describe('端对端加密', () => {
  it('加密后再解密能还原原文(含中日文)', async () => {
    const key = await deriveKey('正确的密码', salt);
    const doc = { D: [{ id: 1, note: 'セブン 咖啡', amt: 328 }], v: 1 };
    const env = await encryptDoc(doc, key, salt);
    expect(env.enc).toBe(1);
    expect(env.salt).toBe(salt);
    expect(await decryptDoc(env, key)).toEqual(doc);
  });

  it('云端存的内容里看不到明文', async () => {
    const key = await deriveKey('pw', salt);
    const env = await encryptDoc({ note: 'セブン' }, key, salt);
    expect(JSON.stringify(env)).not.toContain('セブン');
  });

  it('密码错误时解密失败,不会返回乱码', async () => {
    const env = await encryptDoc({ a: 1 }, await deriveKey('right', salt), salt);
    await expect(decryptDoc(env, await deriveKey('wrong', salt))).rejects.toBeTruthy();
  });

  it('同一份内容每次加密的结果都不同(随机 iv)', async () => {
    const key = await deriveKey('pw', salt);
    const a = await encryptDoc({ a: 1 }, key, salt), b = await encryptDoc({ a: 1 }, key, salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('内容被篡改时解密失败', async () => {
    const key = await deriveKey('pw', salt);
    const env = await encryptDoc({ a: 1 }, key, salt);
    const bytes = b64d(env.ct); bytes[0] ^= 1;
    await expect(decryptDoc({ iv: env.iv, ct: b64e(bytes) }, key)).rejects.toBeTruthy();
  });
});
