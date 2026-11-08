/* ===================================================================
   GPU 算力栏目（gpu-radar 合并进 Token Market Insight）
   -------------------------------------------------------------------
   数据来自 build_site.py 注入的 D.gpu 快照（scripts/collect_gpu.py 生成）。
   两个栏目：GPU 资源池（云平台现货） / GPU 社媒线索（社媒闲置供给）。
   全部本地渲染，不发网络请求；筛选在内存里做。
   =================================================================== */

const GPU_PLATFORM_COLORS = {
  'Vast.ai': '#7C6CF6', 'RunPod': '#F97316', 'Lambda': '#22C55E', 'TensorDock': '#06B6D4',
  'Paperspace': '#EC4899', 'FluidStack': '#EAB308', 'Crusoe': '#3B82F6', 'Orca': '#14B8A6',
};

const GPU_SOCIAL_COLORS = {
  'Twitter/X': '#3B82F6', 'Facebook': '#22C55E', 'Reddit': '#F97316', 'Discord': '#7C6CF6',
  'Telegram': '#06B6D4', 'HackerNews': '#EC4899', 'QQ群': '#EAB308', '小红书': '#F85149',
};

/* 每个栏目一份独立筛选状态 */
const GPU_STATE = {
  gpu: { q: '', model: 'all', platform: 'all', maxPrice: '' },
  gpsocial: { q: '', model: 'all', platform: 'all', maxPrice: '' },
};

function gpuPack() {
  return (typeof D !== 'undefined' && D && D.gpu) ? D.gpu : null;
}

function gpuColor(map, name) {
  return map[name] || '#8A8A96';
}

/* ---------------- 原帖预览：悬停浮层 + 点击详情层 ---------------- */
const GPU_LAST = { gpu: [], gpsocial: [] };
let GPU_TIP = null;

function gpuTipEl() {
  if (!GPU_TIP) {
    GPU_TIP = document.createElement('div');
    GPU_TIP.className = 'gpu-tip';
    document.body.appendChild(GPU_TIP);
  }
  return GPU_TIP;
}

function gpuTipMove(e) {
  const t = gpuTipEl();
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
  t.style.left = Math.max(8, x) + 'px';
  t.style.top = Math.max(8, y) + 'px';
}

function gpuTipHide() {
  if (GPU_TIP) GPU_TIP.classList.remove('on');
}

function gpuBindTips(root) {
  (root || document).querySelectorAll('[data-tip]').forEach(el => {
    el.onmouseenter = e => {
      const t = gpuTipEl();
      t.textContent = el.getAttribute('data-tip') || '';
      t.classList.add('on');
      gpuTipMove(e);
    };
    el.onmousemove = gpuTipMove;
    el.onmouseleave = gpuTipHide;
  });
}

/* mock 社媒线索的 direct_url 是「结构真实但帖子 ID 编造」的地址（如 x.com/xxx/status/9000），
   点了照样 404，所以统一走站内详情弹窗，不跳转外链。 */

/* mock 帖子的兜底：跳转到来源平台的真实搜索页 */
function gpuSearchUrl(platform, query) {
  const q = encodeURIComponent(query || '');
  switch (platform) {
    case 'Twitter/X': return `https://x.com/search?q=${q}`;
    case 'Facebook': return `https://www.facebook.com/search/top?q=${q}`;
    case 'Reddit': return `https://www.reddit.com/search/?q=${q}`;
    case 'Discord': return `https://discord.com/servers?query=${q}`;
    case 'HackerNews': return `https://hn.algolia.com/?q=${q}`;
    case '小红书': return `https://www.xiaohongshu.com/search_result?keyword=${q}`;
    case 'Telegram': return `https://www.google.com/search?q=${encodeURIComponent('site:t.me ' + (query || ''))}`;
    default: return `https://www.google.com/search?q=${q}`;
  }
}

function gpuModalOpen(r) {
  if (!r) return;
  let box = document.getElementById('gpuModal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'gpuModal';
    box.className = 'gpu-modal';
    box.innerHTML = '<div class="gpu-modal-box">'
      + '<button class="gpu-modal-x" aria-label="关闭">×</button>'
      + '<div class="gpu-modal-body"></div></div>';
    document.body.appendChild(box);
    box.addEventListener('click', e => { if (e.target === box) box.classList.remove('on'); });
    box.querySelector('.gpu-modal-x').onclick = () => box.classList.remove('on');
  }
  gpuTipHide();
  const cnt = r.extracted_gpu_count == null ? '?' : r.extracted_gpu_count;
  const q = `${cnt}x ${r.extracted_gpu_model || ''} 出租`;
  const topic = r.topic ? `<span class="tag ai">${esc(r.topic)}</span>` : '';
  const firstSeen = r.first_seen_at ? gpuTime(r.first_seen_at) : '—';
  const lastSeen = r.last_seen_at ? gpuTime(r.last_seen_at) : '—';
  // 原始载荷：快照里是字符串，尝试解析后缩进格式化；解析失败就原样展示
  let rawHtml = '';
  if (r.raw_json_data) {
    let pretty = r.raw_json_data;
    try { pretty = JSON.stringify(JSON.parse(r.raw_json_data), null, 2); } catch (e) {}
    rawHtml = `<div class="gpu-modal-sec">原始载荷</div>`
      + `<pre class="gpu-modal-raw">${esc(pretty)}</pre>`;
  }
  box.querySelector('.gpu-modal-body').innerHTML = `
    <div class="gpu-modal-head">
      <span class="dotst" style="background:${gpuColor(GPU_SOCIAL_COLORS, r.source_platform)}"></span>
      <b>${esc(r.source_platform)}</b>
      <span class="mven">${esc(r.poster_name || '—')}</span>
      ${topic}
    </div>
    <div class="gpu-modal-post">${esc(r.post_text)}</div>
    <div class="gpu-modal-meta">
      <span>型号 <b>${esc(cnt + 'x ' + (r.extracted_gpu_model || '未知'))}</b></span>
      <span>报价 <b>${esc(r.extracted_price_desc || '面议')}</b></span>
      <span>联系方式 <b>${esc(r.contact_info || '未提供')}</b></span>
    </div>
    <div class="gpu-modal-time">
      首次采集 <b>${esc(firstSeen)}</b> · 最近采集 <b>${esc(lastSeen)}</b>
    </div>
    ${rawHtml}
    <div class="gpu-modal-acts">
      <a class="btn primary sm" href="${esc(gpuSearchUrl(r.source_platform, q))}"
         target="_blank" rel="noreferrer noopener">在 ${esc(r.source_platform)} 搜索同款 ↗</a>
      <span class="sm">打开来源平台的真实搜索页</span>
    </div>
    <div class="gpu-modal-note">该帖为演示数据，原帖地址（${esc(r.direct_url)}）的帖子 ID 为编造，
      未指向真实页面；接入真实采集源后这里会直接跳转原帖。</div>`;
  box.classList.add('on');
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  gpuTipHide();
  const m = document.getElementById('gpuModal');
  if (m) m.classList.remove('on');
});
window.addEventListener('scroll', gpuTipHide, true);

/* 后端存 naive UTC：补 Z 再按本地时区显示，避免差一个时区 */
function gpuTime(iso) {
  if (!iso) return '—';
  const s = String(iso).replace(' ', 'T');
  const n = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z';
  const d = new Date(n);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function gpuPrice(kind, r) {
  if (kind === 'gpu') return r.price_per_hour == null ? null : Number(r.price_per_hour);
  const s = r.extracted_price_desc;
  if (!s) return null;
  const m = String(s).match(/(\d+(?:\.\d+)?)/);   // "$0.45/hr" → 0.45
  return m ? Number(m[1]) : null;
}

function gpuLoHi(kind, list) {
  const vals = list.map(r => gpuPrice(kind, r)).filter(v => v != null && isFinite(v));
  if (new Set(vals).size < 2) return { lo: null, hi: null };
  return { lo: Math.min.apply(null, vals), hi: Math.max.apply(null, vals) };
}

function gpuPillCls(v, lh) {
  if (lh.lo == null || v == null) return 'mut';
  if (v === lh.lo) return 'lo';
  if (v === lh.hi) return 'hi';
  return 'mut';
}

function gpuField(kind, r, field) {
  if (field === 'model') return kind === 'gpu' ? r.gpu_model : r.extracted_gpu_model;
  if (field === 'platform') return kind === 'gpu' ? r.platform : r.source_platform;
  return null;
}

function gpuFiltered(kind, pack) {
  const st = GPU_STATE[kind];
  const src = (kind === 'gpu' ? pack.listings : pack.leads) || [];
  const q = st.q.trim().toLowerCase();
  return src.filter(r => {
    if (st.model !== 'all') {
      const v = String(gpuField(kind, r, 'model') || '').toLowerCase();
      if (v.indexOf(st.model.toLowerCase()) < 0) return false;
    }
    if (st.platform !== 'all' && gpuField(kind, r, 'platform') !== st.platform) return false;
    if (kind === 'gpu' && st.maxPrice !== '' && st.maxPrice != null
        && Number(r.price_per_hour) > Number(st.maxPrice)) return false;
    if (q) {
      const hay = [r.platform, r.gpu_model, r.location, r.source_platform, r.poster_name,
        r.extracted_gpu_model, r.post_text, r.contact_info]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

/* ---------------- 卡片 ---------------- */
function gpuCards(kind, pack) {
  const el = $(kind === 'gpu' ? 'gpuCards' : 'gsCards');
  if (!el) return;
  const listings = pack.listings || [];
  const leads = pack.leads || [];

  if (kind === 'gpu') {
    const avail = listings.filter(r => (r.available_stock || 0) > 0);
    const low = avail.length
      ? avail.reduce((a, b) => (Number(a.price_per_hour) <= Number(b.price_per_hour) ? a : b))
      : null;
    const pfs = pack.platforms || [];
    el.innerHTML = `
      <div class="card"><h3>监控节点</h3>
        <div class="big">${listings.length}</div>
        <div class="sm">${pfs.length} 家云平台 · 标准 API</div></div>
      <div class="card"><h3>最低单价</h3>
        <div class="big" style="color:var(--lo)">${low ? '$' + Number(low.price_per_hour).toFixed(2) + '/h' : '—'}</div>
        <div class="sm">${esc(low ? low.gpu_model : '暂无可用资源')}</div></div>
      <div class="card"><h3>社媒线索</h3>
        <div class="big" style="color:var(--acc2)">${leads.length}</div>
        <div class="sm">个人 / 小机房闲置供给</div></div>
      <div class="card"><h3>覆盖平台</h3>
        <div class="big">${pfs.length}</div>
        <div class="sm" title="${esc(pfs.join(' · '))}">${esc(pfs.join(' · ') || '—')}</div></div>`;
    return;
  }

  const srcs = pack.social_platforms || [];
  const withContact = leads.filter(r => r.contact_info).length;
  const vals = leads.map(r => gpuPrice('gpsocial', r)).filter(v => v != null && isFinite(v));
  const low = vals.length ? Math.min.apply(null, vals) : null;
  el.innerHTML = `
    <div class="card"><h3>线索总数</h3>
      <div class="big">${leads.length}</div>
      <div class="sm">已判定为出租意图的帖子</div></div>
    <div class="card"><h3>最低报价</h3>
      <div class="big" style="color:var(--lo)">${low == null ? '—' : '$' + low.toFixed(2) + '/h'}</div>
      <div class="sm">${esc(pack.latest_lead_at ? '最近一条 ' + gpuTime(pack.latest_lead_at) : '—')}</div></div>
    <div class="card"><h3>来源渠道</h3>
      <div class="big">${srcs.length}</div>
      <div class="sm" title="${esc(srcs.join(' · '))}">${esc(srcs.join(' · ') || '—')}</div></div>
    <div class="card"><h3>联系方式</h3>
      <div class="big" style="color:var(--acc2)">${withContact}/${leads.length}</div>
      <div class="sm">可直接触达的线索占比</div></div>`;
}

/* ---------------- 表格 ---------------- */
function gpuRowHtml(kind, r, lh, idx) {
  if (kind === 'gpu') {
    const v = gpuPrice('gpu', r);
    const stock = (r.available_stock || 0) > 0
      ? `<span class="pill n">✓ ${r.available_stock}</span>`
      : '<span class="pill hi">已租完</span>';
    return `<tr>
      <td class="l"><span class="dotst" style="background:${gpuColor(GPU_PLATFORM_COLORS, r.platform)}"></span><span class="mname">${esc(r.platform)}</span></td>
      <td class="l"><span class="mono">${esc(r.gpu_count)}x ${esc(r.gpu_model)}</span><br><span class="mven">${esc(r.vram_gb || '?')}GB VRAM</span></td>
      <td><span class="pill price ${gpuPillCls(v, lh)}">$${Number(r.price_per_hour).toFixed(2)}/h</span></td>
      <td class="l"><span class="mono">${esc(r.location || '—')}</span></td>
      <td>${stock}</td>
      <td class="l"><a class="link-btn" href="${esc(r.direct_url)}" target="_blank" rel="noreferrer noopener">前往租赁 ↗</a></td>
    </tr>`;
  }
  const v = gpuPrice('gpsocial', r);
  const priceTxt = r.extracted_price_desc || '价格面议';
  const priceCls = r.extracted_price_desc ? gpuPillCls(v, lh) : 'mut';
  // 悬停浮层内容：渠道 + 发布者 + 全文
  const tip = `${r.source_platform} · ${r.poster_name || '—'}\n\n${r.post_text || ''}`;
  // 社媒线索一律走站内详情弹窗：mock 数据的「真实 URL」帖子 ID 也是编造的，点了照样 404。
  const act = `<button class="link-btn social" data-post-idx="${idx}" data-tip="${esc(tip)}">查看详情 ↗</button>`;
  return `<tr>
    <td class="l"><span class="dotst" style="background:${gpuColor(GPU_SOCIAL_COLORS, r.source_platform)}"></span><span class="mname">${esc(r.source_platform)}</span><br><span class="mven">${esc(r.poster_name || '—')}</span></td>
    <td class="l"><span class="mono">${esc(r.extracted_gpu_count == null ? '?' : r.extracted_gpu_count)}x ${esc(r.extracted_gpu_model || '未知型号')}</span><br><span class="pill price ${priceCls}" style="margin-top:4px">${esc(priceTxt)}</span></td>
    <td class="l"><div class="post-text" data-tip="${esc(tip)}">${esc(r.post_text)}</div></td>
    <td class="l"><span class="contact${r.contact_info ? '' : ' empty'}">${esc(r.contact_info || '—')}</span></td>
    <td class="l">${act}</td>
  </tr>`;
}

function gpuRender(kind) {
  const pack = gpuPack();
  const tableEl = $(kind === 'gpu' ? 'gpuTable' : 'gsTable');
  const countEl = $(kind === 'gpu' ? 'gpuCount' : 'gsCount');
  if (!tableEl) return;

  if (!pack) {
    if (countEl) countEl.textContent = '';
    tableEl.innerHTML = '<div class="empty">尚未接入 GPU 数据。在项目根目录运行 '
      + '<span class="mono">python3 scripts/collect_gpu.py</span> 后重新构建站点。</div>';
    return;
  }

  gpuCards(kind, pack);
  const provEl = $(kind === 'gpu' ? 'gpuProv' : 'gsProv');
  if (provEl) {
    provEl.textContent = kind === 'gpu'
      ? (pack.platforms || []).length
      : (pack.social_platforms || []).length;
  }
  const list = gpuFiltered(kind, pack);
  const lh = gpuLoHi(kind, list);
  const total = ((kind === 'gpu' ? pack.listings : pack.leads) || []).length;
  const st = GPU_STATE[kind];
  const searching = st.q.trim() || st.model !== 'all' || st.platform !== 'all'
    || (kind === 'gpu' && st.maxPrice !== '');
  if (countEl) {
    countEl.textContent = searching ? `${list.length} / ${total} 条` : `共 ${total} 条`;
  }

  if (!list.length) {
    tableEl.innerHTML = '<div class="empty">'
      + (searching ? '没有匹配的结果，试试放宽搜索或筛选条件' : '暂无数据')
      + '</div>';
    return;
  }

  const head = kind === 'gpu'
    ? '<th class="l">来源平台</th><th class="l">GPU 规格</th><th>算力单价</th><th class="l">地理位置</th><th>库存</th><th class="l">操作</th>'
    : '<th class="l">来源 / 发布者</th><th class="l">提取摘要</th><th class="l">原始帖子</th><th class="l">联系方式</th><th class="l">操作</th>';

  tableEl.innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>'
    + list.map((r, i) => gpuRowHtml(kind, r, lh, i)).join('')
    + '</tbody></table>';

  if (kind === 'gpsocial') {
    GPU_LAST.gpsocial = list;
    gpuBindTips(tableEl);
    tableEl.querySelectorAll('[data-post-idx]').forEach(btn => {
      btn.onclick = () => gpuModalOpen(GPU_LAST.gpsocial[Number(btn.dataset.postIdx)]);
    });
  }
}

/* ---------------- 筛选控件 ---------------- */
function gpuFillOptions(kind, pack) {
  const pSel = $(kind === 'gpu' ? 'gpuPlatform' : 'gsPlatform');
  const mSel = $(kind === 'gpu' ? 'gpuModel' : 'gsModel');
  const src = (kind === 'gpu' ? pack.listings : pack.leads) || [];

  if (mSel && mSel.dataset.filled !== '1') {
    const models = Array.from(new Set(src.map(r => gpuField(kind, r, 'model')).filter(Boolean))).sort();
    mSel.innerHTML = '<option value="all">全部型号</option>'
      + models.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    mSel.dataset.filled = '1';
  }

  if (pSel && pSel.dataset.filled !== '1') {
    const names = kind === 'gpu' ? (pack.platforms || []) : (pack.social_platforms || []);
    pSel.innerHTML = '<option value="all">全部平台</option>'
      + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    pSel.dataset.filled = '1';
  }
}

function gpuBind(kind) {
  const ids = kind === 'gpu'
    ? { q: 'gpuQ', model: 'gpuModel', platform: 'gpuPlatform', max: 'gpuMax' }
    : { q: 'gsQ', model: 'gsModel', platform: 'gsPlatform', max: null };
  const st = GPU_STATE[kind];
  const qEl = $(ids.q), mEl = $(ids.model), pEl = $(ids.platform), xEl = ids.max ? $(ids.max) : null;
  if (qEl) qEl.oninput = e => { st.q = e.target.value; gpuRender(kind); };
  if (mEl) mEl.onchange = e => { st.model = e.target.value; gpuRender(kind); };
  if (pEl) pEl.onchange = e => { st.platform = e.target.value; gpuRender(kind); };
  if (xEl) xEl.oninput = e => { st.maxPrice = e.target.value; gpuRender(kind); };
}

/* 进入栏目时调用：首次绑定 + 每次渲染 */
function renderGpu() {
  const pack = gpuPack();
  if (pack) gpuFillOptions('gpu', pack);
  gpuBind('gpu');
  gpuRender('gpu');
}

function renderGpuSocial() {
  const pack = gpuPack();
  if (pack) gpuFillOptions('gpsocial', pack);
  gpuBind('gpsocial');
  gpuRender('gpsocial');
}

/* 暴露给测试与浏览器控制台 */
if (typeof window !== 'undefined') {
  window.__GPU = { GPU_STATE, gpuPack, gpuFiltered, gpuLoHi, gpuPrice, renderGpu, renderGpuSocial };
}
