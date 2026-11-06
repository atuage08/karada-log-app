(function (root) {
  'use strict';
  const K = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Karada;
  const metrics = ['weight', 'bodyFat', 'waist', 'protein', 'fat', 'carbs', 'calories', 'sleep', 'fatigue'];
  function dayCount(start, end) { return start > end ? 0 : Math.round((new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000) + 1; }
  function between(records, start, end, field) { return records.filter(r => { const d = K.targetDate(r, field); return d >= start && d <= end; }); }
  function quality(count, expected) { return !count ? 'データなし' : count * 10 < expected * 7 ? '記録不足・参考値' : '記録あり'; }
  function stat(records, field, start, end) { const result = K.mean(between(records, start, end, field), field), expected = dayCount(start, end); return { ...result, expected, quality: quality(result.count, expected), start, end }; }
  function exercise(records, field, start, end) {
    const values = between(records, start, end, field).map(r => r[field]).filter(v => typeof v === 'number');
    const active = values.filter(v => v > 0), total = values.reduce((s, v) => s + v, 0), expected = dayCount(start, end);
    return { count: values.length, expected, days: active.length, total: values.length ? total : null, activeMean: active.length ? total / active.length : null, quality: quality(values.length, expected), start, end };
  }
  function achievement(records, history, start, end) {
    const result = {};
    for (const type of K.dayTypes) {
      const rows = between(records, start, end, 'dayType').filter(r => r.dayType === type), group = {};
      for (const key of K.nutrients) {
        let valid = 0, achieved = 0, under = 0, over = 0, underGrams = 0, overGrams = 0;
        for (const r of rows) {
          if (r[key] == null) continue;
          valid++; const target = K.targetsAt(history, K.targetDate(r, key))[type][key];
          if (r[key] < target.min) { under++; underGrams += target.min - r[key]; }
          else if (r[key] > target.max) { over++; overGrams += r[key] - target.max; }
          else achieved++;
        }
        group[key] = { valid, achieved, ratio: `${achieved}日／${valid}日`, rate: valid ? achieved / valid * 100 : null, under, over, underMean: under ? underGrams / under : null, overMean: over ? overGrams / over : null };
      }
      const complete = rows.filter(r => K.nutrients.every(key => r[key] != null));
      const achieved = complete.filter(r => K.nutrients.every(key => { const t = K.targetsAt(history, K.targetDate(r, key))[type][key]; return r[key] >= t.min && r[key] <= t.max; })).length;
      group.overall = { valid: complete.length, achieved, ratio: `${achieved}日／${complete.length}日`, rate: complete.length ? achieved / complete.length * 100 : null };
      result[type] = group;
    }
    return result;
  }
  function latestDate(records) { return records.length ? records.reduce((d, r) => r.date > d ? r.date : d, records[0].date) : null; }
  function monday(date) { const day = new Date(date + 'T00:00:00Z').getUTCDay(); return K.shiftDate(date, -((day + 6) % 7)); }
  function comparison(records, days, latest = latestDate(records)) {
    if (!latest) return null;
    const result = { days, latest, metrics: {}, exercise: {} };
    for (const field of [...metrics, 'strength', 'cardio']) {
      const end = K.previousDayFields.includes(field) ? K.shiftDate(latest, -1) : latest;
      const start = K.shiftDate(end, -(days - 1)), previousEnd = K.shiftDate(start, -1), previousStart = K.shiftDate(start, -days);
      const fn = ['strength', 'cardio'].includes(field) ? exercise : stat;
      const current = fn(records, field, start, end), previous = fn(records, field, previousStart, previousEnd);
      const diff = ['strength', 'cardio'].includes(field) ? (current.total == null || previous.total == null ? null : current.total - previous.total) : (current.value == null || previous.value == null ? null : current.value - previous.value);
      (['strength', 'cardio'].includes(field) ? result.exercise : result.metrics)[field] = { current, previous, diff };
    }
    return result;
  }
  function weekStats(records, history, start, latest, complete) {
    const end = K.shiftDate(start, 6), bodyEnd = complete ? end : latest, foodEnd = complete ? end : K.shiftDate(latest, -1);
    const result = { start, end, complete, bodyEnd, foodEnd, metrics: {}, exercise: {} };
    for (const field of metrics) result.metrics[field] = stat(records, field, start, K.previousDayFields.includes(field) ? foodEnd : bodyEnd);
    for (const field of ['strength', 'cardio']) result.exercise[field] = exercise(records, field, start, foodEnd);
    result.achievement = achievement(records, history, start, foodEnd);
    return result;
  }
  function weekly(records, history, latest = latestDate(records)) {
    if (!latest) return [];
    const thisMonday = monday(latest), weeks = [];
    for (let offset = -8; offset <= 0; offset++) {
      const start = K.shiftDate(thisMonday, offset * 7), w = weekStats(records, history, start, latest, offset < 0);
      w.deltas = {};
      for (const field of ['weight', 'bodyFat', 'waist']) {
        const prev = stat(records, field, K.shiftDate(start, -7), K.shiftDate(start, -1));
        w.deltas[field] = !w.complete || w.metrics[field].value == null || prev.value == null ? null : w.metrics[field].value - prev.value;
      }
      weeks.push(w);
    }
    return weeks;
  }
  function analysis(records, history) { const latest = latestDate(records); return { latest, comparisons: latest ? [7, 14, 28].map(days => comparison(records, days, latest)) : [], weeks: weekly(records, history, latest) }; }
  const requestText = '以下は私の健康・食事・運動記録です。減量の進捗を、7・14・28日平均、週次推移、PFC達成状況、運動、睡眠・疲労から総合評価してください。\n特に、体重・体脂肪率・ウエストの中期的な傾向を重視してください。記録不足、測定誤差、水分変動などの可能性も考慮し、短期変動だけで原因を断定しないでください。\nPFC目標は、減量が順調なら原則維持し、数週間の停滞などで合理的な必要性がある場合のみ調整案を示してください。\n分析結果には、①進捗評価、②食事・PFC評価、③運動評価、④睡眠・疲労評価、⑤翌週の具体的な行動提案を含めてください。\n目標変更を提案する場合は理由と具体的な数値を説明してください。最終判断は私が行います。アプリの設定は自動変更しないでください。';
  // 以下はコピー文章の整形専用。上の集計・判定結果は変更しません。
  const textNames = { weight: '体重kg', bodyFat: '体脂肪%', waist: 'ウエストcm', protein: 'Pg', fat: 'Fg', carbs: 'Cg', calories: 'kcal', sleep: '睡眠h', fatigue: '疲労' };
  const textNumber = value => value == null ? '—' : String(value);
  const textCell = value => String(value).replace(/[\\\r\n|]/g, ch => ({ '\\': '\\\\', '\r': '\\r', '\n': '\\n', '|': '\\|' }[ch]));
  function textQuality(s) { return s.quality === '記録不足・参考値' ? '・記録不足・参考値' : ''; }
  function textCoverage(s) { return `${s.count}/${s.expected}日${textQuality(s)}`; }
  function textAchievement(data) {
    const lines = [], emptyTypes = [];
    for (const type of K.dayTypes) {
      const group = data[type];
      if ([...K.nutrients, 'overall'].every(key => !group[key].valid)) { emptyTypes.push(type); continue; }
      lines.push(type + '：' + [...K.nutrients, 'overall'].map(key => {
        const s = group[key], name = key === 'overall' ? '総合' : { protein: 'P', fat: 'F', carbs: 'C' }[key];
        if (!s.valid) return `${name}判定なし(0/0日)`;
        return `${name}${textNumber(s.rate)}%(${s.achieved}/${s.valid}日)` + (key === 'overall' ? '' : ` 不足${s.under}日${s.under ? '/平均' + textNumber(s.underMean) + 'g' : ''} 超過${s.over}日${s.over ? '/平均' + textNumber(s.overMean) + 'g' : ''}`);
      }).join('、'));
    }
    if (emptyTypes.length) lines.push(`PFC判定なし（P/F/C/総合すべて0/0日）：${emptyTypes.join('・')}`);
    return lines.join('\n');
  }
  function textExercise(s) { return `実施${s.days}日/計${textNumber(s.total)}分/実施日平均${s.total != null && !s.days ? '実施なし' : textNumber(s.activeMean) + '分'}（有効${textCoverage(s)}）`; }
  function textGoals(targets) { return K.dayTypes.map(type => type + ' ' + K.nutrients.map(key => ({ protein: 'P', fat: 'F', carbs: 'C' }[key]) + textNumber(targets[type][key].min) + '〜' + textNumber(targets[type][key].max) + 'g').join('/')).join('、'); }
  function analysisText(records, history) {
    const a = analysis(records, history); if (!a.latest) return null;
    const lines = ['からだ記録・分析用データ', `分析基準日（最新記録日D）：${a.latest}`, '身体・睡眠・疲労はD、日種別・食事・活動はD−1。—はデータなし。未記録を0補完しない。', '有効n/N日＝有効記録日数/対象日数。70%未満は記録不足・参考値。差＝直近−前期間。', 'PFC達成%は達成/判定可能日数（上下限を含む）。100%(1/1日)でも記録充足1/7日は参考値。未入力・日種別未選択は判定から除外。不足・超過0日の平均gは該当なし。', '運動は実施日数・合計分・実施日平均。今週の合計・日数を完了週と単純比較しない。', '【直近7暦日の日別詳細】', '記録日D|食事・活動日D−1|日種別|体重kg|体脂肪%|ウエストcm|Pg|Fg|Cg|kcal|筋トレ分|有酸素分|睡眠h|疲労1〜5|酒|便通'];
    const map = new Map(records.map(r => [r.date, r]));
    for (let i = 6; i >= 0; i--) {
      const date = K.shiftDate(a.latest, -i), r = map.get(date), prefix = `${date}|${K.shiftDate(date, -1)}`;
      lines.push(r ? prefix + '|' + [r.dayType || '未選択', ...['weight', 'bodyFat', 'waist', 'protein', 'fat', 'carbs'].map(key => textNumber(r[key])), textNumber(K.calories(r)), textNumber(r.strength), textNumber(r.cardio), textNumber(r.sleep), textNumber(r.fatigue), r.alcohol || '未入力', r.bowel || '未入力'].map(textCell).join('|') : prefix + '|未記録');
    }
    lines.push('【7・14・28日比較】');
    for (const c of a.comparisons) {
      const body = c.metrics.weight, food = c.metrics.protein;
      lines.push(`${c.days}日比較：身体 ${body.current.start}〜${body.current.end}／前 ${body.previous.start}〜${body.previous.end}、食事・活動 ${food.current.start}〜${food.current.end}／前 ${food.previous.start}〜${food.previous.end}`);
      const previousEmpty = [...Object.values(c.metrics), ...Object.values(c.exercise)].every(s => !s.previous.count);
      if (previousEmpty) lines.push(`前期間は全数値項目データなし（各0/${c.days}日）。差は全項目比較不可。以下は直近平均|有効日数・注意。`);
      else lines.push('項目|直近平均/前平均|差|有効日数（直近/前）・注意');
      for (const [key, s] of Object.entries(c.metrics)) lines.push(previousEmpty
        ? `${textNames[key]}|${textNumber(s.current.value)}|${textCoverage(s.current)}`
        : `${textNames[key]}|${textNumber(s.current.value)}/${textNumber(s.previous.value)}|${s.diff == null ? '比較不可' : textNumber(s.diff)}|${textCoverage(s.current)}／${textCoverage(s.previous)}`);
      for (const [key, s] of Object.entries(c.exercise)) lines.push(`${key === 'strength' ? '筋トレ' : '有酸素'}：直近 ${textExercise(s.current)}` + (previousEmpty ? '' : `、前 ${textExercise(s.previous)}、合計差 ${s.diff == null ? '比較不可' : textNumber(s.diff)}`));
    }
    lines.push('【完了8週間と進行中の週】');
    for (const w of a.weeks) {
      // 数値が空でも、日種別・生活記録・メモだけの記録がある週を「未記録」にしません。
      const hasRecord = records.some(r => (r.date >= w.start && r.date <= w.bodyEnd) || (K.targetDate(r, 'dayType') >= w.start && K.targetDate(r, 'dayType') <= w.foodEnd));
      if (!hasRecord) { lines.push(`${w.start}〜${w.end}：全項目未記録・PFC判定なし`); continue; }
      lines.push(`${w.start}〜${w.end} ${w.complete ? '完了週' : '今週・途中経過（身体は' + w.bodyEnd + '、食事・活動は' + w.foodEnd + 'まで）'}：平均|有効日数・注意`);
      for (const [key, s] of Object.entries(w.metrics)) lines.push(`${textNames[key]}|${textNumber(s.value)}|${textCoverage(s)}`);
      lines.push(w.complete ? '前週比：' + ['weight', 'bodyFat', 'waist'].map(key => textNames[key] + ' ' + (w.deltas[key] == null ? '比較不可' : textNumber(w.deltas[key]))).join('、') : '前週比：途中経過のため比較不可');
      for (const [key, s] of Object.entries(w.exercise)) lines.push(`${key === 'strength' ? '筋トレ' : '有酸素'}：${textExercise(s)}`);
      lines.push(textAchievement(w.achievement));
    }
    lines.push('【PFC目標履歴・適用期間】', `初期（${history.length ? '〜' + K.shiftDate(history[0].effectiveFrom, -1) : '変更前の全期間'}、食事実施日）：${textGoals(K.DEFAULT_TARGETS)}`);
    history.forEach((h, i) => lines.push(`${h.effectiveFrom}〜${history[i + 1] ? K.shiftDate(history[i + 1].effectiveFrom, -1) : '以後'}：${textGoals(h.targets)}`));
    lines.push('【期間内PFC達成状況】');
    for (const c of a.comparisons) lines.push(`直近${c.days}日（食事実施日は上記比較期間と同じ）`, textAchievement(achievement(records, history, c.metrics.protein.current.start, c.metrics.protein.current.end)));
    lines.push('【分析依頼】', requestText);
    return lines.join('\n');
  }
  const api = { metrics, dayCount, between, quality, stat, exercise, achievement, latestDate, monday, comparison, weekStats, weekly, analysis, analysisText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KaradaAnalysis = Object.freeze(api);
})(globalThis);
