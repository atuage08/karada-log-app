'use strict';
// 架空の保存領域で、起動・表示・集計に保存データの書き換えがないかを確認します。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function runTests() {
  const root = path.join(__dirname, '..');
  const core = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const key = 'karada-log.records.v1';
  const oldRecord = { date: '2026-11-01', dayType: 'へき', weight: 64, bodyFat: 20, waist: 75, protein: 80, fat: 40, carbs: 150, sleep: 7, fatigue: 2, strength: 30, breakfast: '07:00', lunch: '12:00', dinner: '19:00', cardio: '架空の散歩', alcohol: 'なし', memo: '架空の旧記録', bowel: 'あり' };
  const original = JSON.stringify({ schemaVersion: 1, records: [oldRecord] }, null, 4);
  const passed = [];
  for (const raw of [original, '{invalid-json']) {
    const elements = new Map();
    const node = () => ({ value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, append() {}, replaceChildren() { this.innerHTML = ''; }, querySelector() { return null; } });
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], node());
    const controls = {};
    for (const match of html.matchAll(/\bname="([^"]+)"/g)) controls[match[1]] = node();
    const form = elements.get('record-form'); form.elements = controls;
    form.reset = () => Object.values(controls).forEach(control => { control.value = ''; });
    elements.set('record-date', controls.date);
    elements.get('chart-metric').value = 'weight'; elements.get('chart-period').value = '30';
    let writes = 0, deletes = 0;
    const context = {
      console, location: { hash: '#history' }, setTimeout: () => 0, clearTimeout() {},
      document: { createElementNS: () => node(), getElementById: id => { if (!elements.has(id)) throw Error('Missing element: ' + id); return elements.get(id); }, querySelectorAll: () => [], addEventListener() {} },
      localStorage: { getItem: storageKey => { assert.equal(storageKey, key); return raw; }, setItem() { writes++; }, removeItem() { deletes++; }, clear() { deletes++; } },
      addEventListener() {}
    };
    context.window = context;
    vm.createContext(context); vm.runInContext(core, context);
    vm.runInContext(fs.readFileSync(path.join(root, 'analysis.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'analysis-ui.js'), 'utf8'), context);
    vm.runInContext(app, context);
    assert.equal(writes, 0); assert.equal(deletes, 0);
    if (raw === original) {
      assert.ok(elements.get('history-list').innerHTML.includes('2026-10-31'));
      assert.ok(elements.get('history-list').innerHTML.includes('架空の旧記録'));
      assert.equal(elements.get('save-button').disabled, false);
      elements.get('summary-month').value = '2026-10';
      assert.equal(typeof elements.get('summary-month').listeners.change, 'function');
      elements.get('summary-month').checkValidity = () => true;
      elements.get('summary-month').listeners.change();
      assert.ok(elements.get('monthly-summary').innerHTML.includes('80.0 g'));
      assert.equal(writes, 0); assert.equal(deletes, 0);
      assert.equal(raw, original);
      passed.push('旧形式の架空localStorageを起動・表示・月別集計しても書き込み・削除0回');
    } else {
      assert.equal(elements.get('save-button').disabled, true);
      assert.equal(elements.get('restore-file').disabled, true);
      passed.push('読み取れない保存データも自動初期化・上書きしない');
    }
  }
  return passed;
}
module.exports = { runTests };
if (require.main === module) { const passed = runTests(); passed.forEach(name => console.log('✓ ' + name)); console.log(`${passed.length}件すべて成功`); }
