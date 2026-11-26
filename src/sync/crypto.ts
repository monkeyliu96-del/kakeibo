/* 端对端加密:云端只存密文,解密钥匙只在用户自己的设备上。
   加密密码 → PBKDF2(SHA-256, 31 万次) → AES-GCM 256 */

export const b64e = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192) as unknown as number[]);
  return btoa(s);
};
export const b64d = (t: string): Uint8Array => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

export interface Envelope { enc: 1; salt: string; iv: string; ct: string }

export async function deriveKey(pw: string, salt: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64d(salt) as BufferSource, iterations: 310000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptDoc(o: unknown, key: CryptoKey, salt: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(o)));
  return { enc: 1, salt, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
}

export async function decryptDoc(e: { iv: string; ct: string }, key: CryptoKey): Promise<unknown> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(e.iv) as BufferSource }, key, b64d(e.ct) as BufferSource);
  return JSON.parse(new TextDecoder().decode(pt));
}
