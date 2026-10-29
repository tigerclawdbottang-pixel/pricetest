/* parsers.js 独立测试：真实 xlsx/docx 二进制解析 + 智能识别 */
const fs = require('fs');
const path = require('path');
const P = require(path.join(__dirname, '..', 'web', 'parsers.js'));
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'data.json'), 'utf8'));

(async () => {
  let fail = 0;
  const ok = (n, c, e) => { console.log((c ? '  PASS ' : '  FAIL ') + n + (e ? '  → ' + e : '')); if (!c) fail++; };

  const FIX = path.join(__dirname, 'fixtures');
  const fx = p => fs.existsSync(path.join(FIX, p)) ? path.join(FIX, p) : '/tmp/' + p;
  const f1 = await P.unzip(fs.readFileSync(fx('test.xlsx')));
  console.log('xlsx 条目:', Object.keys(f1).join(', ') || '(空)');
  const rows = P.parseXlsx(f1);
  console.log('xlsx 前 3 行:'); rows.slice(0, 3).forEach(r => console.log('   ', JSON.stringify(r)));
  ok('xlsx 解析出 7 行', rows.length === 7, rows.length + ' 行');
  ok('xlsx 字符串正确还原 (sharedStrings)', rows[1][0] === 'Claude Sonnet 5', rows[1][0]);
  ok('xlsx 数字正确', parseFloat(rows[1][1]) === 2 && parseFloat(rows[1][2]) === 10);

  // 自闭合空单元格不能吞掉下一格（真实报价单里 <c r="D3" s="94"/> 很常见）
  const xr = P.xmlRows('<row r="3"><c r="A3" t="inlineStr"><is><t>A</t></is></c><c r="B3" s="1"/><c r="C3" t="n"><v>5</v></c></row>');
  ok('自闭合空单元格不吞下一格', xr[0] && xr[0].length === 3 && xr[0][1].v === '' && xr[0][2].v === '5', JSON.stringify(xr));
  // 价格列定位：忽略模态「输入/输出」和上下文长度，优先带 USD/价格 的表头
  const H = ['类型标签','模型名称','输入','输出','上下文长度','RPM','Input (USD/M Tokens)','Output (USD/M Tokens)','折扣'];
  const c = P.detectColumns([H]);
  ok('价格列定位到 USD 列而非模态列', c && c.model === 1 && c.input === 6 && c.output === 7 && c.discount === 8, JSON.stringify(c));
  ok('上下文长度不被当成区间列', c && c.tier == null, c && c.tier);

  const rows2 = P.parseDocx(await P.unzip(fs.readFileSync(fx('test.docx'))));
  console.log('docx 前 3 行:'); rows2.slice(0, 3).forEach(r => console.log('   ', JSON.stringify(r)));
  ok('docx 解析出 7 行', rows2.length === 7, rows2.length + ' 行');
  ok('docx 单元格文本正确', rows2[1][0] === 'Claude Sonnet 5' && parseFloat(rows2[1][2]) === 10);

  console.log('--- 智能模型识别 ---');
  const cases = [
    ['Claude Sonnet 5', true], ['DeepSeek V4 Pro', true], ['GLM 5.3', true],
    ['KIMI K3', true], ['Qwen 3.8 MAX', true], ['MiniMax M2', true],
    ['claude-sonnet-5', true], ['DeepSeek: DeepSeek V4 Pro', true],
    ['glm-5.3-flash', true], ['Qwen3.8-Max', true], ['minimax-m3p1-flash', true],
    ['随便一个名字', false], ['12345', false], ['', false],
  ];
  for (const [t, expect] of cases) {
    const m = P.guessModel(t, D.models);
    const hit = !!m;
    ok(`识别 "${t}" ${expect ? '应命中' : '应不命中'}`, hit === expect,
      m ? m.name + ' [' + m.loose + ']' : '未识别');
  }

  console.log('--- 价格识别 ---');
  for (const [t, exp] of [['2.0', 2], ['$1.32', 1.32], ['0,28', 0.28], ['¥0.6', 0.6],
  ['1,234.56', 1234.56], ['abc', null], ['123456', null], ['-1', null], ['', null]]) {
    const v = P.guessPrice(t);
    ok(`价格 "${t}"`, v === exp, String(v));
  }

  console.log('--- CSV/TSV ---');
  const csv = P.parseDelim('Model,Input,Output\nClaude Sonnet 5,2.0,10.0');
  ok('CSV 解析', csv.length === 2 && csv[1][0] === 'Claude Sonnet 5', JSON.stringify(csv[1]));
  const tsv = P.parseDelim('Model\tInput\tOutput\nGLM 5.3\t0.28\t0.88');
  ok('TSV 解析', tsv.length === 2 && tsv[1][0] === 'GLM 5.3', JSON.stringify(tsv[1]));

  console.log('\n结果: ' + (fail ? '❌ ' + fail + ' 项失败' : '✅ 全部通过'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('❌', e.stack); process.exit(1); });
