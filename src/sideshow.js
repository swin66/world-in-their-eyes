// Sideshows: guided, non-location "exhibits" — a swipeable card carousel for
// things that aren't on the map (gear, artwork, themes). Same lean-back spirit
// as a trip, but it takes over the screen instead of moving the globe.

let active = null;

export function openSideshow(def, { onComplete } = {}) {
  const root = document.getElementById('sideshow');
  let index = 0;
  let completed = false;

  const render = () => {
    const card = def.cards[index];
    root.innerHTML = `
      <div class="sideshow-inner">
        <header class="sideshow-head">
          <span class="sideshow-emoji">${def.emoji || '✦'}</span>
          <div>
            <h2>${def.title}</h2>
            <p>${index + 1} of ${def.cards.length}</p>
          </div>
          <button class="sideshow-close" aria-label="Close">✕</button>
        </header>
        <div class="sideshow-progress">
          ${def.cards.map((_, i) => `<span class="${i <= index ? 'on' : ''}"></span>`).join('')}
        </div>
        <div class="sideshow-card" id="sideshow-card" style="--dir:${0}">
          <span class="sideshow-card-sub">${card.subtitle || ''}</span>
          <h3>${card.title}</h3>
          <p>${card.body}</p>
        </div>
        <div class="sideshow-nav">
          <button class="trip-nav" id="ss-prev" aria-label="Previous" ${index === 0 ? 'disabled' : ''}>‹</button>
          <button class="btn btn-primary" id="ss-next">
            ${index === def.cards.length - 1 ? 'Finish' : 'Next'}</button>
        </div>
      </div>`;
    root.querySelector('.sideshow-close').addEventListener('click', close);
    root.querySelector('#ss-prev').addEventListener('click', () => go(-1));
    root.querySelector('#ss-next').addEventListener('click', () => go(1));
  };

  const go = (delta) => {
    const next = index + delta;
    if (next < 0) return;
    if (next >= def.cards.length) { finish(); return; }
    index = next;
    render();
    const el = root.querySelector('#sideshow-card');
    el.style.setProperty('--dir', delta > 0 ? '24px' : '-24px');
    el.classList.add('sideshow-card-in');
  };

  const finish = () => {
    if (!completed) { completed = true; onComplete?.(def); }
    close();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };

  // Swipe support
  let startX = null;
  const onDown = (e) => { startX = e.clientX; };
  const onUp = (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  };

  function close() {
    root.classList.remove('sideshow-open');
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointerup', onUp);
    active = null;
  }

  active = { close };
  render();
  root.classList.add('sideshow-open');
  document.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', onUp);
}

export function closeSideshow() {
  active?.close();
}
