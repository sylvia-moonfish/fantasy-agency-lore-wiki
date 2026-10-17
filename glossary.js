// Glossary tab, rename-everywhere dialog, and naming-guide editing. Loaded after app.js (uses its globals).
// On the published site (STATIC) the glossary is read-only.

Object.assign(state, {
  gSearch: '',
  gCulture: '',
  gKind: '',
  gStatus: '',
  gEdit: null,      // entry name being edited, or '' for a new entry
  guideEdit: null,  // { name, isNew }
});

const glossary = () => state.data.glossary || [];
const entry = (name) => glossary().find((e) => e.name === name);
const vocab = () => state.data.vocab || { kinds: [], statuses: [], origins: [] };
const glossaryChip = (name) => `<a class="chip" href="#/glossary/${encodeURIComponent(name)}">${esc(name)}</a>`;

function cultureOptions() {
  const fromGuides = (state.data.guides || []).map((g) => g.name).filter((n) => !n.startsWith('_'));
  return [...new Set([...fromGuides, '한국어', ...glossary().map((e) => e.culture)])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
}

function statusPill(s) {
  const cls = s === '확정' ? 'processed' : s === '추정' ? 'answered' : 'muted';
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}

// ---------- glossary tab ----------

function renderGlossary(route) {
  const all = glossary();
  const selected = route.id ? entry(route.id) : null;
  // Leave the editor when navigating to a different entry (or to any entry while the "new" form is open).
  if (state.gEdit === '' ? !!route.id : state.gEdit !== null && state.gEdit !== route.id) state.gEdit = null;

  const q = state.gSearch.trim().toLowerCase();
  const list = all.filter((e) =>
    (!state.gCulture || e.culture === state.gCulture) &&
    (!state.gKind || e.kind === state.gKind) &&
    (!state.gStatus || e.origin_status === state.gStatus) &&
    (!q || [e.name, e.original, e.etymology, e.note, e.page, ...e.variants].some((f) => f.toLowerCase().includes(q))));

  const select = (id, label, options, value) =>
    `<select id="${id}" class="filter"><option value="">${label}</option>${options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;

  view.innerHTML = `
  <div class="glossary-layout">
    <section>
      <div class="filter-bar">
        <input type="search" id="g-search" placeholder="Search ${all.length} names and terms…" value="${esc(state.gSearch)}">
        ${select('g-culture', 'All cultures', cultureOptions(), state.gCulture)}
        ${select('g-kind', 'All kinds', vocab().kinds, state.gKind)}
        ${STATIC ? '' : select('g-status', 'Any origin', vocab().statuses, state.gStatus)}
        ${STATIC ? '' : '<button class="btn small primary" data-action="g-new">+ New entry</button>'}
      </div>
      <div class="card table-card">
        <table class="glossary-table">
          <thead><tr><th>Name</th><th>Original</th><th>Kind</th><th>Culture</th>${STATIC ? '' : '<th>Origin</th>'}</tr></thead>
          <tbody>
            ${list.map((e) => `
              <tr class="${selected && selected.name === e.name ? 'active' : ''}" data-href="#/glossary/${encodeURIComponent(e.name)}">
                <td><a href="#/glossary/${encodeURIComponent(e.name)}">${esc(e.name)}</a></td>
                <td class="orig">${esc(e.original)}</td>
                <td>${esc(e.kind)}</td>
                <td>${esc(e.culture)}</td>
                ${STATIC ? '' : `<td>${statusPill(e.origin_status)}</td>`}
              </tr>`).join('') || `<tr><td colspan="5" class="hint">No matches.</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="hint">${list.length} of ${all.length} shown.</p>
    </section>
    <aside id="g-detail">${renderGlossaryDetail(selected)}</aside>
  </div>`;

  $('#g-search').addEventListener('input', (e) => { state.gSearch = e.target.value; rerenderGlossaryList(); });
  for (const [id, key] of [['g-culture', 'gCulture'], ['g-kind', 'gKind'], ['g-status', 'gStatus']]) {
    $('#' + id)?.addEventListener('change', (e) => { state[key] = e.target.value; render(); });
  }
  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  }));
  // On narrow screens the details sit above the list; bring them into view after picking an entry.
  if (selected && window.matchMedia('(max-width: 900px)').matches) $('#g-detail').scrollIntoView({ block: 'start' });
}

// Re-render while keeping focus in the search box.
function rerenderGlossaryList() {
  const pos = $('#g-search').selectionStart;
  render();
  const input = $('#g-search');
  input.focus();
  input.setSelectionRange(pos, pos);
}

function renderGlossaryDetail(e) {
  if (!STATIC && state.gEdit !== null) return renderEntryForm(state.gEdit === '' ? null : e);
  if (!e) {
    return `<div class="card card-pad hint g-placeholder">Select a name to see its details.${STATIC ? '' : ' Editing a name or its original spelling updates every place it appears in the wiki, after you review the changes.'}</div>`;
  }
  const row = (label, value) => value ? `<div class="g-row"><div class="label">${label}</div><div>${value}</div></div>` : '';
  const showEtym = !STATIC || e.origin_status === '확정';
  return `
  <div class="card card-pad g-card">
    <div class="row between"><h2>${esc(e.name)}</h2>${STATIC ? '' : `<button class="btn small" data-action="g-edit" data-name="${esc(e.name)}">Edit</button>`}</div>
    ${e.original ? `<div class="orig big">${esc(e.original)}</div>` : ''}
    <div class="row" style="margin:8px 0 14px">${e.kind ? `<span class="pill pending">${esc(e.kind)}</span>` : ''}${e.culture ? `<span class="hint">${esc(e.culture)}</span>` : ''}${STATIC ? '' : statusPill(e.origin_status)}</div>
    ${showEtym ? row('Origin', e.etymology ? Markdown.inline(e.etymology, { resolve }) : '<span class="hint">—</span>') : ''}
    ${row('Page', e.page ? wikiChip(e.page) : '')}
    ${row('Variants', e.variants.map(esc).join(', '))}
    ${STATIC ? '' : row('Note', esc(e.note))}
    ${!STATIC && e.culture && (state.data.guides || []).some((g) => g.name === e.culture) ? row('Guide', `<a class="chip" href="#/names/guide/${encodeURIComponent(e.culture)}">${esc(e.culture)}</a>`) : ''}
  </div>`;
}

function renderEntryForm(e) {
  const isNew = !e;
  e = e || { name: '', original: '', kind: '', culture: '', etymology: '', origin_status: '없음', page: '', variants: [], note: '' };
  const opts = (list, value, blank) => `${blank !== undefined ? `<option value="">${blank}</option>` : ''}${list.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}`;
  return `
  <form class="card card-pad g-card g-form" id="g-form" onsubmit="return false">
    <h2>${isNew ? 'New entry' : 'Edit entry'}</h2>
    <label>Name<input type="text" name="name" value="${esc(e.name)}" required></label>
    <label>Original spelling<input type="text" name="original" value="${esc(e.original)}" placeholder="e.g. Saltibena, or several separated by commas"></label>
    <div class="form-row">
      <label>Kind<select name="kind">${opts(vocab().kinds, e.kind, '—')}</select></label>
      <label>Culture<select name="culture">${opts(cultureOptions(), e.culture, '—')}</select></label>
      <label>Origin<select name="origin_status">${opts(vocab().statuses, e.origin_status)}</select></label>
    </div>
    <label>Etymology<textarea name="etymology" rows="3">${esc(e.etymology)}</textarea></label>
    <label>Page<input type="text" name="page" list="g-pages" value="${esc(e.page)}"></label>
    <datalist id="g-pages">${state.data.wiki.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <label>Variants <span class="hint">(comma-separated)</span><input type="text" name="variants" value="${esc(e.variants.join(', '))}"></label>
    <label>Note<textarea name="note" rows="2">${esc(e.note)}</textarea></label>
    ${isNew ? '' : '<p class="hint">Changing the name or original spelling opens a preview of every place it appears, so the wiki and guides stay in sync.</p>'}
    <div class="row">
      <button class="btn small primary" data-action="g-save" data-name="${esc(isNew ? '' : e.name)}">Save</button>
      <button class="btn small" data-action="g-cancel">Cancel</button>
      ${isNew ? '' : `<button class="btn small danger" data-action="g-delete" data-name="${esc(e.name)}" style="margin-left:auto">Delete</button>`}
    </div>
  </form>`;
}

function readEntryForm() {
  const f = $('#g-form');
  const v = (n) => f.querySelector(`[name="${n}"]`).value.trim();
  return {
    name: v('name'), original: v('original'), kind: v('kind'), culture: v('culture'),
    origin_status: v('origin_status'), etymology: v('etymology'), page: v('page'),
    variants: v('variants').split(',').map((s) => s.trim()).filter(Boolean), note: v('note'),
  };
}

async function saveEntry(oldName) {
  const e = readEntryForm();
  if (!e.name) return toast('The entry needs a name');
  if (!oldName) {
    await call('POST', '/api/glossary', { entry: e });
    state.gEdit = null;
    location.hash = '#/glossary/' + encodeURIComponent(e.name);
    await refresh();
    return toast('Added to the glossary');
  }
  const old = entry(oldName);
  // Save everything except name/original changes first; those go through the rename preview.
  const renames = [];
  const keepOriginal = old.original && e.original !== old.original;
  await call('PUT', `/api/glossary/${encodeURIComponent(oldName)}`, { entry: { ...e, name: oldName, original: keepOriginal ? old.original : e.original } });
  if (e.name !== oldName) renames.push([oldName, e.name]);
  if (keepOriginal) {
    if (e.original) renames.push([old.original, e.original]);
    else toast('To remove an original spelling, also remove it from the wiki pages');
  }
  state.gEdit = null;
  await refresh();
  if (!renames.length) return toast('Saved');
  runRenames(renames, '#/glossary/' + encodeURIComponent(e.name));
}

async function runRenames(queue, afterHash) {
  if (!queue.length) {
    if (afterHash) location.hash = afterHash;
    return;
  }
  const [[from, to], ...rest] = queue;
  openRename(from, to, () => runRenames(rest, afterHash));
}

// ---------- rename dialog ----------

async function openRename(from, to, onDone) {
  let preview;
  try { preview = await call('POST', '/api/rename', { from, to }); }
  catch (err) { return toast(err.message); }
  const dlg = $('#rename-dialog');
  const groups = new Map();
  for (const o of preview.occurrences) {
    if (!groups.has(o.file)) groups.set(o.file, []);
    groups.get(o.file).push(o);
  }
  const embeddedCount = preview.occurrences.filter((o) => o.embedded).length;
  dlg.innerHTML = `
    <form method="dialog" class="dialog-body">
      <div class="dialog-head"><h2>Rename everywhere</h2><button class="icon-btn" value="close" aria-label="Close">✕</button></div>
      <p><b class="orig">${esc(from)}</b> → <b class="orig">${esc(to)}</b></p>
      <p class="hint">${preview.occurrences.length} place${preview.occurrences.length === 1 ? '' : 's'} in the wiki, glossary and naming guides. Brainstorms, questions and naming requests are records and stay as they were.
        ${embeddedCount ? ` ${embeddedCount} look like part of a longer word and are unticked — check them.` : ''}</p>
      ${preview.conflicts.length ? `<div class="callout" data-kind="질문"><div class="callout-title">Can't rename</div>${preview.conflicts.map((c) => `<div>${esc(c)}</div>`).join('')}</div>` : ''}
      ${preview.pageRenames.length ? `<h3 class="section-title">Page files</h3><div class="pick-list">${preview.pageRenames.map((r, i) => `
        <label><input type="checkbox" name="page" value="${i}" ${r.checked ? 'checked' : ''} ${r.required ? 'disabled' : ''}>
        <span>${esc(r.from)} → ${esc(r.to)}${r.required ? ' <span class="hint">(this page)</span>' : ''}</span></label>`).join('')}</div>` : ''}
      <h3 class="section-title" style="margin-top:14px">Text</h3>
      <div class="rename-list">
        ${[...groups.entries()].map(([file, list]) => `
          <div class="rename-file"><div class="rename-file-name">${esc(file)} <span class="hint">${list.length}</span></div>
          ${list.map((o) => `
            <label class="rename-row ${o.embedded ? 'embedded' : ''}">
              <input type="checkbox" name="occ" value="${esc(o.id)}" ${o.checked ? 'checked' : ''} ${o.locked ? 'disabled' : ''}>
              <span class="ctx">${esc(o.before)}<mark>${esc(o.match)}</mark>${esc(o.after)}</span>
            </label>`).join('')}</div>`).join('') || '<p class="hint">No text matches.</p>'}
      </div>
      <div class="row between" style="margin-top:14px">
        <span class="hint" id="rename-count"></span>
        <div class="row"><button class="btn" value="close">Cancel</button><button type="button" class="btn primary" id="rename-apply" ${preview.conflicts.length ? 'disabled' : ''}>Apply</button></div>
      </div>
    </form>`;
  const count = () => { $('#rename-count').textContent = `${dlg.querySelectorAll('input[name=occ]:checked').length} of ${preview.occurrences.length} selected`; };
  dlg.querySelectorAll('input[name=occ]').forEach((c) => c.addEventListener('change', count));
  count();
  $('#rename-apply').addEventListener('click', async () => {
    const selected = [...dlg.querySelectorAll('input[name=occ]:checked')].map((c) => c.value);
    const pageRenames = preview.pageRenames.map((r, i) => ({ ...r, checked: r.required || !!dlg.querySelector(`input[name=page][value="${i}"]`)?.checked }));
    try {
      const res = await call('POST', '/api/rename/apply', { from, to, selected, pageRenames, versions: preview.versions });
      dlg.close();
      await refresh();
      toast(`Replaced ${res.replaced} in ${res.files} file${res.files === 1 ? '' : 's'}${res.renamedPages.length ? `, renamed ${res.renamedPages.length} page${res.renamedPages.length === 1 ? '' : 's'}` : ''}`);
      onDone && onDone();
    } catch (err) { toast(err.message); }
  });
  dlg.showModal();
}

// ---------- naming guides ----------

function guideTemplate(name) {
  return `---\nculture: ${name}\ncovers: []\nupdated: ${today()}\n---\n# ${name} 작명 가이드\n\n## 원천 언어와 모티브\n\n## 조어 패턴\n\n## 한국어 표기 관습\n\n## 어감\n\n## 미정 항목\n\n## 거절된 이름\n(아직 없음)\n\n## 작명 교훈\n(아직 없음)\n`;
}

// Read-only guide view with its glossary names and open questions, or the editor.
function renderGuidePanel(guide, isNew) {
  if (state.guideEdit) {
    const raw = isNew ? guideTemplate(state.guideEdit.name) : guide.raw;
    return `
    <article class="card page editor">
      <div class="row between" style="margin-bottom:12px">
        <h2 style="margin:0">${isNew ? 'New guide' : 'Editing guide'}: ${esc(state.guideEdit.name)}</h2>
        <div class="row">
          ${isNew ? '' : `<button class="btn small danger" data-action="guide-delete" data-name="${esc(guide.name)}">Delete</button>`}
          <button class="btn small" data-action="guide-cancel">Cancel</button>
          <button class="btn small primary" data-action="guide-save">Save</button>
        </div>
      </div>
      <textarea id="guide-raw" class="code">${esc(raw)}</textarea>
      <p class="hint">Keep the headings <code>## 거절된 이름</code> and <code>## 작명 교훈</code>; naming sessions read them. Names themselves belong in the glossary.</p>
    </article>`;
  }
  const names = glossary().filter((e) => e.culture === guide.name);
  const qs = (state.data.questions || []).filter((q) => q.status !== 'resolved' && q.guides.includes(guide.name));
  return `
  <article class="card page">
    <div class="row between" style="margin-bottom:8px">
      <a href="#/names">← Requests</a>
      <div class="row"><span class="hint">Updated ${esc(guide.updated || '—')}</span><button class="btn small" data-action="guide-edit" data-name="${esc(guide.name)}">Edit</button></div>
    </div>
    ${qs.length ? `<div class="callout" data-kind="질문"><div class="callout-title">Open questions about this guide</div>${qs.map((q) => `<div><a href="#/questions">${esc(q.id)}</a> — ${esc(snippet(q.question, 100))}</div>`).join('')}</div>` : ''}
    <div class="md">${md(guide.body)}</div>
    ${names.length ? `
      <h2 class="section-title" style="margin-top:28px">Names in the glossary · ${names.length}</h2>
      <div class="table-wrap"><table class="glossary-table compact">
        <thead><tr><th>Name</th><th>Original</th><th>Kind</th><th>Origin</th></tr></thead>
        <tbody>${names.map((e) => `<tr><td><a href="#/glossary/${encodeURIComponent(e.name)}">${esc(e.name)}</a></td><td class="orig">${esc(e.original)}</td><td>${esc(e.kind)}</td><td>${statusPill(e.origin_status)} <span class="hint">${esc(snippet(e.etymology, 60))}</span></td></tr>`).join('')}</tbody>
      </table></div>` : ''}
  </article>`;
}

async function saveGuide() {
  const { name, isNew } = state.guideEdit;
  await call('PUT', `/api/guides/${encodeURIComponent(name)}`, { content: $('#guide-raw').value, create: isNew });
  state.guideEdit = null;
  location.hash = '#/names/guide/' + encodeURIComponent(name);
  await refresh();
  toast('Guide saved');
}

// ---------- events ----------

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !el.dataset.action.startsWith('g') || el.tagName === 'TEXTAREA') return;
  const { action, name } = el.dataset;
  try {
    switch (action) {
      case 'g-new': state.gEdit = ''; location.hash = '#/glossary'; return render();
      case 'g-edit': state.gEdit = name; return render();
      case 'g-cancel': state.gEdit = null; return render();
      case 'g-save': return saveEntry(name);
      case 'g-delete':
        if (!confirm(`Remove “${name}” from the glossary? Wiki pages are not changed.`)) return;
        await call('DELETE', `/api/glossary/${encodeURIComponent(name)}`);
        state.gEdit = null; location.hash = '#/glossary'; await refresh(); return toast('Removed from the glossary');
      case 'guide-edit': state.guideEdit = { name, isNew: false }; return render();
      case 'guide-new': {
        const n = prompt('Culture name for the new guide (e.g. 필로니아)');
        if (!n || !n.trim()) return;
        state.guideEdit = { name: n.trim(), isNew: true };
        location.hash = '#/names/guide/' + encodeURIComponent(n.trim());
        return render();
      }
      case 'guide-cancel': state.guideEdit = null; return render();
      case 'guide-save': return saveGuide();
      case 'guide-delete':
        if (!confirm(`Delete the ${name} guide? (It is moved to .trash, not erased.)`)) return;
        await call('DELETE', `/api/guides/${encodeURIComponent(name)}`);
        state.guideEdit = null; location.hash = '#/names'; await refresh(); return toast('Guide deleted');
    }
  } catch (err) { toast(err.message); }
});
