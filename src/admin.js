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
        <button class="admin-tab ${tab === 'trips' ? 'admin-tab-active' : ''}" data-tab="trips">Trips</button>
        <button class="admin-tab ${tab === 'import' ? 'admin-tab-active' : ''}" data-tab="import">Import</button>
        <button class="admin-tab ${tab === 'moderate' ? 'admin-tab-active' : ''}" data-tab="moderate">Moderation</button>
      </div>
      <div id="admin-body"></div>`;
    for (const btn of container.querySelectorAll('.admin-tab')) {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render(); });
    }
    const body = container.querySelector('#admin-body');
    if (tab === 'theme') renderThemeTab(body, state, helpers, role);
    else if (tab === 'places') renderPlacesTab(body, state, helpers, role);
    else if (tab === 'trips') renderTripsTab(body, state, helpers, role);
    else if (tab === 'moderate') renderModerationTab(body, state, helpers, role);
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

function renderTripsTab(body, state, { toast }, role) {
  let editing = null; // a trip object being edited (live ref or a fresh one)

  const persist = async (trip) => {
    if (supabase && (role === 'admin' || role === 'editor')) {
      const { error } = await supabase.from('trips').upsert({
        id: trip.id, band_slug: state.band.slug, emoji: trip.emoji, title: trip.title,
        description: trip.description, badge: trip.badge, stops: trip.stops,
        position: state.trips.indexOf(trip),
      });
      toast(error ? `Save failed: ${error.message}` : 'Trip saved for everyone');
    } else {
      download('trips.json', { trips: state.trips });
      toast('trips.json downloaded — replace public/data/trips.json and deploy');
    }
  };

  const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const placeTitle = (id) =>
    state.places.features.find((f) => f.properties.id === id)?.properties.title || id;

  const renderEditor = () => {
    const t = editing;
    const editor = body.querySelector('#trip-editor');
    if (!t) { editor.innerHTML = ''; return; }
    editor.innerHTML = `
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
      <div class="admin-row"><span style="min-width:62px">Emoji</span>
        <input type="text" id="te-emoji" value="${t.emoji || '📍'}" style="flex:0 0 64px">
        <span>Title</span><input type="text" id="te-title" value="${(t.title || '').replaceAll('"', '&quot;')}"></div>
      <div class="admin-row"><span style="min-width:62px">Blurb</span>
        <input type="text" id="te-desc" value="${(t.description || '').replaceAll('"', '&quot;')}"></div>
      <div class="admin-row"><span style="min-width:62px">Badge</span>
        <input type="text" id="te-badge" value="${(t.badge || '').replaceAll('"', '&quot;')}"
          placeholder="Badge name awarded on completion"></div>
      <div class="admin-row">
        <select id="te-add-place">
          <option value="">Add a stop…</option>
          ${state.places.features
            .slice()
            .sort((a, b) => a.properties.year - b.properties.year)
            .map((f) => `<option value="${f.properties.id}">${f.properties.title} (${f.properties.year})</option>`)
            .join('')}
        </select>
      </div>
      <div class="import-list" id="te-stops">
        ${t.stops.map((id, i) => `
          <label data-i="${i}">
            <span style="opacity:.45">${i + 1}.</span> ${placeTitle(id)}
            <span class="import-year">
              <button class="btn-mini" data-up="${i}">↑</button>
              <button class="btn-mini" data-down="${i}">↓</button>
              <button class="btn-mini" data-del="${i}">✕</button>
            </span>
          </label>`).join('') || '<p class="modal-text dim">No stops yet — add some above.</p>'}
      </div>
      <button class="btn btn-primary" id="te-save" style="width:100%">Save trip</button>`;

    editor.querySelector('#te-add-place').addEventListener('change', (e) => {
      if (!e.target.value) return;
      t.stops.push(e.target.value);
      renderEditor();
    });
    for (const btn of editor.querySelectorAll('[data-up]')) {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.up);
        if (i > 0) [t.stops[i - 1], t.stops[i]] = [t.stops[i], t.stops[i - 1]];
        renderEditor();
      });
    }
    for (const btn of editor.querySelectorAll('[data-down]')) {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.down);
        if (i < t.stops.length - 1) [t.stops[i + 1], t.stops[i]] = [t.stops[i], t.stops[i + 1]];
        renderEditor();
      });
    }
    for (const btn of editor.querySelectorAll('[data-del]')) {
      btn.addEventListener('click', () => {
        t.stops.splice(Number(btn.dataset.del), 1);
        renderEditor();
      });
    }
    editor.querySelector('#te-save').addEventListener('click', () => {
      t.emoji = editor.querySelector('#te-emoji').value || '📍';
      t.title = editor.querySelector('#te-title').value.trim();
      t.description = editor.querySelector('#te-desc').value.trim();
      t.badge = editor.querySelector('#te-badge').value.trim();
      if (!t.title || t.stops.length < 2) { toast('A trip needs a title and at least 2 stops'); return; }
      if (!t.id) t.id = slugify(t.title);
      if (!state.trips.includes(t)) state.trips.push(t);
      persist(t);
      renderList();
    });
  };

  const renderList = () => {
    const list = body.querySelector('#trip-admin-list');
    list.innerHTML = state.trips.map((t) => `
      <label data-id="${t.id}" style="cursor:pointer">${t.emoji} ${t.title}
        <span class="import-year">${t.stops.length} stops</span></label>`).join('');
    for (const row of list.querySelectorAll('label')) {
      row.addEventListener('click', () => {
        editing = state.trips.find((t) => t.id === row.dataset.id);
        renderEditor();
      });
    }
  };

  body.innerHTML = `
    <p class="modal-text dim">Build custom journeys — an album in order, a tour leg, a member's
    story. Trips appear instantly in the 🧭 picker.</p>
    <div class="admin-row">
      <button class="btn" id="trip-new" style="flex:1">＋ New trip</button>
      <button class="btn" id="trips-download" style="flex:1">Download trips.json</button>
    </div>
    <div class="import-list" id="trip-admin-list"></div>
    <div id="trip-editor"></div>`;
  body.querySelector('#trip-new').addEventListener('click', () => {
    editing = { id: '', emoji: '📍', title: '', description: '', badge: '', stops: [] };
    renderEditor();
  });
  body.querySelector('#trips-download').addEventListener('click', () => {
    download('trips.json', { trips: state.trips });
    toast('trips.json downloaded — replace public/data/trips.json and deploy');
  });
  renderList();
  renderEditor();
}

function renderModerationTab(body, state, { toast }, role) {
  if (!supabase) {
    body.innerHTML = `
      <p class="modal-text">Moderation needs the cloud backend. Fan submissions only
      reach other people once Supabase is connected — until then everything stays on
      each fan's own device, so there's nothing to review.</p>
      <p class="modal-text dim">Set up Supabase (see the README), sign in as admin or
      editor, and this tab becomes the approval queue for memories, photos, ticket
      stubs and links.</p>`;
    return;
  }

  const placeTitle = (id) =>
    state.places.features.find((f) => f.properties.id === id)?.properties.title || id;

  const load = async () => {
    body.innerHTML = '<p class="modal-text dim">Loading pending submissions…</p>';
    const { data, error } = await supabase
      .from('memories')
      .select('id, place_id, kind, body, photo_url, link_url, created_at')
      .eq('approved', false)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) {
      body.innerHTML = `<p class="modal-text">Couldn't load the queue: ${error.message}</p>`;
      return;
    }
    if (!data.length) {
      body.innerHTML = '<p class="modal-text dim">Queue is clear — nothing awaiting review. 🎉</p>';
      return;
    }
    body.innerHTML = `
      <p class="modal-text dim">${data.length} submission${data.length > 1 ? 's' : ''} awaiting review.
      Approved items become visible to everyone; rejected ones are deleted.</p>
      <div class="memories-list">
        ${data.map((m) => `
          <article class="memory" data-id="${m.id}">
            <span class="memory-kind">${m.kind || 'memory'} · ${placeTitle(m.place_id)} ·
              ${new Date(m.created_at).toLocaleDateString()}</span>
            ${m.body ? `<p>${m.body}</p>` : ''}
            ${m.photo_url ? `<img src="${m.photo_url}" alt="" loading="lazy">` : ''}
            ${m.link_url ? `<a href="${m.link_url}" target="_blank" rel="noopener">${m.link_url}</a>` : ''}
            <div class="sheet-actions" style="margin-top:10px">
              <button class="btn" data-reject>Reject</button>
              <button class="btn btn-primary" data-approve>Approve</button>
            </div>
          </article>`).join('')}
      </div>`;
    for (const card of body.querySelectorAll('.memory')) {
      const id = card.dataset.id;
      card.querySelector('[data-approve]').addEventListener('click', async () => {
        const { error: err } = await supabase.from('memories')
          .update({ approved: true }).eq('id', id);
        toast(err ? `Approve failed: ${err.message}` : 'Approved — now public');
        if (!err) card.remove();
      });
      card.querySelector('[data-reject]').addEventListener('click', async () => {
        const { error: err } = await supabase.from('memories').delete().eq('id', id);
        toast(err ? `Reject failed: ${err.message}` : 'Rejected and removed');
        if (!err) card.remove();
      });
    }
  };
  load();
}

function renderImportTab(body, state, { toast }, role) {
  const LS_SFM = 'wite:import:setlistfm';
  let savedSfmKey = localStorage.getItem(LS_SFM) || '';
  let importSource = 'releases';

  const renderSource = () => {
    body.querySelector('#import-body').innerHTML = '';
    if (importSource === 'releases') renderReleasesImport(body.querySelector('#import-body'), state, toast, role);
    else renderConcertsImport(body.querySelector('#import-body'), state, toast, role, savedSfmKey, (k) => {
      savedSfmKey = k;
      localStorage.setItem(LS_SFM, k);
    });
  };

  body.innerHTML = `
    <p class="modal-text dim">Pull data from free public sources — imports arrive as draft
    places flagged <em>approximate</em>, ready for you to refine on the map.</p>
    <div class="admin-tabs" style="margin-bottom:12px">
      <button class="admin-tab admin-tab-active" data-src="releases">🎵 Albums</button>
      <button class="admin-tab" data-src="concerts">🎤 Concert venues</button>
    </div>
    <div id="import-body"></div>`;

  for (const btn of body.querySelectorAll('[data-src]')) {
    btn.addEventListener('click', () => {
      body.querySelectorAll('[data-src]').forEach((b) => b.classList.remove('admin-tab-active'));
      btn.classList.add('admin-tab-active');
      importSource = btn.dataset.src;
      renderSource();
    });
  }
  renderSource();
}

async function mbFindArtist(name) {
  const res = await fetch(
    `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(name)}&fmt=json&limit=1`,
    { headers: { 'User-Agent': 'WorldInTheirEyes/1.0 (wite-app)' } },
  ).then((r) => r.json());
  return res.artists?.[0] ?? null;
}

async function persistPlaces(places, bandSlug, supabaseClient, role, download, toast) {
  if (supabaseClient && (role === 'admin' || role === 'editor')) {
    const { error } = await supabaseClient.from('places').upsert(
      places.map((f) => ({
        id: f.properties.id, band_slug: bandSlug,
        title: f.properties.title, category: f.properties.category,
        year: f.properties.year, summary: f.properties.summary,
        story: f.properties.story,
        lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
        approx: true,
      })),
    );
    toast(error ? `Import failed: ${error.message}` : `${places.length} draft places saved — reload the map to see them`);
  } else {
    download('places-import.json', { type: 'FeatureCollection', features: places });
    toast(`${places.length} drafts downloaded — merge into places.json and redeploy`);
  }
}

function renderReleasesImport(body, state, toast, role) {
  body.innerHTML = `
    <p class="modal-text dim">Albums from <strong>MusicBrainz</strong> — free, no key needed.
    Each release becomes a draft place at the band's home coordinates; move it to the
    recording studio on the map.</p>
    <div class="admin-row">
      <input type="text" id="mb-artist" value="${state.band.name}" placeholder="Artist name">
      <button class="btn btn-primary" id="mb-search" style="flex:0 0 auto">Search</button>
    </div>
    <div id="mb-results"></div>`;

  body.querySelector('#mb-search').addEventListener('click', async () => {
    const name = body.querySelector('#mb-artist').value.trim();
    const results = body.querySelector('#mb-results');
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
        <p class="modal-text dim">${albums.length} albums found for <strong>${artist.name}</strong>.
          <button class="btn-mini" id="mb-all">All</button>
          <button class="btn-mini" id="mb-none">None</button></p>
        <div class="import-list">
          ${albums.map((a, i) => `
            <label><input type="checkbox" data-i="${i}" checked>
              ${a.title}<span class="import-year">${a['first-release-date'].slice(0, 4)}</span>
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
            id: `mb-release-${a.id.slice(0, 8)}`,
            title: a.title, category: 'release',
            year: +a['first-release-date'].slice(0, 4),
            summary: `Album released ${a['first-release-date']}.`,
            story: 'Imported from MusicBrainz. Move this pin to the recording studio and add the story.',
          },
        }));
        await persistPlaces(features, state.band.slug, supabase, role, download, toast);
      });
    } catch (err) {
      results.innerHTML = `<p class="modal-text">Error: ${err.message}</p>`;
    }
  });
}

function renderConcertsImport(body, state, toast, role, savedKey, saveKey) {
  body.innerHTML = `
    <p class="modal-text dim">Concert venues from <strong>Setlist.fm</strong> — free API key,
    real venue coordinates. Each unique venue becomes one <em>Live</em> place on the map
    with a count of how many times the band played there.</p>
    <div class="admin-row">
      <input type="text" id="sfm-key" placeholder="Setlist.fm API key" value="${savedKey}"
        style="font-family:monospace;font-size:12px">
      <a href="https://www.setlist.fm/settings/api" target="_blank" rel="noopener"
        class="btn" style="flex:0 0 auto;white-space:nowrap">Get free key ↗</a>
    </div>
    <div class="admin-row">
      <input type="text" id="sfm-artist" value="${state.band.name}" placeholder="Artist name">
      <input type="number" id="sfm-pages" value="5" min="1" max="50" style="flex:0 0 64px" title="Pages to fetch (20 shows each)">
      <button class="btn btn-primary" id="sfm-search" style="flex:0 0 auto">Search</button>
    </div>
    <p class="modal-text dim" style="margin-top:0">Pages × 20 = shows fetched. 5 pages = 100 most recent shows.</p>
    <div id="sfm-results"></div>`;

  body.querySelector('#sfm-key').addEventListener('change', (e) => saveKey(e.target.value.trim()));

  body.querySelector('#sfm-search').addEventListener('click', async () => {
    const key = body.querySelector('#sfm-key').value.trim();
    const artist = body.querySelector('#sfm-artist').value.trim();
    const pages = Math.min(50, Math.max(1, +body.querySelector('#sfm-pages').value || 5));
    const results = body.querySelector('#sfm-results');
    if (!key) { toast('Enter your Setlist.fm API key first'); return; }
    if (!artist) return;
    saveKey(key);

    results.innerHTML = '<p class="modal-text dim">Fetching setlists…</p>';

    try {
      const venueMap = new Map(); // venue.id → { venue, shows: [{date, url}] }

      for (let p = 1; p <= pages; p++) {
        results.querySelector('p').textContent = `Fetching page ${p} of ${pages}…`;
        const data = await fetch(
          `https://api.setlist.fm/rest/1.0/search/setlists?artistName=${encodeURIComponent(artist)}&p=${p}`,
          { headers: { 'x-api-key': key, 'Accept': 'application/json' } },
        ).then((r) => {
          if (r.status === 401) throw new Error('Invalid API key');
          if (r.status === 404) throw new Error('Artist not found on Setlist.fm');
          if (!r.ok) throw new Error(`Setlist.fm error ${r.status}`);
          return r.json();
        });

        for (const sl of data.setlist || []) {
          if (!sl.venue?.city?.coords) continue; // skip venues with no coords
          const vid = sl.venue.id;
          if (!venueMap.has(vid)) {
            venueMap.set(vid, { venue: sl.venue, shows: [] });
          }
          venueMap.get(vid).shows.push({ date: sl.eventDate, url: sl.url });
        }

        const total = data.total ?? 0;
        const maxPage = Math.ceil(total / 20);
        if (p >= maxPage) break; // no more pages
      }

      if (!venueMap.size) {
        results.innerHTML = '<p class="modal-text">No shows with venue coordinates found.</p>';
        return;
      }

      const venues = [...venueMap.values()].sort((a, b) => b.shows.length - a.shows.length);
      results.innerHTML = `
        <p class="modal-text dim">${venues.length} unique venues found across ${venues.reduce((s, v) => s + v.shows.length, 0)} shows.
          <button class="btn-mini" id="sfm-all">All</button>
          <button class="btn-mini" id="sfm-none">None</button></p>
        <div class="import-list">
          ${venues.map((v, i) => {
            const city = v.venue.city;
            const label = `${v.venue.name}, ${city.name}, ${city.country.name}`;
            const years = v.shows.map((s) => +s.date.split('-').pop()).sort();
            const yearRange = years[0] === years[years.length - 1] ? years[0] : `${years[0]}–${years[years.length - 1]}`;
            return `<label><input type="checkbox" data-i="${i}" checked>
              ${label}
              <span class="import-year">${v.shows.length} show${v.shows.length > 1 ? 's' : ''} · ${yearRange}</span>
            </label>`;
          }).join('')}
        </div>
        <button class="btn btn-primary" id="sfm-import" style="width:100%;margin-top:10px">
          Import selected venues as places</button>`;

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
          const firstYear = years[0];
          const shows = v.shows.length;
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [+city.coords.long, +city.coords.lat] },
            properties: {
              id: `sfm-venue-${v.venue.id}`,
              title: `${v.venue.name}, ${city.name}`,
              category: 'gig',
              year: firstYear,
              summary: `${shows} show${shows > 1 ? 's' : ''} at this venue · ${city.name}, ${city.country.name}`,
              story: `Played here ${shows} time${shows > 1 ? 's' : ''}. Setlist.fm: ${v.shows[0].url}`,
            },
          };
        });
        await persistPlaces(features, state.band.slug, supabase, role, download, toast);
      });
    } catch (err) {
      results.innerHTML = `<p class="modal-text">Error: ${err.message}</p>`;
    }
  });
}
