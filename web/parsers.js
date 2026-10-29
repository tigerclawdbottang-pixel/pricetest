/* 文件解析与智能识别模块（零依赖，纯函数，可独立测试）
   - unzip: 最小 zip 读取器（xlsx/docx 本质是 zip）
   - parseXlsx / parseDocx / parseDelim: 表格提取
   - guessModel / guessPrice: 无固定格式的智能列识别
   说明：仅浏览器环境使用（依赖 DecompressionStream / Blob / Response）
*/
async function inflate(raw) {
  const ds = new DecompressionStream('deflate-raw');
  const ab = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}
async function unzip(buf) {
  const u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip / Office 文件');
  const n = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const entries = [];
  // 阶段一：同步收集所有条目元数据与原始字节
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nlen));
    const dstart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    entries.push({ name, method, raw: u8.slice(dstart, dstart + csize) });
    off += 46 + nlen + elen + clen;
  }
  // 阶段二：按需解压
  const files = {};
  for (const e of entries) {
    if (e.method === 0) files[e.name] = dec.decode(e.raw);
    else if (e.method === 8) files[e.name] = dec.decode(await inflate(e.raw));
    else throw new Error('不支持的压缩方式 ' + e.method);
  }
  return files;
}

/* "AB12" -> 27（从 0 开始）。Excel 会省略空单元格，
   必须按 r="C3" 的列坐标补空占位，否则续行/缺序号行会整行左移。 */
function colIndex(ref) {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function xmlRows(xml) {
  const out = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;  // 自闭合必须放前面，否则空单元格会吞掉下一格
    let cm;
    while ((cm = cellRe.exec(rm[1] || ''))) {
      const attrs = cm[1] || cm[2] || '';
      const inner = cm[3] || '';
      const t = (/t="([^"]*)"/.exec(attrs) || [])[1] || 'n';
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner) || /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      const v = vm ? xmlDecode(vm[1]) : '';
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs);
      const ci = ref ? colIndex(ref[1]) : -1;
      if (ci >= 0) {
        while (row.length < ci) row.push({ v: '', t: 'n' });
        row[ci] = { v, t };
      } else {
        row.push({ v, t });
      }
    }
    if (row.length) out.push(row);
  }
  return out;
}

/* XML 实体解码：除基本 5 个外还要处理 &#xA; &#10; 这类数字实体（Excel 表头换行常见） */
function xmlDecode(s) {
  return String(s).replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
/* 读 workbook.xml + rels，得到 [{name, file, hidden}]，顺序即 Excel 里的标签顺序 */
function xlsxSheets(files) {
  const wb = files['xl/workbook.xml'] || '';
  const rels = files['xl/_rels/workbook.xml.rels'] || '';
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = {};
    for (const kv of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) a[kv[1]] = kv[2];
    if (a.Id && a.Target) target[a.Id] = a.Target.replace(/^\/?xl\//, '').replace(/^\/?/, '');
  }
  const out = [];
  const seg = wb.slice(wb.indexOf('<sheets>'), wb.indexOf('</sheets>') + 9);
  for (const m of seg.matchAll(/<sheet\b([^>]*?)(?:\/>|>(?:\s*<\/sheet>)?)/g)) {
    const a = {};
    for (const kv of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) a[kv[1]] = kv[2];
    if (!a.name) continue;
    const t = target[a['r:id']] || '';
    const file = 'xl/' + t;
    if (files[file]) out.push({ name: a.name, file, hidden: a.state === 'hidden' });
  }
  // 兜底：workbook 解析失败时按文件名排序
  if (!out.length) {
    for (const k of Object.keys(files).filter(x => /^xl\/worksheets\/sheet\d+\.xml$/.test(x))
      .sort((a, b) => (parseInt(a.match(/\d+/)[0]) || 0) - (parseInt(b.match(/\d+/)[0]) || 0)))
      out.push({ name: k.replace(/^xl\/worksheets\//, ''), file: k, hidden: false });
  }
  return out;
}
/* 返回 [{name, hidden, rows}] —— 保留 sheet 边界，便于让用户选择 */
function parseXlsxSheets(files) {
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const re = /<si>([\s\S]*?)<\/si>/g; let m;
    while ((m = re.exec(files['xl/sharedStrings.xml']))) shared.push(xmlDecode(m[1]));
  }
  return xlsxSheets(files).map(sh => ({
    name: sh.name, hidden: sh.hidden,
    rows: xmlRows(files[sh.file]).map(r => r.map(c =>
      (c.t === 's' && String(c.v).trim() !== '') ? (shared[+c.v] ?? c.v) : c.v)),
  }));
}
function parseXlsx(files) {
  const rows = [];
  for (const sh of parseXlsxSheets(files)) {
    for (const r of sh.rows) rows.push(r);
    if (rows.length > 5000) break;
  }
  return rows;
}

function parseDocx(files) {
  const xml = files['word/document.xml'] || '';
  const rows = [];
  const trRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g; let tm;
  while ((tm = trRe.exec(xml))) {
    const cells = [];
    const tcRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g; let cm;
    while ((cm = tcRe.exec(tm[1]))) {
      // 必须写成 <w:t> 或 <w:t ...>，否则会误匹配 <w:tcW>/<w:tcPr>（Word 表格几乎都有）
      const txt = [...cm[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map(x => xmlDecode(x[1])).join('');
      cells.push(txt);
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseDelim(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const seps = ['\t', ',', ';', '|'];
  let best = '\t', bestN = 0;
  for (const s of seps) { const c = lines[0].split(s).length; if (c > bestN) { bestN = c; best = s; } }
  // 没有表格分隔符时，兼容「模型名 三个空格 输入价 输出价」或「模型名 空格 价格」的粘贴
  if (bestN <= 1) {
    return lines.map(l => {
      const m = l.match(/^(.*?)\s+(-?\d[\d.,]*)\s+(-?\d[\d.,]*)(?:\s+.*)?$/);
      if (m) return [m[1].trim(), m[2], m[3]];
      const m1 = l.match(/^(.*?)\s+(-?\d[\d.,]*)\s*$/);
      return m1 ? [m1[1].trim(), m1[2]] : [l.trim()];
    });
  }
  return lines.map(l => l.split(best).map(x => x.trim().replace(/^"|"$/g, '')));
}

/* ---- 智能识别：不依赖固定表头 ---- */
function LOOSE(s) {
  return String(s).toLowerCase().replace(/(\d)p(\d)/g, '$1.$2').replace(/[^a-z0-9]/g, '');
}
/* 语序不敏感的 token 键：'Claude-5-fable' 与 'claude-fable-5' 结果相同。
   必须与 scripts/build_site.py 的 tokenkey() 保持一致。 */
function TOKENS(s) {
  return String(s).toLowerCase().replace(/(\d)p(\d)/g, '$1.$2')
    .replace(/[/:：]+/g, ' ').split(/[^a-z0-9.]+/).filter(Boolean).sort();
}
function TKEY(s) { return TOKENS(s).join('|'); }
/* 两个 token 多重集的对称差 */
function tokDiff(a, b) {
  const ca = {}, cb = {};
  for (const t of a) ca[t] = (ca[t] || 0) + 1;
  for (const t of b) cb[t] = (cb[t] || 0) + 1;
  let d = 0;
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)]))
    d += Math.abs((ca[k] || 0) - (cb[k] || 0));
  return d;
}
/* 变体词：剥离后允许近似匹配（GPT-5.3-Chat ≈ GPT-5.3-Codex） */
const VARIANT_WORDS = new Set(['chat', 'codex', 'instruct', 'preview', 'latest', 'exp',
  'thinking', 'base', 'online', 'search', 'fast', 'turbo']);
function stripVariants(t) { return t.filter(x => !VARIANT_WORDS.has(x)); }

function guessModel(cell, models) {
  const raw = String(cell == null ? '' : cell).trim();
  const k = LOOSE(raw);
  if (!k || k.length < 3 || /^\d+$/.test(k)) return null;

  // L0 精确 loose 匹配
  const exact = models.find(x => x.loose === k);
  if (exact) return exact;

  const tk = TOKENS(raw);
  if (tk.length >= 2) {
    const tkKey = tk.join('|');
    // L1 token 多重集相同 —— 解决语序差异 Claude-5-fable ↔ claude-fable-5
    let hit = models.find(x => x.keys && x.keys.includes(tkKey));
    if (hit) return hit;

    // L2 差 1 个 token —— 解决 provider 前缀重复 ByteDance-Seed-2.0-mini ↔ bytedance-seed/seed-2.0-mini
    let best = null, bestD = 99;
    for (const m of models) {
      if (!m.keys) continue;
      for (const key of m.keys) {
        const d = tokDiff(tk, key.split('|'));
        if (d < bestD) { bestD = d; best = m; }
      }
    }
    if (best && bestD === 1 && tk.length >= 3) return best;

    // L3 剥离变体词后相同 —— 近似匹配，标记 _fuzzy 供 UI 提示
    const st = stripVariants(tk);
    if (st.length >= 2 && st.length < tk.length) {
      const stKey = st.join('|');
      const h2 = models.find(x => x.keys && x.keys.includes(stKey));
      if (h2) return Object.assign({}, h2, { _fuzzy: 'variant' });
      for (const m of models) {
        if (!m.keys) continue;
        for (const key of m.keys) {
          const mk = stripVariants(key.split('|'));
          if (mk.length >= 2 && mk.join('|') === stKey)
            return Object.assign({}, m, { _fuzzy: 'variant' });
        }
      }
    }
  }

  // L4 兜底：子串包含（原有逻辑）
  const hits = models.filter(x => x.loose.length >= 5 && (k.includes(x.loose) || x.loose.includes(k)));
  if (!hits.length) return null;
  hits.sort((a, b) => b.loose.length - a.loose.length);   // 取最长命中，避免误判
  return hits[0];
}
function guessPrice(cell) {
  let s = String(cell).replace(/[$¥\s]/g, '').replace(/^\$/, '');
  // 千分位 1,234.56 -> 去掉逗号；欧陆小数点 0,28 -> 转为 0.28
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  if (!isFinite(v) || v <= 0) return null;
  if (v <= 2000) return v;        // USD / 1M token 合理区间
  return null;                    // 更大的数字视作 token 数，忽略
}
/* 表头/说明性文本判定：命中的 cell 不参与模型名与价格识别，
   避免把「模型名称 / Provider / 输入 Input (USD/M Tokens)」误当内容 */
const HEAD_WORDS = /模型名称|模型名|model\s*name|序号|^\s*no\.?\s*$|版本|version|模型系列|系列|提供方|provider|开发方|developer|condition|定价|价格|price|输入|input|输出|output|缓存|cache|折扣|discount|备注|remark|单位|usd|\/m|tokens|状态|status/i;
function isHeadCell(c) { return HEAD_WORDS.test(String(c == null ? '' : c)); }

/* ---- 计费单位识别：上传表格可能写 ¥/千tokens、USD per 1M、元/百万token 等 ---- */
const CUR_RULES = [[/(¥|￥|\brmb\b|\bcny\b|人民币|元)/i, 'CNY'], [/(\$|\busd\b|美元)/i, 'USD']];
const PER_RULES = [[/(1\s*m|1,000,000|百万|million)/i, '1M'], [/(1\s*k|1,000|千|thousand)/i, '1K']];
function readUnit(s) {
  const t = String(s == null ? '' : s);
  let currency = null, per = null;
  for (const [rx, v] of CUR_RULES) if (rx.test(t)) { currency = v; break; }
  for (const [rx, v] of PER_RULES) if (rx.test(t)) { per = v; break; }
  return { currency, per };
}

/* ---- 本地检索：给一行文本挑出最像的 N 个候选模型，供 LLM 做"选择题" ----
   LLM 容易编造模型名，把候选项限定在本地已算好的 top-N 里，
   再用 strict 校验（返回名必须命中候选）过滤幻觉。 */
function topCandidates(text, models, n = 12) {
  const tk = TOKENS(text);
  if (!tk.length) return [];
  const scored = [];
  for (const m of models) {
    let best = 99;
    for (const k of (m.keys || [])) {
      const d = tokDiff(tk, k.split('|'));
      if (d < best) best = d;
    }
    if (best <= 8) scored.push({ m, d: best });
  }
  scored.sort((a, b) => a.d - b.d || a.m.name.length - b.m.name.length);
  return scored.slice(0, n).map(x => x.m);
}


/* ===================================================================
   区间（token 档位）展开
   -------------------------------------------------------------------
   很多报价表是「一个模型拆多行」：首行写模型名，后续行第一列为空，
   只在 Condition/Tokens 列标出 0<Token≤128K、128K<Token≤256K…
   以前只取第一行（=最低档）参与比价，长上下文场景会被严重低估。
   这里先按表头定位各列，再把续行挂到上一个模型名下形成多档。
   =================================================================== */

/* 形如 0<Token≤128K / Token>272K / ≤32K / 32K-128K / 128K以上 / >1M */
const TIER_RE = /(?:\d+[kmKM]?\s*(?:<|-|~|至|到)\s*)?(?:token|tokens|tok|上下文|context)?\s*(?:[<>≤≥]=?|以上|以内|以下)\s*\d+[kmKM]?|\d+\s*[kKmM]\s*(?:以内|以上|以下)|\d+\s*[kKmM]\s*[-~]\s*\d+\s*[kKmM]/;
function readTier(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (!t || t.length > 30) return '';
  if (/^[-—–.]+$/.test(t)) return '';                 // 占位符
  if (!/[a-zA-Z一-龥]/.test(t)) return '';            // 纯数字不是区间
  if (guessPrice(t) != null) return '';
  if (!TIER_RE.test(t)) return '';
  return t;
}

/* 单元格里第一个数字：兼容 "8（1h cache write）\n5（5m）"、"$0.25"、"1.2 元"
   注意：0,28 是欧式小数（=0.28），不能按千分位抹成 028=28。 */
function firstNum(cell) {
  let s = String(cell == null ? '' : cell).replace(/[$¥￥\s]/g, '');
  if (/^[-—–]+$/.test(s)) return null;
  const m0 = s.match(/-?\d[\d.,]*/);
  if (!m0) return null;
  let t = m0[0];
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');   // 1,234.56
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');            // 0,28 -> 0.28
  else t = t.replace(/,/g, '');
  const v = parseFloat(t);
  if (!isFinite(v) || v < 0 || v > 2000) return null;
  return v;
}

/* 按表头识别列位置。返回 {model, tier, input, output, cacheRead, cacheWrite, discount}，
   识别不到返回 null，调用方回退到「不看列位置」的通用识别。 */
const COL_RULES = [
  // 顺序即优先级：越靠前越先占位
  ['cacheWrite', /(cache[\s-]*(write|storage)|缓存存储|写入缓存)/i],
  ['cacheRead',  /(cache[\s-]*(read|hit)|cached[\s-]*input|缓存命中|命中缓存)/i],
  ['output',     /(output\s*\(|output.*(?:usd|price|token|m\s*tok)|输出.*(?:价|usd|token|m\s*tok|单价)|out\s*\()/i],
  ['input',      /(input\s*\(|input.*(?:usd|price|token|m\s*tok)|输入.*(?:价|usd|token|m\s*tok|单价)|in\s*\()/i],
  ['tier',       /(condition|tokens?\s*\(|区间|档位|\blimit\b)/i],
  ['discount',   /(折扣|discount)/i],
  ['model',      /(model\s*name|模型名称|模型名|^model$|^模型$)/i],
];
function detectColumns(rows) {
  const cols = {};
  for (const row of rows.slice(0, 6)) {
    if (!row || typeof row !== 'object') continue;
    for (let i = 0; i < row.length; i++) {
      const t = String(row[i] == null ? '' : row[i]).replace(/\s+/g, ' ').trim();
      if (!t || t.length > 40) continue;
      for (const [name, rx] of COL_RULES) {
        if (!rx.test(t)) continue;
        // 「输出 Output」不能抢成 input 列
        if (name === 'input' && /(output|输出|image)/i.test(t)) continue;
        if (name === 'model' && /(系列|提供方|provider|开发|version|版本|condition)/i.test(t)) continue;
        if (cols[name] == null) cols[name] = i;
        break;
      }
    }
  }
  const okMO = cols.model != null, okPrice = cols.input != null || cols.output != null;
  return (okMO && okPrice) ? cols : null;
}

/* 档位标签：优先用识别出的 Condition 列，否则取行内第一个「非价格、非模型名」的文本格。
   注意：已经认出了 Condition 列时不做兜底 —— 那列写着 "-" 就是没有档位，
   跑去拿「模型系列」之类的值只会把 'X' 当成档位名。 */
function tierLabelOf(cells, cols, excludeIdx) {
  if (cols && cols.tier != null) return readTier(cells[cols.tier]) || '';
  const skip = new Set(cols ? Object.values(cols) : []);   // 已知列都不是区间名
  if (excludeIdx != null && excludeIdx >= 0) skip.add(excludeIdx);  // 模型名不能当档位名
  for (let i = 0; i < cells.length; i++) {
    if (skip.has(i)) continue;
    const c = cells[i];
    const s = String(c == null ? '' : c).trim();
    if (!s || isHeadCell(s)) continue;
    if (guessPrice(c) != null) continue;
    if (/^[\d.,\s]+$/.test(s)) continue;
    if (s.length > 26) continue;
    if (!readTier(s)) continue;          // 只认真正的区间/档位文本，避免把“文本”“模型系列”当档位
    return s.replace(/\s+/g, ' ').trim();
  }
  return '';
}

if (typeof module !== 'undefined') module.exports = { unzip, parseXlsx, parseXlsxSheets, parseDocx, parseDelim, xmlRows, xmlDecode, LOOSE, TOKENS, TKEY, guessModel, guessPrice, isHeadCell, readUnit, topCandidates, readTier, firstNum, detectColumns, tierLabelOf };
