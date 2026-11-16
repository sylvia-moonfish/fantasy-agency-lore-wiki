// Minimal Markdown renderer with [[wikilinks]] and Obsidian-style callouts (> [!미정] ...).
// resolve(name) -> canonical page name or null.
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

  const RE = {
    fence: /^\s*```/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    quote: /^\s*>/,
    listItem: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
  };

  function slug(s) {
    return s.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  }

  function inline(text, ctx) {
    let s = esc(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g, (_, target, anchor, label) => {
      const name = unesc(target.trim());
      const resolved = ctx.resolve ? ctx.resolve(name) : null;
      const shown = label || target + (anchor && !label ? anchor : '');
      const hash = '#/wiki/' + encodeURIComponent(resolved || name) + (anchor ? '/' + encodeURIComponent(slug(unesc(anchor.slice(1)))) : '');
      return `<a class="wl${resolved ? '' : ' missing'}" href="${hash}" title="${esc(resolved || name)}${resolved ? '' : ' (no page yet)'}">${shown}</a>`;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const safe = /^(https?:|#|mailto:)/i.test(unesc(href)) ? href : '#';
      return `<a href="${safe}" target="${safe.startsWith('#') ? '_self' : '_blank'}" rel="noopener">${label}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // In Lore Desk, undecided-item and question IDs link to their task lists.
    if (ctx.idLinks) s = s.replace(/(^|[^\w#/])([UQ]\d{4,})\b/g, (_, pre, id) => `${pre}<a class="id-link" href="#/${id[0] === 'U' ? 'undecided' : 'questions'}/${id}">${id}</a>`);
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
    return s;
  }

  function isBlockStart(line, next) {
    return RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) ||
      RE.listItem.test(line) || (line.includes('|') && next !== undefined && RE.tableSep.test(next));
  }

  function splitRow(line) {
    let l = line.trim();
    if (l.startsWith('|')) l = l.slice(1);
    if (l.endsWith('|')) l = l.slice(0, -1);
    return l.split('|').map((c) => c.trim());
  }

  // Does an item's continuation hold block content (a table, a quote, code, a second paragraph)
  // rather than just wrapped text and nested lists?
  function hasBlocks(ls) {
    return ls.some((l, k) => {
      if (!l.trim()) {
        const next = ls.slice(k + 1).find((x) => x.trim());
        return next !== undefined && !RE.listItem.test(next);
      }
      return RE.fence.test(l) || RE.heading.test(l) || RE.quote.test(l) || (l.includes('|') && k + 1 < ls.length && RE.tableSep.test(ls[k + 1]));
    });
  }

  function renderList(lines, ctx) {
    const base = lines[0].match(RE.listItem)[1].length;
    const ordered = /^\d/.test(lines[0].match(RE.listItem)[2]);
    const items = [];
    for (const l of lines) {
      const m = l.match(RE.listItem);
      // the item's content starts after the marker: "8. text" → column 3
      if (m && m[1].length <= base) items.push({ text: m[3], rest: [], indent: m[1].length + m[2].length + 1 });
      else if (items.length) items[items.length - 1].rest.push(l);
    }
    let out = ordered ? '<ol>' : '<ul>';
    for (const it of items) {
      while (it.rest.length && !it.rest[it.rest.length - 1].trim()) it.rest.pop();
      let inner;
      if (hasBlocks(it.rest)) {
        // Block content: render the item like a small document, its lines shifted back to the item's column.
        const strip = new RegExp(`^ {0,${it.indent}}`);
        inner = render([it.text, ...it.rest.map((l) => l.replace(strip, ''))].join('\n'), ctx);
      } else {
        const rest = it.rest.filter((l) => l.trim());
        const firstSub = rest.findIndex((l) => RE.listItem.test(l));
        const cont = (firstSub < 0 ? rest : rest.slice(0, firstSub)).map((l) => l.trim());
        inner = inline([it.text, ...cont].join(' '), ctx);
        if (firstSub >= 0) inner += renderList(rest.slice(firstSub), ctx);
      }
      out += `<li>${inner}</li>`;
    }
    return out + (ordered ? '</ol>' : '</ul>');
  }

  function render(src, ctx) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) { i++; continue; }

      if (RE.fence.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !RE.fence.test(lines[i])) buf.push(lines[i++]);
        i++;
        html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
        continue;
      }
      if ((m = line.match(RE.heading))) {
        const lvl = m[1].length;
        if (!(ctx.skipTitle && lvl === 1 && m[2].trim() === ctx.skipTitle && !ctx.titleSkipped)) {
          html += `<h${lvl} id="${esc(slug(m[2]))}">${inline(m[2], ctx)}</h${lvl}>`;
        } else ctx.titleSkipped = true;
        i++;
        continue;
      }
      if (RE.hr.test(line)) { html += '<hr>'; i++; continue; }
      if (RE.quote.test(line)) {
        const buf = [];
        while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ''));
        const cm = buf[0].match(/^\[!([^\]]+)\][+-]?\s*(.*)$/);
        if (cm) {
          const kind = cm[1].trim();
          const inner = [cm[2], ...buf.slice(1)].join('\n');
          html += `<div class="callout" data-kind="${esc(kind)}"><div class="callout-title">${esc(kind)}</div>${render(inner, ctx)}</div>`;
        } else html += `<blockquote>${render(buf.join('\n'), ctx)}</blockquote>`;
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        let t = '<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c, ctx)}</th>`).join('') + '</tr></thead><tbody>';
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          t += '<tr>' + splitRow(lines[i]).map((c) => `<td>${inline(c, ctx)}</td>`).join('') + '</tr>';
          i++;
        }
        html += t + '</tbody></table></div>';
        continue;
      }
      if (RE.listItem.test(line)) {
        const buf = [];
        while (i < lines.length) {
          const l = lines[i];
          if (RE.listItem.test(l) || (/^\s+\S/.test(l) && buf.length)) { buf.push(l); i++; continue; }
          if (!l.trim() && i + 1 < lines.length && (RE.listItem.test(lines[i + 1]) || /^\s+\S/.test(lines[i + 1]))) { buf.push(''); i++; continue; }
          break;
        }
        html += renderList(buf, ctx);
        continue;
      }
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) buf.push(lines[i++]);
      html += `<p>${inline(buf.join('\n'), ctx).replace(/\n/g, ' ')}</p>`;
    }
    return html;
  }

  window.Markdown = {
    render: (src, opts = {}) => render(src || '', { ...opts }),
    inline: (src, opts = {}) => inline(src || '', opts),
    slug,
    escape: esc,
  };
})();
