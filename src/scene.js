import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

const TAU = Math.PI * 2;
const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  back: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  sine: (t) => 0.5 - Math.cos(Math.PI * t) / 2,
};
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rand = (a, b) => a + Math.random() * (b - a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- swirl geometry */

// A star-nozzle tube wound up a shrinking helix: the classic soft-serve shape.
// Indices are ordered along the path so drawRange can "pour" or "eat" it.
function buildSwirl({ turns = 3.2, R0 = 0.5, r0 = 0.285, samples = 640, radial = 40, ridges = 8, ridgeAmp = 0.085 }) {
  const P = [], R = [], TH = [];
  const perTurn = samples / turns;
  let y = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const th = t * turns * TAU;
    const Rh = R0 * Math.pow(1 - t, 0.9);
    const base = r0 * (1 - 0.55 * t);
    const r = base * Math.pow(1 - smooth(0.82, 1, t), 0.55);
    P.push(new THREE.Vector3(Rh * Math.cos(th), y, Rh * Math.sin(th)));
    R.push(Math.max(r, 0.0005));
    TH.push(th);
    y += (1.42 * base) / perTurn + (t > 0.8 ? 0.2 / (0.2 * samples) : 0);
  }

  // parallel-transport frames (no sudden flips near the tip)
  const T = P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(samples, i + 1)];
    return b.clone().sub(a).normalize();
  });
  const N = [], B = [];
  let n = new THREE.Vector3(0, 1, 0).sub(T[0].clone().multiplyScalar(T[0].y)).normalize();
  for (let i = 0; i <= samples; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const len = axis.length();
      if (len > 1e-6) n.applyAxisAngle(axis.divideScalar(len), Math.asin(Math.min(1, len)));
    }
    N.push(n.clone());
    B.push(new THREE.Vector3().crossVectors(T[i], n).normalize());
  }

  const ring = radial + 1;
  const pos = new Float32Array((samples + 1) * ring * 3);
  const nor = new Float32Array((samples + 1) * ring * 3);
  const side = new Float32Array((samples + 1) * ring);
  const ao = new Float32Array((samples + 1) * ring);
  const u = new THREE.Vector3(), w = new THREE.Vector3(), q = new THREE.Vector3();
  const ro = new THREE.Vector3(), dUp = new THREE.Vector3(), dDown = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const twistPhase = (i / samples) * turns * TAU * 1.5;
    // where this coil tucks under the one above and sits on the one below
    ro.set(P[i].x, 0, P[i].z);
    if (ro.lengthSq() < 1e-8) ro.set(1, 0, 0);
    ro.normalize();
    dUp.set(-0.35 * ro.x, 0.94, -0.35 * ro.z).normalize();
    dDown.set(0.35 * ro.x, -0.94, 0.35 * ro.z).normalize();
    const above = i + perTurn < samples * 0.86 ? 1 : 0;
    for (let j = 0; j <= radial; j++) {
      const ph = (j / radial) * TAU;
      const f = 1 + ridgeAmp * Math.cos(ridges * ph);
      const df = -ridgeAmp * ridges * Math.sin(ridges * ph);
      u.copy(N[i]).multiplyScalar(Math.cos(ph)).addScaledVector(B[i], Math.sin(ph));
      w.copy(N[i]).multiplyScalar(-Math.sin(ph)).addScaledVector(B[i], Math.cos(ph));
      const k = i * ring + j;
      q.copy(P[i]).addScaledVector(u, R[i] * f);
      pos.set([q.x, q.y, q.z], k * 3);
      q.copy(u).multiplyScalar(f).addScaledVector(w, -df).normalize();
      nor.set([q.x, q.y, q.z], k * 3);
      // two-flavor twist: the nozzle splits in two and the split winds up the swirl
      side[k] = 2 * ph + twistPhase;
      let a = 1 - 0.3 * smooth(0.3, 0.95, u.dot(dDown)) - 0.3 * above * smooth(0.3, 0.95, u.dot(dUp));
      a *= 1 - 0.08 * Math.max(0, -Math.cos(ridges * ph));
      ao[k] = a;
    }
  }
  const idx = [];
  for (let i = 0; i < samples; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = a + ring;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, P, R, T, N, B, TH, samples, radial, height: y, turns };
}

// point on the tube surface at path index i whose normal best matches `hint`
function surfaceAt(sw, i, hint) {
  let best = -Infinity;
  const out = new THREE.Vector3(), u = new THREE.Vector3();
  for (let k = 0; k < 64; k++) {
    const ph = (k / 64) * TAU;
    u.copy(sw.N[i]).multiplyScalar(Math.cos(ph)).addScaledVector(sw.B[i], Math.sin(ph));
    const d = u.dot(hint);
    if (d > best) { best = d; out.copy(u); }
  }
  return { pos: sw.P[i].clone().addScaledVector(out, sw.R[i]), normal: out };
}

/* ---------------------------------------------------------------- textures */

function cupTexture(ink) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#FBFAF6';
  g.fillRect(0, 0, c.width, c.height);
  // faint paper fibre
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(120,110,90,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, rand(1, 3), rand(1, 3));
  }
  // wordmark with a thin band near the rim
  const cx = 1024;
  g.fillStyle = ink;
  g.fillRect(0, 34, c.width, 10);
  g.font = '600 150px Fredoka';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('froyo', cx, 250);
  g.font = '500 30px Figtree';
  g.letterSpacing = '6px';
  g.fillText('PULLED FRESH', cx + 3, 360);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function mistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ---------------------------------------------------------------- scene */

export function createScene(container, opts) {
  const { reduced, ink = '#1B3BD1', onBite, onPour, onLand, onMood } = opts;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.25;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const target = new THREE.Vector3(0, 0.95, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xf1e7d6, 1.8));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.position.set(2.5, 5.5, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -2.2;
  key.shadow.camera.right = key.shadow.camera.top = 2.2;
  key.shadow.radius = 9;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(ink).lerp(new THREE.Color('#ffffff'), 0.5), 0.8);
  rim.position.set(-3.5, 2.5, -3);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xfff8ee, 1.3);
  fill.position.set(-1, 1.5, 6);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ color: '#13287F', opacity: 0.13 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // soft contact shadow so the cup sits on the page instead of hovering
  const blobC = document.createElement('canvas');
  blobC.width = blobC.height = 128;
  const bg = blobC.getContext('2d');
  const bgr = bg.createRadialGradient(64, 64, 0, 64, 64, 64);
  bgr.addColorStop(0, 'rgba(19,40,127,0.42)');
  bgr.addColorStop(0.55, 'rgba(19,40,127,0.12)');
  bgr.addColorStop(1, 'rgba(19,40,127,0)');
  bg.fillStyle = bgr;
  bg.fillRect(0, 0, 128, 128);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobC), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.003;
  scene.add(blob);

  // stage: user drag + pointer parallax. serving: spins under the nozzle while pouring.
  const stage = new THREE.Group();
  const serving = new THREE.Group();
  stage.add(serving);
  scene.add(stage);

  /* ----- shared uniforms: jiggle + flavor colors ----- */
  const U = {
    uTime: { value: 0 },
    uAmp: { value: 0 },
    uH: { value: 1 },
    uColA: { value: new THREE.Color('#f6f1e8') },
    uColB: { value: new THREE.Color('#f6f1e8') },
    // scoops taken out of the swirl: xyz centre, w radius (0 = unused)
    uDent: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uDentDir: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1, 0)) },
  };
  // Inside a scoop, each vertex slides along the spoon's dig direction until it meets the far
  // wall of the scoop sphere, so the swirl is left with a real bowl-shaped hollow.
  // `sink` pushes a layer (the caramel) just under that wall so it is cut away with the froyo.
  const dentGLSL = (sink) => `vec3 dentP = position;
          float dentShade = 1.0;
          for (int di = 0; di < 4; di++) {
            vec4 dd = uDent[di];
            if (dd.w <= 0.0) continue;
            vec3 o = dentP - dd.xyz;
            float r2 = dot(o, o);
            if (r2 < dd.w * dd.w) {
              vec3 d = uDentDir[di];
              float od = dot(o, d);
              float t = -od + sqrt(od * od - r2 + dd.w * dd.w);
              dentP += d * (t + ${sink.toFixed(3)});
              float w = smoothstep(0.0, 0.05, t);
              objectNormal = normalize(mix(objectNormal, normalize(dd.xyz - dentP), w));
              dentShade = min(dentShade, 1.0 - 0.45 * smoothstep(0.0, dd.w * 0.75, t));
            }
          }`;
  // Matte, solid colour like a soft clay model: no gloss, creases baked into the swirl,
  // and a soft rim of its own colour so the silhouette stays light.
  function froyoMaterial({ twist = true, jiggle = true } = {}) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.35, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uAmp, uH;
          uniform vec4 uDent[4];
          uniform vec3 uDentDir[4];
          ${twist ? 'attribute float aPhase; attribute float aAO;' : ''}
          varying float vPhase;
          varying float vAO;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          ${twist ? dentGLSL(0) : ''}`)
        .replace('#include <begin_vertex>', `${twist ? 'vec3 transformed = dentP;' : '#include <begin_vertex>'}
          ${jiggle ? JIGGLE_GLSL : ''}
          vPhase = ${twist ? 'aPhase' : '3.14159'};
          vAO = ${twist ? 'aAO * dentShade' : '1.0'};`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uColA, uColB;
          varying float vPhase;
          varying float vAO;`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `float twC = cos(vPhase);
          float twW = fwidth(twC) + 0.015;
          vec4 diffuseColor = vec4( mix(uColA, uColB, smoothstep(-twW, twW, twC)) * vAO, opacity );`)
        .replace('#include <opaque_fragment>', `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);
          outgoingLight += diffuseColor.rgb * rimF * 0.3;
          #include <opaque_fragment>`);
    };
    // every variant shares the same onBeforeCompile source, so key the shader cache explicitly
    m.customProgramCacheKey = () => `froyo-${twist}-${jiggle}`;
    return m;
  }
  const JIGGLE_GLSL = `float jk = pow(clamp(position.y / uH, 0.0, 1.0), 2.0);
          transformed.x += uAmp * jk * sin(uTime * 13.0);
          transformed.z += uAmp * jk * cos(uTime * 11.0) * 0.7;`;
  function jiggleAt(y, out) {
    const k = Math.pow(Math.min(1, Math.max(0, y / U.uH.value)), 2);
    out.x = U.uAmp.value * k * Math.sin(U.uTime.value * 13);
    out.y = 0;
    out.z = U.uAmp.value * k * Math.cos(U.uTime.value * 11) * 0.7;
    return out;
  }

  /* ----- cup: a short, wide paper bowl ----- */
  const CUP_H = 0.78, CUP_TOP = 0.86, CUP_BOT = 0.62;
  const prof = [new THREE.Vector2(0.001, 0)];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    prof.push(new THREE.Vector2(CUP_BOT + (CUP_TOP - CUP_BOT) * t + 0.012 * Math.sin(t * Math.PI), t * CUP_H));
  }
  prof.splice(1, 0, new THREE.Vector2(CUP_BOT - 0.015, 0.0));
  const cupMat = new THREE.MeshStandardMaterial({ map: cupTexture(ink), roughness: 0.8, side: THREE.DoubleSide });
  const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), cupMat);
  cup.castShadow = true;
  cup.receiveShadow = true;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(CUP_TOP + 0.006, 0.022, 12, 96), new THREE.MeshStandardMaterial({ color: '#FBFAF6', roughness: 0.8 }));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = CUP_H;
  lip.castShadow = true;
  serving.add(cup, lip);

  const mound = new THREE.Mesh(new THREE.SphereGeometry(CUP_TOP - 0.02, 64, 24, 0, TAU, 0, Math.PI / 2), froyoMaterial({ twist: false, jiggle: false }));
  mound.scale.y = 0.26;
  mound.position.y = CUP_H - 0.04;
  mound.receiveShadow = true;
  serving.add(mound);

  /* ----- swirl ----- */
  const sw = buildSwirl({});
  U.uH.value = sw.height;
  const segTris = sw.radial * 6;
  const swirlRoot = new THREE.Group();
  swirlRoot.position.y = CUP_H + 0.08;
  serving.add(swirlRoot);
  const swirlMat = froyoMaterial();
  const swirl = new THREE.Mesh(sw.geometry, swirlMat);
  swirl.castShadow = true;
  swirlRoot.add(swirl);
  // rounded end cap where the pour front or the bite is
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), froyoMaterial({ twist: false }));
  cap.castShadow = true;
  swirlRoot.add(cap);

  let level = 0; // 0..1 of the path that exists
  function setLevel(v) {
    level = Math.max(0, Math.min(1, v));
    const seg = Math.round(level * sw.samples);
    sw.geometry.setDrawRange(0, seg * segTris);
    const i = Math.max(0, Math.min(sw.samples, seg));
    const r = sw.R[i];
    cap.visible = seg > 2 && r > 0.01;
    cap.position.copy(sw.P[i]);
    cap.scale.setScalar(r * 0.98);
  }
  setLevel(0);

  /* ----- face: drawn on a canvas, projected onto the swirl like a printed decal ----- */
  const FACE_T = 0.34;
  const faceI = Math.round(FACE_T * sw.samples);
  const faceTh = sw.TH[faceI];
  const front = new THREE.Vector3(Math.cos(faceTh), 0, Math.sin(faceTh));
  const up = new THREE.Vector3(0, 1, 0);
  const faceSpot = surfaceAt(sw, faceI, front.clone().addScaledVector(up, 0.2).normalize());

  const FW = 640, FH = 400, FACE_INK = '#1B1F3B';
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = FW;
  faceCanvas.height = FH;
  const fx = faceCanvas.getContext('2d');
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 8;
  // mood: normal | happy | shock | yum.  mouthOpen flips now and then so the face never sits still.
  const face = { mood: 'normal', blink: false, lx: 0, ly: 0, mouthOpen: true };
  const BLUSH = 'rgba(247,128,160,0.72)', BLUSH_LINE = 'rgba(226,84,124,0.75)', TONGUE = '#F2788F';

  function eyeOpen(g, ex, ey, k) {
    g.save();
    g.fillStyle = FACE_INK;
    g.beginPath();
    g.ellipse(ex, ey, 36 * k, 46 * k, 0, 0, TAU);
    g.fill();
    g.clip();
    // light bouncing into the bottom of the eye
    g.fillStyle = '#3B4794';
    g.beginPath();
    g.ellipse(ex, ey + 40 * k, 30 * k, 22 * k, 0, 0, TAU);
    g.fill();
    g.restore();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(ex + 12 * k, ey - 17 * k, 14 * k, 15 * k, -0.4, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(ex - 13 * k, ey + 17 * k, 6.5 * k, 0, TAU);
    g.fill();
  }
  function arcEye(g, cx, cy, up) {
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(cx - 32, cy + (up ? 14 : 0));
    g.quadraticCurveTo(cx, up ? cy - 34 : cy + 24, cx + 32, cy + (up ? 14 : 0));
    g.stroke();
  }
  function openMouth(g, mx, my, w, d) {
    g.fillStyle = FACE_INK;
    g.beginPath();
    g.moveTo(mx - w, my);
    g.quadraticCurveTo(mx, my + d * 2, mx + w, my);
    g.quadraticCurveTo(mx, my + 6, mx - w, my);
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = TONGUE;
    g.beginPath();
    g.ellipse(mx, my + d * 1.05, w * 0.62, d * 0.55, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawFace() {
    const g = fx;
    const m = face.mood;
    g.clearRect(0, 0, FW, FH);
    g.lineCap = g.lineJoin = 'round';
    for (const s of [-1, 1]) {
      const cx = FW / 2 + s * 184, cy = 240;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 58);
      grd.addColorStop(0, BLUSH);
      grd.addColorStop(1, 'rgba(247,128,160,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(cx, cy, 60, 40, 0, 0, TAU);
      g.fill();
      g.strokeStyle = BLUSH_LINE;
      g.lineWidth = 6;
      for (const k of [-1, 0, 1]) {
        g.beginPath();
        g.moveTo(cx + k * 17 - 6, cy + 9);
        g.lineTo(cx + k * 17 + 6, cy - 9);
        g.stroke();
      }
    }
    g.fillStyle = g.strokeStyle = FACE_INK;
    for (const s of [-1, 1]) {
      const cx = FW / 2 + s * 114, cy = 160;
      if (m === 'happy' || m === 'yum') arcEye(g, cx, cy, true);
      else if (face.blink) arcEye(g, cx, cy + 6, false);
      else eyeOpen(g, cx + face.lx, cy + face.ly, m === 'shock' ? 1.12 : 1);
      if (m === 'shock') {
        g.strokeStyle = FACE_INK;
        g.lineWidth = 11;
        g.beginPath();
        g.moveTo(cx - 26, cy - 74);
        g.quadraticCurveTo(cx, cy - 92, cx + 26, cy - 74);
        g.stroke();
      }
    }
    const mx = FW / 2, my = 232;
    g.fillStyle = g.strokeStyle = FACE_INK;
    if (m === 'shock') {
      g.beginPath();
      g.ellipse(mx, my + 14, 17, 22, 0, 0, TAU);
      g.fill();
    } else if (m === 'happy') {
      openMouth(g, mx, my, 40, 34);
    } else if (m === 'yum') {
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(mx - 26, my + 4);
      g.quadraticCurveTo(mx, my + 26, mx + 26, my + 4);
      g.stroke();
      g.fillStyle = TONGUE;
      g.beginPath();
      g.ellipse(mx + 13, my + 22, 11, 14, -0.3, 0, TAU);
      g.fill();
      g.lineWidth = 6;
      g.stroke();
    } else if (face.mouthOpen) {
      openMouth(g, mx, my, 26, 22);
    } else {
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(mx - 24, my + 2);
      g.quadraticCurveTo(mx, my + 26, mx + 24, my + 2);
      g.stroke();
    }
    faceTex.needsUpdate = true;
  }
  drawFace();

  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex, transparent: true, opacity: 0, depthWrite: false, roughness: 0.92,
    polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
  });
  faceMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uAmp, uH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + JIGGLE_GLSL);
  };
  faceMat.customProgramCacheKey = () => 'froyo-face';
  // project in the swirl's own space by using a stand-in mesh with no transform
  const projector = new THREE.Mesh(sw.geometry);
  projector.updateMatrixWorld();
  const fz = faceSpot.normal.clone();
  const fy = up.clone().addScaledVector(fz, -up.dot(fz)).normalize();
  const fxAxis = new THREE.Vector3().crossVectors(fy, fz);
  const faceRot = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fxAxis, fy, fz));
  const faceMesh = new THREE.Mesh(new DecalGeometry(projector, faceSpot.pos, faceRot, new THREE.Vector3(0.8, 0.5, 0.36)), faceMat);
  faceMesh.renderOrder = 2;
  faceMesh.visible = false;
  swirlRoot.add(faceMesh);

  function fadeFace(to, ms = 220) {
    const from = faceMat.opacity;
    if (to > 0) faceMesh.visible = true;
    return tween(reduced ? 1 : ms, (t) => (faceMat.opacity = from + (to - from) * t)).then(() => {
      if (to === 0) faceMesh.visible = false;
    });
  }

  let moodTimer;
  function setMood(m, ms = 0) {
    face.mood = m;
    drawFace();
    clearTimeout(moodTimer);
    if (ms) moodTimer = setTimeout(() => setMood('normal'), ms);
    onMood?.(m);
  }
  function blink(ms = 120) {
    if (face.mood !== 'normal') return;
    face.blink = true;
    drawFace();
    setTimeout(() => { face.blink = false; drawFace(); }, ms);
  }

  /* ----- nozzle ----- */
  const nozzle = new THREE.Group();
  const nzBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.6, 32), new THREE.MeshStandardMaterial({ color: '#FBF8F1', roughness: 0.75 }));
  nzBody.position.y = 0.95;
  const nzTip = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.085, 0.16, 8), new THREE.MeshStandardMaterial({ color: ink, roughness: 0.7 }));
  nzTip.position.y = 0.08;
  nozzle.add(nzBody, nzTip);
  nozzle.visible = false;
  stage.add(nozzle);

  /* ----- wooden tasting spoon ----- */
  const spoonShape = new THREE.Shape();
  spoonShape.moveTo(-0.035, 0.75);
  spoonShape.lineTo(-0.035, 0.2);
  spoonShape.bezierCurveTo(-0.035, 0.12, -0.13, 0.12, -0.13, 0.0);
  spoonShape.bezierCurveTo(-0.13, -0.12, 0.13, -0.12, 0.13, 0.0);
  spoonShape.bezierCurveTo(0.13, 0.12, 0.035, 0.12, 0.035, 0.2);
  spoonShape.lineTo(0.035, 0.75);
  spoonShape.bezierCurveTo(0.035, 0.79, -0.035, 0.79, -0.035, 0.75);
  const spoonGeo = new THREE.ExtrudeGeometry(spoonShape, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 20 });
  spoonGeo.rotateX(-Math.PI / 2);
  const spoon = new THREE.Group();
  const spoonMesh = new THREE.Mesh(spoonGeo, new THREE.MeshStandardMaterial({ color: '#D9BC8C', roughness: 0.85 }));
  spoonMesh.castShadow = true;
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.15, 28, 18), froyoMaterial({ twist: false, jiggle: false }));
  scoop.scale.set(1, 0.72, 1);
  scoop.position.y = 0.06;
  scoop.visible = false;
  spoon.add(spoonMesh, scoop);
  spoon.visible = false;
  scene.add(spoon);

  /* ----- mist: cold air rolling off the froyo ----- */
  const MIST = 34;
  const mistGeo = new THREE.BufferGeometry();
  const mistPos = new Float32Array(MIST * 3);
  const mistLife = Array.from({ length: MIST }, () => ({ age: Math.random(), v: new THREE.Vector3() }));
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
  const mistMat = new THREE.PointsMaterial({ map: mistTexture(), size: 0.42, transparent: true, opacity: 0.22, depthWrite: false, color: '#ffffff' });
  const mist = new THREE.Points(mistGeo, mistMat);
  stage.add(mist);
  function respawnMist(m, k) {
    const a = Math.random() * TAU, r = rand(0.3, 0.7);
    mistPos.set([Math.cos(a) * r, CUP_H + rand(0.1, 0.9) * level, Math.sin(a) * r], k * 3);
    m.v.set(Math.cos(a) * rand(0.03, 0.08), rand(-0.06, 0.01), Math.sin(a) * rand(0.03, 0.08));
    m.age = 0;
  }
  mistLife.forEach(respawnMist);

  /* ----- toppings ----- */
  const toppingMeshes = {
    strawberry() {
      const pts = [[0, -0.075], [0.03, -0.06], [0.05, -0.025], [0.056, 0.012], [0.048, 0.04], [0.02, 0.055], [0, 0.056]].map(([x, y]) => new THREE.Vector2(x, y));
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), new THREE.MeshStandardMaterial({ color: '#E8475C', roughness: 0.6 }));
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.018, 6), new THREE.MeshStandardMaterial({ color: '#4E9A4A', roughness: 0.6 }));
      leaf.position.y = 0.06;
      const g = new THREE.Group();
      m.rotation.x = Math.PI; leaf.position.y = -0.06; leaf.rotation.x = Math.PI;
      g.add(m, leaf);
      g.userData.seat = 0.045;
      return g;
    },
    blueberry() {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#34407F', roughness: 0.45, sheen: 1, sheenColor: new THREE.Color('#9fb0ff'), sheenRoughness: 0.5 }));
      b.scale.y = 0.88;
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.005, 6, 10), new THREE.MeshStandardMaterial({ color: '#1f2550' }));
      crown.rotation.x = Math.PI / 2; crown.position.y = 0.043;
      g.add(b, crown);
      g.userData.seat = 0.036;
      return g;
    },
    granola() {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: '#C48E52', roughness: 0.9, flatShading: true });
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.022, 0.032), 0), mat);
        c.position.set(rand(-0.03, 0.03), rand(0, 0.02), rand(-0.03, 0.03));
        c.rotation.set(rand(0, 3), rand(0, 3), 0);
        c.castShadow = true;
        g.add(c);
      }
      g.userData.seat = 0.022;
      return g;
    },
    mochi() {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.062, 28, 18), new THREE.MeshStandardMaterial({ color: '#FBF7F0', roughness: 0.85 }));
      b.scale.y = 0.85;
      g.add(b);
      g.userData.seat = 0.043;
      return g;
    },
  };

  const pieces = []; // { obj, kind, i, base, normal }
  const PIECE_COUNT = { strawberry: 4, blueberry: 6, granola: 7, mochi: 3 };
  const PIECE_SIZE = { strawberry: 2.5, blueberry: 1.9, granola: 2.1, mochi: 1.9 };
  const active = new Set();
  let drizzle = null;

  const dentV = new THREE.Vector3();
  function inDent(p, pad = 0.04) {
    return U.uDent.value.some((d) => d.w > 0 && p.distanceTo(dentV.set(d.x, d.y, d.z)) < d.w + pad);
  }
  // Highest point of the swirl above (x, z), treating the tube as a string of spheres as wide as
  // its ridge crests. Nothing is overhead there, so a piece dropped straight down lands on top.
  function topAt(x, z, maxI) {
    let best = -1, bestY = -Infinity;
    for (let i = 0; i <= maxI; i++) {
      const c = sw.P[i], r = sw.R[i] * 1.085;
      const h2 = r * r - (x - c.x) ** 2 - (z - c.z) ** 2;
      if (h2 > 0 && c.y + Math.sqrt(h2) > bestY) { bestY = c.y + Math.sqrt(h2); best = i; }
    }
    if (best < 0) return null;
    const pos = new THREE.Vector3(x, bestY, z);
    return { i: best, pos, normal: pos.clone().sub(sw.P[best]).normalize() };
  }
  // Fixed landing spots on the coil tops facing the camera, clear of the face, highest first:
  // toppings get spooned on from above, so they pile on the peak and upper coils.
  const SLOT_GAP = 0.15;
  const SLOTS = [];
  for (let i = Math.floor(sw.samples * 0.04); i < sw.samples * 0.93; i += 2) {
    if (Math.abs(Math.atan2(Math.sin(sw.TH[i] - faceTh), Math.cos(sw.TH[i] - faceTh))) > 1.6) continue;
    const s = topAt(sw.P[i].x, sw.P[i].z, sw.samples);
    if (!s || s.normal.y < 0.45 || s.pos.distanceTo(faceSpot.pos) < 0.42) continue;
    if (SLOTS.some((q) => q.distanceTo(s.pos) < SLOT_GAP)) continue;
    SLOTS.push(s.pos);
  }
  SLOTS.sort((a, b) => b.y - a.y);
  // each topping gets every fourth spot, then borrows the others if it runs out
  const KINDS = Object.keys(PIECE_COUNT);
  function pickSpot(kind) {
    const k = KINDS.indexOf(kind);
    const own = SLOTS.filter((_, j) => j % KINDS.length === k);
    const order = [...own, ...SLOTS.filter((_, j) => j % KINDS.length !== k)];
    const maxI = Math.floor(level * sw.samples);
    let fallback = null;
    for (const slot of order) {
      const s = topAt(slot.x, slot.z, maxI);
      if (!s || s.normal.y < 0.45 || s.i > maxI * 0.95) continue;
      if (pieces.some((q) => q.spot.distanceTo(s.pos) < SLOT_GAP * 0.9) || inDent(s.pos)) continue;
      if (!biteZones.some((z) => s.pos.distanceTo(z) < 0.2)) return s;
      fallback ??= s;
    }
    return fallback;
  }

  async function dropPiece(kind, delay) {
    await wait(delay);
    const spot = pickSpot(kind);
    if (!spot || !active.has(kind)) return;
    const obj = toppingMeshes[kind]();
    obj.traverse((o) => o.isMesh && (o.castShadow = true));
    const size = PIECE_SIZE[kind];
    // rest mostly upright, leaning into the slope, with just the bottom pressed in
    const lean = up.clone().lerp(spot.normal, 0.6).normalize();
    const base = spot.pos.clone().addScaledVector(lean, obj.userData.seat * size);
    obj.quaternion.setFromUnitVectors(up, lean);
    obj.rotateY(rand(0, TAU));
    obj.scale.setScalar(size);
    swirlRoot.add(obj);
    const p = { obj, kind, i: spot.i, spot: spot.pos, base, normal: spot.normal, drop: 1, squash: 0, size };
    pieces.push(p);
    if (reduced) { p.drop = 0; return; }
    // a short plop from just above, like a spoonful, growing in as it falls
    await tween(300 + rand(0, 80), (t) => {
      p.drop = 1 - t * t;
      obj.scale.setScalar(size * (0.6 + 0.4 * ease.out(t)));
    });
    kick(0.012);
    onLand?.(kind);
    if (face.mood === 'normal' && performance.now() - lastGrin > 700) {
      lastGrin = performance.now();
      setMood('happy', 380);
    }
    await tween(320, (t) => (p.squash = Math.sin(t * Math.PI) * (1 - t * 0.5)));
  }

  function removePiece(p, fling = false) {
    const idx = pieces.indexOf(p);
    if (idx >= 0) pieces.splice(idx, 1);
    const start = p.obj.scale.x;
    const v = p.normal.clone().multiplyScalar(fling ? 0.4 : 0.15);
    tween(reduced ? 1 : 260, (t) => {
      p.obj.scale.setScalar(start * (1 - ease.in(t)));
      p.obj.position.copy(p.base).addScaledVector(v, t);
    }).then(() => swirlRoot.remove(p.obj));
  }

  function makeDrizzle() {
    const pts = [];
    const from = Math.floor(0.12 * sw.samples), to = Math.floor(Math.min(level, 0.93) * sw.samples);
    for (let i = from; i < to; i += 6) {
      const wob = Math.sin(i * 0.09) * 0.5;
      const hint = new THREE.Vector3(Math.cos(sw.TH[i]), 1.4 + wob, Math.sin(sw.TH[i])).normalize();
      const s = surfaceAt(sw, i, hint);
      pts.push(s.pos.addScaledVector(s.normal, 0.004));
    }
    if (pts.length < 4) return null;
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, pts.length * 4, 0.028, 10, false);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#D0863C', roughness: 0.5 }));
    m.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime, uAmp, uH;\nuniform vec4 uDent[4];\nuniform vec3 uDentDir[4];')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + dentGLSL(0.04))
        .replace('#include <begin_vertex>', 'vec3 transformed = dentP;\n' + JIGGLE_GLSL);
    };
    m.castShadow = true;
    m.userData.total = geo.index.count;
    m.userData.maxI = to;
    geo.setDrawRange(0, 0);
    return m;
  }
  async function addDrizzle() {
    removeDrizzle();
    drizzle = makeDrizzle();
    if (!drizzle) return;
    swirlRoot.add(drizzle);
    const d = drizzle;
    await tween(reduced ? 1 : 900, (t) => d.geometry.setDrawRange(0, Math.floor((t * d.userData.total) / 3) * 3));
  }
  function removeDrizzle() {
    if (!drizzle) return;
    const d = drizzle;
    drizzle = null;
    tween(reduced ? 1 : 250, (t) => d.scale.setScalar(1 - t * 0.02 + 0.0001)).then(() => swirlRoot.remove(d));
    d.material.transparent = true;
    tween(250, (t) => (d.material.opacity = 1 - t));
  }

  async function addTopping(kind) {
    active.add(kind);
    if (busy && pouring) return; // will be added after the pour
    if (kind === 'caramel') return addDrizzle();
    const n = PIECE_COUNT[kind];
    await Promise.all(Array.from({ length: n }, (_, k) => dropPiece(kind, k * 90)));
  }
  function removeTopping(kind) {
    active.delete(kind);
    if (kind === 'caramel') return removeDrizzle();
    pieces.filter((p) => p.kind === kind).forEach((p) => removePiece(p));
  }
  function clearAllToppings() {
    [...pieces].forEach((p) => removePiece(p));
    removeDrizzle();
  }
  async function restoreToppings() {
    let delay = 0;
    const jobs = [...active].map((k) => {
      if (k === 'caramel') return wait(200).then(addDrizzle);
      return Promise.all(Array.from({ length: PIECE_COUNT[k] }, () => dropPiece(k, (delay += 70))));
    });
    await Promise.all(jobs);
  }

  /* ----- tweening ----- */
  const tweens = new Set();
  function tween(ms, fn) {
    return new Promise((resolve) => {
      if (ms <= 1) { fn(1); return resolve(); }
      tweens.add({ start: performance.now(), ms, fn, resolve });
    });
  }

  /* ----- springs: squash + jiggle ----- */
  let jigAmp = 0;
  const sq = { x: 0, v: 0 };
  function kick(amount) {
    if (reduced) return;
    jigAmp = Math.min(0.06, jigAmp + amount);
    sq.v -= amount * 9;
  }

  /* ----- pouring ----- */
  let busy = false, pouring = false;
  let serveRot = 0;
  const alphaEnd = faceTh - Math.PI / 2;
  const thetaEnd = sw.turns * TAU;
  const c0 = alphaEnd - thetaEnd;
  cup.rotation.y = Math.PI - alphaEnd;

  function placeNozzle(i) {
    const p = sw.P[i].clone();
    p.y += sw.R[i] * 1.05 + 0.02;
    swirlRoot.localToWorld(p);
    stage.worldToLocal(p);
    nozzle.position.copy(p);
  }

  async function pour({ fromLevel = 0 } = {}) {
    pouring = true;
    onPour?.('start');
    U.uDent.value.forEach((d) => d.set(0, 0, 0, 0));
    faceMat.opacity = 0;
    faceMesh.visible = false;
    setLevel(fromLevel);
    if (reduced) {
      serving.rotation.y = alphaEnd;
      setLevel(1);
      faceMat.opacity = 1;
      faceMesh.visible = true;
      pouring = false;
      onPour?.('end');
      return;
    }
    // line the cup up under the nozzle, nozzle comes down
    const startRot = serving.rotation.y;
    const r0 = c0 + Math.round((startRot - c0) / TAU) * TAU;
    const startI = Math.floor(fromLevel * sw.samples);
    nozzle.visible = true;
    serving.rotation.y = r0 + sw.TH[startI];
    swirlRoot.updateMatrixWorld(true);
    placeNozzle(startI);
    const nozzleY = nozzle.position.y;
    await tween(380, (t) => { nozzle.position.y = nozzleY + 2.4 * (1 - ease.out(t)); });
    const dur = 2300 * (1 - fromLevel);
    let faceShown = false;
    await tween(dur, (t) => {
      const lv = fromLevel + (1 - fromLevel) * ease.sine(t);
      setLevel(lv);
      const i = Math.min(sw.samples, Math.round(lv * sw.samples));
      serving.rotation.y = r0 + sw.TH[i];
      swirlRoot.updateMatrixWorld(true);
      placeNozzle(i);
      if (!faceShown && i > faceI + 40) {
        faceShown = true;
        popFace();
      }
    });
    serveRot = 0;
    const ny = nozzle.position.y;
    tween(420, (t) => (nozzle.position.y = ny + 2.6 * ease.in(t))).then(() => (nozzle.visible = false));
    kick(0.03);
    pouring = false;
    onPour?.('end');
  }

  // the face fades in with its eyes shut, then opens them and smiles
  function popFace() {
    face.blink = true;
    face.mood = 'normal';
    drawFace();
    fadeFace(1, 260);
    setTimeout(() => { face.blink = false; setMood('happy', 900); }, 420);
  }

  /* ----- biting: the spoon digs in and leaves a hollow ----- */
  const MAX_BITES = 3;
  let bites = 0;
  const lines = ['mmm.', 'so tangy.', 'brain freeze!', 'worth it.', 'one more?', 'made fresh, you can tell.', 'okay that was good.'];
  let lineIdx = Math.floor(Math.random() * lines.length);
  const perTurn = sw.samples / sw.turns;
  const biteZones = [0, 1, 2].map((k) => biteSpot(k).c);

  // scoops come out of the coil above the face, where the camera looks straight into them;
  // the last one takes the peak
  function biteSpot(n) {
    if (n === 2) {
      const tip = sw.P[sw.samples];
      const dn = up.clone().addScaledVector(front, 0.5).normalize();
      return { c: tip.clone().addScaledVector(dn, 0.06), R: 0.27, n: dn };
    }
    const i = Math.min(sw.samples - 1, faceI + Math.round(perTurn) + (n === 0 ? 14 : -26));
    const hint = new THREE.Vector3(Math.cos(sw.TH[i]), 0.75, Math.sin(sw.TH[i])).normalize();
    const sp = surfaceAt(sw, i, hint);
    return { c: sp.pos.clone().addScaledVector(sp.normal, 0.05), R: 0.25, n: sp.normal };
  }

  // little bits of froyo falling off the spoon
  const crumbGeo = new THREE.SphereGeometry(0.022, 10, 8);
  function dribble(from) {
    if (reduced) return;
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(crumbGeo, scoop.material);
      const v = new THREE.Vector3(rand(-0.25, 0.25), rand(0.1, 0.4), rand(-0.1, 0.25));
      const p0 = from.clone().add(new THREE.Vector3(rand(-0.06, 0.06), 0, rand(-0.06, 0.06)));
      m.scale.setScalar(rand(0.6, 1.3));
      scene.add(m);
      const s0 = m.scale.x;
      tween(rand(500, 750), (t) => {
        m.position.set(p0.x + v.x * t, p0.y + v.y * t - 1.6 * t * t, p0.z + v.z * t);
        m.scale.setScalar(s0 * (1 - t * 0.6));
      }).then(() => scene.remove(m));
    }
  }

  let biteQueued = false;
  async function bite() {
    if (busy) {
      // remember one tap made mid-animation and run it right after
      if (biteQueued) return;
      biteQueued = true;
      while (busy) await wait(80);
      biteQueued = false;
    }
    busy = true;
    try {
      if (level < 0.05) { await pour(); return; }
      const spot = biteSpot(bites);
      const dent = U.uDent.value[bites];
      dent.set(spot.c.x, spot.c.y, spot.c.z, 0);
      U.uDentDir.value[bites].copy(spot.n).negate();
      swirlRoot.updateMatrixWorld(true);
      const cW = swirlRoot.localToWorld(spot.c.clone());
      const nW = spot.n.clone().transformDirection(swirlRoot.matrixWorld);

      setMood('shock');
      onBite?.('incoming');
      spoon.visible = true;
      scoop.visible = false;
      scoop.scale.setScalar(0.001);
      const startP = new THREE.Vector3(2.4, 2.6, 1.8);
      const entry = cW.clone().addScaledVector(nW, 0.32).add(new THREE.Vector3(0.12, 0.1, 0));
      const deep = cW.clone().addScaledVector(nW, -spot.R * 0.55);
      const lift = cW.clone().addScaledVector(nW, 0.3).add(new THREE.Vector3(0.1, 0.32, 0.25));
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const mouthP = camera.position.clone().addScaledVector(camDir, 2.2).add(new THREE.Vector3(0.25, -0.55, 0));
      const setSpoon = (p, tilt, yaw) => {
        spoon.position.copy(p);
        spoon.rotation.set(tilt, yaw, 0);
      };
      const lerp3 = (a, b, t) => a.clone().lerp(b, t);
      const dur = (ms) => (reduced ? 1 : ms);

      await tween(dur(520), (t) => setSpoon(lerp3(startP, entry, ease.out(t)), -0.6 + 0.2 * t, 0.9));
      // dig in: the spoon sinks into the swirl and the hollow opens around it
      await tween(dur(280), (t) => {
        setSpoon(lerp3(entry, deep, ease.inOut(t)), -0.4 + 0.25 * t, 0.9);
        dent.w = spot.R * 0.7 * ease.out(t);
      });
      kick(0.045);
      if (spot.c.distanceTo(cap.position) < spot.R) cap.visible = false;
      const taken = pieces.filter((p) => p.base.distanceTo(spot.c) < spot.R + 0.02).slice(0, 3);
      taken.forEach((p, k) => {
        pieces.splice(pieces.indexOf(p), 1);
        spoon.attach(p.obj);
        p.from = p.obj.position.clone();
        p.to = new THREE.Vector3(Math.cos(k * 2.3) * 0.06, 0.17, Math.sin(k * 2.3) * 0.06);
        p.s0 = p.obj.scale.x;
      });
      // scoop up and out: the hollow finishes forming and the spoon comes out heaped
      scoop.visible = true;
      await tween(dur(380), (t) => {
        const e = ease.out(t);
        setSpoon(lerp3(deep, lift, e), -0.15 + 0.3 * e, 0.9 - 0.25 * e);
        dent.w = spot.R * (0.7 + 0.3 * e);
        scoop.scale.set(e, e * 0.8, e);
        taken.forEach((p) => {
          p.obj.position.lerpVectors(p.from, p.to, e);
          p.obj.scale.setScalar(p.s0 * (1 - 0.3 * e));
        });
      });
      dribble(spoon.position);
      setMood('normal');
      await tween(dur(200), () => {});
      await tween(dur(460), (t) => setSpoon(lerp3(lift, mouthP, ease.in(t)), 0.15 + 0.5 * t, 0.65 - 0.65 * t));
      scoop.visible = false;
      taken.forEach((p) => spoon.remove(p.obj));
      bites++;
      const line = lines[lineIdx++ % lines.length];
      onBite?.('eaten', { line, bites });
      setMood('yum', 1300);
      const out = mouthP.clone();
      await tween(dur(380), (t) => setSpoon(out.clone().add(new THREE.Vector3(1.4 * t, -1.2 * t, 0)), 0.6, 0));
      spoon.visible = false;

      if (bites >= MAX_BITES) {
        await wait(reduced ? 0 : 900);
        onBite?.('empty');
        const from = level;
        clearAllToppings();
        fadeFace(0, 200);
        await tween(dur(400), (t) => setLevel(from * (1 - ease.inOut(t))));
        bites = 0;
        await pour();
        await restoreToppings();
      }
    } finally {
      busy = false;
    }
  }

  /* ----- flavor change: un-pour, recolor, pour again ----- */
  let firstPour = true;
  async function setFlavor(a, b) {
    const ca = new THREE.Color(a), cb = new THREE.Color(b || a);
    if (firstPour) {
      U.uColA.value.copy(ca); U.uColB.value.copy(cb);
      mound.material.userData.c = ca;
      firstPour = false;
      busy = true;
      await pour();
      busy = false;
      await restoreToppings();
      return;
    }
    if (busy) {
      U.uColA.value.copy(ca); U.uColB.value.copy(cb);
      return;
    }
    busy = true;
    try {
      clearAllToppings();
      fadeFace(0, 180);
      const from = level;
      await tween(reduced ? 1 : 420, (t) => setLevel(from * (1 - ease.inOut(t))));
      U.uColA.value.copy(ca); U.uColB.value.copy(cb);
      bites = 0;
      await pour();
    } finally {
      busy = false;
    }
    await restoreToppings();
  }

  function boing() {
    if (reduced) return;
    hop = 1;
    sq.v -= 0.5;
    jigAmp = Math.min(0.06, jigAmp + 0.03);
    setMood('happy', 700);
  }

  /* ----- input: drag to spin, tap to bite ----- */
  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag = null, spinV = 0, userYaw = 0;
  const pointer = { x: 0, y: 0, at: 0 };
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, last: e.clientX };
  });
  window.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    pointer.at = performance.now();
    pointer.x = Math.max(-1.4, Math.min(1.4, ((e.clientX - r.left) / r.width) * 2 - 1));
    pointer.y = Math.max(-1.4, Math.min(1.4, -((e.clientY - r.top) / r.height) * 2 + 1));
    if (!drag) return;
    const dx = e.clientX - drag.last;
    if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
    if (drag.moved) {
      userYaw += dx * 0.01;
      spinV = dx * 0.01;
    }
    drag.last = e.clientX;
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const wasTap = !drag.moved && performance.now() - drag.t < 450;
    drag = null;
    if (!wasTap) return;
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObjects([swirl, cup, mound, cap], false).length) bite();
  });

  /* ----- layout ----- */
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const fitH = 2.65, fitW = 2.6;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const distH = fitH / 2 / Math.tan(vfov / 2);
    const distW = fitW / 2 / (Math.tan(vfov / 2) * camera.aspect);
    const d = Math.max(distH, distW);
    camera.position.set(0, target.y + d * 0.32, d);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  /* ----- loop ----- */
  let visible = true, last = performance.now(), hop = 0, idleT = 3 + Math.random() * 3, blinkT = 2.5;
  let wanderT = 0, mouthT = 2, lastGrin = 0;
  const look = new THREE.Vector2(), wander = new THREE.Vector2();
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(container);
  const tmp = new THREE.Vector3();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const tw of tweens) {
      const t = Math.min(1, (now - tw.start) / tw.ms);
      tw.fn(t);
      if (t >= 1) { tweens.delete(tw); tw.resolve(); }
    }
    if (!visible) return;
    U.uTime.value = now / 1000;

    // springs
    jigAmp *= Math.exp(-dt * 3.2);
    U.uAmp.value = jigAmp;
    sq.v += (-sq.x * 120 - sq.v * 9) * dt;
    sq.x += sq.v * dt;
    const breath = reduced ? 0 : Math.sin(now / 1000 * 2.4) * 0.012;
    swirlRoot.scale.set(1 - sq.x * 0.5 - breath * 0.5, 1 + sq.x + breath, 1 - sq.x * 0.5 - breath * 0.5);
    if (hop > 0) {
      hop = Math.max(0, hop - dt * 2.2);
      serving.position.y = Math.sin((1 - hop) * Math.PI) * 0.05;
      if (hop === 0) sq.v -= 0.35;
    }

    // idle life
    if (!reduced && !busy) {
      idleT -= dt;
      if (idleT < 0) {
        idleT = rand(4, 8);
        if (Math.random() < 0.45) boing(); else kick(0.02);
      }
    }
    blinkT -= dt;
    if (blinkT < 0) {
      blinkT = rand(2.2, 5);
      blink();
      if (Math.random() < 0.2) setTimeout(() => blink(), 240);
    }

    // eyes follow the pointer, and wander on their own once it stops moving
    if (!reduced) {
      if (now - pointer.at > 2500) {
        wanderT -= dt;
        if (wanderT < 0) {
          wanderT = rand(1.2, 2.8);
          wander.set(rand(-1, 1), rand(-0.6, 0.8));
        }
        look.lerp(wander, Math.min(1, dt * 5));
      } else {
        look.lerp(tmp.set(pointer.x, pointer.y, 0), Math.min(1, dt * 12));
      }
      // mouth opens and closes now and then, like it's humming
      mouthT -= dt;
      if (mouthT < 0) {
        mouthT = rand(1.8, 4.5);
        face.mouthOpen = !face.mouthOpen;
        if (face.mood === 'normal') drawFace();
      }
    }
    const lx = Math.round(Math.max(-1.2, Math.min(1.2, look.x)) * 9);
    const ly = Math.round(Math.max(-1.2, Math.min(1.2, -look.y)) * 6);
    if (lx !== face.lx || ly !== face.ly) {
      face.lx = lx;
      face.ly = ly;
      if (face.mood === 'normal' && !face.blink) drawFace();
    }

    // stage: drag spin with inertia, drifts back so the face returns
    if (!drag) {
      userYaw += spinV;
      spinV *= Math.exp(-dt * 4);
      userYaw *= Math.exp(-dt * (Math.abs(spinV) < 0.002 ? 1.4 : 0));
    }
    const lookYaw = reduced ? 0 : pointer.x * 0.22;
    stage.rotation.y += (userYaw + lookYaw - stage.rotation.y) * Math.min(1, dt * 8);
    swirlRoot.rotation.x += ((reduced ? 0 : -pointer.y * 0.05) - swirlRoot.rotation.x) * Math.min(1, dt * 6);

    // things stuck to the swirl ride the jiggle
    for (const p of pieces) {
      jiggleAt(p.base.y, tmp);
      p.obj.position.copy(p.base).add(tmp);
      p.obj.position.y += p.drop * 0.55;
      if (p.squash) p.obj.scale.set(p.size * (1 + p.squash * 0.25), p.size * (1 - p.squash * 0.3), p.size * (1 + p.squash * 0.25));
    }
    cap.position.x = sw.P[Math.min(sw.samples, Math.round(level * sw.samples))].x + jiggleAt(cap.position.y, tmp).x;

    // mist
    if (mistMat.visible !== false) {
      for (let k = 0; k < MIST; k++) {
        const m = mistLife[k];
        m.age += dt / 4;
        if (m.age > 1) respawnMist(m, k);
        mistPos[k * 3] += m.v.x * dt;
        mistPos[k * 3 + 1] += m.v.y * dt;
        mistPos[k * 3 + 2] += m.v.z * dt;
      }
      mistGeo.attributes.position.needsUpdate = true;
      mistMat.opacity = 0.2 * Math.min(1, level * 1.5);
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  return {
    setFlavor,
    addTopping,
    removeTopping,
    bite,
    boing,
    get busy() { return busy; },
    // screen position of the swirl's face, for placing speech bubbles
    faceScreen() {
      const p = faceSpot.pos.clone();
      swirlRoot.localToWorld(p);
      p.project(camera);
      const r = el.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
  };
}
