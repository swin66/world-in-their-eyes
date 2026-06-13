// Band selector — shown at the root URL when no band slug is in the URL.
// Fetches /data/bands.json and renders a full-screen atlas picker.

export async function showSelector() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.id = 'selector';
    el.innerHTML = `
      <div class="sel-inner">
        <header class="sel-header">
          <div class="sel-logo">◆</div>
          <h1>World in Their Eyes</h1>
          <p class="sel-sub">Fan atlases for artists who shaped the world</p>
        </header>
        <div class="sel-bands" id="sel-bands">
          <div class="sel-loading">
            <span class="sel-spin">◆</span> Loading…
          </div>
        </div>
        <footer class="sel-footer">Powered by World in Their Eyes</footer>
      </div>`;

    document.body.appendChild(el);
    // Trigger CSS entry animation
    requestAnimationFrame(() => el.classList.add('sel-visible'));

    fetch('/data/bands.json')
      .then((r) => r.json())
      .then((bands) => renderBands(bands, el, resolve))
      .catch(() => { el.remove(); resolve('depeche-mode'); });
  });
}

function renderBands(bands, el, resolve) {
  const live = bands.filter((b) => b.status !== 'hidden');
  document.getElementById('sel-bands').innerHTML = live.map((b) => `
    <button class="band-card" data-slug="${b.slug}">
      <div class="band-card-img-wrap">
        ${b.coverImage
          ? `<img src="${b.coverImage}" alt="${b.name}" class="band-card-img">`
          : `<div class="band-card-placeholder" style="--c:${b.accentColor || '#888'}">◆</div>`}
        <div class="band-card-overlay"></div>
      </div>
      <div class="band-card-body">
        <strong>${b.name}</strong>
        ${b.description ? `<span>${b.description}</span>` : ''}
        ${b.placeCount ? `<em>${b.placeCount} places on the map</em>` : ''}
      </div>
      <span class="band-card-go" aria-hidden="true">Explore →</span>
    </button>`).join('');

  // "Coming soon" placeholder to invite further bands
  document.getElementById('sel-bands').innerHTML += `
    <div class="band-card band-card--soon">
      <div class="band-card-img-wrap">
        <div class="band-card-placeholder" style="--c:#555">＋</div>
      </div>
      <div class="band-card-body">
        <strong>Your band here</strong>
        <span>Fork this atlas and build one for any artist</span>
      </div>
    </div>`;

  el.querySelectorAll('.band-card[data-slug]').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.classList.add('sel-exit');
      setTimeout(() => { el.remove(); resolve(btn.dataset.slug); }, 380);
    });
  });
}
