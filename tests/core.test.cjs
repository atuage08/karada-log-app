'use strict';
const assert = require('node:assert/strict');
const K = require('../core.js');
function runTests() {
  const passed = [], test = (name, fn) => { fn(); passed.push(name); };
  const r = (date = '2026-11-02', values = {}) => K.validateRecord({ date, weight: 65, ...values });
  test('閏年・不正日付・年末', () => { assert.ok(K.validDate('2024-02-29')); assert.equal(K.validDate('2025-02-29'), false); assert.equal(K.shiftDate('2027-01-01', -1), '2026-12-31'); });
  test('日付だけの記録を運動0の補完前に拒否', () => assert.throws(() => K.validateRecord({ date: '2026-11-02', strength: '', cardio: null })));
  test('筋トレ・有酸素の空欄は0', () => { assert.equal(r().strength, 0); assert.equal(r().cardio, 0); });
  test('運動に0以上の整数のみ許可', () => { for (const field of ['strength', 'cardio']) { for (const value of [-1, 0.5, '20', NaN, Infinity]) assert.throws(() => r(undefined, { [field]: value })); assert.equal(r(undefined, { [field]: 0 })[field], 0); assert.equal(r(undefined, { [field]: 30 })[field], 30); } });
  test('PFCカロリー・未入力・ゼロ', () => { assert.equal(K.calories(r(undefined, { protein: 100, fat: 50, carbs: 200 })), 1650); assert.equal(K.calories(r()), null); assert.equal(K.calories(r(undefined, { protein: 0, fat: 0, carbs: 0 })), 0); });
  test('平均は空欄を除外し0を含む', () => { assert.deepEqual(K.mean([{ sleep: 0 }, { sleep: 8 }, { sleep: null }], 'sleep'), { value: 4, count: 2 }); assert.deepEqual(K.mean([], 'weight'), { value: null, count: 0 }); });
  test('11月1日と1月1日の前日対応・日種別', () => { for (const [date, prior] of [['2026-11-01', '2026-10-31'], ['2027-01-01', '2026-12-31']]) for (const field of ['dayType', 'protein', 'strength', 'cardio', 'alcohol', 'bowel']) assert.equal(K.targetDate(r(date), field), prior); });
  test('身体・睡眠・疲労度は当日', () => { for (const field of ['weight', 'bodyFat', 'waist', 'sleep', 'fatigue']) assert.equal(K.targetDate(r(), field), '2026-11-02'); });
  test('月別集計は食事対象日', () => { assert.equal(K.monthRange([r('2026-11-01')], '2026-10', 'protein').length, 1); assert.equal(K.monthRange([r('2026-11-01')], '2026-11', 'protein').length, 0); });
  test('食事時刻は新入力・JSON・CSVに存在しない', () => { assert.throws(() => r(undefined, { breakfast: '07:00' })); for (const key of ['breakfast', 'lunch', 'dinner']) { assert.equal(K.fields.includes(key), false); assert.equal(K.backup([r()]).includes(key), false); } assert.equal(K.csv([r()]).includes('朝食'), false); });
  test('旧JSONは時刻を破棄し有酸素を推測せず保管', () => { const old = { ...r(), breakfast: '07:00', lunch: '12:00', dinner: '19:00', cardio: '散歩 20分', memo: '元のメモ' }; const parsed = K.parseBackup(JSON.stringify({ schemaVersion: 1, records: [old] })); assert.equal(parsed.records[0].cardio, null); assert.equal(parsed.records[0].weight, 65); assert.ok(parsed.records[0].memo.includes('散歩 20分')); assert.ok(parsed.warnings.length); assert.equal('breakfast' in parsed.records[0], false); });
  test('旧空欄運動も勝手に0にしない', () => { const parsed = K.parseBackup(JSON.stringify({ schemaVersion: 1, records: [{ date: '2026-11-02', weight: 65, strength: null, cardio: '' }] })); assert.equal(parsed.records[0].strength, null); assert.equal(parsed.records[0].cardio, null); });
  test('不正JSON・形式・重複日付・不正な1件を含む全体を拒否', () => { for (const text of ['{broken', '{"schemaVersion":3,"records":[]}', K.backup([r(), r()]), K.backup([r(), { date: '2026-11-03', weight: -3 }])]) assert.throws(() => K.parseBackup(text)); });
  test('初期PFC目標の値', () => { assert.deepEqual(K.DEFAULT_TARGETS['ト'].protein, { min: 150, max: 160 }); assert.deepEqual(K.DEFAULT_TARGETS['へき'].carbs, { min: 200, max: 220 }); assert.deepEqual(K.DEFAULT_TARGETS['へき'], K.DEFAULT_TARGETS['きき']); });
  test('目標の下限超過・欠落・重複開始日を拒否', () => { const bad = JSON.parse(JSON.stringify(K.DEFAULT_TARGETS)); bad['ト'].protein = { min: 200, max: 150 }; assert.throws(() => K.validateTargets(bad)); assert.throws(() => K.validateHistory([{ effectiveFrom: '2026-11-01', targets: K.DEFAULT_TARGETS }, { effectiveFrom: '2026-11-01', targets: K.DEFAULT_TARGETS }])); assert.throws(() => K.parseBackup('{"schemaVersion":2,"records":[],"targetHistory":[{}]}')); });
  test('変更履歴のない過去には初期目標', () => { const changed = JSON.parse(JSON.stringify(K.DEFAULT_TARGETS)); changed['ト'].protein = { min: 100, max: 110 }; const history = K.validateHistory([{ effectiveFrom: '2026-11-01', targets: changed }]); assert.equal(K.targetsAt(history, '2026-10-31')['ト'].protein.min, 150); assert.equal(K.targetsAt(history, '2026-11-01')['ト'].protein.min, 100); });
  test('新JSONの記録と目標履歴が往復一致', () => { const records = [r(undefined, { dayType: 'ト', cardio: 25, alcohol: 'なし', memo: '架空メモ' })]; const history = K.validateHistory([{ effectiveFrom: '2026-11-01', targets: K.DEFAULT_TARGETS }]); const parsed = K.parseBackup(K.backup(records, history)); assert.deepEqual(parsed.records, records); assert.deepEqual(parsed.targetHistory, history); assert.equal(parsed.sourceVersion, 2); });
  test('CSVのBOM・引用符・数式対策・運動分数', () => { const csv = K.csv([r(undefined, { cardio: 20, memo: '=1+1', alcohol: '架空,"飲料"\nなし' })]); assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(csv.includes('有酸素運動(分)')); assert.ok(csv.includes('"\'=1+1"')); assert.ok(csv.includes('"架空,""飲料""\nなし"')); });
  test('保存キーは従来どおり、版は2', () => { assert.equal(K.STORAGE_KEY, 'karada-log.records.v1'); assert.equal(K.SCHEMA_VERSION, 2); });
  test('編集・マージは他の日と元配列を変更しない', () => { const current = [r(), r('2026-11-03')]; const next = K.mergeRecords(current, [r(undefined, { weight: 66 })]); assert.equal(next[0].weight, 66); assert.equal(current[0].weight, 65); assert.equal(next[1].date, '2026-11-03'); });
  return passed;
}
module.exports = { runTests };
if (require.main === module) { const results = runTests(); results.forEach(name => console.log('✓ ' + name)); console.log(`${results.length}件すべて成功`); }
