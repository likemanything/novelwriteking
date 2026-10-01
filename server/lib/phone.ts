/** 手机号：目前只支持中国大陆 11 位手机号，统一存成 +86 开头的格式。 */
import { badRequest } from './errors.ts';

export function normalizePhone(input: unknown): string {
  const raw = String(input ?? '').replace(/[\s-]/g, '');
  const m = raw.match(/^(?:\+?86)?(1[3-9]\d{9})$/);
  if (!m) throw badRequest('请输入正确的 11 位手机号', 'invalid_phone');
  return `+86${m[1]}`;
}

export function maskPhone(phone: string): string {
  const d = phone.replace(/^\+86/, '');
  return d.length === 11 ? `${d.slice(0, 3)}****${d.slice(7)}` : phone;
}
