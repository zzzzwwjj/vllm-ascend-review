// Client-side renderer for the review board.
// The HTML shell is static; everything below is rebuilt from data/*.json on every load,
// so an edition page can never carry a stale sidebar.
(function () {
  const params = new URLSearchParams(location.search);
  const want = params.get('e');

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmt = (iso, opts) => new Intl.DateTimeFormat('zh-CN', Object.assign({
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }, opts || {})).format(new Date(iso));

  const tz = (iso) => (iso ? fmt(iso).replace(/\//g, '-') : '—');
  const dayOf = (iso) => tz(iso).slice(0, 5);

  const verdictMeta = {
    approve: { label: '可批准', cls: 'v-approve' },
    look: { label: '需细看', cls: 'v-look' },
    pushback: { label: '建议打回', cls: 'v-push' },
    pending: { label: '精读未完成', cls: 'v-pending' },
  };

  const ciBadge = (ci) => {
    if (!ci || ci.state === 'unknown') return '<span class="b b-ci-unknown">CI 未知</span>';
    if (ci.state === 'success') return '<span class="b b-ok">CI 通过' + (ci.total ? ' · ' + ci.total : '') + '</span>';
    if (ci.state === 'failure') return '<span class="b b-bad">CI 失败 · ' + esc((ci.failed_names || []).join(', ')) + '</span>';
    return '<span class="b b-wait">CI 进行中 · ' + (ci.pending || 0) + '</span>';
  };

  function sidebar(editions, currentId) {
    let lastDay = '';
    const items = editions.map((e) => {
      const v = e.verdicts || {};
      const day = dayOf(e.at);
      const head = day !== lastDay ? '<div class="ed-day">' + esc(day) + '</div>' : '';
      lastDay = day;
      return head + '<a class="ed' + (e.id === currentId ? ' active' : '') + '" href="?e=' + encodeURIComponent(e.id) + '">' +
        '<span class="ed-when">' + esc(tz(e.at).slice(6)) + '</span>' +
        '<span class="ed-nums">新增 ' + (e.stats?.fresh ?? 0) + ' · 精读 ' + (e.stats?.deep ?? 0) + '</span>' +
        '<span class="ed-dots"><i class="dot ok"></i>' + (v.approve || 0) + '<i class="dot look"></i>' + (v.look || 0) + '<i class="dot push"></i>' + (v.pushback || 0) + '</span></a>';
    }).join('');
    return '<aside class="side"><div class="side-head"><a href="./" class="brand">vLLM-Ascend<br><span>待我检视</span></a>' +
      '<p class="side-sub">@' + esc(data_user) + ' · 每工作日 08:00 / 13:00 / 18:00</p></div>' +
      '<div class="side-title">历史记录 <span>' + editions.length + '</span></div>' +
      '<nav class="eds">' + (items || '<p class="muted">暂无</p>') + '</nav></aside>';
  }

  let data_user = '';

  function card(p) {
    const r = p.review || null;
    const v = verdictMeta[r?.verdict] || verdictMeta.pending;
    const owned = p.owned || [];
    const ownedLabel = owned.length
      ? '我负责 ' + owned.length + '/' + p.changed_files + ' 个文件 · +' + p.owned_add + '/-' + p.owned_del
      : '无我负责的文件 · 共 ' + p.changed_files + ' 个文件 +' + p.additions + '/-' + p.deletions;
    const focus = (r?.focus || []).map((f) => '<li><code>' + esc(f.file) + '</code><span>' + esc(f.point) + '</span></li>').join('');
    const risks = (r?.risks || []).map((x) => '<li class="risk-' + esc(x.level || 'medium') + '"><b>' + esc((x.level || 'medium').toUpperCase()) + '</b>' + esc(x.text) + '</li>').join('');
    const questions = (r?.questions || []).map((q) => '<li>' + esc(q) + '</li>').join('');
    return '<article class="card ' + v.cls + '" id="pr-' + p.number + '">' +
      '<div class="card-head"><a class="num" href="' + esc(p.html_url) + '" target="_blank" rel="noopener">#' + p.number + '</a>' +
      '<h3>' + esc(p.title) + '</h3><span class="b ' + v.cls + '">' + v.label + '</span></div>' +
      '<div class="meta"><span>@' + esc(p.author) + '</span>' + ciBadge(p.ci) +
      (p.reviews?.approvals ? '<span class="b b-ok">已有 ' + p.reviews.approvals + ' 人批准</span>' : '') +
      (p.reviews?.changes_requested ? '<span class="b b-bad">' + p.reviews.changes_requested + ' 人要求修改</span>' : '') +
      '<span>' + esc(ownedLabel) + '</span><span>已排队 ' + (p.age_days ?? '—') + ' 天</span>' +
      (p.reason ? '<span class="tag">' + esc(p.reason) + '</span>' : '') +
      (r?.confidence === 'low' ? '<span class="b b-wait">把握不足，需人工确认</span>' : '') + '</div>' +
      (r ? '<p class="summary">' + esc(r.summary) + '</p>' +
        (r.intent ? '<p class="intent"><b>为什么改：</b>' + esc(r.intent) + '</p>' : '') +
        (focus ? '<div class="block"><h4>我负责部分的改动</h4><ul class="focus">' + focus + '</ul></div>' : '') +
        (risks ? '<div class="block"><h4>风险</h4><ul class="risks">' + risks + '</ul></div>' : '') +
        (r.tests ? '<p class="tests"><b>测试：</b>' + esc(r.tests) + '</p>' : '') +
        (questions ? '<div class="block"><h4>要问作者</h4><ul class="questions">' + questions + '</ul></div>' : '') +
        (r.recommend ? '<p class="rec"><b>建议动作：</b>' + esc(r.recommend) + '</p>' : '')
        : '<p class="summary muted">该 PR 的精读未生成。</p>') +
      '</article>';
  }

  function row(p) {
    const r = p.review || null;
    const v = verdictMeta[r?.verdict] || verdictMeta.pending;
    return '<tr data-verdict="' + esc(r?.verdict || 'pending') + '">' +
      '<td><a href="' + esc(p.html_url) + '" target="_blank" rel="noopener">#' + p.number + '</a></td>' +
      '<td class="t">' + esc(p.title) + '</td><td>@' + esc(p.author) + '</td>' +
      '<td class="num2">' + (p.owned?.length ?? 0) + '/' + p.changed_files + '</td>' +
      '<td class="num2">+' + p.owned_add + '/-' + p.owned_del + '</td>' +
      '<td>' + esc(p.ci?.state || 'unknown') + '</td>' +
      '<td class="num2">' + (p.reviews?.approvals ?? 0) + '</td>' +
      '<td class="num2">' + p.age_days + 'd</td>' +
      '<td>' + (r ? '<span class="b ' + v.cls + ' sm">' + v.label + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
  }

  function content(data) {
    if (data.legacy_content_html) return data.legacy_content_html;
    const deep = (data.deep || []).map(card).join('');
    const rest = (data.rest || []).map(row).join('');
    return '<h2>本期精读（' + (data.deep || []).length + '）</h2>' +
      (deep || '<p class="muted">本期无新增。</p>') +
      '<h2>其余新增（' + (data.rest || []).length + '）</h2>' +
      '<input type="search" id="q" placeholder="按编号 / 标题 / 作者筛选……">' +
      '<table id="all"><thead><tr><th>PR</th><th>标题</th><th>作者</th><th>我负责/全部</th><th>改动</th><th>CI</th><th>已有批准</th><th>排队</th><th>结论</th></tr></thead>' +
      '<tbody>' + (rest || '<tr><td colspan="9" class="muted">无</td></tr>') + '</tbody></table>';
  }

  function wireFilter() {
    const q = document.getElementById('q');
    if (!q) return;
    const rows = Array.from(document.querySelectorAll('#all tbody tr'));
    q.addEventListener('input', () => {
      const v = q.value.trim().toLowerCase();
      for (const r of rows) r.style.display = !v || r.textContent.toLowerCase().includes(v) ? '' : 'none';
    });
  }

  async function getJson(url) {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' -> ' + r.status);
    return r.json();
  }

  function fail(msg) {
    document.getElementById('app').innerHTML = '<div style="padding:40px;max-width:720px;margin:0 auto">' +
      '<h1 style="font-size:18px">看板数据加载失败</h1><p class="muted">' + esc(msg) + '</p>' +
      '<p class="muted">数据在 <a href="data/index.json">data/index.json</a>，可稍后重试。</p></div>';
  }

  async function main() {
    const idx = await getJson('data/index.json');
    const editions = (idx.editions || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    if (!editions.length) return fail('还没有任何一期数据');
    const id = want && editions.some((e) => e.id === want) ? want : idx.current || editions[0].id;
    const meta = editions.find((e) => e.id === id) || editions[0];
    const data = await getJson('data/runs/' + encodeURIComponent(id) + '.json');
    data_user = data.user || idx.user || '';
    const isLatest = id === (idx.current || editions[0].id);

    document.title = (isLatest ? '最新一期' : tz(meta.at)) + ' · vLLM-Ascend 待我检视 · @' + data_user;

    const stats = data.stats || meta.stats || {};
    const v = meta.verdicts || {};
    const w = data.window || {};
    const header =
      '<header><h1>vLLM-Ascend 待我检视 <span class="at">@' + esc(data_user) + '</span>' +
      (isLatest ? '<span class="b b-ok" style="margin-left:8px">最新</span>' : '') + '</h1>' +
      '<p class="sub">窗口 ' + tz(w.start) + ' → ' + tz(w.end) + (w.hours != null ? '（' + w.hours + ' 小时）' : '') +
      (w.reason ? ' · ' + esc(w.reason) : '') + ' · 生成于 ' + tz(data.at || meta.at) + '（Asia/Shanghai）</p>' +
      '<div class="stats"><span>本期新增 ' + (stats.fresh ?? 0) + '</span><span>精读 ' + (stats.deep ?? 0) + '</span>' +
      '<span>列表 ' + (stats.rest ?? 0) + '</span>' +
      (stats.skipped != null ? '<span>跳过 ' + stats.skipped + '</span>' : '') +
      (stats.owned_prs != null ? '<span>我负责的 PR ' + stats.owned_prs + '</span>' : '') +
      '<span>可批准 ' + (v.approve || 0) + ' / 需细看 ' + (v.look || 0) + ' / 建议打回 ' + (v.pushback || 0) + '</span></div></header>';

    document.getElementById('app').innerHTML = '<div class="layout">' + sidebar(editions, id) +
      '<main>' + header + '<div class="content">' + content(data) + '</div></main></div>';
    wireFilter();
  }

  main().catch((e) => fail(e.message || String(e)));
})();
