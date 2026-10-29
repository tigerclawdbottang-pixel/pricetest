/* 冒烟测试：用 jsdom 真实渲染 index.html，验证各 Tab 与交互 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.join(__dirname, '..', 'web', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/DecompressionStream|Not implemented/.test(e.message)) errs.push('jsdomError: ' + e.message); });
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true });
const win = dom.window, doc = win.document;

function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? '  → ' + extra : ''));
  if (!cond) errs.push(name);
}
const txt = id => (doc.getElementById(id) || {}).textContent || '';
const n = id => doc.querySelectorAll('#' + id + ' *').length;

setTimeout(() => {
  console.log('--- 初始化 ---');
  ok('无 JS 运行时错误', errs.filter(e => e.startsWith('jsdomError')).length === 0,
    errs.filter(e => e.startsWith('jsdomError'))[0] || '');
  ok('表格已渲染', doc.querySelectorAll('#tbl table tbody tr').length > 50,
    doc.querySelectorAll('#tbl table tbody tr').length + ' 行');
  ok('计数文本已填充', /共 \d+ 个模型/.test(txt('cnt')), txt('cnt'));
  ok('源 chips 已生成', doc.querySelectorAll('#srcChips .chip').length === 5);
  ok('指标下拉已生成', doc.querySelectorAll('#metric option').length === 5);
  ok('图表 SVG 已生成', doc.querySelectorAll('#chart svg rect').length > 0,
    doc.querySelectorAll('#chart svg rect').length + ' 根柱子');
  ok('汇总卡片已生成', doc.querySelectorAll('#cards .card').length === 4);
  ok('红绿着色存在', doc.querySelectorAll('#tbl .pill.lo').length > 0 && doc.querySelectorAll('#tbl .pill.hi').length > 0,
    `绿 ${doc.querySelectorAll('#tbl .pill.lo').length} / 红 ${doc.querySelectorAll('#tbl .pill.hi').length}`);

  console.log('--- 交互：点击首行展开详情 ---');
  const first = doc.querySelector('#tbl table tbody tr');
  first.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('详情面板展开', doc.getElementById('detail').style.display === 'block');
  ok('详情含版本明细', /版本明细/.test(txt('detail')));
  ok('详情含缓存命中行', /缓存命中/.test(doc.getElementById('detail').innerHTML));

  console.log('--- 交互：切换指标 ---');
  const sel = doc.getElementById('metric');
  sel.value = 'cache_read';
  sel.dispatchEvent(new win.Event('change'));
  ok('切到缓存命中后表格仍渲染', doc.querySelectorAll('#tbl table tbody tr').length > 0);

  console.log('--- 交互：搜索 ---');
  const q = doc.getElementById('q');
  q.value = 'kimi';
  q.dispatchEvent(new win.Event('input'));
  const rowsK = [...doc.querySelectorAll('#tbl table tbody tr')].map(r => r.textContent);
  ok('搜索 kimi 有结果', rowsK.length > 0, rowsK.length + ' 行');
  ok('搜索结果确实含 kimi', rowsK.every(t => /kimi/i.test(t)));
  q.value = ''; q.dispatchEvent(new win.Event('input'));

  console.log('--- Tab：关注模型 ---');
  doc.querySelector('.tab[data-t="watch"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const wt = doc.getElementById('watch').textContent;
  ok('关注页含 Claude 系列', /Claude 系列/.test(wt));
  ok('关注页含 GPT 全系列', /GPT 全系列/.test(wt));
  ok('关注页含 Gemini', /Gemini/.test(wt));
  for (const cn of ['DeepSeek', 'Kimi', 'GLM', 'Qwen', 'MiniMax'])
    ok('关注页含 ' + cn, wt.includes(cn));
  ok('关注页有表格行', doc.querySelectorAll('#watch table tbody tr').length > 20,
    doc.querySelectorAll('#watch table tbody tr').length + ' 行');

  console.log('--- Tab：价格走势 ---');
  doc.querySelector('.tab[data-t="trend"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok('走势模型下拉已填充', doc.querySelectorAll('#trendModel option').length > 100,
    doc.querySelectorAll('#trendModel option').length + ' 个选项');
  ok('单日时给出累积提示', /至少需要|快照/.test(txt('trendNote')) || doc.querySelectorAll('#trend svg').length > 0,
    txt('trendNote'));

  console.log('--- Tab：上传比对（粘贴文本）---');
  doc.querySelector('.tab[data-t="upload"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  doc.getElementById('paste').value =
    'Model\tInput\tOutput\nClaude Sonnet 5\t2.0\t10.0\nDeepSeek V4 Pro\t1.32\t3.96\nGLM 5.3\t0.28\t0.88\nKIMI K3\t0.6\t3.0\nQwen 3.8 MAX\t2.0\t8.0';
  doc.getElementById('pasteBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const ur = doc.getElementById('upResult');
  ok('上传结果表已生成', doc.querySelectorAll('#upResult table tbody tr').length >= 4,
    doc.querySelectorAll('#upResult table tbody tr').length + ' 行');
  ok('识别出模型并匹配', /识别出\s*\d+\s*个模型/.test(doc.getElementById('upStatus').textContent),
    doc.getElementById('upStatus').textContent.trim());
  ok('黄色高亮存在', doc.querySelectorAll('#upResult .hl').length > 0,
    doc.querySelectorAll('#upResult .hl').length + ' 处');
  ok('比较曲线已生成', doc.querySelectorAll('#upChart svg polyline').length >= 2,
    doc.querySelectorAll('#upChart svg polyline').length + ' 条曲线');

  console.log('--- Tab：数据源 ---');
  doc.querySelector('.tab[data-t="status"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const st = doc.getElementById('status').textContent;
  for (const s of ['OpenRouter', 'Fireworks', 'Wokey', 'CheaperInference', '硅基流动'])
    ok('状态页含 ' + s, st.includes(s));
  ok('状态页显示采集成功', /采集成功/.test(st));

  console.log('\n结果: ' + (errs.length ? '❌ ' + errs.length + ' 项失败\n' + errs.join('\n') : '✅ 全部通过'));
  win.close();
  process.exit(errs.length ? 1 : 0);
}, 900);
