'use strict';
const assert = require('node:assert/strict');
const K = require('../core.js'), A = require('../analysis.js');
const sample = K.validateRecord({ date: '2026-11-03', dayType: 'ト', weight: 65, bodyFat: 20, waist: 75, protein: 155, fat: 65, carbs: 280, sleep: 8, fatigue: 2, strength: 30, cardio: 20, alcohol: 'なし', bowel: 'あり', memo: '除外確認用の架空メモ' });
function fixture(count) {
  return Array.from({ length: count }, (_, i) => K.validateRecord({ ...sample, date: K.shiftDate(sample.date, -i), dayType: ['ト', 'へき', 'きき'][i % 3], protein: i % 3 === 0 ? 155 : 145, fat: i % 3 === 0 ? 65 : 55, carbs: i % 3 === 0 ? 280 : 210, weight: 65 + i * .02 }));
}
const section = (text, start, end) => text.slice(text.indexOf(start) + start.length, end ? text.indexOf(end) : undefined);
function runTests() {
  const passed = [], test = (name, fn) => { fn(); passed.push(name); };
  for (const [count, limit] of [[1, 4000], [14, 7000], [70, 12000]]) test(`${count}件の文字数目安と必須セクション`, () => {
    const text = A.analysisText(fixture(count), []); assert.ok(text.length <= limit, `${text.length} > ${limit}`);
    for (const heading of ['【直近7暦日の日別詳細】', '【7・14・28日比較】', '【完了8週間と進行中の週】', '【PFC目標履歴・適用期間】', '【期間内PFC達成状況】', '【分析依頼】']) assert.equal(text.split(heading).length - 1, 1);
  });
  test('未記録6日を含む日別7暦日を保持', () => {
    const daily = section(A.analysisText([sample], []), '【直近7暦日の日別詳細】', '【7・14・28日比較】');
    assert.equal(daily.split('\n').filter(line => /^\d{4}-\d{2}-\d{2}\|/.test(line)).length, 7);
    assert.equal((daily.match(/未記録/g) || []).length, 6); assert.ok(daily.includes('2026-11-03|2026-11-02|ト|65|20|75|155|65|280|2325|30|20|8|2|なし|あり'));
  });
  test('空の完了8週は日付と状態だけの1行', () => {
    const text = A.analysisText([sample], []), weeks = section(text, '【完了8週間と進行中の週】', '【PFC目標履歴・適用期間】');
    const empty = weeks.split('\n').filter(line => line.includes('全項目未記録・PFC判定なし'));
    assert.equal(empty.length, 8); assert.equal(empty[0], '2026-09-07〜2026-09-13：全項目未記録・PFC判定なし');
    assert.equal(empty[7], '2026-10-26〜2026-11-01：全項目未記録・PFC判定なし');
  });
  test('前期間全空は比較不可を一括表示し、記録率は残す', () => {
    const text = A.analysisText([sample], []);
    for (const n of [7, 14, 28]) { assert.ok(text.includes(`前期間は全数値項目データなし（各0/${n}日）。差は全項目比較不可。`)); assert.ok(text.includes(`Pg|155|1/${n}日・記録不足・参考値`)); }
    assert.ok(text.includes('P100%(1/1日)')); assert.ok(text.includes('100%(1/1日)でも記録充足1/7日は参考値'));
  });
  test('比較できる項目は平均・差・両方の有効日数を保持', () => {
    const rows = [sample, K.validateRecord({ date: '2026-10-27', weight: 67 })];
    const text = A.analysisText(rows, []);
    assert.ok(text.includes('体重kg|65/67|-2|1/7日・記録不足・参考値／1/7日・記録不足・参考値'));
    assert.ok(text.includes('前週比')); assert.ok(text.includes('比較不可'));
  });
  test('PFC個別・総合の異なる分母と不足超過量を保持', () => {
    const partial = K.validateRecord({ date: '2026-11-02', dayType: 'ト', protein: 140, fat: 75 });
    const text = A.analysisText([sample, partial], []);
    assert.ok(text.includes('P50%(1/2日) 不足1日/平均10g 超過0日'));
    assert.ok(text.includes('F50%(1/2日) 不足0日 超過1日/平均5g'));
    assert.ok(text.includes('C100%(1/1日)')); assert.ok(text.includes('総合100%(1/1日)'));
    assert.ok(text.includes('PFC判定なし（P/F/C/総合すべて0/0日）：へき・きき'));
  });
  test('数値は丸めず、達成率の小数も計算結果どおり', () => {
    const rows = [120, 130, 155].map((protein, i) => K.validateRecord({ date: `2026-11-0${i + 1}`, dayType: 'ト', weight: 65.1234567, protein }));
    const text = A.analysisText(rows, []);
    assert.ok(text.includes('65.1234567')); assert.ok(text.includes(`P${String(1 / 3 * 100)}%(1/3日)`));
  });
  test('数値が未入力でも記録のある週を全項目未記録としない', () => {
    const r = K.validateRecord({ date: '2026-11-03', alcohol: '架空の飲酒記録' }, { preserveUnknownExercise: true });
    const text = A.analysisText([r], []);
    assert.equal(text.includes('2026-11-02〜2026-11-08：全項目未記録'), false); assert.ok(text.includes('今週・途中経過')); assert.ok(text.includes('架空の飲酒記録'));
  });
  test('月曜朝の運動を含む前週は空の週にしない', () => {
    const r = K.validateRecord({ date: '2026-11-02', strength: 30, weight: 65 }); const text = A.analysisText([r], []);
    assert.ok(text.includes('2026-10-26〜2026-11-01 完了週')); assert.ok(text.includes('筋トレ：実施1日/計30分'));
    assert.ok(text.includes('食事・活動は2026-11-01まで')); assert.ok(text.includes('0/0日'));
  });
  test('年末年始・うるう年の日別対象日を保持', () => {
    for (const [date, previous] of [['2027-01-01', '2026-12-31'], ['2024-03-01', '2024-02-29']]) {
      const text = A.analysisText([K.validateRecord({ date, weight: 65 })], []); assert.ok(text.includes(`${date}|${previous}|`));
    }
  });
  test('全目標履歴を適用期間とともに1か所だけ表示', () => {
    const first = JSON.parse(JSON.stringify(K.DEFAULT_TARGETS)), second = JSON.parse(JSON.stringify(first)); first['ト'].protein = { min: 100, max: 110 }; second['ト'].protein = { min: 105, max: 115 };
    const history = K.validateHistory([{ effectiveFrom: '2026-11-01', targets: first }, { effectiveFrom: '2026-11-02', targets: second }]);
    const text = A.analysisText([sample], history), goals = section(text, '【PFC目標履歴・適用期間】', '【期間内PFC達成状況】');
    assert.ok(goals.includes('初期（〜2026-10-31')); assert.ok(goals.includes('2026-11-01〜2026-11-01')); assert.ok(goals.includes('2026-11-02〜以後'));
    for (const value of ['P100〜110g', 'P105〜115g']) assert.equal(text.split(value).length - 1, 1);
  });
  test('自由メモと旧食事時刻は出力せず文字列の改行を保護', () => {
    const r = { ...sample, breakfast: '07:07', lunch: '12:34', dinner: '21:43', alcohol: 'なし\n架空|テスト' };
    const text = A.analysisText([r], []);
    for (const value of [sample.memo, 'breakfast', '07:07', '12:34', '21:43']) assert.equal(text.includes(value), false);
    assert.ok(text.includes('なし\\n架空\\|テスト'));
  });
  test('0件コピー不可と入力データ非変更を維持', () => {
    assert.equal(A.analysisText([], []), null); const rows = Object.freeze([Object.freeze({ ...sample })]); const before = JSON.stringify(rows); A.analysisText(rows, []); assert.equal(JSON.stringify(rows), before);
  });
  return passed;
}
module.exports = { runTests, fixture };
if (require.main === module) { const results = runTests(); results.forEach(name => console.log('✓ ' + name)); console.log(`${results.length}件すべて成功`); }
