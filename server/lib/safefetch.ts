/**
 * 对外请求（模型服务商）专用的 fetch：禁止访问内网与本机地址，防止有人把“接口地址”
 * 填成 127.0.0.1、云服务器元数据地址等，借服务器去探测内网（SSRF）。
 *
 * - 在建立连接时检查 DNS 解析出的每一个 IP，避免“先解析公网、再解析内网”的绕过；
 * - 不跟随跳转（跳转目标同样可能是内网）；
 * - 自部署场景（同机 Ollama）可以设置 ALLOW_PRIVATE_MODEL_HOSTS=true 放开。
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { FetchInit, FetchLike } from '@/ai/providers';
import { config } from '../config.ts';

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return blocked.check(address, 'ipv6');
  return true;
}

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`出于安全考虑，不允许连接内网或本机地址（${host}）`);
  }
}

const agent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { all: true, family: (options as { family?: number }).family ?? 0 }, (err, addresses: LookupAddress[]) => {
        if (err) return callback(err, '', 0);
        if (!config.allowPrivateModelHosts) {
          const bad = addresses.find((a) => isPrivateAddress(a.address));
          if (bad) return callback(new BlockedAddressError(hostname), '', 0);
        }
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
        const first = addresses[0];
        callback(null, first.address, first.family);
      });
    },
  },
  headersTimeout: 120_000,
  bodyTimeout: 300_000,
});

export const safeFetch: FetchLike = async (url: string, init: FetchInit) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('只允许 http / https 地址');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // IP 字面量不会经过 DNS 解析，需要单独检查
  if (isIP(host) && !config.allowPrivateModelHosts && isPrivateAddress(host)) throw new BlockedAddressError(host);
  if (!config.allowPrivateModelHosts && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new BlockedAddressError(host);
  const res = await undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    redirect: 'manual',
    dispatcher: agent,
  });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new Error(`接口地址发生了跳转（${res.status}），请填写跳转后的实际地址`);
  }
  return res as unknown as Response;
};
