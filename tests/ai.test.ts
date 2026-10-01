/** 写作能力的纯逻辑测试：JSON 修复、文字体检、灵感兜底。运行：npm run test:ai */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeInspiration, composeMany } from '../src/ai/inspiration.ts';
import { lintInstruction, lintProse } from '../src/ai/lint.ts';
import { closeJson, extractJson, repairJson } from '../src/lib/util.ts';

test('JSON 解析：中文弯引号、字符串内的英文引号与换行、尾逗号、代码块', () => {
  assert.deepEqual(extractJson('{"a":"他说“你好”","b":[1,2,],}'), { a: '他说“你好”', b: [1, 2] });
  assert.deepEqual(extractJson('{"a":"他说"你好"然后走了","b":"x"}'), { a: '他说"你好"然后走了', b: 'x' });
  assert.deepEqual(extractJson('{"a":"第一行\n第二行"}'), { a: '第一行\n第二行' });
  assert.deepEqual(extractJson('```json\n{"a":"b"}\n```'), { a: 'b' });
  assert.deepEqual(extractJson('好的，结果如下：{"a":1}'), { a: 1 });
  assert.equal(repairJson('{"a":1}'), '{"a":1}');
});

test('JSON 被截断：默认报错，允许时补全已写出的部分', () => {
  const cut = '{"titles":["a","b"],"characters":[{"name":"沈","wound":"她相信“补岁”能救儿子。"},{"name":"知遥","role":"缺席者（';
  assert.throws(() => extractJson(cut));
  const r = extractJson<{ titles: string[]; characters: { name: string }[] }>(cut, { salvage: true });
  assert.deepEqual(r.titles, ['a', 'b']);
  assert.equal(r.characters.length, 2);
  assert.ok(closeJson('{"a":[1,2').endsWith(']}'));
});

test('文字体检：典型 AI 腔会被量化，干净的文字不会误报', () => {
  const ai = '她走进屋里，灯很暗。窗外的雪像碎盐一样落下来，像谁在撒一把旧时光。\n他不禁深吸一口气，眼中闪过一丝复杂的神色，嘴角勾起一抹苦笑，仿佛时间都静止了。'.repeat(14);
  const bad = lintProse(ai);
  assert.equal(bad.level, 'high');
  assert.ok(bad.similePerK > 20 && bad.stockPerK > 20);
  assert.equal(bad.paraEndSimile.count, bad.paraEndSimile.total);
  assert.match(lintInstruction(bad), /比喻太密/);

  const clean = '她推开门，把伞靠在墙边。\n桌上的茶已经凉了，杯沿有一圈褐色的印子。他没有抬头，只把账本往她面前推了推。\n“三十块。”他说。'.repeat(14);
  const ok = lintProse(clean);
  assert.equal(ok.level, 'ok');
  assert.equal(ok.summary, '没有明显的 AI 腔');
  // 太短的文字不下结论
  assert.equal(lintProse('像').level, 'ok');
});

test('本地灵感兜底：每次不同，且是完整的句子', () => {
  const many = composeMany(30);
  assert.ok(new Set(many).size >= 25, '组合足够多样');
  assert.ok(many.every((s) => s.length >= 12 && /[。]$/.test(s)));
  assert.notEqual(composeInspiration([many[0]]), many[0]);
});

import { beatCoverage, locateQuote, nameDrift, verifyCritique } from '../src/ai/verify.ts';

const SAMPLE = '沈砚把证物袋翻了个面，让顶灯从筒口打进去。纸壳透光，药粉的阴影密实均匀。\n\n手机在实验服口袋里震。她摘了手套接起来。“你爸不行了，回来一趟。”母亲的声音很平。';

test('引文核验：精确、忽略标点、近似都能定位，编造的找不到', () => {
  assert.equal(locateQuote(SAMPLE, '药粉的阴影密实均匀')?.level, 'exact');
  const loose = locateQuote(SAMPLE, '“你爸不行了 回来一趟”');
  assert.equal(loose?.level, 'exact', '忽略标点后可定位');
  assert.equal(SAMPLE.slice(loose!.from, loose!.to).includes('回来一趟'), true);
  assert.equal(locateQuote(SAMPLE, '她摘了手套接起电话')?.level, 'fuzzy', '模型改了一两个字也能近似定位');
  assert.equal(locateQuote(SAMPLE, '父亲在院子里点燃了二十八响烟花'), null, '编造的引文找不到');
  assert.equal(locateQuote(SAMPLE, '好'), null, '太短不下结论');
});

test('审稿核验：丢弃编造引文的意见；没证据的「已完成」降级；明明写了的「未完成」降级', () => {
  const issues = [
    { quote: '药粉的阴影密实均匀', problem: 'a' },
    { quote: '父亲在院子里点燃了二十八响烟花', problem: 'b（编造）' },
    { quote: '', problem: 'c（整体意见）' },
  ];
  const beats = [
    { beat: '她接到母亲的电话', status: 'done' as const, evidence: '“你爸不行了，回来一趟。”' },
    { beat: '父亲点燃烟花', status: 'done' as const, evidence: '父亲在院子里点燃了烟花' },
    { beat: '沈砚把证物袋翻了个面让顶灯从筒口打进去', status: 'missing' as const, evidence: '' },
    { beat: '她在车站遇到顾衡并被警告别查旧案', status: 'missing' as const, evidence: '' },
  ];
  const r = verifyCritique(SAMPLE, issues, beats);
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.issues.map((i) => i.problem), ['a', 'c（整体意见）']);
  assert.equal(r.issues[0].verified, 'exact');
  assert.equal(r.issues[1].verified, 'global');
  assert.equal(r.beats[0].status, 'done');
  assert.equal(r.beats[1].status, 'uncertain');
  assert.match(r.beats[1].note!, /找不到/);
  assert.equal(r.beats[2].status, 'uncertain');
  assert.match(r.beats[2].note!, /误判/);
  assert.equal(r.beats[3].status, 'missing');
  assert.ok(beatCoverage(SAMPLE, beats[3].beat) < 0.3);
});

test('人名一致性：差一个字且反复出现的名字会被提示，设定里本来就有的不算', () => {
  const text = '沈雾推开门。沈蘅没有回头。沈蘅把灯放下，沈雾看着她。林澈和林溯都在。林溯笑了。';
  const drift = nameDrift(text, ['沈雾', '林澈', '林溯']);
  assert.deepEqual(drift, [{ expected: '沈雾', found: '沈蘅', count: 2 }]);
});
