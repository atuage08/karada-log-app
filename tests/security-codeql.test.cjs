'use strict';
// 実際のブラウザ保存領域を使わず、架空データで画面処理を実行します。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const K = require('../core.js'), A = require('../analysis.js');
const root = path.join(__dirname, '..');
function harness(records = [], appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8'), options = {}) {
  const elements = new Map(), writes = [], metadata = new Map(Object.entries(options.metadata || {})), confirmations = [], answers = [], events = {};
  const node = (tagName = '', namespaceURI = '') => ({
    tagName, namespaceURI, attributes: {}, children: [], value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', listeners: {},
    setAttribute(key, value) { this.attributes[key] = String(value); }, removeAttribute(key) { delete this.attributes[key]; },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; this.innerHTML = ''; },
    addEventListener(type, fn) { this.listeners[type] = fn; }, querySelector() { return null; }, checkValidity() { return true; },
    click() {}, remove() {},
    showModal() { confirmations.push({ title: elements.get('confirm-title').textContent, text: elements.get('confirm-description').textContent, cancel: elements.get('confirm-cancel').textContent }); this.returnValue = answers.shift() === false ? 'cancel' : 'accept'; this.listeners.close(); }
  });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) elements.set(m[1], node());
  const controls = {};
  const formHTML = html.slice(html.indexOf('<form id="record-form"'), html.indexOf('</form>'));
  for (const m of formHTML.matchAll(/\bname="([^"]+)"/g)) controls[m[1]] = node();
  const form = elements.get('record-form'); form.elements = controls;
  form.reset = () => Object.values(controls).forEach(el => { el.value = ''; });
  elements.set('record-date', controls.date);
  elements.get('chart-metric').value = 'weight'; elements.get('chart-period').value = '30';
  let stored = K.backup(records);
  const context = {
    console, location: { hash: '#history' }, setTimeout: () => 0, clearTimeout() {}, addEventListener(type, fn) { events[type] = fn; },
    Date: options.now == null ? Date : class extends Date { constructor(...args) { super(...(args.length ? args : [options.now])); } static now() { return options.now; } },
    Blob, URL: { createObjectURL() { if (options.downloadFailure) throw Error('download failed'); return 'blob:test'; }, revokeObjectURL() {} },
    FormData: class { constructor(f) { this.form = f; } *[Symbol.iterator]() { for (const [key, el] of Object.entries(this.form.elements)) if (!el.disabled) yield [key, el.value]; } },
    document: { body: node(), createElement: () => node(), getElementById: id => elements.get(id), querySelectorAll: () => [], addEventListener(type, fn) { events['document:' + type] = fn; }, createElementNS: (ns, tag) => node(tag, ns) },
    localStorage: { getItem: key => key === K.STORAGE_KEY ? stored : metadata.get(key) ?? null, setItem(key, value) { if (key === K.STORAGE_KEY) { stored = value; writes.push(value); } else { if (options.metadataFailure) throw Error('quota'); metadata.set(key, value); } } }
  };
  context.window = context; vm.createContext(context);
  for (const file of ['core.js', 'analysis.js', 'analysis-ui.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInContext(appSource, context);
  return { elements, controls, form, writes, metadata, confirmations, answers, events, formatSleep: context.KaradaAnalysisUI.formatSleep, getStored: () => stored };
}
async function runTests() {
  const passed = [], test = async (name, fn) => { await fn(); passed.push(name); };
  const date = K.today(), previous = K.shiftDate(date, -1);
  const rows = [K.validateRecord({ date: previous, weight: 64, bodyFat: 19, waist: 74 }), K.validateRecord({ date, weight: 66, bodyFat: 21, waist: 76 })];
  await test('3種類のグラフをSVG名前空間のDOMで生成し、座標・ラベル・補助線を維持', () => {
    const h = harness(rows), get = id => h.elements.get(id);
    for (const [key, label, unit] of [['weight', '体重', 'kg'], ['bodyFat', '体脂肪率', '%'], ['waist', 'ウエスト', 'cm']]) {
      get('chart-metric').value = key; get('chart-metric').listeners.change();
      const svg = get('chart-container').children[0];
      assert.equal(svg.tagName, 'svg'); assert.equal(svg.attributes.viewBox, '0 0 760 295');
      assert.equal(svg.attributes['aria-labelledby'], 'chart-title chart-description');
      const walk = el => [el, ...el.children.flatMap(walk)];
      const all = walk(svg); assert.ok(all.every(el => el.namespaceURI === 'http://www.w3.org/2000/svg'));
      assert.equal(svg.children[0].textContent, label + 'の推移');
      assert.equal(all.filter(el => el.tagName === 'line').length, 5);
      const points = all.filter(el => el.tagName === 'circle'); assert.equal(points.length, 2);
      assert.equal(points[1].attributes.cx, '732'); assert.equal(points[1].attributes.cy, String(25 + .5 / 3 * 222));
      assert.equal(points[1].children[0].textContent, `${date}：${rows[1][key].toFixed(1)} ${unit}`);
      assert.equal(all.find(el => el.tagName === 'path').attributes.d, 'M708.90,210.00 L732.00,62.00');
      assert.equal(get('chart-container').innerHTML, ''); assert.equal(h.writes.length, 0);
    }
  });
  await test('SVG生成処理にはHTML再解析の書き込みがない', () => {
    const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const chart = source.slice(source.indexOf('function renderChart('), source.indexOf('function renderHistory('));
    assert.ok(chart.includes('createElementNS')); assert.ok(chart.includes("$('chart-container').replaceChildren(svg)"));
    assert.equal(/innerHTML\s*=\s*svg|insertAdjacentHTML|DOMParser|outerHTML/.test(chart), false);
  });
  await test('バックスラッシュ・CR・LF・縦線を1回ずつエスケープし日別行と列を保護', () => {
    const alcohol = '\\n\r\n|\\|<svg onload=alert(1)>';
    const text = A.analysisText([K.validateRecord({ date, weight: 65, alcohol })], []);
    const row = text.split('\n').find(line => line.startsWith(date + '|'));
    const encoded = '\\\\n\\r\\n\\|\\\\\\|<svg onload=alert(1)>';
    assert.ok(row.endsWith('|' + encoded + '|未入力'));
    assert.equal(row.includes('\r'), false);
    // エスケープを逆変換して、元の文字列が曖昧さなく戻ることも確認。
    const decoded = encoded.replace(/\\([\\rn|])/g, (_, ch) => ({ r: '\r', n: '\n', '\\': '\\', '|': '|' }[ch]));
    assert.equal(decoded, alcohol);
  });
  await test('画面の保存操作が従来キー・形式で保存しJSON復元後もグラフと目標履歴を維持', async () => {
    const h = harness(), get = id => h.elements.get(id);
    h.controls.date.value = date; h.controls.weight.value = '65';
    await h.form.listeners.submit({ preventDefault() {} });
    assert.equal(h.writes.length, 1); assert.equal(K.parseBackup(h.getStored()).records[0].weight, 65);
    assert.equal(JSON.parse(h.getStored()).schemaVersion, 2);
    assert.equal(get('chart-container').children[0].tagName, 'svg');
    const history = K.validateHistory([{ effectiveFrom: previous, targets: K.DEFAULT_TARGETS }]);
    const backup = K.backup(rows, history);
    get('restore-mode').value = 'replace'; get('restore-target-mode').value = 'replace';
    await get('restore-file').listeners.change({ target: { value: '', files: [{ size: backup.length, text: async () => backup }] } });
    const restored = K.parseBackup(h.getStored());
    assert.deepEqual(restored.records, rows); assert.deepEqual(restored.targetHistory, history);
    assert.equal(h.writes.length, 2); assert.equal(get('chart-container').children[0].children.filter(el => el.tagName === 'circle').length, 2);
    assert.ok(get('backup-message').textContent.includes('復元しました'));
    assert.ok(A.analysisText(restored.records, restored.targetHistory).includes('【分析依頼】'));
  });
  return passed;
}
module.exports = { runTests, harness };
if (require.main === module) runTests().then(results => { results.forEach(name => console.log('✓ ' + name)); console.log(`${results.length}件すべて成功`); }).catch(error => { console.error(error); process.exitCode = 1; });
