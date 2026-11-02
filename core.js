(function (root) {
  'use strict';
  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'karada-log.records.v1';
  const numbers = {
    weight: [0.1, 500], bodyFat: [0, 100], waist: [1, 300],
    protein: [0, 2000], fat: [0, 2000], carbs: [0, 3000],
    sleep: [0, 24], fatigue: [1, 5], strength: [0, 1440]
  };
  const texts = { cardio: 200, alcohol: 200, memo: 5000 };
  const times = ['breakfast', 'lunch', 'dinner'];
  const fields = ['date', 'dayType', ...Object.keys(numbers), ...times, ...Object.keys(texts), 'bowel'];
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
  function validateRecord(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('記録の形式が正しくありません。');
    if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('対応していない項目が含まれています。');
    if (!validDate(input.date)) throw new Error('日付が正しくありません（1900〜2100年）。');
    const r = { date: input.date, dayType: input.dayType ?? '' };
    if (!['', 'ト', 'へき', 'きき'].includes(r.dayType)) throw new Error('日種別が正しくありません。');
    for (const [key, [min, max]] of Object.entries(numbers)) {
      const value = input[key];
      if (value === null || value === undefined || value === '') { r[key] = null; continue; }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (key === 'fatigue' && !Number.isInteger(value))) {
        throw new Error(`${key} の数値が範囲外、または形式が正しくありません。`);
      }
      r[key] = value;
    }
    for (const key of times) {
      r[key] = input[key] ?? '';
      if (typeof r[key] !== 'string' || (r[key] !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r[key]))) throw new Error('食事時刻が正しくありません。');
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
  function range(records, end, days) {
    const start = days ? shiftDate(end, -(days - 1)) : '1900-01-01';
    return records.filter(r => r.date >= start && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  }
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('JSONを読み取れませんでした。バックアップファイルを選んでください。'); }
    if (!data || data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.records)) throw new Error('対応するからだ記録のJSONバックアップではありません。');
    if (data.records.length > 50000) throw new Error('記録が多すぎます（上限50,000件）。');
    const records = data.records.map(validateRecord);
    if (new Set(records.map(r => r.date)).size !== records.length) throw new Error('同じ日付の記録が重複しています。');
    return records.sort((a, b) => a.date.localeCompare(b.date));
  }
  function backup(records) {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), records }, null, 2);
  }
  function mergeRecords(current, incoming) {
    const map = new Map(current.map(r => [r.date, r]));
    incoming.forEach(r => map.set(r.date, r));
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  const labels = {
    date: '日付', dayType: '日種別', weight: '体重(kg)', bodyFat: '体脂肪率(%)', waist: 'ウエスト(cm)',
    protein: 'タンパク質P(g)', fat: '脂質F(g)', carbs: '炭水化物C(g)', sleep: '睡眠時間(h)', fatigue: '疲労度(1〜5)',
    strength: '筋トレ時間(分)', breakfast: '朝食時刻', lunch: '昼食時刻', dinner: '夕食時刻',
    cardio: '有酸素運動', alcohol: 'アルコール', memo: '自由メモ', bowel: '便通'
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
  const api = { SCHEMA_VERSION, STORAGE_KEY, numbers, texts, times, fields, labels, validDate, today, shiftDate, validateRecord, calories, mean, range, parseBackup, backup, mergeRecords, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Karada = Object.freeze(api);
})(globalThis);
