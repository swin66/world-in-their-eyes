// Full-screen Admin Console.
//
// Opened at #admin (see main.js routing), this replaces the old cramped tabbed
// modal. Layout: top bar + grouped sidebar + a content pane that renders each
// section as a stack of consistent "settings cards". A tiny declarative field
// renderer keeps every card visually identical, so adding a new option later is
// a one-line change — that's what keeps the whole thing obvious to set up.
//
// Save model (unchanged): admins write the band config to Supabase; everyone
// else downloads an updated band.json to commit (the free-tier workflow).
import { supabase } from './supabase.js';
import { getRole } from './auth.js';
import { isEventCategory } from './categories.js';
import {
  getPendingApplications, getBandGuides, countBandGuides,
  reviewApplication, revokeBandRole, getProfileNames,
} from './roles.js';

const THEME_KEYS = ['accent', 'accent2', 'bg', 'surface', 'text'];

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const escAttr = (s) =>
  String(s ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const escHtml = (s) =>
  String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

/* ===================== Templated field renderer ===================== */

function controlHTML(def) {
  const v = def.value;
  const a = `data-key="${def.key}"`;
  switch (def.type) {
    case 'textarea':
      return `<textarea ${a} rows="${def.rows || 3}">${escHtml(v)}</textarea>`;
    case 'number':
      return `<input type="number" ${a} value="${escAttr(v)}"${def.min != null ? ` min="${def.min}"` : ''}${def.max != null ? ` max="${def.max}"` : ''}>`;
    case 'color':
      return `<input type="color" ${a} value="${escAttr(v || '#000000')}">`;
    case 'select':
      return `<select ${a}>${def.options.map((o) =>
        `<option value="${escAttr(o.value)}" ${o.value === v ? 'selected' : ''}>${escHtml(o.label)}</option>`).join('')}</select>`;
    case 'image':
      return `<div class="set-image">
        <input type="text" ${a} value="${escAttr(v)}" placeholder="${escAttr(def.placeholder || 'https://… or /data/…')}">
        <img class="set-image-preview" alt="" src="${escAttr(v)}"${v ? '' : ' hidden'} onerror="this.hidden=true">
      </div>`;
    default:
      return `<input type="text" ${a} value="${escAttr(v)}"${def.placeholder ? ` placeholder="${escAttr(def.placeholder)}"` : ''}>`;
  }
}

function collectFields(scope) {
  const out = {};
  for (const node of scope.querySelectorAll('[data-key]')) {
    const k = node.dataset.key;
    if (node.type === 'checkbox') out[k] = node.checked;
    else if (node.type === 'number') out[k] = node.value === '' ? null : Number(node.value);
    else out[k] = node.value;
  }
  return out;
}

// Build a settings card element from a declarative field list.
function settingsCard({ title, help, fields, saveLabel = 'Save', extraActions = '', onSave }) {
  const card = el('section', 'set-card');
  card.innerHTML = `
    <header class="set-card-head">
      <h3>${escHtml(title)}</h3>
      ${help ? `<p>${help}</p>` : ''}
    </header>
    <div class="set-grid">
      ${fields.map((f) => `
        <div class="set-field set-field--${f.type} ${f.wide ? 'set-field--wide' : ''}">
          <label>${escHtml(f.label)}${f.hint ? `<span class="set-hint">${escHtml(f.hint)}</span>` : ''}</label>
          ${controlHTML(f)}
        </div>`).join('')}
    </div>
    <div class="set-card-actions">${extraActions}
      <button class="btn btn-primary" data-save>${escHtml(saveLabel)}</button>
    </div>`;
  // Live image previews
  for (const inp of card.querySelectorAll('.set-field--image input[type="text"]')) {
    inp.addEventListener('input', () => {
      const img = inp.parentElement.querySelector('.set-image-preview');
      if (inp.value) { img.src = inp.value; img.hidden = false; } else { img.hidden = true; }
    });
  }
  card.querySelector('[data-save]').addEventListener('click', () => onSave(collectFields(card), card));
  return card;
}

/* ===================== Persistence ===================== */

async function saveBand(ctx, msg = 'Saved ✓') {
  const { state, role, helpers } = ctx;
  ctx.setStatus('saving');
  if (supabase && role === 'admin') {
    const { error } = await supabase.from('bands').update({ config: state.band }).eq('slug', state.band.slug);
    if (error) { ctx.setStatus('error'); helpers.toast(`Save failed: ${error.message}`); return false; }
    ctx.setStatus('saved'); helpers.toast(msg); return true;
  }
  download('band.json', state.band);
  ctx.setStatus('saved');
  helpers.toast('band.json downloaded — replace it in public/data/bands/' + state.band.slug + '/ and deploy');
  return true;
}

/* ===================== Section: Overview ===================== */

function renderOverview(pane, ctx) {
  const { state, helpers } = ctx;
  const band = state.band;

  // Guide-tailored overview: focus on their own tours.
  if (ctx.access === 'guide') {
    const uid = ctx.user?.id;
    const mine = state.trips.filter((t) => uid && t.author_id === uid);
    const published = mine.filter((t) => t.published).length;
    const paid = mine.filter((t) => (t.price_cents || 0) > 0).length;
    pane.innerHTML = `
      <div class="set-card">
        <header class="set-card-head"><h3>Welcome, tour guide 🎫</h3>
          <p>Craft guided tours of ${escHtml(band.name)}'s world — expert routes and insider stories.</p></header>
        <div class="ov-stats">
          <div class="ov-stat"><strong>${mine.length}</strong><span>Your tours</span></div>
          <div class="ov-stat"><strong>${published}</strong><span>Published</span></div>
          <div class="ov-stat"><strong>${paid}</strong><span>Priced</span></div>
        </div>
        <div class="set-card-actions"><button class="btn btn-primary" data-go="trips">＋ Build a tour</button></div>
      </div>`;
    pane.querySelector('[data-go]').addEventListener('click', () => ctx.go('trips'));
    return;
  }

  const all = state.places.features;
  const places = all.filter((f) => !isEventCategory(f.properties.category));
  const events = all.filter((f) => isEventCategory(f.properties.category));
  const stats = [
    { n: places.length, label: 'Places', go: 'places' },
    { n: events.length, label: 'Events', go: 'events' },
    { n: state.trips.length, label: 'Trips', go: 'trips' },
    { n: Object.keys(band.categories).length, label: 'Categories', go: 'categories' },
    { n: '—', label: 'Tour guides', id: 'ov-guides', go: 'guides' },
    { n: '—', label: 'Pending reviews', id: 'ov-pending', go: 'moderate' },
  ];
  const checks = [
    { ok: !!band.coverImage, label: 'Cover image set', go: 'identity' },
    { ok: !!band.backgroundImage, label: 'Globe backdrop photo set', go: 'identity' },
    { ok: !!(band.audience && Object.keys(band.audience).length), label: 'Audience map data', go: 'audience' },
    { ok: places.length > 0, label: 'Places on the map', go: 'places' },
    { ok: state.trips.length > 0, label: 'At least one guided trip', go: 'trips' },
  ];
  pane.innerHTML = `
    <div class="set-card">
      <header class="set-card-head"><h3>${escHtml(band.name)}</h3>
        <p>Everything that shapes this atlas lives here. Pick a section on the left.</p></header>
      <div class="ov-stats">
        ${stats.map((s) => `<button class="ov-stat" ${s.go ? `data-go="${s.go}"` : ''}><strong ${s.id ? `id="${s.id}"` : ''}>${s.n}</strong><span>${s.label}</span></button>`).join('')}
      </div>
    </div>
    <div class="set-card">
      <header class="set-card-head"><h3>Setup checklist</h3>
        <p>A few things make the atlas feel complete. Tap any item to jump there.</p></header>
      <div class="ov-checks">
        ${checks.map((c) => `
          <button class="ov-check ${c.ok ? 'ov-check--ok' : ''}" data-go="${c.go}">
            <span class="ov-check-mark">${c.ok ? '✓' : '○'}</span>${escHtml(c.label)}
            <span class="ov-check-go">›</span>
          </button>`).join('')}
      </div>
    </div>`;
  for (const b of pane.querySelectorAll('[data-go]')) {
    b.addEventListener('click', () => ctx.go(b.dataset.go));
  }
  if (supabase) {
    supabase.from('memories').select('id', { count: 'exact', head: true }).eq('approved', false)
      .then(({ count }) => { const n = pane.querySelector('#ov-pending'); if (n) n.textContent = count ?? 0; });
    countBandGuides(band.slug).then((c) => { const n = pane.querySelector('#ov-guides'); if (n) n.textContent = c; });
  } else {
    const p = pane.querySelector('#ov-pending'); if (p) p.textContent = '0';
    const g = pane.querySelector('#ov-guides'); if (g) g.textContent = '0';
  }
}

/* ===================== Section: Identity & look ===================== */

function renderIdentity(pane, ctx) {
  const { state, helpers, role } = ctx;
  const band = state.band;

  const identity = settingsCard({
    title: 'Identity',
    help: 'The headline, story and imagery fans see first.',
    fields: [
      { key: 'appTitle', label: 'Atlas title', type: 'text', value: band.appTitle, hint: 'big heading, e.g. “World in Their Eyes”' },
      { key: 'name', label: 'Band name', type: 'text', value: band.name },
      { key: 'tagline', label: 'Tagline', type: 'text', value: band.tagline, wide: true },
      { key: 'description', label: 'Description', type: 'textarea', value: band.description, wide: true },
      { key: 'coverImage', label: 'Cover image', type: 'image', value: band.coverImage, hint: 'shown on the band selector', wide: true },
      { key: 'backgroundImage', label: 'Globe backdrop (B&W photo)', type: 'image', value: band.backgroundImage, hint: 'sits behind the globe', wide: true },
      { key: 'yearStart', label: 'Timeline start year', type: 'number', value: band.yearStart },
      { key: 'yearEnd', label: 'Timeline end year', type: 'number', value: band.yearEnd },
    ],
    saveLabel: 'Save identity',
    onSave: async (v) => {
      Object.assign(band, v);
      helpers.refreshHeader?.();
      await saveBand(ctx, 'Identity saved ✓');
    },
  });
  pane.appendChild(identity);

  // Theme card — reuses the proven dark/light colour logic.
  const themeWrap = el('section', 'set-card');
  themeWrap.innerHTML = `
    <header class="set-card-head"><h3>Theme &amp; colours</h3>
      <p>Colours apply per mode. Preview updates the app live; Save keeps it.</p></header>
    <div class="theme-grid">
      <span></span><span class="theme-col-head">Dark</span><span class="theme-col-head">Light</span>
      ${THEME_KEYS.map((k) => `
        <span>${k}</span>
        <input type="color" data-mode="dark" data-key="${k}" value="${band.themes.dark[k]}">
        <input type="color" data-mode="light" data-key="${k}" value="${band.themes.light[k]}">
      `).join('')}
    </div>
    <div class="set-field"><label>Default mode</label>
      <select id="th-default">
        <option value="dark" ${band.defaultMode === 'dark' ? 'selected' : ''}>Dark</option>
        <option value="light" ${band.defaultMode === 'light' ? 'selected' : ''}>Light</option>
      </select></div>
    <div class="set-field set-field--wide"><label>Dark map style URL</label>
      <input type="text" id="th-map-dark" value="${escAttr(band.themes.dark.mapStyle)}"></div>
    <div class="set-field set-field--wide"><label>Light map style URL</label>
      <input type="text" id="th-map-light" value="${escAttr(band.themes.light.mapStyle)}"></div>
    <div class="set-card-actions">
      <button class="btn" data-preview>Preview</button>
      <button class="btn btn-primary" data-save>Save theme</button>
    </div>`;
  const collectTheme = () => {
    for (const input of themeWrap.querySelectorAll('input[type="color"]')) {
      band.themes[input.dataset.mode][input.dataset.key] = input.value;
    }
    band.defaultMode = themeWrap.querySelector('#th-default').value;
    band.themes.dark.mapStyle = themeWrap.querySelector('#th-map-dark').value.trim();
    band.themes.light.mapStyle = themeWrap.querySelector('#th-map-light').value.trim();
  };
  themeWrap.querySelector('[data-preview]').addEventListener('click', () => {
    collectTheme(); helpers.setMode(state.mode); helpers.toast('Previewing — Save to keep it');
  });
  themeWrap.querySelector('[data-save]').addEventListener('click', async () => {
    collectTheme(); helpers.setMode(state.mode); await saveBand(ctx, 'Theme saved ✓');
  });
  pane.appendChild(themeWrap);
}

/* ===================== Section: Categories ===================== */

function renderCategories(pane, ctx) {
  const { state, helpers } = ctx;
  const band = state.band;
  let rows = Object.entries(band.categories).map(([id, c]) => ({ id, label: c.label, color: c.color, icon: c.icon }));

  const card = el('section', 'set-card');
  const draw = () => {
    card.innerHTML = `
      <header class="set-card-head"><h3>Categories</h3>
        <p>The place types fans filter by — label, colour and a short symbol. Changes apply to the map instantly.</p></header>
      <div class="cat-rows">
        <div class="cat-row cat-row--head"><span>ID</span><span>Label</span><span>Colour</span><span>Icon</span><span></span></div>
        ${rows.map((r, i) => `
          <div class="cat-row" data-i="${i}">
            <input class="cat-id" type="text" value="${escAttr(r.id)}" placeholder="id">
            <input class="cat-label" type="text" value="${escAttr(r.label)}" placeholder="Label">
            <input class="cat-color" type="color" value="${escAttr(r.color || '#888888')}">
            <input class="cat-icon" type="text" value="${escAttr(r.icon)}" maxlength="2" placeholder="●">
            <button class="btn-mini" data-del="${i}" title="Remove">✕</button>
          </div>`).join('')}
      </div>
      <div class="set-card-actions">
        <button class="btn" data-add>＋ Add category</button>
        <button class="btn btn-primary" data-save>Save categories</button>
      </div>`;
    card.querySelector('[data-add]').addEventListener('click', () => {
      collect(); rows.push({ id: '', label: '', color: '#8a7bd8', icon: '●' }); draw();
    });
    for (const b of card.querySelectorAll('[data-del]')) {
      b.addEventListener('click', () => { collect(); rows.splice(Number(b.dataset.del), 1); draw(); });
    }
    card.querySelector('[data-save]').addEventListener('click', async () => {
      collect();
      const next = {};
      for (const r of rows) {
        const id = r.id.trim();
        if (!id) continue;
        next[id] = { label: r.label.trim() || id, color: r.color, icon: r.icon.trim() || '●' };
      }
      if (!Object.keys(next).length) { helpers.toast('Keep at least one category'); return; }
      band.categories = next;
      helpers.rebuildFilters?.();
      helpers.refreshData?.();
      await saveBand(ctx, 'Categories saved ✓');
    });
  };
  const collect = () => {
    rows = [...card.querySelectorAll('.cat-row[data-i]')].map((row) => ({
      id: row.querySelector('.cat-id').value,
      label: row.querySelector('.cat-label').value,
      color: row.querySelector('.cat-color').value,
      icon: row.querySelector('.cat-icon').value,
    }));
  };
  draw();
  pane.appendChild(card);
}

/* ===================== Sections: Places & Events ===================== */

// Places and events share one feature collection (state.places.features); the
// category decides which table a row belongs to (see categories.js). This single
// manager backs both admin sections — `events` flips the filter and save target.
function makeFeatureManager({ kind, title, blurb, fileName }) {
  const isEvent = kind === 'event';
  return function renderFeatureManager(pane, ctx) {
    const { state, role } = ctx;
    const { toast, refreshData } = ctx.helpers;
    const all = state.places.features;
    const inSection = (f) => isEventCategory(f.properties.category) === isEvent;
    const mine = () => all.filter(inSection);
    let editing = null;

    const card = el('section', 'set-card');
    card.innerHTML = `
      <header class="set-card-head"><h3>${escHtml(title)}</h3><p>${escHtml(blurb)}</p></header>
      <div class="admin-row">
        <input type="text" id="fm-search" placeholder="Search ${mine().length} ${kind}s…">
        <button class="btn" id="fm-download" style="flex:0 0 auto">Download ${fileName}</button>
      </div>
      <div class="import-list" id="fm-list"></div>
      <div id="fm-editor"></div>`;
    pane.appendChild(card);

    // Save to the table the *current* category implies; if the category crossed
    // the place/event boundary, remove the stale row from the other table.
    const persist = async (feature) => {
      refreshData?.();
      const p = feature.properties;
      if (supabase && (role === 'admin' || role === 'editor')) {
        const table = isEventCategory(p.category) ? 'events' : 'places';
        const other = table === 'events' ? 'places' : 'events';
        const row = {
          id: p.id, band_slug: state.band.slug, title: p.title, category: p.category,
          year: p.year, summary: p.summary, story: p.story,
          lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1],
          approx: Boolean(p.approx), artist_id: p.artistId || null,
        };
        // event_date only exists on the events table.
        if (table === 'events') row.event_date = p.date || null;
        const { error } = await supabase.from(table).upsert(row);
        if (!error && table !== (isEvent ? 'events' : 'places')) {
          await supabase.from(other).delete().eq('id', p.id);
        }
        toast(error ? `Save failed: ${error.message}` : 'Saved for everyone');
      } else {
        toast(`Applied locally — use “Download ${fileName}” to keep changes`);
      }
    };

    const renderList = () => {
      const q = card.querySelector('#fm-search')?.value?.toLowerCase() || '';
      const list = card.querySelector('#fm-list');
      list.innerHTML = mine()
        .filter((f) => f.properties.title.toLowerCase().includes(q))
        .sort((a, b) => a.properties.year - b.properties.year)
        .map((f) => `<label data-id="${f.properties.id}" style="cursor:pointer">
            ${escHtml(f.properties.title)}<span class="import-year">${f.properties.year}</span></label>`)
        .join('');
      for (const row of list.querySelectorAll('label')) {
        row.addEventListener('click', () => {
          editing = all.find((f) => f.properties.id === row.dataset.id);
          renderEditor();
        });
      }
    };

    const renderEditor = () => {
      const f = editing;
      const p = f.properties;
      const editor = card.querySelector('#fm-editor');
      const others = all.filter((x) => x.properties.id !== p.id);
      // Offer this section's categories first, but list all so a row can be
      // re-classified across the place/event boundary if it was misfiled.
      const catEntries = Object.entries(state.band.categories)
        .sort(([a], [b]) => (isEventCategory(b) === isEvent) - (isEventCategory(a) === isEvent));
      editor.innerHTML = `
        <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
        <div class="admin-row"><span style="min-width:62px">Title</span>
          <input type="text" id="pe-title" value="${escAttr(p.title)}"></div>
        <div class="admin-row"><span style="min-width:62px">Category</span>
          <select id="pe-category">${catEntries
            .map(([k, c]) => `<option value="${k}" ${k === p.category ? 'selected' : ''}>${escHtml(c.label)}</option>`).join('')}
          </select>
          <span>Year</span><input type="text" id="pe-year" value="${escAttr(p.year)}" style="flex:0 0 70px"></div>
        ${isEvent ? `<div class="admin-row"><span style="min-width:62px">Date</span>
          <input type="date" id="pe-date" value="${escAttr(p.date || '')}">
          <span class="dim" style="font-size:12px">exact day, if known</span></div>` : ''}
        <div class="admin-row"><span style="min-width:62px">Summary</span>
          <input type="text" id="pe-summary" value="${escAttr(p.summary || '')}"></div>
        <div class="admin-row"><span style="min-width:62px">Story</span>
          <textarea id="pe-story" rows="4" style="flex:1;background:color-mix(in srgb, var(--text) 7%, transparent);border:1px solid var(--line);border-radius:10px;padding:9px 12px;color:var(--text);font:inherit;font-size:13px">${escHtml(p.story || '')}</textarea></div>
        <div class="admin-row"><span style="min-width:62px">Lng / Lat</span>
          <input type="text" id="pe-lng" value="${f.geometry.coordinates[0]}">
          <input type="text" id="pe-lat" value="${f.geometry.coordinates[1]}"></div>
        <div class="admin-row"><span style="min-width:62px">Group with</span>
          <select id="pe-group">
            <option value="">— keep own location —</option>
            ${others.map((x) => `<option value="${x.properties.id}">${escHtml(x.properties.title)} (${x.properties.year})</option>`).join('')}
          </select></div>
        <p class="modal-text dim">“Group with” snaps this item to another item's exact spot,
        so they cluster into one hotspot that opens as a story wall.</p>
        <div class="sheet-actions">
          <button class="btn" id="pe-center">Use map centre</button>
          <button class="btn btn-primary" id="pe-save">Save ${kind}</button>
        </div>`;
      editor.querySelector('#pe-center').addEventListener('click', () => {
        const c = state.map.getCenter();
        editor.querySelector('#pe-lng').value = c.lng.toFixed(5);
        editor.querySelector('#pe-lat').value = c.lat.toFixed(5);
      });
      editor.querySelector('#pe-group').addEventListener('change', (e) => {
        const target = all.find((x) => x.properties.id === e.target.value);
        if (target) {
          editor.querySelector('#pe-lng').value = target.geometry.coordinates[0];
          editor.querySelector('#pe-lat').value = target.geometry.coordinates[1];
        }
      });
      editor.querySelector('#pe-save').addEventListener('click', () => {
        p.title = editor.querySelector('#pe-title').value;
        p.category = editor.querySelector('#pe-category').value;
        p.year = Number(editor.querySelector('#pe-year').value) || p.year;
        const dateEl = editor.querySelector('#pe-date');
        if (dateEl) p.date = dateEl.value || undefined;
        p.summary = editor.querySelector('#pe-summary').value;
        p.story = editor.querySelector('#pe-story').value;
        f.geometry.coordinates = [
          Number(editor.querySelector('#pe-lng').value),
          Number(editor.querySelector('#pe-lat').value),
        ];
        persist(f);
        renderList();
      });
    };

    card.querySelector('#fm-search').addEventListener('input', renderList);
    card.querySelector('#fm-download').addEventListener('click', () => {
      download(fileName, { type: 'FeatureCollection', features: mine() });
      toast(`${fileName} downloaded — replace public/data and deploy`);
    });
    renderList();
  };
}

const renderPlaces = makeFeatureManager({
  kind: 'place', title: 'Places', fileName: 'places.json',
  blurb: 'Physical, ongoing locations — studios, homes, origins. Search to find one fast.',
});
const renderEvents = makeFeatureManager({
  kind: 'event', title: 'Events', fileName: 'events.json',
  blurb: 'Time-anchored happenings — gigs, releases, milestones, video shoots.',
});

/* ===================== Section: Trips (re-housed) ===================== */

function renderTrips(pane, ctx) {
  const { state, role } = ctx;
  const { toast } = ctx.helpers;
  const isGuideMode = ctx.access === 'guide';
  const userId = ctx.user?.id || null;
  const userName = ctx.user?.user_metadata?.full_name || ctx.user?.email || 'Tour guide';
  // Guides only see and manage their own tours; full-access sees all.
  const visibleTrips = () => isGuideMode ? state.trips.filter((t) => userId && t.author_id === userId) : state.trips;
  let editing = null;

  const card = el('section', 'set-card');
  card.innerHTML = `
    <header class="set-card-head"><h3>${isGuideMode ? 'My tours' : 'Trips'}</h3>
      <p>Build custom journeys — an album in order, a tour leg, a member's story. They appear instantly in the 🧭 picker.</p></header>
    <div class="admin-row">
      <button class="btn" id="trip-new" style="flex:1">＋ ${isGuideMode ? 'New tour' : 'New trip'}</button>
      ${isGuideMode ? '' : '<button class="btn" id="trips-download" style="flex:1">Download trips.json</button>'}
    </div>
    <div class="import-list" id="trip-admin-list"></div>
    <div id="trip-editor"></div>`;
  pane.appendChild(card);

  const persist = async (trip) => {
    const canDbWrite = supabase && (role === 'admin' || role === 'editor' || isGuideMode);
    if (canDbWrite) {
      const { error } = await supabase.from('trips').upsert({
        id: trip.id, band_slug: state.band.slug, emoji: trip.emoji, title: trip.title,
        description: trip.description, badge: trip.badge, stops: trip.stops,
        position: state.trips.indexOf(trip),
        author_id: trip.author_id || null, author_name: trip.author_name || null,
        price_cents: trip.price_cents || 0, currency: trip.currency || 'GBP',
        published: Boolean(trip.published),
      });
      toast(error ? `Save failed: ${error.message}` : (trip.published ? 'Tour saved & published' : 'Tour saved'));
    } else {
      download('trips.json', { trips: state.trips });
      toast('trips.json downloaded — replace public/data and deploy');
    }
  };

  const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const placeTitle = (id) =>
    state.places.features.find((f) => f.properties.id === id)?.properties.title || id;

  const renderEditor = () => {
    const t = editing;
    const editor = card.querySelector('#trip-editor');
    if (!t) { editor.innerHTML = ''; return; }
    editor.innerHTML = `
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
      <div class="admin-row"><span style="min-width:62px">Emoji</span>
        <input type="text" id="te-emoji" value="${escAttr(t.emoji || '📍')}" style="flex:0 0 64px">
        <span>Title</span><input type="text" id="te-title" value="${escAttr(t.title || '')}"></div>
      <div class="admin-row"><span style="min-width:62px">Blurb</span>
        <input type="text" id="te-desc" value="${escAttr(t.description || '')}"></div>
      <div class="admin-row"><span style="min-width:62px">Badge</span>
        <input type="text" id="te-badge" value="${escAttr(t.badge || '')}"
          placeholder="Badge name awarded on completion"></div>
      <div class="admin-row">
        <select id="te-add-place">
          <option value="">Add a stop…</option>
          ${state.places.features
            .slice().sort((a, b) => a.properties.year - b.properties.year)
            .map((f) => `<option value="${f.properties.id}">${escHtml(f.properties.title)} (${f.properties.year})</option>`).join('')}
        </select>
      </div>
      <div class="import-list" id="te-stops">
        ${t.stops.map((id, i) => `
          <label data-i="${i}">
            <span style="opacity:.45">${i + 1}.</span> ${escHtml(placeTitle(id))}
            <span class="import-year">
              <button class="btn-mini" data-up="${i}">↑</button>
              <button class="btn-mini" data-down="${i}">↓</button>
              <button class="btn-mini" data-del="${i}">✕</button>
            </span>
          </label>`).join('') || '<p class="modal-text dim">No stops yet — add some above.</p>'}
      </div>
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
      <div class="admin-row" style="align-items:center">
        <label class="te-pub"><input type="checkbox" id="te-published" ${t.published ? 'checked' : ''}> Published <span class="set-hint">visible to fans</span></label>
      </div>
      <div class="admin-row"><span style="min-width:62px">Price</span>
        <select id="te-currency" style="flex:0 0 88px">
          ${['GBP', 'USD', 'EUR'].map((c) => `<option value="${c}" ${(t.currency || 'GBP') === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <input type="number" id="te-price" min="0" step="0.01" value="${((t.price_cents || 0) / 100).toFixed(2)}" placeholder="0.00">
        <span class="set-hint">0 = free</span></div>
      <p class="modal-text dim" style="margin-top:0">Paid tours won't charge yet — payouts are coming soon. Set a price now and switch it on later.</p>
      <button class="btn btn-primary" id="te-save" style="width:100%">Save tour</button>`;

    editor.querySelector('#te-add-place').addEventListener('change', (e) => {
      if (!e.target.value) return;
      t.stops.push(e.target.value); renderEditor();
    });
    for (const b of editor.querySelectorAll('[data-up]')) {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.up);
        if (i > 0) [t.stops[i - 1], t.stops[i]] = [t.stops[i], t.stops[i - 1]];
        renderEditor();
      });
    }
    for (const b of editor.querySelectorAll('[data-down]')) {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.down);
        if (i < t.stops.length - 1) [t.stops[i + 1], t.stops[i]] = [t.stops[i], t.stops[i + 1]];
        renderEditor();
      });
    }
    for (const b of editor.querySelectorAll('[data-del]')) {
      b.addEventListener('click', () => { t.stops.splice(Number(b.dataset.del), 1); renderEditor(); });
    }
    editor.querySelector('#te-save').addEventListener('click', () => {
      t.emoji = editor.querySelector('#te-emoji').value || '📍';
      t.title = editor.querySelector('#te-title').value.trim();
      t.description = editor.querySelector('#te-desc').value.trim();
      t.badge = editor.querySelector('#te-badge').value.trim();
      t.published = editor.querySelector('#te-published').checked;
      t.currency = editor.querySelector('#te-currency').value;
      t.price_cents = Math.max(0, Math.round((Number(editor.querySelector('#te-price').value) || 0) * 100));
      if (!t.title || t.stops.length < 2) { toast('A tour needs a title and at least 2 stops'); return; }
      if (!t.id) t.id = slugify(t.title);
      // Stamp guide authorship on first save (and ensure guides own what they make).
      if (isGuideMode && !t.author_id) { t.author_id = userId; t.author_name = userName; }
      if (!state.trips.includes(t)) state.trips.push(t);
      persist(t); renderList();
    });
  };

  const priceLabel = (t) => {
    if (!t.price_cents) return '';
    const sym = { GBP: '£', USD: '$', EUR: '€' }[t.currency] || '';
    return ` · ${sym}${(t.price_cents / 100).toFixed(2)}`;
  };
  const renderList = () => {
    const list = card.querySelector('#trip-admin-list');
    const trips = visibleTrips();
    list.innerHTML = trips.length ? trips.map((t) => `
      <label data-id="${t.id}" style="cursor:pointer">${escHtml(t.emoji)} ${escHtml(t.title)}
        <span class="import-year">${t.stops.length} stops${t.published ? '' : ' · draft'}${priceLabel(t)}</span></label>`).join('')
      : '<p class="modal-text dim">No tours yet — create your first below.</p>';
    for (const row of list.querySelectorAll('label')) {
      row.addEventListener('click', () => {
        editing = state.trips.find((t) => t.id === row.dataset.id); renderEditor();
      });
    }
  };

  card.querySelector('#trip-new').addEventListener('click', () => {
    editing = {
      id: '', emoji: '📍', title: '', description: '', badge: '', stops: [],
      published: false, price_cents: 0, currency: 'GBP',
      author_id: isGuideMode ? userId : null, author_name: isGuideMode ? userName : null,
    };
    renderEditor();
  });
  card.querySelector('#trips-download')?.addEventListener('click', () => {
    download('trips.json', { trips: state.trips });
    toast('trips.json downloaded — replace public/data and deploy');
  });
  renderList(); renderEditor();
}

/* ===================== Section: Albums (MusicBrainz) ===================== */

async function mbFindArtist(name) {
  const res = await fetch(
    `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(name)}&fmt=json&limit=1`,
    { headers: { 'User-Agent': 'WorldInTheirEyes/1.0 (wite-app)' } },
  ).then((r) => r.json());
  return res.artists?.[0] ?? null;
}

async function persistPlaces(places, bandSlug, role, toast, refreshData) {
  if (supabase && (role === 'admin' || role === 'editor')) {
    const rows = places.map((f) => ({
      id: f.properties.id, band_slug: bandSlug,
      title: f.properties.title, category: f.properties.category,
      year: f.properties.year, summary: f.properties.summary, story: f.properties.story,
      lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], approx: true,
    }));
    const { error } = await supabase.from('places').upsert(rows);
    if (error) { toast(`Import failed: ${error.message}`); return; }
    toast(`${places.length} draft places saved — reload the map to see them`);
    refreshData?.();
  } else {
    download('places-import.json', { type: 'FeatureCollection', features: places });
    toast(`${places.length} drafts downloaded — merge into places.json and redeploy`);
  }
}

function renderAlbums(pane, ctx) {
  const { state, role } = ctx;
  const { toast, refreshData } = ctx.helpers;
  const card = el('section', 'set-card');
  card.innerHTML = `
    <header class="set-card-head"><h3>Albums · MusicBrainz</h3>
      <p>Free, no key needed. Each release becomes a draft place at the band's home coordinates — move it to the recording studio afterwards.</p></header>
    <div class="admin-row">
      <input type="text" id="mb-artist" value="${escAttr(state.band.name)}" placeholder="Artist name">
      <button class="btn btn-primary" id="mb-search" style="flex:0 0 auto">Search</button>
    </div>
    <div id="mb-results"></div>`;
  pane.appendChild(card);

  card.querySelector('#mb-search').addEventListener('click', async () => {
    const name = card.querySelector('#mb-artist').value.trim();
    const results = card.querySelector('#mb-results');
    if (!name) return;
    results.innerHTML = '<p class="modal-text dim">Searching MusicBrainz…</p>';
    try {
      const artist = await mbFindArtist(name);
      if (!artist) { results.innerHTML = '<p class="modal-text">Artist not found.</p>'; return; }
      const rgs = await fetch(
        `https://musicbrainz.org/ws/2/release-group?artist=${artist.id}&type=album&fmt=json&limit=100`,
        { headers: { 'User-Agent': 'WorldInTheirEyes/1.0' } },
      ).then((r) => r.json());
      const albums = (rgs['release-groups'] || [])
        .filter((a) => a['primary-type'] === 'Album' && a['first-release-date'])
        .sort((a, b) => a['first-release-date'].localeCompare(b['first-release-date']));
      if (!albums.length) { results.innerHTML = '<p class="modal-text">No albums found.</p>'; return; }
      results.innerHTML = `
        <p class="modal-text dim">${albums.length} albums found for <strong>${escHtml(artist.name)}</strong>.
          <button class="btn-mini" id="mb-all">All</button>
          <button class="btn-mini" id="mb-none">None</button></p>
        <div class="import-list">
          ${albums.map((a, i) => `
            <label><input type="checkbox" data-i="${i}" checked>
              ${escHtml(a.title)}<span class="import-year">${a['first-release-date'].slice(0, 4)}</span>
            </label>`).join('')}
        </div>
        <button class="btn btn-primary" id="mb-import" style="width:100%;margin-top:10px">
          Import selected as draft places</button>`;
      results.querySelector('#mb-all').addEventListener('click', () =>
        results.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = true; }));
      results.querySelector('#mb-none').addEventListener('click', () =>
        results.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; }));
      results.querySelector('#mb-import').addEventListener('click', async () => {
        const chosen = [...results.querySelectorAll('input:checked')].map((cb) => albums[+cb.dataset.i]);
        if (!chosen.length) { toast('Nothing selected'); return; }
        const features = chosen.map((a) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: state.band.map.center },
          properties: {
            id: `mb-release-${a.id.slice(0, 8)}`, title: a.title, category: 'release',
            year: +a['first-release-date'].slice(0, 4),
            summary: `Album released ${a['first-release-date']}.`,
            story: 'Imported from MusicBrainz. Move this pin to the recording studio and add the story.',
          },
        }));
        await persistPlaces(features, state.band.slug, role, toast, refreshData);
      });
    } catch (err) {
      results.innerHTML = `<p class="modal-text">Error: ${escHtml(err.message)}</p>`;
    }
  });
}

/* ===================== Section: Concerts (Setlist.fm) ===================== */

function renderConcerts(pane, ctx) {
  const { state, role } = ctx;
  const { toast, refreshData } = ctx.helpers;
  const LS = 'wite:import:setlistfm';
  const savedKey = localStorage.getItem(LS) || '';

  const card = el('section', 'set-card');
  card.innerHTML = `
    <header class="set-card-head"><h3>Concerts · Setlist.fm</h3>
      <p>Free API key, real venue coordinates. Each unique venue becomes one <em>Live</em> place with a count of how many times the band played there.</p></header>
    <div class="admin-row">
      <input type="text" id="sfm-key" placeholder="Setlist.fm API key" value="${escAttr(savedKey)}" style="font-family:monospace;font-size:12px">
      <a href="https://www.setlist.fm/settings/api" target="_blank" rel="noopener" class="btn" style="flex:0 0 auto;white-space:nowrap">Get free key ↗</a>
    </div>
    <div class="admin-row">
      <input type="text" id="sfm-artist" value="${escAttr(state.band.name)}" placeholder="Artist name">
      <input type="number" id="sfm-pages" value="3" min="1" max="50" style="flex:0 0 64px" title="Pages to fetch (20 shows each)">
      <button class="btn btn-primary" id="sfm-search" style="flex:0 0 auto">Search</button>
    </div>
    <p class="modal-text dim" style="margin-top:0">Pages × 20 = shows fetched. Start with 3 (60 shows) — add more once it's working.</p>
    <div id="sfm-results"></div>`;
  pane.appendChild(card);

  const saveKey = (k) => localStorage.setItem(LS, k);
  card.querySelector('#sfm-key').addEventListener('change', (e) => saveKey(e.target.value.trim()));

  card.querySelector('#sfm-search').addEventListener('click', async () => {
    const key = card.querySelector('#sfm-key').value.trim();
    const artist = card.querySelector('#sfm-artist').value.trim();
    const pages = Math.min(50, Math.max(1, +card.querySelector('#sfm-pages').value || 5));
    const results = card.querySelector('#sfm-results');
    if (!key) { toast('Enter your Setlist.fm API key first'); return; }
    if (!artist) return;
    saveKey(key);
    results.innerHTML = '<p class="modal-text dim">Fetching setlists…</p>';

    try {
      const venueMap = new Map();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const sfmFetch = async (p) => {
        const r = await fetch(`/api/setlistfm?artist=${encodeURIComponent(artist)}&p=${p}`, { headers: { 'x-sfm-key': key } });
        let payload; try { payload = await r.json(); } catch { payload = null; }
        if (!r.ok) {
          const detail = payload?.error || payload?.raw || JSON.stringify(payload || '').slice(0, 200);
          const debugInfo = payload?.debug ? `\n\nDebug: ${JSON.stringify(payload.debug, null, 2)}` : '';
          const label = r.status === 429 ? 'Rate limited (429)' : r.status === 401 ? 'Invalid API key (401)' : r.status === 404 ? 'Artist not found (404)' : `Error ${r.status}`;
          throw new Error(`${label}: ${detail}${debugInfo}`);
        }
        return payload;
      };

      for (let p = 1; p <= pages; p++) {
        results.querySelector('p').textContent = `Fetching page ${p} of ${pages}…`;
        if (p > 1) await sleep(2500);
        const data = await sfmFetch(p);
        for (const sl of data.setlist || []) {
          if (!sl.venue?.city?.coords) continue;
          const vid = sl.venue.id;
          if (!venueMap.has(vid)) venueMap.set(vid, { venue: sl.venue, shows: [] });
          venueMap.get(vid).shows.push({ date: sl.eventDate, url: sl.url });
        }
        const maxPage = Math.ceil((data.total ?? 0) / 20);
        if (p >= maxPage) break;
      }

      if (!venueMap.size) { results.innerHTML = '<p class="modal-text">No shows with venue coordinates found.</p>'; return; }
      const venues = [...venueMap.values()].sort((a, b) => b.shows.length - a.shows.length);
      results.innerHTML = `
        <p class="modal-text dim">${venues.length} unique venues across ${venues.reduce((s, v) => s + v.shows.length, 0)} shows.
          <button class="btn-mini" id="sfm-all">All</button>
          <button class="btn-mini" id="sfm-none">None</button></p>
        <div class="import-list">
          ${venues.map((v, i) => {
            const city = v.venue.city;
            const years = v.shows.map((s) => +s.date.split('-').pop()).sort();
            const yr = years[0] === years[years.length - 1] ? years[0] : `${years[0]}–${years[years.length - 1]}`;
            return `<label><input type="checkbox" data-i="${i}" checked>
              ${escHtml(`${v.venue.name}, ${city.name}, ${city.country.name}`)}
              <span class="import-year">${v.shows.length} show${v.shows.length > 1 ? 's' : ''} · ${yr}</span></label>`;
          }).join('')}
        </div>
        <button class="btn btn-primary" id="sfm-import" style="width:100%;margin-top:10px">Import selected venues as places</button>`;
      results.querySelector('#sfm-all').addEventListener('click', () =>
        results.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = true; }));
      results.querySelector('#sfm-none').addEventListener('click', () =>
        results.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; }));
      results.querySelector('#sfm-import').addEventListener('click', async () => {
        const chosen = [...results.querySelectorAll('input:checked')].map((cb) => venues[+cb.dataset.i]);
        if (!chosen.length) { toast('Nothing selected'); return; }
        const features = chosen.map((v) => {
          const city = v.venue.city;
          const years = v.shows.map((s) => +s.date.split('-').pop()).sort();
          const shows = v.shows.length;
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [+city.coords.long, +city.coords.lat] },
            properties: {
              id: `sfm-venue-${v.venue.id}`, title: `${v.venue.name}, ${city.name}`, category: 'gig',
              year: years[0],
              summary: `${shows} show${shows > 1 ? 's' : ''} at this venue · ${city.name}, ${city.country.name}`,
              story: `Played here ${shows} time${shows > 1 ? 's' : ''}. Setlist.fm: ${v.shows[0].url}`,
            },
          };
        });
        await persistPlaces(features, state.band.slug, role, toast, refreshData);
      });
    } catch (err) {
      const [headline, ...rest] = err.message.split('\n\nDebug:');
      results.innerHTML = `<p class="modal-text" style="color:var(--error,#f66)">Error: ${escHtml(headline)}</p>${rest.length ? `<pre style="font-size:10px;overflow:auto;max-height:200px;background:var(--surface);padding:8px;border-radius:6px;color:var(--text)">${escHtml(rest.join(''))}</pre>` : ''}`;
    }
  });
}

/* ===================== Section: Audience map (NEW) ===================== */

let _countries = null;
async function loadCountries() {
  if (_countries) return _countries;
  const g = await fetch('/data/world-countries.json').then((r) => r.json());
  _countries = g.features
    .map((f) => ({ iso: f.properties.iso, name: f.properties.name }))
    .filter((c) => c.iso && c.iso !== '-99')
    .sort((a, b) => a.name.localeCompare(b.name));
  return _countries;
}

// Parse pasted JSON or CSV (ISO,value per line) into { values, unknown[] }.
function parseAudience(text, validIso) {
  const values = {};
  const unknown = [];
  const add = (iso, val) => {
    iso = String(iso).trim().toUpperCase();
    const n = Number(val);
    if (!iso || Number.isNaN(n)) return;
    if (!validIso.has(iso)) { unknown.push(iso); return; }
    values[iso] = n;
  };
  const trimmed = text.trim();
  if (!trimmed) return { values, unknown };
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) add(k, v); return { values, unknown }; }
  } catch { /* fall through to CSV */ }
  for (const line of trimmed.split('\n')) {
    const [iso, val] = line.split(/[,\t ]+/);
    if (iso) add(iso, val);
  }
  return { values, unknown };
}

function renderAudience(pane, ctx) {
  const { state, helpers } = ctx;
  const band = state.band;
  const card = el('section', 'set-card');
  card.innerHTML = `<header class="set-card-head"><h3>Audience map</h3>
    <p>Tint each country by streams, fans or sales — subtle by design. Leave it on “Auto” to colour by how many of the band's places fall in each country.</p></header>
    <p class="modal-text dim">Loading countries…</p>`;
  pane.appendChild(card);

  loadCountries().then((countries) => {
    const validIso = new Set(countries.map((c) => c.iso));
    const nameOf = (iso) => countries.find((c) => c.iso === iso)?.name || iso;
    let values = { ...(band.audience || {}) };
    let metric = band.audienceMetric || '';
    let mode = Object.keys(values).length ? 'manual' : 'auto';

    const applyPreview = (vals) => {
      band.audience = vals && Object.keys(vals).length ? vals : undefined;
      band.audienceMetric = metric || undefined;
      helpers.refreshChoropleth?.();
    };

    const bodyHTML = () => {
      if (mode === 'auto') {
        return `<p class="modal-text dim">Countries are tinted automatically by the band's place &amp; gig density — it updates itself as you import more. Nothing to enter.</p>`;
      }
      if (mode === 'paste') {
        const prefill = Object.keys(values).length ? JSON.stringify(values, null, 2) : '';
        return `
          <textarea id="aud-paste" rows="8" placeholder='{ "GB": 1000000, "DE": 600000 }   — or one per line:   GB,1000000'>${escHtml(prefill)}</textarea>
          <div class="admin-row" style="margin-top:8px"><button class="btn" id="aud-parse">Parse &amp; preview</button></div>
          <div id="aud-paste-status"></div>`;
      }
      // manual
      const rows = Object.entries(values).sort((a, b) => b[1] - a[1]);
      return `
        <div class="admin-row">
          <input type="text" id="aud-add" list="aud-countries" placeholder="Add a country…">
          <button class="btn" id="aud-add-btn" style="flex:0 0 auto">＋ Add</button>
        </div>
        <datalist id="aud-countries">${countries.map((c) => `<option value="${escAttr(c.iso)} — ${escAttr(c.name)}">`).join('')}</datalist>
        <div class="aud-rows" id="aud-rows">
          ${rows.length ? rows.map(([iso, val]) => `
            <div class="aud-row" data-iso="${escAttr(iso)}">
              <span class="aud-iso">${escAttr(iso)}</span>
              <span class="aud-name">${escHtml(nameOf(iso))}</span>
              <input type="number" class="aud-val" value="${escAttr(val)}" min="0">
              <button class="btn-mini" data-del="${escAttr(iso)}">✕</button>
            </div>`).join('') : '<p class="modal-text dim">No countries yet — add some above, or paste a list.</p>'}
        </div>`;
    };

    const draw = () => {
      card.innerHTML = `
        <header class="set-card-head"><h3>Audience map</h3>
          <p>Tint each country by streams, fans or sales — subtle by design.</p></header>
        <div class="seg" id="aud-modes">
          ${[['auto', 'Auto from places'], ['manual', 'Manual entry'], ['paste', 'Paste data']]
            .map(([m, label]) => `<button class="seg-btn ${mode === m ? 'seg-btn--on' : ''}" data-mode="${m}">${label}</button>`).join('')}
        </div>
        <div class="set-field set-field--wide"><label>What does the value mean?<span class="set-hint">shown in the map legend later</span></label>
          <input type="text" id="aud-metric" value="${escAttr(metric)}" placeholder="e.g. Spotify monthly listeners"></div>
        <div id="aud-body">${bodyHTML()}</div>
        <div class="set-card-actions">
          <button class="btn" data-preview>Preview on globe</button>
          <button class="btn btn-primary" data-save>Save audience</button>
        </div>`;

      card.querySelector('#aud-metric').addEventListener('input', (e) => { metric = e.target.value; });
      for (const b of card.querySelectorAll('[data-mode]')) {
        b.addEventListener('click', () => { collectManual(); mode = b.dataset.mode; draw(); });
      }
      if (mode === 'manual') {
        const addRow = () => {
          const raw = card.querySelector('#aud-add').value.trim();
          const iso = raw.split('—')[0].trim().toUpperCase();
          if (!validIso.has(iso)) { helpers.toast('Pick a country from the list'); return; }
          if (!(iso in values)) values[iso] = 0;
          card.querySelector('#aud-add').value = '';
          draw();
        };
        card.querySelector('#aud-add-btn').addEventListener('click', addRow);
        card.querySelector('#aud-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } });
        for (const b of card.querySelectorAll('[data-del]')) {
          b.addEventListener('click', () => { collectManual(); delete values[b.dataset.del]; draw(); });
        }
      }
      if (mode === 'paste') {
        card.querySelector('#aud-parse').addEventListener('click', () => {
          const { values: parsed, unknown } = parseAudience(card.querySelector('#aud-paste').value, validIso);
          values = parsed;
          const status = card.querySelector('#aud-paste-status');
          const n = Object.keys(parsed).length;
          status.innerHTML = `<p class="modal-text ${n ? '' : 'dim'}">${n} countr${n === 1 ? 'y' : 'ies'} parsed${unknown.length ? ` · ignored unknown codes: ${escHtml(unknown.slice(0, 8).join(', '))}` : ''}.</p>`;
          applyPreview(parsed);
        });
      }

      card.querySelector('[data-preview]').addEventListener('click', () => {
        collectManual();
        applyPreview(mode === 'auto' ? null : values);
        helpers.toast('Previewing on the globe');
      });
      card.querySelector('[data-save]').addEventListener('click', async () => {
        collectManual();
        if (mode === 'auto') { values = {}; band.audience = undefined; band.audienceMetric = undefined; }
        else { band.audience = Object.keys(values).length ? values : undefined; band.audienceMetric = metric || undefined; }
        helpers.refreshChoropleth?.();
        await saveBand(ctx, 'Audience saved ✓');
      });
    };

    const collectManual = () => {
      if (mode !== 'manual') return;
      for (const row of card.querySelectorAll('.aud-row')) {
        values[row.dataset.iso] = Number(row.querySelector('.aud-val').value) || 0;
      }
    };

    draw();
  });
}

/* ===================== Section: Moderation (re-housed) ===================== */

function renderModeration(pane, ctx) {
  const { state } = ctx;
  const { toast } = ctx.helpers;
  const card = el('section', 'set-card');
  card.innerHTML = `<header class="set-card-head"><h3>Moderation</h3>
    <p>Approve or reject fan submissions. Approved items become visible to everyone.</p></header>
    <div id="mod-body"></div>`;
  pane.appendChild(card);
  const body = card.querySelector('#mod-body');

  if (!supabase) {
    body.innerHTML = `<p class="modal-text">Moderation needs the cloud backend. Until Supabase is
      connected, fan submissions stay on each fan's own device, so there's nothing to review.</p>`;
    return;
  }

  const placeTitle = (id) =>
    state.places.features.find((f) => f.properties.id === id)?.properties.title || id;

  const load = async () => {
    body.innerHTML = '<p class="modal-text dim">Loading pending submissions…</p>';
    const { data, error } = await supabase
      .from('memories')
      .select('id, place_id, kind, body, photo_url, link_url, created_at')
      .eq('approved', false).order('created_at', { ascending: true }).limit(100);
    if (error) { body.innerHTML = `<p class="modal-text">Couldn't load the queue: ${escHtml(error.message)}</p>`; return; }
    if (!data.length) { body.innerHTML = '<p class="modal-text dim">Queue is clear — nothing awaiting review. 🎉</p>'; return; }
    body.innerHTML = `
      <p class="modal-text dim">${data.length} submission${data.length > 1 ? 's' : ''} awaiting review.</p>
      <div class="memories-list">
        ${data.map((m) => `
          <article class="memory" data-id="${m.id}">
            <span class="memory-kind">${escHtml(m.kind || 'memory')} · ${escHtml(placeTitle(m.place_id))} · ${new Date(m.created_at).toLocaleDateString()}</span>
            ${m.body ? `<p>${escHtml(m.body)}</p>` : ''}
            ${m.photo_url ? `<img src="${escAttr(m.photo_url)}" alt="" loading="lazy">` : ''}
            ${m.link_url ? `<a href="${escAttr(m.link_url)}" target="_blank" rel="noopener">${escHtml(m.link_url)}</a>` : ''}
            <div class="sheet-actions" style="margin-top:10px">
              <button class="btn" data-reject>Reject</button>
              <button class="btn btn-primary" data-approve>Approve</button>
            </div>
          </article>`).join('')}
      </div>`;
    for (const c of body.querySelectorAll('.memory')) {
      const id = c.dataset.id;
      c.querySelector('[data-approve]').addEventListener('click', async () => {
        const { error: err } = await supabase.from('memories').update({ approved: true }).eq('id', id);
        toast(err ? `Approve failed: ${err.message}` : 'Approved — now public');
        if (!err) c.remove();
      });
      c.querySelector('[data-reject]').addEventListener('click', async () => {
        const { error: err } = await supabase.from('memories').delete().eq('id', id);
        toast(err ? `Reject failed: ${err.message}` : 'Rejected and removed');
        if (!err) c.remove();
      });
    }
  };
  load();
}

/* ===================== Section: Tour guides ===================== */

function renderGuides(pane, ctx) {
  const { state } = ctx;
  const { toast } = ctx.helpers;
  const slug = state.band.slug;
  const reviewerId = ctx.user?.id;
  let names = {};
  const nameFor = (id) => names[id] || (id ? `${id.slice(0, 8)}…` : 'unknown');

  const card = el('section', 'set-card');
  card.innerHTML = `<header class="set-card-head"><h3>Tour guides</h3>
    <p>Approve fans applying to guide ${escHtml(state.band.name)}, and manage who currently holds the role.</p></header>
    <div id="guides-pending"></div>
    <div id="guides-current" style="margin-top:18px"></div>`;
  pane.appendChild(card);
  const pendingBox = card.querySelector('#guides-pending');
  const currentBox = card.querySelector('#guides-current');

  if (!supabase) {
    pendingBox.innerHTML = `<p class="modal-text">Guide approvals need the cloud backend.</p>`;
    return;
  }

  const load = async () => {
    pendingBox.innerHTML = '<p class="modal-text dim">Loading applications…</p>';
    currentBox.innerHTML = '';
    const [apps, guides] = await Promise.all([getPendingApplications(slug), getBandGuides(slug)]);
    names = await getProfileNames([...apps.map((a) => a.user_id), ...guides.map((g) => g.user_id)]);

    // ── Pending applications ──
    if (!apps.length) {
      pendingBox.innerHTML = '<p class="modal-text dim">No applications waiting for review. 🎉</p>';
    } else {
      pendingBox.innerHTML = `
        <h4 class="set-sub">Pending applications (${apps.length})</h4>
        <div class="memories-list">
          ${apps.map((a) => `
            <article class="memory" data-id="${escAttr(a.id)}">
              <span class="memory-kind">${escHtml(a.requested_role === 'guide' ? '🎫 Tour guide' : '★ Band rep')} · ${escHtml(nameFor(a.user_id))} · ${new Date(a.created_at).toLocaleDateString()}</span>
              ${a.justification ? `<p>${escHtml(a.justification)}</p>` : ''}
              <div class="sheet-actions" style="margin-top:10px">
                <button class="btn" data-reject>Reject</button>
                <button class="btn btn-primary" data-approve>Approve</button>
              </div>
            </article>`).join('')}
        </div>`;
      for (const c of pendingBox.querySelectorAll('.memory')) {
        const id = c.dataset.id;
        const decide = async (decision) => {
          const { error } = await reviewApplication(id, decision, reviewerId);
          if (error) { toast(`Failed: ${error}`); return; }
          toast(decision === 'approved' ? 'Approved — role granted' : 'Application rejected');
          load();
        };
        c.querySelector('[data-approve]').addEventListener('click', () => decide('approved'));
        c.querySelector('[data-reject]').addEventListener('click', () => decide('rejected'));
      }
    }

    // ── Current guides ──
    if (!guides.length) {
      currentBox.innerHTML = '<h4 class="set-sub">Current guides</h4><p class="modal-text dim">No tour guides yet.</p>';
    } else {
      currentBox.innerHTML = `
        <h4 class="set-sub">Current guides (${guides.length})</h4>
        <div class="memories-list">
          ${guides.map((g) => `
            <article class="memory" data-uid="${escAttr(g.user_id)}">
              <span class="memory-kind">🎫 ${escHtml(nameFor(g.user_id))} · since ${new Date(g.granted_at).toLocaleDateString()}</span>
              <div class="sheet-actions" style="margin-top:10px">
                <button class="btn" data-revoke>Remove guide</button>
              </div>
            </article>`).join('')}
        </div>`;
      for (const c of currentBox.querySelectorAll('.memory')) {
        c.querySelector('[data-revoke]').addEventListener('click', async () => {
          const { error } = await revokeBandRole(c.dataset.uid, slug, 'guide');
          if (error) { toast(`Remove failed: ${error}`); return; }
          toast('Guide role removed');
          load();
        });
      }
    }
  };
  load();
}

/* ===================== Section: Payouts (placeholder) ===================== */

function renderPayouts(pane, ctx) {
  const { state } = ctx;
  const paid = state.trips.filter((t) => (t.price_cents || 0) > 0);
  const card = el('section', 'set-card');
  card.innerHTML = `
    <header class="set-card-head"><h3>Payouts</h3>
      <p>Charge for your tours and get paid. This is being built — here's where it'll live.</p></header>
    <div class="payouts-placeholder">
      <div class="payouts-badge">£ &nbsp;Coming soon</div>
      <p class="modal-text">You can already mark a tour as paid and set its price in
        <strong>My tours</strong>. Once payouts go live you'll connect a payout account here and
        fans will be able to buy access — your tours stay free to set up in the meantime.</p>
      <p class="modal-text dim">${paid.length
        ? `${paid.length} of your tours ${paid.length === 1 ? 'has' : 'have'} a price set and ${paid.length === 1 ? 'is' : 'are'} ready to switch on.`
        : 'No priced tours yet — set a price on a tour to get ready.'}</p>
      <button class="btn" disabled>Connect payout account (soon)</button>
    </div>`;
  pane.appendChild(card);
}

/* ===================== Section: Backup & import (sysadmin) ===================== */

// Content tables we can round-trip via the API (admin RLS allows read + write).
const BACKUP_TABLES = ['artists', 'places', 'events', 'trips'];

function renderBackup(pane, ctx) {
  const { state, role } = ctx;
  const { toast } = ctx.helpers;
  const slug = state.band.slug;
  const isSysadmin = role === 'admin' || role === 'local-admin';

  const card = el('section', 'set-card');
  card.innerHTML = `
    <header class="set-card-head"><h3>Backup &amp; import</h3>
      <p>Download a full JSON snapshot of this band's data, or import one you've
      edited offline. System-admin only.</p></header>
    <div id="backup-body"></div>`;
  pane.appendChild(card);
  const body = card.querySelector('#backup-body');

  if (!supabase) {
    body.innerHTML = `<p class="modal-text">Backup &amp; import need the cloud backend.</p>`;
    return;
  }
  if (!isSysadmin) {
    body.innerHTML = `<p class="modal-text">This section is restricted to system administrators.</p>`;
    return;
  }

  body.innerHTML = `
    <div class="sheet-actions" style="flex-wrap:wrap">
      <button class="btn btn-primary" id="backup-export">⬇ Download backup (JSON)</button>
      <label class="btn" style="cursor:pointer">⬆ Import from JSON
        <input type="file" id="backup-import" accept="application/json,.json" hidden>
      </label>
    </div>
    <p class="modal-text dim" style="margin-top:12px">Backup includes the band config plus
      ${BACKUP_TABLES.join(', ')}. Import <strong>merges</strong> rows by id (it never deletes),
      so it's safe to re-run. Take a fresh backup before importing.</p>
    <div id="backup-log" class="modal-text" style="margin-top:10px"></div>`;
  const log = body.querySelector('#backup-log');

  // ── Export ──
  body.querySelector('#backup-export').addEventListener('click', async () => {
    log.textContent = 'Gathering data…';
    const out = {
      format: 'wite-backup', version: 1,
      exported_at: new Date().toISOString(), band_slug: slug,
    };
    const band = await supabase.from('bands').select('*').eq('slug', slug).maybeSingle();
    out.bands = band.data ? [band.data] : [];
    for (const t of BACKUP_TABLES) {
      const { data, error } = await supabase.from(t).select('*').eq('band_slug', slug);
      if (error) { log.textContent = `Export failed on ${t}: ${error.message}`; return; }
      out[t] = data || [];
    }
    const stamp = new Date().toISOString().slice(0, 10);
    download(`backup-${slug}-${stamp}.json`, out);
    const counts = BACKUP_TABLES.map((t) => `${out[t].length} ${t}`).join(', ');
    log.textContent = `Downloaded: ${counts}.`;
    toast('Backup downloaded');
  });

  // ── Import ──
  body.querySelector('#backup-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file later
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { log.textContent = 'That file isn’t valid JSON.'; return; }
    if (data.format !== 'wite-backup') {
      log.textContent = 'Unrecognised file — expected a wite-backup JSON export.';
      return;
    }
    const tableCounts = ['bands', ...BACKUP_TABLES]
      .map((t) => `${(data[t] || []).length} ${t}`).join(', ');
    if (!window.confirm(`Import and merge ${tableCounts}? Existing rows with the same id will be overwritten.`)) return;

    log.textContent = 'Importing…';
    const results = [];
    for (const t of ['bands', ...BACKUP_TABLES]) {
      const rows = data[t] || [];
      if (!rows.length) continue;
      const { error } = await supabase.from(t).upsert(rows);
      results.push(error ? `${t}: ✗ ${error.message}` : `${t}: ✓ ${rows.length}`);
    }
    log.innerHTML = results.map(escHtml).join('<br>')
      + '<br><strong>Done.</strong> Reload the atlas to see imported content.';
    toast('Import finished');
  });
}

/* ===================== Console shell ===================== */

const SECTIONS = [
  { group: 'Setup', items: [
    { id: 'overview', icon: '◎', label: 'Overview', render: renderOverview },
    { id: 'identity', icon: '✺', label: 'Identity & look', render: renderIdentity },
    { id: 'categories', icon: '❖', label: 'Categories', render: renderCategories },
  ] },
  { group: 'Content', items: [
    { id: 'places', icon: '⌖', label: 'Places', render: renderPlaces },
    { id: 'events', icon: '◷', label: 'Events', render: renderEvents },
    { id: 'trips', icon: '❯', label: 'Trips', render: renderTrips },
  ] },
  { group: 'Data sources', items: [
    { id: 'albums', icon: '♪', label: 'Albums', render: renderAlbums },
    { id: 'concerts', icon: '▲', label: 'Concerts', render: renderConcerts },
    { id: 'audience', icon: '◵', label: 'Audience map', render: renderAudience },
    { id: 'moderate', icon: '⚑', label: 'Moderation', render: renderModeration },
  ] },
  { group: 'People', items: [
    { id: 'guides', icon: '🎫', label: 'Tour guides', render: renderGuides },
  ] },
  { group: 'System', items: [
    { id: 'backup', icon: '⬇', label: 'Backup & import', render: renderBackup, sysadmin: true },
  ] },
];
// Guides get a focused console: their tours + payouts.
const GUIDE_SECTIONS = [
  { group: 'Tours', items: [
    { id: 'overview', icon: '◎', label: 'Overview', render: renderOverview },
    { id: 'trips', icon: '❯', label: 'My tours', render: renderTrips },
    { id: 'payouts', icon: '£', label: 'Payouts', render: renderPayouts },
  ] },
];

export function renderAdmin(container, state, helpers) {
  const access = helpers.access || ((getRole() && getRole() !== 'fan') ? 'full' : 'denied');
  if (access === 'denied') {
    container.innerHTML = `
      <div class="admin-denied">
        <h2>No admin access</h2>
        <p class="modal-text">Your account doesn't have admin, editor or guide rights for
        ${escHtml(state.band.name)}. Apply from your account to get involved.</p>
        <button class="btn btn-primary" data-back>← Back to atlas</button>
      </div>`;
    container.querySelector('[data-back]').addEventListener('click', helpers.onClose);
    return;
  }

  const role = getRole();
  const isSysadmin = role === 'admin' || role === 'local-admin';
  const groups = (access === 'guide' ? GUIDE_SECTIONS : SECTIONS)
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.sysadmin || isSysadmin) }))
    .filter((g) => g.items.length);
  const sections = groups.flatMap((g) => g.items);
  const roleLabel = access === 'guide' ? '🎫 Tour Guide'
    : role === 'local-admin' ? 'local preview' : escHtml(role || 'editor');

  const theme = state.band.themes[state.mode] || state.band.themes.dark;
  let current = 'overview';

  container.innerHTML = `
    <div class="admin-shell">
      <header class="admin-topbar">
        <button class="admin-back" data-back aria-label="Back to atlas">← Atlas</button>
        <div class="admin-brand">
          <span class="admin-mark" style="background:linear-gradient(135deg, ${theme.accent}, ${theme.accent2})"></span>
          <div class="admin-brand-text"><strong>${escHtml(state.band.name)}</strong><span>${access === 'guide' ? 'Tour studio' : 'Admin console'}</span></div>
        </div>
        <span class="admin-status" id="admin-status" data-state="idle"></span>
        <span class="role-pill admin-role">${roleLabel}</span>
      </header>
      <div class="admin-main">
        <nav class="admin-nav" aria-label="Admin sections">
          ${groups.map((g) => `
            <div class="admin-nav-group">${escHtml(g.group)}</div>
            ${g.items.map((s) => `
              <button class="admin-nav-item" data-section="${s.id}">
                <span class="admin-nav-icon">${s.icon}</span>${escHtml(s.label)}
              </button>`).join('')}`).join('')}
        </nav>
        <div class="admin-pane" id="admin-pane"></div>
      </div>
    </div>`;

  const pane = container.querySelector('#admin-pane');
  const status = container.querySelector('#admin-status');
  const ctx = { state, role, access, user: helpers.user, bandRole: helpers.bandRole, helpers };
  ctx.setStatus = (s) => {
    status.dataset.state = s;
    status.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved ✓' : s === 'error' ? 'Save failed' : '';
    if (s === 'saved') setTimeout(() => {
      if (status.dataset.state === 'saved') { status.dataset.state = 'idle'; status.textContent = ''; }
    }, 2200);
  };
  const renderCurrent = () => {
    for (const b of container.querySelectorAll('.admin-nav-item')) {
      b.classList.toggle('admin-nav-item--on', b.dataset.section === current);
    }
    pane.scrollTop = 0;
    pane.innerHTML = '';
    (sections.find((s) => s.id === current) || sections[0])?.render(pane, ctx);
  };
  ctx.go = (id) => { current = id; renderCurrent(); pane.scrollTo?.({ top: 0 }); };

  for (const b of container.querySelectorAll('.admin-nav-item')) {
    b.addEventListener('click', () => ctx.go(b.dataset.section));
  }
  container.querySelector('[data-back]').addEventListener('click', helpers.onClose);
  renderCurrent();
}
