import { createScene } from './scene.js';
import { mountMascots, createServer } from './mascot.js';

// ---- edit these -------------------------------------------------------------
const CONFIG = {
  brand: 'froyo',
  whatsapp: '6281200000000', // placeholder: your number goes here (country code, no +)
  ink: '#1B3BD1',
};

const FLAVORS = [
  { id: 'original', name: 'original', short: 'original', note: 'thick, tangy, a little honey. the one that started it.', a: '#FFFAF0' },
  { id: 'mint', name: 'mint', short: 'mint', note: 'cool and clean, the color of a nice tile.', a: '#BFE3CF' },
  { id: 'choco', name: 'dark chocolate', short: 'choco', note: 'proper cocoa, not shy about it.', a: '#7A4B37' },
  { id: 'twist', name: 'mint × choco twist', short: 'twist', note: 'can’t decide? we pull both through one nozzle.', a: '#BFE3CF', b: '#7A4B37' },
  { id: 'berry', name: 'mixed berry', short: 'berry', note: 'strawberry and blueberry folded into the base.', a: '#F2B3C6' },
];

// a little face for each topping icon: open eyes blink, happy eyes show once it's on the cup
function face(x, y, gap, { ink = '#1B1F3B', blush = '#FF9DB4' } = {}) {
  const l = x - gap / 2, r = x + gap / 2;
  return `<g class="ti-eyes" fill="${ink}" stroke="none"><circle cx="${l}" cy="${y}" r="1.9"/><circle cx="${r}" cy="${y}" r="1.9"/>` +
    `<circle cx="${l + 0.6}" cy="${y - 0.7}" r="0.6" fill="#fff"/><circle cx="${r + 0.6}" cy="${y - 0.7}" r="0.6" fill="#fff"/></g>` +
    `<path class="ti-happy" d="M${l - 2} ${y + 0.8}q2-3 4 0M${r - 2} ${y + 0.8}q2-3 4 0" stroke="${ink}" stroke-width="1.6"/>` +
    `<path d="M${x - 1.8} ${y + 3}q1.8 2.2 3.6 0" stroke="${ink}" stroke-width="1.6"/>` +
    `<ellipse cx="${l - 3.2}" cy="${y + 2.6}" rx="2" ry="1.2" fill="${blush}" stroke="none" opacity=".85"/>` +
    `<ellipse cx="${r + 3.2}" cy="${y + 2.6}" rx="2" ry="1.2" fill="${blush}" stroke="none" opacity=".85"/>`;
}
const shine = (x, y, rx, ry, rot = -30) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${x} ${y})" fill="#fff" stroke="none" opacity=".55"/>`;

// colorful fruit icons (48×48), outlined in the brand ink like the mascot
const TOPPINGS = [
  { id: 'strawberry', name: 'strawberry', icon:
    '<path d="M24 15c-8.5 0-14.5 4.5-14.5 11.5 0 8 7.5 13.5 14.5 16.5 7-3 14.5-8.5 14.5-16.5 0-7-6-11.5-14.5-11.5z" fill="#EF5A6F"/>' +
    shine(15.5, 22.5, 1.8, 3.4) +
    '<g fill="#FFE3A3" stroke="none"><ellipse cx="14.5" cy="29" rx=".9" ry="1.3"/><ellipse cx="33.5" cy="29" rx=".9" ry="1.3"/><ellipse cx="18" cy="36" rx=".9" ry="1.3"/><ellipse cx="30" cy="36" rx=".9" ry="1.3"/><ellipse cx="24" cy="39.5" rx=".9" ry="1.3"/><ellipse cx="31" cy="21.5" rx=".9" ry="1.3"/></g>' +
    '<path d="M13.5 17.5c3-1.6 6-1.4 8 .4-.8-3 0-5.6 2.5-7.4 2.5 1.8 3.3 4.4 2.5 7.4 2-1.8 5-2 8-.4-2 3-5.5 4.2-9 4.2h-3c-3.5 0-7-1.2-9-4.2z" fill="#63B37A"/>' +
    face(24, 27.5, 8, { blush: '#FFC2CE' }) },
  { id: 'blueberry', name: 'blueberry', icon:
    '<circle cx="24" cy="26.5" r="14" fill="#5C6FD6"/>' + shine(17, 20, 2.2, 3.6) +
    '<path d="M19 13.5l2.6 2.6 2.4-3.6 2.4 3.6 2.6-2.6-.8 4.8h-8.4z" fill="#3B4A9E"/>' +
    face(24, 27, 8.5, { ink: '#141A40', blush: '#F49AB2' }) },
  { id: 'granola', name: 'granola', icon:
    '<g transform="translate(3.6 3.4) scale(.85)">' +
    '<path d="M29.5 15.5l4.5-4.5 6.5 1.5 1.5 6.5-4.5 4-6.5-1.5z" fill="#C9893F"/>' +
    '<path d="M33 33.5l5.5-2 3.5 4-1.5 5.5-5.5.5-2.5-3z" fill="#EDC27D"/>' +
    '<path d="M7.5 30l4-9.5 9.5-3.5 8.5 4 2 9.5-6.5 7-11.5.5z" fill="#E0A85A"/>' +
    '<g fill="#F6D9A5" stroke="none"><ellipse cx="12" cy="23.5" rx="1.6" ry=".9" transform="rotate(-30 12 23.5)"/><ellipse cx="27" cy="33" rx="1.6" ry=".9" transform="rotate(20 27 33)"/><ellipse cx="35" cy="15.5" rx="1.4" ry=".8"/></g>' +
    face(19, 27.5, 7.5, { blush: '#F7A7A0' }) + '</g>' },
  { id: 'mochi', name: 'mochi', icon:
    '<path d="M7.5 35c0-10.5 7.4-18.5 16.5-18.5S40.5 24.5 40.5 35c0 2.2-1.3 3.5-3.5 3.5H11c-2.2 0-3.5-1.3-3.5-3.5z" fill="#F8D3DE"/>' +
    shine(15, 24, 2, 4, 40) +
    '<g fill="#fff" stroke="none" opacity=".9"><circle cx="21" cy="20.5" r=".8"/><circle cx="29" cy="21.5" r=".8"/><circle cx="34" cy="26" r=".8"/><circle cx="12.5" cy="31" r=".8"/></g>' +
    face(24, 29.5, 9, { blush: '#F2879F' }) },
  { id: 'caramel', name: 'caramel', icon:
    '<path d="M24 7.5c5.5 8.5 13 14.5 13 22a13 13 0 0 1-26 0c0-7.5 7.5-13.5 13-22z" fill="#DB8F43"/>' +
    shine(18.5, 24, 1.8, 4, 25) +
    face(24, 31, 8.5, { ink: '#3A1E0C', blush: '#F7A27E' }) },
];

// a flavor seen from above is a swirl: a soft spiral on the color, and the twist pulls a
// second color through it
function spiral(turns = 2.3, maxR = 23) {
  const pts = [];
  const end = turns * Math.PI * 2;
  for (let a = 0; a <= end; a += 0.12) {
    const r = (a / end) * maxR;
    pts.push(`${(24 + r * Math.cos(a)).toFixed(2)} ${(24 + r * Math.sin(a)).toFixed(2)}`);
  }
  return 'M' + pts.join('L');
}
const SPIRAL = spiral();
function swatch(f) {
  const clip = `sw-${f.id}`;
  const arm = f.b
    ? `<path class="sw-spiral" d="${SPIRAL}" stroke="${f.b}" stroke-width="6.5"/>`
    : `<path class="sw-spiral" d="${SPIRAL}" stroke="rgba(27,31,59,.13)" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><clipPath id="${clip}"><circle cx="24" cy="24" r="22"/></clipPath></defs>` +
    `<g clip-path="url(#${clip})"><circle cx="24" cy="24" r="22" fill="${f.a}"/>${arm}</g>` +
    `<circle cx="24" cy="24" r="22" fill="none" stroke="var(--ink)" stroke-width="2"/></svg>`;
}

// -----------------------------------------------------------------------------

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.style.setProperty('--ink', CONFIG.ink);

const order = { flavor: FLAVORS[0], toppings: new Set() };

/* ---------- whatsapp ---------- */
function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items.at(-1);
}
function waMessage() {
  const tops = TOPPINGS.filter((t) => order.toppings.has(t.id)).map((t) => t.name);
  let msg = `hi ${CONFIG.brand}! i'd like to pre-order a cup of ${order.flavor.name}`;
  msg += tops.length ? ` with ${listJoin(tops)}.` : ', no toppings.';
  return msg;
}
function waHref() {
  return `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(waMessage())}`;
}
function refreshLinks() {
  document.querySelectorAll('.js-wa').forEach((a) => (a.href = waHref()));
}

/* ---------- mascot ---------- */
mountMascots(reduced);
const server = createServer(document.getElementById('server'), document.getElementById('say'), reduced);
window.addEventListener('pointermove', (e) => server.lookAt(e.clientX, e.clientY));

/* ---------- scene ---------- */
const live = document.getElementById('live');
const hint = document.getElementById('stage-hint');
const stageEl = document.getElementById('stage');
let scene;
const flavorReplies = {
  original: 'a classic. respect.',
  mint: 'fresh choice.',
  choco: 'dark. like my coffee.',
  twist: 'why choose, honestly.',
  berry: 'berry nice.',
};

function onBite(state, data) {
  if (state === 'incoming') {
    server.react('shock');
    const p = scene.faceScreen();
    server.lookAt(p.x, p.y);
  } else if (state === 'eaten') {
    server.react('hop');
    server.say(data.line);
    live.textContent = `you took a bite. ${data.line}`;
    hint.classList.add('is-gone');
  } else if (state === 'empty') {
    server.say('all gone. another one?', 2400);
  }
}

document.fonts.load('600 66px Fredoka').finally(async () => {
  await document.fonts.load('500 30px Figtree').catch(() => {});
  scene = createScene(stageEl, {
    reduced,
    ink: CONFIG.ink,
    onBite,
    onPour: (s) => {
      document.body.classList.toggle('is-pouring', s === 'start');
    },
  });
  scene.setFlavor(order.flavor.a, order.flavor.b);
});

stageEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    scene?.bite();
  }
});

/* ---------- dock ---------- */
// every option is a tile: a round picture and a short name, the same on phones and desktop
function chip(item, pressed, i, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.id = item.id;
  b.style.setProperty('--i', i);
  b.setAttribute('aria-pressed', String(pressed));
  b.setAttribute('aria-label', item.name);
  const v = document.createElement('span');
  if (item.icon) {
    v.className = 'ticon';
    v.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><g class="ti" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${item.icon}</g></svg>`;
  } else {
    v.className = 'swatch';
    v.innerHTML = swatch(item);
  }
  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = item.short || item.name;
  b.append(v, label);
  b.addEventListener('click', () => onClick(b));
  b.addEventListener('animationend', () => b.classList.remove('is-pop'));
  return b;
}

function showNote(f) {
  const name = document.createElement('strong');
  name.textContent = `${f.name}. `;
  flavorNote.replaceChildren(name, f.note);
}

function selectFlavor(f, announce = true) {
  order.flavor = f;
  document.querySelectorAll('#flavor-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === f.id)));
  scene?.setFlavor(f.a, f.b);
  showNote(f);
  if (announce) server.say(flavorReplies[f.id]);
  live.textContent = `pouring ${f.name}`;
  refreshLinks();
}

const flavorChips = document.getElementById('flavor-chips');
const flavorNote = document.getElementById('flavor-note');
showNote(order.flavor);
FLAVORS.forEach((f, i) => flavorChips.append(chip(f, f === order.flavor, i, () => selectFlavor(f))));

const toppingChips = document.getElementById('topping-chips');
TOPPINGS.forEach((t, i) => {
  const c = chip(t, false, i, (btn) => {
    const on = !order.toppings.has(t.id);
    on ? order.toppings.add(t.id) : order.toppings.delete(t.id);
    btn.setAttribute('aria-pressed', String(on));
    if (on) btn.classList.add('is-pop');
    if (on) scene?.addTopping(t.id);
    else scene?.removeTopping(t.id);
    live.textContent = on ? `added ${t.name}` : `removed ${t.name}`;
    refreshLinks();
  });
  toppingChips.append(c);
});

document.getElementById('bite-btn').addEventListener('click', () => {
  scene?.bite();
});

/* ---------- sticky mobile cta ---------- */
const sticky = document.getElementById('sticky-wa');
new IntersectionObserver(([e]) => sticky.classList.toggle('is-on', !e.isIntersecting && e.boundingClientRect.top < 0)).observe(
  document.querySelector('.js-wa-hero'),
);

refreshLinks();
