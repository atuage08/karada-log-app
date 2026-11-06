'use strict';
const assert = require('node:assert/strict');
const K = require('../core.js'), A = require('../analysis.js');
const { harness } = require('./security-codeql.test.cjs');
const backupKey = 'karada-log.backup.last-json-export.v1';
const date = '2026-11-06';
function setup(records = [], options) {
  const h = harness(records, undefined, options);
  h.controls.date.value = date;
  h.save = () => h.form.listeners.submit({ preventDefault() {} });
  h.record = () => K.parseBackup(h.getStored()).records.find(r => r.date === date);
  h.edit = async () => h.events['document:click']({ target: { closest(selector) { return selector === '[data-edit]' ? { dataset: { edit: date } } : null; } } });
  return h;
}
async function runTests() {
  const passed = [], test = async (name, fn) => { await fn(); passed.push(name); };
  await test('初期アルコールなし・自動運動0だけでは空記録を保存しない', async () => {
    const h = setup(); assert.equal(h.controls.alcohol.value, 'なし'); await h.save();
    assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0);
  });
  for (const [hour, minute, total] of [['', '30', 30], ['1', '', 60], ['1', '45', 105], ['', '', 0]]) await test(`筋トレ ${hour || '空'}時間${minute || '空'}分→${total}分`, async () => {
    const h = setup(); h.controls.weight.value = '65'; h.controls.strengthHours.value = hour; h.controls.strengthMinutes.value = minute; await h.save();
    assert.equal(h.record().strength, total); assert.equal(h.record().cardio, 0);
  });
  for (const [hour, minute] of [['1', '60'], ['-1', '0'], ['1.5', '0'], ['abc', '0'], ['1', '-1'], ['1', '0.5'], ['9007199254740991', '59']]) await test(`不正な筋トレ ${hour}/${minute} を拒否`, async () => {
    const h = setup(); h.controls.weight.value = '65'; h.controls.strengthHours.value = hour; h.controls.strengthMinutes.value = minute; await h.save(); assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0);
  });
  for (const [hour, minute, total] of [['6', '25', 6 + 25 / 60], ['7', '', 7], ['24', '0', 24]]) await test(`睡眠 ${hour}時間${minute || '空'}分の保存`, async () => {
    const h = setup(); h.controls.sleepHours.value = hour; h.controls.sleepMinutes.value = minute; await h.save(); assert.equal(h.record().sleep, total);
  });
  for (const [hour, minute] of [['', '30'], ['0', '30'], ['24', '1'], ['25', '0'], ['6.5', '0'], ['6', '60'], ['6', '-1'], ['6', '1.5']]) await test(`不正な睡眠 ${hour}/${minute} を拒否`, async () => {
    const h = setup(); h.controls.weight.value = '65'; h.controls.sleepHours.value = hour; h.controls.sleepMinutes.value = minute; await h.save(); assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0);
  });
  await test('未入力一覧は10項目を独立表示し、戻る操作では保存せず入力を保持', async () => {
    const h = setup(); h.controls.memo.value = '架空メモ'; h.answers.push(false); await h.save();
    assert.equal(h.writes.length, 0); assert.equal(h.controls.memo.value, '架空メモ');
    const c = h.confirmations[0]; assert.equal(c.cancel, '入力画面に戻る');
    for (const key of ['dayType', 'weight', 'bodyFat', 'waist', 'protein', 'fat', 'carbs', 'sleep', 'fatigue', 'bowel']) assert.ok(c.text.includes('・' + K.labels[key]));
    for (const key of ['strength', 'cardio', 'alcohol', 'memo']) assert.equal(c.text.includes('・' + K.labels[key]), false);
    await h.save(); assert.equal(h.record().sleep, null); assert.equal(h.record().weight, null); assert.equal(h.record().alcohol, 'なし');
  });
  await test('全確認項目入力済みなら入力漏れ確認なし、PFC計算・コピーを維持', async () => {
    const h = setup(); Object.assign(h.controls.dayType, { value: 'ト' });
    for (const [key, value] of Object.entries({ weight: '65', bodyFat: '20', waist: '75', protein: '155', fat: '65', carbs: '280', sleepHours: '7', fatigue: '2', bowel: 'あり' })) h.controls[key].value = value;
    await h.save(); assert.equal(h.confirmations.length, 0); assert.equal(K.calories(h.record()), 2325);
    assert.ok(A.analysisText([h.record()], []).includes('|2325|')); assert.equal(h.record().sleep, 7);
  });
  await test('日付不正・ブラウザが検出した数値不正を確認画面より先に拒否', async () => {
    for (const mode of ['date', 'badInput']) { const h = setup(); h.controls.weight.value = '65'; if (mode === 'date') h.controls.date.value = '2026-02-30'; else h.controls.sleepHours.validity = { badInput: true }; await h.save(); assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0); }
  });
  await test('既存90分を1時間30分に表示し、無変更の睡眠小数と旧飲酒文章を厳密保持', async () => {
    const old = K.validateRecord({ date, weight: 65, strength: 90, sleep: 6.42, alcohol: '<img src=x onerror=alert(1)>架空ビール', memo: '旧架空メモ' });
    const h = setup([old]); const original = h.getStored(); await h.edit();
    assert.equal(h.controls.strengthHours.value, '1'); assert.equal(h.controls.strengthMinutes.value, '30');
    assert.equal(h.controls.sleepHours.value, '6'); assert.equal(h.controls.sleepMinutes.value, '25');
    assert.equal(h.controls.alcohol.disabled, true); assert.equal(h.getStored(), original); assert.equal(h.writes.length, 0);
    assert.ok(h.elements.get('legacy-alcohol-value').textContent.includes(old.alcohol));
    assert.equal(h.elements.get('legacy-alcohol-value').innerHTML, '');
    await h.save(); assert.deepEqual(h.record(), old);
  });
  await test('旧アルコールは明示チェック時だけ二択値で置換する', async () => {
    const h = setup([K.validateRecord({ date, weight: 65, alcohol: '架空ワイン' })]); await h.edit();
    h.elements.get('replace-alcohol').checked = true; h.elements.get('replace-alcohol').listeners.change(); assert.equal(h.controls.alcohol.disabled, false);
    h.controls.alcohol.value = 'あり'; await h.save(); assert.equal(h.record().alcohol, 'あり');
  });
  await test('旧空欄アルコール・未確定運動・旧1時間未満睡眠を変更しない編集で保持', async () => {
    const old = K.validateRecord({ date, weight: 65, sleep: 0.5, alcohol: '' }, { preserveUnknownExercise: true });
    const h = setup([old]); await h.edit(); await h.save(); assert.deepEqual(h.record(), old);
  });
  await test('睡眠欄を変更した時だけ分換算の新値へ変更、上書き取消時は元記録を保持', async () => {
    const old = K.validateRecord({ date, weight: 65, sleep: 6.42 }); const h = setup([old]); await h.edit(); h.controls.sleepMinutes.value = '26';
    h.answers.push(true, false); await h.save(); assert.deepEqual(h.record(), old);
    await h.save(); assert.equal(h.record().sleep, 6 + 26 / 60);
  });
  await test('新旧JSONの復元・再書き出しで保存形式2と目標履歴を維持', async () => {
    const old = { schemaVersion: 1, records: [{ date, weight: 65, sleep: 6.42, strength: 90, alcohol: '架空飲酒', cardio: '旧散歩', breakfast: '07:00' }] };
    const history = K.validateHistory([{ effectiveFrom: date, targets: K.DEFAULT_TARGETS }]);
    const migrated = K.parseBackup(JSON.stringify(old)); const backup = K.backup(migrated.records, history);
    const h = setup(); h.elements.get('restore-mode').value = 'replace'; h.elements.get('restore-target-mode').value = 'keep';
    const oldText = JSON.stringify(old);
    await h.elements.get('restore-file').listeners.change({ target: { files: [{ size: oldText.length, text: async () => oldText }], value: '' } });
    assert.deepEqual(K.parseBackup(h.getStored()).records, migrated.records);
    h.elements.get('restore-target-mode').value = 'replace';
    await h.elements.get('restore-file').listeners.change({ target: { files: [{ size: backup.length, text: async () => backup }], value: '' } });
    const restored = K.parseBackup(h.getStored()); assert.deepEqual(restored.records, migrated.records); assert.deepEqual(restored.targetHistory, history); assert.equal(JSON.parse(h.getStored()).schemaVersion, 2);
    assert.equal(h.metadata.size, 0); // 復元をバックアップ書き出しと誤認しない。
  });
  const now = Date.parse('2026-11-06T12:00:00Z');
  for (const [name, stamp, visible] of [['不明', null, true], ['7日直前', now - 7 * 86400000 + 1, false], ['7日ちょうど', now - 7 * 86400000, true], ['8日', now - 8 * 86400000, true], ['未来', now + 1, true], ['破損', 'invalid', true], ['曖昧な日時文字列', '1', true]]) await test(`バックアップ通知 ${name}`, () => {
    const metadata = stamp == null ? {} : { [backupKey]: typeof stamp === 'number' ? new Date(stamp).toISOString() : stamp };
    const h = setup([], { now, metadata }); assert.equal(h.elements.get('backup-reminder').hidden, !visible); assert.equal(h.writes.length, 0); assert.deepEqual(Object.fromEntries(h.metadata), metadata);
  });
  await test('JSON書き出し操作だけが通知日時を保存し、実ファイル保管完了とは表示しない', () => {
    const h = setup([], { now }); const before = h.getStored(); h.elements.get('export-json').listeners.click();
    assert.equal(h.metadata.get(backupKey), new Date(now).toISOString()); assert.equal(h.getStored(), before); assert.equal(h.elements.get('backup-reminder').hidden, true);
    assert.ok(h.elements.get('backup-message').textContent.includes('確認してください'));
    h.metadata.clear(); h.elements.get('export-csv').listeners.click(); assert.equal(h.metadata.size, 0);
  });
  await test('書き出し開始失敗では通知日時を更新せず、日時保存失敗も記録を変更しない', () => {
    for (const options of [{ now, downloadFailure: true }, { now, metadataFailure: true }]) { const h = setup([], options); const original = h.getStored(); h.elements.get('export-json').listeners.click(); assert.equal(h.metadata.size, 0); assert.equal(h.getStored(), original); assert.equal(h.elements.get('backup-reminder').hidden, false); }
  });
  await test('ありだけの新規入力は明示入力として確認後保存し、自由記述の新規飲酒値は拒否', async () => {
    const h = setup(); h.controls.alcohol.value = 'あり'; await h.save(); assert.equal(h.record().alcohol, 'あり');
    const invalid = setup(); invalid.controls.weight.value = '65'; invalid.controls.alcohol.value = '新しい自由記述'; await invalid.save(); assert.equal(invalid.writes.length, 0);
  });
  await test('0gは未入力一覧に含めず、不正な既存数値項目も確認前に拒否', async () => {
    const h = setup(); h.controls.protein.value = '0'; await h.save(); assert.equal(h.confirmations[0].text.includes('・' + K.labels.protein), false); assert.equal(h.record().protein, 0);
    const invalid = setup(); invalid.controls.weight.value = '-1'; await invalid.save(); assert.equal(invalid.writes.length, 0); assert.equal(invalid.confirmations.length, 0);
  });
  for (const sleep of [0, 0.5, 0.999]) await test(`旧睡眠${sleep}時間を明示操作で未記録へ変更`, async () => {
    const h = setup([K.validateRecord({ date, weight: 65, sleep })]); await h.edit();
    assert.equal(h.elements.get('legacy-sleep-choice').hidden, false);
    h.elements.get('clear-legacy-sleep').checked = true; await h.save();
    assert.equal(h.record().sleep, null);
    assert.ok(h.confirmations[0].text.includes('・' + K.labels.sleep));
  });
  await test('旧1時間未満睡眠の保持・チェック解除・保存取消を区別する', async () => {
    const old = K.validateRecord({ date, weight: 65, sleep: 0.5 }); const h = setup([old]); await h.edit();
    h.elements.get('clear-legacy-sleep').checked = true; h.answers.push(false); await h.save();
    assert.equal(h.writes.length, 0); assert.deepEqual(h.record(), old);
    h.elements.get('clear-legacy-sleep').checked = false; await h.save(); assert.deepEqual(h.record(), old);
    assert.equal(h.confirmations.at(-2).text.includes('・' + K.labels.sleep), false);
  });
  await test('旧1時間未満睡眠は新規の有効な時分へ変更でき、編集終了時には選択をリセット', async () => {
    const h = setup([K.validateRecord({ date, weight: 65, sleep: 0.5 })]); await h.edit();
    h.controls.sleepHours.value = '7'; h.controls.sleepMinutes.value = '30'; await h.save(); assert.equal(h.record().sleep, 7.5);
    assert.equal(h.elements.get('legacy-sleep-choice').hidden, true); assert.equal(h.elements.get('clear-legacy-sleep').checked, false);
  });
  for (const key of ['weight', 'bodyFat', 'waist', 'protein', 'fat', 'carbs']) {
    await test(`${key}の新規0.1刻みを検証し、0.01刻みを丸めず拒否`, async () => {
      for (const [value, allowed] of [['65.1', true], ['65.10', true], ['65', true], ['65.12', false], ['0.30000000000000004', false]]) {
        const h = setup(); h.controls[key].value = value; await h.save();
        assert.equal(h.writes.length, allowed ? 1 : 0, `${key}=${value}`);
        if (allowed) assert.equal(h.record()[key], Number(value)); else assert.equal(h.confirmations.length, 0);
      }
    });
    await test(`${key}の既存細かい小数を無変更なら厳密保持し、変更時は0.1刻みを適用`, async () => {
      const old = K.validateRecord({ date, [key]: 65.1234567 }); const h = setup([old]); await h.edit();
      h.controls.memo.value = '別項目だけを編集する架空メモ'; await h.save(); assert.equal(h.record()[key], old[key]);
      await h.edit(); h.controls[key].value = '65.12'; await h.save(); assert.equal(h.record()[key], old[key]);
      assert.ok(h.elements.get('form-message').textContent.includes('0.1刻み'));
      h.controls[key].value = '65.2'; await h.save(); assert.equal(h.record()[key], 65.2);
    });
  }
  await test('全6項目の高精度既存値を無変更で保持し、空欄化は未記録にする', async () => {
    const keys = ['weight', 'bodyFat', 'waist', 'protein', 'fat', 'carbs'];
    const old = K.validateRecord({ date, ...Object.fromEntries(keys.map((key, i) => [key, 65.1234567 + i])) });
    const h = setup([old]); await h.edit(); await h.save(); assert.deepEqual(h.record(), old);
    await h.edit(); for (const key of keys) h.controls[key].value = '';
    await h.save(); for (const key of keys) assert.equal(h.record()[key], null);
  });
  await test('Git除外設定は確認済みテスト7本だけを許可し、バックアップ・認証情報を除外', () => {
    const allowed = ['core', 'analysis', 'app-startup', 'copy', 'analysis-text', 'security-codeql', 'usability'].map(name => `tests/${name}.test.cjs`);
    const excluded = ['tests/legacy-v1.json', 'tests/personal.json', 'tests/personal.csv', 'tests/unreviewed.test.cjs', 'personal.json', 'personal.csv', 'backups/record.json', '.env', 'credentials/token.txt'];
    const output = require('node:child_process').execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: require('node:path').join(__dirname, '..'), input: [...allowed, ...excluded].join('\n') + '\n', encoding: 'utf8' });
    const ignored = new Set(output.trim().split(/\r?\n/));
    for (const file of allowed) assert.equal(ignored.has(file), false, file);
    for (const file of excluded) assert.equal(ignored.has(file), true, file);
  });
  await test('空白・タブ・改行だけのメモは新規の実入力として数えず、入力文字自体は変更しない', async () => {
    for (const memo of ['   ', '\t', '\n', ' \t\r\n　', '\u00a0\u3000']) {
      const h = setup(); h.controls.memo.value = memo; const original = h.getStored(); await h.save();
      assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0);
      assert.equal(h.controls.memo.value, memo); assert.equal(h.getStored(), original);
    }
  });
  await test('通常のメモは前後の空白・タブ・改行を含めてそのまま保存', async () => {
    const memo = ' \t架空のメモ\n2行目　\n'; const h = setup(); h.controls.memo.value = memo; await h.save();
    assert.equal(h.record().memo, memo); assert.equal(h.writes.length, 1);
  });
  await test('別項目が入力されている記録では、空白だけのメモも勝手に削除しない', async () => {
    const h = setup(); h.controls.weight.value = '65'; h.controls.memo.value = ' \t\n　'; await h.save(); assert.equal(h.record().memo, ' \t\n　');
  });
  await test('既存の空白メモは起動・無変更編集で書き換えず保持', async () => {
    const old = K.validateRecord({ date, weight: 65, memo: ' \t\n　' }); const h = setup([old]); const original = h.getStored();
    await h.edit(); assert.equal(h.writes.length, 0); assert.equal(h.getStored(), original);
    await h.save(); assert.deepEqual(h.record(), old);
  });
  await test('睡眠説明は両欄の無変更時だけ元値保持と案内し、時間のみ・分のみの変更も換算する', async () => {
    const old = K.validateRecord({ date, weight: 65, sleep: 6.42 });
    for (const [field, value, expected] of [[null, null, 6.42], ['sleepHours', '7', 445 / 60], ['sleepMinutes', '26', 386 / 60]]) {
      const h = setup([old]); await h.edit();
      const note = h.elements.get('sleep-edit-note').textContent;
      assert.ok(note.includes('時間欄・分欄の両方を変更しない場合は元の値を保持します。'));
      assert.ok(note.includes('どちらかを変更した場合'));
      if (field) h.controls[field].value = value;
      await h.save(); assert.equal(h.record().sleep, expected);
    }
  });
  await test('睡眠表示は最も近い1分へ丸め、分の繰り上がり・0・24時間を正しく表示', () => {
    const format = setup().formatSleep;
    for (const [value, text] of [[385 / 60, '6時間25分'], [6.42, '6時間25分'], [6.4, '6時間24分'], [6.999, '7時間0分'], [0.5, '0時間30分'], [0, '0時間0分'], [24, '24時間0分'], [(6 * 60 + 24.5) / 60, '6時間25分']]) assert.equal(format(value), text);
  });
  await test('睡眠未記録と不正値は0時間でなくデータなしと表示しHTMLを生成しない', () => {
    const format = setup().formatSleep;
    for (const value of [null, undefined, '', '6.42', NaN, Infinity, -1, '<img src=x onerror=alert(1)>']) assert.equal(format(value), 'データなし');
  });
  await test('記録詳細は6時間25分と表示し、長い小数や二重の時間単位を出さない', () => {
    const h = setup([K.validateRecord({ date, weight: 65, sleep: 385 / 60 })]);
    const history = h.elements.get('history-list').innerHTML;
    assert.ok(history.includes('<dd>6時間25分</dd>')); assert.equal(history.includes('6.416666666666667'), false);
    assert.equal(history.includes('睡眠時間(時間)'), false); assert.equal(h.writes.length, 0);
  });
  await test('記録詳細で未記録と実測0時間の旧記録を区別', () => {
    for (const [sleep, text] of [[null, 'データなし'], [0, '0時間0分']]) {
      const h = setup([K.validateRecord({ date, weight: 65, sleep })]); const html = h.elements.get('history-list').innerHTML;
      const detail = html.slice(html.indexOf('<dt>睡眠時間'), html.indexOf('<dt>疲労度'));
      assert.ok(detail.includes(`<dd>${text}</dd>`)); if (sleep === null) assert.equal(detail.includes('0時間0分'), false);
    }
  });
  await test('旧小数睡眠は表示・編集案内だけ丸め、起動・無変更編集・JSON往復で元値を維持', async () => {
    const old = K.validateRecord({ date, weight: 65, sleep: 6.42 }); const h = setup([old]); const original = h.getStored();
    assert.equal(h.writes.length, 0); assert.equal(h.getStored(), original); await h.edit();
    assert.ok(h.elements.get('sleep-edit-note').textContent.includes('6時間25分'));
    assert.equal(h.elements.get('sleep-edit-note').textContent.includes('6.42'), false);
    await h.save(); assert.equal(h.record().sleep, 6.42); assert.equal(K.parseBackup(K.backup([h.record()])).records[0].sleep, 6.42);
  });
  await test('7日・月別平均は元値を平均してから分表示し、集計値と元記録を変更しない', () => {
    const rows = [K.validateRecord({ date, weight: 65, sleep: (360 + 23.6) / 60 }), K.validateRecord({ date: '2026-11-05', weight: 65, sleep: (360 + 24.6) / 60 })];
    const h = setup(rows), original = h.getStored(), mean = K.mean(rows, 'sleep').value;
    h.elements.get('summary-date').value = date; h.elements.get('summary-month').value = '2026-11'; h.elements.get('summary-date').listeners.change();
    for (const id of ['weekly-summary', 'monthly-summary']) assert.ok(h.elements.get(id).innerHTML.includes('<td>6時間24分</td>'));
    assert.equal(K.mean(rows, 'sleep').value, mean); assert.equal(h.getStored(), original); assert.equal(h.writes.length, 0);
  });
  await test('期間比較と週次の睡眠平均・比較差を時分表示し、比較不可と有効日数を保持', () => {
    const rows = [K.validateRecord({ date, weight: 65, sleep: 385 / 60 }), K.validateRecord({ date: '2026-10-30', weight: 65, sleep: 7.5 })];
    const h = setup(rows), comparison = h.elements.get('period-comparisons').innerHTML;
    assert.ok(comparison.includes('6時間25分')); assert.ok(comparison.includes('7時間30分')); assert.ok(comparison.includes('−1時間5分')); assert.ok(comparison.includes('1日／7日'));
    assert.ok(h.elements.get('week-analysis').innerHTML.includes('6時間25分'));
    const empty = setup([K.validateRecord({ date, weight: 65 })]).elements.get('period-comparisons').innerHTML;
    assert.ok(empty.includes('<td>睡眠時間</td><td>データなし')); assert.ok(empty.includes('比較不可'));
  });
  await test('画面表示を追加しても分析用コピーは元の小数睡眠値を維持', () => {
    const row = K.validateRecord({ date, weight: 65, sleep: 385 / 60 }); const before = A.analysisText([row], []);
    const h = setup([row]); h.formatSleep(row.sleep); assert.equal(A.analysisText([row], []), before);
    assert.ok(before.includes('|6.416666666666667|')); assert.equal(h.record().sleep, row.sleep);
  });
  return passed;
}
module.exports = { runTests };
if (require.main === module) runTests().then(results => { results.forEach(name => console.log('✓ ' + name)); console.log(`${results.length}件すべて成功`); }).catch(error => { console.error(error); process.exitCode = 1; });
