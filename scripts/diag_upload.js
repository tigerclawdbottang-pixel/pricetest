/* 诊断：对上传文件里的模型名跑 guessModel，统计识别率与失败原因 */
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
const P = require(path.join(ROOT, 'web/parsers.js'));
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data.json'), 'utf8'));
const names = JSON.parse(fs.readFileSync('/tmp/aihub_names.json', 'utf8'));

const ok = [], miss = [];
for (const [n, series] of names) {
  const m = P.guessModel(n, D.models);
  (m ? ok : miss).push([n, m ? m.loose : '']);
}
console.log(`总模型 ${names.length}  识别 ${ok.length}  未识别 ${miss.length}`);
console.log(`识别率 ${(ok.length / names.length * 100).toFixed(1)}%`);
console.log('\n=== 未识别清单 ===');
for (const [n] of miss) console.log('  ✗ ' + n);
console.log('\n=== 已识别（看是否匹配正确）===');
for (const [n, l] of ok) {
  const t = D.models.find(x => x.loose === l);
  console.log(`  ✓ ${n.padEnd(42)} -> ${(t ? t.name : l).slice(0, 40)}`);
}
