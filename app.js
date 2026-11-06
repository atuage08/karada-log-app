(() => {
  'use strict';
  const K = window.Karada;
  const $ = id => document.getElementById(id);
  const form = $('record-form');
  const metrics = [
    ['weight', '体重', 'kg'], ['bodyFat', '体脂肪率', '%'], ['waist', 'ウエスト', 'cm'],
    ['calories', '摂取カロリー', 'kcal'], ['protein', 'タンパク質 P', 'g'], ['fat', '脂質 F', 'g'],
    ['carbs', '炭水化物 C', 'g'], ['sleep', '睡眠時間', '時間'], ['fatigue', '疲労度', '/ 5'], ['strength', '筋トレ時間', '分'], ['cardio', '有酸素運動', '分']
  ];
  let records = [], locked = false, editingDate = null, historyLimit = 30, toastTimer;
  let pending = false;
  let targetHistory = [], migrationWarnings = [];
  const number = value => value == null ? '—' : value.toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const shortDate = value => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
  function dateLabel(date) {
    return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(date + 'T12:00:00'));
  }
  function message(id, text, error = false) { $(id).textContent = text; $(id).className = error ? 'error' : 'success'; }
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
  async function confirmAction(title, description, accept, danger = false) {
    const dialog = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-description').textContent = description;
    $('confirm-accept').textContent = accept;
    $('confirm-accept').className = 'button ' + (danger ? 'danger-button' : 'primary');
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once: true });
      dialog.showModal();
    });
  }
  function load() {
    try {
      const raw = localStorage.getItem(K.STORAGE_KEY);
      if (raw !== null) { const loaded = K.parseBackup(raw); records = loaded.records; targetHistory = loaded.targetHistory; migrationWarnings = loaded.warnings; }
    } catch {
      locked = true;
      $('storage-warning').hidden = false;
      $('storage-warning').textContent = 'ブラウザ内の保存領域を使えないか、保存データを読み取れませんでした。元のデータを守るため、保存・復元・削除を停止しています。ブラウザの保存設定を確認してください。既存データがある場合、サイトのデータは削除しないでください。';
      ['save-button', 'restore-file', 'delete-all', 'export-json', 'export-csv'].forEach(id => { $(id).disabled = true; });
    }
  }
  function persist(next, nextTargets = targetHistory) {
    if (locked) return false;
    try {
      localStorage.setItem(K.STORAGE_KEY, K.backup(next, nextTargets));
      records = next; targetHistory = nextTargets; migrationWarnings = [];
      return true;
    } catch {
      toast('保存できませんでした。空き容量やブラウザの設定を確認し、JSONバックアップを保存してください。');
      return false;
    }
  }
  function switchView(view, focus = true) {
    if (!['record', 'overview', 'history', 'backup'].includes(view)) view = 'record';
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
    document.querySelectorAll('[data-view]').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
      if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    render();
    if (focus) {
      const heading = $(`view-${view}`).querySelector('h1');
      heading.tabIndex = -1; heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  function navigate(view) { if (location.hash === '#' + view) switchView(view); else location.hash = view; }
  function formRecord() {
    const values = Object.fromEntries(new FormData(form));
    for (const key of Object.keys(K.numbers)) values[key] = values[key] === '' ? null : Number(values[key]);
    return K.validateRecord(values);
  }
  function updateRecordDates() {
    const date = form.elements.date.value;
    const valid = K.validDate(date);
    const previous = valid ? K.shiftDate(date, -1) : '';
    $('record-period').textContent = valid
      ? `記録日：${date}（D）／ 食事・活動の対象日：${previous}（前日）`
      : '記録する日を選ぶと、各項目の対象日を表示します。';
    $('morning-date').textContent = valid ? `${dateLabel(date)} 朝の測定値と起床時の状態` : '記録日当日朝の情報';
    $('food-date').textContent = valid ? `${dateLabel(previous)} 1日分の摂取量（日種別もこの日）` : '記録日の前日1日分';
    $('activity-date').textContent = valid ? `${dateLabel(previous)} の運動・アルコール・便通` : '記録日の前日の情報';
    $('sleep-date').textContent = valid ? `${dateLabel(previous)} 夜 〜 ${dateLabel(date)} 朝` : '記録日の前夜から当日朝まで';
  }
  function updateCalories() {
    const values = {};
    for (const key of ['protein', 'fat', 'carbs']) values[key] = form.elements[key].value === '' ? null : Number(form.elements[key].value);
    $('calorie-output').textContent = number(K.calories(values));
  }
  function resetForm() {
    form.reset(); form.elements.date.value = K.today(); form.elements.date.readOnly = false;
    editingDate = null; $('cancel-edit').hidden = true; $('editing-note').hidden = true;
    $('exercise-edit-note').hidden = true;
    $('save-button').innerHTML = 'この日の記録を保存 <span aria-hidden="true">↗</span>';
    $('form-message').textContent = '空欄の項目は、未記録として保存されます。'; $('form-message').className = '';
    updateCalories(); updateRecordDates();
  }
  function editRecord(date) {
    const record = records.find(r => r.date === date);
    if (!record) return;
    resetForm();
    for (const key of K.fields) form.elements[key].value = record[key] ?? '';
    editingDate = date; form.elements.date.readOnly = true;
    $('exercise-edit-note').hidden = record.cardio != null && record.strength != null;
    $('cancel-edit').hidden = false; $('editing-note').hidden = false;
    $('editing-note').textContent = `${dateLabel(date)} の記録を編集中です。日付は固定です。保存するまで変更は反映されません。`;
    $('save-button').textContent = '変更を保存'; updateCalories(); updateRecordDates(); navigate('record');
  }
  function averageTable(selectRecords, valueHeading, expected) {
    return `<table><thead><tr><th scope="col">項目</th><th scope="col">${valueHeading}</th><th scope="col">日付の基準</th><th scope="col">記録日数</th><th scope="col">記録状況</th></tr></thead><tbody>${metrics.map(([key, label, unit]) => {
      const result = K.mean(selectRecords(key), key);
      const basis = K.previousDayFields.includes(key) ? '食事・活動の実施日（D−1）' : '当日朝（D）';
      return `<tr><th scope="row">${label}</th><td>${result.count ? number(result.value) : 'データなし'} ${unit}</td><td>${basis}</td><td>${result.count}日／${expected}日</td><td>${window.KaradaAnalysis.quality(result.count, expected)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function renderOverview() {
    const end = K.validDate($('summary-date').value) ? $('summary-date').value : K.today();
    const week = K.range(records, end, 7);
    $('week-range').textContent = `${dateLabel(K.shiftDate(end, -6))} 〜 ${dateLabel(end)}`;
    $('summary-cards').innerHTML = metrics.slice(0, 3).map(([key, label, unit]) => {
      const result = K.mean(week, key);
      return `<div class="summary-card"><p>${label}</p><div class="summary-value">${number(result.value)}<small>${unit}</small></div><p class="help">入力 ${result.count}日／7日<br>${window.KaradaAnalysis.quality(result.count, 7)}</p></div>`;
    }).join('');
    renderChart(end);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test($('summary-month').value) ? $('summary-month').value : end.slice(0, 7);
    $('weekly-summary').innerHTML = averageTable(key => K.range(records, K.previousDayFields.includes(key) ? K.shiftDate(end, -1) : end, 7, key), '7日間の平均', 7);
    const monthDays = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    $('monthly-summary').innerHTML = averageTable(key => K.monthRange(records, month, key), '月の平均', monthDays);
  }
  function renderChart(end) {
    const key = $('chart-metric').value, days = Number($('chart-period').value);
    const data = K.range(records, end, days, key).filter(r => r[key] !== null);
    const [, label, unit] = metrics.find(m => m[0] === key);
    $('chart-details').hidden = !data.length;
    if (!data.length) {
      $('chart-container').innerHTML = `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">↗</span><h3>記録を重ねると、変化が見えてきます。</h3><p>この期間には${label}の記録がありません。<br>項目・期間・基準日を変えるか、最初の記録をつけましょう。</p><button class="button secondary" data-go="record">記録する</button></div>`;
      $('chart-table').replaceChildren(); return;
    }
    const width = 760, height = 295, left = 62, right = 28, top = 25, bottom = 48;
    const low = Math.min(...data.map(r => r[key])), high = Math.max(...data.map(r => r[key]));
    const padding = Math.max((high - low) * .2, .5);
    const min = Math.max(0, low - padding), max = high + padding;
    let start = days ? K.shiftDate(end, -(days - 1)) : data[0].date;
    if (start === end) start = K.shiftDate(end, -1);
    const timestamp = date => +new Date(date + 'T00:00:00Z');
    const x = date => left + (timestamp(date) - timestamp(start)) / (timestamp(end) - timestamp(start)) * (width - left - right);
    const y = value => top + (max - value) / (max - min) * (height - top - bottom);
    // SVG文字列をHTMLとして解析せず、属性と文字を個別に設定します。
    function svgElement(tag, attributes = {}, text) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
      if (text !== undefined) element.textContent = text;
      return element;
    }
    const svg = svgElement('svg', { class: 'trend-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'chart-title chart-description' });
    svg.append(svgElement('title', { id: 'chart-title' }, `${label}の推移`), svgElement('desc', { id: 'chart-description' }, `${start}から${end}まで、${data.length}件の記録。単位${unit}。詳しい数値は下の表で確認できます。`));
    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4, py = y(value);
      svg.append(svgElement('line', { class: 'chart-grid', x1: left, x2: width - right, y1: py, y2: py }), svgElement('text', { class: 'chart-label', x: left - 12, y: py + 4, 'text-anchor': 'end' }, number(value)));
    }
    const line = data.map((r, i) => `${i ? 'L' : 'M'}${x(r.date).toFixed(2)},${y(r[key]).toFixed(2)}`).join(' ');
    svg.append(svgElement('path', { d: line, class: 'chart-line' }));
    for (const r of data) {
      const point = svgElement('circle', { class: 'chart-point', cx: x(r.date), cy: y(r[key]), r: 4 });
      point.append(svgElement('title', {}, `${r.date}：${number(r[key])} ${unit}`));
      svg.append(point);
    }
    const spanDays = Math.round((timestamp(end) - timestamp(start)) / 86400000);
    const ticks = [...new Set([start, K.shiftDate(start, Math.round(spanDays / 2)), end])];
    ticks.forEach((date, i) => svg.append(svgElement('text', { class: 'chart-label', x: x(date), y: height - 13, 'text-anchor': i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle' }, days === 0 && spanDays > 365 ? date : shortDate(date))));
    $('chart-container').replaceChildren(svg);
    $('chart-table').innerHTML = `<table><thead><tr><th>日付</th><th>${label} (${unit})</th></tr></thead><tbody>${data.map(r => `<tr><td>${r.date}</td><td>${number(r[key])}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderHistory() {
    const month = $('history-month').value;
    const filtered = [...records].filter(r => !month || r.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
    $('history-count').textContent = `${filtered.length}件の記録${month ? '（' + month.replace('-', '年') + '月）' : ''}`;
    $('load-more').hidden = filtered.length <= historyLimit;
    if (!filtered.length) {
      $('history-list').innerHTML = '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">▤</span><h3>この期間の記録はまだありません。</h3><p>毎日の小さな記録を、ここに残していきましょう。</p><button class="button primary" data-go="record">記録する</button></div>'; return;
    }
    $('history-list').innerHTML = filtered.slice(0, historyLimit).map(r => {
      const detailKeys = ['protein', 'fat', 'carbs', 'sleep', 'fatigue', 'strength', 'cardio', 'alcohol', 'bowel'];
      const previous = K.shiftDate(r.date, -1);
      const detail = detailKeys.map(key => `<div><dt>${K.labels[key]}<span class="field-date">${key === 'sleep' ? `${previous}夜〜${r.date}朝` : K.targetDate(r, key) + (key === 'fatigue' ? ' 起床時' : '')}</span></dt><dd>${r[key] == null && ['cardio', 'strength'].includes(key) ? '時間未確定（集計対象外）' : escape(r[key] ?? '') || '—'}</dd></div>`).join('');
      return `<article class="card history-card"><div class="history-top"><h2 class="history-date">記録日：${dateLabel(r.date)}${r.dayType ? `<span class="day-badge">${escape(r.dayType)}</span>` : ''}</h2><div class="button-row"><button class="button secondary" data-edit="${r.date}" aria-label="${r.date}の記録を編集">編集</button><button class="button danger-button" data-delete="${r.date}" aria-label="${r.date}の記録を削除">削除</button></div></div><p class="help">当日朝の測定・疲労度：${r.date}<br>前日の食事・活動：${previous}<br>睡眠：${previous} 夜 〜 ${r.date} 朝</p><div class="history-metrics">${metrics.slice(0, 4).map(([key, label, unit]) => `<div><span>${label}（${key === 'calories' ? '前日分' : '当日朝'}）</span>${number(key === 'calories' ? K.calories(r) : r[key])} <small>${unit}</small></div>`).join('')}</div><details><summary>すべての項目を見る</summary><dl class="history-details">${detail}</dl><p class="history-memo">${escape(r.memo) || 'メモはありません。'}</p></details></article>`;
    }).join('');
  }
  function render() {
    renderOverview(); renderHistory();
    window.KaradaAnalysisUI.render(records, targetHistory, locked);
    const unknown = records.filter(r => r.cardio == null || r.strength == null).length;
    $('migration-warning').hidden = !unknown && !migrationWarnings.length;
    $('migration-warning').textContent = `旧形式の運動時間が未確定の記録：${unknown}件。分数を推測せず集計から除外しています。旧有酸素の文章は自由メモに保管しました。内容を確認して分数を入力してください。読み込みだけでは元の保存データは変更しません。`;
    $('backup-count').textContent = `${records.length}件の記録を書き出せます。`;
    $('delete-all').disabled = locked || records.length === 0;
    $('export-json').disabled = locked;
    $('export-csv').disabled = locked;
  }
  function download(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('backup-message', '書き出しを開始しました。保存先にファイルができたことを確認してください。');
  }
  document.addEventListener('click', async event => {
    const view = event.target.closest('[data-view], [data-go]');
    if (view) navigate(view.dataset.view || view.dataset.go);
    const edit = event.target.closest('[data-edit]');
    if (edit && !pending) editRecord(edit.dataset.edit);
    const del = event.target.closest('[data-delete]');
    if (del && !pending && !locked) {
      pending = true;
      try {
        const date = del.dataset.delete;
        if (await confirmAction('この記録を削除しますか？', `${dateLabel(date)} の記録を削除します。\nJSONバックアップがないと元に戻せません。`, 'この日の記録を削除', true)) {
          if (persist(records.filter(r => r.date !== date))) { if (editingDate === date) resetForm(); render(); toast('記録を削除しました。'); }
        }
      } finally { pending = false; }
    }
  });
  form.addEventListener('input', updateCalories);
  form.elements.date.addEventListener('input', updateRecordDates);
  form.elements.date.addEventListener('change', updateRecordDates);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (locked || pending) return;
    let record;
    try { record = formRecord(); } catch (error) { message('form-message', error.message, true); return; }
    pending = true;
    try {
      if (records.some(r => r.date === record.date) && !await confirmAction('この日の記録を上書きしますか？', `${dateLabel(record.date)} の保存済み記録を、今の入力内容で置き換えます。\n空欄にした項目も、未記録に変わります。`, '上書きして保存')) return;
      if (persist(K.mergeRecords(records, [record]))) {
        resetForm(); form.elements.date.value = record.date; updateRecordDates(); render();
        message('form-message', `${dateLabel(record.date)} の記録を保存しました。`); toast('記録を保存しました。おつかれさまでした。');
      } else message('form-message', '保存できませんでした。入力内容は残っています。JSONで今の記録をバックアップし、保存設定や空き容量を確認してください。', true);
    } finally { pending = false; }
  });
  $('cancel-edit').addEventListener('click', () => { resetForm(); toast('編集を終了しました。保存済みの記録は変更していません。'); });
  ['summary-date', 'summary-month', 'chart-metric', 'chart-period'].forEach(id => $(id).addEventListener('change', () => {
    if (!$(id).checkValidity() || !$(id).value) return;
    renderOverview();
  }));
  $('history-month').addEventListener('change', () => { historyLimit = 30; renderHistory(); });
  $('all-history').addEventListener('click', () => { $('history-month').value = ''; historyLimit = 30; renderHistory(); });
  $('load-more').addEventListener('click', () => { historyLimit += 30; renderHistory(); });
  $('export-json').addEventListener('click', () => download(K.backup(records, targetHistory), 'application/json;charset=utf-8', `karada-log-${K.today()}.json`));
  $('export-csv').addEventListener('click', () => download(K.csv(records), 'text/csv;charset=utf-8', `karada-log-${K.today()}.csv`));
  $('restore-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    const mode = $('restore-mode').value;
    const targetMode = $('restore-target-mode').value;
    event.target.value = '';
    if (!file || locked || pending) return;
    pending = true;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('ファイルが大きすぎます。20MB以下のJSONを選んでください。');
      const parsed = K.parseBackup(await file.text()), incoming = parsed.records;
      const nextTargets = targetMode === 'keep' ? targetHistory : targetMode === 'replace' ? parsed.targetHistory : K.validateHistory([...targetHistory, ...parsed.targetHistory]);
      const conflicts = incoming.filter(r => records.some(current => current.date === r.date)).length;
      const description = mode === 'replace'
        ? `現在の${records.length}件をすべて削除して、ファイル内の${incoming.length}件に置き換えます。`
        : `${incoming.length}件を読み込みます。新規${incoming.length - conflicts}件、同じ日付の上書き${conflicts}件です。ファイルにない日の記録は残ります。`;
      const targetDescription = targetMode === 'keep' ? `目標履歴${targetHistory.length}件は保持します。` : targetMode === 'replace' ? `目標履歴${targetHistory.length}件をファイルの${nextTargets.length}件に置き換えます。0件なら初期目標に戻ります。` : `目標履歴を追加し、計${nextTargets.length}件にします。`;
      const unknownExercise = incoming.filter(r => r.cardio == null || r.strength == null).length;
      if (await confirmAction('この内容で復元しますか？', description + '\n' + targetDescription + (unknownExercise ? `\n運動時間が未確定の記録：${unknownExercise}件。旧有酸素の文章があればメモに保管します。` : '') + '\n今の記録のJSONバックアップは保存しましたか？', '確認して復元', mode === 'replace' || conflicts > 0 || targetMode === 'replace')) {
        const next = mode === 'replace' ? incoming : K.mergeRecords(records, incoming);
        if (persist(next, nextTargets)) { migrationWarnings = parsed.warnings; resetForm(); render(); message('backup-message', `${incoming.length}件を復元しました。現在の記録は${next.length}件です。目標履歴${targetHistory.length}件。`); toast('JSONから復元しました。'); }
        else message('backup-message', '復元内容を保存できませんでした。今の保存済み記録は保持されています。', true);
      } else message('backup-message', '復元を中止しました。記録は変更していません。');
    } catch (error) { message('backup-message', `復元できませんでした。${error.message} 記録は変更していません。`, true); }
    finally { pending = false; }
  });
  $('delete-all').addEventListener('click', async () => {
    if (locked || pending || !records.length) return;
    pending = true;
    try {
      if (await confirmAction('すべての記録を削除しますか？', `${records.length}件の記録を、このブラウザからすべて削除します。\nJSONバックアップがないと元に戻せません。`, '全記録を削除', true)) {
        if (persist([])) { resetForm(); render(); message('backup-message', 'すべての記録を削除しました。'); toast('すべての記録を削除しました。'); }
      }
    } finally { pending = false; }
  });
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));
  // 別タブの変更を知らずに上書きすることを防ぎ、再読み込みを促します。
  window.addEventListener('storage', event => {
    if (event.storageArea === localStorage && (event.key === K.STORAGE_KEY || event.key === null)) {
      locked = true; $('storage-warning').hidden = false;
      $('storage-warning').textContent = '別のタブで保存データが変更されました。上書きを防ぐため操作を停止しました。入力中の内容をメモしてから、このページを再読み込みしてください。';
      ['save-button', 'restore-file', 'delete-all'].forEach(id => { $(id).disabled = true; });
    }
  });
  load(); resetForm();
  window.KaradaAnalysisUI.init({ getState: () => ({ records, targetHistory, locked, pending }), saveTargets: async (next, date) => {
    if (locked || pending) return; pending = true;
    try { if (await confirmAction('PFC目標を追加しますか？', `${date}以降の食事実施日に適用します。過去の日を指定すると、その日以降の過去の達成率も再計算されます。既存の変更履歴は残ります。`, '目標を追加')) {
      if (persist(records, next)) { render(); $('target-message').textContent = '目標履歴に追加しました。'; } else $('target-message').textContent = '保存できませんでした。設定は変更していません。';
    } } finally { pending = false; }
  } });
  $('today-label').textContent = dateLabel(K.today());
  $('summary-date').value = K.today(); $('summary-month').value = K.today().slice(0, 7);
  switchView(location.hash.slice(1) || 'record', false);
})();
