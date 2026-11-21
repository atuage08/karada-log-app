'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const K = require('../core.js'), A = require('../analysis.js');
async function runTests() {
  const passed = [];
  for (const mode of ['success', 'failure', 'unavailable', 'empty']) {
    const nodes = new Map();
    const get = id => { if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, textContent: '', innerHTML: '', events: {}, addEventListener(type, fn) { this.events[type] = fn; } }); return nodes.get(id); };
    let copied = null;
    const records = mode === 'empty' ? [] : [K.validateRecord({ date: '2026-11-02', weight: 65, memo: 'コピー禁止の架空メモ' })];
    const context = { Karada: K, KaradaAnalysis: A, isSecureContext: true, navigator: { clipboard: mode === 'unavailable' ? undefined : { async writeText(text) { if (mode === 'failure') throw Error('denied'); copied = text; } } }, document: { getElementById: get } };
    context.window = context;
    vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../analysis-ui.js'), 'utf8'), context);
    context.KaradaAnalysisUI.init({ getState: () => ({ records, targetHistory: [], locked: false }) });
    await get('copy-analysis').events.click();
    if (mode === 'success') { assert.ok(copied.includes('2026-11-02')); assert.equal(copied.includes('コピー禁止の架空メモ'), false); assert.ok(get('copy-message').textContent.includes('コピーしました')); }
    else if (mode === 'empty') { assert.equal(copied, null); assert.equal(get('analysis-copy-text').value, ''); }
    else { assert.equal(get('copy-fallback').hidden, false); assert.ok(get('analysis-copy-text').value.includes('2026-11-02')); assert.equal(get('analysis-copy-text').value.includes('コピー禁止の架空メモ'), false); }
    passed.push('コピー：' + mode);
  }

  for (const fail of [false, true]) {
    const nodes = new Map(), get = id => { if (!nodes.has(id)) nodes.set(id, { value: '', hidden: true, textContent: '', innerHTML: '', events: {}, addEventListener(type, fn) { this.events[type] = fn; } }); return nodes.get(id); };
    let copied;
    const rows = [K.validateRecord({ date: '2026-11-03', pfcStatus: 'other', protein: 987.6, fat: 876.5, carbs: 765.4, weight: 65, memo: 'コピー禁止架空メモ' })];
    const context = { Karada: K, KaradaAnalysis: A, isSecureContext: true, navigator: { clipboard: { async writeText(text) { if (fail) throw Error('架空の失敗'); copied = text; } } }, document: { getElementById: get } }; context.window = context;
    vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname, '../analysis-ui.js'), 'utf8'), context);
    context.KaradaAnalysisUI.init({ getState: () => ({ records: rows, targetHistory: [], locked: false }) }); await get('copy-analysis').events.click();
    const text = fail ? get('analysis-copy-text').value : copied; assert.equal(text, A.analysisText(rows, [])); assert.ok(text.includes('|その他')); assert.ok(text.includes('PFC計測不可1日'));
    for (const value of ['987.6', '876.5', '765.4', 'コピー禁止架空メモ']) assert.equal(text.includes(value), false);
    if (fail) assert.equal(get('copy-fallback').hidden, false);
    passed.push('計測不可保管値を除外したコピー：' + (fail ? '手動代替' : '成功'));
  }
  return passed;
}
module.exports = { runTests };
if (require.main === module) runTests().then(passed => { passed.forEach(name => console.log('✓ ' + name)); console.log(`${passed.length}件すべて成功`); }).catch(error => { console.error(error); process.exitCode = 1; });
