/* AI 补识别：用大模型兜底规则引擎识别不了的行（零依赖，纯逻辑，可注入 fetch 做测试）
   设计要点
   1) 规则先行：82%~96% 的行本地规则就能匹配（免费 / 离线 / 即时），LLM 只处理残留
   2) 做选择题不给填空题：每行先由本地 topCandidates 检索出 top-N 候选塞进 prompt，
      LLM 只能从候选里挑；返回名不在候选内的直接丢弃 —— 这是防幻觉的关键
   3) 数学留在本地：LLM 只负责"读表"（抽出原文数字 + 币种 + 计费单位），
      汇率与单位折算由 toUSD() 计算，可单测、可复算
   4) 密钥不随页面走：默认走本地代理 scripts/llm_proxy.py（绕 CORS + key 不落浏览器）
*/
const AI_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek（默认）', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  { id: 'siliconflow', label: '硅基流动 SiliconFlow', endpoint: 'https://api.siliconflow.cn/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V4.1-Flash' },
  { id: 'openai', label: 'OpenAI', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { id: 'zhipu', label: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
  { id: 'moonshot', label: 'Moonshot Kimi', endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  { id: 'qwen', label: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  { id: 'openrouter', label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'deepseek/deepseek-v4-flash' },
  { id: 'custom', label: '自定义 / OpenAI 兼容', endpoint: '', model: '' },
];

function aiDefaultCfg() {
  const p = AI_PROVIDERS[0];
  const b = aiBuiltin();
  return {
    mode: b && b.mode ? b.mode : 'proxy',      // 内置密钥时按文件里配的模式，开箱即用
    proxyUrl: 'http://127.0.0.1:8787/extract',
    provider: (b && b.provider) || p.id,
    endpoint: (b && b.endpoint) || p.endpoint,
    model: (b && b.model) || p.model,
    key: (b && b.key) || '',
    batch: 25,                                // 每批行数
    maxRows: 300,                             // 单次最多送多少行，防烧钱
    fullBatch: 15,                            // 完整读取每批行数（含表头上下文）
    fullMaxRows: 400,                         // 完整读取单次上限
    retries: 1,
    timeoutMs: 90000,
  };
}

/* ---------------- 内置密钥（构建期注入，见 build_site.obf_key） ----------------
   data/llm_key.json 的密钥被 XOR+base64 混淆后写进页面，打开即可直接用，不必再手填。
   混淆只遮挡明文，不构成安全边界：拿到页面的人同样能调用这个 key。
   公开部署请用 MODELPRICE_EMBED_KEY=0 重新生成，此时 BUILTIN_KEY 为 null。 */
const BUILTIN_KEY = /*__BUILTIN_KEY__*/ null;
const _SALT = 'modelprice-v1';
function maskOf(k) {
  if (!k) return '';
  if (k.length <= 10) return k.slice(0, 2) + '***';
  return k.slice(0, 6) + '••••••••' + k.slice(-4);
}
function aiBuiltin() {
  if (!BUILTIN_KEY || !BUILTIN_KEY.k) return null;
  try {
    const bin = atob(BUILTIN_KEY.k);
    let s = '';
    for (let i = 0; i < bin.length; i++)
      s += String.fromCharCode(bin.charCodeAt(i) ^ _SALT.charCodeAt(i % _SALT.length));
    if (!s) return null;
    return { provider: BUILTIN_KEY.provider, endpoint: BUILTIN_KEY.endpoint,
             model: BUILTIN_KEY.model, mode: BUILTIN_KEY.mode, key: s,
             mask: BUILTIN_KEY.mask || maskOf(s), builtin: true };
  } catch (e) { return null; }
}

/* ---------------- 单位折算（纯数学，可单测） ---------------- */
const FALLBACK_FX = 0.1408;                   // 1 CNY ≈ 0.1408 USD（≈1 USD=7.10 CNY）
function perFactor(per) {
  if (per === '1K') return 1000;
  if (per === '1') return 1e6;
  if (per === '1B') return 0.001;
  return 1;                                   // '1M' / null 按每百万处理
}
/** 原始价格 -> USD / 1M tokens */
function toUSD(v, currency, per, fx) {
  if (v == null || !isFinite(v)) return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  let x = n * perFactor(per);
  if (currency === 'CNY') x *= (fx || FALLBACK_FX);
  return Math.round(x * 1e6) / 1e6;
}

/* ---------------- prompt ---------------- */
const AI_SYSTEM = [
  '你是 LLM API 报价单的结构化抽取助手。',
  '输入是若干「表格行」文本（可能乱序、无表头、中英混排），请从每行抽出模型名与价格。',
  '严格输出 JSON 数组（不要 markdown 代码块、不要解释文字），每项对应一行：',
  '{"row":<行号>,"model":<候选名单里的字符串原样照抄|null>,"input":<数字|null>,',
  ' "output":<数字|null>,"currency":"USD|CNY|null","unit_per":"1M|1K|1|null","conf":"high|medium|low"}',
  '规则：',
  '1. model 只能取该行「候选」里的字符串，原样照抄；行里没有任何候选模型就填 null。宁可 null，不得新造名字。',
  '2. 价格填原文数字，不要换算、不要改单位、不要补币种；没有就 null。',
  '3. unit_per：每百万 token 填 "1M"，每千 token 填 "1K"，每 token 填 "1"，判断不了填 null。',
  '4. currency：表里有 ¥/元/人民币/rmb 填 "CNY"，有 $/美元/USD 填 "USD"，都没有填 null。',
  '5. 分不清输入价/输出价时，把同一个数同时填进 input 和 output，conf 填 "low"。',
  '6. 同一行出现多个候选模型时，取与文本最贴合的那一个。',
].join('\n');

/** 把一行 cells 压成给 LLM 看的文本（丢弃明显的说明性文本） */
function aiRowText(cells) {
  return (cells || []).filter(c => c != null && String(c).trim() !== '')
    .map(c => String(c).replace(/\s+/g, ' ').trim()).join(' | ');
}

/** 构造一批请求体：rows=[{i, cells, cands:[modelName...]}] */
function aiBuildMessages(rows) {
  const lines = rows.map(r => {
    // 只把候选「名字」塞进 prompt（不是整个对象）——省 token，也让 LLM 好选
    const names = [...new Set((r.cands || []).map(m => m.name).filter(Boolean))];
    return `[行 ${r.i}] 候选: ${JSON.stringify(names)}\n  文本: ${aiRowText(r.cells)}`;
  });
  return [
    { role: 'system', content: AI_SYSTEM },
    { role: 'user', content: '请抽取以下各行：\n\n' + lines.join('\n\n') },
  ];
}

/* ---------------- 调用与解析 ---------------- */
async function aiCall(messages, cfg, fetchImpl, extra = {}) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new Error('当前环境不支持 fetch');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 90000);
  try {
    if (cfg.mode === 'proxy') {
      const r = await f(cfg.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, model: cfg.model, temperature: 0,
          extra_headers: extra.extra_headers || undefined }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || ('代理返回 ' + r.status));
      return { content: j.content || '', usage: j.usage || null };
    }
    const r = await f(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (cfg.key || '') },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0, stream: false }),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && (j.error.message || JSON.stringify(j.error))) || ('HTTP ' + r.status));
    const msg = ((j.choices || [])[0] || {}).message || {};
    return { content: msg.content || '', usage: j.usage || null };
  } finally {
    clearTimeout(timer);
  }
}

/** 从回复里抠出 JSON 数组，容忍 ```json 代码块、前后废话、尾随逗号 */
function aiExtractJSON(txt) {
  if (txt == null) return [];
  let s = String(txt).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  let body = s.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch (e) {
    body = body.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]+/g, ' ');
    try { return JSON.parse(body); } catch (e2) { return []; }
  }
}

function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s_]+/g, ''); }

/**
 * 把 LLM 回复归并成可用结果。
 * batch: [{i, cells, cands:[model 对象], unitHint}]   models: 全量模型（保留参数兼容）
 * fx: CNY->USD 汇率
 * 返回 {rows:[{m,in,out,unit,currency,per,note,conf,srcline,rawIn,rawOut}], dropped:[...]}
 */
function aiNormalizeBatch(items, batch, models, fx) {
  // 候选必须按「本行」限定：整批共用一个 Map 会让 A 行填成 B 行的候选模型。
  const nameMapOf = (row) => {
    const map = new Map();
    for (const m of (row.cands || [])) {
      map.set(norm(m.name), m);
      for (const k of (m.keys || [])) map.set(norm(k.replace(/\|/g, ' ')), m);
    }
    return map;
  };
  const out = [], dropped = [];
  for (const it of (items || [])) {
    if (!it || typeof it !== 'object') continue;
    const idx = batch.findIndex(r => String(r.i) === String(it.row));
    if (idx < 0) continue;
    const row = batch[idx];
    const name = (it.model == null || it.model === 'null') ? null : String(it.model).trim();
    let m = null;
    if (name) {
      m = nameMapOf(row).get(norm(name));
      if (!m) {                                   // 兜底：在该行候选里再做一次宽松比对
        const nm = norm(name);
        m = (row.cands || []).find(c => norm(c.name) === nm)
          || (row.cands || []).find(c => nm.length > 4
            && (nm.includes(norm(c.name)) || norm(c.name).includes(nm)));
      }
    }
    if (!m) { dropped.push({ row: row.i, got: name }); continue; }
    if (it.input == null && it.output == null) { dropped.push({ row: row.i, got: name, why: '无价格' }); continue; }
    let cur = it.currency || null, per = it.unit_per || null;
    if (cur !== 'USD' && cur !== 'CNY') cur = (row.unitHint && row.unitHint.currency) || null;
    if (per !== '1M' && per !== '1K' && per !== '1') per = (row.unitHint && row.unitHint.per) || '1M';
    const vin = toUSD(it.input, cur, per, fx);
    const vout = toUSD(it.output, cur, per, fx);
    out.push({
      m, in: vin, out: vout,
      unit: (cur === 'CNY' ? '¥' : cur === 'USD' ? '$' : '') + '/' + (per || '1M'),
      currency: cur, per, note: it.note || '',
      conf: (it.conf === 'high' || it.conf === 'medium' || it.conf === 'low') ? it.conf : 'medium',
      rawIn: it.input, rawOut: it.output, srcline: row.i,
    });
  }
  return { rows: out, dropped };
}

/** 分批执行：rows=[{i, cells, unitHint}] -> {rows, dropped, batches, usage, error} */
async function aiExtract(rows, models, cfg, opts = {}) {
  const fetchImpl = opts.fetchImpl || null;
  const fx = opts.fx || FALLBACK_FX;
  const n = Math.max(1, Math.min(cfg.batch || 25, 2000));
  const cellsToCands = opts.candidates || ((cells) => defaultCandidates(cells, models, 12));
  const batches = [];
  for (let k = 0; k < rows.length; k += n) {
    batches.push(rows.slice(k, k + n).map(r => {
      let cands = cellsToCands(r.cells);
      // 规则引擎已认出模型但没价格的行带 hint：必须把它放进候选，否则 AI 选不到
      if (r.hint) cands = [r.hint, ...cands.filter(m => m.loose !== r.hint.loose)].slice(0, 12);
      return { i: r.i, cells: r.cells, unitHint: r.unitHint || null, cands };
    }));
  }
  const all = [], dropped = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0 }, calls = 0, lastErr = null;
  for (const b of batches) {
    const msgs = aiBuildMessages(b);
    let res = null;
    for (let t = 0; t <= (cfg.retries || 0); t++) {
      try {
        res = await aiCall(msgs, cfg, fetchImpl, opts);
        calls++;
        break;
      } catch (e) {
        lastErr = e;
        if (t === (cfg.retries || 0)) res = null;
      }
    }
    if (!res) continue;
    if (res.usage) {
      usage.prompt_tokens += res.usage.prompt_tokens || 0;
      usage.completion_tokens += res.usage.completion_tokens || 0;
    }
    const got = aiNormalizeBatch(aiExtractJSON(res.content), b, models, fx);
    all.push(...got.rows);
    dropped.push(...got.dropped);
  }
  return { rows: all, dropped, batches: batches.length, calls, usage, error: lastErr };
}

/**
 * 默认候选策略：逐单元格检索再取并集。
 * 整行拼接容易被「备注/单位/序号」等噪声带偏（token 差过大导致候选为空），
 * 而模型名几乎总在某个单独的格子里 —— 逐格检索命中率明显更高。
 */
function defaultCandidates(cells, models, n) {
  n = n || 12;
  const out = [], seen = new Set();
  const push = list => {
    for (const m of list) if (m && !seen.has(m.loose)) { seen.add(m.loose); out.push(m); }
  };
  for (const c of (cells || [])) {
    const s = String(c == null ? '' : c).trim();
    if (!s || s.length > 80) continue;
    if (/^[\d.,\s$¥%/:、-]+$/.test(s)) continue;                       // 纯数字 / 价格
    if (/(token|price|价格|输入|输出|单价|单位|折扣|备注|序号|厂商|供应商)/i.test(s)) continue;
    push(topCandidatesGlobal(s, models, 10));
    if (out.length >= n) break;
  }
  if (!out.length) push(topCandidatesGlobal(aiRowText(cells), models, n));   // 兜底：整行再试
  return out.slice(0, n);
}

/* topCandidates 由 parsers.js 提供；单独 require 时自动去找 */
let _topCands = null;
function topCandidatesGlobal(text, models, n) {
  if (!_topCands) {
    if (typeof topCandidates === 'function') _topCands = topCandidates;
    else if (typeof require === 'function') { try { _topCands = require('./parsers.js').topCandidates; } catch (e) { } }
  }
  return _topCands ? _topCands(text, models, n) : models.slice(0, n);
}

/* ===================================================================
   AI 完整读取（整表结构理解）
   -------------------------------------------------------------------
   规则引擎先跑；用户开启自动完整读取时，把整张报价表分批交给模型：
   - 模型只负责“读表”：返回行号、模型名、规格、目录价/折后价、币种、单位；
   - 数字必须能在原行文本里找到，否则丢弃（防幻觉）；
   - 汇率、折扣、单位折算、比价全部在本地做。
   =================================================================== */
const AI_FULL_SYSTEM = [
  '你是 LLM API 报价单读取助手。输入是一张报价表的行（含表头/合并表头），请完整读取每一个报价行。',
  '严格输出 JSON 数组（不要 markdown、不要解释）。每个对象：',
  '{"row":原始行号,"model":"模型名或null","spec":"规格/分辨率/上下文档位","currency":"USD|CNY",',
  ' "discount":0.7或null,"prices":[{"kind":"input|output|media","unit":"1M|1K|1|image|second|video|step|utf8_mb","list":数字|null,"final":数字|null}],"conf":"high|medium|low"}',
  '规则：',
  '1. 只抄原文数字；不要换算、不要计算、不要补数字。',
  '2. 表里可能有两组价格：目录价（list）和折后价（final）。list 填目录价，final 填折后价；没有折后价列时 final 填 null，discount 填折扣列（0.7 表示 7 折）。',
  '3. 单位：token 价格用 1M；按张 image；按秒 second；按条视频 video；按步 step；按 UTF-8 字节 utf8_mb。',
  '4. 模型名为空时继承上一行；spec 填分辨率/上下文/condition；不是报价行 model 填 null。',
  '5. 不要输出缓存价、上下文长度、RPM/TPM、版本日期、描述等非价格数字。',
  '6. 同一行有多个计价单位（如同时按秒和按条）时，都放进 prices；同一单位取折后价列。',
  '7. 模型名照抄原文，不要翻译、不要改成站内名。',
  '8. 每行格式为“行号 列号:值 | ...”，列号从 0 开始；请按表头列号对齐，不要按视觉顺序猜列。',
  '9. row 必须原样填该行开头的 [行号]，不要重新编号。',
  '示例：{"row":3,"model":"X","spec":"","currency":"USD","discount":0.7,"prices":[{"kind":"input","unit":"1M","list":5,"final":3.5}],"conf":"high"}',
].join('\n');

function looseOf(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/(\d)p(\d)/g, '$1.$2').replace(/[^a-z0-9]/g, '');
}
let _guessModel = null;
function guessModelGlobal(name, models) {
  if (!_guessModel) {
    if (typeof guessModel === 'function') _guessModel = guessModel;
    else if (typeof require === 'function') {
      try { _guessModel = require('./parsers.js').guessModel; } catch (e) { }
    }
  }
  return _guessModel ? _guessModel(name, models) : null;
}
function rawModel(name) {
  return { name, loose: looseOf(name), keys: [], vendor: '', kind: '文本',
    region: 'intl', sources: [], n_src: 0, n_ver: 0, prices: {}, official: null,
    watch: false, has_media: false, _aiUnmatched: true };
}
function numOf(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return isFinite(n) ? n : null;
}
function toUSDUnitPrice(v, currency, fx) {
  if (v == null || !isFinite(Number(v))) return null;
  let x = Number(v);
  if (currency === 'CNY') x *= (fx || FALLBACK_FX);
  return Math.round(x * 1e6) / 1e6;
}
function normUnit(u) {
  const s = String(u == null ? '' : u).toLowerCase().replace(/\s+/g, '');
  if (/image|张/.test(s)) return 'image';
  if (/second|秒|\/s\b|per\s*s/.test(s)) return 'second';
  if (/video|条|视频/.test(s)) return 'video';
  if (/step|步/.test(s)) return 'step';
  if (/utf-?8|字节|byte/.test(s)) return 'utf8_mb';
  if (/request|次/.test(s)) return 'request';
  if (/1k|千|thousand/.test(s)) return '1K';
  if (/^1$|pertoken|每token/.test(s)) return '1';
  return '1M';
}
function rowNumbers(cells) {
  const out = [];
  for (const c of (cells || [])) {
    for (const m of String(c == null ? '' : c).matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  }
  return out;
}
function numberInRow(v, nums) {
  if (v == null) return true;
  const n = Number(v);
  if (!isFinite(n)) return false;
  return nums.some(x => Math.abs(x - n) < 1e-9 ||
    (n !== 0 && Math.abs(x - n) / Math.abs(n) < 1e-6));
}
function aiFullMessages(batch) {
  const lines = batch.map(r => {
    const parts = [];
    (r.cells || []).forEach((c, idx) => {
      const s = String(c == null ? '' : c).replace(/\s+/g, ' ').trim().slice(0, 220);
      if (s) parts.push(`${idx}:${s}`);
    });
    return `[${r.i}] ` + parts.join(' | ');
  });
  return [
    { role: 'system', content: AI_FULL_SYSTEM },
    { role: 'user', content: '报价表（开头可能包含表头/分组表头；每项格式为“列号:值”，列号从 0 开始，和表头对齐）：\n'
      + lines.join('\n') + '\n\n请输出 JSON 数组。' },
  ];
}
function aiNormalizeFull(items, batch, models, fx) {
  const rowMap = new Map(batch.map(r => [String(r.i), r]));
  const out = [], dropped = [], seen = new Set();
  let lastModel = null;
  for (const it of (items || [])) {
    if (!it || typeof it !== 'object') continue;
    const row = rowMap.get(String(it.row));
    if (!row) continue;
    let name = (it.model == null || it.model === 'null') ? null : String(it.model).trim();
    let inherited = false;
    if (!name) { name = lastModel; inherited = true; }
    if (!name) { dropped.push({ row: row.i, why: '无模型' }); continue; }
    const cells = row.cells || [];
    const normText = cells.map(c => String(c == null ? '' : c)).join(' ')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const normName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normName && !normText.includes(normName) && name !== lastModel) {
      dropped.push({ row: row.i, got: name, why: '模型名不在该行' });
      continue;
    }
    lastModel = name;
    const m = guessModelGlobal(name, models) || rawModel(name);
    const spec = String(it.spec == null ? '' : it.spec).trim();
    const curTxt = String(it.currency == null ? 'USD' : it.currency);
    const cur = /cny|rmb|¥|￥|人民|元/i.test(curTxt) ? 'CNY' : 'USD';
    let disc = it.discount == null ? null : numOf(it.discount);
    if (disc != null && disc > 1 && disc <= 100) disc = disc / 100;
    if (!(disc > 0 && disc <= 2)) disc = null;
    const nums = rowNumbers(cells);
    const prices = Array.isArray(it.prices) ? it.prices : [];
    for (const p of prices) {
      if (!p || typeof p !== 'object') continue;
      const unit0 = normUnit(p.unit);
      let list = numOf(p.list), fin = numOf(p.final);
      if (list == null && fin == null) continue;
      // 行内找不到的数字不要（防止模型自己算/编造）；只丢这一项，不丢整行
      if (list != null && !numberInRow(list, nums)) list = null;
      if (fin != null && !numberInRow(fin, nums)) fin = null;
      if (list == null && fin == null) {
        dropped.push({ row: row.i, got: name, why: '数字不在行内' });
        continue;
      }
      const media = ['image', 'second', 'video', 'step', 'utf8_mb', 'request'].includes(unit0);
      const actual = fin != null ? fin : (list != null && disc ? +(list * disc).toFixed(8) : list);
      if (actual == null) continue;
      let price, listPrice, unit = unit0;
      if (unit0 === '1K' || unit0 === '1') {
        price = toUSD(actual, cur, unit0, fx);
        listPrice = list == null ? null : toUSD(list, cur, unit0, fx);
        unit = '1M';
      } else if (media) {
        price = toUSDUnitPrice(actual, cur, fx);
        listPrice = list == null ? null : toUSDUnitPrice(list, cur, fx);
      } else {
        price = toUSD(actual, cur, '1M', fx);
        listPrice = list == null ? null : toUSD(list, cur, '1M', fx);
      }
      if (price == null) continue;
      const kind = media ? 'media' : (String(p.kind || '').toLowerCase() === 'output' ? 'output' : 'input');
      const key = `${row.i}|${unit}|${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        row: row.i, model: m, rawName: name, spec, unit, kind, price, list: listPrice,
        discount: disc, currency: cur,
        conf: ['high', 'medium', 'low'].includes(it.conf) ? it.conf : 'medium',
        rawList: list, rawFinal: fin,
      });
    }
  }
  return { rows: out, dropped };
}
async function aiReadFull(rows, models, cfg, opts = {}) {
  const fetchImpl = opts.fetchImpl || null;
  const fx = opts.fx || FALLBACK_FX;
  const batchSize = Math.max(5, Math.min(cfg.fullBatch || 15, 100));
  const maxRows = Math.min(rows.length, opts.maxRows || cfg.fullMaxRows || 400);
  const batches = [];
  // 表头要在每一批里重复，否则第二批判断不了列
  const headers = rows.slice(0, 2);
  for (let k = 0; k < maxRows; k += batchSize) {
    const b = rows.slice(k, k + batchSize);
    const ctx = headers.filter(h => !b.includes(h));
    batches.push(ctx.concat(b));
  }
  const all = [], dropped = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0 }, calls = 0, lastErr = null;
  for (const b of batches) {
    const msgs = aiFullMessages(b);
    let res = null;
    for (let t = 0; t <= (cfg.retries || 0); t++) {
      try { res = await aiCall(msgs, cfg, fetchImpl, opts); calls++; break; }
      catch (e) { lastErr = e; if (t === (cfg.retries || 0)) res = null; }
    }
    if (!res) continue;
    if (res.usage) {
      usage.prompt_tokens += res.usage.prompt_tokens || 0;
      usage.completion_tokens += res.usage.completion_tokens || 0;
    }
    const got = aiNormalizeFull(aiExtractJSON(res.content), b, models, fx);
    all.push(...got.rows);
    dropped.push(...got.dropped);
  }
  return { rows: all, dropped, batches: batches.length, calls, usage, error: lastErr };
}

if (typeof module !== 'undefined') module.exports = {
  AI_PROVIDERS, aiDefaultCfg, aiBuildMessages, aiRowText, aiCall, aiExtractJSON,
  aiNormalizeBatch, aiExtract, toUSD, perFactor, FALLBACK_FX, AI_SYSTEM,
  AI_FULL_SYSTEM, aiFullMessages, aiNormalizeFull, aiReadFull, toUSDUnitPrice,
};
