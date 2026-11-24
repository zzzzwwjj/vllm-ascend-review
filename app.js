// Client-side renderer for the review board.
// The HTML shell is static; everything is rebuilt from data/*.json.
// Edition switches are client-side (history.pushState) and editions are immutable,
// so revisiting one is served from memory or the HTTP cache instead of the network.
(function () {
  const TOKEN_KEY = 'gh-feedback-token';
  const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const state = { idx: null, editions: [], current: null, cache: new Map(), pending: new Map(), feedback: {}, lessons: [], editionId: null, token: readToken(), fbStatus: {} };
  const params = new URLSearchParams(location.search);
  const app = () => document.getElementById('app');

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

  function sidebar() {
    let lastDay = '';
    const items = state.editions.map((e) => {
      const v = e.verdicts || {};
      const day = dayOf(e.at);
      const head = day !== lastDay ? '<div class="ed-day">' + esc(day) + '</div>' : '';
      lastDay = day;
      return head + '<a class="ed' + (e.id === state.current ? ' active' : '') + '" data-nav="' + esc(e.id) + '" href="?e=' + encodeURIComponent(e.id) + '">' +
        '<span class="ed-when">' + esc(tz(e.at).slice(6)) + '</span>' +
        '<span class="ed-nums">新增 ' + (e.stats?.fresh ?? 0) + ' · 精读 ' + (e.stats?.deep ?? 0) + '</span>' +
        '<span class="ed-dots"><i class="dot ok"></i>' + (v.approve || 0) + '<i class="dot look"></i>' + (v.look || 0) + '<i class="dot push"></i>' + (v.pushback || 0) + '</span></a>';
    }).join('');
    const user = state.idx?.user || '';
    return '<aside class="side"><div class="side-head"><a href="./" class="brand" data-nav="' + esc(state.idx?.current || '') + '">vLLM-Ascend<br><span>待我检视</span></a>' +
      '<p class="side-sub">@' + esc(user) + ' · 每工作日 08:00 / 13:00 / 18:00</p></div>' +
      '<div class="side-title">历史记录 <span>' + state.editions.length + '</span></div>' +
      '<nav class="eds">' + (items || '<p class="muted">暂无</p>') + '</nav>' + ghBox() + '</aside>';
  }

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
      fbBlock(p) +
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

  const skeleton = '<h2>本期精读</h2><div class="sk"></div><div class="sk"></div><div class="sk"></div><h2>其余新增</h2><div class="sk"></div>';


  const draftKey = (pr) => 'fb-draft:' + state.editionId + ':' + pr;

  function defaultHint() {
    return state.token ? '点击后直接提交到 GitHub（本仓库 issue）' : '提交会在新标签打开预填好的 issue，点 Submit 即可';
  }

  function fbBlock(p) {
    const entries = state.feedback[String(p.number)] || [];
    const list = entries.map((e) => {
      const ack = e.ack && e.ack.note
        ? '<div class="fb-ack">' + esc(e.ack.status === 'accepted' ? '已采纳' : e.ack.status === 'rejected' ? '未采纳' : '回应') + '：' + esc(e.ack.note) + '</div>'
        : '';
      return '<div class="fb-item"><span class="fb-time">' + esc(tz(e.at)) + '</span><div class="fb-text">' + esc(e.text) + '</div>' + ack + '</div>';
    }).join('');
    return '<details class="fb" data-pr="' + p.number + '">' +
      '<summary>✎ 我的批注' + (entries.length ? '（' + entries.length + '）' : '') + '</summary>' +
      (list ? '<div class="fb-list">' + list + '</div>' : '') +
      '<textarea data-fb-input="' + p.number + '" data-sha="' + esc(p.review_sha || '') + '" rows="3" ' +
      'placeholder="哪里判断错了 / 漏了什么关键点？写在这里，下一期定时任务会读到。"></textarea>' +
      '<div class="fb-actions"><button type="button" data-fb-submit="' + p.number + '">提交到 GitHub</button>' +
      '<span class="fb-hint" data-fb-hint="' + p.number + '">' + esc(state.fbStatus[p.number] || defaultHint()) + '</span></div>' +
      '</details>';
  }

  function lessonsSection() {
    if (!state.lessons.length) return '';
    return '<details class="lessons"><summary>检视规则（' + state.lessons.length + '）— 从你的批注里学到的</summary><ol>' +
      state.lessons.map((l) => '<li><b>' + esc(l.rule) + '</b>' + (l.why ? '<span class="muted"> — ' + esc(l.why) + '</span>' : '') + '</li>').join('') +
      '</ol></details>';
  }

  function attachLegacyFeedback() {
    document.querySelectorAll('article.card').forEach((art) => {
      if (art.querySelector('details.fb')) return;
      const num = Number((art.id || '').replace('pr-', ''));
      if (!num) return;
      const title = art.querySelector('h3')?.textContent || '';
      art.insertAdjacentHTML('beforeend', fbBlock({ number: num, title, review_sha: '' }));
    });
  }

  function restoreDrafts() {
    document.querySelectorAll('textarea[data-fb-input]').forEach((ta) => {
      try {
        const v = localStorage.getItem(draftKey(ta.dataset.fbInput));
        if (v) ta.value = v;
      } catch (e) { /* private mode */ }
    });
  }

  function ghBox() {
    const on = !!state.token;
    return '<div class="gh"><button type="button" data-gh-open class="gh-toggle">' + (on ? '● GitHub 已连接' : '○ 连接 GitHub（页面内提交）') + '</button>' +
      '<div class="gh-panel" hidden><p class="gh-note">填入仅本仓库 Issues 读写权限的 fine-grained token；只存在本浏览器，不会上传到站点。</p>' +
      '<input type="password" data-gh-input placeholder="github_pat_..." autocomplete="off" spellcheck="false">' +
      '<div class="gh-actions"><button type="button" data-gh-save>保存并验证</button><button type="button" data-gh-clear>清除</button></div>' +
      '<p class="gh-msg" data-gh-msg></p></div></div>';
  }

  function ghMsg(text) {
    const el = document.querySelector('[data-gh-msg]');
    if (el) el.textContent = text;
  }

  async function saveToken() {
    const input = document.querySelector('[data-gh-input]');
    const v = (input?.value || '').trim();
    if (!v) { ghMsg('请先粘贴 token'); return; }
    ghMsg('验证中…');
    try {
      const r = await fetch('https://api.github.com/user', { headers: { authorization: 'Bearer ' + v, accept: 'application/vnd.github+json' } });
      if (!r.ok) { ghMsg('token 无效或已过期（HTTP ' + r.status + '）'); return; }
      const u = await r.json();
      state.token = v;
      try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* ignore */ }
      ghMsg('已连接 @' + u.login + (u.login !== 'zzzzwwjj' ? '（注意：不是 zzzzwwjj）' : ''));
      const btn = document.querySelector('[data-gh-open]');
      if (btn) btn.textContent = '● GitHub 已连接';
    } catch (e) {
      ghMsg('网络错误：' + e.message);
    }
  }

  function clearToken() {
    state.token = '';
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    ghMsg('已清除');
    const btn = document.querySelector('[data-gh-open]');
    if (btn) btn.textContent = '○ 连接 GitHub（页面内提交）';
  }

  async function createIssue(title, body) {
    const site = state.idx?.site || 'zzzzwwjj/vllm-ascend-review';
    const r = await fetch('https://api.github.com/repos/' + site + '/issues', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + state.token, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, labels: ['review-feedback'] }),
    });
    if (r.status === 401 || r.status === 403) {
      state.token = '';
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
      throw new Error('token 无效或没有 issues 写权限（HTTP ' + r.status + '）');
    }
    if (!r.ok) throw new Error('GitHub HTTP ' + r.status);
    return r.json();
  }

  function submitFeedback(pr) {
    const ta = document.querySelector('textarea[data-fb-input="' + pr + '"]');
    const hint = document.querySelector('[data-fb-hint="' + pr + '"]');
    const text = (ta?.value || '').trim();
    if (!text) { if (hint) hint.textContent = '请先写点内容'; return; }
    const edition = state.editionId || '';
    const data = state.cache.get(edition);
    const prMeta = (data?.deep || []).find((x) => x.number === pr) || {};
    const domTitle = document.querySelector('#pr-' + pr + ' h3')?.textContent || '';
    const title = ('[feedback] PR #' + pr + ' · ' + (prMeta.title || domTitle || '')).slice(0, 140);
    const body = '<!-- review-feedback v1\npr: ' + pr + '\nedition: ' + edition + '\nreview_sha: ' + (ta?.dataset.sha || '') +
      '\n-->\n\n**我的批注**\n\n' + text + '\n\n---\n提交自 ' + location.origin + location.pathname + '?e=' + encodeURIComponent(edition) + '#pr-' + pr + '\n';
    const site = state.idx?.site || 'zzzzwwjj/vllm-ascend-review';
    const openPrefilled = () => {
      const url = 'https://github.com/' + site + '/issues/new?labels=review-feedback' +
        '&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
      try { navigator.clipboard?.writeText(text); } catch (e) { /* ignore */ }
      window.open(url, '_blank', 'noopener');
      state.fbStatus[pr] = '未连接 GitHub，已打开预填 issue；点 Submit 即可。';
      if (hint) hint.textContent = state.fbStatus[pr];
    };
    if (!state.token) { openPrefilled(); return; }
    if (hint) hint.textContent = '提交中…';
    createIssue(title, body).then((issue) => {
      const entry = { id: issue.number, at: new Date().toISOString(), text, edition, review_sha: ta?.dataset.sha || '', pending: true, url: issue.html_url };
      (state.feedback[String(pr)] ||= []).unshift(entry);
      try { localStorage.removeItem(draftKey(pr)); } catch (e) { /* ignore */ }
      const details = ta?.closest('details');
      if (details) details.open = false;
      render(state.editionId, state.cache.get(state.editionId) || null);
      state.fbStatus[pr] = '已提交；下一期任务收录后会显示我的回应。';
      const h2 = document.querySelector('[data-fb-hint="' + pr + '"]');
      if (h2) h2.textContent = state.fbStatus[pr];
    }).catch((e) => {
      state.fbStatus[pr] = '提交失败：' + e.message + '（已改为打开预填页）';
      if (hint) hint.textContent = state.fbStatus[pr];
      openPrefilled();
    });
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

  function header(data, meta, isLatest) {
    const stats = data?.stats || meta.stats || {};
    const v = meta.verdicts || {};
    const w = data?.window || meta.window || {};
    const at = data?.at || meta.at;
    return '<header><h1>vLLM-Ascend 待我检视 <span class="at">@' + esc(data?.user || state.idx?.user || '') + '</span>' +
      (isLatest ? '<span class="b b-ok" style="margin-left:8px">最新</span>' : '') + '</h1>' +
      '<p class="sub">窗口 ' + tz(w.start) + ' → ' + tz(w.end) + (w.hours != null ? '（' + w.hours + ' 小时）' : '') +
      (w.reason ? ' · ' + esc(w.reason) : '') + ' · 生成于 ' + tz(at) + '（Asia/Shanghai）</p>' +
      '<div class="stats"><span>本期新增 ' + (stats.fresh ?? 0) + '</span><span>精读 ' + (stats.deep ?? 0) + '</span>' +
      '<span>列表 ' + (stats.rest ?? 0) + '</span>' +
      (stats.skipped_seen ? '<span>历史已见 ' + stats.skipped_seen + '</span>' : '') +
      (stats.skipped_other ? '<span>其他过滤 ' + stats.skipped_other + '</span>' : '') +
      (stats.owned_prs != null ? '<span>我负责的 PR ' + stats.owned_prs + '</span>' : '') +
      '<span>可批准 ' + (v.approve || 0) + ' / 需细看 ' + (v.look || 0) + ' / 建议打回 ' + (v.pushback || 0) + '</span></div></header>';
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

  function render(id, data) {
    const meta = state.editions.find((e) => e.id === id) || state.editions[0];
    state.editionId = id;
    const isLatest = id === (state.idx.current || state.editions[0].id);
    document.title = (isLatest ? '最新一期' : tz(meta.at)) + ' · vLLM-Ascend 待我检视 · @' + (data?.user || state.idx?.user || '');
    app().innerHTML = '<div class="layout">' + sidebar() + '<main>' + header(data, meta, isLatest) +
      '<div class="content">' + (data ? content(data) + lessonsSection() : skeleton) + '</div></main></div>';
    if (data) { attachLegacyFeedback(); wireFilter(); restoreDrafts(); }
  }

  async function loadIndex() {
    const r = await fetch('data/index.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('index ' + r.status);
    const idx = await r.json();
    state.idx = idx;
    state.editions = (idx.editions || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function editionUrl(id) {
    const meta = state.editions.find((e) => e.id === id);
    return 'data/runs/' + encodeURIComponent(id) + '.json' + (meta?.v ? '?v=' + meta.v : '');
  }

  async function loadEdition(id) {
    if (state.cache.has(id)) return state.cache.get(id);
    if (state.pending.has(id)) return state.pending.get(id);
    const p = fetch(editionUrl(id))
      .then((r) => { if (!r.ok) throw new Error('edition ' + r.status); return r.json(); })
      .then((d) => { state.cache.set(id, d); state.pending.delete(id); return d; })
      .catch((e) => { state.pending.delete(id); throw e; });
    state.pending.set(id, p);
    return p;
  }

  function prefetch(id) {
    if (!id || state.cache.has(id)) return;
    loadEdition(id).catch(() => {});
  }

  let loadingTimer = null;
  function setLoading(on) {
    if (on) {
      if (loadingTimer) return;
      loadingTimer = setTimeout(() => document.body.classList.add('loading'), 120);
    } else {
      clearTimeout(loadingTimer);
      loadingTimer = null;
      document.body.classList.remove('loading');
    }
  }

  async function go(id, push) {
    if (!state.editions.some((e) => e.id === id)) id = state.idx.current || state.editions[0].id;
    state.current = id;
    if (push) history.pushState({ id }, '', '?e=' + encodeURIComponent(id));
    const cached = state.cache.get(id);
    render(id, cached || null);
    if (!cached) {
      window.scrollTo(0, 0);
      setLoading(true);
      try {
        const data = await loadEdition(id);
        if (state.current === id) render(id, data);
      } catch (e) {
        app().innerHTML = '<div style="padding:40px;max-width:720px;margin:0 auto"><h1 style="font-size:18px">加载失败</h1>' +
          '<p class="muted">' + esc(e.message) + '</p><p><a href="./">返回最新一期</a></p></div>';
      } finally {
        setLoading(false);
      }
    } else {
      window.scrollTo(0, 0);
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    go(a.dataset.nav, true);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-gh-open]')) {
      const panel = document.querySelector('.gh-panel');
      if (panel) panel.hidden = !panel.hidden;
      return;
    }
    if (e.target.closest('[data-gh-save]')) { e.preventDefault(); saveToken(); return; }
    if (e.target.closest('[data-gh-clear]')) { e.preventDefault(); clearToken(); return; }
    const btn = e.target.closest('[data-fb-submit]');
    if (!btn) return;
    e.preventDefault();
    submitFeedback(Number(btn.dataset.fbSubmit));
  });

  document.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-fb-input]');
    if (!ta) return;
    try { localStorage.setItem(draftKey(Number(ta.dataset.fbInput)), ta.value); } catch (err) { /* ignore */ }
  });

  document.addEventListener('pointerover', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (a) prefetch(a.dataset.nav);
  });
  document.addEventListener('focusin', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (a) prefetch(a.dataset.nav);
  });

  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('e') || state.idx.current;
    go(id, false);
  });

  function idlePrefetch() {
    const run = () => state.editions.slice(0, 3).forEach((e) => prefetch(e.id));
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 1200);
  }

  (async function main() {
    try {
      await loadIndex();
      if (!state.editions.length) throw new Error('还没有任何一期数据');
      await Promise.all([
        fetch('data/feedback/all.json?ts=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) state.feedback = j.entries || {}; }).catch(() => {}),
        fetch('data/lessons.json?ts=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) state.lessons = j.lessons || []; }).catch(() => {}),
      ]);
      const want = params.get('e');
      const id = want && state.editions.some((e) => e.id === want) ? want : state.idx.current || state.editions[0].id;
      await go(id, false);
      idlePrefetch();
    } catch (e) {
      app().innerHTML = '<div style="padding:40px;max-width:720px;margin:0 auto"><h1 style="font-size:18px">看板数据加载失败</h1>' +
        '<p class="muted">' + esc(e.message || String(e)) + '</p><p class="muted">数据在 <a href="data/index.json">data/index.json</a>。</p></div>';
    }
  })();
})();
