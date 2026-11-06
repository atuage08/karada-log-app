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
  return passed;
}
module.exports = { runTests };
if (require.main === module) runTests().then(passed => { passed.forEach(name => console.log('✓ ' + name)); console.log(`${passed.length}件すべて成功`); }).catch(error => { console.error(error); process.exitCode = 1; });
