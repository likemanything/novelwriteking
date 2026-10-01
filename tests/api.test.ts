/**
 * 接口集成测试：在独立的测试库（inkloom_test）上跑真实的 Postgres，覆盖
 * 登录与邀请制、团队与邀请、租户隔离（含行级安全）、角色权限、同步、章节锁、
 * 模型密钥加密、防内网请求、AI 网关与额度。
 *
 * 运行：npm run db:start && npm run test:api
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://inkloom:inkloom@127.0.0.1:54329/inkloom_test';
process.env.PUBLIC_URL = 'http://test.inkloom.local';
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-0123';
process.env.MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SMS_PROVIDER = 'console';
process.env.SIGNUP_MODE = 'invite';
process.env.ADMIN_PHONES = '13900000000';
process.env.ALLOW_PRIVATE_MODEL_HOSTS = 'false';

const { createApp } = await import('../server/app.ts');
const { config } = await import('../server/config.ts');
const { sql, migrate, withTenant } = await import('../server/db/pool.ts');
const { startRealtime } = await import('../server/realtime.ts');
const { safeFetch } = await import('../server/lib/safefetch.ts');

const app = createApp();
const ORIGIN = 'http://test.inkloom.local';
const realLog = console.log;

class Client {
  cookie = '';
  org = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.request(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { origin: ORIGIN } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.org ? { 'x-org-id': this.org } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/inkloom_sid=([^;]*)/);
      if (m) this.cookie = m[1] ? `inkloom_sid=${m[1]}` : '';
    }
    return res;
  }
  async json<T = any>(method: string, path: string, body?: unknown, expect = 200): Promise<T> {
    const res = await this.req(method, path, body);
    const text = await res.text();
    assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${text}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
  codes = new Map<string, string>();
  async login(phone: string, extra: Record<string, string> = {}, expect = 200) {
    const sent = await this.json('POST', '/api/auth/otp', { phone });
    this.codes.set(phone, sent.devCode);
    return this.json('POST', '/api/auth/verify', { phone, code: sent.devCode, ...extra }, expect);
  }
  /** 用上一次收到的验证码重试（需要邀请码时验证码不会被消耗） */
  async retry(phone: string, extra: Record<string, string>, expect = 200) {
    return this.json('POST', '/api/auth/verify', { phone, code: this.codes.get(phone), ...extra }, expect);
  }
}

/** 短剧各步骤的模拟回复：根据系统提示词判断是哪一步，返回结构正确的 JSON。 */
function dramaReply(system: string, user: string): string | null {
  const j = (x: unknown) => JSON.stringify(x);
  if (system.includes('拆解为改编短剧')) {
    return '```json\n' + j({
      logline: '邮差追查一封没有寄出的信', mainPlot: '林澈在雾港发现旧信背后的秘密',
      subplots: [{ name: '灯塔', summary: '灯塔里的女人' }],
      keyEvents: [{ title: '收到旧信', summary: '', chapters: [2], visual: 4 }],
      characters: [{ name: '林澈', role: '主角', look: '二十七岁，灰色风衣', voice: '低沉克制', relations: '' }],
      locations: [{ name: '北岸灯塔', look: '雾中的石塔' }], tone: '冷峻', notes: '',
    }) + '\n```';
  }
  if (system.includes('写分集大纲')) {
    const m = user.match(/第 (\d+) 到第 (\d+) 集/)!;
    const eps = [];
    for (let n = Number(m[1]); n <= Number(m[2]); n++) eps.push({ n: 99, title: `第${n}集`, hook: '开场', conflict: '冲突', twist: '反转', cliffhanger: '悬念', summary: '剧情', sourceChapters: [n % 2 ? 2 : 3], characters: ['林澈'] });
    return j({ episodes: eps });
  }
  if (system.includes('场景化剧本')) {
    return j({ episode: 1, title: '剧本', scenes: [{ n: 1, location: '北岸灯塔', time: '夜', summary: '到达', source: { chapter: 2, quote: '雾最浓的晚上' }, lines: [{ type: 'action', text: '林澈推门' }, { type: 'dialogue', speaker: '林澈', text: '你迟到了？', emotion: '平静' }] }] });
  }
  if (system.includes('分镜导演')) {
    return j({ episode: 1, shots: [{ n: 1, scene: 1, size: '全景', move: '推', seconds: 5, visual: '雾中的灯塔', firstFrame: '灯塔远景' }, { n: 2, scene: 1, size: '特写', move: '固定', seconds: 4, visual: '林澈的脸', dialogue: { speaker: '林澈', text: '你迟到了？', emotion: '平静' }, firstFrame: '特写' }] });
  }
  return null;
}

// 模拟模型服务（OpenAI 兼容）
let mock: Server;
let mockUrl = '';
const REPLY = '雾从海面上漫过来。';
before(async () => {
  console.log = () => {}; // 测试时不打印短信验证码等日志
  await sql`drop schema public cascade`;
  await sql`create schema public`;
  await sql`drop sequence if exists record_seq`;
  await migrate(sql, () => {});
  await startRealtime();
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ok = req.headers.authorization === 'Bearer sk-good-test-key-1234';
      if (!ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'mock-writer' }, { id: 'text-embedding-x' }] }));
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const j = JSON.parse(body);
        const text = dramaReply(j.messages[0].content, j.messages.at(-1).content) ?? (j.messages.at(-1).content.includes('你好') ? '你好' : REPLY);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const ch of text.match(/[\s\S]{1,40}/g) ?? []) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
});

after(async () => {
  console.log = realLog;
  mock?.close();
  await sql.end({ timeout: 2 });
});

const admin = new Client();
const author = new Client();
const outsider = new Client();
const viewer = new Client();
const guest = new Client();
let team = '';
let personalOfOutsider = '';

const project = { id: 'p_1', title: '雾港邮差', logline: '', updatedAt: 1 };
const project2 = { id: 'p_2', title: '另一部', logline: '', updatedAt: 1 };
const chapter = { id: 'ch_1', projectId: 'p_1', index: 1, title: '第一章', status: 'drafting', canonVersionId: null, updatedAt: 1 };
const version = { id: 'v_1', projectId: 'p_1', chapterId: 'ch_1', content: '第一稿', words: 3 };
const character = { id: 'c_1', projectId: 'p_1', name: '林澈' };

test('来源校验：没有 Origin 的写请求被拒绝', async () => {
  const res = await app.request('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '13900000000' }) });
  assert.equal(res.status, 403);
  const res2 = await app.request('/api/auth/otp', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ phone: '13900000000' }) });
  assert.equal(res2.status, 403);
});

test('邀请制：没有邀请码的新号码不能注册；管理员号码可以', async () => {
  const r = await outsider.login('13700000001', {}, 403);
  assert.equal(r.error.code, 'need_invite');
  const me = await admin.login('13900000000');
  assert.equal(me.user.platformAdmin, true);
  assert.equal(me.user.phone, '139****0000');
  assert.equal(me.orgs.length, 1);
  assert.equal(me.orgs[0].kind, 'personal');
  assert.equal(me.orgs[0].role, 'owner');
});

test('验证码：错误次数、重发冷却', async () => {
  const c = new Client();
  await c.json('POST', '/api/auth/otp', { phone: '13700000009' });
  const again = await c.req('POST', '/api/auth/otp', { phone: '13700000009' });
  assert.equal(again.status, 429);
  const wrong = await c.json('POST', '/api/auth/verify', { phone: '13700000009', code: '000000' }, 400);
  assert.equal(wrong.error.code, 'invalid_code');
  const bad = await c.json('POST', '/api/auth/otp', { phone: '12345' }, 400);
  assert.equal(bad.error.code, 'invalid_phone');
});

test('内测邀请码：可以注册一次，用完即失效', async () => {
  const { code } = await admin.json('POST', '/api/admin/signup-codes', { maxUses: 1, note: '测试' });
  const me = await outsider.retry('13700000001', { signupCode: code });
  personalOfOutsider = me.orgs[0].id;
  const other = new Client();
  const r = await other.login('13700000002', { signupCode: code }, 400);
  assert.equal(r.error.code, 'invalid_signup_code');
  // 普通用户不能管理邀请码
  await outsider.json('GET', '/api/admin/signup-codes', undefined, 403);
});

test('团队与邀请链接：按角色加入', async () => {
  const created = await admin.json('POST', '/api/orgs', { name: '雾港工作室' });
  team = created.id;
  admin.org = team;
  const inv = await admin.json('POST', `/api/orgs/${team}/invitations`, { role: 'author', maxUses: 1 });
  const token = inv.url.split('/invite/')[1];
  const preview = await new Client().json('GET', `/api/invitations/${token}`);
  assert.equal(preview.orgName, '雾港工作室');
  assert.equal(preview.valid, true);
  const me = await author.login('13700000003', { invitation: token, name: '王五' });
  const t = me.orgs.find((o: any) => o.id === team);
  assert.equal(t.role, 'author');
  author.org = team;
  // 用过的邀请不能再用
  const again = await new Client().json('GET', `/api/invitations/${token}`);
  assert.equal(again.valid, false);

  const inv2 = await admin.json('POST', `/api/orgs/${team}/invitations`, { role: 'viewer' });
  await viewer.login('13700000004', { invitation: inv2.url.split('/invite/')[1] });
  viewer.org = team;

  const members = await admin.json('GET', `/api/orgs/${team}/members`);
  assert.deepEqual(members.members.map((m: any) => m.role), ['owner', 'author', 'viewer']);
  // 个人空间不能邀请
  const p = await outsider.json('POST', `/api/orgs/${personalOfOutsider}/invitations`, { role: 'author' }, 400);
  assert.equal(p.error.code, 'personal_org');
  // 作者不能邀请
  await author.json('POST', `/api/orgs/${team}/invitations`, { role: 'author' }, 403);
});

test('同步：编辑写入、作者拉取', async () => {
  const r = await admin.json('POST', '/api/sync/push', {
    changes: [
      { table: 'versions', id: version.id, row: version },
      { table: 'chapters', id: chapter.id, row: chapter },
      { table: 'characters', id: character.id, row: character },
      { table: 'projects', id: project.id, row: project },
      { table: 'projects', id: project2.id, row: project2 },
    ],
  });
  assert.ok(r.results.every((x: any) => x.ok), JSON.stringify(r.results));
  const pulled = await author.json('GET', '/api/sync/pull?since=0');
  assert.equal(pulled.changes.length, 5);
  // 父表在前（按服务端分配的顺序）
  assert.equal(pulled.changes[0].table, 'projects');
  assert.ok(pulled.cursor > 0);
  const again = await author.json('GET', `/api/sync/pull?since=${pulled.cursor}`);
  assert.equal(again.changes.length, 0);
});

test('租户隔离：非成员无法访问团队；行级安全兜底', async () => {
  outsider.org = team;
  const r = await outsider.json('GET', '/api/sync/pull?since=0', undefined, 403);
  assert.equal(r.error.code, 'not_member');
  outsider.org = personalOfOutsider;
  const own = await outsider.json('GET', '/api/sync/pull?since=0');
  assert.equal(own.changes.length, 0);
  // 没有设置组织时一行都读不到；设置成别的组织也读不到
  const none = await sql`select count(*)::int as n from records`;
  assert.equal(none[0].n, 0);
  const other = await withTenant(personalOfOutsider, (tx) => tx`select count(*)::int as n from records`);
  assert.equal(other[0].n, 0);
  const mine = await withTenant(team, (tx) => tx`select count(*)::int as n from records`);
  assert.equal(mine[0].n, 5);
  // 行级安全也阻止写入别的组织
  await assert.rejects(withTenant(personalOfOutsider, (tx) => tx`insert into records (org_id, tbl, id, project_id, seq) values (${team}, 'projects', 'x', 'x', 1)`));
});

test('权限：作者能写正文，不能改设定、不能定稿；只读成员什么都不能写', async () => {
  const r = await author.json('POST', '/api/sync/push', {
    changes: [
      { table: 'versions', id: 'v_2', row: { ...version, id: 'v_2', content: '作者的第二稿' } },
      { table: 'characters', id: character.id, row: { ...character, name: '改名' } },
      { table: 'chapters', id: chapter.id, row: { ...chapter, status: 'final', canonVersionId: 'v_2' } },
      { table: 'projects', id: project.id, row: { ...project, title: '作者偷偷改名', updatedAt: 99 } },
      { table: 'projects', id: 'p_new', row: { id: 'p_new', title: '作者新建' } },
    ],
  });
  const by = Object.fromEntries(r.results.map((x: any) => [`${x.table}:${x.id}`, x]));
  assert.equal(by['versions:v_2'].ok, true);
  assert.equal(by['characters:c_1'].ok, false);
  assert.equal(by['characters:c_1'].server.name, '林澈');
  assert.equal(by['chapters:ch_1'].ok, false);
  assert.match(by['chapters:ch_1'].reason, /不能定稿/);
  // 作者保存时只会更新作品的“最近修改时间”，其它字段保持原样
  assert.equal(by['projects:p_1'].ok, true);
  assert.equal(by['projects:p_1'].server.title, '雾港邮差');
  assert.equal(by['projects:p_1'].server.updatedAt, 99);
  assert.equal(by['projects:p_new'].ok, false);

  const v = await viewer.json('POST', '/api/sync/push', { changes: [{ table: 'versions', id: 'v_3', row: { ...version, id: 'v_3' } }] });
  assert.equal(v.results[0].ok, false);
  await viewer.json('POST', '/api/locks/ch_1', { projectId: 'p_1' }, 403);
});

test('章节锁：别人正在编辑时不能写这一章', async () => {
  const lock = await author.json('POST', '/api/locks/ch_1', { projectId: 'p_1' });
  assert.equal(lock.lock.mine, true);
  const blocked = await admin.json('POST', '/api/locks/ch_1', { projectId: 'p_1' }, 409);
  assert.equal(blocked.error.code, 'locked');
  assert.equal(blocked.error.lock.userName, '王五');
  const r = await admin.json('POST', '/api/sync/push', { changes: [{ table: 'versions', id: 'v_4', row: { ...version, id: 'v_4' } }] });
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].reason, /王五.*正在编辑/);
  // 续期仍然成功
  await author.json('POST', '/api/locks/ch_1', { projectId: 'p_1' });
  // 不能借别的作品的权限锁这一章
  await author.json('POST', '/api/locks/ch_1', { projectId: 'p_2' }, 403);
  await author.json('DELETE', '/api/locks/ch_1');
  const ok = await admin.json('POST', '/api/sync/push', { changes: [{ table: 'versions', id: 'v_4', row: { ...version, id: 'v_4' } }] });
  assert.equal(ok.results[0].ok, true);
});

test('外部协作者：只能看到、修改被授权的作品', async () => {
  const inv = await admin.json('POST', `/api/orgs/${team}/invitations`, { role: 'guest', projectIds: ['p_2'], grantRole: 'author' });
  await guest.login('13700000005', { invitation: inv.url.split('/invite/')[1] });
  guest.org = team;
  const pulled = await guest.json('GET', '/api/sync/pull?since=0');
  assert.ok(pulled.changes.length > 0);
  assert.ok(pulled.changes.every((ch: any) => (ch.table === 'projects' ? ch.id : ch.row.projectId) === 'p_2'));
  const r = await guest.json('POST', '/api/sync/push', {
    changes: [
      { table: 'chapters', id: 'g_1', row: { id: 'g_1', projectId: 'p_2', index: 1, title: '协作者写的', status: 'drafting' } },
      { table: 'chapters', id: 'g_2', row: { id: 'g_2', projectId: 'p_1', index: 2, title: '越权', status: 'drafting' } },
    ],
  });
  assert.equal(r.results.find((x: any) => x.id === 'g_1').ok, true);
  assert.equal(r.results.find((x: any) => x.id === 'g_2').ok, false);
  const members = await guest.json('GET', `/api/orgs/${team}/members`);
  // 协作者看不到其他普通成员
  assert.ok(!members.members.some((m: any) => m.role === 'author'));
});

test('删除作品：其下内容一并删除', async () => {
  const before = await author.json('GET', '/api/sync/pull?since=0');
  const r = await admin.json('POST', '/api/sync/push', { changes: [{ table: 'projects', id: 'p_2', row: null }] });
  assert.equal(r.results[0].ok, true);
  const after = await author.json('GET', `/api/sync/pull?since=${before.cursor}`);
  const deleted = after.changes.filter((ch: any) => ch.row === null).map((ch: any) => ch.id);
  assert.ok(deleted.includes('p_2') && deleted.includes('g_1'), JSON.stringify(deleted));
});

test('防内网请求：模型地址不能指向本机或云元数据地址', async () => {
  await assert.rejects(safeFetch('http://127.0.0.1:1/v1/models', { method: 'GET', headers: {} }), /内网或本机/);
  await assert.rejects(safeFetch('http://169.254.169.254/latest/meta-data', { method: 'GET', headers: {} }), /内网或本机/);
  await assert.rejects(safeFetch('http://localhost:11434/api/tags', { method: 'GET', headers: {} }), /内网或本机/);
  await assert.rejects(safeFetch('http://[::1]:80/', { method: 'GET', headers: {} }), /内网或本机/);
  await assert.rejects(safeFetch('file:///etc/passwd', { method: 'GET', headers: {} }), /http/);
  // 走识别接口时同样会被拦截
  const res = await admin.req('POST', '/api/ai/credentials/detect', { url: mockUrl, key: 'sk-good-test-key-1234' });
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const err = events.find((e) => e.t === 'error');
  assert.ok(err, JSON.stringify(events));
  assert.match(err.message, /内网或本机/);
});

test('模型接入：自动识别、密钥加密保存、环节自动分配', async () => {
  config.allowPrivateModelHosts = true; // 测试用的模拟服务在本机
  try {
    await author.json('POST', '/api/ai/credentials/detect', { url: mockUrl, key: 'sk-good-test-key-1234' }, 403);
    const res = await admin.req('POST', '/api/ai/credentials/detect', { url: `${mockUrl}/v1/chat/completions`, key: 'sk-good-test-key-1234', name: '测试模型' });
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const result = events.find((e) => e.t === 'result');
    assert.ok(result, JSON.stringify(events));
    assert.equal(result.credential.model, 'mock-writer');
    assert.equal(result.credential.baseUrl, `${mockUrl}/v1`);
    assert.equal(result.reply, '你好');
    assert.ok(events.some((e) => e.t === 'step' && e.step === 'protocol' && e.state === 'done'));

    const models = await author.json('GET', '/api/ai/models');
    assert.equal(models.credentials.length, 1);
    assert.equal(models.credentials[0].keyHint, 'sk-…1234');
    assert.ok(!JSON.stringify(models).includes('sk-good-test-key-1234'));
    assert.deepEqual(new Set(Object.values(models.stages)), new Set([result.credential.id]));
    const [row] = await withTenant(team, (tx) => tx`select key_cipher from credentials`);
    assert.ok(row.key_cipher && !row.key_cipher.includes('sk-good-test-key-1234'));
  } finally {
    config.allowPrivateModelHosts = false;
  }
});

test('AI 网关：流式转发、记录用量、只读成员不能用、额度生效', async () => {
  config.allowPrivateModelHosts = true;
  try {
    const res = await author.req('POST', '/api/ai/chat', { stage: 'write', system: '你是作家', messages: [{ role: 'user', content: '写一句' }], projectId: 'p_1' });
    assert.equal(res.status, 200);
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.filter((l) => l.t === 'd').map((l) => l.v).join(''), REPLY);
    assert.deepEqual(lines.at(-1), { t: 'end', inputTokens: 11, outputTokens: 7 });

    await viewer.json('POST', '/api/ai/chat', { stage: 'write', system: '', messages: [{ role: 'user', content: 'x' }] }, 403);

    const usage = await admin.json('GET', '/api/ai/usage');
    assert.equal(usage.totalTokens, 18);
    assert.equal(usage.rows[0].userName, '王五');
    const mineOnly = await author.json('GET', '/api/ai/usage');
    assert.ok(mineOnly.rows.every((r: any) => r.userName === '王五'));

    await author.json('PATCH', `/api/orgs/${team}`, { memberMonthlyTokenLimit: 10 }, 403);
    await admin.json('PATCH', `/api/orgs/${team}`, { memberMonthlyTokenLimit: 10 });
    const q = await author.json('POST', '/api/ai/chat', { stage: 'write', system: '', messages: [{ role: 'user', content: 'x' }], projectId: 'p_1' }, 429);
    assert.equal(q.error.code, 'quota_member');
    await admin.json('PATCH', `/api/orgs/${team}`, { memberMonthlyTokenLimit: null });
  } finally {
    config.allowPrivateModelHosts = false;
  }
});

test('短剧画布：建图、流水线运行、过期判断、权限、导出与用量', async () => {
  config.allowPrivateModelHosts = true;
  try {
    // 小说内容：两章有正文
    const long = '雾最浓的晚上，林澈去北岸灯塔。'.repeat(20);
    await admin.json('POST', '/api/sync/push', {
      changes: [
        { table: 'chapters', id: 'ch_d2', row: { id: 'ch_d2', projectId: 'p_1', index: 2, title: '雾夜', status: 'drafting', workingVersionId: 'v_d2', words: 300, updatedAt: 5 } },
        { table: 'chapters', id: 'ch_d3', row: { id: 'ch_d3', projectId: 'p_1', index: 3, title: '灯塔', status: 'drafting', workingVersionId: 'v_d3', words: 300, updatedAt: 5 } },
        { table: 'versions', id: 'v_d2', row: { id: 'v_d2', projectId: 'p_1', chapterId: 'ch_d2', content: long, words: 300 } },
        { table: 'versions', id: 'v_d3', row: { id: 'v_d3', projectId: 'p_1', chapterId: 'ch_d3', content: long, words: 300 } },
      ],
    });

    await viewer.json('POST', '/api/drama/by-novel/p_1', {}, 403);
    const made = await author.json('POST', '/api/drama/by-novel/p_1', { preset: { chapterFrom: 2, chapterTo: 3, episodes: 12 } });
    const d = made.project;
    assert.equal(d.preset.episodes, 12);
    assert.deepEqual(d.nodes.map((n: any) => n.type).sort(), ['breakdown', 'outline', 'source']);
    assert.equal(d.edges.length, 2);
    // 重复创建返回同一张画布
    assert.equal((await author.json('POST', '/api/drama/by-novel/p_1', {})).project.id, d.id);

    const get = async (c: Client = author) => (await c.json('GET', `/api/drama/${d.id}`)).project;
    const waitIdle = async (want: (p: any) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const p = await get();
        if (!p.nodes.some((n: any) => n.status === 'running') && want(p)) return p;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('等待画布运行超时');
    };
    const byType = (p: any, t: string) => p.nodes.filter((n: any) => n.type === t);

    // 没有拆解就运行大纲：失败并给出原因
    await author.json('POST', `/api/drama/nodes/${byType(d, 'outline')[0].id}/run`, {}, 202);
    let p = await waitIdle((x) => byType(x, 'outline')[0].status === 'failed');
    assert.match(byType(p, 'outline')[0].error, /故事拆解/);

    // 没有接入模型时的提示（环节未分配）→ 先确认分配存在，这里直接一键运行
    await viewer.json('POST', `/api/drama/${d.id}/run-all`, {}, 403);
    await author.json('POST', `/api/drama/${d.id}/run-all`, {}, 202);
    p = await waitIdle((x) => byType(x, 'storyboard').length === 12 && byType(x, 'storyboard').every((n: any) => n.status === 'done'));
    assert.equal(byType(p, 'script').length, 12);
    assert.ok(p.nodes.every((n: any) => !n.stale), '全部跑完后不应有过期节点');
    // 批次拼接：序号连续，且以服务端为准
    assert.deepEqual(byType(p, 'outline')[0].output.episodes.map((e: any) => e.n), Array.from({ length: 12 }, (_, i) => i + 1));
    const scriptOf = (x: any, n: number) => byType(x, 'script').find((s: any) => s.params.episode === n);
    const boardOf = (x: any, n: number) => byType(x, 'storyboard').find((s: any) => s.params.episode === n);
    assert.equal(scriptOf(p, 1).output.scenes[0].source.chapter, 2);
    assert.equal(boardOf(p, 1).output.totalSeconds, 9);

    // 手改第 3 集剧本：只有它的分镜过期
    const s3 = scriptOf(p, 3);
    const edited = { ...s3.output, title: '改过的标题' };
    await author.json('PATCH', `/api/drama/nodes/${s3.id}`, { output: edited });
    p = await get();
    assert.equal(scriptOf(p, 3).stale, false);
    assert.equal(boardOf(p, 3).stale, true);
    assert.equal(boardOf(p, 4).stale, false);

    // 手改拆解：大纲与所有剧本都过期，拆解自己不过期
    const bd = byType(p, 'breakdown')[0];
    await author.json('PATCH', `/api/drama/nodes/${bd.id}`, { output: { ...bd.output, logline: '改过的一句话' } });
    p = await get();
    assert.equal(byType(p, 'breakdown')[0].stale, false);
    assert.equal(byType(p, 'outline')[0].stale, true);
    assert.ok(byType(p, 'script').every((n: any) => n.stale));

    // 调整预设：集数减少 → 大纲重跑 → 多余的集被删除
    await author.json('PATCH', `/api/drama/${d.id}`, { preset: { episodes: 3 } });
    await author.json('POST', `/api/drama/nodes/${byType(p, 'outline')[0].id}/run`, {}, 202);
    p = await waitIdle((x) => byType(x, 'script').length === 3);
    assert.equal(byType(p, 'storyboard').length, 3);
    assert.equal(p.edges.length, 2 + 3 * 2);

    // 权限与隔离
    assert.equal((await get(viewer)).id, d.id);
    await viewer.json('POST', `/api/drama/nodes/${byType(p, 'outline')[0].id}/run`, {}, 403);
    await viewer.json('PATCH', `/api/drama/nodes/${bd.id}`, { approved: true }, 403);
    await outsider.json('GET', `/api/drama/${d.id}`, undefined, 404);
    await guest.json('GET', `/api/drama/${d.id}`, undefined, 403);

    // 导出
    const md = await author.json('GET', `/api/drama/${d.id}/export?format=md`);
    assert.match(md.content, /第 3 集/);
    assert.match(md.content, /原著第 2 章/);
    const csv = await author.json('GET', `/api/drama/${d.id}/export?format=csv`);
    assert.match(csv.content, /^﻿集,镜头/);

    // 用量按「短剧」环节记录
    const usage = await admin.json('GET', '/api/ai/usage');
    assert.ok(usage.rows.some((r: any) => r.stage === 'drama'));

    // 删除画布
    await author.json('DELETE', `/api/drama/${d.id}`, undefined, 403);
    await admin.json('DELETE', `/api/drama/${d.id}`);
    await admin.json('GET', `/api/drama/${d.id}`, undefined, 404);
  } finally {
    config.allowPrivateModelHosts = false;
  }
});

test('成员管理：管理员调整角色、移除成员后无法访问', async () => {
  const members = await admin.json('GET', `/api/orgs/${team}/members`);
  const v = members.members.find((m: any) => m.role === 'viewer');
  await author.json('PATCH', `/api/orgs/${team}/members/${v.userId}`, { role: 'editor' }, 403);
  await admin.json('PATCH', `/api/orgs/${team}/members/${v.userId}`, { role: 'editor' });
  const r = await viewer.json('POST', '/api/sync/push', { changes: [{ table: 'characters', id: 'c_2', row: { id: 'c_2', projectId: 'p_1', name: '新人物' } }] });
  assert.equal(r.results[0].ok, true);
  await admin.json('DELETE', `/api/orgs/${team}/members/${v.userId}`);
  await viewer.json('GET', '/api/sync/pull?since=0', undefined, 403);
  // 不能修改所有者
  const owner = members.members.find((m: any) => m.role === 'owner');
  await admin.json('PATCH', `/api/orgs/${team}/members/${owner.userId}`, { role: 'author' }, 400);
});

test('退出登录后会话失效', async () => {
  await outsider.json('POST', '/api/auth/logout', {});
  await outsider.json('GET', '/api/me', undefined, 401);
});
