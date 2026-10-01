/**
 * 短信验证码发送。
 * - console：开发用，验证码打印在服务端日志里（生产环境禁止使用）；
 * - aliyun：阿里云短信服务 SendSms 接口（RPC 风格，HMAC-SHA1 签名）。
 *   需要先在阿里云控制台申请短信签名和验证码模板，模板里的变量名为 code。
 *
 * 注意：阿里云发送逻辑按官方签名规则实现，尚未用真实账号验证，上线前请用测试号码试发。
 */
import { createHmac, randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { maskPhone } from './phone.ts';

export async function sendOtp(phone: string, code: string): Promise<void> {
  if (config.smsProvider === 'console') {
    console.log(`[短信·开发] ${maskPhone(phone)} 的验证码：${code}（5 分钟内有效）`);
    return;
  }
  await sendAliyun(phone.replace(/^\+86/, ''), code);
}

function percentEncode(s: string) {
  return encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~').replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

async function sendAliyun(phone: string, code: string) {
  const a = config.aliyun;
  if (!a.accessKeyId || !a.accessKeySecret || !a.signName || !a.templateCode) {
    throw new Error('阿里云短信未配置完整（ALIYUN_ACCESS_KEY_ID / SECRET / SIGN_NAME / TEMPLATE_CODE）');
  }
  const params: Record<string, string> = {
    AccessKeyId: a.accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: a.signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: a.templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  const signature = createHmac('sha1', `${a.accessKeySecret}&`).update(stringToSign).digest('base64');
  const url = `https://dysmsapi.aliyuncs.com/?Signature=${percentEncode(signature)}&${canonical}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as { Code?: string; Message?: string };
  if (body.Code !== 'OK') throw new Error(`短信发送失败：${body.Message ?? body.Code ?? res.status}`);
}
