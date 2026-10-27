/* Model Price Compare — Agent B 前端
   零依赖：自绘 SVG 图表 + 内置 xlsx/docx/csv 解析器（离线可用） */
'use strict';
const D = JSON.parse(document.getElementById('DATA').textContent);
const SRC = D.sources;
const SRCIDS = SRC.map(s => s.id);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 3) => v == null ? '—' : Number(v).toFixed(d).replace(/\.?0+$/, m => m.includes('.') ? '' : m);
const money = v => v == null ? '—' : '$' + Number(v).toFixed(v < 1 ? 4 : 3).replace(/0+$/, '').replace(/\.$/, '');

const S = {
  tab: 'compare', metric: 'input', q: '', srcs: new Set(SRCIDS),
  region: 'all', kind: '文本', minSrc: 2, sort: { k: 'watch', dir: -1 },
  sel: null, chartModel: null, trendSrc: SRCIDS[0], trendModels: [],
  uploadRows: [], uploadMap: [], upSheets: [], upSheetIdx: 0, upFile: '',
  upMiss: [], upAllRows: [], aiBusy: false, aiStat: null
};

/* ============================== 工具 ============================== */
function metricLabel(m) {
  return { input: '输入 Input', output: '输出 Output', cache_read: '缓存命中 Cache Read',
    cache_write: '缓存写入 Cache Write', discount: '折扣 %' }[m] || m;
}
function pass(m) {
  if (S.region !== 'all' && m.region !== S.region) return false;
  if (S.kind !== 'all' && m.kind !== S.kind) return false;
  if (m.n_src < S.minSrc) return false;
  if (S.q) {
    const q = S.q.toLowerCase();
    if (!(m.name.toLowerCase().includes(q) || m.loose.includes(q) ||
        m.vendor.toLowerCase().includes(q))) return false;
  }
  return true;
}
function visibleModels() { return D.models.filter(pass); }
function valOf(m, sid, metric) {
  const p = m.prices[sid]; if (!p) return null;
  if (metric === 'discount') return p.discount ?? null;
  return p[metric] ?? null;
}
function activeVals(m, metric) {
  const out = [];
  for (const sid of S.srcs) { const v = valOf(m, sid, metric); if (v != null) out.push(v); }
  return out;
}
function srcColor(id) { return (SRC.find(s => s.id === id) || {}).color || '#888'; }
function srcLabel(id) { return (SRC.find(s => s.id === id) || {}).label || id; }

/* 模型官网价格：official=厂商官方定价，openrouter=未检索到官网价时的兜底 */
function offVal(m, metric) {
  const o = m.official;
  if (!o || metric === 'discount') return null;      // 官网无折扣概念
  return o[metric] ?? null;
}
function offTitle(m) {
  const o = m.official; if (!o) return '';
  if (o.src === 'official') {
    let t = `官网价：${o.model || m.name}\n输入 ${nf(o.input)} / 输出 ${nf(o.output)}`;
    if (o.cache_read != null) t += `\n缓存命中 ${nf(o.cache_read)}`;
    if (o.cache_write != null) t += `\n缓存写入 ${nf(o.cache_write)}`;
    if (o.note) t += `\n${o.note}`;
    if (o.checked) t += `\n核对日期 ${o.checked}`;
    if (o.url) t += `\n来源 ${o.url}`;
    return t;
  }
  return `未检索到厂商官网价，采用 OpenRouter 发布价作为参考\n输入 ${nf(o.input)} / 输出 ${nf(o.output)}`;
}
function offCell(m) {
  const o = m.official;
  const v = offVal(m, S.metric);
  if (!o || v == null) return '<td class="na">—</td>';
  const fb = o.src === 'openrouter';
  return `<td><span class="pill ${fb ? 'off-fb' : 'off'}" title="${esc(offTitle(m))}">`
    + `${nf(v)}${fb ? '<sup class="fb">OR</sup>' : ''}</span></td>`;
}

/* ============================== 表格 ============================== */
function renderTable() {
  let list = visibleModels();
  const { k, dir } = S.sort;
  list.sort((a, b) => {
    let x, y;
    if (k === 'name') { x = a.name.toLowerCase(); y = b.name.toLowerCase(); }
    else if (k === 'watch') { x = a.watch ? 1 : 0; y = b.watch ? 1 : 0; }
    else if (k === 'n_src') { x = a.n_src; y = b.n_src; }
    else if (k === 'official') {
      // 无官网价的模型始终排在末尾（不受升降序影响）
      const av = offVal(a, S.metric), bv = offVal(b, S.metric);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    }
    else if (k === 'spread') {
      const sp = m => { const v = activeVals(m, S.metric); return v.length > 1 ? Math.max(...v) / Math.min(...v) : 0; };
      x = sp(a); y = sp(b);
    } else { x = valOf(a, k, S.metric) ?? 1e18; y = valOf(b, k, S.metric) ?? 1e18; }
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });

  $('cnt').textContent = `共 ${list.length} 个模型 · 单位 USD / 1M tokens`;
  if (!list.length) { $('tbl').innerHTML = '<div class="empty">没有匹配的模型，试试放宽筛选条件</div>'; return; }

  const ids = SRCIDS.filter(s => S.srcs.has(s));
  let h = '<table><thead><tr>';
  h += `<th class="l" data-k="name">模型 ${S.sort.k === 'name' ? (S.sort.dir > 0 ? '▲' : '▼') : ''}</th>`;
  h += `<th data-k="official">模型官网价格 ${S.sort.k === 'official' ? (S.sort.dir > 0 ? '▲' : '▼') : ''}</th>`;
  for (const sid of ids)
    h += `<th data-k="${sid}">${esc(srcLabel(sid))}</th>`;
  h += `<th data-k="spread">最大价差</th><th data-k="n_src">源数</th></tr></thead><tbody>`;

  for (const m of list) {
    const vals = activeVals(m, S.metric);
    const mn = vals.length ? Math.min(...vals) : null;
    const mx = vals.length ? Math.max(...vals) : null;
    h += `<tr data-loose="${esc(m.loose)}" class="${S.sel === m.loose ? 'sel' : ''}">
      <td class="l"><span class="mname">${esc(m.name)}</span>
        ${m.watch ? '<span class="bdge">关注</span>' : ''}
        ${m.n_ver > m.n_src ? `<span class="bdge">${m.n_ver}版本</span>` : ''}
        <br><span class="mven">${esc(m.vendor)} · ${esc(m.kind)} · ${esc(m.region === 'cn' ? '国产' : '国际')}</span></td>`;
    h += offCell(m);
    for (const sid of ids) {
      const v = valOf(m, sid, S.metric);
      if (v == null) { h += '<td class="na">—</td>'; continue; }
      let cls = 'pill mut';
      if (S.metric === 'discount') cls = v > 0 ? 'pill lo' : 'pill mut';
      else if (vals.length > 1 && v === mn) cls = 'pill lo';
      else if (vals.length > 1 && v === mx) cls = 'pill hi';
      const txt = S.metric === 'discount' ? (v > 0 ? v.toFixed(0) + '%' : '—') : nf(v);
      h += `<td><span class="${cls}">${txt}</span></td>`;
    }
    const sp = (mn && mx && mx > 0 && mn > 0 && vals.length > 1) ? ((mx / mn - 1) * 100) : null;
    h += `<td>${sp ? `<span class="pill mut">${sp.toFixed(0)}%</span>` : '<span class="na">—</span>'}</td>
      <td><span class="pill n">${m.n_src}</span></td></tr>`;
  }
  h += '</tbody></table>';
  $('tbl').innerHTML = h;
  $('tbl').querySelectorAll('th[data-k]').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      if (S.sort.k === k) S.sort.dir *= -1;
      else { S.sort.k = k; S.sort.dir = (k === 'name') ? 1 : -1; }
      renderTable();
    };
  });
  $('tbl').querySelectorAll('tr[data-loose]').forEach(tr => {
    tr.onclick = () => {
      const lo = tr.dataset.loose;
      S.sel = (S.sel === lo) ? null : lo;
      renderTable(); renderDetail(); renderChart();
    };
  });
}

/* ========================= 展开详情 ========================= */
function renderDetail() {
  const box = $('detail');
  if (!S.sel) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const m = D.models.find(x => x.loose === S.sel);
  if (!m) { box.innerHTML = ''; return; }
  const METRICS = [
    ['input', '输入'], ['output', '输出'],
    ['cache_read', '缓存命中'], ['cache_write', '缓存写入'],
    ['list_input', '官方原价(输入)'], ['discount', '折扣']
  ];
  // 官网价在详情页的列值（list_input 即官网原价，discount 官网无此概念）
  const offDet = mk => {
    const o = m.official; if (!o) return null;
    if (mk === 'list_input') return o.input ?? null;
    if (mk === 'discount') return null;
    return o[mk] ?? null;
  };
  let h = '<table class="dettab"><thead><tr><th class="l">指标</th>'
    + `<th>${m.official ? esc(m.official.src === 'official' ? '模型官网价格' : '官网价(OR兜底)') : '模型官网价格'}</th>`;
  for (const sid of SRCIDS) if (m.prices[sid]) h += `<th>${esc(srcLabel(sid))}</th>`;
  h += '</tr></thead><tbody>';
  for (const [mk, label] of METRICS) {
    const vals = SRCIDS.map(s => valOf(m, s, mk)).filter(v => v != null);
    const ov = offDet(mk);
    if (!vals.length && ov == null) continue;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    h += `<tr><td class="l">${label}</td>`;
    h += ov == null ? '<td class="na">—</td>'
      : `<td class="offc">${mk === 'discount' ? '—' : nf(ov, 4)}</td>`;
    for (const sid of SRCIDS) {
      if (!m.prices[sid]) continue;
      const v = valOf(m, sid, mk);
      if (v == null) { h += '<td class="na">—</td>'; continue; }
      let cls = '';
      if (vals.length > 1 && v === mn) cls = 'hl2';
      else if (vals.length > 1 && v === mx) cls = 'hl3';
      h += `<td class="${cls}">${mk === 'discount' ? v.toFixed(0) + '%' : nf(v, 4)}</td>`;
    }
    h += '</tr>';
  }
  h += '</tbody></table>';

  // 版本明细
  let v = '<table class="dettab"><thead><tr><th class="l">源</th><th class="l">版本 / model_id</th>' +
    '<th>输入</th><th>输出</th><th>缓存命中</th></tr></thead><tbody>';
  for (const sid of SRCIDS) {
    const p = m.prices[sid]; if (!p) continue;
    for (const it of (p.versions || [p])) {
      v += `<tr><td class="l"><span class="bdge">${esc(srcLabel(sid))}</span></td>
        <td class="l mono">${esc(it.model_id)}${it.variant ? ' <span class="bdge">' + esc(it.variant) + '</span>' : ''}</td>
        <td>${nf(it.input, 4)}</td><td>${nf(it.output, 4)}</td><td>${nf(it.cache_read, 4)}</td></tr>`;
    }
  }
  v += '</tbody></table>';
  const o = m.official;
  let info = '';
  if (o) {
    const srcTxt = o.src === 'official'
      ? `厂商官方定价${o.url ? ` · <a href="${esc(o.url)}" target="_blank" rel="noopener">官方页面</a>` : ''}${o.checked ? ` · 核对 ${esc(o.checked)}` : ''}`
      : '未检索到厂商官网价，采用 OpenRouter 发布价作为参考';
    info = `<div class="offinfo"><b>模型官网价格</b>　输入 <b>${nf(o.input)}</b> / 输出 <b>${nf(o.output)}</b>`
      + ` USD 每百万 token<br><span class="sm">来源：${srcTxt}${o.note ? ' · ' + esc(o.note) : ''}</span></div>`;
  } else {
    info = `<div class="offinfo"><b>模型官网价格</b>　<span class="na">暂缺（未检索到官网价）</span></div>`;
  }
  box.innerHTML = `<div class="detbox"><div><h3 style="margin-bottom:8px">${esc(m.name)} · 全指标对比</h3>${info}${h}</div>
    <div><h3 style="margin-bottom:8px">版本明细（已排除 batch / free 计费变体）</h3>${v}</div></div>`;
  box.style.display = 'block';
}

/* ========================= SVG 图表 ========================= */
function svgBar(el, groups, opt = {}) {
  // groups: [{label, color, value}]
  const data = groups.filter(g => g.value != null);
  if (!data.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const W = opt.w || 720, H = opt.h || 260, pl = 58, pr = 16, pt = 18, pb = 40;
  const iw = W - pl - pr, ih = H - pt - pb;
  const mx = Math.max(...data.map(d => d.value)) || 1;
  const bw = iw / data.length, bwt = Math.min(74, bw * 0.56);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const y = pt + ih - (ih * i / 4), v = mx * i / 4;
    s += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="var(--line)" stroke-width="1"/>
      <text x="${pl - 8}" y="${y + 4}" text-anchor="end" fill="var(--tx3)" font-size="11">${v < 10 ? v.toFixed(2) : v.toFixed(0)}</text>`;
  }
  data.forEach((d, i) => {
    const bh = Math.max(2, ih * (d.value / mx));
    const x = pl + bw * i + (bw - bwt) / 2, y = pt + ih - bh;
    s += `<rect x="${x}" y="${y}" width="${bwt}" height="${bh}" rx="5" fill="${d.color}" opacity=".92">
        <title>${esc(d.label)}: ${nf(d.value, 4)}</title></rect>
      <text x="${x + bwt / 2}" y="${y - 6}" text-anchor="middle" fill="var(--tx)" font-size="11.5" font-weight="600">${nf(d.value, 4)}</text>
      <text x="${pl + bw * i + bw / 2}" y="${pt + ih + 18}" text-anchor="middle" fill="var(--tx2)" font-size="11.5">${esc(d.label)}</text>`;
  });
  s += `<text x="${pl}" y="${H - 6}" fill="var(--tx3)" font-size="11">${esc(opt.unit || 'USD / 1M tokens')}</text></svg>`;
  el.innerHTML = s;
}
function svgLine(el, dates, series, opt = {}) {
  const useable = series.filter(x => x.points.some(p => p != null));
  if (dates.length < 1 || !useable.length) {
    el.innerHTML = '<div class="empty">' + (opt.emptyMsg || '暂无数据') + '</div>'; return;
  }
  const W = opt.w || 720, H = opt.h || 280, pl = 58, pr = 90, pt = 18, pb = 44;
  const iw = W - pl - pr, ih = H - pt - pb;
  const all = series.flatMap(s => s.points).filter(v => v != null);
  let mx = Math.max(...all), mn = Math.min(...all);
  if (mx === mn) { mx = mx * 1.2 + 0.01; mn = mn * 0.8; }
  const pad = (mx - mn) * 0.12; mx += pad; mn = Math.max(0, mn - pad);
  const X = i => dates.length === 1 ? pl + iw / 2 : pl + iw * i / (dates.length - 1);
  const Y = v => pt + ih - ih * ((v - mn) / (mx - mn));
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let i = 0; i <= 4; i++) {
    const y = pt + ih - ih * i / 4, v = mn + (mx - mn) * i / 4;
    s += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="var(--line)"/>
      <text x="${pl - 8}" y="${y + 4}" text-anchor="end" fill="var(--tx3)" font-size="11">${v < 10 ? v.toFixed(3) : v.toFixed(1)}</text>`;
  }
  dates.forEach((d, i) => {
    s += `<text x="${X(i)}" y="${pt + ih + 20}" text-anchor="middle" fill="var(--tx3)" font-size="11">${esc(d.slice(5))}</text>`;
  });
  series.forEach(se => {
    const pts = se.points.map((v, i) => v == null ? null : [X(i), Y(v)]).filter(Boolean);
    if (!pts.length) return;
    s += `<polyline fill="none" stroke="${se.color}" stroke-width="2.2" stroke-linejoin="round"
      points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    pts.forEach(p => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" fill="${se.color}"><title>${esc(se.label)}</title></circle>`; });
    const last = pts[pts.length - 1];
    s += `<text x="${last[0] + 6}" y="${last[1] + 4}" fill="${se.color}" font-size="11" font-weight="600">${esc(se.label)}</text>`;
  });
  s += '</svg>';
  el.innerHTML = s;
}

/* ======================== 对比图表 ======================== */
function renderChart() {
  const m = S.sel ? D.models.find(x => x.loose === S.sel)
    : visibleModels().find(x => x.n_src >= 2);
  if (!m) { $('chart').innerHTML = '<div class="empty">选择一个模型查看图表</div>'; $('chart2').innerHTML = ''; return; }
  $('chartTitle').textContent = m.name + ' — 各源价格对比';
  const mk = g => SRCIDS.filter(s => m.prices[s]).map(s => ({ label: srcLabel(s), color: srcColor(s), value: valOf(m, s, g) }));
  svgBar($('chart'), mk(S.metric), {});
  svgBar($('chart2'), mk(S.metric === 'input' ? 'output' : 'input'), {});
  $('chart2Title').textContent = m.name + ' — ' + metricLabel(S.metric === 'input' ? 'output' : 'input');
  // 汇总卡片
  const vin = activeVals(m, 'input'), vout = activeVals(m, 'output');
  let best = null, bv = Infinity;
  for (const sid of S.srcs) { const p = m.prices[sid]; if (p && p.input != null && p.input < bv) { bv = p.input; best = sid; } }
  $('cards').innerHTML = `
    <div class="card"><h3>最低输入价</h3><div class="big" style="color:var(--lo)">${money(vin.length ? Math.min(...vin) : null)}</div>
      <div class="sm">${best ? esc(srcLabel(best)) : '—'}</div></div>
    <div class="card"><h3>最高输入价</h3><div class="big" style="color:var(--hi)">${money(vin.length ? Math.max(...vin) : null)}</div>
      <div class="sm">${vin.length > 1 ? '价差 ' + ((Math.max(...vin) / Math.min(...vin) - 1) * 100).toFixed(0) + '%' : '—'}</div></div>
    <div class="card"><h3>最低输出价</h3><div class="big" style="color:var(--lo)">${money(vout.length ? Math.min(...vout) : null)}</div><div class="sm">per 1M tokens</div></div>
    <div class="card"><h3>覆盖来源</h3><div class="big">${m.n_src}<span style="font-size:14px;color:var(--tx3)"> / ${SRCIDS.length}</span></div>
      <div class="sm">${m.n_ver} 个版本</div></div>`;
}

/* ======================== 图像 / 视频 ======================== */
const MEDIA_UNIT = { image: '张', video: '条', second: '秒', step: '步',
  request: '次', utf8_mb: 'M UTF-8 bytes', unknown: '单位未知' };
function mediaUnit(u) { return MEDIA_UNIT[u] || u || '—'; }
function renderMedia() {
  const box = $('media');
  if (!box) return;
  const rows = D.media || [];
  if (!rows.length) {
    box.innerHTML = '<div class="empty">暂无媒体价格。运行一次采集（run_daily.sh）后，Seedance / Flux / Kling / Veo / Wan 等模型会出现在这里。</div>';
    return;
  }
  let h = `<div class="cnt" style="margin-bottom:8px">共 ${rows.length} 条媒体报价 · 按张/秒/步计价，不与 token 混比</div>`;
  h += '<div class="tw" style="max-height:none"><table><thead><tr>' +
    '<th class="l">模型</th><th>类型</th><th>源</th><th>计价单位</th>' +
    '<th>价格 (USD)</th><th>参考价</th><th>折扣</th><th class="l">model_id</th>' +
    '</tr></thead><tbody>';
  for (const r of rows) {
    const unit = mediaUnit(r.unit);
    const price = r.price == null ? '—' : money(r.price);
    const list = r.list_price == null ? '—' : money(r.list_price);
    const disc = r.discount == null ? '—' : (r.discount > 0 ? r.discount.toFixed(0) + '%' : '—');
    h += `<tr><td class="l"><span class="mname">${esc(r.name)}</span><br>` +
      `<span class="mven">${esc(r.vendor)}</span></td>` +
      `<td>${esc(r.kind)}</td><td>${esc(srcLabel(r.source))}</td>` +
      `<td>${esc(unit)}</td><td class="hl2">${price} <span class="sm">/ ${esc(unit)}</span></td>` +
      `<td>${list}</td><td>${disc}</td>` +
      `<td class="l mono">${esc(r.model_id || '')}</td></tr>`;
  }
  h += '</tbody></table></div>';
  h += '<div class="note" style="margin-top:10px">媒体模型按张、秒、步计价，<b>不与 token 单价直接比较</b>；上传比对时这类模型会标注「媒体计价」，不参与 token 最低价分析。</div>';
  box.innerHTML = h;
}

/* ======================== 关注分组 ======================== */
function renderWatch() {
  const box = $('watch');
  let h = '';
  const groups = [];
  for (const w of D.watch) {
    let items = w.items.map(it => D.models.find(m => m.loose === it.loose)).filter(Boolean);
    if (w.group === 'Gemini 全系列') items = D.models.filter(m => m.loose.startsWith('gemini') && m.kind === '文本');
    if (w.group === 'GPT 全系列') items = D.models.filter(m => (m.loose.startsWith('gpt') || /^o[134]/.test(m.loose)) && m.kind === '文本');
    if (!items.length) continue;
    items.sort((a, b) => b.n_src - a.n_src || a.name.localeCompare(b.name));
    groups.push([w.group, w.region, items]);
  }
  for (const [gname, region, items] of groups) {
    h += `<div class="sec">${esc(gname)} <span class="tag">${region === 'cn' ? '国产' : '国际'}</span>
      <span class="tag">${items.length} 个模型</span></div>
      <div class="tw" style="max-height:none"><table><thead><tr><th class="l">模型</th>
      <th>模型官网价格</th>`;
    for (const sid of SRCIDS) h += `<th>${esc(srcLabel(sid))} 输入</th>`;
    h += '<th>最低</th><th>最高</th><th>最大价差</th></tr></thead><tbody>';
    for (const m of items) {
      const vin = SRCIDS.map(s => valOf(m, s, 'input')).filter(v => v != null);
      const mn = vin.length ? Math.min(...vin) : null, mx = vin.length ? Math.max(...vin) : null;
      h += `<tr data-loose="${esc(m.loose)}"><td class="l"><span class="mname">${esc(m.name)}</span>
        <br><span class="mven">${esc(m.vendor)}</span></td>`;
      const ov = offVal(m, 'input');
      h += ov == null ? '<td class="na">—</td>'
        : `<td><span class="pill ${m.official.src === 'openrouter' ? 'off-fb' : 'off'}" `
          + `title="${esc(offTitle(m))}">${nf(ov)}${m.official.src === 'openrouter' ? '<sup class="fb">OR</sup>' : ''}</span></td>`;
      for (const sid of SRCIDS) {
        const v = valOf(m, sid, 'input');
        if (v == null) { h += '<td class="na">—</td>'; continue; }
        let cls = 'pill mut';
        if (vin.length > 1 && v === mn) cls = 'pill lo';
        else if (vin.length > 1 && v === mx) cls = 'pill hi';
        h += `<td><span class="${cls}">${nf(v)}</span></td>`;
      }
      h += `<td class="${mn != null ? 'hl2' : ''}">${nf(mn)}</td>
        <td class="${mx != null ? 'hl3' : ''}">${nf(mx)}</td>
        <td>${(mn && mx && mx > mn) ? `<span class="pill hi">${((mx / mn - 1) * 100).toFixed(0)}%</span>` : '—'}</td></tr>`;
    }
    h += '</tbody></table></div>';
  }
  box.innerHTML = h;
  box.querySelectorAll('tr[data-loose]').forEach(tr => tr.onclick = () => {
    S.sel = tr.dataset.loose; S.tab = 'compare'; switchTab('compare');
    renderTable(); renderDetail(); renderChart();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ======================== 走势 ======================== */
function renderTrend() {
  const dates = D.history.dates;
  const sel = $('trendSrc');
  if (sel.options.length !== SRCIDS.length + 1) {
    sel.innerHTML = '<option value="__all__">全部源（对比）</option>' +
      SRCIDS.map(s => `<option value="${s}">${esc(srcLabel(s))}</option>`).join('');
    sel.value = S.trendSrc;
  }
  // 模型候选：有历史数据的
  const cand = D.models.filter(m => m.n_src >= 2).slice(0, 400);
  const ml = $('trendModel');
  if (ml.options.length !== cand.length) {
    ml.innerHTML = cand.map(m => `<option value="${esc(m.loose)}">${esc(m.name)} (${m.n_src}源)</option>`).join('');
    ml.value = (S.trendModels[0] || cand[0]?.loose || '');
  }
  const src = sel.value;
  const keys = ml.selectedOptions.length ? [...ml.selectedOptions].map(o => o.value)
    : (S.trendModels.length ? S.trendModels : [cand[0]?.loose]);
  if (keys.length && (!S.trendModels.length || S.trendModels[0] !== keys[0])) S.trendModels = keys;

  const palette = ['#4f9cf9', '#f97316', '#22c55e', '#a855f7', '#eab308', '#06b6d4'];
  const series = [];
  const ids = (src === '__all__') ? SRCIDS : [src];
  keys.slice(0, 6).forEach((loose, ki) => {
    const m = D.models.find(x => x.loose === loose); if (!m) return;
    ids.forEach((sid, si) => {
      const pts = dates.map(d => {
        const day = D.history.series[d] || {};
        return (day[sid] || {})[loose] ?? null;
      });
      if (pts.some(p => p != null))
        series.push({
          label: `${m.name} · ${srcLabel(sid)}`,
          color: (src === '__all__') ? srcColor(sid) : palette[ki % palette.length],
          points: pts
        });
    });
  });
  $('trendTitle').textContent = src === '__all__' ? '各源价格走势对比' : `${srcLabel(src)} 价格走势`;
  svgLine($('trend'), dates, series, {
    emptyMsg: dates.length < 2
      ? `走势图需要至少 2 天快照。当前已有 ${dates.length} 天（${dates[0]}）。每日自动采集后会逐日累积。`
      : '所选组合暂无价格数据'
  });
  $('trendNote').textContent = dates.length < 2
    ? `提示：历史走势依赖每日快照累积。数据库已于 ${D.latest} 建立首个快照，Agent A 每日采集后即可看到曲线。`
    : `已累积 ${dates.length} 天快照（${dates[0]} ~ ${dates[dates.length - 1]}）`;
}

/* ======================== 上传比对 ======================== */
/* 文件解析 / 智能识别：见 parsers.js（内联时在其后加载） */

/* isHeadCell / HEAD_WORDS 定义在 parsers.js（内联时在其后加载） */

function countModels(rows) {
  let n = 0;
  for (const r of rows) {
    if (r.some(c => guessModel(c, D.models) && !isHeadCell(c))) n++;
  }
  return n;
}

async function handleFile(file) {
  $('upStatus').textContent = '解析中…';
  try {
    const name = file.name.toLowerCase();
    let rows = [];
    if (/\.(xlsx|xlsm)$/.test(name)) {
      const sheets = parseXlsxSheets(await unzip(await file.arrayBuffer()))
        .filter(s => s.rows.length);
      S.upSheets = sheets; S.upFile = file.name;
      if (sheets.length > 1) {
        // 默认选「可见表中识别出模型最多」的；隐藏表多为停更/弃用，降权
        let bi = 0, bn = -1;
        sheets.forEach((s, i) => {
          const n = countModels(s.rows) * (s.hidden ? 0.4 : 1);
          if (n > bn) { bn = n; bi = i; }
        });
        S.upSheetIdx = bi;
        renderSheetPicker();
        analyzeRows(sheets[bi].rows, file.name, sheets[bi].name);
      } else {
        $('upSheets').innerHTML = '';
        S.upSheetIdx = 0;
        analyzeRows(sheets[0] ? sheets[0].rows : [], file.name, '');
      }
      return;
    }
    else if (/\.docx?$/.test(name)) rows = parseDocx(await unzip(await file.arrayBuffer()));
    else if (/\.csv|\.tsv|\.txt$/.test(name)) rows = parseDelim(await file.text());
    else { $('upStatus').textContent = '不支持的格式：' + file.name; return; }
    $('upSheets').innerHTML = ''; S.upSheets = [];
    analyzeRows(rows, file.name, '');
  } catch (e) {
    $('upStatus').innerHTML = '<span style="color:var(--hi)">解析失败：' + esc(e.message) +
      '。可改用下方"粘贴表格文本"。</span>';
  }
}
function renderSheetPicker() {
  const box = $('upSheets');
  if (!box || !S.upSheets.length) return;
  const opts = S.upSheets.map((s, i) => {
    const n = countModels(s.rows);
    return `<option value="${i}">${esc(s.name)}${s.hidden ? '（隐藏）' : ''} · ${s.rows.length} 行 · 约 ${n} 个模型</option>`;
  }).join('');
  const total = S.upSheets.reduce((a, s) => a + s.rows.length, 0);
  box.innerHTML = `<div class="row" style="margin:8px 0;gap:8px"><span class="tag">工作表</span>
    <select id="sheetSel" class="inp" style="max-width:460px">
      <option value="-1">全部工作表（合并 ${total} 行）</option>${opts}</select></div>`;
  $('sheetSel').value = String(S.upSheetIdx);
  $('sheetSel').onchange = e => {
    const v = +e.target.value; S.upSheetIdx = v;
    const rows = v < 0 ? S.upSheets.flatMap(s => s.rows) : S.upSheets[v].rows;
    analyzeRows(rows, S.upFile, v < 0 ? '' : S.upSheets[v].name);
  };
}
/* 折扣列：88折 -> 0.88，105折 -> 1.05，88% -> 0.88 */
function parseDiscount(cell) {
  if (cell == null) return null;
  const s = String(cell).replace(/\s+/g, '');
  let m = s.match(/([\d.]+)折/) || s.match(/([\d.]+)%/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return (isFinite(v) && v > 0 && v < 200) ? v / 100 : null;
}

/* 规则识别路径的单位折算：统一成 USD / 1M tokens。
   表头写「元/百万tokens」或「$ / 1K」时，不能再把人民币/千 token 价直接当美元/百万比。 */
function localUSD(v, unit) {
  if (v == null) return null;
  const per = unit && unit.per;
  let x = v * (per === '1K' ? 1000 : per === '1' ? 1e6 : 1);
  if (unit && unit.currency === 'CNY') x *= (D.fx && D.fx.usd_per_cny) || 0.1408;
  return Math.round(x * 1e6) / 1e6;
}
function sheetUnit(rows) {
  const head = (rows || []).slice(0, 6).map(r => (r || []).join(' ')).join(' ');
  return readUnit(head);
}

/* 从一个模型行里抽出某档的 input / output。
   有表头列位置时按列取值；否则退回「取行里两个最大的数」的老办法。
   表里常见写法是「原厂目录价 + 对外销售折扣」两列，此时返回的是折后实际售价，
   同时把目录价留在 list/listOut 里，供分析文案展示。 */
function pickPrices(cells, cols, unit) {
  let disc = null;
  // 表里常见三档渠道折扣（原厂直连 / 第三方直连 / 第三方混线），取最低那档＝实际能拿到的最好价
  for (const c of cells) {
    const d = parseDiscount(c);
    if (d != null && (disc == null || d < disc)) disc = d;
  }
  const apply = v => (v == null || !disc) ? (v == null ? null : v) : +(v * disc).toFixed(6);
  const conv = v => localUSD(v, unit);
  if (cols) {
    const get = k => {
      if (cols[k] == null) return null;
      const cell = cells[cols[k]];
      if (isHeadCell(cell)) return null;          // 重复表头（含 1M 等数字）不能当价格
      return firstNum(cell);
    };
    const vin = get('input'), vout = get('output');
    if (vin != null || vout != null) {
      return { in: conv(apply(vin)), out: conv(apply(vout)),
               list: conv(vin), listOut: conv(vout),
               cache: conv(get('cacheRead')), cw: conv(get('cacheWrite')), disc };
    }
  }
  const nums = [];
  for (const c of cells) {
    if (isHeadCell(c)) continue;
    const p = guessPrice(c);
    if (p != null) nums.push(p);
  }
  if (!nums.length) return { in: null, out: null, list: null, listOut: null, disc, cache: null, cw: null };
  const pos = nums.filter(n => n > 0);
  if (!pos.length) return { in: 0, out: 0, list: 0, listOut: 0, disc, cache: null, cw: null };  // 限免
  if (pos.length === 1) return { in: conv(apply(pos[0])), out: null, list: conv(pos[0]), listOut: null, disc, cache: null, cw: null };
  const uniq = [...new Set(pos)].sort((a, b) => b - a);
  let vin = uniq[0], vout = uniq[1] ?? null;
  // output 通常 ≥ input，反了就交换
  if (vin != null && vout != null && vin > vout) { const t = vin; vin = vout; vout = t; }
  return { in: conv(apply(vin)), out: conv(apply(vout)), list: conv(vin), listOut: conv(vout), disc, cache: null, cw: null };
}

function analyzeRows(rows, srcName, sheetName) {
  const found = [];
  const miss = [];                       // 规则没认出来的行，留给 AI 兜底
  S.upAllRows = rows;
  const cols = detectColumns(rows);      // 有明确表头时按列取值，精度更高
  const unit = sheetUnit(rows);          // 表头里的币种 / 每千 token 等信息
  const byLoose = new Map();             // loose -> 已收录的 entry（同模型多次出现时合并档位）
  let last = null;                       // 上一行识别出的模型，用于「续行」继承
  let tierN = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri] || [];
    const cells = r.filter(c => c != null && String(c).trim() !== '');
    if (!cells.length) continue;

    // ---- 找本行的模型名（优先取模型列，其次全行扫）
    let model = null, modelIdx = -1;
    if (cols && cols.model != null && !isHeadCell(r[cols.model])) {
      model = guessModel(r[cols.model], D.models);
      if (model) modelIdx = cols.model;
    }
    if (!model) {
      for (let ci = 0; ci < r.length; ci++) {
        if (isHeadCell(r[ci])) continue;
        const g = guessModel(r[ci], D.models);
        if (g) { model = g; modelIdx = ci; break; }
      }
    }

    // ---- 重复表头：跳过并把续行锚点清空，避免表头里的 1M 被当作价格挂到上一模型
    if (!model && cells.filter(c => isHeadCell(c)).length >= 2) { last = null; continue; }

    // ---- 没有模型名：可能是上一模型的「其他档位续行」
    if (!model) {
      const pr = pickPrices(r, cols, unit);
      const hasPrice = pr.in != null || pr.out != null;
      const lbl = readTier(cols && cols.tier != null ? r[cols.tier] : '') ||
                  (hasPrice ? tierLabelOf(r, cols) : '');
      // 挂到上一个模型名下——只有当这一行确实带着价格时才认作「续行」，
      // 否则就是说明文字/备注，交给 AI 判断
      if (last && hasPrice) {
        const t = { tier: lbl || `第 ${last.tiers.length + 1} 档`, in: pr.in, out: pr.out,
                    list: pr.list, listOut: pr.listOut, disc: pr.disc,
                    cache: pr.cache, cw: pr.cw, line: ri };
        const dup = last.tiers.findIndex(x => x.tier === t.tier);
        if (dup >= 0) last.tiers[dup] = t; else last.tiers.push(t);
        tierN++;
        continue;
      }
      miss.push({ i: ri, cells, unitHint: readUnit(cells.join(' ')) });
      continue;
    }

    // ---- 有模型名：抽这一档的价格
    const pr = pickPrices(r, cols, unit);
    const tierLbl = (cols && cols.tier != null ? readTier(r[cols.tier]) : '') ||
                    tierLabelOf(r, cols, modelIdx);
    const tier = { tier: tierLbl, in: pr.in, out: pr.out, list: pr.list, listOut: pr.listOut,
                   disc: pr.disc, cache: pr.cache, cw: pr.cw, line: ri };
    let entry = byLoose.get(model.loose);
    if (!entry) {
      entry = { m: model, tiers: [], line: ri };
      if (unit && (unit.currency || unit.per)) {
        entry.currency = unit.currency;
        entry.per = unit.per || '1M';
      }
      byLoose.set(model.loose, entry);
      found.push(entry);
    } else if (!entry.m._ai && model._ai) {
      entry.m = model;                   // AI 补的结果里有更明确的模型对象
    }
    const dup = entry.tiers.findIndex(t => t.tier === tier.tier);
    if (dup >= 0) entry.tiers[dup] = tier; else entry.tiers.push(tier);
    last = entry;

    if (pr.in == null && pr.out == null) {
      // 认出了模型却抓不到价格（如整段描述挤在一格）——交给 AI 兜底补价格
      miss.push({ i: ri, cells, unitHint: readUnit(cells.join(' ')), hint: model });
    }
  }

  // tiers[0] 即为「基准档」，f.in / f.out 保持兼容旧代码
  for (const f of found) {
    const base = f.tiers[0] || { in: null, out: null };
    f.in = base.in; f.out = base.out; f.cache = base.cache; f.cw = base.cw;
    f.list = base.list; f.listOut = base.listOut; f.disc = base.disc;
    f.curIdx = 0;
  }
  S.uploadRows = found;
  S.uploadMap = found;
  S.upMiss = miss;
  const multi = found.filter(f => f.tiers.length > 1);
  const fz = found.filter(f => f.m._fuzzy).length;
  const pfx = found.filter(f => f.m._ai).length;
  const unitNote = (unit && unit.currency === 'CNY')
    ? ` · 已按 1 USD = ${(D.fx && D.fx.cny_per_usd) || 7.1} CNY 折算`
    : (unit && unit.per === '1K' ? ' · 原表按每千 token，已换算为每百万' : '');
  $('upStatus').innerHTML = `已解析 <b>${esc(srcName)}</b>` +
    (sheetName ? ` · 工作表「${esc(sheetName)}」` : '') +
    `：${rows.length} 行 → 识别出 <b>${found.length}</b> 个模型` +
    (multi.length ? ` · 其中 <b>${multi.length}</b> 个含多档区间（共 ${found.reduce((a, f) => a + f.tiers.length, 0)} 档，已全部展开）` : '') +
    (pfx ? ` <span class="tag ai" title="由大模型补识别">${pfx} 个 AI</span>` : '') +
    (fz ? ` <span class="tag" title="型号变体近似匹配，请核对">${fz} 个近似</span>` : '') +
    (cols ? ' <span class="tag" title="已按表头定位列：' + esc(Object.keys(cols).join('/')) + '">表头定位</span>' : '') +
    unitNote +
    (found.length ? '' : ' （未识别到模型名，可粘贴文本重试）');
  updateAiBtn();
  renderUpload();
}
/* ---------------- AI 补识别（见 llm.js） ---------------- */
const AI_KEY = 'modelprice.llm.v1';
function aiLoadCfg() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(AI_KEY) || 'null'); } catch (e) { }
  const cfg = Object.assign(aiDefaultCfg(), c || {});
  const b = aiBuiltin();
  // 用户没自己填过 key 时，直接用页面内置的（构建期注入、已混淆），无需再手输
  if (b && !cfg.key) {
    cfg.key = b.key;
    if (!c || !c.endpoint) cfg.endpoint = cfg.endpoint || b.endpoint;
    if (!c || !c.model) cfg.model = cfg.model || b.model;
  }
  cfg.builtin = !!(b && cfg.key === b.key);
  cfg.mask = (b && cfg.key === b.key) ? b.mask : maskOf(cfg.key);
  S.aiCfg = cfg;
  return cfg;
}
function aiSaveCfg() {
  try {
    const out = Object.assign({}, S.aiCfg);
    if (out.builtin) out.key = '';        // 内置 key 不落到 localStorage
    localStorage.setItem(AI_KEY, JSON.stringify(out));
  } catch (e) { }
}
function priceOf(f) { return (f.in != null || f.out != null) ? 1 : 0; }
function pricelessN() { return (S.uploadRows || []).filter(f => !priceOf(f)).length; }
/** AI 按钮文案 + 明细：同行』没有模型名』和『有模型但没价格』都要算待补 */
function updateAiBtn() {
  const b = $('aiBtn'), note = $('aiNote');
  if (!b) return;
  const miss = (S.upMiss || []).length;
  const noPrice = pricelessN();
  const parts = [];
  if (miss) parts.push(`${miss} 行未识别`);
  if (noPrice) parts.push(`${noPrice} 个模型缺价格`);
  const label = parts.length ? `AI 补识别（${parts.join(' · ')}）` : 'AI 补识别';
  if (b) { b.disabled = S.aiBusy; b.textContent = S.aiBusy ? '识别中…' : label; }
  if (note && S.aiStat) note.innerHTML = S.aiStat;
}
async function runAI() {
  const cfg = S.aiCfg || aiLoadCfg();
  if (cfg.mode === 'direct' && !cfg.key) {
    S.aiStat = '<span style="color:var(--hi)">直连模式需要填 API Key（点「AI 设置」）</span>';
    updateAiBtn(); return;
  }
  const scope = $('aiScope') ? $('aiScope').value : 'miss';
  const rowsSrc = (scope === 'all')
    ? (S.upAllRows || []).map((r, i) => ({
        i, cells: r.filter(c => c != null && String(c).trim() !== ''),
        unitHint: readUnit(r.filter(c => c != null).join(' '))
      })).filter(x => x.cells.length)
    : S.upMiss;
  if (!rowsSrc.length) {
    S.aiStat = '没有需要 AI 处理的内容'; updateAiBtn(); return;
  }
  const use = rowsSrc.slice(0, cfg.maxRows || 300);
  S.aiBusy = true;
  S.aiStat = `AI 处理中… ${use.length} 行（${Math.ceil(use.length / (cfg.batch || 25))} 批）`;
  updateAiBtn();
  try {
    const fx = (D.fx && D.fx.usd_per_cny) || undefined;
    const res = await aiExtract(use, D.models, cfg, { fx });
    const before = S.uploadRows.length;
    const beforePriced = S.uploadRows.reduce((a, f) => a + priceOf(f), 0);
    mergeAiRows(res.rows, scope === 'all');
    // AI 处理过的行从待补队列里移除；AI 明确丢弃/未返回的行仍保留，避免虚报完成
    const handled = new Set(res.rows.map(r => String(r.srcline)));
    S.upMiss = (S.upMiss || []).filter(m => !handled.has(String(m.i)));
    const added = S.uploadRows.length - before;
    const priced = S.uploadRows.reduce((a, f) => a + priceOf(f), 0) - beforePriced;
    const costNote = (res.usage && (res.usage.prompt_tokens || res.usage.completion_tokens))
      ? ` · tokens ${res.usage.prompt_tokens || 0}↓/${res.usage.completion_tokens || 0}↑` : '';
    S.aiStat = `AI 补识别完成：` +
      (added ? `新增 <b>${added}</b> 个模型` : '无新增模型') +
      (priced ? ` · 补全 <b>${priced}</b> 个模型价格` : '') +
      (res.dropped.length ? ` · ${res.dropped.length} 行无效/重复被丢弃` : '') + costNote +
      (res.error ? ` · <span style="color:var(--hi)">部分批次失败：${esc(res.error.message || res.error)}</span>` : '');
    if (res.error && !res.calls) {
      S.aiStat = `<span style="color:var(--hi)">调用失败：${esc(res.error.message || res.error)}` +
        `（检查代理是否已启动 / Key / 网络）</span>`;
    }
  } catch (e) {
    S.aiStat = `<span style="color:var(--hi)">AI 识别异常：${esc(e.message || e)}</span>`;
  } finally {
    S.aiBusy = false;
    updateAiBtn();
    $('upStatus').innerHTML = $('upStatus').innerHTML.replace(/（未识别到模型名[^）]*）/, '');
    renderUpload();
  }
}
/** 把 AI 结果并入上传表；规则命中的行优先保留 */
function mergeAiRows(rows, overrideAll) {
  const out = [], seen = new Set();
  for (const f of S.uploadRows) {
    if (seen.has(f.m.loose)) continue;
    if (!f.tiers || !f.tiers.length)     // 老数据兜底：补一个基准档
      f.tiers = [{ tier: '', in: f.in, out: f.out, cache: f.cache, cw: f.cw, line: f.line || 0 }];
    out.push(f); seen.add(f.m.loose);
  }
  for (const r of rows) {
    if (!r.m) continue;
    const exist = out.find(f => f.m.loose === r.m.loose);
    if (exist) {
      const fill = (v, nv) => (nv == null ? v : nv);
      if (overrideAll) {                                  // 「重跑全部」：AI 结果整体覆盖
        exist.in = fill(r.in, exist.in); exist.out = fill(r.out, exist.out);
        exist.unit = exist.unit || r.unit; exist.conf = r.conf || exist.conf;
        exist.currency = exist.currency || r.currency; exist.per = exist.per || r.per;
        exist.rawIn = exist.rawIn || r.rawIn; exist.rawOut = exist.rawOut || r.rawOut;
        exist.tiers = [{ tier: '', in: exist.in, out: exist.out, line: r.srcline || 0 }];
      } else if (exist.in == null && exist.out == null && (r.in != null || r.out != null)) {
        // 规则已识别模型、但价格为空 → 只补价格，模型名保持规则结果
        exist.in = r.in; exist.out = r.out;
        exist.unit = r.unit || exist.unit;
        exist.currency = r.currency; exist.per = r.per;
        exist.rawIn = r.rawIn; exist.rawOut = r.rawOut;
        exist.conf = r.conf; exist.note = r.note; exist.srcline = r.srcline;
        exist.aiPriced = true;
        exist.list = exist.list != null ? exist.list : r.list;
        exist.listOut = exist.listOut != null ? exist.listOut : r.listOut;
        // AI 只给一个价，多档行收敛成单档
        if (exist.tiers && exist.tiers.length) {
          exist.tiers = [{ tier: '', in: exist.in, out: exist.out, line: exist.tiers[0].line || 0 }];
        } else exist.tiers = [{ tier: '', in: exist.in, out: exist.out, line: r.srcline || 0 }];
        exist.m = Object.assign({}, exist.m, { _ai: true });  // 克隆，避免污染共享模型对象
      }
      continue;
    }
    const mm = Object.assign({}, r.m, { _ai: true });
    out.push({
      m: mm, in: r.in, out: r.out, unit: r.unit || '', currency: r.currency,
      per: r.per, rawIn: r.rawIn, rawOut: r.rawOut, conf: r.conf, note: r.note,
      srcline: r.srcline, list: r.list, listOut: r.listOut,
      tiers: [{ tier: r.tier || '', in: r.in, out: r.out, line: r.srcline || 0 }],
    });
    seen.add(r.m.loose);
  }
  S.uploadRows = out; S.uploadMap = out;
}
function initAiUI() {
  const cfg = aiLoadCfg();
  const psel = $('aiProvider');
  if (psel) {
    psel.innerHTML = AI_PROVIDERS.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
    psel.value = cfg.provider || AI_PROVIDERS[0].id;
  }
  const fill = () => {
    $('aiProxy').value = cfg.proxyUrl || '';
    $('aiEndpoint').value = cfg.endpoint || '';
    $('aiModel').value = cfg.model || '';
    $('aiKey').value = '';
    $('aiKey').placeholder = cfg.builtin
      ? `已内置 ${cfg.mask}（${esc(cfg.provider || '')} · 留空即沿用）`
      : '仅保存在本机 localStorage';
    document.querySelectorAll('input[name=aimode]').forEach(r => {
      const want = cfg.mode || 'proxy';
      r.checked = (r.value === want);
    });
    if (cfg.builtin && !S.aiStat) {
      S.aiStat = `<span style="color:var(--ok)">已内置密钥 ${esc(cfg.mask)}</span>` +
        ` · <span style="color:var(--tx3)">可直接用 AI 功能；公开分享前用 MODELPRICE_EMBED_KEY=0 重新生成页面</span>`;
    }
  };
  fill();
  if (psel) psel.onchange = () => {
    const p = AI_PROVIDERS.find(x => x.id === psel.value);
    if (p && p.endpoint) { $('aiEndpoint').value = p.endpoint; $('aiModel').value = p.model; }
  };
  $('aiCfgBtn').onclick = () => {
    const b = $('aiCfg');
    b.style.display = (b.style.display === 'none') ? '' : 'none';
  };
  $('aiSave').onclick = () => {
    const typedKey = $('aiKey').value.trim();
    Object.assign(cfg, {
      mode: (document.querySelector('input[name=aimode]:checked') || {}).value || 'proxy',
      proxyUrl: $('aiProxy').value.trim(),
      endpoint: $('aiEndpoint').value.trim(),
      model: $('aiModel').value.trim(),
      provider: psel ? psel.value : cfg.provider,
    });
    const b = aiBuiltin();
    if (typedKey) { cfg.key = typedKey; cfg.builtin = false; }
    else if (b) { cfg.key = b.key; cfg.builtin = true; }   // 输入框留空 = 继续用内置
    // 没填且无内置时保留原值，避免误清空
    cfg.mask = maskOf(cfg.key);
    aiSaveCfg();
    $('aiCfgNote').innerHTML = '<span style="color:var(--ok)">已保存到本机浏览器</span>';
  };
  $('aiTest').onclick = async () => {
    $('aiCfgNote').textContent = '测试中…';
    try {
      const typedKey = $('aiKey').value.trim();
      const c = Object.assign({}, cfg, {
        mode: (document.querySelector('input[name=aimode]:checked') || {}).value || 'proxy',
        proxyUrl: $('aiProxy').value.trim(), endpoint: $('aiEndpoint').value.trim(),
        model: $('aiModel').value.trim(),
        key: typedKey || (cfg.builtin ? cfg.key : ''),
      });
      const r = await aiCall([{ role: 'user', content: '只回复两个字：OK' }], c, fetch);
      $('aiCfgNote').innerHTML = '<span style="color:var(--ok)">连接正常：' +
        esc(String(r.content || '').slice(0, 40)) + '</span>';
    } catch (e) {
      $('aiCfgNote').innerHTML = '<span style="color:var(--hi)">失败：' + esc(e.message || e) + '</span>';
    }
  };
  if ($('aiBtn')) $('aiBtn').onclick = runAI;
  updateAiBtn();
  // 开页即探测本地代理是否就绪，省得用户点了才发现没起服务
  const _f = (typeof fetch === 'function') ? fetch : null;
  if (_f && cfg.mode === 'proxy' && cfg.proxyUrl) {
    const health = String(cfg.proxyUrl).replace(/\/extract\/?$/, '/health');
    const _show = (html) => { S.aiStat = html; updateAiBtn(); };
    try {
      _f(health, { method: 'GET' }).then(r => r.ok ? r.json() : null)
        .then(j => _show(j && j.ok
          ? `<span style="color:var(--ok)">本地代理已就绪 · ${esc(j.model || '')}</span>`
          : '<span style="color:var(--tx3)">本地代理未响应 → 双击 scripts/start_ai.command</span>'),
        () => _show('<span style="color:var(--tx3)">本地代理未启动 → 双击 scripts/start_ai.command（不影响正常比价）</span>'));
    } catch (e) { /* 探测失败不影响页面 */ }
  }
}

/* AI 补识别出来的价格要能看清原始值与折算过程，便于人工核对 */
function upVal(f, k) {
  const v = k === 'in' ? f.in : f.out;
  if (v == null) return '<span class="na">—</span>';
  if (!f.m._ai) {
    const fx = (D.fx && D.fx.cny_per_usd) || 7.1;
    const notes = [];
    let tag = '';
    if (f.currency === 'CNY') {
      tag += '折算';
      notes.push(`原表为人民币，按 1 USD = ${fx} CNY 折算为 USD/1M tokens`);
    }
    if (f.per === '1K') {
      tag += (tag ? '·' : '') + '×1K';
      notes.push('原表按每千 token 计价，已 ×1000 换算为每百万 token');
    }
    return nf(v) + (tag ? `<span class="unit" title="${esc(notes.join('\n'))}">${tag}</span>` : '');
  }
  const raw = k === 'in' ? f.rawIn : f.rawOut;
  const fx = (D.fx && D.fx.cny_per_usd) || 7.1;
  const tip = [
    `原表：${raw} ${f.currency === 'CNY' ? '¥' : f.currency === 'USD' ? '$' : ''} / ${f.per || '1M'} tokens`,
    (f.currency === 'CNY' ? `按 1 USD = ${fx} CNY 折算` : '美元无需折算'),
    `第 ${(f.srcline ?? 0) + 1} 行 · 置信度 ${f.conf || '-'}`,
    f.note || '',
  ].filter(Boolean).join('\n');
  return `${nf(v)}<span class="unit" title="${esc(tip)}">${esc(f.unit || '')}</span>`;
}

function renderUpload() {
  const box = $('upResult');
  if (!S.uploadRows.length) { box.innerHTML = ''; $('upChart').innerHTML = ''; return; }
  let h = `<div class="tw" style="max-height:none"><table><thead><tr>
    <th class="l">上传的模型</th><th>区间（Tokens）</th><th>官网价 输入</th><th>官网价 输出</th>
    <th>上传 输入价</th><th>本站最低</th><th>本站最高</th><th>差异</th>
    <th>上传 输出价</th><th>本站最低</th><th>本站最高</th><th>差异</th></tr></thead><tbody>`;
  const curve = [];
  for (const f of S.uploadRows) {
    const m = f.m;
    const o = m.official;
    const offIn = offVal(m, 'input'), offOut = offVal(m, 'output');
    const offCls = !o ? '' : (o.src === 'openrouter' ? 'off-fb' : 'off');
    const offCell2 = v => v == null ? '<span class="na">—</span>'
      : `<span class="pill ${offCls}" title="${esc(offTitle(m))}">${nf(v)}${o && o.src === 'openrouter' ? '<sup class="fb">OR</sup>' : ''}</span>`;
    const tags = (m._ai ? ` <span class="tag ai" title="由大模型补识别，请核对">AI${f.conf === 'low' ? '?' : ''}</span>` : '') +
      (m._fuzzy ? ' <span class="tag" title="型号变体近似匹配，请人工核对">近似</span>' : '') +
      (m.has_media ? ' <span class="tag" title="按张/秒/步计价，未参与 token 比价">媒体计价</span>' : '');
    const nrow = Math.max(1, f.tiers.length);
    const isMedia = !!m.has_media;
    h += `<tr><td class="l" rowspan="${nrow}"><span class="mname">${esc(m.name)}</span>${tags}<br>
      <span class="mven">${esc(m.vendor)} · 匹配 ${m.n_src} 源</span></td>`;

    // 每个价格档位单独一行展开
    f.tiers.forEach((t, ti) => {
      const vin = SRCIDS.map(s => valOf(m, s, 'input')).filter(v => v != null);
      const vout = SRCIDS.map(s => valOf(m, s, 'output')).filter(v => v != null);
      const mnIn = vin.length ? Math.min(...vin) : null, mxIn = vin.length ? Math.max(...vin) : null;
      const mnOut = vout.length ? Math.min(...vout) : null, mxOut = vout.length ? Math.max(...vout) : null;
      const fIn = t.in, fOut = t.out;
      const cmpIn = (fIn != null && mnIn != null && mnIn > 0) ? ((fIn - mnIn) / mnIn * 100) : null;
      const cmpOut = (fOut != null && mnOut != null && mnOut > 0) ? ((fOut - mnOut) / mnOut * 100) : null;
      const cellIn = isMedia ? '<span class="na">媒体计价</span>' : (fIn != null && mnIn != null)
        ? (mnIn === 0 ? '<span class="pill hi">本站 $0（限免）</span>'
          : fIn > mxIn ? `<span class="pill hi">高 ${cmpIn.toFixed(0)}%</span>`
          : fIn < mnIn ? `<span class="pill lo">低</span>`
            : `<span class="hl">${cmpIn.toFixed(0)}%</span>`) : '<span class="na">—</span>';
      const cellOut = isMedia ? '<span class="na">媒体计价</span>' : (fOut != null && mnOut != null)
        ? (mnOut === 0 ? '<span class="pill hi">本站 $0（限免）</span>'
          : fOut > mxOut ? `<span class="pill hi">高 ${cmpOut.toFixed(0)}%</span>`
          : fOut < mnOut ? `<span class="pill lo">低</span>`
            : `<span class="hl">${cmpOut.toFixed(0)}%</span>`) : '<span class="na">—</span>';
      const rowHl = (!isMedia && fIn != null && mnIn != null && fIn > mnIn * 1.0001) ? ' class="hl"' : '';
      const sub = { m, in: fIn, out: fOut, currency: f.currency, per: f.per, rawIn: f.rawIn,
        rawOut: f.rawOut, unit: f.unit, conf: f.conf, note: f.note, srcline: t.line,
        tier: t.tier };
      const tierName = t.tier
        ? `<span class="tier" title="第 ${t.line + 1} 行">${esc(t.tier)}</span>`
        : '<span class="na">基准</span>';
      if (ti > 0) h += '<tr' + rowHl + '>';
      h += `<td class="l">${tierName}</td>
        <td>${offCell2(offIn)}</td><td>${offCell2(offOut)}</td>
        <td class="${fIn != null && mnIn != null && fIn > mnIn ? 'hl' : ''}">${upVal(sub, 'in')}</td>
        <td class="hl2">${isMedia ? '—' : nf(mnIn)}</td><td class="hl3">${isMedia ? '—' : nf(mxIn)}</td><td>${cellIn}</td>
        <td class="${fOut != null && mnOut != null && fOut > mnOut ? 'hl' : ''}">${upVal(sub, 'out')}</td>
        <td class="hl2">${isMedia ? '—' : nf(mnOut)}</td><td class="hl3">${isMedia ? '—' : nf(mxOut)}</td><td>${cellOut}</td></tr>`;
      if (!isMedia && ti === 0 && fIn != null && mnIn != null)
        curve.push({ name: m.name, up: fIn, min: mnIn, max: mxIn, off: offIn });
    });
  }
  h += '</tbody></table></div>';
  box.innerHTML = h;
  renderAnalysis();

  // 比较曲线
  if (curve.length) {
    const n = Math.min(curve.length, 14);
    const cs = curve.slice(0, n);
    const W = Math.max(720, cs.length * 60), H = 300, pl = 56, pr = 20, pt = 20, pb = 56;
    const iw = W - pl - pr, ih = H - pt - pb;
    const mx = Math.max(...cs.flatMap(c => [c.up, c.max || 0, c.off || 0])) || 1;
    const X = i => pl + iw * (i + .5) / cs.length;
    const Y = v => pt + ih - ih * (v / mx);
    let s = `<svg viewBox="0 0 ${W} ${H}">`;
    for (let i = 0; i <= 4; i++) {
      const y = pt + ih - ih * i / 4;
      s += `<line x1="${pl}" y1="${y}" x2="${W - pr}" y2="${y}" stroke="var(--line)"/>
        <text x="${pl - 8}" y="${y + 4}" text-anchor="end" fill="var(--tx3)" font-size="11">${(mx * i / 4).toFixed(2)}</text>`;
    }
    const poly = key => cs.map((c, i) => c[key] == null ? null
      : `${X(i).toFixed(1)},${Y(c[key]).toFixed(1)}`).filter(Boolean).join(' ');
    s += `<polyline points="${poly('min')}" fill="none" stroke="#22c55e" stroke-width="2"/>`;
    s += `<polyline points="${poly('max')}" fill="none" stroke="#ef4444" stroke-width="2"/>`;
    s += `<polyline points="${poly('up')}" fill="none" stroke="#eab308" stroke-width="2.6" stroke-dasharray="6 3"/>`;
    if (cs.some(c => c.off != null))
      s += `<polyline points="${poly('off')}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-dasharray="2 3"/>`;
    cs.forEach((c, i) => {
      s += `<circle cx="${X(i)}" cy="${Y(c.up)}" r="4" fill="#eab308"><title>${esc(c.name)} 上传价 ${nf(c.up)}</title></circle>`;
      s += `<text x="${X(i)}" y="${pt + ih + 18}" text-anchor="middle" fill="var(--tx2)" font-size="10.5"
        transform="rotate(-18 ${X(i)} ${pt + ih + 18})">${esc(c.name.slice(0, 16))}</text>`;
    });
    s += '</svg>';
    $('upChart').innerHTML = s +
      `<div class="lgd"><span><i style="background:#eab308"></i>你的上传价</span>
       <span><i style="background:#22c55e"></i>本站最低</span>
       <span><i style="background:#ef4444"></i>本站最高</span>
       <span><i style="background:var(--acc)"></i>模型官网价格</span></div>`;
  }
}

/* ======================== 状态 ======================== */
function renderStatus() {
  let h = '<div class="grid g4">';
  for (const s of SRC) {
    const r = (D.runs || []).find(x => x.source === s.id) || {};
    const ok = r.status === 'ok';
    h += `<div class="card"><h3><span class="dotst ${ok ? 'ok' : 'bad'}"></span>${esc(s.label)}</h3>
      <div class="big">${r.kept ?? '—'}<span style="font-size:13px;color:var(--tx3)"> 个模型</span></div>
      <div class="sm">${ok ? '采集成功' : '采集失败：' + esc(r.message || '未知')}</div>
      <div class="sm" style="margin-top:6px">${esc(s.note)}</div>
      <div class="sm" style="margin-top:6px"><a href="${esc(s.url)}" target="_blank" rel="noopener">访问官网 ↗</a></div></div>`;
  }
  h += '</div>';
  h += `<div class="sec">覆盖统计</div><div class="grid g4">
    <div class="card"><h3>模型组总数</h3><div class="big">${D.models.length}</div><div class="sm">跨源去重后</div></div>
    <div class="card"><h3>可跨源比对</h3><div class="big">${D.models.filter(m => m.n_src >= 2).length}</div><div class="sm">≥2 个源有同款</div></div>
    <div class="card"><h3>关注模型</h3><div class="big">${D.models.filter(m => m.watch).length}</div><div class="sm">已全部命中数据</div></div>
    <div class="card"><h3>快照日期</h3><div class="big" style="font-size:16px">${esc(D.latest)}</div>
      <div class="sm">共 ${D.dates.length} 天</div></div></div>`;
  $('status').innerHTML = h;
}

/* ======================== 交互绑定 ======================== */
function switchTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  document.querySelectorAll('.pane').forEach(x => x.classList.toggle('on', x.id === 'p-' + t));
  if (t === 'watch') renderWatch();
  if (t === 'media') renderMedia();
  if (t === 'trend') renderTrend();
  if (t === 'status') renderStatus();
}
function init() {
  // 源 chips
  $('srcChips').innerHTML = SRC.map(s =>
    `<span class="chip on" data-s="${s.id}"><span class="sw" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('');
  $('srcChips').querySelectorAll('.chip').forEach(c => c.onclick = () => {
    const id = c.dataset.s;
    if (S.srcs.has(id)) { if (S.srcs.size <= 1) return; S.srcs.delete(id); c.classList.add('off'); }
    else { S.srcs.add(id); c.classList.remove('off'); }
    renderTable(); renderChart();
  });
  $('metric').innerHTML = ['input', 'output', 'cache_read', 'cache_write', 'discount']
    .map(m => `<option value="${m}">${metricLabel(m)}</option>`).join('');
  $('metric').value = S.metric;
  $('metric').onchange = e => { S.metric = e.target.value; renderTable(); renderChart(); };
  $('q').oninput = e => { S.q = e.target.value.trim(); renderTable(); };
  $('region').onchange = e => { S.region = e.target.value; renderTable(); };
  $('kind').onchange = e => { S.kind = e.target.value; renderTable(); };
  $('minSrc').onchange = e => { S.minSrc = +e.target.value; renderTable(); };
  $('theme').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const nxt = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nxt);
    try { localStorage.setItem('mp-theme', nxt); } catch (_) {}
    renderChart(); renderTrend();
  };
  try {
    const t = localStorage.getItem('mp-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (_) {}
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.t));

  // 上传
  const drop = $('drop');
  drop.onclick = () => $('file').click();
  const anSel = $('anMax');
  if (anSel) {
    anSel.value = String(S.anMax || 12);
    anSel.onchange = () => { S.anMax = +anSel.value; renderAnalysis(); };
  }
  $('file').onchange = e => { [...e.target.files].forEach(handleFile); };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { [...e.dataTransfer.files].forEach(handleFile); });
  $('pasteBtn').onclick = () => {
    const t = $('paste').value;
    if (!t.trim()) return;
    analyzeRows(parseDelim(t), '粘贴内容');
  };
  $('trendSrc').onchange = e => { S.trendSrc = e.target.value; renderTrend(); };
  $('trendModel').onchange = () => renderTrend();
  $('exportBtn').onclick = () => {
    const rows = [['model', 'vendor', 'source', 'model_id', 'input', 'output', 'cache_read', 'cache_write', 'list_input', 'discount']];
    for (const m of visibleModels()) for (const sid of SRCIDS) {
      const p = m.prices[sid]; if (!p) continue;
      rows.push([m.name, m.vendor, sid, p.model_id, p.input, p.output, p.cache_read, p.cache_write, p.list_input, p.discount]);
    }
    const csv = rows.map(r => r.map(v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = `model-prices-${D.latest}.csv`;
    a.click();
  };

  $('updated').textContent = D.latest + ' ' + (D.generated || '').slice(11, 16);
  renderTable(); renderChart(); renderDetail(); initAiUI();
}
init();

/* ===================================================================
   上传结果分析面板
   -------------------------------------------------------------------
   目标：不看表格也能一句话看懂——"我买的贵不贵、贵在哪、该找谁"。
   全部在本地算，不发网络请求；可选的「AI 解读」才调大模型。
   =================================================================== */

/* 家族键：去掉版本号与变体词后剩下的主干。
   Claude-4.5-sonnet / Claude-4.6-sonnet / Claude-5-sonnet 归为一族，
   GPT-5.2 / GPT-5.2-Chat 也归为一族 —— 只留旗舰，小版本不重复占用版面。 */
const FAM_VENDOR = new Set(['qwen', 'alibaba', 'deepseek', 'zai', 'moonshotai', 'ai',
  'openai', 'anthropic', 'google', 'meta', 'bytedance', 'tencent', 'baichuan', 'stepfun',
  'paddlepaddle', 'baai', 'xai', 'mistralai', 'openrouter', '01']);
function familyKey(name) {
  let tk = TOKENS(name).filter(t => !VARIANT_WORDS.has(t) && !/^\d+(\.\d+)*$/.test(t));
  if (tk.length > 1) tk = tk.filter(t => !FAM_VENDOR.has(t));   // 去掉厂商前缀，Qwen/Qwen3-8B ≡ Qwen3 8B
  tk = tk.map(t => { const m = t.match(/^([a-z]+)[\d.]+$/); return m ? m[1] : t; });  // glm5.3→glm
  return tk.length ? tk.join('|') : LOOSE(name);
}
/* 重要性：关注模型 > 跨源覆盖广 > 有上传价 > 单价高（旗舰通常更贵） */
function modelRank(f) {
  const vals = SRCIDS.map(s => valOf(f.m, s, 'input')).filter(v => v != null);
  const mn = vals.length ? Math.min(...vals) : 0;
  return (f.m.watch ? 10000 : 0) + (f.m.n_src || 0) * 100 +
    (f.in != null || f.out != null ? 50 : 0) + Math.min(mn, 20);
}
/** 每个家族保留一个代表模型，并按重要性排序 */
function mainModels(rows) {
  const g = new Map();
  for (const f of rows) {
    const k = familyKey(f.m.name);
    const cur = g.get(k);
    if (!cur || modelRank(f) > modelRank(cur)) g.set(k, f);
  }
  return [...g.values()].sort((a, b) => modelRank(b) - modelRank(a));
}
/** 本站某指标的最低/最高价及其来源 */
function extremum(m, metric) {
  let lo = null, loSrc = null, hi = null, hiSrc = null;
  for (const sid of SRCIDS) {
    const v = valOf(m, sid, metric);
    if (v == null) continue;
    if (lo == null || v < lo) { lo = v; loSrc = sid; }
    if (hi == null || v > hi) { hi = v; hiSrc = sid; }
  }
  return { lo, loSrc, hi, hiSrc };
}
/** 相对百分比。基准价为 0（限免模型）时无法算倍数，返回 null */
function relPct(mine, base) {
  if (mine == null || base == null) return null;
  if (!base) return null;
  return (mine - base) / base * 100;
}
function pctWord(p) {
  if (p == null) return '—';
  if (Math.abs(p) < 0.5) return '基本持平';
  return (p > 0 ? '高 ' : '低 ') + Math.abs(p).toFixed(0) + '%';
}
function discountWord(mine, list) {
  if (mine == null || list == null || list <= 0) return null;
  const d = mine / list * 10;                       // 中文习惯：几折
  return d >= 9.95 ? null : d.toFixed(1).replace(/\.0$/, '') + ' 折';
}
function tierBrief(f) {
  if (!f.tiers || f.tiers.length < 2) return null;
  return f.tiers.map(t => `${t.tier || '基准'} ${nf(t.in)}`).join(' / ');
}

/**
 * 生成分析文本。
 * @returns {{text:string, html:string, mains:Array, stat:Object}}
 */
function buildAnalysis(rows, maxN) {
  const all = rows || S.uploadRows || [];
  const n = maxN || S.anMax || 12;
  const mains = mainModels(all);
  const stat = { total: all.length, higher: 0, lower: 0, equal: 0, noCmp: 0, zero: 0, media: 0,
    deltas: [], worst: null };
  for (const f of all) {
    if (f.m.has_media) { stat.media++; stat.noCmp++; continue; }
    const e = extremum(f.m, 'input');
    if (f.in == null || e.lo == null) { stat.noCmp++; continue; }
    if (!e.lo) { stat.zero++; continue; }            // 本站最低为 0（限免），百分无意义
    const d = (f.in - e.lo) / e.lo * 100;
    stat.deltas.push(d);
    if (d > 1) stat.higher++;
    else if (d < -1) stat.lower++;
    else stat.equal++;
    if (!stat.worst || d > stat.worst.d) stat.worst = { name: f.m.name, d };
  }
  const avgD = stat.deltas.length ? stat.deltas.reduce((a, b) => a + b, 0) / stat.deltas.length : null;
  const list = mains.slice(0, n);
  const L = [];
  const tierTotal = all.reduce((a, f) => a + (f.tiers ? f.tiers.length : 1), 0);
  const head = `共识别 ${all.length} 个模型（${tierTotal} 个价格档位），` +
    `其中 ${mains.length} 个主模型` +
    (stat.media ? `（含 ${stat.media} 个媒体模型，按张/秒计价，未参与 token 比较）` : '') +
    `。以下只对主模型逐条分析。`;
  L.push(head);
  const cmp = `与本站最低价相比：${stat.higher} 个偏高、${stat.equal} 个持平、${stat.lower} 个更低` +
    (stat.zero ? `、${stat.zero} 个本站最低为 $0（限免，无法算倍数）` : '') +
    (avgD != null ? `；平均价差 ${pctWord(avgD)}` : '') +
    (stat.worst && stat.worst.d > 1 ? `，最贵的是 ${stat.worst.name}（${pctWord(stat.worst.d)}）` : '') + '。';

  const items = [];
  for (const f of list) {
    const m = f.m;
    if (m.has_media) {
      const my = `${f.in == null ? '—' : '$' + nf(f.in)} / ${f.out == null ? '—' : '$' + nf(f.out)}`;
      items.push({
        name: m.name,
        lines: [`你的报价 ${my}`, '媒体模型按张/秒/步计价，未参与 token 最低价比较；请到「图像 / 视频」页查看同单位报价。'],
        verdict: '', watch: !!m.watch, n_src: m.n_src,
      });
      continue;
    }
    const ei = extremum(m, 'input'), eo = extremum(m, 'output');
    // 只有厂商官方价才能当「刊例价」算折扣；OpenRouter 兜底只是参考价。
    const isOfficial = !!(m.official && m.official.src === 'official');
    const li = isOfficial ? offVal(m, 'input') : null;
    const lo = isOfficial ? offVal(m, 'output') : null;
    const my = `${f.in == null ? '—' : '$' + nf(f.in)} / ${f.out == null ? '—' : '$' + nf(f.out)}`;
    const bullet = [];
    bullet.push(`你的报价 ${my}（USD/M tokens）` +
      (f.disc && f.disc !== 1 && f.list != null
        ? `；表内目录价 $${nf(f.list)} / ${f.listOut == null ? '—' : '$' + nf(f.listOut)}，` +
          `按表内 ${(f.disc * 100).toFixed(0)} 折折算`
        : '') +
      (f.tiers && f.tiers.length > 1 ? `；本表分 ${f.tiers.length} 档：${tierBrief(f)}` : '') +
      (f.currency === 'CNY' ? '（原表为人民币，已按汇率折算）' : ''));
    if (ei.lo == null) bullet.push('本站暂无可比数据');
    else if (!ei.lo) bullet.push(`本站最低 $0（${srcLabel(ei.loSrc)} 限免），你的报价 $${nf(f.in)}` +
      ' —— 本站该模型免费，无法算倍数');
    else bullet.push(`本站最低 ${'$' + nf(ei.lo)} / ${eo.lo == null ? '—' : '$' + nf(eo.lo)}` +
      `（${srcLabel(ei.loSrc)}）→ 输入${pctWord(relPct(f.in, ei.lo))}` +
      (eo.lo != null && f.out != null ? `，输出${pctWord(relPct(f.out, eo.lo))}` : ''));
    const di = discountWord(f.in, li), dof = discountWord(f.out, lo);
    const fbIn = offVal(m, 'input');
    bullet.push(li != null
      ? `刊例价 ${'$' + nf(li)} / ${lo == null ? '—' : '$' + nf(lo)}` +
        ` → 你的价约 ${di || '原价'}${dof && dof !== di ? `（输出 ${dof}）` : ''}` +
        (ei.lo != null && li ? `；本站最低相当于 ${discountWord(ei.lo, li) || '原价'}` : '')
      : (fbIn != null
          ? `厂商刊例价未收录（仅有 OpenRouter 参考价 $${nf(fbIn)}，不能算官方折扣）`
          : '厂商刊例价未收录，无法算折扣'));
    const rp = relPct(f.in, ei.lo);
    const verdict = (rp != null)
      ? (rp > 0.2 ? '偏高明显，建议议价或换源。'
        : rp < -0.05 ? '低于本站最低，价格有优势。' : '与行情接近。')
      : (ei.lo === 0 ? '本站该模型免费，建议直接改用。' : '');
    items.push({ name: m.name, lines: bullet, verdict, watch: !!m.watch, n_src: m.n_src });
  }
  const text = [head, cmp, ''].concat(items.map((it, i) =>
    `${i + 1}. ${it.name}${it.watch ? '（关注）' : ''}\n   ` + it.lines.join('\n   ') +
    (it.verdict ? `\n   结论：${it.verdict}` : ''))).join('\n');
  const html = `<div class="an-head">${esc(head)}<br><b>${esc(cmp)}</b></div>` +
    items.map(it => `<div class="an-item"><div class="an-t">${esc(it.name)}${
      it.watch ? ' <span class="tag">关注</span>' : ''}${
      it.n_src ? ` <span class="sm">${it.n_src} 源在售</span>` : ''}</div>${
      it.lines.map(l => `<div class="an-l">${esc(l)}</div>`).join('')}${
      it.verdict ? `<div class="an-v">${esc(it.verdict)}</div>` : ''}</div>`).join('');
  return { text, html, mains, stat };
}

function renderAnalysis() {
  const box = $('anBox');
  if (!box) return;
  const rows = S.uploadRows || [];
  if (!rows.length) {
    box.innerHTML = '<div class="empty">上传或粘贴报价后，这里会自动给出价格分析。</div>';
    return;
  }
  const n = S.anMax || 12;
  let r;
  try { r = buildAnalysis(rows, n); }
  catch (e) { box.innerHTML = '<div class="empty">分析生成失败：' + esc(e.message) + '</div>'; return; }
  const total = r.mains.length;
  box.innerHTML = r.html +
    (total > n ? `<div class="an-more">共 ${total} 个主模型，当前显示前 ${n} 个。` +
      `<a href="javascript:void 0" id="anMore">显示全部</a></div>` : '') +
    `<div class="an-foot"><span>共 ${esc(r.text.length)} 字 · 可复制后贴进报告</span>
      <button class="btn xs" id="anCopy">复制文字</button>
      <button class="btn xs" id="anAI">AI 解读</button></div>`;
  const more = $('anMore');
  if (more) more.onclick = () => { S.anMax = 999; renderAnalysis(); };
  const cp = $('anCopy');
  if (cp) cp.onclick = () => {
    const ta = document.createElement('textarea');
    ta.value = r.text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); cp.textContent = '已复制'; }
    catch (e) { cp.textContent = '复制失败'; }
    ta.remove(); setTimeout(() => { cp.textContent = '复制文字'; }, 1600);
  };
  const ai = $('anAI');
  if (ai) ai.onclick = () => runAiInsight(ai, r.text);
}

/** 把本地算好的事实交给大模型做自然语言解读（可选，需要已配置 AI） */
async function runAiInsight(btn, facts) {
  const cfg = S.aiCfg || aiLoadCfg();
  if (cfg.mode === 'direct' && !cfg.key && !aiBuiltin()) {
    S.anAi = '<span style="color:var(--hi)">还没填 Key：点页面下方「AI 设置」</span>';
    afterInsight(); return;
  }
  btn.disabled = true; btn.textContent = '解读中…';
  try {
    const res = await aiCall([
      { role: 'system', content: '你是资深采购分析师。只用中文作答，直接给结论，不要复述数据小数点后超过 2 位，不要说"根据您提供的数据"这类客套话。' },
      { role: 'user', content: `以下是某平台 LLM 报价与市场价格对比的事实数据：\n\n${facts}\n\n` +
          `请输出：1）一句话总体判断；2）最需要议价的 3 个模型及理由（带具体数字）；` +
          `3）可以考虑换源或直接采用的模型；4）一个风险提示。控制在 400 字以内，用短句分条。` },
    ], cfg, typeof fetch === 'function' ? fetch : null);
    S.anAi = '<div class="an-ai">' + esc(res.content || '').replace(/\n/g, '<br>') + '</div>';
  } catch (e) {
    S.anAi = `<span style="color:var(--hi)">AI 解读失败：${esc(e.message || e)}` +
      `（本地分析结果不受影响，可照常使用）</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'AI 解读'; }
    afterInsight();
  }
}
function afterInsight() {
  const box = $('anAiOut');
  if (box) box.innerHTML = S.anAi || '';
}

/* 调试/测试钩子：暴露内部状态给 Node 测试与浏览器控制台 */
if (typeof window !== 'undefined')
  window.__MP = { S, D, SRC, SRCIDS, analyzeRows, buildAnalysis, mainModels, familyKey,
    extremum, pickPrices, detectColumns, renderAnalysis, renderUpload, handleFile };
