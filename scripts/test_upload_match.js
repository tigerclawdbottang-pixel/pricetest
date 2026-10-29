/* 上传识别回归测试：用真实的 AI Hub xlsx 跑完整流程
   运行：node scripts/test_upload_match.js  （需 /tmp/aihub.xlsx，缺失则自动跳过） */
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const P = require(path.join(ROOT, 'web/parsers.js'));
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const FILE = '/tmp/aihub.xlsx';
  if (!fs.existsSync(FILE)) {
    console.log('跳过：未找到 ' + FILE);
    process.exit(0);
  }
  const files = await P.unzip(fs.readFileSync(FILE));
  const sheets = P.parseXlsxSheets(files).filter(s => s.rows.length);

  console.log('=== 工作表识别 ===');
  ok('解析出多个工作表', sheets.length >= 5, '实际 ' + sheets.length);
  ok('工作表带中文名', sheets.some(s => /语言模型/.test(s.name)), sheets.map(s => s.name).join(' | '));
  ok('标记了隐藏表', sheets.some(s => s.hidden));

  // ---- 匹配算法单元测试 ----
  console.log('\n=== 语序差异匹配（核心修复）===');
  const cases = [
    ['Claude-5-fable', 'claudefable5'],
    ['Claude-5-opus', 'claudeopus5'],
    ['Claude-4.5-haiku', 'claudehaiku45'],
    ['Claude-4.6-sonnet', 'claudesonnet46'],
    ['ByteDance-Seed-2.0-mini', 'seed20mini'],
    ['ByteDance-Seed-2.0-lite', 'seed20lite'],
    ['Claude Opus 5.5', 'claudeopus55'],
    ['Deepseek-V4-Pro', 'deepseekv4pro'],
    ['GLM-5.3-Flash', 'glm53flash'],
    ['Kimi K3', 'kimik3'],
  ];
  for (const [inp, want] of cases) {
    const m = P.guessModel(inp, D.models);
    ok(`${inp.padEnd(26)} → ${want}`, m && m.loose === want, m ? m.loose : '未识别');
  }

  console.log('\n=== 表头不应被误判为模型 ===');
  for (const h of ['模型名称\nModel Name', 'Provider', '输入 Input (USD/M Tokens)',
    '输出 Output', '序号 No.', '服务提供方']) {
    ok(`表头「${h.split('\n')[0]}」被排除`, P.isHeadCell(h));
  }
  ok('真实模型名不被误排除', !P.isHeadCell('Claude Opus 5.5') && !P.isHeadCell('GPT-5.4-Pro')
    && !P.isHeadCell('Qwen3.8-Max') && !P.isHeadCell('Gemini 3.1 Pro Preview'));

  console.log('\n=== 整表识别率 ===');
  // 主表 = 识别出模型最多的工作表
  const cnt = sheets.map(s => s.rows.filter(r => r.some(c => P.guessModel(c, D.models) && !P.isHeadCell(c))).length);
  let bi = 0, bn = -1;                       // 与 app.js 一致：隐藏表降权
  cnt.forEach((n, i) => { const w = n * (sheets[i].hidden ? 0.4 : 1); if (w > bn) { bn = w; bi = i; } });
  const main = sheets[bi];
  console.log(`  默认选中工作表：「${main.name}」（${main.rows.length} 行，约 ${cnt[bi]} 个模型）`);
  ok('默认工作表是「表1 语言模型」而非停更表', /^表1\s*语言模型/.test(main.name), main.name);
  ok('默认工作表非隐藏', !main.hidden, main.name);

  // 表1 里的 101 个模型（已知清单）
  const names = JSON.parse(fs.readFileSync('/tmp/aihub_names.json', 'utf8'));
  let hit = 0;
  const miss = [];
  for (const [n] of names) { if (P.guessModel(n, D.models)) hit++; else miss.push(n); }
  const rate = hit / names.length;
  console.log(`  表1 模型 ${names.length} 个，识别 ${hit} 个 → ${(rate * 100).toFixed(1)}%`);
  ok('识别率 ≥ 95%', rate >= 0.95, (rate * 100).toFixed(1) + '%');
  if (miss.length) console.log('  未识别（应仅为站内未收录）：', miss.join(', '));
  // 未识别的必须确实是站内没有的
  const realMiss = miss.filter(n => {
    const k = P.LOOSE(n);
    return D.models.some(m => m.loose === k || m.loose.includes(k) || k.includes(m.loose));
  });
  ok('未识别项确为站内未收录', realMiss.length === 0, realMiss.join(', '));

  console.log(`\n结果: ${fail === 0 ? '✅ 全部通过' : '❌ ' + fail + ' 项失败'} （${pass}/${pass + fail}）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('ERR', e.stack); process.exit(1); });
