(() => {
  'use strict';
  const K = window.Karada, A = window.KaradaAnalysis, $ = id => document.getElementById(id);
  const escape = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = v => v == null ? 'データなし' : v.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  const diff = v => v == null ? '比較不可' : (v > 0 ? '+' : '') + fmt(v);
  // 画面表示専用。元の小数時間や集計値は変更しません。
  function formatSleep(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'データなし';
    const minutes = Math.round(value * 60);
    return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
  }
  const metricLabel = key => key === 'sleep' ? '睡眠時間' : K.labels[key] || '摂取カロリー(kcal)';
  const metricValue = (key, value) => key === 'sleep' ? formatSleep(value) : fmt(value);
  const metricDiff = (key, value) => key === 'sleep' && value != null ? (value > 0 ? '+' : value < 0 ? '−' : '') + formatSleep(Math.abs(value)) : diff(value);
  let hooks;
  function coverage(s) { return `${s.count}日／${s.expected}日・${s.quality}`; }
  function table(headers, rows) { return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
  function achieved(a) { return `${a.rate == null ? 'データなし' : fmt(a.rate) + '%'}（${a.achieved}日／${a.valid}日）`; }
  function achievementTable(data) {
    return table(['日種別', '項目', '達成率（達成／判定）', '不足日数・不足日平均g', '超過日数・超過日平均g'], K.dayTypes.flatMap(type => [...K.nutrients, 'overall'].map(key => {
      const a = data[type][key]; return [type, key === 'overall' ? '総合' : K.labels[key], achieved(a), key === 'overall' ? '—' : `${a.under}日・${fmt(a.underMean)}g`, key === 'overall' ? '—' : `${a.over}日・${fmt(a.overMean)}g`];
    })));
  }
  function exerciseTable(exercises) { return table(['運動', '実施日数', '合計時間（分）', '実施日平均（分）', '有効記録'], Object.entries(exercises).map(([key, s]) => [K.labels[key], s.days + '日', fmt(s.total), s.total != null && !s.days ? '実施なし' : fmt(s.activeMean), coverage(s)])); }
  function goalFields(targets) {
    $('target-fields').innerHTML = K.dayTypes.map((type, i) => `<fieldset class="target-group"><legend>${type}（g）</legend>${K.nutrients.map(key => `<div class="target-pair"><strong>${key === 'protein' ? 'P' : key === 'fat' ? 'F' : 'C'}</strong>${['min', 'max'].map(edge => `<label>${edge === 'min' ? '下限' : '上限'}<input name="goal-${i}-${key}-${edge}" type="number" inputmode="decimal" min="0" step="any" value="${targets[type][key][edge]}" required></label>`).join('')}</div>`).join('')}</fieldset>`).join('');
  }
  function renderGoals(history) {
    const rows = [{ date: history.length ? `初期：〜${K.shiftDate(history[0].effectiveFrom, -1)}` : '初期（全期間）', targets: K.DEFAULT_TARGETS }, ...history.map((h, i) => ({ date: `${h.effectiveFrom}〜${history[i + 1] ? K.shiftDate(history[i + 1].effectiveFrom, -1) : '以後'}`, targets: h.targets }))];
    $('target-history').innerHTML = table(['適用期間（食事実施日）', '日種別', 'P（g）', 'F（g）', 'C（g）'], rows.flatMap(row => K.dayTypes.map(type => [row.date, type, ...K.nutrients.map(key => `${row.targets[type][key].min}〜${row.targets[type][key].max}`)])));
    const submit = $('target-form').querySelector('button[type="submit"]'); if (submit) submit.disabled = hooks.getState().locked;
  }
  function render(records, history, locked) {
    const a = A.analysis(records, history);
    $('analysis-anchor').textContent = a.latest ? `分析基準日：${a.latest}（保存済み最新記録日）。下の分析は上部の日付選択とは独立しています。` : '記録がまだありません。1件以上保存すると期間分析とコピーが使えます。';
    $('copy-analysis').disabled = !a.latest || locked;
    $('copy-fallback').hidden = true; $('analysis-copy-text').value = ''; $('copy-message').textContent = '';
    $('period-comparisons').innerHTML = a.comparisons.map(c => `<details class="analysis-detail"><summary>直近${c.days}日平均・直前${c.days}日との比較</summary><p class="help">身体：${c.metrics.weight.current.start}〜${c.metrics.weight.current.end}／食事・運動：${c.metrics.protein.current.start}〜${c.metrics.protein.current.end}。比較期間は、それぞれ直前の同日数です。</p>${table(['項目', '直近平均・有効日数', '前期間平均・有効日数', '差（直近−前）'], Object.entries(c.metrics).map(([key, s]) => [metricLabel(key), `${metricValue(key, s.current.value)}<br>${coverage(s.current)}`, `${metricValue(key, s.previous.value)}<br>${coverage(s.previous)}`, metricDiff(key, s.diff)]))}<h3>直近の運動</h3>${exerciseTable(Object.fromEntries(Object.entries(c.exercise).map(([key, s]) => [key, s.current])))}<h3>前期間の運動</h3>${exerciseTable(Object.fromEntries(Object.entries(c.exercise).map(([key, s]) => [key, s.previous])))}<p class="help">合計時間の差：${Object.entries(c.exercise).map(([key, s]) => `${K.labels[key]} ${diff(s.diff)}`).join('／')}</p><details><summary>日種別ごとのPFC達成状況</summary>${achievementTable(A.achievement(records, history, c.metrics.protein.current.start, c.metrics.protein.current.end))}</details></details>`).join('');
    $('week-analysis').innerHTML = [...a.weeks].reverse().map(w => `<details class="analysis-detail"><summary>${w.start}〜${w.end} ${w.complete ? '完了週' : '今週・途中経過'}</summary><p class="help">${w.complete ? '月曜日〜日曜日の7日間。前週比は完了週同士です。' : `身体は${w.bodyEnd}まで、食事・活動は${w.foodEnd}まで。未来の日は分母に含めず、合計・実施日数を完了週と単純比較しません。`}</p>${table(['項目', '平均', '前週比', '有効記録'], Object.entries(w.metrics).map(([key, s]) => [metricLabel(key), metricValue(key, s.value), key in w.deltas ? diff(w.deltas[key]) : '—', coverage(s)]))}${exerciseTable(w.exercise)}<details><summary>PFC達成率・不足・超過</summary>${achievementTable(w.achievement)}</details></details>`).join('');
    renderGoals(history);
  }
  function init(options) {
    hooks = options; $('target-date').value = K.today(); goalFields(K.targetsAt(hooks.getState().targetHistory, K.today()));
    $('load-targets').addEventListener('click', () => { if (K.validDate($('target-date').value)) goalFields(K.targetsAt(hooks.getState().targetHistory, $('target-date').value)); });
    $('target-form').addEventListener('submit', async event => {
      event.preventDefault(); const state = hooks.getState(); if (state.locked || state.pending) return;
      try {
        const targets = {};
        for (const [i, type] of K.dayTypes.entries()) { targets[type] = {}; for (const key of K.nutrients) { targets[type][key] = {}; for (const edge of ['min', 'max']) { const value = $('target-form').elements[`goal-${i}-${key}-${edge}`].value; if (value === '') throw Error('目標値を入力してください。'); targets[type][key][edge] = Number(value); } } }
        const next = K.validateHistory([...state.targetHistory, { effectiveFrom: $('target-date').value, targets }]);
        await hooks.saveTargets(next, $('target-date').value);
      } catch (error) { $('target-message').textContent = error.message; }
    });
    $('copy-analysis').addEventListener('click', async () => {
      const state = hooks.getState(); if (state.locked) return;
      const text = A.analysisText(state.records, state.targetHistory); if (!text) return;
      $('analysis-copy-text').value = text;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text); $('copy-message').textContent = '分析用データをコピーしました。必要なときにChatGPTへ貼り付けてください。';
      } catch {
        $('copy-fallback').hidden = false; $('copy-message').textContent = '自動コピーができませんでした。下のテキストを選択し、手動でコピーしてください。';
      }
    });
    $('select-analysis').addEventListener('click', () => { $('analysis-copy-text').focus(); $('analysis-copy-text').select(); $('analysis-copy-text').setSelectionRange(0, $('analysis-copy-text').value.length); });
  }
  window.KaradaAnalysisUI = { init, render, formatSleep };
})();
