/* 验证「模型官网价格」列：表头、单元格、来源区分、排序、详情页 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? '  → ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? '  → ' + extra : ''}`); }
};

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('  [jsdomError]', e.message));
const dom = new JSDOM(HTML, { runScripts: 'dangerously', virtualConsole: vc });
const win = dom.window, doc = win.document;
win.DecompressionStream = globalThis.DecompressionStream;
win.Response = globalThis.Response;
win.Blob = globalThis.Blob;

setTimeout(() => {
  const D = JSON.parse(doc.getElementById('DATA').textContent);
  console.log('--- 数据层 ---');
  const meta = D.official_meta;
  ok('official_meta 存在', !!meta, JSON.stringify(meta));
  ok('有真实官网价模型', meta.n_official > 0, `${meta.n_official} 个`);
  ok('有 OpenRouter 兜底', meta.n_fallback > 0, `${meta.n_fallback} 个`);
  const withOff = D.models.filter(m => m.official && m.official.src === 'official');
  ok('官网价含 input/output', withOff.every(m => m.official.input != null && m.official.output != null));
  ok('官网价含来源 URL', withOff.every(m => !!m.official.url));

  // 关注模型必须尽量是 official
  const watch = D.models.filter(m => m.watch);
  const watchOff = watch.filter(m => m.official && m.official.src === 'official');
  ok('关注模型官网价覆盖 >= 14/16', watchOff.length >= 14, `${watchOff.length}/${watch.length}`);

  console.log('\n--- 表格列 ---');
  const ths = [...doc.querySelectorAll('#tbl th')].map(t => t.textContent.trim());
  ok('表头含「模型官网价格」', ths.some(t => t.includes('模型官网价格')), ths.slice(0, 3).join(' | '));
  ok('官网价列在第 2 列', /模型官网价格/.test(ths[1] || ''), `第2列=${ths[1]}`);

  const rows = [...doc.querySelectorAll('#tbl tbody tr[data-loose]')];
  ok('表格有数据行', rows.length > 0, `${rows.length} 行`);
  const cellOff = rows.map(r => r.children[1]).filter(Boolean);
  ok('每行第 2 个单元格是官网价', cellOff.length === rows.length);
  const nOff = cellOff.filter(c => c.querySelector('.pill.off')).length;
  const nFb = cellOff.filter(c => c.querySelector('.pill.off-fb')).length;
  const nNa = cellOff.filter(c => c.querySelector('.na')).length;
  ok('渲染出官方价单元格', nOff > 0, `official=${nOff} fallback=${nFb} 无=${nNa}`);
  ok('兜底单元格有 OR 角标', doc.querySelectorAll('#tbl sup.fb').length > 0,
    `${doc.querySelectorAll('#tbl sup.fb').length} 个`);
  ok('官网价不参与红绿着色',
    !cellOff.some(c => c.querySelector('.pill.lo') || c.querySelector('.pill.hi')));

  console.log('\n--- 排序 ---');
  const th = [...doc.querySelectorAll('#tbl th')].find(t => t.dataset.k === 'official');
  ok('官网价列可点击排序', !!th);
  if (th) {
    const before = [...doc.querySelectorAll('#tbl tbody tr')].slice(0, 3)
      .map(r => r.children[1].textContent.trim());
    th.onclick();
    const after = [...doc.querySelectorAll('#tbl tbody tr')].slice(0, 3)
      .map(r => r.children[1].textContent.trim());
    ok('点击后排序生效', JSON.stringify(before) !== JSON.stringify(after),
      `前3: ${after.join(', ')}`);
  }

  console.log('\n--- 展开详情 ---');
  const first = rows[0];
  first.onclick();
  const det = doc.getElementById('detail');
  ok('详情含官网价说明块', !!det.querySelector('.offinfo'),
    (det.querySelector('.offinfo') || {}).textContent?.trim().slice(0, 60));
  const dths = [...det.querySelectorAll('.dettab th')].map(t => t.textContent.trim());
  ok('详情表含官网价列', dths.some(t => t.includes('官网')), dths.join(' | '));
  ok('详情含官方来源链接', !!det.querySelector('.offinfo a'),
    det.querySelector('.offinfo a')?.href || '(无链接)');

  console.log('\n--- 关注模型页 ---');
  win.switchTab('watch');
  const wths = [...doc.querySelectorAll('#watch th')].map(t => t.textContent.trim());
  ok('关注页表头含官网价', wths.some(t => t.includes('模型官网价格')), wths.join(' | '));
  ok('关注页有官网价单元格', doc.querySelectorAll('#watch .pill.off, #watch .pill.off-fb').length > 0,
    `${doc.querySelectorAll('#watch .pill.off, #watch .pill.off-fb').length} 个`);

  console.log(`\n结果: ${fail === 0 ? '✅ 全部通过' : '❌ ' + fail + ' 项失败'}  (${pass} passed)`);
  win.close();
  process.exit(fail === 0 ? 0 : 1);
}, 900);
