(function (root) {
  'use strict';
  const SCHEMA_VERSION = 2;
  const STORAGE_KEY = 'karada-log.records.v1';
  const numbers = {
    weight: [0.1, 500], bodyFat: [0, 100], waist: [1, 300],
    protein: [0, 2000], fat: [0, 2000], carbs: [0, 3000],
    sleep: [0, 24], fatigue: [1, 5], strength: [0, Number.MAX_SAFE_INTEGER], cardio: [0, Number.MAX_SAFE_INTEGER]
  };
  const texts = { alcohol: 200, memo: 10000 };
  const fields = ['date', 'dayType', ...Object.keys(numbers), ...Object.keys(texts), 'bowel'];
  // 保存する日付は従来の記録日Dのまま。対象日は表示・集計のときだけ求めます。
  const previousDayFields = ['dayType', 'protein', 'fat', 'carbs', 'calories', 'strength', 'cardio', 'alcohol', 'bowel'];
  const nutrients = ['protein', 'fat', 'carbs'];
  const dayTypes = ['ト', 'へき', 'きき'];
  const DEFAULT_TARGETS = {
    'ト': { protein: { min: 150, max: 160 }, fat: { min: 60, max: 70 }, carbs: { min: 270, max: 300 } },
    'へき': { protein: { min: 140, max: 150 }, fat: { min: 50, max: 60 }, carbs: { min: 200, max: 220 } },
    'きき': { protein: { min: 140, max: 150 }, fat: { min: 50, max: 60 }, carbs: { min: 200, max: 220 } }
  };
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return value >= '1900-01-01' && value <= '2100-12-31' && !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function shiftDate(date, days) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function validateRecord(input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('記録の形式が正しくありません。');
    if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('対応していない項目が含まれています。');
    if (!validDate(input.date)) throw new Error('日付が正しくありません（1900〜2100年）。');
    // 運動の自動0設定より先に検証し、日付だけの空記録を防ぎます。
    if (!fields.some(key => key !== 'date' && input[key] != null && input[key] !== '')) throw new Error('日付以外に、少なくとも1項目を入力してください。');
    const r = { date: input.date, dayType: input.dayType ?? '' };
    if (!['', 'ト', 'へき', 'きき'].includes(r.dayType)) throw new Error('日種別が正しくありません。');
    for (const [key, [min, max]] of Object.entries(numbers)) {
      const value = input[key];
      if (value === null || value === undefined || value === '') { r[key] = ['strength', 'cardio'].includes(key) && !options.preserveUnknownExercise ? 0 : null; continue; }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (['fatigue', 'strength', 'cardio'].includes(key) && !Number.isSafeInteger(value))) {
        throw new Error(`${labels[key]} の数値が範囲外、または形式が正しくありません。運動時間は0以上の整数で入力してください。`);
      }
      r[key] = value;
    }
    for (const [key, limit] of Object.entries(texts)) {
      r[key] = input[key] ?? '';
      if (typeof r[key] !== 'string' || r[key].length > limit) throw new Error('メモなどの文字数または形式が正しくありません。');
    }
    r.bowel = input.bowel ?? '';
    if (!['', 'あり', 'なし'].includes(r.bowel)) throw new Error('便通の値が正しくありません。');
    if (!fields.some(key => key !== 'date' && r[key] !== '' && r[key] !== null)) throw new Error('日付以外に、少なくとも1項目を入力してください。');
    return r;
  }
  function calories(r) {
    return ['protein', 'fat', 'carbs'].every(key => typeof r[key] === 'number' && Number.isFinite(r[key]))
      ? r.protein * 4 + r.fat * 9 + r.carbs * 4 : null;
  }
  function mean(records, field) {
    const values = records.map(r => field === 'calories' ? calories(r) : r[field]).filter(v => typeof v === 'number' && Number.isFinite(v));
    return { value: values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null, count: values.length };
  }
  function targetDate(record, field) {
    return previousDayFields.includes(field) ? shiftDate(record.date, -1) : record.date;
  }
  function range(records, end, days, field = 'weight') {
    const start = days ? shiftDate(end, -(days - 1)) : '1900-01-01';
    return records.filter(r => targetDate(r, field) >= start && targetDate(r, field) <= end).sort((a, b) => a.date.localeCompare(b.date));
  }
  function monthRange(records, month, field) {
    return records.filter(r => targetDate(r, field).startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
  }
  function validateTargets(targets) {
    if (!targets || typeof targets !== 'object' || Object.keys(targets).length !== 3) throw new Error('3種類の日種別の目標が必要です。');
    const result = {};
    for (const type of dayTypes) {
      if (!targets[type] || Object.keys(targets[type]).length !== 3) throw new Error('P・F・Cの目標が必要です。');
      result[type] = {};
      for (const key of nutrients) {
        const limits = targets[type][key];
        if (!limits || Object.keys(limits).length !== 2 || !['min', 'max'].every(k => typeof limits[k] === 'number' && Number.isFinite(limits[k]) && limits[k] >= 0) || limits.min > limits.max) throw new Error('目標は0以上の数値で、下限≦上限にしてください。');
        result[type][key] = { min: limits.min, max: limits.max };
      }
    }
    return result;
  }
  function validateHistory(history) {
    if (!Array.isArray(history) || history.length > 5000) throw new Error('目標履歴の形式または件数が正しくありません。');
    const result = history.map(item => {
      if (!item || !validDate(item.effectiveFrom) || Object.keys(item).some(k => !['effectiveFrom', 'targets'].includes(k))) throw new Error('目標の適用開始日が正しくありません。');
      return { effectiveFrom: item.effectiveFrom, targets: validateTargets(item.targets) };
    }).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    if (new Set(result.map(h => h.effectiveFrom)).size !== result.length) throw new Error('目標の適用開始日が重複しています。');
    return result;
  }
  function targetsAt(history, date) { let targets = DEFAULT_TARGETS; for (const h of history) { if (h.effectiveFrom > date) break; targets = h.targets; } return targets; }
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('JSONを読み取れませんでした。バックアップファイルを選んでください。'); }
    if (!data || ![1, 2].includes(data.schemaVersion) || !Array.isArray(data.records)) throw new Error('対応するからだ記録のJSONバックアップではありません。');
    if (data.records.length > 50000) throw new Error('記録が多すぎます（上限50,000件）。');
    const warnings = [];
    const records = data.records.map(input => {
      if (data.schemaVersion === 2) return validateRecord(input, { preserveUnknownExercise: true });
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('旧記録の形式が正しくありません。');
      const r = { ...input };
      for (const key of ['breakfast', 'lunch', 'dinner']) delete r[key];
      if (typeof r.cardio === 'string') {
        if (r.cardio.length > 200 || (r.memo != null && typeof r.memo !== 'string')) throw new Error('旧有酸素欄またはメモの形式が正しくありません。');
        if (r.cardio) { r.memo = (r.memo ?? '') + `\n旧有酸素欄（時間未確定）：${r.cardio}`; warnings.push(`${r.date}：旧有酸素欄はメモに保管し、分数は未確定としました。`); }
        r.cardio = null;
      }
      if (typeof r.strength === 'number' && Number.isFinite(r.strength) && r.strength >= 0 && !Number.isInteger(r.strength)) {
        if (r.memo != null && typeof r.memo !== 'string') throw new Error('旧メモの形式が正しくありません。');
        r.memo = (r.memo ?? '') + `\n旧筋トレ時間（分・未確定）：${r.strength}`; r.strength = null; warnings.push(`${r.date}：旧筋トレ時間は未確定です。`);
      }
      return validateRecord(r, { preserveUnknownExercise: true });
    });
    if (new Set(records.map(r => r.date)).size !== records.length) throw new Error('同じ日付の記録が重複しています。');
    const targetHistory = data.schemaVersion === 1 ? [] : validateHistory(data.targetHistory);
    return { records: records.sort((a, b) => a.date.localeCompare(b.date)), targetHistory, warnings, sourceVersion: data.schemaVersion };
  }
  function backup(records, targetHistory = []) {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), records, targetHistory }, null, 2);
  }
  function mergeRecords(current, incoming) {
    const map = new Map(current.map(r => [r.date, r]));
    incoming.forEach(r => map.set(r.date, r));
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  const labels = {
    date: '記録日D', dayType: '日種別（前日）', weight: '体重(kg)', bodyFat: '体脂肪率(%)', waist: 'ウエスト(cm)',
    protein: 'タンパク質P(g)', fat: '脂質F(g)', carbs: '炭水化物C(g)', sleep: '睡眠時間(h)', fatigue: '疲労度(1〜5)',
    strength: '筋トレ時間(分)',
    cardio: '有酸素運動(分)', alcohol: 'アルコール', memo: '自由メモ', bowel: '便通'
  };
  function csv(records) {
    // 表計算ソフトが自由記述を数式として実行することを防ぎます。
    const cell = value => {
      let s = value == null ? '' : String(value);
      if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const rows = [[...fields.map(key => labels[key]), '摂取カロリー(kcal)'],
      ...[...records].sort((a, b) => a.date.localeCompare(b.date)).map(r => [...fields.map(key => r[key]), calories(r)])];
    return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
  }
  const api = { SCHEMA_VERSION, STORAGE_KEY, numbers, texts, fields, labels, validDate, today, shiftDate, targetDate, previousDayFields, nutrients, dayTypes, DEFAULT_TARGETS, validateTargets, validateHistory, targetsAt, validateRecord, calories, mean, range, monthRange, parseBackup, backup, mergeRecords, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Karada = Object.freeze(api);
})(globalThis);
