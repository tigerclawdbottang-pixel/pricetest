/* AI 补识别端到端测试（可选）
   有本地代理就走代理；没有但 data/llm_key.json 配了内置密钥，就走浏览器直连。
   两者都没有时才跳过（不会算失败）。
   跑法：
     1) python3 scripts/llm_proxy.py --provider deepseek --key sk-xxx
     2) node scripts/test_ai_e2e.js
     3) 换模型：AI_MODEL=deepseek-chat node scripts/test_ai_e2e.js
   验证链路：页面 → 传输层 → LLM → 回复解析 → 单位折算 → 合并去重 → 渲染 AI 角标
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'web', 'index.html');
const PROXY = process.env.AI_PROXY || 'http://127.0.0.1:8787';
const MODEL = process.env.AI_MODEL || 'deepseek-chat';   // 需与代理背后服务商支持的模型名一致
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 规则引擎识别不出、但语义清晰的写法：整段描述挤在一格里 */
const PASTE = [
  '服务项\t说明',
  'DeepSeek V4 Pro 0813 ¥13/¥39 每百万token\t含税直连价',
  'Qwen3.8 Max 0902 $2.0/$8.0 per 1M tokens\t海外节点报价',
].join('\n');

(async () => {
  /* 优先用本地代理；代理没起但页面内置了密钥时改用直连，两种都没有才跳过 */
  let mode = 'proxy', key = '', endpoint = '';
  try {
    const r = await fetch(PROXY + '/health');
    if (!r.ok) throw new Error('health ' + r.status);
    console.log('代理在线：', (await r.text()).slice(0, 80));
  } catch (e) {
    let b = null;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'llm_key.json'), 'utf-8'));
      if (j && j.key) b = j;
    } catch (e2) { }
    if (!b) {
      console.log('⚠️  未检测到本地代理，也没有内置密钥，跳过 AI 端到端测试');
      console.log('   启动方式：python3 scripts/llm_proxy.py --provider deepseek --key sk-xxx');
      console.log('   或把密钥写进 data/llm_key.json 后 python3 scripts/build_site.py');
      process.exit(0);
    }
    mode = b.mode || 'direct'; key = b.key; endpoint = b.endpoint || '';
    console.log('代理未启动 → 改用页面内置密钥直连（' + (b.provider || '') + ' / ' + (b.model || '') + '）');
  }

  // 页面脚本执行前预置 AI 配置（避免沿用默认 provider 的模型名）
  const preCfg = JSON.stringify({
    mode, proxyUrl: PROXY + '/extract', provider: 'custom',
    endpoint: mode === 'direct' ? endpoint : '', model: MODEL, key: key,
    batch: 25, maxRows: 300, retries: 1, timeoutMs: 90000,
    autoFull: false,   // 这个测试只验证「AI 补识别（仅漏行）」，关闭自动完整读取
  });
  const dom = new JSDOM(fs.readFileSync(HTML, 'utf-8'), {
    runScripts: 'dangerously', url: 'https://localhost/', pretendToBeVisual: true,
    beforeParse(win) {
      try { win.localStorage.setItem('modelprice.llm.v1', preCfg); } catch (e) { }
    },
  });
  const win = dom.window;
  win.fetch = (u, o) => fetch(u, o);            // jsdom 不实现 fetch
  const $ = id => win.document.getElementById(id);
  const errs = [];
  const ok = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}${x ? '  → ' + x : ''}`); if (!c) errs.push(n); };

  await sleep(900);
  win.document.querySelector('.tab[data-t="upload"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  $('paste').value = PASTE;
  $('pasteBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(300);

  const beforeN = win.__MP ? win.__MP.S.uploadRows.length
    : win.document.querySelectorAll('#upResult table tbody tr').length;
  // 「上传 输入价」列的位置按表头找（多档行的模型列用了 rowspan，列数会少 1）
  const heads = [...win.document.querySelectorAll('#upResult table thead th')].map(x => x.textContent.trim());
  const idxIn = heads.findIndex(h => h.includes('上传 输入价'));
  const noPrice = () => [...win.document.querySelectorAll('#upResult table tbody tr')].filter(tr => {
    const tds = tr.querySelectorAll('td');
    const off = (tds.length === heads.length) ? 0 : 1;
    const cell = tds[Math.max(0, idxIn - off)];
    return cell && /—/.test(cell.textContent || '');
  }).length;
  const beforeNoPrice = noPrice();
  const btnTxt = $('aiBtn').textContent.trim();
  console.log(`规则引擎：${beforeN} 个模型，其中 ${beforeNoPrice} 行缺价格`);
  ok('存在规则处理不了的行（未识别或缺价格）',
    /\d+ 行未识别|\d+ 行缺价格/.test(btnTxt), btnTxt);

  $('aiBtn').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const t = $('aiNote').textContent;
    if (/完成|失败|异常/.test(t)) break;
  }
  const note = $('aiNote').textContent.trim();
  console.log('AI 结果：', note);
  const afterN = win.document.querySelectorAll('#upResult table tbody tr').length;
  const aiTags = win.document.querySelectorAll('#upResult .tag.ai').length;
  const units = [...win.document.querySelectorAll('#upResult .unit')].map(x => x.textContent);
  const afterNoPrice = noPrice();
  ok('AI 调用完成', /完成/.test(note), note.replace(/<[^>]+>/g, ''));
  ok('AI 补上了新模型或缺失价格',
    afterN > beforeN || afterNoPrice < beforeNoPrice,
    `模型 ${beforeN}→${afterN}，缺价格 ${beforeNoPrice}→${afterNoPrice}`);
  ok('AI 结果打了 AI 角标', aiTags > 0, aiTags + ' 个');
  ok('显示原始单位便于核对', units.length > 0, JSON.stringify(units));
  ok('AI 行的价格已折算为 USD', win.document.querySelector('#upResult table tbody tr .unit') &&
    parseFloat(win.document.querySelector('#upResult table tbody tr .unit').parentNode.textContent) > 0,
    (win.document.querySelector('#upResult table tbody tr .unit') || {}).parentNode
      ? win.document.querySelector('#upResult table tbody tr .unit').parentNode.textContent : '');

  [...win.document.querySelectorAll('#upResult table tbody tr')].forEach(tr => {
    const tds = [...tr.querySelectorAll('td')].slice(0, 5)
      .map(td => td.textContent.trim().replace(/\s+/g, ' ')).join(' | ');
    console.log('   ·', tds);
  });

  console.log('\n结果: ' + (errs.length ? '❌ ' + errs.length + ' 项失败' : '✅ AI 补识别端到端通过'));
  win.close();
  process.exit(errs.length ? 1 : 0);
})();
