/**
 * 服务端配置：从环境变量（以及项目根目录的 .env）读取。
 * 生产环境缺少关键密钥时直接拒绝启动，避免带着不安全的默认值上线。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE = resolve(ROOT, process.env.INKLOOM_ENV_FILE ?? '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

function str(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function bool(name: string, fallback = false): boolean {
  const v = str(name);
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const nodeEnv = str('NODE_ENV', 'development');
const production = nodeEnv === 'production';
const publicUrl = str('PUBLIC_URL', 'http://127.0.0.1:5173').replace(/\/+$/, '');

export const config = {
  root: ROOT,
  production,
  host: str('HOST', '127.0.0.1'),
  port: Number(str('PORT', '4318')),
  publicUrl,
  publicOrigin: new URL(publicUrl).origin,
  secureCookies: publicUrl.startsWith('https://'),
  databaseUrl: str('DATABASE_URL', 'postgres://inkloom:inkloom@127.0.0.1:54329/inkloom'),
  sessionSecret: str('SESSION_SECRET'),
  masterKey: str('MASTER_KEY'),
  signupMode: (str('SIGNUP_MODE', 'invite') === 'open' ? 'open' : 'invite') as 'open' | 'invite',
  adminPhones: str('ADMIN_PHONES')
    .split(/[,，\s]+/)
    .filter(Boolean),
  smsProvider: (str('SMS_PROVIDER', 'console') === 'aliyun' ? 'aliyun' : 'console') as 'console' | 'aliyun',
  aliyun: {
    accessKeyId: str('ALIYUN_ACCESS_KEY_ID'),
    accessKeySecret: str('ALIYUN_ACCESS_KEY_SECRET'),
    signName: str('ALIYUN_SMS_SIGN_NAME'),
    templateCode: str('ALIYUN_SMS_TEMPLATE_CODE'),
  },
  allowPrivateModelHosts: bool('ALLOW_PRIVATE_MODEL_HOSTS', false),
  // 部署在 Nginx 等反向代理后面时设为 true，才会信任 X-Forwarded-For 里的客户端 IP
  trustProxy: bool('TRUST_PROXY', false),
  distDir: resolve(ROOT, 'dist'),
  // 生成的图片、视频、音频直接存放在服务器本地磁盘
  storageDir: resolve(ROOT, str('STORAGE_DIR', 'data/media')),
};

export function assertConfig() {
  const problems: string[] = [];
  if (config.sessionSecret.length < 32) problems.push('SESSION_SECRET 需要至少 32 个字符');
  let mk: Buffer | null = null;
  try {
    mk = Buffer.from(config.masterKey, 'base64');
  } catch {
    mk = null;
  }
  if (!mk || mk.length !== 32) problems.push('MASTER_KEY 需要是 32 字节的 base64（openssl rand -base64 32）');
  if (production && config.smsProvider === 'console') problems.push('生产环境不能使用 SMS_PROVIDER=console（验证码会打印在日志里）');
  if (production && !config.secureCookies) console.warn('[警告] PUBLIC_URL 不是 https，登录 Cookie 将不会标记为 Secure');
  if (problems.length) {
    const msg = `配置有误：\n- ${problems.join('\n- ')}\n请检查 .env（开发环境可运行 npm run setup 自动生成）`;
    throw new Error(msg);
  }
}
