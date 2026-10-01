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
