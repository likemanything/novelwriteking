/**
 * 媒体模型接入与文件服务：
 * - /api/providers：管理员接入图像 / 视频 / 配音服务（声明式适配），分配用途，「试一条」验证；
 * - /api/media/:id：带鉴权地提供已生成的文件（支持 Range，便于拖动播放）；
 * - generateMedia：供短剧画布等服务端任务调用，生成并落盘。
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import type { GenInput, MediaAssetDTO, MediaKind, ProviderInfo, ProviderSpec, ProvidersResponse } from '@/shared/media';
import { config } from './config.ts';
import { withTenant, type Tx } from './db/pool.ts';
import { clientIp, isUuid, readJson, requireOrg, requireOrgRole, type AppEnv, type OrgContext } from './http.ts';
import { keyHint, openSecret, sealSecret } from './lib/crypto.ts';
import { badRequest, HttpError, notFound } from './lib/errors.ts';
import { limit } from './lib/ratelimit.ts';
import { safeFetch } from './lib/safefetch.ts';
import { audit } from './orgs.ts';
import { notifyOrg } from './realtime.ts';
import { MediaError, runGeneration, validateSpec } from './media/engine.ts';

const KINDS: MediaKind[] = ['image', 'video', 'tts'];

interface ProviderRow {
  id: string;
  kind: MediaKind;
  name: string;
  spec: ProviderSpec;
  key_cipher: string | null;
  secret_cipher: string | null;
  key_hint: string;
  created_at: Date;
}

const toInfo = (r: ProviderRow): ProviderInfo => ({ id: r.id, kind: r.kind, name: r.name, spec: r.spec, keyHint: r.key_hint, hasSecret: !!r.secret_cipher, createdAt: r.created_at.toISOString() });

async function load(tx: Tx): Promise<ProvidersResponse> {
  const rows = await tx<ProviderRow[]>`select * from media_providers order by created_at`;
  const assigned: Record<MediaKind, string | null> = { image: null, video: null, tts: null };
  for (const a of await tx<{ kind: MediaKind; provider_id: string | null }[]>`select kind, provider_id from media_assignments`) assigned[a.kind] = a.provider_id;
  return { providers: rows.map(toInfo), assigned };
}

async function getProvider(tx: Tx, id: string): Promise<ProviderRow> {
  if (!isUuid(id)) throw notFound('服务不存在');
  const [r] = await tx<ProviderRow[]>`select * from media_providers where id = ${id}`;
  if (!r) throw notFound('服务不存在');
  return r;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' };

function toAsset(r: { id: string; kind: MediaKind; mime: string; bytes: string | number; created_at: Date }): MediaAssetDTO {
  return { id: r.id, kind: r.kind, mime: r.mime, bytes: Number(r.bytes), createdAt: r.created_at.toISOString() };
}

// ─────────────────────────── 生成并落盘 ───────────────────────────

export async function generateMedia(
  org: OrgContext,
  o: { kind: MediaKind; input: GenInput; providerId?: string; dramaId?: string; nodeId?: string; projectId?: string; signal?: AbortSignal; onStatus?: (s: string) => void },
): Promise<MediaAssetDTO> {
  const prov = await withTenant(org.orgId, async (tx) => {
    const id = o.providerId ?? (await tx<{ provider_id: string | null }[]>`select provider_id from media_assignments where kind = ${o.kind}`)[0]?.provider_id;
    if (!id) throw new HttpError(400, 'no_provider', `还没有接入${o.kind === 'image' ? '图像' : o.kind === 'video' ? '视频' : '配音'}模型：请管理员在「设置 → 图像 / 视频 / 配音模型」里接入并启用`);
    return getProvider(tx, id);
  });
  const started = Date.now();
  let status: 'ok' | 'error' | 'aborted' = 'ok';
  let err: string | null = null;
  try {
    const r = await runGeneration({
      spec: prov.spec,
      key: prov.key_cipher ? openSecret(prov.key_cipher) : '',
      secret: prov.secret_cipher ? openSecret(prov.secret_cipher) : '',
      input: o.input,
      fetch: safeFetch,
      signal: o.signal,
      onStatus: o.onStatus,
    });
    const id = crypto.randomUUID();
    const file = join(org.orgId, `${id}.${EXT[r.mime] ?? 'bin'}`);
    const abs = join(config.storageDir, file);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, r.data);
    const [row] = await withTenant(org.orgId, (tx) => tx<{ id: string; kind: MediaKind; mime: string; bytes: string; created_at: Date }[]>`
      insert into media_assets (id, org_id, drama_id, node_id, kind, mime, bytes, file, meta, created_by)
      values (${id}, ${org.orgId}, ${o.dramaId ?? null}, ${o.nodeId ?? null}, ${o.kind}, ${r.mime}, ${r.data.length}, ${file},
        ${JSON.stringify({ provider: prov.name, source: r.sourceUrl ?? null })}::jsonb, ${org.user.id})
      returning id, kind, mime, bytes, created_at`);
    return toAsset(row);
  } catch (error) {
    status = o.signal?.aborted ? 'aborted' : 'error';
    err = error instanceof Error ? error.message : String(error);
    if (error instanceof MediaError) throw new HttpError(502, 'media_error', error.message);
    throw error;
  } finally {
    await withTenant(org.orgId, (tx) => tx`
      insert into usage_events (org_id, user_id, project_id, stage, credential_id, model, input_tokens, output_tokens, estimated, status, error, duration_ms)
      values (${org.orgId}, ${org.user.id}, ${o.projectId ?? null}, ${'media:' + o.kind}, null, ${prov.spec.model ?? prov.name}, 0, 0, true, ${status}, ${err?.slice(0, 300) ?? null}, ${Date.now() - started})`).catch(() => {});
  }
}

/** 删除一个或一批节点的资产（数据库记录与磁盘文件）。 */
export async function deleteAssets(tx: Tx, where: { nodeId?: string; assetId?: string; dramaId?: string }) {
  const rows = where.assetId
    ? await tx<{ id: string; file: string }[]>`delete from media_assets where id = ${where.assetId} returning id, file`
    : where.dramaId
      ? await tx<{ id: string; file: string }[]>`delete from media_assets where drama_id = ${where.dramaId} returning id, file`
      : await tx<{ id: string; file: string }[]>`delete from media_assets where node_id = ${where.nodeId ?? null} returning id, file`;
  for (const r of rows) await unlink(join(config.storageDir, r.file)).catch(() => {});
}

// ─────────────────────────── 服务管理 ───────────────────────────

export const providerRoutes = new Hono<AppEnv>();

providerRoutes.get('/', async (c) => {
  const org = await requireOrg(c);
  return c.json(await withTenant(org.orgId, load));
});

providerRoutes.post('/', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  const body = await readJson<{ name?: string; spec?: ProviderSpec; apiKey?: string; secretKey?: string }>(c);
  const problem = validateSpec(body.spec);
  if (problem) throw badRequest(problem);
  const spec = body.spec!;
  try {
    // 地址合法性用与模型接入相同的内网拦截：创建时只校验格式，真正请求时由 safeFetch 拦截
    new URL(spec.baseUrl);
  } catch {
    throw badRequest('baseUrl 无效');
  }
  const name = String(body.name ?? '').trim().slice(0, 40) || '未命名';
  const key = String(body.apiKey ?? '').trim();
  const secret = String(body.secretKey ?? '').trim();
  if (key.length > 500 || secret.length > 500) throw badRequest('密钥过长');
  const row = await withTenant(org.orgId, async (tx) => {
    const [r] = await tx<ProviderRow[]>`
      insert into media_providers (org_id, kind, name, spec, key_cipher, secret_cipher, key_hint, created_by)
      values (${org.orgId}, ${spec.kind}, ${name}, ${tx.json(spec as any)}, ${key ? sealSecret(key) : null}, ${secret ? sealSecret(secret) : null}, ${keyHint(key)}, ${org.user.id}) returning *`;
    // 这种用途下第一个接入的服务自动启用
    await tx`insert into media_assignments (org_id, kind, provider_id) values (${org.orgId}, ${spec.kind}, ${r.id}) on conflict (org_id, kind) do update set provider_id = coalesce(media_assignments.provider_id, excluded.provider_id)`;
    await audit(tx, org, org.user.id, 'media.connect', r.id, { kind: spec.kind, name, baseUrl: spec.baseUrl }, clientIp(c));
    return r;
  });
  notifyOrg(org.orgId, { type: 'models' });
  return c.json(toInfo(row));
});

providerRoutes.patch('/:id', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  const body = await readJson<{ name?: string; spec?: ProviderSpec; apiKey?: string; secretKey?: string }>(c);
  const row = await withTenant(org.orgId, async (tx) => {
    const cur = await getProvider(tx, c.req.param('id'));
    let spec = cur.spec;
    if (body.spec !== undefined) {
      const problem = validateSpec(body.spec);
      if (problem) throw badRequest(problem);
      if (body.spec.kind !== cur.kind) throw badRequest('不能更改服务的用途类型，请新建一个');
      spec = body.spec;
    }
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 40) || cur.name : cur.name;
    const keyChanged = body.apiKey !== undefined;
    const secretChanged = body.secretKey !== undefined;
    const key = keyChanged ? String(body.apiKey).trim() : '';
    const secret = secretChanged ? String(body.secretKey).trim() : '';
    const [r] = await tx<ProviderRow[]>`
      update media_providers set name = ${name}, spec = ${tx.json(spec as any)},
        key_cipher = ${keyChanged ? (key ? sealSecret(key) : null) : cur.key_cipher},
        secret_cipher = ${secretChanged ? (secret ? sealSecret(secret) : null) : cur.secret_cipher},
        key_hint = ${keyChanged ? keyHint(key) : cur.key_hint}, updated_at = now()
      where id = ${cur.id} returning *`;
    await audit(tx, org, org.user.id, 'media.update', cur.id, { name, keyChanged, secretChanged }, clientIp(c));
    return r;
  });
  notifyOrg(org.orgId, { type: 'models' });
  return c.json(toInfo(row));
});

providerRoutes.delete('/:id', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  await withTenant(org.orgId, async (tx) => {
    const cur = await getProvider(tx, c.req.param('id'));
    await tx`delete from media_providers where id = ${cur.id}`;
    await audit(tx, org, org.user.id, 'media.delete', cur.id, { name: cur.name }, clientIp(c));
  });
  notifyOrg(org.orgId, { type: 'models' });
  return c.json({ ok: true });
});

providerRoutes.put('/assign', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  const body = await readJson<{ kind?: MediaKind; providerId?: string | null }>(c);
  if (!KINDS.includes(body.kind as MediaKind)) throw badRequest('用途无效');
  await withTenant(org.orgId, async (tx) => {
    let id: string | null = null;
    if (body.providerId) {
      const p = await getProvider(tx, body.providerId);
      if (p.kind !== body.kind) throw badRequest('这个服务不是该用途的');
      id = p.id;
    }
    await tx`insert into media_assignments (org_id, kind, provider_id) values (${org.orgId}, ${body.kind!}, ${id}) on conflict (org_id, kind) do update set provider_id = excluded.provider_id`;
  });
  notifyOrg(org.orgId, { type: 'models' });
  return c.json({ ok: true });
});

const TEST_INPUT: Record<MediaKind, GenInput> = {
  image: { prompt: '一滴墨落在宣纸上，晕开成一座远山，留白，水墨画', ratio: '1:1' },
  video: { prompt: '一滴墨落入清水，缓缓晕开，微距，电影感', ratio: '16:9', duration: 5 },
  tts: { prompt: '你好，欢迎来到墨织。', text: '你好，欢迎来到墨织。', voice: 'default' },
};

providerRoutes.post('/:id/test', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  limit(`media:test:${org.orgId}`, 30, 3600_000, '测试太频繁，请稍后再试');
  const prov = await withTenant(org.orgId, (tx) => getProvider(tx, c.req.param('id')));
  const body = await readJson<{ prompt?: string }>(c).catch(() => ({}) as { prompt?: string });
  const input = { ...TEST_INPUT[prov.kind] };
  if (body.prompt) {
    input.prompt = String(body.prompt).slice(0, 500);
    if (prov.kind === 'tts') input.text = input.prompt;
  }
  const asset = await generateMedia(org, { kind: prov.kind, input, providerId: prov.id, signal: AbortSignal.timeout(15 * 60_000) });
  return c.json({ asset });
});

// ─────────────────────────── 文件服务 ───────────────────────────

export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.get('/:id', async (c) => {
  const org = await requireOrg(c);
  const id = c.req.param('id');
  if (!isUuid(id)) throw notFound();
  const [a] = await withTenant(org.orgId, (tx) => tx<{ file: string; mime: string; bytes: string }[]>`select file, mime, bytes from media_assets where id = ${id}`);
  if (!a) throw notFound('文件不存在');
  const abs = resolve(config.storageDir, a.file);
  if (!abs.startsWith(resolve(config.storageDir)) || !existsSync(abs)) throw notFound('文件已被清理');
  const size = (await stat(abs)).size;
  const range = c.req.header('range')?.match(/^bytes=(\d*)-(\d*)$/);
  const headers: Record<string, string> = { 'content-type': a.mime, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    start = Math.max(0, start);
    return new Response(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream, { status: 206, headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` } });
  }
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { headers: { ...headers, 'content-length': String(size) } });
});
