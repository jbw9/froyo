// The froyo server: a retro soda-jerk holding up a cup, drawn as line art so he can move.
const MARKUP = `
<svg viewBox="0 0 160 170" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <g filter="url(#ink)">
    <g class="m-body">
      <path d="M18 170c2-26 14-46 40-54h44c26 8 38 28 40 54" fill="var(--paper)" />
      <path d="M52 120l8 50M108 120l-8 50" />
      <path d="M62 140h36l-3 30H65z" fill="var(--paper)" />
      <path d="M73 157c0-6 14-6 14 0zM76 151c0-5 8-5 8 0zM79 146c0-3 2-5 4-5" stroke-width="2.2" />
      <circle cx="61" cy="146" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="99" cy="146" r="2.2" fill="currentColor" stroke="none" />
      <path class="m-bow" d="M80 116l-13-7v14zM80 116l13-7v14z" fill="currentColor" />
    </g>
    <g class="m-arm">
      <path d="M128 136c4-14 6-26 2-40" />
      <path d="M120 98c-6 0-10 4-10 9 0 6 6 9 12 8l12-2c4-1 6-5 4-9" fill="var(--paper)" />
      <g class="m-cup">
        <path d="M106 74h36l-5 24h-26z" fill="var(--paper)" />
        <path d="M108 81h32" />
        <g class="m-swirl">
          <path d="M104 74c-2-8 6-12 20-12s22 4 20 12z" fill="var(--paper)" />
          <path d="M110 63c-1-7 5-10 14-10s15 3 14 10z" fill="var(--paper)" />
          <path d="M116 53c0-6 3-9 8-10 2-4 5-6 8-6-2 3-2 6 0 8 2 2 2 5 1 8z" fill="var(--paper)" />
        </g>
        <path class="m-spoon" d="M140 52l10-14m-2 4l5-7" />
      </g>
    </g>
    <g class="m-head">
      <path d="M57 112v-8h22v8" fill="var(--paper)" />
      <circle cx="68" cy="78" r="29" fill="var(--paper)" />
      <path d="M40 80c-6-1-8 4-6 8s6 5 8 2" fill="var(--paper)" />
      <g class="m-eyes-open" stroke="none" fill="currentColor">
        <g class="m-pupils">
          <ellipse cx="60" cy="80" rx="2.8" ry="3.4" />
          <ellipse cx="79" cy="80" rx="2.8" ry="3.4" />
        </g>
      </g>
      <path class="m-eyes-happy" d="M55 81c2-4 7-4 9 0M74 81c2-4 7-4 9 0" />
      <ellipse cx="54" cy="90" rx="4.5" ry="2.6" fill="var(--blush)" stroke="none" opacity=".75" />
      <ellipse cx="86" cy="90" rx="4.5" ry="2.6" fill="var(--blush)" stroke="none" opacity=".75" />
      <path class="m-mouth" d="M63 92c3 6 10 6 13 0z" fill="currentColor" />
      <path d="M48 60c4-4 8-5 12-4" />
      <g class="m-cap">
        <path d="M36 60c4-14 18-24 34-24 15 0 26 6 30 16z" fill="var(--paper)" />
        <path d="M36 60l64-8" />
        <path d="M44 51l50-7" stroke-width="5" opacity=".9" />
        <path d="M66 46c1-4 5-5 7-2" />
      </g>
    </g>
    <g class="m-sparkles" stroke-width="2.4">
      <path class="m-sp m-sp1" d="M150 66v8m-4-4h8" />
      <path class="m-sp m-sp2" d="M98 40v6m-3-3h6" />
      <path class="m-sp m-sp3" d="M154 92v6m-3-3h6" />
    </g>
  </g>
</svg>`;

export function mountMascots(reduced) {
  document.querySelectorAll('[data-mascot]').forEach((el) => (el.innerHTML = MARKUP));

  // line boil: re-seed the ink wobble a few times a second, like hand-drawn animation
  const noise = document.getElementById('ink-noise');
  if (noise && !reduced) {
    let seed = 1;
    setInterval(() => noise.setAttribute('seed', String((seed = (seed % 4) + 1))), 160);
  }
}

// The big server next to the cup: his eyes follow a target, and he reacts to bites.
export function createServer(el, sayEl, reduced) {
  const pupils = el.querySelector('.m-pupils');
  const head = el.querySelector('.m-head');
  let sayTimer;

  function lookAt(clientX, clientY) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width * 0.43, cy = r.top + r.height * 0.47;
    const dx = clientX - cx, dy = clientY - cy;
    const d = Math.hypot(dx, dy) || 1;
    pupils.style.transform = `translate(${(dx / d) * 2.4}px, ${(dy / d) * 2}px)`;
    if (!reduced) head.style.setProperty('--tilt', `${Math.max(-8, Math.min(8, dx / 60))}deg`);
  }

  function react(kind) {
    el.classList.remove('is-hop', 'is-shock');
    void el.offsetWidth;
    el.classList.add(kind === 'shock' ? 'is-shock' : 'is-hop');
  }

  function say(text, ms = 2200) {
    clearTimeout(sayTimer);
    sayEl.textContent = text;
    sayEl.classList.add('is-on');
    sayTimer = setTimeout(() => sayEl.classList.remove('is-on'), ms);
  }

  return { lookAt, react, say };
}
