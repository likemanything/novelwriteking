/**
 * 加密工具。
 * - 会话令牌、邀请令牌：随机生成，数据库只存 SHA-256 摘要，泄库也拿不到可用的令牌；
 * - 验证码：带服务端密钥的 HMAC 摘要；
 * - 模型密钥：信封加密。每把密钥用独立随机数据密钥（AES-256-GCM）加密，数据密钥再用主密钥加密。
 *   以后换成云厂商的密钥管理服务时，只需要替换“包装/解包数据密钥”这一步。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function hmac(text: string): string {
  return createHmac('sha256', config.sessionSecret).update(text).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function otpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 易读的邀请码：去掉容易看错的字符。 */
export function readableCode(len = 8): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[randomInt(0, alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
  wiv: string;
  wtag: string;
  wkey: string;
}

function masterKey(): Buffer {
  const key = Buffer.from(config.masterKey, 'base64');
  if (key.length !== 32) throw new Error('MASTER_KEY 配置无效');
  return key;
}

function gcmEncrypt(key: Buffer, plain: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}

function gcmDecrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer) {
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export function sealSecret(plain: string): string {
  const dataKey = randomBytes(32);
  const body = gcmEncrypt(dataKey, Buffer.from(plain, 'utf8'));
  const wrapped = gcmEncrypt(masterKey(), dataKey);
  const env: Envelope = {
    v: 1,
    iv: body.iv.toString('base64'),
    tag: body.tag.toString('base64'),
    ct: body.ct.toString('base64'),
    wiv: wrapped.iv.toString('base64'),
    wtag: wrapped.tag.toString('base64'),
    wkey: wrapped.ct.toString('base64'),
  };
  return JSON.stringify(env);
}

export function openSecret(sealed: string): string {
  const env = JSON.parse(sealed) as Envelope;
  const b = (s: string) => Buffer.from(s, 'base64');
  const dataKey = gcmDecrypt(masterKey(), b(env.wiv), b(env.wkey), b(env.wtag));
  return gcmDecrypt(dataKey, b(env.iv), b(env.ct), b(env.tag)).toString('utf8');
}

/** 只显示密钥首尾几位，例如 sk-…a1b2 */
export function keyHint(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
