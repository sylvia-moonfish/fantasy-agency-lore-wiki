// Lore Desk front end. Plain JS, hash routing: #/brainstorms[/ID], #/wiki[/Page[/anchor]], #/questions, #/log
// The published site (tool/build-site.js) sets window.LORE_STATIC and window.LORE_DATA: read-only wiki only.
const STATIC = !!window.LORE_STATIC;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => Markdown.escape(String(s ?? ''));
const view = $('#view');

const state = {
  data: null,
  lookup: new Map(),
  bsFilter: 'pending',
  qFilter: 'open',
  openBs: null,        // expanded brainstorm id
  editingBs: null,     // brainstorm id being edited
  wikiEdit: null,      // { name, isNew }
  search: '',
  sidebarScroll: 0,
  collapsedCats: new Set(),
  qOrigin: '',
  nFilter: 'pending',
  openReq: null,       // expanded naming request id
  editingReq: null,    // naming request id being edited
  pendingRender: false,
};

const isEditing = () => !!(state.wikiEdit || state.editingBs || state.editingReq || state.guideEdit || state.gEdit != null || state.uEdit);

const LARGE_BRAINSTORM = 15000; // characters

// ---------- utilities ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function store(key, value) { try { localStorage.setItem(key, value); } catch {} }
function recall(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }

function resolve(name) { return state.lookup.get(String(name).toLowerCase()) || null; }
function md(src, opts = {}) { return Markdown.render(src, { resolve, idLinks: !STATIC, ...opts }); }
function page(name) { return state.data.wiki.find((p) => p.name === name); }
function today() { const d = new Date(); return d.toISOString().slice(0, 10); }

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const tab = STATIC ? (parts[0] === 'glossary' ? 'glossary' : 'wiki') : parts[0] || 'brainstorms';
  return { tab, id: parts[1] || null, anchor: parts[2] || null };
}

function snippet(text, n = 80) {
  const s = text.replace(/^#+\s*/gm, '').replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function wikiChip(name) {
  const r = resolve(name);
  return `<a class="chip" href="#/wiki/${encodeURIComponent(r || name)}">${esc(name)}</a>`;
}
const bsChip = (id) => `<a class="chip" href="#/brainstorms/${encodeURIComponent(id)}">${esc(id)}</a>`;

// ---------- data ----------

async function load() {
  state.data = STATIC
    ? { brainstorms: [], questions: [], naming: [], guides: [], glossary: [], changelog: '', commits: [], ...window.LORE_DATA }
    : await call('GET', '/api/state');
  state.lookup = new Map(Object.entries(state.data.lookup));
  if (STATIC) return;
  const pending = state.data.brainstorms.filter((b) => b.status === 'pending').length;
  const openQ = state.data.questions.filter((q) => q.status === 'open').length;
  $('#badge-pending').textContent = pending || '';
  $('#badge-questions').textContent = openQ || '';
  $('#badge-undecided').textContent = state.data.undecided.filter((u) => u.status === 'open').length || '';
  $('#badge-names').textContent = state.data.naming.filter((r) => r.status === 'pending').length || '';
  $('#count-pages').textContent = state.data.wiki.length || '';
  $('#count-glossary').textContent = state.data.glossary.length || '';
  $('#badge-checks').textContent = state.data.checks.errors.length || '';
}

function isTyping() {
  const a = document.activeElement;
  return a && view.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
}

async function refresh(fromWatcher) {
  await load();
  if (fromWatcher && (isTyping() || isEditing())) {
    state.pendingRender = true;
    return;
  }
  render();
}

// ---------- rendering ----------

function render() {
  if (!state.data) return;
  state.pendingRender = false;
  const route = parseRoute();
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === route.tab));
  if (route.tab === 'wiki') renderWiki(route);
  else if (route.tab === 'questions') renderQuestions(route);
  else if (route.tab === 'undecided') renderUndecided(route);
  else if (route.tab === 'names') renderNames(route);
  else if (route.tab === 'glossary') renderGlossary(route);
  else if (route.tab === 'log') renderLog();
  else renderBrainstorms(route);
}

// ----- brainstorms -----

function renderBrainstorms(route) {
  const { brainstorms, questions } = state.data;
  if (route.id) {
    state.openBs = route.id;
    const b = brainstorms.find((x) => x.id === route.id);
    if (b && state.bsFilter !== 'all' && b.status !== state.bsFilter) state.bsFilter = 'all';
  }
  const counts = {
    pending: brainstorms.filter((b) => b.status === 'pending').length,
    processed: brainstorms.filter((b) => b.status === 'processed').length,
    all: brainstorms.length,
  };
  const openQ = questions.filter((q) => q.status === 'open').length;
  const answeredQ = questions.filter((q) => q.status === 'answered').length;
  const list = brainstorms.filter((b) => state.bsFilter === 'all' || b.status === state.bsFilter).slice().reverse();

  view.innerHTML = `
  <div class="split">
    <div class="stack">
      <section class="card card-pad composer">
        <h2 class="section-title">New brainstorm</h2>
        <textarea id="composer" placeholder="Write anything: a character idea, a place, a piece of history, a half-formed what-if… Rough is fine.">${esc(recall('composer-draft'))}</textarea>
        <div class="row between" style="margin-top:10px">
          <span class="hint">Ctrl+Enter to add. Game-mechanics notes are kept but deferred for now.</span>
          <button class="btn primary" data-action="add-bs">Add brainstorm</button>
        </div>
      </section>
      <section class="card card-pad">
        <h2 class="section-title">Pipeline</h2>
        <div class="pipeline">
          <div><b>${counts.pending}</b>pending</div>
          <div><b>${answeredQ}</b>answers to apply</div>
          <div><b>${openQ}</b>open questions</div>
        </div>
        <p class="hint" style="margin:12px 0">When you're ready, generate a prompt and paste it into a Claude Code session opened on this folder. Claude reads the related wiki pages, absorbs the ideas, and rewrites the wiki — this page updates live while it works.</p>
        <button class="btn primary" data-action="open-prompt">Generate ingest prompt</button>
        <button class="btn" data-action="session-prompt" style="margin-left:6px" title="Develop an idea in conversation with Claude; it writes the brainstorm for you">Brainstorm with Claude</button>
        ${openQ ? `<a class="btn" href="#/questions" style="margin-left:6px">Answer ${openQ} question${openQ > 1 ? 's' : ''}</a>` : ''}
      </section>
    </div>
    <section>
      <div class="chips">
        ${['pending', 'processed', 'all'].map((f) => `<button class="chip ${state.bsFilter === f ? 'active' : ''}" data-action="bs-filter" data-filter="${f}">${f[0].toUpperCase() + f.slice(1)} · ${counts[f]}</button>`).join('')}
      </div>
      <div class="bs-list">
        ${list.length ? list.map(renderBsItem).join('') : `<div class="card empty">${state.bsFilter === 'pending' ? 'Nothing pending. Add a brainstorm on the left.' : 'No brainstorms here yet.'}</div>`}
      </div>
    </section>
  </div>`;

  const ta = $('#composer');
  ta.addEventListener('input', () => store('composer-draft', ta.value));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addBrainstorm(); } });
  if (route.id) $(`[data-bs="${CSS.escape(route.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function renderBsItem(b) {
  const open = state.openBs === b.id;
  const head = `
    <div class="bs-meta">
      <span class="bs-id">${esc(b.id)}</span>
      <span>${esc(b.created)}</span>
      <span class="pill ${b.status}">${b.status}</span>
      ${b.resolves.length ? `<span>resolves ${b.resolves.map(undecidedChip).join(' ')}</span>` : ''}
      ${b.source ? `<span class="origin-tag" title="Handed off from another project">from ${esc(b.source)}</span>` : ''}
      ${b.deferred ? '<span class="pill deferred" title="Contains game-mechanics ideas that were not added to the wiki yet">mechanics deferred</span>' : ''}
      ${b.text.length > LARGE_BRAINSTORM ? `<span>${Math.round(b.text.length / 1000)}k chars</span>` : ''}
    </div>`;
  if (!open) {
    return `<article class="card bs-item" data-bs="${esc(b.id)}" data-action="toggle-bs" data-id="${esc(b.id)}">${head}<div class="bs-snippet">${esc(b.text.slice(0, 600))}</div></article>`;
  }
  const editing = state.editingBs === b.id;
  return `
  <article class="card bs-item selected" data-bs="${esc(b.id)}">
    <div class="row between" data-action="toggle-bs" data-id="${esc(b.id)}" style="cursor:pointer">${head}<span class="hint">▲</span></div>
    ${b.note ? `<p class="hint">${esc(b.note)}</p>` : ''}
    ${editing
      ? `<textarea id="bs-edit" style="min-height:240px">${esc(b.text)}</textarea>
         <div class="row" style="margin-top:8px"><button class="btn primary small" data-action="save-bs" data-id="${esc(b.id)}">Save</button><button class="btn small" data-action="cancel-bs">Cancel</button></div>`
      : `<div class="raw-text">${esc(b.text)}</div>`}
    ${b.status === 'processed' ? `
      <div style="margin-top:14px">
        <div class="hint">Processed ${esc(b.processed)}</div>
        ${b.pages.length ? `<div class="chips" style="margin:8px 0">${b.pages.map(wikiChip).join('')}</div>` : ''}
        ${b.report ? `<div class="md" style="font-size:14px">${md(b.report)}</div>` : ''}
      </div>` : ''}
    ${!editing ? `<div class="row" style="margin-top:12px">
      ${b.status === 'pending'
        ? `<button class="btn small" data-action="edit-bs" data-id="${esc(b.id)}">Edit</button><button class="btn small danger" data-action="delete-bs" data-id="${esc(b.id)}">Delete</button>`
        : `<button class="btn small" data-action="requeue-bs" data-id="${esc(b.id)}" title="Mark as pending so the next ingest reads it again">Process again</button>`}
    </div>` : ''}
  </article>`;
}

async function addBrainstorm() {
  const ta = $('#composer');
  const text = ta.value.trim();
  if (!text) return toast('Write something first');
  const { id } = await call('POST', '/api/brainstorms', { text });
  ta.value = '';
  store('composer-draft', '');
  state.bsFilter = 'pending';
  await refresh();
  toast(`Added ${id}`);
  $('#composer')?.focus();
}

// ----- wiki -----

function renderWiki(route) {
  const pages = state.data.wiki;
  if (state.wikiEdit && state.wikiEdit.name !== route.id && !(state.wikiEdit.isNew && !route.id)) state.wikiEdit = null;
  const oldSidebar = $('.sidebar');
  if (oldSidebar) state.sidebarScroll = oldSidebar.scrollTop;

  view.innerHTML = `
  <div class="wiki-layout">
    <aside class="card sidebar">
      <input type="search" id="wiki-search" placeholder="Search ${pages.length} pages…" value="${esc(state.search)}">
      <div id="sidebar-list"></div>
      ${STATIC ? '' : '<button class="btn small" data-action="new-page" style="margin-top:10px;width:100%;justify-content:center">+ New page</button>'}
    </aside>
    <section id="wiki-main"></section>
  </div>`;
  renderSidebar(route.id);
  const sidebar = $('.sidebar');
  sidebar.scrollTop = state.sidebarScroll;
  sidebar.addEventListener('scroll', () => { state.sidebarScroll = sidebar.scrollTop; });
  sidebar.addEventListener('toggle', (e) => {
    const cat = e.target.dataset.cat;
    if (cat === undefined) return;
    if (e.target.open) state.collapsedCats.delete(cat); else state.collapsedCats.add(cat);
  }, true);
  $('#wiki-search').addEventListener('input', (e) => { state.search = e.target.value; renderSidebar(route.id); });

  const main = $('#wiki-main');
  if (state.wikiEdit) return renderEditor(main);
  if (!route.id) return renderWikiHome(main);
  const p = page(route.id) || page(resolve(route.id));
  if (!p && STATIC) {
    main.innerHTML = `<div class="card page empty"><h2>“${esc(route.id)}” hasn't been written yet</h2><p><a href="#/wiki">Back to the wiki</a></p></div>`;
    return;
  }
  if (!p) {
    main.innerHTML = `<div class="card page empty">
      <h2>“${esc(route.id)}” has no page yet</h2>
      <p>Pages linking here: ${pages.filter((x) => x.brokenLinks.includes(route.id)).map((x) => wikiChip(x.name)).join(' ') || 'none'}</p>
      <button class="btn primary" data-action="create-page" data-name="${esc(route.id)}">Create it</button>
    </div>`;
    return;
  }
  const qs = state.data.questions.filter((q) => q.status !== 'resolved' && q.pages.includes(p.name));
  main.innerHTML = `
  <article class="card page">
    <header class="page-head">
      <div class="row between">
        <h1>${esc(p.name)}</h1>
        ${STATIC ? '' : `<button class="btn small" data-action="edit-page" data-name="${esc(p.name)}">Edit</button>`}
      </div>
      <div class="row">
        <span class="pill pending">${esc(p.category)}</span>
        ${p.aliases.length ? `<span class="hint">also: ${p.aliases.map(esc).join(', ')}</span>` : ''}
      </div>
      ${p.summary ? `<p class="summary">${Markdown.inline(p.summary, { resolve })}</p>` : ''}
    </header>
    ${qs.length ? `<div class="callout" data-kind="질문"><div class="callout-title">Open questions about this page</div>${qs.map((q) => `<div><a href="#/questions">${esc(q.id)}</a> — ${esc(snippet(q.question, 120))}</div>`).join('')}</div>` : ''}
    <div class="md">${md(p.body, { skipTitle: p.name })}</div>
    <footer class="page-foot">
      ${STATIC ? '' : `<div><span class="label">Sources</span>${p.sources.length ? `<span class="chips" style="display:inline-flex">${p.sources.map(bsChip).join('')}</span>` : '<span class="hint">none (written by hand)</span>'}</div>`}
      ${(() => { const g = (state.data.glossary || []).filter((x) => x.page === p.name); return g.length ? `<div><span class="label">Glossary</span><span class="chips" style="display:inline-flex">${g.map((x) => glossaryChip(x.name)).join('')}</span></div>` : ''; })()}
      <div><span class="label">Linked from</span>${p.backlinks.length ? `<span class="chips" style="display:inline-flex">${p.backlinks.map(wikiChip).join('')}</span>` : '<span class="hint">no pages yet</span>'}</div>
      <div class="hint">Updated ${esc(p.updated || '—')}${STATIC ? '' : ` · <code>${esc(p.file)}</code>`}</div>
    </footer>
  </article>`;
  if (route.anchor) document.getElementById(route.anchor)?.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}

function renderSidebar(current) {
  const q = state.search.trim().toLowerCase();
  const box = $('#sidebar-list');
  let pages = state.data.wiki;
  if (q) {
    const hits = [];
    for (const p of pages) {
      const inName = p.name.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q));
      const idx = p.body.toLowerCase().indexOf(q);
      if (inName || idx >= 0 || p.summary.toLowerCase().includes(q)) hits.push({ p, inName, idx });
    }
    hits.sort((a, b) => (b.inName - a.inName) || a.p.name.localeCompare(b.p.name, 'ko'));
    box.innerHTML = hits.length ? `<div class="cat"><ul>${hits.map(({ p, idx }) => `<li><a href="#/wiki/${encodeURIComponent(p.name)}" class="${p.name === current ? 'active' : ''}">${esc(p.name)}</a>${idx >= 0 ? `<span class="search-hit">…${esc(p.body.slice(Math.max(0, idx - 20), idx + 40).replace(/\s+/g, ' '))}…</span>` : ''}</li>`).join('')}</ul></div>` : '<p class="hint">No matches.</p>';
    return;
  }
  const groups = new Map();
  for (const p of pages) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p);
  }
  const cats = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  box.innerHTML = cats.length ? cats.map((c) => `
    <details class="cat" data-cat="${esc(c)}" ${state.collapsedCats.has(c) ? '' : 'open'}>
      <summary><span>${esc(c)}</span><span>${groups.get(c).length}</span></summary>
      <ul>${groups.get(c).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((p) => `<li><a href="#/wiki/${encodeURIComponent(p.name)}" class="${p.name === current ? 'active' : ''}">${esc(p.name)}</a></li>`).join('')}</ul>
    </details>`).join('') : '<p class="hint">No pages yet.</p>';
}

function renderWikiHome(main) {
  const pages = state.data.wiki;
  if (!pages.length && STATIC) {
    main.innerHTML = '<div class="card page empty"><h2>No pages yet</h2></div>';
    return;
  }
  if (!pages.length) {
    main.innerHTML = `<div class="card page empty">
      <h2>The wiki is empty</h2>
      <p>Add brainstorms, then use <b>Generate prompt</b> and paste it into Claude Code.<br>The first run imports your existing world document (B0001).</p>
      <button class="btn primary" data-action="open-prompt">Generate prompt</button>
    </div>`;
    return;
  }
  // `updated` first: the published site is built from a fresh checkout, where file times are meaningless.
  const recent = pages.slice().sort((a, b) => String(b.updated).localeCompare(String(a.updated)) || b.mtime - a.mtime).slice(0, 8);
  const groups = new Map();
  for (const p of pages) { if (!groups.has(p.category)) groups.set(p.category, []); groups.get(p.category).push(p); }
  const broken = STATIC ? 0 : pages.reduce((n, p) => n + new Set(p.brokenLinks).size, 0);
  main.innerHTML = `
  <div class="card page">
    <header class="page-head"><h1>${esc(STATIC ? state.data.title : 'Wiki')}</h1><p class="summary">${pages.length} pages in ${groups.size} categories${broken ? ` · ${broken} links to pages that don't exist yet` : ''}</p></header>
    <h2 class="section-title">Recently changed</h2>
    <div class="chips" style="margin-bottom:24px">${recent.map((p) => wikiChip(p.name)).join('')}</div>
    <h2 class="section-title">Categories</h2>
    <div class="home-grid">
      ${[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')).map(([c, ps]) => `
        <div class="card"><h3>${esc(c)} <span class="hint">${ps.length}</span></h3>
        <div class="hint">${ps.slice(0, 8).map((p) => `<a href="#/wiki/${encodeURIComponent(p.name)}">${esc(p.name)}</a>`).join(' · ')}${ps.length > 8 ? ' …' : ''}</div></div>`).join('')}
    </div>
  </div>`;
}

function newPageTemplate(name) {
  return `---\ncategory: \naliases: []\nsummary: \nsources: []\nupdated: ${today()}\n---\n# ${name}\n\n`;
}

function renderEditor(main) {
  const { name, isNew } = state.wikiEdit;
  const p = isNew ? null : page(name);
  const content = isNew ? newPageTemplate(name || '') : p.raw;
  main.innerHTML = `
  <div class="card page editor">
    <div class="row between" style="margin-bottom:12px">
      <h2 style="margin:0">${isNew ? 'New page' : 'Editing'}</h2>
      <div class="row">
        ${!isNew ? `<button class="btn small danger" data-action="delete-page" data-name="${esc(name)}">Delete</button>` : ''}
        <button class="btn small" data-action="cancel-edit">Cancel</button>
        <button class="btn small primary" data-action="save-page">Save</button>
      </div>
    </div>
    <label class="hint">Page name (file name)${isNew ? '' : ' · changing it shows every place the old name appears before renaming'}</label>
    <input type="text" id="page-name" value="${esc(name || '')}" style="margin:4px 0 12px">
    <textarea id="page-raw" class="code">${esc(content)}</textarea>
    <p class="hint">Markdown. Link pages with [[Page name]] or [[Page name|label]]. Mark undecided ideas with a “&gt; [!미정]” callout, and a hidden truth behind the record with “&gt; [!진상]”.</p>
  </div>`;
  $('#page-raw').addEventListener('keydown', (e) => { if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); savePage(); } });
}

async function savePage() {
  const { name, isNew } = state.wikiEdit;
  const newName = $('#page-name').value.trim();
  const content = $('#page-raw').value;
  if (!newName) return toast('Page needs a name');
  if (isNew && page(newName)) return toast('A page with that name already exists');
  await call('PUT', `/api/wiki/${encodeURIComponent(isNew ? newName : name)}`, { content });
  state.wikiEdit = null;
  // A new name goes through the rename preview, so links, the glossary and the guides follow.
  const renamed = !isNew && newName !== name;
  location.hash = '#/wiki/' + encodeURIComponent(renamed ? name : newName);
  await refresh();
  if (renamed) return openRename(name, newName, () => { location.hash = '#/wiki/' + encodeURIComponent(newName); });
  toast(isNew ? 'Page created and added to the glossary' : 'Saved');
}

// ----- naming -----

const NAME_KINDS = ['인물', '지명', '조직·단체', '물건·유물', '종족·생물', '기타'];

function namingDraft() {
  try { return JSON.parse(recall('naming-draft') || '{}'); } catch { return {}; }
}

function renderNames(route) {
  const { naming, guides, wiki } = state.data;
  if (route.id && route.id !== 'guide') {
    state.openReq = route.id;
    const r = naming.find((x) => x.id === route.id);
    if (r && state.nFilter !== 'all' && r.status !== state.nFilter) state.nFilter = 'all';
  }
  const counts = { pending: 0, decided: 0, dropped: 0, all: naming.length };
  naming.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const list = naming.filter((r) => state.nFilter === 'all' || r.status === state.nFilter).slice().reverse();
  const d = namingDraft();
  const cultures = [...new Set([
    ...guides.map((g) => g.name),
    ...wiki.filter((p) => ['국가', '종족', '지역'].includes(p.category)).map((p) => p.name),
  ])].sort((a, b) => a.localeCompare(b, 'ko'));
  const guide = route.id === 'guide' ? guides.find((g) => g.name === route.anchor) : null;

  view.innerHTML = `
  <div class="split">
    <div class="stack">
      <section class="card card-pad" id="naming-form">
        <h2 class="section-title">New naming request</h2>
        <div class="stack">
          <input type="text" name="target" placeholder="What are you naming? (e.g. 노에라 촌장, 알테리온 고원의 새 마을)" value="${esc(d.target)}">
          <div class="form-row">
            <select name="kind">${NAME_KINDS.map((k) => `<option ${d.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
            <input type="text" name="culture" list="culture-options" placeholder="Culture / region (e.g. 필로니아)" value="${esc(d.culture)}">
            <label class="hint count-field">Candidates <input type="number" name="count" min="1" max="20" value="${esc(d.count || 5)}"></label>
          </div>
          <datalist id="culture-options">${cultures.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
          <textarea name="details" rows="3" placeholder="What is it? Its role, who it belongs to, anything already decided about it.">${esc(d.details)}</textarea>
          <textarea name="meaning" rows="2" placeholder="Meaning or feel you want (e.g. ‘bright, open’, ‘sounds old and heavy’)">${esc(d.meaning)}</textarea>
          <textarea name="constraints" rows="2" placeholder="Constraints or notes (optional): length, sounds to avoid, names you already dislike…">${esc(d.constraints)}</textarea>
        </div>
        <div class="row between" style="margin-top:10px">
          <span class="hint">Then start a naming session in Claude Code and decide the name in conversation.</span>
          <button class="btn primary" data-action="add-req">Add request</button>
        </div>
      </section>
      <section class="card card-pad">
        <div class="row between"><h2 class="section-title" style="margin:0">Naming guides</h2><button class="btn small" data-action="guide-new">+ New guide</button></div>
        <div style="margin-top:10px">
        ${guides.length
          ? `<div class="chips">${guides.map((g) => `<a class="chip ${guide && guide.name === g.name ? 'active' : ''}" href="#/names/guide/${encodeURIComponent(g.name)}">${esc(g.name)}</a>`).join('')}</div>`
          : '<p class="hint" style="margin:0">None yet. Claude builds a culture’s guide from the wiki the first time a request needs it.</p>'}
        </div>
      </section>
    </div>
    <section>
      ${guide || (state.guideEdit && state.guideEdit.isNew) ? renderGuidePanel(guide, !guide) : `
        <div class="chips">
          ${['pending', 'decided', 'dropped', 'all'].map((f) => `<button class="chip ${state.nFilter === f ? 'active' : ''}" data-action="n-filter" data-filter="${f}">${f[0].toUpperCase() + f.slice(1)} · ${counts[f] || 0}</button>`).join('')}
        </div>
        <div class="bs-list">
          ${list.length ? list.map(renderReqItem).join('') : `<div class="card empty">${state.nFilter === 'pending' ? 'No open naming requests.' : 'Nothing here yet.'}</div>`}
        </div>`}
    </section>
  </div>`;

  const form = $('#naming-form');
  form.addEventListener('input', () => {
    const data = {};
    form.querySelectorAll('[name]').forEach((el) => { data[el.name] = el.value; });
    store('naming-draft', JSON.stringify(data));
  });
  if (route.id && route.id !== 'guide') $(`[data-bs="${CSS.escape(route.id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function renderReqItem(r) {
  const open = state.openReq === r.id;
  const head = `
    <div class="bs-meta">
      <span class="bs-id">${esc(r.id)}</span>
      <span>${esc(r.created)}</span>
      <span class="pill ${r.status === 'decided' ? 'processed' : r.status === 'dropped' ? 'answered' : 'pending'}">${r.status}</span>
      ${r.kind ? `<span>${esc(r.kind)}</span>` : ''}${r.culture ? `<span>· ${esc(r.culture)}</span>` : ''}${r.item ? `<span>for ${undecidedChip(r.item)}</span>` : ''}
    </div>
    <div><b>${esc(r.target)}</b>${r.decided ? ` → <span class="decided-name">${esc(r.decided)}</span>` : ''}</div>`;
  if (!open) return `<article class="card bs-item" data-bs="${esc(r.id)}" data-action="toggle-req" data-id="${esc(r.id)}">${head}</article>`;
  const editing = state.editingReq === r.id;
  return `
  <article class="card bs-item selected" data-bs="${esc(r.id)}">
    <div class="row between" data-action="toggle-req" data-id="${esc(r.id)}" style="cursor:pointer"><div>${head}</div><span class="hint">▲</span></div>
    ${editing
      ? `<textarea id="req-edit" class="code" style="min-height:220px;margin-top:10px">${esc(r.request)}</textarea>
         <div class="row" style="margin-top:8px"><button class="btn primary small" data-action="save-req" data-id="${esc(r.id)}">Save</button><button class="btn small" data-action="cancel-req">Cancel</button></div>`
      : `<div class="md req-body">${md(r.request)}</div>`}
    ${r.result ? `<div class="md req-result">${md(r.result)}</div>` : ''}
    ${r.brainstorm ? `<div class="row" style="margin-top:10px"><span class="hint">Brainstorm</span>${bsChip(r.brainstorm)}</div>` : ''}
    ${!editing ? `<div class="row" style="margin-top:12px">
      ${r.status === 'pending' ? `
        <button class="btn primary small" data-action="name-prompt" data-id="${esc(r.id)}">Start naming session</button>
        <button class="btn small" data-action="edit-req" data-id="${esc(r.id)}">Edit</button>
        <button class="btn small" data-action="drop-req" data-id="${esc(r.id)}" title="Keep the record but close it">Drop</button>
        <button class="btn small danger" data-action="delete-req" data-id="${esc(r.id)}">Delete</button>` : ''}
      ${r.status === 'dropped' ? `
        <button class="btn small" data-action="reopen-req" data-id="${esc(r.id)}">Reopen</button>
        <button class="btn small danger" data-action="delete-req" data-id="${esc(r.id)}">Delete</button>` : ''}
    </div>` : ''}
  </article>`;
}

async function addNamingRequest() {
  const form = $('#naming-form');
  const data = {};
  form.querySelectorAll('[name]').forEach((el) => { data[el.name] = el.value; });
  if (!data.target.trim()) return toast('Say what you are naming');
  const { id } = await call('POST', '/api/naming', data);
  store('naming-draft', '');
  state.nFilter = 'pending';
  state.openReq = id;
  await refresh();
  toast(`Added ${id}`);
}

function openNamingPrompt(id) {
  const r = state.data.naming.find((x) => x.id === id);
  const text = [
    `Let's name something for the world. Naming request: ${r.id} (${r.target}).`,
    '',
    'First read CLAUDE.md and .claude/commands/name.md, then follow the naming procedure in name.md.',
    'Present your candidates and recommendation here in the chat. Don\'t write anything to files until I confirm the final name; then record the decision and create the brainstorm as name.md describes.',
  ].join('\n');
  showPrompt(`Paste this into a Claude Code session opened on this folder, then talk it through until you've picked a name. When you confirm, Claude records the decision here and creates a brainstorm for the next ingest. Typing <code>/name ${esc(r.id)}</code> does the same.`, text);
}

// ----- questions -----

const ORIGIN_LABELS = { ingest: 'Lore ingest', guide: 'Naming guide', naming: 'Naming session', check: 'Coherence check' };

function renderQuestions(route = {}) {
  const all = state.data.questions;
  if (route.id) {
    const q = all.find((x) => x.id === route.id);
    if (q && state.qFilter !== 'all' && q.status !== state.qFilter) state.qFilter = 'all';
    if (q && state.qOrigin && q.origin !== state.qOrigin) state.qOrigin = '';
  }
  const qs = all.filter((q) => !state.qOrigin || q.origin === state.qOrigin);
  const counts = { open: 0, answered: 0, resolved: 0, all: qs.length };
  qs.forEach((q) => { counts[q.status] = (counts[q.status] || 0) + 1; });
  const list = qs.filter((q) => state.qFilter === 'all' || q.status === state.qFilter).slice().reverse();
  const originCount = (o) => all.filter((q) => q.origin === o && q.status !== 'resolved').length;
  view.innerHTML = `
  <div style="max-width:860px;margin:0 auto">
    <p class="hint">Claude asks here when something conflicts or is unclear in the wiki, the glossary or a naming guide, and leaves it unchanged until you answer. Save your answer; the next ingest applies it everywhere it matters.</p>
    <div class="chips" style="margin:12px 0 8px">
      ${['open', 'answered', 'resolved', 'all'].map((f) => `<button class="chip ${state.qFilter === f ? 'active' : ''}" data-action="q-filter" data-filter="${f}">${f[0].toUpperCase() + f.slice(1)} · ${counts[f] || 0}</button>`).join('')}
    </div>
    <div class="chips" style="margin:0 0 16px">
      <button class="chip ${!state.qOrigin ? 'active' : ''}" data-action="q-origin" data-filter="">All origins</button>
      ${Object.entries(ORIGIN_LABELS).map(([o, label]) => `<button class="chip ${state.qOrigin === o ? 'active' : ''}" data-action="q-origin" data-filter="${o}">${label} · ${originCount(o)}</button>`).join('')}
    </div>
    <div class="stack">
      ${list.length ? list.map((q) => `
        <article class="card q-card" data-q="${esc(q.id)}">
          <div class="bs-meta"><span class="bs-id">${esc(q.id)}</span><span class="pill ${q.status}">${q.status}</span><span class="origin-tag">${esc(ORIGIN_LABELS[q.origin] || q.origin)}</span><span>${esc(q.created)}</span>
            ${q.pages.map(wikiChip).join('')}${q.guides.map((g) => `<a class="chip guide-chip" href="#/names/guide/${encodeURIComponent(g)}">가이드: ${esc(g)}</a>`).join('')}${q.sources.map(bsChip).join('')}</div>
          <div class="md">${md(q.question)}</div>
          ${q.status === 'resolved'
            ? `${q.answer ? `<div class="hint" style="margin-top:8px">Your answer</div><div class="md">${md(q.answer)}</div>` : ''}<div class="q-resolution md">${md(q.resolution)}</div>`
            : `<textarea id="answer-${esc(q.id)}" placeholder="Your answer (e.g. “Keep the old version”, “The new idea replaces it”, or a new explanation)">${esc(q.answer)}</textarea>
               <div class="row" style="margin-top:8px"><button class="btn small primary" data-action="save-answer" data-id="${esc(q.id)}">${q.status === 'answered' ? 'Update answer' : 'Save answer'}</button>
               <button class="btn small" data-action="question-prompt" data-id="${esc(q.id)}" title="Decide it in conversation with Claude; it saves the agreed answer here">Talk it through with Claude</button>
               ${q.status === 'answered' ? '<span class="hint">Will be applied on the next ingest.</span>' : ''}</div>`}
        </article>`).join('') : '<div class="card empty">No questions here.</div>'}
    </div>
  </div>`;
  if (route.id) {
    const card = $(`[data-q="${CSS.escape(route.id)}"]`);
    if (card) { card.classList.add('selected'); card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
}

// ----- log -----

function renderLog() {
  const { changelog, commits, checks } = state.data;
  const s = checks.summary;
  view.innerHTML = `
  <section class="card card-pad" style="margin-bottom:24px">
    <div class="row between">
      <h2 class="section-title" style="margin:0">Coherence check</h2>
      <span class="hint">${s.pages} pages · ${s.glossary} glossary entries (${s.guesses} guessed origins) · ${s.guides} guides</span>
    </div>
    ${checks.errors.length
      ? `<p><b class="err">${checks.errors.length} problem${checks.errors.length === 1 ? '' : 's'}</b> between the wiki, glossary and guides. The next ingest fixes these, or you can fix them by hand.</p><ul class="check-list err">${checks.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '<p class="ok-line">The wiki, glossary and naming guides are in sync.</p>'}
    ${checks.warnings.length ? `<details><summary class="hint">${checks.warnings.length} warning${checks.warnings.length === 1 ? '' : 's'}</summary><ul class="check-list">${checks.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
  </section>
  <div class="split">
    <section class="card page"><h2 class="section-title">Changelog</h2>
      ${changelog.trim() ? `<div class="md">${md(changelog.replace(/^#\s+.*\n/, ''))}</div>` : '<p class="hint">Nothing yet. Every ingest run adds an entry here.</p>'}
    </section>
    <section class="card card-pad"><h2 class="section-title">Snapshots (git)</h2>
      ${commits.length ? `<ul class="commits">${commits.map((c) => `<li><code>${esc(c.hash)}</code><span class="date">${esc(c.date)}</span><span>${esc(c.subject)}</span></li>`).join('')}</ul>
      <p class="hint" style="margin-top:12px">To undo an ingest run, ask Claude Code: “revert the last ingest commit”.</p>` : '<p class="hint">No commits yet. The first ingest run creates a snapshot before and after it edits the wiki.</p>'}
    </section>
  </div>`;
}

// ---------- prompt dialogs ----------

function showPrompt(intro, text) {
  $('#prompt-content').innerHTML = `
    <p class="hint" style="margin-top:12px">${intro}</p>
    <pre class="prompt-preview" id="prompt-text">${esc(text)}</pre>
    <div class="row between" style="margin-top:12px">
      <span class="hint">Folder: <code>${esc(state.data.root)}</code></span>
      <button type="button" class="btn primary" id="copy-prompt">Copy prompt</button>
    </div>`;
  $('#copy-prompt').addEventListener('click', copyPrompt);
  $('#prompt-dialog').showModal();
}

function openSessionPrompt() {
  showPrompt(
    'Paste this into a Claude Code session opened on this folder (or type <code>/brainstorm</code>), then describe the idea you want to develop. Claude asks questions and suggests directions using what the wiki, glossary and naming guides already say. When you are happy, it writes the brainstorm here, ready for the next ingest.',
    [
      "Let's develop an idea for the world together.",
      '',
      'First read CLAUDE.md and .claude/commands/brainstorm.md, then follow that procedure.',
      'Talk it through with me here; only write the brainstorm after I confirm the summary.',
    ].join('\n'),
  );
}

function openPrompt() {
  const pending = state.data.brainstorms.filter((b) => b.status === 'pending');
  const answered = state.data.questions.filter((q) => q.status === 'answered');
  const answeredU = state.data.undecided.filter((u) => u.status === 'answered');
  const box = $('#prompt-content');
  {
    const problems = state.data.checks.errors.length;
    box.innerHTML = `
      ${!pending.length && !answered.length && !answeredU.length ? `<p class="hint" style="margin-top:12px">No pending brainstorms or answered questions. The ingest will still review your direct edits since the last ingest and bring the wiki, glossary and naming guides back in sync${problems ? ` (${problems} coherence problem${problems === 1 ? '' : 's'} right now)` : ''}.</p>` : ''}
      ${pending.length ? `<h3 class="section-title" style="margin-top:16px">Brainstorms</h3>
      <div class="pick-list">${pending.map((b) => `<label><input type="checkbox" name="bs" value="${esc(b.id)}" checked><b class="bs-id">${esc(b.id)}</b><span class="snip">${esc(snippet(b.text))}</span></label>`).join('')}</div>` : ''}
      ${answered.length ? `<h3 class="section-title" style="margin-top:16px">Answered questions</h3>
      <div class="pick-list">${answered.map((q) => `<label><input type="checkbox" name="q" value="${esc(q.id)}" checked><b class="bs-id">${esc(q.id)}</b><span class="snip">${esc(snippet(q.question))}</span></label>`).join('')}</div>` : ''}
      ${answeredU.length ? `<h3 class="section-title" style="margin-top:16px">Answered undecided items</h3>
      <div class="pick-list">${answeredU.map((u) => `<label><input type="checkbox" name="u" value="${esc(u.id)}" checked><b class="bs-id">${esc(u.id)}</b><span class="snip">${esc(u.title)}</span></label>`).join('')}</div>` : ''}
      <h3 class="section-title" style="margin-top:16px">Extra instructions (optional)</h3>
      <textarea id="prompt-note" rows="2" placeholder="e.g. “Focus on the Ériu culture pages”">${esc(recall('prompt-note'))}</textarea>
      <h3 class="section-title" style="margin-top:16px">Prompt</h3>
      <pre class="prompt-preview" id="prompt-text"></pre>
      <div class="row between" style="margin-top:12px">
        <ol class="steps">
          <li>Open this folder in Claude Code: <code>${esc(state.data.root)}</code></li>
          <li>Paste the prompt. Accept-edits mode saves you from approving every file.</li>
        </ol>
        <button type="button" class="btn primary" id="copy-prompt">Copy prompt</button>
      </div>`;
    const update = () => { $('#prompt-text').textContent = buildPrompt(); };
    box.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', update));
    $('#prompt-note').addEventListener('input', (e) => { store('prompt-note', e.target.value); update(); });
    $('#copy-prompt').addEventListener('click', copyPrompt);
    update();
  }
  $('#prompt-dialog').showModal();
}

function buildPrompt() {
  const box = $('#prompt-content');
  const bs = [...box.querySelectorAll('input[name=bs]:checked')].map((c) => c.value);
  const qs = [...box.querySelectorAll('input[name=q]:checked')].map((c) => c.value);
  const us = [...box.querySelectorAll('input[name=u]:checked')].map((c) => c.value);
  const note = ($('#prompt-note')?.value || '').trim();
  const large = bs.map((id) => state.data.brainstorms.find((b) => b.id === id)).filter((b) => b && b.text.length > LARGE_BRAINSTORM);
  const lines = [
    'Run an ingest: bring my new input into the wiki, the glossary and the naming guides, and leave all three in sync.',
    '',
    'First read CLAUDE.md and .claude/commands/ingest.md, then follow the ingest procedure in ingest.md exactly.',
    'Remember: absorb the knowledge in each brainstorm and rewrite the relevant pages so they reflect it. Do not paste my brainstorm sentences into the wiki.',
    'Also review my direct edits to the wiki, glossary and guides since the last ingest, as ingest.md describes.',
    '',
    `Brainstorms to process (oldest first): ${bs.length ? bs.join(', ') : 'none'}`,
    `Answered questions to apply: ${qs.length ? qs.join(', ') : 'none'}`,
    `Answered undecided items to apply: ${us.length ? us.join(', ') : 'none'}`,
  ];
  if (large.length) lines.push('', `Large brainstorm${large.length > 1 ? 's' : ''}: ${large.map((b) => `${b.id} (~${Math.round(b.text.length / 1000)}k chars)`).join(', ')}. Use the large-brainstorm procedure: build the page plan first and do the coverage check at the end.`);
  if (note) lines.push('', 'Extra instructions from me:', note);
  return lines.join('\n');
}

async function copyPrompt() {
  const text = $('#prompt-text').textContent;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Prompt copied. Paste it into Claude Code.');
}

// ---------- events ----------

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'TEXTAREA') return;
  const { action, id, name, filter } = el.dataset;
  try {
    switch (action) {
      case 'add-bs': return addBrainstorm();
      case 'bs-filter': state.bsFilter = filter; return render();
      case 'q-filter': state.qFilter = filter; return render();
      case 'q-origin': state.qOrigin = filter; return render();
      case 'session-prompt': return openSessionPrompt();
      case 'toggle-bs':
        if (e.target.closest('a')) return;
        state.openBs = state.openBs === id ? null : id;
        state.editingBs = null;
        if (location.hash !== '#/brainstorms') history.replaceState(null, '', '#/brainstorms');
        return render();
      case 'edit-bs': state.editingBs = id; render(); return $('#bs-edit')?.focus();
      case 'cancel-bs': state.editingBs = null; return render();
      case 'save-bs':
        await call('PUT', `/api/brainstorms/${id}`, { text: $('#bs-edit').value });
        state.editingBs = null; await refresh(); return toast('Saved');
      case 'delete-bs':
        if (!confirm(`Delete ${id}? (It is moved to .trash, not erased.)`)) return;
        await call('DELETE', `/api/brainstorms/${id}`); state.openBs = null; await refresh(); return toast(`Deleted ${id}`);
      case 'requeue-bs':
        await call('PUT', `/api/brainstorms/${id}`, { requeue: true }); await refresh(); return toast(`${id} is pending again`);
      case 'open-prompt': return openPrompt();
      case 'new-page': {
        const n = prompt('New page name');
        if (!n) return;
        state.wikiEdit = { name: n.trim(), isNew: true };
        location.hash = '#/wiki/' + encodeURIComponent(n.trim());
        return render();
      }
      case 'create-page': state.wikiEdit = { name, isNew: true }; return render();
      case 'edit-page': state.wikiEdit = { name, isNew: false }; return render();
      case 'cancel-edit': state.wikiEdit = null; return render();
      case 'save-page': return savePage();
      case 'delete-page':
        if (!confirm(`Delete page “${name}”? (It is moved to .trash, not erased.)`)) return;
        await call('DELETE', `/api/wiki/${encodeURIComponent(name)}`);
        state.wikiEdit = null; location.hash = '#/wiki'; await refresh(); return toast('Page deleted');
      case 'add-req': return addNamingRequest();
      case 'n-filter': state.nFilter = filter; return render();
      case 'toggle-req':
        if (e.target.closest('a')) return;
        state.openReq = state.openReq === id ? null : id;
        state.editingReq = null;
        if (location.hash !== '#/names') history.replaceState(null, '', '#/names');
        return render();
      case 'name-prompt': return openNamingPrompt(id);
      case 'edit-req': state.editingReq = id; render(); return $('#req-edit')?.focus();
      case 'cancel-req': state.editingReq = null; return render();
      case 'save-req':
        await call('PUT', `/api/naming/${id}`, { request: $('#req-edit').value });
        state.editingReq = null; await refresh(); return toast('Saved');
      case 'drop-req':
        await call('PUT', `/api/naming/${id}`, { status: 'dropped' }); await refresh(); return toast(`${id} dropped`);
      case 'reopen-req':
        await call('PUT', `/api/naming/${id}`, { status: 'pending' }); await refresh(); return toast(`${id} reopened`);
      case 'delete-req':
        if (!confirm(`Delete ${id}? (It is moved to .trash, not erased.)`)) return;
        await call('DELETE', `/api/naming/${id}`); state.openReq = null; await refresh(); return toast(`Deleted ${id}`);
      case 'question-prompt':
        return showPrompt(`Paste this into a Claude Code session opened on this folder (or type <code>/question ${esc(id)}</code>). Claude reads the question and the pages it touches, and you talk it through. When you confirm the answer, Claude saves it here, ready for the next ingest.`,
          `Let's decide question ${id} together.\n\nFirst read CLAUDE.md and .claude/commands/question.md, then follow that procedure for ${id}.\nTalk it through with me here; only save the answer after I confirm it.`);
      case 'save-answer':
        await call('PUT', `/api/questions/${id}`, { answer: $(`#answer-${CSS.escape(id)}`).value });
        await refresh(); return toast('Answer saved');
    }
  } catch (err) { toast(err.message); }
});

view.addEventListener('focusout', () => {
  setTimeout(() => { if (state.pendingRender && !isTyping() && !isEditing()) render(); }, 150);
});

$('#open-prompt')?.addEventListener('click', openPrompt);
window.addEventListener('hashchange', () => {
  const r = parseRoute();
  if (state.wikiEdit && !(r.tab === 'wiki' && r.id === state.wikiEdit.name)) state.wikiEdit = null;
  if (state.guideEdit && !(r.tab === 'names' && r.id === 'guide' && r.anchor === state.guideEdit.name)) state.guideEdit = null;
  render();
});

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    if (e.data !== 'change') return;
    refresh(true).then(() => {
      if (state.pendingRender && isEditing()) toast('Files changed on disk. The view will refresh when you finish editing.');
    });
  };
}

// Start once every script (glossary.js too) has loaded.
window.addEventListener('DOMContentLoaded', () => {
  refresh().then(() => { if (!STATIC) connectEvents(); }).catch((err) => { view.innerHTML = `<div class="card empty">Could not load data: ${esc(err.message)}</div>`; });
});
