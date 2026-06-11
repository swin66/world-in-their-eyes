// Band admin panel. Two tabs:
//  - Theme: edit dark/light palettes + default mode. Saves to the database
//    when signed in as admin with Supabase configured; otherwise downloads an
//    updated band.json to commit to the repo (the free-tier workflow).
//  - Import: pull a band's full discography from MusicBrainz (free, no key)
//    into draft places, with pointers to the setlist.fm + AI enrichment scripts.
import { supabase } from './supabase.js';
import { getRole } from './auth.js';

const THEME_KEYS = ['accent', 'accent2', 'bg', 'surface', 'text'];

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function renderAdmin(container, state, helpers) {
  const role = getRole();
  if (!role || role === 'fan') {
    container.innerHTML = `
      <h2>Admin tools</h2>
      <p class="modal-text">Your account doesn't have admin or editor access for
      ${state.band.name}. Ask the atlas owner to upgrade your role.</p>
      <button class="btn btn-primary" data-close>Close</button>`;
    container.querySelector('[data-close]').addEventListener('click', helpers.onClose);
    return;
  }
  let tab = 'theme';
  const render = () => {
    container.innerHTML = `
      <h2>Admin tools <span class="role-pill">${role === 'local-admin' ? 'local preview' : role}</span></h2>
      <div class="admin-tabs">
        <button class="admin-tab ${tab === 'theme' ? 'admin-tab-active' : ''}" data-tab="theme">Theme</button>
        <button class="admin-tab ${tab === 'places' ? 'admin-tab-active' : ''}" data-tab="places">Places</button>
        <button class="admin-tab ${tab === 'import' ? 'admin-tab-active' : ''}" data-tab="import">Import</button>
      </div>
      <div id="admin-body"></div>`;
    for (const btn of container.querySelectorAll('.admin-tab')) {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render(); });
    }
    const body = container.querySelector('#admin-body');
    if (tab === 'theme') renderThemeTab(body, state, helpers, role);
    else if (tab === 'places') renderPlacesTab(body, state, helpers, role);
    else renderImportTab(body, state, helpers, role);
  };
  render();
}

function renderThemeTab(body, state, { toast, setMode, onClose }, role) {
  const band = state.band;
  body.innerHTML = `
    <p class="modal-text dim">Colours apply per mode. Preview updates the app live;
    Save ${supabase && role === 'admin' ? 'writes to the database' : 'downloads a band.json to commit'}.</p>
    <div class="theme-grid">
      <span></span><span class="theme-col-head">Dark</span><span class="theme-col-head">Light</span>
      ${THEME_KEYS.map((k) => `
        <span>${k}</span>
        <input type="color" data-mode="dark" data-key="${k}" value="${band.themes.dark[k]}">
        <input type="color" data-mode="light" data-key="${k}" value="${band.themes.light[k]}">
      `).join('')}
    </div>
    <div class="admin-row">
      <span>Default mode</span>
      <select id="default-mode">
        <option value="dark" ${band.defaultMode === 'dark' ? 'selected' : ''}>Dark</option>
        <option value="light" ${band.defaultMode === 'light' ? 'selected' : ''}>Light</option>
      </select>
    </div>
    <div class="sheet-actions">
      <button class="btn" data-preview>Preview</button>
      <button class="btn btn-primary" data-save>Save theme</button>
    </div>`;

  const collect = () => {
    for (const input of body.querySelectorAll('input[type="color"]')) {
      band.themes[input.dataset.mode][input.dataset.key] = input.value;
    }
    band.defaultMode = body.querySelector('#default-mode').value;
  };
  body.querySelector('[data-preview]').addEventListener('click', () => {
    collect();
    setMode(state.mode);
    toast('Previewing theme — Save to keep it');
  });
  body.querySelector('[data-save]').addEventListener('click', async () => {
    collect();
    if (supabase && role === 'admin') {
      const { error } = await supabase.from('bands')
        .update({ config: band }).eq('slug', band.slug);
      toast(error ? `Save failed: ${error.message}` : 'Theme saved for everyone');
    } else {
      download('band.json', band);
      toast('band.json downloaded — replace public/data/band.json and deploy');
    }
    setMode(state.mode);
  });
}

function renderPlacesTab(body, state, { toast, refreshData }, role) {
  const places = state.places.features;
  let editing = null;

  const persist = async (feature) => {
    refreshData?.();
    if (supabase && (role === 'admin' || role === 'editor')) {
      const p = feature.properties;
      const { error } = await supabase.from('places').upsert({
        id: p.id, band_slug: state.band.slug, title: p.title, category: p.category,
        year: p.year, summary: p.summary, story: p.story,
        lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1],
        approx: Boolean(p.approx), artist_id: p.artistId || null,
      });
      toast(error ? `Save failed: ${error.message}` : 'Saved for everyone');
    } else {
      toast('Applied locally — use “Download places.json” to keep changes');
    }
  };

  const renderList = () => {
    const q = body.querySelector('#place-search')?.value?.toLowerCase() || '';
    const list = body.querySelector('#place-list');
    list.innerHTML = places
      .filter((f) => f.properties.title.toLowerCase().includes(q))
      .sort((a, b) => a.properties.year - b.properties.year)
      .map((f) => `<label data-id="${f.properties.id}" style="cursor:pointer">
          ${f.properties.title}<span class="import-year">${f.properties.year}</span></label>`)
      .join('');
    for (const row of list.querySelectorAll('label')) {
      row.addEventListener('click', () => {
        editing = places.find((f) => f.properties.id === row.dataset.id);
        renderEditor();
      });
    }
  };

  const renderEditor = () => {
    const f = editing;
    const p = f.properties;
    const editor = body.querySelector('#place-editor');
    const others = places.filter((x) => x.properties.id !== p.id);
    editor.innerHTML = `
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
      <div class="admin-row"><span style="min-width:62px">Title</span>
        <input type="text" id="pe-title" value="${p.title.replaceAll('"', '&quot;')}"></div>
      <div class="admin-row"><span style="min-width:62px">Category</span>
        <select id="pe-category">${Object.entries(state.band.categories)
          .map(([k, c]) => `<option value="${k}" ${k === p.category ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
        <span>Year</span><input type="text" id="pe-year" value="${p.year}" style="flex:0 0 70px"></div>
      <div class="admin-row"><span style="min-width:62px">Summary</span>
        <input type="text" id="pe-summary" value="${(p.summary || '').replaceAll('"', '&quot;')}"></div>
      <div class="admin-row"><span style="min-width:62px">Story</span>
        <textarea id="pe-story" rows="4" style="flex:1;background:color-mix(in srgb, var(--text) 7%, transparent);border:1px solid var(--line);border-radius:10px;padding:9px 12px;color:var(--text);font:inherit;font-size:13px">${p.story || ''}</textarea></div>
      <div class="admin-row"><span style="min-width:62px">Lng / Lat</span>
        <input type="text" id="pe-lng" value="${f.geometry.coordinates[0]}">
        <input type="text" id="pe-lat" value="${f.geometry.coordinates[1]}"></div>
      <div class="admin-row"><span style="min-width:62px">Group with</span>
        <select id="pe-group">
          <option value="">— keep own location —</option>
          ${others.map((x) => `<option value="${x.properties.id}">${x.properties.title} (${x.properties.year})</option>`).join('')}
        </select></div>
      <p class="modal-text dim">“Group with” snaps this item to another place's exact spot,
      so they cluster into one hotspot that opens as a story wall.</p>
      <div class="sheet-actions">
        <button class="btn" id="pe-center">Use map centre</button>
        <button class="btn btn-primary" id="pe-save">Save place</button>
      </div>`;
    editor.querySelector('#pe-center').addEventListener('click', () => {
      const c = state.map.getCenter();
      editor.querySelector('#pe-lng').value = c.lng.toFixed(5);
      editor.querySelector('#pe-lat').value = c.lat.toFixed(5);
    });
    editor.querySelector('#pe-group').addEventListener('change', (e) => {
      const target = places.find((x) => x.properties.id === e.target.value);
      if (target) {
        editor.querySelector('#pe-lng').value = target.geometry.coordinates[0];
        editor.querySelector('#pe-lat').value = target.geometry.coordinates[1];
      }
    });
    editor.querySelector('#pe-save').addEventListener('click', () => {
      p.title = editor.querySelector('#pe-title').value;
      p.category = editor.querySelector('#pe-category').value;
      p.year = Number(editor.querySelector('#pe-year').value) || p.year;
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

  body.innerHTML = `
    <div class="admin-row">
      <input type="text" id="place-search" placeholder="Search ${places.length} places…">
      <button class="btn" id="places-download" style="flex:0 0 auto">Download places.json</button>
    </div>
    <div class="import-list" id="place-list"></div>
    <div id="place-editor"></div>`;
  body.querySelector('#place-search').addEventListener('input', renderList);
  body.querySelector('#places-download').addEventListener('click', () => {
    download('places.json', state.places);
    toast('places.json downloaded — replace public/data/places.json and deploy');
  });
  renderList();
}

function renderImportTab(body, state, { toast }, role) {
  body.innerHTML = `
    <p class="modal-text dim">Pull existing data about any artist from free, open sources.
    Imported items arrive as drafts at the band's home location, flagged approximate,
    ready for you to refine.</p>
    <div class="admin-row">
      <input type="text" id="mb-artist" placeholder="Artist name (e.g. Depeche Mode)" value="${state.band.name}">
      <button class="btn" id="mb-search" style="flex:0 0 auto">Find releases</button>
    </div>
    <div id="mb-results"></div>
    <p class="modal-text dim">More importers (run locally, free keys):
    <strong>npm run import:setlistfm</strong> — every concert ever played, grouped by venue
    (setlist.fm API key) · <strong>npm run enrich</strong> — AI-written stories for imported
    places via the Claude API.</p>`;

  body.querySelector('#mb-search').addEventListener('click', async () => {
    const name = body.querySelector('#mb-artist').value.trim();
    const results = body.querySelector('#mb-results');
    if (!name) return;
    results.innerHTML = '<p class="modal-text dim">Searching MusicBrainz…</p>';
    try {
      const search = await fetch(
        `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(name)}&fmt=json&limit=1`,
      ).then((r) => r.json());
      const artist = search.artists?.[0];
      if (!artist) { results.innerHTML = '<p class="modal-text">No artist found.</p>'; return; }
      const rgs = await fetch(
        `https://musicbrainz.org/ws/2/release-group?artist=${artist.id}&type=album&fmt=json&limit=100`,
      ).then((r) => r.json());
      const albums = (rgs['release-groups'] || [])
        .filter((rg) => rg['primary-type'] === 'Album' && rg['first-release-date'])
        .sort((a, b) => a['first-release-date'].localeCompare(b['first-release-date']));
      if (!albums.length) { results.innerHTML = '<p class="modal-text">No releases found.</p>'; return; }
      results.innerHTML = `
        <div class="import-list">
          ${albums.map((a, i) => `
            <label><input type="checkbox" data-i="${i}" checked>
              ${a.title}<span class="import-year">${a['first-release-date'].slice(0, 4)}</span></label>`).join('')}
        </div>
        <button class="btn btn-primary" id="mb-generate" style="width:100%">
          Generate draft places</button>`;
      results.querySelector('#mb-generate').addEventListener('click', async () => {
        const chosen = [...results.querySelectorAll('input:checked')]
          .map((cb) => albums[Number(cb.dataset.i)]);
        const features = chosen.map((a) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: state.band.map.center },
          properties: {
            id: `release-${a.id.slice(0, 8)}`,
            title: a.title,
            category: 'release',
            year: Number(a['first-release-date'].slice(0, 4)),
            approx: true,
            summary: `Released ${a['first-release-date']}.`,
            story: `Imported from MusicBrainz — move this marker to where it was recorded and add the story (or run npm run enrich).`,
          },
        }));
        if (supabase && (role === 'admin' || role === 'editor')) {
          const { error } = await supabase.from('places').upsert(features.map((f) => ({
            id: f.properties.id, band_slug: state.band.slug, title: f.properties.title,
            category: 'release', year: f.properties.year, summary: f.properties.summary,
            story: f.properties.story, lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1], approx: true,
          })));
          toast(error ? `Import failed: ${error.message}` : `${features.length} draft places added — reload to see them`);
        } else {
          download('places-import.json', { type: 'FeatureCollection', features });
          toast(`${features.length} drafts downloaded — merge into places.json`);
        }
      });
    } catch (err) {
      results.innerHTML = `<p class="modal-text">Import failed: ${err.message}</p>`;
    }
  });
}
