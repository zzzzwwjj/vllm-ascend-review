// Client-side renderer for the review board.
// The HTML shell is static; everything is rebuilt from data/*.json.
// Edition switches are client-side (history.pushState) and editions are immutable,
// so revisiting one is served from memory or the HTTP cache instead of the network.
(function () {
  const TOKEN_KEY = 'gh-feedback-token';
  const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
  const state = { idx: null, editions: [], current: null, cache: new Map(), pending: new Map(), feedback: {}, lessons: [], editionId: null, token: readToken(), fbStatus: {}, compact: (() => { try { return localStorage.getItem('board-compact') === '1'; } catch (e) { return false; } })(), view: null,
    highlights: [], pendingHl: (() => { try { return JSON.parse(localStorage.getItem('board-pending-hl') || '[]'); } catch (e) { return []; } })(),
    marks: {}, pendingMarks: (() => { try { return JSON.parse(localStorage.getItem('board-pending-marks') || '[]'); } catch (e) { return []; } })() };
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
        '<span class="ed-when">' + esc(e.label || tz(e.at).slice(6)) + '</span>' +
        '<span class="ed-nums">新增 ' + (e.stats?.fresh ?? 0) + ' · 精读 ' + (e.stats?.deep ?? 0) + '</span>' +
        '<span class="ed-dots"><i class="dot ok"></i>' + (v.approve || 0) + '<i class="dot look"></i>' + (v.look || 0) + '<i class="dot push"></i>' + (v.pushback || 0) + '</span></a>';
    }).join('');
    const user = state.idx?.user || '';
    return '<aside class="side"><div class="side-head"><a href="./" class="brand" data-nav="' + esc(state.idx?.current || '') + '">vLLM-Ascend<br><span>待我检视</span></a>' +
      '<p class="side-sub">@' + esc(user) + ' · 每工作日 08:00 / 13:00 / 18:00</p></div>' +
      highlightsSection() +
      '<div class="side-title">历史记录 <span>' + state.editions.length + '</span></div>' +
      '<nav class="eds side-scroll">' + (items || '<p class="muted">暂无</p>') + '</nav>' +
      '<div class="side-foot">' + ghBox() + '</div></aside>';
  }

  const fmtNum = (n) => (n == null ? '0' : Number(n).toLocaleString('en-US'));
  const pillClass = (v) => (v.cls === 'v-approve' ? 'ok' : v.cls === 'v-look' ? 'look' : v.cls === 'v-push' ? 'push' : 'pending');
  const fileUrl = (p, file) => (p.head_sha
    ? 'https://github.com/vllm-project/vllm-ascend/blob/' + p.head_sha + '/' + file
    : p.html_url + '/files');
  const confLabel = (c) => ({ high: '高', medium: '中', low: '低' }[c] || '');
  const lvlLabel = (l) => ({ high: '高', medium: '中', low: '低' }[l] || '中');

  function diffBar(add, del, maxAdd) {
    const a = Math.max(2, Math.round((add / Math.max(1, maxAdd)) * 100));
    const aW = Math.min(a, 100);
    const dW = del > 0 ? Math.min(Math.max(1, Math.round((del / Math.max(1, maxAdd)) * 100)), 100 - aW) : 0;
    return '<div class="bar"><i style="width:' + aW + '%"></i>' + (dW ? '<u style="width:' + dW + '%"></u>' : '') + '</div>';
  }

  function topRow(p, v) {
    return '<div class="rc-head"><span class="pill ' + pillClass(v) + '">' + v.label + '</span>' +
      '<a class="num" href="' + esc(p.html_url) + '" target="_blank" rel="noopener">#' + p.number + '</a>' +
      '<a class="ttl" href="' + esc(p.html_url) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>' +
      '<a class="gh" href="' + esc(p.html_url) + '" target="_blank" rel="noopener">GitHub ↗</a></div>';
  }


  function markState(p) {
    const m = state.marks[String(p.number)];
    if (m && m.at) return { label: '已检视 ' + tz(m.at).slice(6), cls: 'yes' };
    if ((state.pendingMarks || []).some((x) => x.pr === p.number)) return { label: '已完成 · 待同步', cls: 'pending' };
    const mine = p.reviews?.mine;
    if (mine && mine.commit_id === p.head_sha && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(mine.state)) return { label: '已检视（GitHub）', cls: 'yes' };
    return { label: '未检视', cls: 'no' };
  }

  function metaRow(p) {
    const r = p.review;
    return '<div class="rc-meta">' +
      '<a href="https://github.com/' + esc(p.author) + '" target="_blank" rel="noopener">@' + esc(p.author) + '</a>' +
      ciBadge(p.ci) +
      (p.reviews?.approvals ? '<span>已有 ' + p.reviews.approvals + ' 人批准</span>' : '') +
      '<span>改动 <b class="add">+' + fmtNum(p.additions) + '</b> / <b class="del">−' + fmtNum(p.deletions) + '</b> · ' + p.changed_files + ' 个文件</span>' +
      '<span>' + (p.owned?.length ? '我负责 ' + p.owned.length + '/' + p.changed_files : '无我负责文件') + '</span>' +
      '<span>排队 ' + p.age_days + ' 天</span>' +
      (r?.confidence ? '<span>把握 ' + confLabel(r.confidence) + '</span>' : '') +
      (p.reason ? '<span class="tag">' + esc(p.reason) + '</span>' : '') +
      (() => { const m = markState(p); return '<span class="done ' + m.cls + '">' + esc(m.label) + '</span>'; })() +
      '</div>';
  }

  function ownedPanel(p) {
    const owned = p.owned || [];
    const focusMap = new Map((p.review?.focus || []).map((f) => [f.file, f.point]));
    if (!owned.length) {
      const areas = (p.areas || []).map((a) => '<span class="area">' + esc(a.p) + ' · ' + a.n + '</span>').join('');
      return '<section class="rc-panel"><h4>改动位置 <b>0</b></h4>' +
        '<p class="muted small">本次为显式请求：改动没有落在 @' + (state.idx?.user || '') + ' 的 CODEOWNERS 路径。共 ' + p.changed_files +
        ' 个文件 <b class="add">+' + fmtNum(p.additions) + '</b> / <b class="del">−' + fmtNum(p.deletions) + '</b>。</p>' +
        '<div class="scrollarea">' + (areas ? '<div class="areas">' + areas + '</div>' : '<p class="muted small">建议直接看 PR 描述与 CI。</p>') + '</div></section>';
    }
    const maxAdd = Math.max(1, ...owned.map((f) => f.additions));
    const rows = owned.map((f) => {
      const point = focusMap.get(f.file);
      return '<div class="file"><div class="frow">' +
        '<a class="fpath" href="' + esc(fileUrl(p, f.file)) + '" target="_blank" rel="noopener" title="' + esc(f.file) + '">' + esc(f.file) + '</a>' +
        '<span class="add">+' + fmtNum(f.additions) + '</span><span class="del">−' + fmtNum(f.deletions) + '</span></div>' +
        diffBar(f.additions, f.deletions, maxAdd) +
        (point ? '<p class="fpoint">' + esc(point) + '</p>' : '') + '</div>';
    }).join('');
    return '<section class="rc-panel"><h4>我负责的改动 <b>' + owned.length + '</b>' +
      (owned.length > 5 ? '<span class="hint">滚动查看全部</span>' : '') + '</h4>' +
      '<div class="scrollarea filelist">' + rows + '</div></section>';
  }

  function risksPanel(p) {
    const risks = p.review?.risks || [];
    if (!risks.length) return '<section class="rc-panel"><h4>风险 <b>0</b></h4><p class="muted small">未发现需要单独指出的风险。</p></section>';
    const order = { high: 0, medium: 1, low: 2 };
    const list = risks.slice().sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
    const counts = { high: 0, medium: 0, low: 0 };
    for (const r of risks) counts[r.level] = (counts[r.level] || 0) + 1;
    const summary = [counts.high ? counts.high + ' 高' : '', counts.medium ? counts.medium + ' 中' : '', counts.low ? counts.low + ' 低' : ''].filter(Boolean).join(' · ');
    return '<section class="rc-panel"><h4>风险 <b class="bad">' + risks.length + '</b><span class="hint">' + summary + '</span></h4>' +
      '<div class="scrollarea risklist">' + list.map((r) => '<div class="risk ' + esc(r.level || 'medium') + '"><span class="lv">' + lvlLabel(r.level) + '</span><p>' + esc(r.text) + '</p></div>').join('') + '</div></section>';
  }

  function cardFoot(p) {
    const r = p.review;
    const q = r?.questions?.length
      ? '<details class="rc-q"><summary>要问作者（' + r.questions.length + '）</summary><ol>' + r.questions.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol></details>'
      : '';
    return (r?.tests ? '<p class="rc-tests"><b>测试</b>' + esc(r.tests) + '</p>' : '') + q +
      '<div class="rc-foot"><span class="rec"><b>建议</b>' + esc(r?.recommend || '—') + '</span>' +
      '<span class="acts">' +
      '<button type="button" class="act" data-act="remind" data-pr="' + p.number + '">提醒检视</button>' +
      '<button type="button" class="act primary" data-act="refresh" data-pr="' + p.number + '">刷新检视</button>' +
      (markState(p).cls === 'no' ? '<button type="button" class="act ok" data-act="done" data-pr="' + p.number + '">完成检视</button>' : '') +
      '</span></div>';
  }

  function card(p) {
    const r = p.review || null;
    const v = verdictMeta[r?.verdict] || verdictMeta.pending;
    return '<article class="card rc ' + v.cls + '" id="pr-' + p.number + '">' +
      topRow(p, v) + metaRow(p) +
      (r ? '<p class="rc-summary" title="' + esc(r.summary) + '">' + esc(r.summary) + '</p>' + (r.intent ? '<p class="rc-intent" title="' + esc(r.intent) + '"><b>为什么改</b>' + esc(r.intent) + '</p>' : '')
        : '<p class="rc-summary muted">该 PR 的精读未生成。</p>') +
      '<div class="rc-grid">' + ownedPanel(p) + risksPanel(p) + '</div>' +
      cardFoot(p) + fbBlock(p) + '</article>';
  }

  function compactItem(p) {
    const r = p.review || null;
    const v = verdictMeta[r?.verdict] || verdictMeta.pending;
    const risks = r?.risks || [];
    const h = risks.filter((x) => x.level === 'high').length;
    const m = risks.filter((x) => x.level === 'medium').length;
    const l = risks.filter((x) => x.level === 'low').length;
    return '<details class="cmpt ' + v.cls + '" id="pr-' + p.number + '"><summary>' +
      '<span class="pill sm ' + pillClass(v) + '">' + v.label + '</span>' +
      '<span class="num">#' + p.number + '</span>' +
      '<span class="ttl">' + esc(p.title) + '</span>' +
      '<span class="dots">' + (h ? '<i class="dot h"></i>' + h : '') + (m ? '<i class="dot m"></i>' + m : '') + (l ? '<i class="dot l"></i>' + l : '') + '</span>' +
      '<span class="cmeta">@' + esc(p.author) + ' · +' + fmtNum(p.additions) + '/−' + fmtNum(p.deletions) + ' · ' + p.changed_files + ' 文件' +
      (p.owned?.length ? ' · 我负责 ' + p.owned.length : '') + '</span>' +
      '<span class="chev">▸</span></summary>' +
      '<div class="cmpt-body">' + metaRow(p) +
      (r ? '<p class="rc-summary">' + esc(r.summary) + '</p>' : '') +
      '<div class="rc-grid">' + ownedPanel(p) + risksPanel(p) + '</div>' + cardFoot(p) + fbBlock(p) + '</div></details>';
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
      '<td>' + (r ? '<span class="b ' + v.cls + ' sm">' + v.label + '</span>'
        : '<button type="button" class="mini" data-act="refresh" data-pr="' + p.number + '">需要检视</button>') + '</td></tr>';
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
    return '<details class="lessons"><summary>检视规则（' + state.lessons.length + '）— 从 @' + (state.idx?.user || '') + ' 的批注里学到的</summary><ol>' +
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

  async function createIssue(title, body, labels) {
    const site = state.idx?.site || 'zzzzwwjj/vllm-ascend-review';
    const r = await fetch('https://api.github.com/repos/' + site + '/issues', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + state.token, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, labels: labels || ['review-feedback'] }),
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

  function tableBlock(rowsHtml, title) {
    return (title ? '<h2>' + title + '</h2>' : '') +
      '<table id="all"><thead><tr><th>PR</th><th>标题</th><th>作者</th><th>我负责/全部</th><th>改动</th><th>CI</th><th>已有批准</th><th>排队</th><th>结论</th></tr></thead>' +
      '<tbody>' + (rowsHtml || '<tr><td colspan="9" class="muted">无</td></tr>') + '</tbody></table>';
  }

  function content(data) {
    if (data.legacy_content_html) return data.legacy_content_html;
    const rest = (data.rest || []).map(row).join('');
    if (data.backlog) {
      return '<p class="backlog-note">这些是尚未合入、待我检视的历史 PR（已排除近四期与今早新增），仅按列表呈现，未做精读。</p>' +
        tableBlock(rest, '历史积压（' + (data.rest || []).length + '）');
    }
    const deep = (data.deep || []).map((p) => (state.compact ? compactItem(p) : card(p))).join('');
    return '<h2>本期精读（' + (data.deep || []).length + '）</h2>' +
      (deep || '<p class="muted">本期无新增。</p>') +
      tableBlock(rest, '其余新增（' + (data.rest || []).length + '）');
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
      '<div class="stats">' + (data?.backlog
        ? '<span>积压 ' + (stats.rest ?? stats.fresh ?? 0) + '</span>'
        : '<span>本期新增 ' + (stats.fresh ?? 0) + '</span><span>精读 ' + (stats.deep ?? 0) + '</span><span>列表 ' + (stats.rest ?? 0) + '</span>') +
      (stats.skipped_seen ? '<span>历史已见 ' + stats.skipped_seen + '</span>' : '') +
      (stats.skipped_other ? '<span>其他过滤 ' + stats.skipped_other + '</span>' : '') +
      (stats.owned_prs != null ? '<span>我负责的 PR ' + stats.owned_prs + '</span>' : '') +
      (data?.backlog ? '' : '<span>可批准 ' + (v.approve || 0) + ' / 需细看 ' + (v.look || 0) + ' / 建议打回 ' + (v.pushback || 0) + '</span>') + '</div></header>';
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


  async function loadSearchIndex() {
    if (state.searchIndex) return state.searchIndex;
    state.searchIndex = await fetchJson('data/db/search.json');
    return state.searchIndex;
  }

  async function loadRecord(n) {
    const shard = String(Math.floor(n / 1000));
    const ver = state.idx?.shards?.[shard]?.v;
    const data = await loadShard(shard, ver);
    return (data.items || {})[String(n)] || null;
  }

  function notFoundHtml(kind, q) {
    const reasons = kind === 'pr'
      ? ['在上一次定时任务之后才提交或更新（会进下一期）', '仍是 draft（草稿）', '已合入或已关闭', '不涉及 @' + state.idx.user + ' 在 CODEOWNERS 中负责的文件', '没有显式请求 @' + state.idx.user + ' 检视']
      : ['这个账号的 PR 从未进入过检视范围', 'GitHub ID 拼写或大小写不一致', '相关 PR 仍是 draft、已合入，或未涉及 @' + state.idx.user + ' 的责任田'];
    return '<div class="content"><div class="nf"><h2>' + (kind === 'pr' ? '未找到 PR #' + esc(q) : '未找到 @' + esc(q) + ' 的 PR') +
      '</h2><p>可能的情况：</p><ul>' + reasons.map((r) => '<li>' + r + '</li>').join('') + '</ul>' +
      '<p class="muted">搜索范围是看板数据库，即已经进入过检视范围的 PR。</p>' +
      (kind === 'pr' ? '<div class="nf-actions"><button type="button" class="act primary" data-act="refresh" data-pr="' + esc(q) + '">需要检视</button><span class="muted small">提交后会进入下一期精读，并加入高优检视</span></div>' : '') +
      '<p><a href="./" data-nav="' + esc(state.idx.current) + '">返回最新一期</a></p></div></div>';
  }

  function prView(rec, hit) {
    const header = '<header><h1>PR #' + rec.number + ' <span class="at">@' + esc(rec.author) + '</span></h1>' +
      '<p class="sub">' + esc(rec.title) + '</p>' +
      '<div class="stats"><span>来自 ' + esc(hit.e) + '</span><span>' + (hit.r === 'deep' ? '精读' : '列表') + '</span>' +
      (rec.owned?.length ? '<span>我负责 ' + rec.owned.length + '/' + rec.changed_files + ' 个文件</span>' : '') +
      '</div></header>';
    const body = rec.review
      ? '<div class="content"><h2>精读</h2>' + card({ ...rec, review: rec.review, review_sha: rec.review_sha }) + '</div>'
      : '<div class="content"><h2>未精读</h2>' + tableBlock(row(rec), '') + '</div>';
    return header + body;
  }

  function authorView(login, recs) {
    const reviewed = recs.filter((r) => r.review);
    const plain = recs.filter((r) => !r.review);
    const header = '<header><h1>@' + esc(login) + ' <span class="at">的 PR</span></h1>' +
      '<div class="stats"><span>共 ' + recs.length + ' 个</span><span>精读 ' + reviewed.length + '</span><span>未精读 ' + plain.length + '</span></div></header>';
    const body = '<div class="content">' +
      (reviewed.length ? '<h2>精读（' + reviewed.length + '）</h2>' + reviewed.map(card).join('') : '') +
      (plain.length ? tableBlock(plain.map(row).join(''), '未精读（' + plain.length + '）') : '') +
      '</div>';
    return header + body;
  }

  async function doSearch(raw, push) {
    const q = (raw || '').trim();
    if (!q) return;
    state.query = q;
    await loadSearchIndex();
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      if (push) history.pushState({ pr: n }, '', '?pr=' + n);
      let hit = state.searchIndex.find((x) => x.n === n);
      const rec = await loadRecord(n).catch(() => null);
      if (!rec) { app().innerHTML = shell(notFoundHtml('pr', n)); return; }
      if (!hit) hit = { n, e: '高优/独立记录', r: 'rest', v: null };
      state.view = { type: 'pr', q: String(n) };
      document.title = 'PR #' + n + ' · vLLM-Ascend 待我检视';
      app().innerHTML = shell(prView(rec, hit));
      return;
    }
    const login = q.replace(/^@/, '');
    const hits = state.searchIndex.filter((x) => x.a.toLowerCase() === login.toLowerCase());
    if (push) history.pushState({ author: login }, '', '?author=' + encodeURIComponent(login));
    if (!hits.length) { app().innerHTML = shell(notFoundHtml('author', login)); return; }
    const recs = (await Promise.all(hits.map(async (h) => { const r = await loadRecord(h.n); return r ? { ...r, _hit: h } : null; }))).filter(Boolean);
    state.view = { type: 'author', q: login };
    document.title = '@' + login + ' · vLLM-Ascend 待我检视';
    app().innerHTML = shell(authorView(login, recs));
  }


  function activeHighlights() {
    const items = (state.highlights || []).slice();
    for (const p of state.pendingHl || []) {
      if (!items.some((x) => x.pr === p.pr && x.kind === p.kind)) items.unshift({ ...p, pending: true });
    }
    return items.filter((h) => !(state.marks && state.marks[String(h.pr)]));
  }

  function highlightsSection() {
    const items = activeHighlights();
    if (!items.length) return '';
    const c = { approve: 0, look: 0, pushback: 0 };
    for (const h of items) {
      const v = h.v || findRecord(h.pr)?.review?.verdict;
      if (v && c[v] != null) c[v]++;
    }
    return '<a class="ed hl-batch' + (state.view && state.view.type === 'highlights' ? ' active' : '') + '" data-hl-nav="1" href="?hl=1">' +
      '<span class="ed-when">高优检视</span>' +
      '<span class="ed-nums">待处理 ' + items.length + '</span>' +
      '<span class="ed-dots"><i class="dot ok"></i>' + c.approve + '<i class="dot look"></i>' + c.look + '<i class="dot push"></i>' + c.pushback + '</span></a>';
  }

  async function doHighlights(push) {
    if (push) history.pushState({ hl: 1 }, '', '?hl=1');
    state.view = { type: 'highlights' };
    const items = activeHighlights();
    document.title = '高优检视 · vLLM-Ascend 待我检视';
    if (!items.length) {
      app().innerHTML = shell('<header><h1>高优检视</h1></header><div class="content"><p class="muted">暂无待处理的高优 PR。</p></div>');
      return;
    }
    const recs = (await Promise.all(items.map(async (h) => {
      const r = await loadRecord(h.pr).catch(() => null);
      return r ? { ...r, _hl: h } : null;
    }))).filter(Boolean).filter((r) => markState(r).cls !== 'yes');
    const deep = recs.filter((r) => r.review);
    const rest = recs.filter((r) => !r.review);
    const header = '<header><h1>高优检视 <span class="at">' + recs.length + ' 个待处理</span></h1>' +
      '<p class="sub">提醒检视 / 已刷新的 PR；标记完成检视后会自动移出</p></header>';
    const body = '<div class="content">' +
      (deep.length ? '<h2>精读（' + deep.length + '）</h2>' + deep.map(card).join('') : '') +
      (rest.length ? tableBlock(rest.map(row).join(''), '未精读（' + rest.length + '）') : '') +
      '</div>';
    app().innerHTML = shell(header + body);
  }

  function findRecord(n) {
    for (const d of state.cache.values()) {
      const hit = (d.deep || []).concat(d.rest || []).find((x) => x.number === n);
      if (hit) return hit;
    }
    return null;
  }

  // ---- direct commit: mark a PR as reviewed (token needs Contents RW) ----
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64 || '').replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function commitMark(pr) {
    const site = state.idx?.site || 'zzzzwwjj/vllm-ascend-review';
    const api = 'https://api.github.com/repos/' + site + '/contents/data/db/marks.json';
    const headers = { authorization: 'Bearer ' + state.token, accept: 'application/vnd.github+json' };
    const cur = await fetch(api + '?ref=main', { headers });
    let sha = null;
    let data = { marks: {} };
    if (cur.ok) {
      const j = await cur.json();
      sha = j.sha;
      try { data = JSON.parse(b64decode(j.content)); } catch (e) { data = { marks: {} }; }
    } else if (cur.status !== 404) {
      throw new Error('读取 marks.json 失败（HTTP ' + cur.status + '）');
    }
    data.marks = data.marks || {};
    data.marks[String(pr)] = { at: new Date().toISOString(), source: 'web' };
    const body = {
      message: 'chore: mark PR #' + pr + ' as reviewed',
      content: b64encode(JSON.stringify(data, null, 2) + '\n'),
      branch: 'main',
      ...(sha ? { sha } : {}),
    };
    const put = await fetch(api, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if ([401, 403, 404].includes(put.status)) throw new Error('token 缺少 Contents 写权限（HTTP ' + put.status + '）');
    if (put.status === 409) throw new Error('文件冲突，请重试');
    if (!put.ok) throw new Error('提交失败（HTTP ' + put.status + '）');
    return put.json();
  }

  function watchMark(pr) {
    let tries = 0;
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible, { once: true });
    const tick = async () => {
      tries++;
      try {
        const r = await fetch('data/db/marks.json?ts=' + Date.now(), { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j.marks && j.marks[String(pr)]) {
            state.marks = j.marks;
            state.pendingMarks = (state.pendingMarks || []).filter((x) => x.pr !== pr);
            reRender();
            return;
          }
        }
      } catch (e) { /* keep polling */ }
      if (tries < 60) setTimeout(tick, 5000);
    };
    setTimeout(tick, 4000);
  }

  function reRender() {
    if (state.view && state.view.type === 'home') renderHome();
    else if (state.view && state.view.type === 'highlights') doHighlights(false);
    else if (state.view && (state.view.type === 'pr' || state.view.type === 'author')) doSearch(state.view.q, false);
    else render(state.current || state.editionId, state.cache.get(state.current || state.editionId) || null);
  }

  async function requestAction(kind, pr) {
    const p = findRecord(pr) || (state.searchIndex || []).find((x) => x.n === pr) || {};
    const label = kind === 'remind' ? '[remind]' : kind === 'done' ? '[done]' : '[refresh]';
    const title = label + ' PR #' + pr + (p.title ? ' · ' + p.title : '');
    const body = '<!-- review-action v1\nkind: ' + kind + '\npr: ' + pr + '\nedition: ' + (state.editionId || '') + '\n-->\n\n' +
      (kind === 'remind' ? '**提醒我优先检视**' : kind === 'done' ? '**已完成检视**' : '**请求重新精读**') + ' PR #' + pr +
      (p.html_url ? '\n\n' + p.html_url : '') + '\n';
    const labels = kind === 'remind' ? ['review-remind'] : kind === 'done' ? ['review-done'] : ['review-refresh'];

    const issuePath = async () => {
      const site = state.idx?.site || 'zzzzwwjj/vllm-ascend-review';
      const openPrefilled = () => {
        const url = 'https://github.com/' + site + '/issues/new?labels=' + labels.join(',') +
          '&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
        window.open(url, '_blank', 'noopener');
        addPending(kind, pr, p.title);
      };
      if (!state.token) { openPrefilled(); return; }
      try { await createIssue(title, body, labels); addPending(kind, pr, p.title); }
      catch (e) { openPrefilled(); }
    };

    if (kind === 'done' && state.token) {
      addPending('done', pr, p.title);
      try {
        await commitMark(pr);
        watchMark(pr);
      } catch (e) {
        state.pendingMarks = (state.pendingMarks || []).filter((x) => x.pr !== pr);
        state.fbStatus[pr] = '直接提交失败：' + e.message + '（已改用 issue 方式）';
        await issuePath();
        reRender();
      }
      return;
    }
    await issuePath();
  }

  function addPending(kind, pr, title) {
    if (kind === 'done') {
      state.pendingMarks = (state.pendingMarks || []).filter((x) => x.pr !== pr);
      state.pendingMarks.unshift({ pr, at: new Date().toISOString() });
      try { localStorage.setItem('board-pending-marks', JSON.stringify(state.pendingMarks.slice(0, 50))); } catch (e) { /* ignore */ }
    } else {
      state.pendingHl = (state.pendingHl || []).filter((x) => !(x.pr === pr && x.kind === kind));
      state.pendingHl.unshift({ pr, kind, title: title || '', at: new Date().toISOString() });
      try { localStorage.setItem('board-pending-hl', JSON.stringify(state.pendingHl.slice(0, 30))); } catch (e) { /* ignore */ }
    }
    reRender();
  }


  function homeNotFound(n, login) {
    const user = state.idx?.user || '';
    const reasons = n
      ? ['在上一次定时任务之后才提交或更新（会进下一期）', '仍是 draft（草稿）', '已合入或已关闭',
         '不涉及 @' + user + ' 在 CODEOWNERS 中负责的文件', '没有显式请求 @' + user + ' 检视']
      : ['这个账号的 PR 从未进入过检视范围', 'GitHub ID 拼写或大小写不一致',
         '相关 PR 仍是 draft、已合入，或未涉及 @' + user + ' 的责任田'];
    return '<div class="nf"><h2>' + (n ? '未找到 PR #' + esc(n) : '未找到 @' + esc(login) + ' 的 PR') + '</h2>' +
      '<ul>' + reasons.map((r) => '<li>' + r + '</li>').join('') + '</ul>' +
      (n ? '<div class="nf-actions"><button type="button" class="act primary" data-act="refresh" data-pr="' + n + '">需要检视</button>' +
        '<span class="muted small">提交后会进入下一期精读，并加入高优检视</span></div>' : '') +
      '<p class="muted small">搜索范围是看板数据库，即已经进入过检视范围的 PR。</p></div>';
  }

  function homeHtml() {
    const user = state.idx?.user || '';
    return '<div class="home">' +
      '<section class="home-left">' +
        '<h1>PR 检视看板</h1>' +
        '<p class="muted">输入 PR 编号或 GitHub ID，查看 @' + esc(user) + ' 的精读结论。</p>' +
        '<div class="home-search"><input id="hs" type="search" autocomplete="off" spellcheck="false" placeholder="例如 22244 或 Dean11879">' +
        '<button type="button" data-home-search>搜索</button></div>' +
        '<div id="home-results"></div>' +
      '</section>' +
      '<aside class="home-right">' +
        '<h2>这是什么</h2>' +
        '<p>@' + esc(user) + ' 在 vLLM-Ascend 的 PR 检视看板。每个工作日 08:00 / 13:00 / 18:00 自动收集需要 @' + esc(user) +
        ' 检视的 PR，按 CODEOWNERS 责任田做精读，并按期次归档。</p>' +
        '<ul>' +
          '<li>按 PR 编号搜索；尚未收录的 PR 可以直接点「需要检视」请求，下一期会精读并进入高优。</li>' +
          '<li>每张卡片给出结论（可批准 / 需细看 / 建议打回）、风险、以及要追问作者的问题。</li>' +
          '<li>侧栏按期次浏览历史，也可以按 GitHub ID 查看某位作者的全部 PR。</li>' +
        '</ul>' +
        '<div class="home-stats"><span>期次 ' + state.editions.length + '</span><span>高优 ' + activeHighlights().length + '</span></div>' +
        '<p class="home-links"><a href="docs/RULES.md">规则与口径</a> · <a href="docs/OPERATIONS.md">运维</a> · <a href="docs/MIGRATION.md">迁移</a></p>' +
      '</aside>' +
    '</div>';
  }

  function renderHome() {
    state.view = { type: 'home' };
    state.query = '';
    document.title = 'vLLM-Ascend 待我检视 · @' + (state.idx?.user || '');
    app().innerHTML = '<div class="layout">' + sidebar() + '<main>' + homeHtml() + '</main></div>';
  }

  async function homeSearch(raw) {
    const box = document.getElementById('home-results');
    const q = (raw || '').trim();
    if (!box) return;
    if (!q) { box.innerHTML = ''; return; }
    box.innerHTML = '<p class="muted small">搜索中…</p>';
    await loadSearchIndex();
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      const rec = await loadRecord(n).catch(() => null);
      if (!rec) { box.innerHTML = homeNotFound(n); return; }
      box.innerHTML = '<h2>' + (rec.review ? '精读' : '未精读') + '</h2>' + (rec.review ? card(rec) : tableBlock(row(rec), ''));
      return;
    }
    const login = q.replace(/^@/, '');
    const hits = state.searchIndex.filter((x) => x.a.toLowerCase() === login.toLowerCase());
    if (!hits.length) { box.innerHTML = homeNotFound(null, login); return; }
    const recs = (await Promise.all(hits.map(async (h) => loadRecord(h.n).catch(() => null)))).filter(Boolean);
    const deep = recs.filter((r) => r.review);
    const rest = recs.filter((r) => !r.review);
    box.innerHTML = '<h2>@' + esc(login) + ' 的 PR（' + recs.length + '）</h2>' +
      (deep.length ? deep.map(card).join('') : '') +
      (rest.length ? tableBlock(rest.map(row).join(''), '未精读（' + rest.length + '）') : '');
  }

  function topbar() {
    return '<div class="topbar"><input id="gs" type="search" autocomplete="off" spellcheck="false" placeholder="搜索 PR 编号（如 20758）或 GitHub ID（如 stdjhs）" value="' + esc(state.query || '') + '">' +
      '<button type="button" data-search-btn>搜索</button><button type="button" data-search-clear>回到最新</button>' +
      '<button type="button" data-compact title="切换卡片密度">' + (state.compact ? '舒适模式' : '紧凑模式') + '</button></div>';
  }

  function shell(inner) {
    return '<div class="layout">' + sidebar() + '<main>' + topbar() + inner + '</main></div>';
  }

  function render(id, data) {
    const meta = state.editions.find((e) => e.id === id) || state.editions[0];
    state.editionId = id;
    state.view = { type: 'edition', id };
    const isLatest = id === (state.idx.current || state.editions[0].id);
    state.query = '';
    document.title = (isLatest ? '最新一期' : (meta.label || tz(meta.at))) + ' · vLLM-Ascend 待我检视 · @' + (data?.user || state.idx?.user || '');
    app().innerHTML = shell(header(data, meta, isLatest) +
      '<div class="content">' + (data ? content(data) + lessonsSection() : skeleton) + '</div>');
    if (data) { attachLegacyFeedback(); restoreDrafts(); }
  }

  async function loadIndex() {
    const r = await fetch('data/db/manifest.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('manifest ' + r.status);
    const idx = await r.json();
    state.idx = idx;
    state.editions = (idx.editions || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  function editionUrl(id) {
    const meta = state.editions.find((e) => e.id === id);
    return 'data/db/editions/' + encodeURIComponent(id) + '.json' + (meta?.v ? '?v=' + meta.v : '');
  }


  async function fetchJson(url, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url);
        if (r.ok) return await r.json();
        lastErr = new Error(url + ' -> ' + r.status);
        if (r.status === 404) break;
      } catch (e) { lastErr = e; }
      await new Promise((res) => setTimeout(res, 250 * (i + 1)));
    }
    throw lastErr || new Error('fetch failed: ' + url);
  }

  const shardCache = new Map();
  function loadShard(name, ver) {
    const key = name + ':' + (ver || '');
    if (shardCache.has(key)) return shardCache.get(key);
    const p = fetchJson('data/db/prs/' + name + '.json' + (ver ? '?v=' + ver : ''));
    shardCache.set(key, p);
    return p;
  }

  async function loadEdition(id) {
    if (state.cache.has(id)) return state.cache.get(id);
    if (state.pending.has(id)) return state.pending.get(id);
    const p = fetchJson(editionUrl(id))
      .then(async (meta) => {
        let d;
        if (meta.legacy_html) {
          d = { ...meta, legacy_content_html: meta.legacy_html };
        } else {
          const verOf = (shard) => state.idx?.shards?.[shard]?.v;
          const names = [...new Set((meta.members || []).map((m) => String(Math.floor(m.n / 1000))))];
          const parts = await Promise.all(names.map((sName) => loadShard(sName, verOf(sName))));
          const items = Object.assign({}, ...parts.map((x) => x.items || {}));
          const pick = (role) => (meta.members || []).filter((m) => m.role === role).map((m) => items[m.n]).filter(Boolean);
          d = { id: meta.id, at: meta.at, user: meta.user || state.idx?.user, window: meta.window, stats: meta.stats, verdicts: meta.verdicts, backlog: !!meta.backlog, deep: pick('deep'), rest: pick('rest') };
        }
        state.cache.set(id, d); state.pending.delete(id); return d;
      })
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
    if (e.target.closest('[data-compact]')) {
      e.preventDefault();
      state.compact = !state.compact;
      try { localStorage.setItem('board-compact', state.compact ? '1' : '0'); } catch (err) { /* ignore */ }
      if (state.view && (state.view.type === 'pr' || state.view.type === 'author')) doSearch(state.view.q, false);
      else render(state.current || state.idx.current, state.cache.get(state.current) || null);
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      requestAction(act.dataset.act, Number(act.dataset.pr));
      return;
    }
    if (e.target.closest('[data-hl-nav]')) {
      e.preventDefault();
      doHighlights(true);
      return;
    }
    const hl = e.target.closest('[data-pr-nav]');
    if (hl) {
      e.preventDefault();
      doSearch(hl.dataset.prNav, true);
      return;
    }
    if (e.target.closest('[data-fb-open]')) {
      e.preventDefault();
      const n = e.target.closest('[data-fb-open]').dataset.fbOpen;
      const d = document.querySelector('#pr-' + n + ' details.fb');
      if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); const ta = d.querySelector('textarea'); if (ta) ta.focus(); }
      return;
    }
    if (e.target.closest('[data-home-search]')) {
      e.preventDefault();
      homeSearch(document.getElementById('hs')?.value || '');
      return;
    }
    if (e.target.closest('[data-search-btn]')) {
      e.preventDefault();
      doSearch(document.getElementById('gs')?.value || '', true);
      return;
    }
    if (e.target.closest('[data-search-clear]')) {
      e.preventDefault();
      state.query = '';
      go(state.idx.current, true);
      return;
    }
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

  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'gs' && e.key === 'Enter') {
      e.preventDefault();
      doSearch(e.target.value, true);
    }
    if (e.target && e.target.id === 'hs' && e.key === 'Enter') {
      e.preventDefault();
      homeSearch(e.target.value);
    }
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
    const p = new URLSearchParams(location.search);
    if (p.get('hl')) { doHighlights(false); return; }
    if (p.get('pr')) { doSearch(p.get('pr'), false); return; }
    if (p.get('author')) { doSearch(p.get('author'), false); return; }
    if (p.get('e')) { go(p.get('e'), false); return; }
    renderHome();
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
        fetch('data/db/feedback.json?ts=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) state.feedback = j.entries || {}; }).catch(() => {}),
        fetch('data/db/lessons.json?ts=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) state.lessons = j.lessons || []; }).catch(() => {}),
        fetch('data/db/highlights.json?ts=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) state.highlights = j.items || []; }).catch(() => {}),
        fetch('data/db/marks.json?ts=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null)).then((j) => {
            if (!j) return;
            state.marks = j.marks || {};
            const before = (state.pendingMarks || []).length;
            state.pendingMarks = (state.pendingMarks || []).filter((x) => !state.marks[String(x.pr)]);
            if (state.pendingMarks.length !== before) {
              try { localStorage.setItem('board-pending-marks', JSON.stringify(state.pendingMarks)); } catch (e) { /* ignore */ }
            }
          }).catch(() => {}),
      ]);
      if (params.get('hl')) { await doHighlights(false); }
      else if (params.get('pr')) { await doSearch(params.get('pr'), false); }
      else if (params.get('author')) { await doSearch(params.get('author'), false); }
      else if (params.get('e')) {
        const want = params.get('e');
        const id = state.editions.some((e) => e.id === want) ? want : state.idx.current || state.editions[0].id;
        await go(id, false);
      } else {
        renderHome();
      }
      idlePrefetch();
    } catch (e) {
      app().innerHTML = '<div style="padding:40px;max-width:720px;margin:0 auto"><h1 style="font-size:18px">看板数据加载失败</h1>' +
        '<p class="muted">' + esc(e.message || String(e)) + '</p><p class="muted">数据在 <a href="data/index.json">data/index.json</a>。</p></div>';
    }
  })();
})();
