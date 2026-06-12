// First-visit coach marks: three quick pointers at the features people miss
// (trips, the passport, search). Runs once per device, after the intro.

const STEPS = [
  {
    target: 'trips-btn',
    title: 'Take a trip 🧭',
    text: 'Guided journeys fly you stop-to-stop through the story — turn on auto-advance and it drives itself.',
  },
  {
    target: 'progress-pill',
    title: 'Your passport',
    text: 'Check in at places to earn points, badges and streaks. Visiting in person counts triple.',
  },
  {
    target: 'search-btn',
    title: 'Find anything ⌕',
    text: 'Search every place, release and gig — or just press / on a keyboard.',
  },
];

export function maybeOnboard(band) {
  const key = `wite:${band.slug}:onboarded`;
  if (localStorage.getItem(key)) return;

  let step = 0;
  let lastTarget = null;
  const card = document.createElement('div');
  card.className = 'coach';
  document.body.appendChild(card);

  const finish = () => {
    localStorage.setItem(key, '1');
    lastTarget?.classList.remove('coach-glow');
    card.remove();
  };

  const show = () => {
    lastTarget?.classList.remove('coach-glow');
    if (step >= STEPS.length) return finish();
    const s = STEPS[step];
    const target = document.getElementById(s.target);
    if (!target) return finish();
    target.classList.add('coach-glow');
    lastTarget = target;
    const rect = target.getBoundingClientRect();
    card.style.top = `${rect.bottom + 12}px`;
    card.style.right = `${Math.max(10, innerWidth - rect.right - 80)}px`;
    card.innerHTML = `
      <strong>${s.title}</strong>
      <p>${s.text}</p>
      <div class="coach-actions">
        <button class="coach-skip" data-skip>Skip</button>
        <span class="coach-dots">${STEPS.map((_, i) =>
          `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</span>
        <button class="btn btn-primary coach-next" data-next>
          ${step === STEPS.length - 1 ? 'Got it' : 'Next'}</button>
      </div>`;
    card.querySelector('[data-skip]').addEventListener('click', finish);
    card.querySelector('[data-next]').addEventListener('click', () => { step += 1; show(); });
  };
  show();
}
