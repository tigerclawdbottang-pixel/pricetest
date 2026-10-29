/* AI 补识别单元测试（用假 fetch，不真实调用厂商 API、不花钱）
   覆盖：单位折算 / JSON 容错 / 候选注入 / 幻觉过滤 / 批处理与重试 / 端到端合并
   运行：node scripts/test_llm.js
*/
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../web/parsers.js');
const L = require('../web/llm.js');

const errs = [];
function ok(name, cond, extra) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  → ' + extra : ''}`);
  if (!cond) errs.push(name);
}
function near(a, b, t = 1e-6) { return a != null && Math.abs(a - b) <= t; }

const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'data.json'), 'utf-8'));
const MODELS = D.models;
const FX = (D.fx && D.fx.usd_per_cny) || L.FALLBACK_FX;

console.log('=== 单位折算（数学留在本机，不由大模型算）===');
ok('美元 / 1M 原值不改', near(L.toUSD(3, 'USD', '1M', FX), 3), L.toUSD(3, 'USD', '1M', FX));
ok('人民币 ¥12 / 1M 折算', near(L.toUSD(12, 'CNY', '1M', 0.15), 1.8), L.toUSD(12, 'CNY', '1M', 0.15));
ok('¥1 / 1K → ×1000 再折汇率', near(L.toUSD(1, 'CNY', '1K', 0.15), 150), L.toUSD(1, 'CNY', '1K', 0.15));
ok('$0.5 / 1K → 500', near(L.toUSD(0.5, 'USD', '1K', FX), 500), L.toUSD(0.5, 'USD', '1K', FX));
ok('per 为空按 1M 处理', near(L.toUSD(2, 'USD', null, FX), 2), L.toUSD(2, 'USD', null, FX));
ok('负数与非法值返回 null', L.toUSD(-1, 'USD', '1M', FX) === null && L.toUSD('x', 'USD', '1M', FX) === null);
ok('perFactor 1B 缩小 1000 倍', near(L.perFactor('1B'), 0.001), L.perFactor('1B'));

console.log('\n=== 本地检索：给 LLM 的候选清单 ===');
const c1 = P.topCandidates('ByteDance-Seed-2.0-mini', MODELS, 12);
ok('乱序命名也能进候选', c1.some(m => m.loose === 'seed20mini'), c1.slice(0, 3).map(m => m.name).join(' / '));
const c2 = P.topCandidates('Claude 5 Fable（企业版）', MODELS, 12);
ok('Claude-5-fable 命中 Fable 5', c2.some(m => m.loose === 'claudefable5'), c2.slice(0, 3).map(m => m.name).join(' / '));
ok('候选数量受限（省 token）', P.topCandidates('GPT-5', MODELS, 8).length <= 8);
ok('空文本不返回候选', P.topCandidates('', MODELS, 8).length === 0);

console.log('\n=== 计价单位识别 ===');
ok('识别 ¥ / 百万tokens', JSON.stringify(P.readUnit('价格 ¥/百万tokens')) === JSON.stringify({ currency: 'CNY', per: '1M' }),
  JSON.stringify(P.readUnit('价格 ¥/百万tokens')));
ok('识别 USD per 1K', JSON.stringify(P.readUnit('USD per 1K tokens')) === JSON.stringify({ currency: 'USD', per: '1K' }),
  JSON.stringify(P.readUnit('USD per 1K tokens')));
ok('无单位信息返回空', P.readUnit('DeepSeek V4 Pro').currency === null);

console.log('\n=== JSON 容错（大模型爱加代码块和废话）===');
ok('纯 JSON 数组', L.aiExtractJSON('[{"row":1}]').length === 1);
ok('markdown 代码块', L.aiExtractJSON('```json\n[{"row":1,"model":"x"}]\n```').length === 1);
ok('前后废话 + 尾随逗号', L.aiExtractJSON('好的，结果如下：\n[{"row":1,"model":"x"},]\n希望对你有帮助').length === 1);
ok('完全不是 JSON 返回空数组', L.aiExtractJSON('抱歉我无法处理').length === 0);

console.log('\n=== 回复归并：幻觉过滤 ===');
const candModels = [
  { loose: 'deepseekv4pro', name: 'DeepSeek V4 Pro', vendor: 'DeepSeek', n_src: 4, keys: ['DeepSeek|V4|pro'] },
  { loose: 'qwen38max', name: 'Qwen3.8 Max', vendor: 'Alibaba', n_src: 4, keys: ['Qwen3.8|Max'] },
];
const batch = [
  { i: 0, cells: ['deepseek-ai/DeepSeek-V4-Pro', '12', '24', '¥/M'], unitHint: { currency: 'CNY', per: '1M' }, cands: candModels },
  { i: 1, cells: ['Qwen3.8 Max (0902)', '1.2', '6'], unitHint: { currency: null, per: null }, cands: candModels },
  { i: 2, cells: ['随便一行说明文字'], unitHint: null, cands: candModels },
  { i: 3, cells: ['通义某模型', '5', '9'], unitHint: null, cands: candModels },
];
const reply = [
  { row: 0, model: 'DeepSeek V4 Pro', input: 12, output: 24, currency: 'CNY', unit_per: '1M', conf: 'high' },
  { row: 1, model: '  deepseek v4 pro  ', input: 30, output: 60, currency: 'CNY', unit_per: '1M', conf: 'medium' },
  { row: 2, model: null, input: null, output: null, currency: null, unit_per: null, conf: 'low' },
  { row: 3, model: 'GPT-9000 Ultra', input: 1, output: 2, currency: 'USD', unit_per: '1M', conf: 'high' },
];
const nb = L.aiNormalizeBatch(reply, batch, MODELS, 0.15);
ok('正常行命中并折算', nb.rows.length === 2 && near(nb.rows[0].in, 1.8) && near(nb.rows[0].out, 3.6),
  nb.rows.map(r => `${r.m.name} in=${r.in} out=${r.out}`).join(' / '));
ok('大小写/空格差异仍命中', nb.rows.some(r => r.m.loose === 'deepseekv4pro' && near(r.in, 4.5)),
  JSON.stringify(nb.rows[1] && { n: nb.rows[1].m.name, in: nb.rows[1].in }));
ok('model=null 的行被丢弃', nb.dropped.some(d => d.row === 2));
ok('编造的模型名被丢弃（防幻觉）', nb.dropped.some(d => String(d.got).includes('9000')), JSON.stringify(nb.dropped));
ok('保留原始值与单位便于核对', nb.rows[0].rawIn === 12 && nb.rows[0].unit === '¥/1M', JSON.stringify(nb.rows[0].unit));
const nb2 = L.aiNormalizeBatch(
  [{ row: 1, model: 'Qwen3.8 Max', input: 5, output: 5, currency: null, unit_per: null, conf: 'low' }],
  [{ ...batch[1], unitHint: { currency: 'CNY', per: '1M' } }], MODELS, 0.15);
ok('币种缺失时回退本地单位识别', nb2.rows[0] && nb2.rows[0].currency === 'CNY' && near(nb2.rows[0].in, 0.75),
  JSON.stringify(nb2.rows[0] && { cur: nb2.rows[0].currency, in: nb2.rows[0].in, unit: nb2.rows[0].unit }));
const nb3 = L.aiNormalizeBatch([{ row: 0, model: 'DeepSeek V4 Pro', input: null, output: null }], batch, MODELS, 0.15);
ok('无价格的行被丢弃', nb3.rows.length === 0 && nb3.dropped.length === 1);
const crossBatch = [
  { i: 0, cands: [candModels[0]] },              // 第 0 行只允许 DeepSeek
  { i: 1, cands: [candModels[1]] },              // 第 1 行只允许 Qwen
];
const cross = L.aiNormalizeBatch(
  [{ row: 0, model: 'Qwen3.8 Max', input: 1, output: 2 }], crossBatch, MODELS, FX);
ok('跨行候选不匹配被丢弃（候选按行限定）', cross.rows.length === 0 && cross.dropped.length === 1,
  JSON.stringify(cross));

console.log('\n=== prompt 构造 ===');
const msgs = L.aiBuildMessages([{ i: 0, cells: ['a', 'b'], cands: candModels }]);
ok('system 提示要求输出 JSON 且禁造名字', /JSON/.test(msgs[0].content) && /不得新造|只能取/.test(msgs[0].content));
ok('user 消息注入候选名与行文本', msgs[1].content.includes('DeepSeek V4 Pro') && msgs[1].content.includes('a | b'));
ok('要求模型「不要自己换算」', /不要换算/.test(msgs[0].content));

console.log('\n=== 调用层：代理 / 直连 / 分批 / 重试 ===');
function mkFetch(replies, log) {
  log = log || [];
  let k = 0;
  return async (url, opt) => {
    const body = JSON.parse(opt.body);
    log.push({ url, headers: opt.headers, body });
    const r = typeof replies === 'function' ? replies(url, body, k) : replies[Math.min(k, replies.length - 1)];
    k++;
    if (r.throw) throw new Error(r.throw);
    return {
      ok: true, status: 200,
      // 同时兼容代理（content/usage）与 OpenAI 直连（choices）两种返回格式
      json: async () => ({
        choices: [{ message: { content: r.content } }], usage: r.usage || null,
        content: r.content, // proxy
      }),
    };
  };
}
(async () => {
  const log = [];
  const cfgP = Object.assign(L.aiDefaultCfg(), { mode: 'proxy', model: 'm-test' });
  const r1 = await L.aiCall([{ role: 'user', content: 'hi' }], cfgP,
    mkFetch(() => ({ __proxy: true, content: '{"a":1}', usage: { prompt_tokens: 10, completion_tokens: 4 } }), log));
  ok('代理模式打到 proxyUrl', log[0].url === cfgP.proxyUrl);
  ok('代理模式不发送 Authorization', !log[0].headers.Authorization);
  ok('代理模式把 model 放进 body', log[0].body.model === 'm-test');
  ok('代理返回 content 与 usage', r1.content === '{"a":1}' && r1.usage.prompt_tokens === 10);

  const log2 = [];
  const cfg2 = Object.assign(L.aiDefaultCfg(), { mode: 'direct', key: 'sk-x' });
  await L.aiCall([{ role: 'user', content: 'hi' }], cfg2, mkFetch([{ content: 'ok' }], log2));
  ok('直连模式带 Bearer Key', log2[0].headers.Authorization === 'Bearer sk-x');
  ok('直连模式打到厂商 endpoint', log2[0].url === cfg2.endpoint);

  let called = 0;
  const retryFetch = mkFetch(() => { called++; return { content: '[]' }; });
  const cfgR = Object.assign(L.aiDefaultCfg(), { mode: 'proxy', retries: 2 });
  let boom = 0;
  const failFetch = async () => { boom++; throw new Error('500 boom'); };
  await L.aiCall([], cfgR, failFetch).catch(() => { });
  ok('失败时不吞异常（aiExtract 会重试并记账）', boom === 1, '抛 Error 由上层重试');
  await L.aiCall([], cfgR, retryFetch);
  ok('正常调用无异常', called === 1);

  console.log('\n=== 端到端 aiExtract（假 LLM）===');
  const rows = [
    { i: 1, cells: ['DeepSeek-V4-Pro', '12', '24'], unitHint: { currency: 'CNY', per: '1M' } },
    { i: 2, cells: ['毫无意义的一行备注'], unitHint: null },
  ];
  // 假 LLM 只能从 prompt 注入的候选名单里挑（真实 prompt 就是这么要求的）
  const fakeLLM = (url, body) => {
    const txt = body.messages[1].content;
    const cm = /\[行 1\] 候选: (\[[^\]]*\])/.exec(txt);
    const cands = cm ? JSON.parse(cm[1]) : [];
    const pick = cands.find(x => /V4[\s-]?Pro/i.test(x)) || cands[0] || null;
    return {
      content: JSON.stringify([
        { row: 1, model: pick, input: 12, output: 24, currency: 'CNY', unit_per: '1M', conf: 'high' },
        { row: 2, model: null, input: null, output: null, currency: null, unit_per: null, conf: 'low' },
      ]),
      usage: { prompt_tokens: 300, completion_tokens: 80 },
    };
  };
  const cfg3 = Object.assign(L.aiDefaultCfg(), { mode: 'proxy', batch: 25, retries: 0 });
  const res = await L.aiExtract(rows, MODELS, cfg3, { fetchImpl: mkFetch(fakeLLM, []), fx: 0.15 });
  ok('返回 1 条有效结果', res.rows.length === 1, JSON.stringify(res.rows.map(r => r.m.name)));
  ok('汇率折算正确 ¥12→$1.8', near(res.rows[0].in, 1.8) && near(res.rows[0].out, 3.6), `${res.rows[0].in}/${res.rows[0].out}`);
  ok('无效行被丢弃', res.dropped.length === 1);
  ok('usage 已累计（可估算成本）', res.usage.prompt_tokens === 300 && res.usage.completion_tokens === 80);
  ok('批次与调用次数正确', res.batches === 1 && res.calls === 1, `batches=${res.batches} calls=${res.calls}`);

  const cfg4 = Object.assign(L.aiDefaultCfg(), { mode: 'proxy', batch: 1, retries: 0 });
  const res4 = await L.aiExtract(rows, MODELS, cfg4, { fetchImpl: mkFetch(fakeLLM, []), fx: 0.15 });
  ok('batch=1 时分 2 批', res4.batches === 2, `batches=${res4.batches}`);

  const res5 = await L.aiExtract(rows, MODELS, Object.assign(cfg3, { retries: 1 }),
    { fetchImpl: async () => { throw new Error('boom'); }, fx: 0.15 });
  ok('全部失败时返回 0 条并带 error', res5.rows.length === 0 && !!res5.error, res5.error && res5.error.message);

  let hintPrompt = '';
  await L.aiExtract(
    [{ i: 7, cells: ['整段描述没有模型名', '12', '24'], unitHint: { currency: 'USD', per: '1M' }, hint: candModels[0] }],
    MODELS, cfg3,
    { fetchImpl: async (u, o) => {
        hintPrompt = JSON.parse(o.body).messages[1].content;
        return { ok: true, status: 200, json: async () => ({ content: '[]', usage: null }) };
      }, fx: 0.15 });
  ok('规则已识别但缺价的行把 hint 注入候选', /DeepSeek V4 Pro/.test(hintPrompt), hintPrompt.slice(0, 90));

  console.log('\n=== AI 完整读取（整表） ===');
  const fullRows = [
    { i: 3, cells: ['文本', 'Claude Opus 4.8', 'Claude Opus', '', 'claude-opus-4-8',
      'Anthropic', 'SANSHENG', '文本', '文本', '否', '1000000', '128000', '60', '200000', '10',
      '', '', '', '', '', '', 'P0', '5', '6.25', '10', '0.5', '25', '0.7', '3.5', '4.375', '7', '0.35', '17.5'] },
    { i: 4, cells: ['图像', 'nano banana 2', 'Google Image', 'resolution=1K', 'Google',
      'SANSHENG', '文本、图像', '图像', '否', '120', '180', '2000000', '80',
      '', '', '', '', '', '', '', 'P0', '0.067', '0.5', '0.5', '0.05', '0.05', '0.05', '0.05', '3', '0.7', '0.0469'] },
  ];
  const fullReply = [
    { row: 3, model: 'Claude Opus 4.8', spec: '', currency: 'USD', discount: 0.7,
      prices: [{ kind: 'input', unit: '1M', list: 5, final: 3.5 },
               { kind: 'output', unit: '1M', list: 25, final: 17.5 }], conf: 'high' },
    { row: 4, model: 'nano banana 2', spec: 'resolution=1K', currency: 'USD', discount: 0.7,
      prices: [{ kind: 'media', unit: 'image', list: 0.067, final: 0.0469 }], conf: 'high' },
    { row: 4, model: 'nano banana 2', spec: 'resolution=1K', currency: 'USD',
      prices: [{ kind: 'media', unit: 'image', list: 999, final: 999 }], conf: 'low' },
  ];
  const fullFetch = mkFetch([{ content: JSON.stringify(fullReply),
    usage: { prompt_tokens: 120, completion_tokens: 60 } }]);
  const cfgFull = Object.assign(L.aiDefaultCfg(), { mode: 'proxy', retries: 0, fullBatch: 20 });
  const fullRes = await L.aiReadFull(fullRows, MODELS, cfgFull, { fetchImpl: fullFetch, fx: 0.15 });
  ok('完整读取返回 token + media', fullRes.rows.length === 3,
    JSON.stringify(fullRes.rows.map(r => [r.kind, r.unit, r.price])));
  ok('文本 input 3.5 / output 17.5',
    fullRes.rows.some(r => r.kind === 'input' && near(r.price, 3.5)) &&
    fullRes.rows.some(r => r.kind === 'output' && near(r.price, 17.5)));
  ok('媒体 image 0.0469', fullRes.rows.some(r => r.kind === 'media' && r.unit === 'image' && near(r.price, 0.0469)),
    JSON.stringify(fullRes.rows.find(r => r.kind === 'media')));
  ok('行内不存在的数字被丢弃（防幻觉）', fullRes.dropped.some(d => d.why === '数字不在行内'),
    JSON.stringify(fullRes.dropped));
  ok('完整读取 usage 已累计', fullRes.usage.prompt_tokens === 120 && fullRes.usage.completion_tokens === 60);

  console.log('\n=== 配置默认值 ===');
  ok('默认走本地代理', L.aiDefaultCfg().mode === 'proxy');
  ok('预设含硅基流动且给的是便宜模型',
    L.AI_PROVIDERS.some(p => p.id === 'siliconflow' && /flash/i.test(p.model)),
    (L.AI_PROVIDERS.find(p => p.id === 'siliconflow') || {}).model);
  ok('有批量上限防烧钱', L.aiDefaultCfg().maxRows >= 50);

  console.log('\n结果: ' + (errs.length ? '❌ ' + errs.length + ' 项失败\n' + errs.join('\n') : '✅ 全部通过'));
  process.exit(errs.length ? 1 : 0);
})();
