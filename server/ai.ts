/**
 * AI 网关：模型接入、环节分工、对话转发、用量与额度。
 *
 * 浏览器不再接触任何模型密钥：密钥加密保存在服务端，每次调用时解密并由服务端发出请求，
 * 同时记录用量、检查团队与个人的月度额度。
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { stream } from 'hono/streaming';
import { DetectError, detectAndConnect } from '@/ai/detect';
import { AIError, callProvider, estimateTokens, testProvider, type ChatMessage, type ProviderProfile } from '@/ai/providers';
import type { CredentialInfo, DetectEvent, GatewayEvent, ModelsResponse, Stage, UsageResponse, UsageRow } from '@/shared/api';
import { atLeast } from '@/shared/permissions';
import { sql, withTenant, type Tx } from './db/pool.ts';
import { clientIp, isUuid, readJson, requireOrg, requireOrgRole, roleInProject, type AppEnv, type OrgContext } from './http.ts';
import { keyHint, openSecret, sealSecret } from './lib/crypto.ts';
import { badRequest, forbidden, HttpError, notFound } from './lib/errors.ts';
import { limit } from './lib/ratelimit.ts';
import { safeFetch } from './lib/safefetch.ts';
import { audit } from './orgs.ts';
import { notifyOrg } from './realtime.ts';

const STAGES: Stage[] = ['plan', 'write', 'review', 'muse'];
const MAX_CONCURRENT_PER_ORG = 8;

interface CredRow {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic';
  base_url: string;
  model: string;
  models: string[];
  protocol_label: string;
  temperature: number;
  max_tokens: number;
  key_cipher: string | null;
  key_hint: string;
  created_at: Date;
}

function toInfo(r: CredRow): CredentialInfo {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    baseUrl: r.base_url,
    model: r.model,
    models: r.models ?? [],
    protocolLabel: r.protocol_label,
    temperature: r.temperature,
    maxTokens: r.max_tokens,
    keyHint: r.key_hint,
    createdAt: r.created_at.toISOString(),
  };
}

function profileOf(r: CredRow): ProviderProfile {
  return {
    provider: r.provider,
    baseUrl: r.base_url,
    apiKey: r.key_cipher ? openSecret(r.key_cipher) : '',
    model: r.model,
    temperature: r.temperature,
    maxTokens: r.max_tokens,
  };
}

async function loadModels(tx: Tx): Promise<ModelsResponse> {
  const creds = await tx<CredRow[]>`select * from credentials order by created_at`;
  const stages = Object.fromEntries(STAGES.map((s) => [s, null])) as Record<Stage, string | null>;
  for (const a of await tx<{ stage: Stage; credential_id: string | null }[]>`select stage, credential_id from stage_assignments`) stages[a.stage] = a.credential_id;
  return { credentials: creds.map(toInfo), stages };
}

async function getCred(tx: Tx, id: string): Promise<CredRow> {
  if (!isUuid(id)) throw notFound('模型不存在');
  const [r] = await tx<CredRow[]>`select * from credentials where id = ${id}`;
  if (!r) throw notFound('模型不存在');
  return r;
}

function monthRange(month?: string) {
  const now = new Date();
  const m = month?.match(/^(\d{4})-(\d{2})$/);
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  // 按北京时间（UTC+8）的自然月统计
  const start = new Date(Date.UTC(y, mo, 1) - 8 * 3600_000);
  const end = new Date(Date.UTC(y, mo + 1, 1) - 8 * 3600_000);
  return { start, end, label: `${y}-${String(mo + 1).padStart(2, '0')}` };
}

export const aiRoutes = new Hono<AppEnv>();

aiRoutes.get('/models', async (c) => {
  const org = await requireOrg(c);
  return c.json(await withTenant(org.orgId, loadModels));
});

/** 自动识别协议并保存（流式返回每一步的进度）。也用于“重新识别”已有的模型。 */
aiRoutes.post('/credentials/detect', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  limit(`detect:${org.orgId}`, 40, 3600_000, '识别次数太多，请一小时后再试');
  const body = await readJson<{ url?: string; key?: string; model?: string; name?: string; credentialId?: string }>(c);
  let existing: CredRow | null = null;
  if (body.credentialId) existing = await withTenant(org.orgId, (tx) => getCred(tx, body.credentialId!));
  const url = String(body.url ?? existing?.base_url ?? '');
  const key = body.key !== undefined ? String(body.key).trim() : existing?.key_cipher ? openSecret(existing.key_cipher) : '';
  if (key.length > 500) throw badRequest('API Key 过长');
  const ip = clientIp(c);

  c.header('content-type', 'application/x-ndjson; charset=utf-8');
  c.header('cache-control', 'no-cache');
  return stream(c, async (s) => {
    const ctrl = new AbortController();
    s.onAbort(() => ctrl.abort());
    const send = (ev: DetectEvent) => s.write(JSON.stringify(ev) + '\n').catch(() => {});
    try {
      const r = await detectAndConnect({
        url,
        key,
        model: body.model,
        fetch: safeFetch,
        signal: ctrl.signal,
        onStep: (step, state, info) => void send({ t: 'step', step, state, info }),
      });
      const saved = await withTenant(org.orgId, async (tx) => {
        const sealed = key ? sealSecret(key) : null;
        let row: CredRow;
        if (existing) {
          [row] = await tx<CredRow[]>`
            update credentials set provider = ${r.provider}, base_url = ${r.baseUrl}, model = ${r.model}, models = ${tx.json(r.models)},
              protocol_label = ${r.protocolLabel}, key_cipher = ${sealed}, key_hint = ${keyHint(key)}, updated_at = now()
            where id = ${existing.id} returning *`;
        } else {
          // 同一地址 + 同一把 Key 不重复添加
          const same = (await tx<CredRow[]>`select * from credentials where base_url = ${r.baseUrl}`).find((x) => (x.key_cipher ? openSecret(x.key_cipher) : '') === key);
          if (same) {
            [row] = await tx<CredRow[]>`
              update credentials set provider = ${r.provider}, model = ${r.model}, models = ${tx.json(r.models)}, protocol_label = ${r.protocolLabel}, updated_at = now()
              where id = ${same.id} returning *`;
          } else {
            const names = new Set((await tx<{ name: string }[]>`select name from credentials`).map((x) => x.name));
            let name = String(body.name ?? '').trim().slice(0, 40) || r.name;
            for (let n = 2; names.has(name); n++) name = `${body.name || r.name} ${n}`;
            [row] = await tx<CredRow[]>`
              insert into credentials (org_id, name, provider, base_url, model, models, protocol_label, key_cipher, key_hint, created_by)
              values (${org.orgId}, ${name}, ${r.provider}, ${r.baseUrl}, ${r.model}, ${tx.json(r.models)}, ${r.protocolLabel}, ${sealed}, ${keyHint(key)}, ${org.user.id})
              returning *`;
            // 第一个接入的模型负责全部环节
            const assigned = await tx<{ n: string }[]>`select count(*) as n from stage_assignments where credential_id is not null`;
            if (Number(assigned[0].n) === 0) {
              for (const st of STAGES) {
                await tx`insert into stage_assignments (org_id, stage, credential_id) values (${org.orgId}, ${st}, ${row.id})
                  on conflict (org_id, stage) do update set credential_id = excluded.credential_id`;
              }
            }
          }
        }
        await audit(tx, org, org.user.id, existing ? 'model.redetect' : 'model.connect', row.id, { baseUrl: r.baseUrl, model: r.model, provider: r.provider }, ip);
        return row;
      });
      notifyOrg(org.orgId, { type: 'models' });
      await send({ t: 'result', credential: toInfo(saved), reply: r.reply, warning: r.warning });
    } catch (error) {
      if (ctrl.signal.aborted) return;
      if (error instanceof DetectError) await send({ t: 'error', message: error.message, code: error.code, step: error.step });
      else {
        console.error('[模型识别]', error);
        await send({ t: 'error', message: error instanceof Error ? error.message : String(error), code: 'unknown', step: 'protocol' });
      }
    }
  });
});

aiRoutes.patch('/credentials/:id', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  const body = await readJson<{ name?: string; model?: string; temperature?: number; maxTokens?: number; apiKey?: string; baseUrl?: string; provider?: 'openai' | 'anthropic' }>(c);
  const row = await withTenant(org.orgId, async (tx) => {
    const cur = await getCred(tx, c.req.param('id'));
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 40) || cur.name : cur.name;
    const model = body.model !== undefined ? String(body.model).trim().slice(0, 200) || cur.model : cur.model;
    const temperature = body.temperature !== undefined ? Math.min(2, Math.max(0, Number(body.temperature) || 0)) : cur.temperature;
    const maxTokens = body.maxTokens !== undefined ? Math.min(200_000, Math.max(256, Math.round(Number(body.maxTokens) || 4096))) : cur.max_tokens;
    const provider = body.provider === 'anthropic' || body.provider === 'openai' ? body.provider : cur.provider;
    let baseUrl = cur.base_url;
    if (body.baseUrl !== undefined) {
      try {
        const u = new URL(String(body.baseUrl).trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
        baseUrl = u.toString().replace(/\/+$/, '');
      } catch {
        throw badRequest('接口地址无效');
      }
    }
    const keyChanged = body.apiKey !== undefined;
    const key = keyChanged ? String(body.apiKey).trim() : '';
    const [r] = await tx<CredRow[]>`
      update credentials set name = ${name}, model = ${model}, temperature = ${temperature}, max_tokens = ${maxTokens}, provider = ${provider},
        protocol_label = ${provider === cur.provider ? cur.protocol_label : provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'},
        base_url = ${baseUrl},
        key_cipher = ${keyChanged ? (key ? sealSecret(key) : null) : cur.key_cipher},
        key_hint = ${keyChanged ? keyHint(key) : cur.key_hint},
        updated_at = now()
      where id = ${cur.id} returning *`;
    await audit(tx, org, org.user.id, 'model.update', cur.id, { name, model, provider, baseUrl, keyChanged }, clientIp(c));
    return r;
  });
  notifyOrg(org.orgId, { type: 'models' });
  return c.json(toInfo(row));
});

aiRoutes.delete('/credentials/:id', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  await withTenant(org.orgId, async (tx) => {
    const cur = await getCred(tx, c.req.param('id'));
    await tx`delete from credentials where id = ${cur.id}`;
    await audit(tx, org, org.user.id, 'model.delete', cur.id, { name: cur.name }, clientIp(c));
  });
  notifyOrg(org.orgId, { type: 'models' });
  return c.json({ ok: true });
});

aiRoutes.post('/credentials/:id/test', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  limit(`test:${org.orgId}`, 60, 3600_000);
  const cred = await withTenant(org.orgId, (tx) => getCred(tx, c.req.param('id')));
  try {
    const reply = await testProvider(profileOf(cred), safeFetch, AbortSignal.timeout(60_000));
    return c.json({ reply });
  } catch (error) {
    throw new HttpError(502, 'model_error', error instanceof Error ? error.message : String(error));
  }
});

aiRoutes.put('/stages', async (c) => {
  const org = await requireOrg(c);
  requireOrgRole(org, 'owner', 'admin');
  const body = await readJson<{ stage?: Stage; credentialId?: string | null }>(c);
  if (!STAGES.includes(body.stage as Stage)) throw badRequest('环节无效');
  await withTenant(org.orgId, async (tx) => {
    const credId = body.credentialId ? (await getCred(tx, body.credentialId)).id : null;
    await tx`insert into stage_assignments (org_id, stage, credential_id) values (${org.orgId}, ${body.stage!}, ${credId})
      on conflict (org_id, stage) do update set credential_id = excluded.credential_id`;
    await audit(tx, org, org.user.id, 'model.stage', body.stage!, { credentialId: credId }, clientIp(c));
  });
  notifyOrg(org.orgId, { type: 'models' });
  return c.json({ ok: true });
});

// ─────────────────────────── 对话转发 ───────────────────────────

const active = new Map<string, number>();

async function checkQuota(tx: Tx, org: OrgContext) {
  const { start } = monthRange();
  const [o] = await tx<{ monthly_token_limit: string | null; member_monthly_token_limit: string | null }[]>`
    select monthly_token_limit, member_monthly_token_limit from orgs where id = ${org.orgId}`;
  if (!o || (o.monthly_token_limit === null && o.member_monthly_token_limit === null)) return;
  const [u] = await tx<{ total: string; mine: string }[]>`
    select coalesce(sum(input_tokens + output_tokens), 0) as total,
           coalesce(sum(case when user_id = ${org.user.id} then input_tokens + output_tokens end), 0) as mine
    from usage_events where created_at >= ${start}`;
  if (o.monthly_token_limit !== null && Number(u.total) >= Number(o.monthly_token_limit)) {
    throw new HttpError(429, 'quota_org', '团队本月的 AI 用量已达上限，请联系管理员调整额度');
  }
  if (o.member_monthly_token_limit !== null && Number(u.mine) >= Number(o.member_monthly_token_limit)) {
    throw new HttpError(429, 'quota_member', '你本月的 AI 用量已达上限，请联系管理员调整额度');
  }
}

aiRoutes.post('/chat', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: () => { throw new HttpError(413, 'too_large', '发送给模型的内容太长'); } }), async (c) => {
  const org = await requireOrg(c);
  const body = await readJson<{ stage?: Stage; system?: string; messages?: ChatMessage[]; temperature?: number; maxTokens?: number; projectId?: string }>(c);
  if (!STAGES.includes(body.stage as Stage)) throw badRequest('环节无效');
  const system = typeof body.system === 'string' ? body.system : '';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages.length > 100) throw badRequest('对话内容为空或过长');
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') throw badRequest('对话内容格式不正确');
  }
  const totalChars = system.length + messages.reduce((n, m) => n + m.content.length, 0);
  if (totalChars > 1_000_000) throw badRequest('发送给模型的内容太长');

  const role = body.projectId ? roleInProject(org, body.projectId) : org.role === 'guest' ? null : org.role;
  if (!atLeast(role, 'author')) throw forbidden('只读成员不能使用 AI 生成');
  limit(`chat:${org.user.id}`, 120, 60_000, 'AI 请求太频繁，请稍后再试');

  const { cred } = await withTenant(org.orgId, async (tx) => {
    const [a] = await tx<{ credential_id: string | null }[]>`select credential_id from stage_assignments where stage = ${body.stage!}`;
    if (!a?.credential_id) throw new HttpError(400, 'no_model', '这个环节还没有指定模型，请管理员在设置里接入模型');
    await checkQuota(tx, org);
    return { cred: await getCred(tx, a.credential_id) };
  });
  const running = active.get(org.orgId) ?? 0;
  if (running >= MAX_CONCURRENT_PER_ORG) throw new HttpError(429, 'busy', `团队同时进行的 AI 任务已达 ${MAX_CONCURRENT_PER_ORG} 个，请稍后再试`);
  const profile = profileOf(cred);
  const temperature = body.temperature !== undefined ? Math.min(2, Math.max(0, Number(body.temperature) || 0)) : undefined;
  const maxTokens = body.maxTokens !== undefined ? Math.min(200_000, Math.max(16, Math.round(Number(body.maxTokens) || 0))) : undefined;

  active.set(org.orgId, running + 1);
  c.header('content-type', 'application/x-ndjson; charset=utf-8');
  c.header('cache-control', 'no-cache');
  c.header('x-accel-buffering', 'no');
  return stream(c, async (s) => {
    const ctrl = new AbortController();
    s.onAbort(() => ctrl.abort());
    const started = Date.now();
    const send = (ev: GatewayEvent) => s.write(JSON.stringify(ev) + '\n').catch(() => {});
    let partial = '';
    let status: 'ok' | 'error' | 'aborted' = 'ok';
    let errorText: string | null = null;
    let usage = { inputTokens: 0, outputTokens: 0, estimated: true };
    try {
      const r = await callProvider({
        profile,
        system,
        messages,
        fetch: safeFetch,
        signal: ctrl.signal,
        temperature,
        maxTokens,
        onToken: (chunk, full) => {
          partial = full;
          void send({ t: 'd', v: chunk });
        },
      });
      usage = r.usage;
      await send({ t: 'end', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    } catch (error) {
      const inputTokens = estimateTokens(system + messages.map((m) => m.content).join(''));
      usage = { inputTokens, outputTokens: estimateTokens(partial), estimated: true };
      if (ctrl.signal.aborted) status = 'aborted';
      else {
        status = 'error';
        errorText = error instanceof Error ? error.message : String(error);
        await send({ t: 'err', message: errorText, status: error instanceof AIError ? error.status : undefined });
      }
    } finally {
      active.set(org.orgId, Math.max(0, (active.get(org.orgId) ?? 1) - 1));
      await withTenant(org.orgId, (tx) => tx`
        insert into usage_events (org_id, user_id, project_id, stage, credential_id, model, input_tokens, output_tokens, estimated, status, error, duration_ms)
        values (${org.orgId}, ${org.user.id}, ${body.projectId ?? null}, ${body.stage!}, ${cred.id}, ${cred.model}, ${usage.inputTokens}, ${usage.outputTokens},
          ${usage.estimated}, ${status}, ${errorText?.slice(0, 300) ?? null}, ${Date.now() - started})`).catch((e) => console.error('[用量] 记录失败', e));
    }
  });
});

aiRoutes.get('/usage', async (c) => {
  const org = await requireOrg(c);
  const { start, end, label } = monthRange(c.req.query('month'));
  const admin = org.role === 'owner' || org.role === 'admin';
  const data = await withTenant(org.orgId, async (tx) => {
    const rows = await tx<{ user_id: string | null; stage: string; model: string; calls: string; input: string; output: string; errors: string }[]>`
      select user_id, stage, model, count(*) as calls, sum(input_tokens) as input, sum(output_tokens) as output,
             count(*) filter (where status = 'error') as errors
      from usage_events
      where created_at >= ${start} and created_at < ${end} ${admin ? tx`` : tx`and user_id = ${org.user.id}`}
      group by user_id, stage, model order by sum(input_tokens + output_tokens) desc`;
    const [t] = await tx<{ total: string }[]>`select coalesce(sum(input_tokens + output_tokens), 0) as total from usage_events where created_at >= ${start} and created_at < ${end}`;
    return { rows, total: Number(t.total) };
  });
  const ids = [...new Set(data.rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    for (const u of await sql<{ id: string; name: string }[]>`select id, name from users where id = any(${ids})`) names.set(u.id, u.name);
  }
  const [o] = await sql<{ monthly_token_limit: string | null; member_monthly_token_limit: string | null }[]>`select monthly_token_limit, member_monthly_token_limit from orgs where id = ${org.orgId}`;
  const rows: UsageRow[] = data.rows.map((r) => ({
    userId: r.user_id,
    userName: (r.user_id && names.get(r.user_id)) || '已移除的成员',
    stage: r.stage,
    model: r.model,
    calls: Number(r.calls),
    inputTokens: Number(r.input ?? 0),
    outputTokens: Number(r.output ?? 0),
    errors: Number(r.errors),
  }));
  const out: UsageResponse = {
    month: label,
    totalTokens: admin ? data.total : rows.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0),
    limit: o?.monthly_token_limit === null || !o ? null : Number(o.monthly_token_limit),
    memberLimit: o?.member_monthly_token_limit === null || !o ? null : Number(o.member_monthly_token_limit),
    rows,
  };
  return c.json(out);
});
