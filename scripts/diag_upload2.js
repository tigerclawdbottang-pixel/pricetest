/* 复现页面上传流程：unzip → parseXlsx → 逐行 guessModel，看实际识别情况 */
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const P = require(path.join(ROOT, 'web/parsers.js'));
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data.json'), 'utf8'));

(async () => {
  const buf = fs.readFileSync('/tmp/aihub.xlsx');
  const files = await P.unzip(buf);
  console.log('zip 条目数:', Object.keys(files).length);
  const rows = P.parseXlsx(files);
  console.log('parseXlsx 总行数:', rows.length);

  // 逐行识别
  let modelRows = [], noModel = [];
  for (const r of rows) {
    let model = null;
    for (const c of r) { if (!model) model = P.guessModel(c, D.models); if (model) break; }
    (model ? modelRows : noModel).push(r);
  }
  console.log('有模型名行:', modelRows.length, ' 无模型名行:', noModel.length);

  // 去重（页面逻辑）
  const seen = new Set(); const dedup = [];
  for (const r of modelRows) {
    let m = null; for (const c of r) { if (!m) m = P.guessModel(c, D.models); if (m) break; }
    if (seen.has(m.loose)) continue;
    seen.add(m.loose); dedup.push(m);
  }
  console.log('去重后（页面实际显示条数）:', dedup.length);

  console.log('\n=== 前 8 行原始内容（看表头/数据行）===');
  rows.slice(0, 8).forEach((r, i) =>
    console.log(`  [${i}] ${JSON.stringify(r.slice(0, 7)).slice(0, 150)}`));

  console.log('\n=== 被去重丢弃的（同一站内模型被多次匹配）===');
  const cnt = {};
  for (const r of modelRows) {
    let m = null; for (const c of r) { if (!m) m = P.guessModel(c, D.models); if (m) break; }
    cnt[m.loose] = (cnt[m.loose] || 0) + 1;
  }
  Object.entries(cnt).filter(([, n]) => n > 1).slice(0, 15)
    .forEach(([k, n]) => console.log(`  ${k.padEnd(34)} x${n}`));

  console.log('\n=== 无模型名的行（前 12，看是什么）===');
  noModel.slice(0, 12).forEach(r =>
    console.log('  ' + JSON.stringify(r.slice(0, 6)).slice(0, 130)));
})().catch(e => { console.log('ERR', e.stack); process.exit(1); });
