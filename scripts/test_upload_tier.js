/* 上传识别新能力回归测试
   1) 区间（token 档位）展开：续行继承上一模型、Condition 列作档位名
   2) 表头列定位：优先按列取值，而不是猜数字
   3) 折扣：表内「N 折」参与折算
   4) 主模型筛选与分析文案：家族去重、低于/高于本站最低、刊例价折扣、无 NaN/Infinity
   用法：NODEP=... node scripts/test_upload_tier.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const P = require('../web/parsers.js');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'web', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '   → ' + String(extra).slice(0, 160))); }
};

console.log('\n=== 纯函数：区间与列定位 ===');
ok('readTier: 0<Token≤128K', P.readTier('0<Token≤128K') === '0<Token≤128K');
ok('readTier: Token>272K', P.readTier('Token>272K') === 'Token>272K');
ok('readTier: ≤32K', P.readTier('≤32K') === '≤32K');
ok('readTier: 32K-128K', P.readTier('32K-128K') === '32K-128K');
ok('readTier: 拒绝纯数字 0.25', P.readTier('0.25') === '');
ok('readTier: 拒绝占位符 —', P.readTier('—') === '');
ok('firstNum: 取附注前的数字 8（1h cache write）', P.firstNum('8（1h cache write）\n5（5m）') === 8);
ok('firstNum: $0.25', P.firstNum('$0.25') === 0.25);
ok('firstNum: 占位符返回 null', P.firstNum('—') === null);

const H1 = ['序号 No.', '模型名称 Model Name', '模型系列 Model', '服务提供方 Provider',
  '模型开发方 Developer', 'Condition (Tokens)', '原厂目录价 List Price', '', '', '',
  '对外销售标准折扣 Sales Discount'];
const H2 = ['', '', '', '', '', '', '输入 Input (USD/M Tokens)', '缓存存储 Cache-Storage',
  '缓存命中 Cache-Hit', '输出 Output (USD/M Tokens)', '原厂直连'];
const cols = P.detectColumns([H1, H2]);
ok('detectColumns 命中表头', !!cols, JSON.stringify(cols));
ok('  模型列=1', cols && cols.model === 1, cols && cols.model);
ok('  区间列=5', cols && cols.tier === 5, cols && cols.tier);
ok('  输入列=6', cols && cols.input === 6, cols && cols.input);
ok('  缓存写列=7', cols && cols.cacheWrite === 7, cols && cols.cacheWrite);
ok('  缓存读列=8', cols && cols.cacheRead === 8, cols && cols.cacheRead);
ok('  输出列=9', cols && cols.output === 9, cols && cols.output);
ok('无表头时返回 null（回退通用识别）',
  P.detectColumns([['DeepSeek V4 Pro', '0.28', '0.42']]) === null);

/* ---------------- 页面内的 analyzeRows / buildAnalysis ---------------- */
const cfg = JSON.stringify({});            // 不预置配置 → 走 aiDefaultCfg
const dom = new JSDOM(fs.readFileSync(HTML, 'utf-8'), {
  runScripts: 'dangerously', url: 'https://localhost/', pretendToBeVisual: true,
  beforeParse(win) {
    win.localStorage.setItem('modelprice.llm.v1', cfg);
    for (const k of ['DecompressionStream', 'Response', 'Blob', 'File', 'TextDecoder', 'fetch'])
      if (globalThis[k]) win[k] = globalThis[k];
  },
});

setTimeout(() => {
  const win = dom.window, MP = win.__MP;
  if (!MP) { console.log('✗ __MP 未暴露，无法测试'); process.exit(1); }
  const models = MP.D.models;
  // 取 3 个真实存在的模型名，保证 guessModel 必中
  const picked = [];
  for (const kw of ['gpt', 'claude', 'deepseek', 'qwen', 'glm', 'kimi']) {
    const m = models.find(x => (x.name || '').toLowerCase().includes(kw) && x.n_src >= 2);
    if (m && picked.length < 3 && !picked.includes(m)) picked.push(m);
  }
  console.log(`\n=== 页面内：使用真实模型 ${picked.map(m => m.name).join(' / ')} ===`);
  const [A, B, C] = picked.map(m => m.name);

  const rows = [
    H1, H2,
    ['1', A, 'X', 'P', 'D', '0<Token≤128K', '0.25', '0.0083', '0.05', '2', '95折'],
    ['', '', '', '', '', '128K<Token≤256K', '0.5', '0.0083', '0.05', '4', ''],
    ['2', B, 'X', 'P', 'D', '', '1.00', '', '0.1', '5.00', ''],
    ['3', C, 'X', 'P', 'D', '-', '0.20', '', '', '0.80', '80折'],
    ['这只是备注说明，不是模型', '', '', '', '', '', '', '', '', '', ''],
  ];
  MP.analyzeRows(rows, 't.xlsx', '');
  const got = MP.S.uploadRows;
  ok('识别到 3 个模型', got.length === 3, JSON.stringify(got.map(f => f.m.name)));
  const fa = got.find(f => f.m.name === A);
  ok('A 展开为 2 档', fa && fa.tiers.length === 2, fa && fa.tiers.length);
  ok('  第一档标签 0<Token≤128K', fa && fa.tiers[0].tier === '0<Token≤128K', fa && fa.tiers[0].tier);
  ok('  第二档标签 128K<Token≤256K（续行继承到了上一个模型）',
    fa && fa.tiers[1] && fa.tiers[1].tier === '128K<Token≤256K', fa && fa.tiers[1] && fa.tiers[1].tier);
  ok('  按列取到 input=0.25（落到 list），不掺其它列的数字', fa && fa.tiers[0].list === 0.25,
    fa && fa.tiers[0].list);
  ok('  实际报价=目录价×折扣 0.2375', fa && Math.abs(fa.tiers[0].in - 0.2375) < 1e-9, fa && fa.tiers[0].in);
  ok('  目录价保留为 0.25', fa && fa.tiers[0].list === 0.25, fa && fa.tiers[0].list);
  ok('  第二档无折扣 → 0.5', fa && fa.tiers[1].in === 0.5, fa && fa.tiers[1].in);
  ok('  缓存读/写也读到了', fa && fa.tiers[0].cache === 0.05 && fa.tiers[0].cw === 0.0083,
    fa && [fa.tiers[0].cache, fa.tiers[0].cw]);
  const fb = got.find(f => f.m.name === B);
  ok('B 单档且无折扣 → 1', fb && fb.tiers.length === 1 && fb.in === 1, fb && fb.in);
  const fc = got.find(f => f.m.name === C);
  ok('C 占位符 "-" 不算档位名', fc && fc.tiers[0].tier === '', JSON.stringify(fc && fc.tiers[0].tier));
  ok('C 折扣生效 → 0.16', fc && Math.abs(fc.in - 0.16) < 1e-9, fc && fc.in);
  ok('备注行没有变成新模型', !got.find(f => /备注/.test(f.m.name)));
  ok('备注行进入待补队列', (MP.S.upMiss || []).some(m => m.cells.join(' ').includes('备注')));

  console.log('\n=== 主模型筛选 ===');
  ok('同家族不同版本归为一族（Claude-4.5-sonnet / Claude-5-sonnet）',
    MP.familyKey('Claude-4.5-sonnet') === MP.familyKey('Claude-5-sonnet'),
    MP.familyKey('Claude-4.5-sonnet') + ' vs ' + MP.familyKey('Claude-5-sonnet'));
  ok('厂商前缀差异不影响（Qwen/Qwen3-8B / Qwen3 8B）',
    MP.familyKey('Qwen/Qwen3-8B') === MP.familyKey('Qwen3 8B'));
  ok('变体词归入同族（GPT-5.2 / GPT-5.2-Chat）',
    MP.familyKey('GPT-5.2') === MP.familyKey('GPT-5.2-Chat'));
  ok('不同型号不合并（Opus vs Sonnet）',
    MP.familyKey('Claude-5-opus') !== MP.familyKey('Claude-5-sonnet'));
  const fake = [
    { m: models[0], tiers: [{ in: 1 }], in: 1, out: 2 },
    { m: models[0], tiers: [{ in: 1 }], in: 1, out: 2 },   // 同一个，应被去重
  ];
  ok('mainModels 去重（同模型两次只留一个）', MP.mainModels(fake).length === 1);

  console.log('\n=== 分析文案 ===');
  const r = MP.buildAnalysis(got, 12);
  ok('生成了文案', r.text.length > 80, r.text.length);
  ok('文案里没有 NaN', !/NaN/.test(r.text), r.text.match(/.{0,30}NaN.{0,30}/));
  ok('文案里没有 Infinity', !/Infinity/.test(r.text), r.text.match(/.{0,30}Infinity.{0,30}/));
  ok('含总体判断', /共识别|与本站最低价相比/.test(r.text));
  ok('含逐模型条目', r.text.includes('1. ' + A) || r.text.includes(A));
  ok('html 与 text 同时产出', r.html.length > 80);
  ok('有 stat 统计', r.stat && typeof r.stat.higher === 'number');

  // 人为构造「本站最低为 0」的极端情况，确认不再出现 Infinity
  const zeroRow = { m: Object.assign({}, models[0], { prices: {}, n_src: 0, official: null }),
    tiers: [{ in: 1 }], in: 1, out: 2, currency: 'USD' };
  const r2 = MP.buildAnalysis([zeroRow], 3);
  ok('无本站数据时也不出现 NaN/Infinity', !/NaN|Infinity/.test(r2.text), r2.text.slice(0, 120));

  console.log(`\n结果: ${fail ? '❌ ' + fail + ' 项失败' : '✅ 全部通过'}  (${pass} passed, ${fail} failed)\n`);
  win.close();
  process.exit(fail ? 1 : 0);
}, 1200);
