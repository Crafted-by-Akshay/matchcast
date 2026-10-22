import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (u) => u * u * (3 - 2 * u);
const wrapA = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
let seed = 48213;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const V2 = (x, z) => new THREE.Vector2(x, z);

/*@@WORLD@@*/
// ============ SQUADS (fictional) ============
// Formation slots are in each team's own frame: attacking +x, own goal at x=0, left touchline at z=0.
const TEAMS = [
  { key: 'HAR', club: 'Harbor City', kit: 0x2F7BEA, kit2: 0xF2F5F8, kitShorts: 0xF2F5F8, kitSocks: 0x2F7BEA, gkKit: 0x9BE35A, css: '#3D86F0', form: '4-3-3', players: [
    [1, 'D. Rouvelle', 'GK', [4, 34], 79, 1.91, 'R'], [2, 'A. Hallund', 'LB', [18, 9], 76, 1.76, 'L'], [5, 'M. Adedimi', 'CB', [16, 26], 81, 1.90, 'R'], [4, 'J. Holstrand', 'CB', [16, 42], 80, 1.86, 'R'], [3, 'L. Odahara', 'RB', [18, 59], 77, 1.79, 'R'],
    [8, 'S. Kaldersen', 'CM', [36, 22], 82, 1.74, 'R'], [6, 'R. Odanari', 'DM', [31, 34], 84, 1.88, 'R'], [10, 'E. Kawakami', 'CM', [36, 46], 83, 1.80, 'L'], [7, 'P. Raslund', 'LW', [52, 10], 80, 1.72, 'R'], [9, 'K. Navdero', 'ST', [55, 34], 86, 1.84, 'R'], [11, 'N. Kosmir', 'RW', [52, 58], 79, 1.75, 'L']] },
  { key: 'RID', club: 'Ridgeview', kit: 0xF2702A, kit2: 0x1A1D22, kitShorts: 0x1A1D22, kitSocks: 0xF2702A, gkKit: 0xA98BFF, css: '#FF7A2E', form: '4-4-2', players: [
    [1, 'O. Navlano', 'GK', [4, 34], 80, 1.93, 'R'], [3, 'T. Kawaoka', 'LB', [18, 9], 76, 1.78, 'L'], [4, 'H. Hologren', 'CB', [16, 26], 79, 1.89, 'R'], [5, 'G. Frelund', 'CB', [16, 42], 78, 1.92, 'R'], [2, 'F. Englund', 'RB', [18, 59], 75, 1.73, 'R'],
    [11, 'Y. Minaoka', 'LM', [38, 9], 78, 1.71, 'L'], [6, 'B. Seydimi', 'CM', [34, 27], 80, 1.83, 'R'], [8, 'C. Hirahara', 'CM', [34, 41], 81, 1.77, 'R'], [7, 'T. Torlund', 'RM', [38, 59], 85, 1.81, 'R'], [9, 'S. Bellaine', 'ST', [53, 29], 82, 1.87, 'R'], [10, 'V. Takekami', 'ST', [53, 40], 83, 1.80, 'L']] }
];
const SKIN = [0xF1C9A5, 0xC68E62, 0x8D5A3B, 0xE0B08A, 0x5C3A24, 0xD9A47A, 0xA86B45, 0x704530];
const surname = (n) => n.split(' ').slice(-1)[0];
TEAMS.forEach((T, ti) => {
  const el = $(ti ? 'xiB' : 'xiA');
  T.players.forEach(([n, name, pos]) => { const r = document.createElement('div'); r.className = 'row'; r.style.borderLeft = '3px solid ' + T.css; r.innerHTML = '<b style="color:' + T.css + '">' + n + '</b>' + name + '<em>' + pos + '</em>'; el.appendChild(r); });
});

// ============ RENDERER ============
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(stage.clientWidth, stage.clientHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060A12);
scene.fog = new THREE.Fog(0x060A12, 180, 460);
const camera = new THREE.PerspectiveCamera(30, stage.clientWidth / stage.clientHeight, 0.3, 900);
camera.position.set(0, 60, 120);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false; controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 4; controls.maxDistance = 220;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(stage.clientWidth, stage.clientHeight), 0.55, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

scene.add(new THREE.HemisphereLight(0xBFD4FF, 0x1C2A1A, 0.6));
const sun = new THREE.DirectionalLight(0xFFF4E2, 2.3);
sun.position.set(-40, 90, 45); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -68, right: 68, top: 48, bottom: -48, near: 10, far: 240 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; scene.add(sun);
const sun2 = new THREE.DirectionalLight(0xD8E6FF, 0.9); sun2.position.set(55, 75, -50); scene.add(sun2);

const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; if (draw) draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };

// ============ PITCH ============
// World: pitch x 0..105 maps to X -52.5..52.5, z 0..68 maps to Z -34..34.
const W = (x, y, z) => new THREE.Vector3(x - 52.5, y, z - 34);
const PX = 20;
let PSTYLE = { mow: 'stripes', turf: ['#2E7340', '#276536'], wear: 0.35, shade: false };
function paintPitch(g, w, h) {
  const ox = 8 * PX, oy = 8 * PX;
  g.fillStyle = PSTYLE.turf[1]; g.fillRect(0, 0, w, h); const [t0, t1] = PSTYLE.turf; const mw = 5.25 * PX;
  // each groundsman has a signature mowing pattern
  if (PSTYLE.mow === 'stripes' || PSTYLE.mow === 'wide') { const sw = PSTYLE.mow === 'wide' ? mw * 1.6 : mw; for (let i = -2; i * sw < w; i++) { g.fillStyle = i % 2 ? t0 : t1; g.fillRect(ox + i * sw, 0, sw + 1, h); } }
  else if (PSTYLE.mow === 'checker') { for (let i = -2; i * mw < w; i++) for (let j = -2; j * mw < h; j++) { g.fillStyle = (i + j) % 2 ? t0 : t1; g.fillRect(ox + i * mw, oy + j * mw, mw + 1, mw + 1); } }
  else if (PSTYLE.mow === 'circles') { for (let r = 30; r > 0; r--) { g.fillStyle = r % 2 ? t0 : t1; g.beginPath(); g.arc(ox + 52.5 * PX, oy + 34 * PX, r * 4.2 * PX, 0, 7); g.fill(); } }
  else if (PSTYLE.mow === 'diagonal') { g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 4); for (let i = -30; i < 30; i++) { g.fillStyle = i % 2 ? t0 : t1; g.fillRect(i * mw, -w, mw + 1, 2 * w); } g.restore(); }
  if (PSTYLE.shade) { const sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, 'rgba(70,60,30,0.28)'); sg.addColorStop(0.35, 'rgba(70,60,30,0)'); g.fillStyle = sg; g.fillRect(0, 0, w, h); }
  for (let i = 0; i < 90000; i++) { g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0,' : '210,255,200,') + (rnd() * 0.06).toFixed(3) + ')'; g.fillRect(rnd() * w, rnd() * h, 2, 2 + rnd() * 3); }
  // worn areas in the goalmouths and centre
  for (const [x, y, r] of [[5, 34, 6], [100, 34, 6], [52.5, 34, 5]]) { const gr = g.createRadialGradient(ox + x * PX, oy + y * PX, 0, ox + x * PX, oy + y * PX, r * PX); gr.addColorStop(0, 'rgba(110,95,60,' + PSTYLE.wear + ')'); gr.addColorStop(1, 'rgba(110,95,60,0)'); g.fillStyle = gr; g.fillRect(ox + (x - r) * PX, oy + (y - r) * PX, 2 * r * PX, 2 * r * PX); }
  g.strokeStyle = 'rgba(245,248,245,0.92)'; g.lineWidth = 0.12 * PX; g.lineCap = 'round';
  const L = (pts) => { g.beginPath(); pts.forEach(([x, y], j) => (j ? g.lineTo : g.moveTo).call(g, ox + x * PX, oy + y * PX)); g.stroke(); };
  const R = (x0, y0, x1, y1) => L([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
  const A = (cx, cy, r, a0, a1) => { g.beginPath(); g.arc(ox + cx * PX, oy + cy * PX, r * PX, a0, a1); g.stroke(); };
  R(0, 0, 105, 68); L([[52.5, 0], [52.5, 68]]); A(52.5, 34, 9.15, 0, Math.PI * 2);
  R(0, 13.84, 16.5, 54.16); R(88.5, 13.84, 105, 54.16); R(0, 24.84, 5.5, 43.16); R(99.5, 24.84, 105, 43.16);
  A(11, 34, 9.15, -0.925, 0.925); A(94, 34, 9.15, Math.PI - 0.925, Math.PI + 0.925);
  for (const [x, y] of [[52.5, 34], [11, 34], [94, 34]]) { g.fillStyle = '#F5F8F5'; g.beginPath(); g.arc(ox + x * PX, oy + y * PX, 0.2 * PX, 0, 7); g.fill(); }
  for (const [x, y, a] of [[0, 0, 0], [105, 0, Math.PI / 2], [105, 68, Math.PI], [0, 68, -Math.PI / 2]]) A(x, y, 1, a, a + Math.PI / 2);

}
const pitchTex = canvasTex(121 * PX, 84 * PX, paintPitch);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(121, 84), new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 220), new THREE.MeshStandardMaterial({ color: 0x1D3826, roughness: 1 }));
apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true; scene.add(apron);

// ============ GOALS (match the physics: posts at z 30.34 / 37.66, bar 2.44) ============
const white = new THREE.MeshStandardMaterial({ color: 0xF4F6F8, roughness: 0.35 });
const netTex = canvasTex(256, 256, (g, w, h) => { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; for (let i = 0; i <= w; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } });
netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping; netTex.repeat.set(4, 2);
const netMat = new THREE.MeshStandardMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1 });
function makeGoal(gx, out) {
  const g = new THREE.Group(); const r = 0.06;
  const cyl = (len) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), white); m.castShadow = true; return m; };
  for (const z of [30.28, 37.72]) { const p = cyl(2.5); p.position.copy(W(gx, 1.25, z)); g.add(p); }
  const bar = cyl(7.56); bar.rotation.x = Math.PI / 2; bar.position.copy(W(gx, 2.5, 34)); g.add(bar);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.1), netMat); back.rotation.y = Math.PI / 2; back.position.copy(W(gx + out * 2, 1.05, 34)); g.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(2, 7.32), netMat); top.rotation.x = -Math.PI / 2; top.position.copy(W(gx + out, 2.27, 34)); top.rotation.z = out * 0.17; g.add(top);
  for (const z of [30.34, 37.66]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.44), netMat); s.position.copy(W(gx + out, 1.22, z)); g.add(s); }
  scene.add(g);
}
makeGoal(0, -1); makeGoal(105, 1);
for (const [x, z] of [[0, 0], [105, 0], [105, 68], [0, 68]]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), white); p.position.copy(W(x, 0.75, z)); scene.add(p);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), new THREE.MeshStandardMaterial({ color: 0xFFD166, side: THREE.DoubleSide })); f.position.copy(W(x + 0.22, 1.32, z)); scene.add(f);
}

// ============ LED BOARDS: MatchCast + Azure campaign rotation ============
// One 2048x128 canvas = one 16 m "slot"; every perimeter board tiles it like a real LED ribbon.
const LED = { c: document.createElement('canvas'), t: 0, mode: null, goalTeam: -1, goalT: 0 };
LED.c.width = 2048; LED.c.height = 128;
const ledTex = new THREE.CanvasTexture(LED.c); ledTex.colorSpace = THREE.SRGBColorSpace; ledTex.wrapS = THREE.RepeatWrapping; ledTex.anisotropy = 8;
const FAS = { c: document.createElement('canvas') }; FAS.c.width = 4096; FAS.c.height = 96;
const fasTex = new THREE.CanvasTexture(FAS.c); fasTex.colorSpace = THREE.SRGBColorSpace; fasTex.wrapS = THREE.RepeatWrapping; fasTex.anisotropy = 8;
const CAMPAIGNS = [
  { k: 'mc', bg: ['#04101F', '#0A2A55'], fg: '#FFFFFF', ac: '#5AA2FF', title: 'MATCHCAST', sub: 'AI MATCH INTELLIGENCE · LIVE' },
  { k: 'az', bg: ['#002A4D', '#0062AD'], fg: '#FFFFFF', ac: '#50E6FF', title: 'AZURE AI FOUNDRY', sub: 'FOUR AGENTS · EVERY CLAIM VERIFIED' },
  { k: 'live', bg: ['#050505', '#141414'], fg: '#FFFFFF', ac: '#FFE066', title: '', sub: '' },
  { k: 'az', bg: ['#0B1530', '#1B3A8A'], fg: '#FFFFFF', ac: '#7FD1FF', title: 'AZURE DATABRICKS', sub: 'DANGER MODEL · MLFLOW · UNITY CATALOG' },
  { k: 'sp', bg: ['#2A1206', '#4A2008'], fg: '#FFD9B8', ac: '#FF8A3D', title: 'CONTOSO', sub: 'OFFICIAL ENERGY PARTNER' },
  { k: 'az', bg: ['#002B36', '#00596E'], fg: '#FFFFFF', ac: '#5EE6E6', title: 'MICROSOFT FABRIC', sub: 'REAL-TIME INTELLIGENCE · EVENTHOUSE' },
  { k: 'az', bg: ['#1A0B33', '#3A1A75'], fg: '#FFFFFF', ac: '#C7A3FF', title: 'AZURE AI SPEECH', sub: 'COMMENTARY IN ENGLISH AND TAMIL' },
  { k: 'mc', bg: ['#04101F', '#0A2A55'], fg: '#FFFFFF', ac: '#8EE8B8', title: 'VERIFIED 96%', sub: 'MULTI-AGENT VS 71% SINGLE-AGENT' },
  { k: 'az', bg: ['#08121E', '#123A66'], fg: '#FFFFFF', ac: '#50E6FF', title: 'AZURE CONTAINER APPS', sub: 'EVENT HUBS · COSMOS DB · KEY VAULT' },
  { k: 'sp', bg: ['#0E2A1C', '#174A30'], fg: '#D8FFE9', ac: '#8EE8B8', title: 'WOODGROVE BANK', sub: 'BANKING ON THE HOME TEAM' },
  { k: 'az', bg: ['#111111', '#2B2B2B'], fg: '#FFFFFF', ac: '#E6EDF3', title: 'GITHUB COPILOT', sub: 'BUILT IN AGENT MODE · AZURE MCP' },
  { k: 'sp', bg: ['#101820', '#22303E'], fg: '#FFE7A3', ac: '#FFD166', title: 'NORTHWIND AIR', sub: 'FLY THE HARBOR CITY WAY' }
];
const SLOT = 16, CAMP_LEN = 7.5;
function drawCampaign(g, cp, u, x0) {
  const w = 2048, h = 128;
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, cp.bg[1]); gr.addColorStop(1, cp.bg[0]); g.fillStyle = gr; g.fillRect(x0, 0, w, h);
  g.save(); g.beginPath(); g.rect(x0, 0, w, h); g.clip();
  // moving light sweep
  const sx = x0 + ((u * 1.4) % 1) * (w + 600) - 300; const sw = g.createLinearGradient(sx - 160, 0, sx + 160, 0); sw.addColorStop(0, 'rgba(255,255,255,0)'); sw.addColorStop(0.5, 'rgba(255,255,255,0.10)'); sw.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sw; g.fillRect(x0, 0, w, h);
  if (cp.k === 'live') {
    const m = Math.floor(S.clock / 60);
    g.fillStyle = TEAMS[0].css; g.fillRect(x0 + 140, 22, 18, 84); g.fillStyle = TEAMS[1].css; g.fillRect(x0 + 1890, 22, 18, 84);
    g.fillStyle = '#FFFFFF'; g.font = '700 84px "Barlow Condensed", Arial Narrow, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(TEAMS[0].club.toUpperCase() + '  ' + S.score[0] + ' – ' + S.score[1] + '  ' + TEAMS[1].club.toUpperCase(), x0 + w / 2 - 120, 66, 1300);
    g.fillStyle = cp.ac; g.font = '700 60px "JetBrains Mono", monospace'; g.fillText(m + "'", x0 + 1640, 66);
    g.font = '600 26px "IBM Plex Sans", sans-serif'; g.fillStyle = '#9FB0C2'; g.textAlign = 'left';
    g.fillText('xG ' + STATS.xg[0].toFixed(2) + ' – ' + STATS.xg[1].toFixed(2) + '   SHOTS ' + STATS.shots[0] + ' – ' + STATS.shots[1], x0 + 190, 112);
  } else {
    const ent = ease(clamp(u * 5, 0, 1));
    g.textBaseline = 'middle';
    // chevrons
    g.fillStyle = cp.ac; for (let i = 0; i < 3; i++) { const cx = x0 + 70 + i * 34 + (1 - ent) * -200; g.beginPath(); g.moveTo(cx, 30); g.lineTo(cx + 22, 64); g.lineTo(cx, 98); g.lineTo(cx + 12, 98); g.lineTo(cx + 34, 64); g.lineTo(cx + 12, 30); g.closePath(); g.globalAlpha = 0.35 + 0.65 * ((Math.floor(u * 12) + i) % 3 === 0 ? 1 : 0.4); g.fill(); }
    g.globalAlpha = 1;
    g.fillStyle = cp.fg; g.textAlign = 'left'; g.font = '700 80px "Barlow Condensed", Arial Narrow, sans-serif';
    const tx = x0 + 230 + (1 - ent) * 400; g.globalAlpha = ent; g.shadowColor = cp.ac; g.shadowBlur = 16;
    g.fillText(cp.title, tx, 54); g.shadowBlur = 0;
    g.fillStyle = cp.ac; g.font = '600 30px "IBM Plex Sans", sans-serif'; g.fillText(cp.sub, tx + 4, 104);
    g.globalAlpha = 1;
    if (cp.k === 'az' || cp.k === 'mc') { g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '600 24px "IBM Plex Sans", sans-serif'; g.textAlign = 'right'; g.fillText(cp.k === 'mc' ? 'MATCHCAST.LIVE' : 'POWERING MATCHCAST', x0 + w - 60, 64); }
  }
  g.restore();
}
function drawLED(dt) {
  LED.t += dt; const g = LED.c.getContext('2d');
  if (LED.goalT > 0) {
    LED.goalT -= dt; const T = TEAMS[LED.goalTeam]; const on = Math.floor(LED.t * 6) % 2;
    g.fillStyle = on ? T.css : '#050505'; g.fillRect(0, 0, 2048, 128);
    g.fillStyle = on ? '#06121F' : T.css; g.font = '700 104px "Barlow Condensed", Arial Narrow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('GOAL  ·  ' + T.club.toUpperCase() + '  ·  GOAL', 1024, 68);
  } else {
    const n = CAMPAIGNS.length; const k = Math.floor(LED.t / CAMP_LEN); const u = (LED.t % CAMP_LEN) / CAMP_LEN;
    const cur = CAMPAIGNS[k % n], nxt = CAMPAIGNS[(k + 1) % n];
    if (u > 0.93) { const wv = ease((u - 0.93) / 0.07); drawCampaign(g, cur, u, -wv * 2048); drawCampaign(g, nxt, 0, 2048 - wv * 2048); }
    else drawCampaign(g, cur, u, 0);
  }
  ledTex.needsUpdate = true;
  // stand fascia ticker
  const f = FAS.c.getContext('2d'); const msg = '  MATCHCAST LIVE  ·  AI MATCH INTELLIGENCE  ·  ' + TEAMS[0].club.toUpperCase() + ' ' + S.score[0] + ' – ' + S.score[1] + ' ' + TEAMS[1].club.toUpperCase() + '  ·  POWERED BY AZURE AI FOUNDRY  ·  AZURE DATABRICKS  ·  MICROSOFT FABRIC  ·  AZURE AI SPEECH  ·  GITHUB COPILOT  ·';
  f.fillStyle = '#04070C'; f.fillRect(0, 0, 4096, 96); f.font = '700 58px "Barlow Condensed", Arial Narrow, sans-serif'; f.textBaseline = 'middle';
  // the ribbon repeats every 4096px along the wall, so the message period must match it to avoid a seam
  const x = -((LED.t * 140) % 4096); f.fillStyle = '#CFE3FF'; f.fillText(msg, x, 50, 4080); f.fillText(msg, x + 4096, 50, 4080);
  fasTex.needsUpdate = true;
}
function ledMaterial(tex, res) {
  const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRes = { value: new THREE.Vector2(res[0], res[1]) };
    sh.fragmentShader = 'uniform vec2 uRes;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 cell = vMapUv * uRes; vec2 fc = fract(cell) - 0.5; float dotm = smoothstep(0.5, 0.18, length(fc));
      float px = max(fwidth(cell.x), fwidth(cell.y)); float k = clamp(1.6 - px * 1.6, 0.0, 1.0);
      diffuseColor.rgb *= mix(1.0, mix(0.35, 1.35, dotm), k) * 1.25;`);
  };
  return m;
}
const ledMat = ledMaterial(ledTex, [2048 / 2.5, 128 / 2.5]);
const fasMat = ledMaterial(fasTex, [4096 / 3, 96 / 3]);
const darkMat = new THREE.MeshStandardMaterial({ color: 0x0B0F15, roughness: 0.7 });
let perimU = 0;
function addBoard(len, cx, cz, ry) {
  const geo = new THREE.BoxGeometry(len, 1.0, 0.14);
  const uv = geo.attributes.uv; for (let i = 16; i < 20; i++) uv.setX(i, perimU + uv.getX(i) * len / SLOT); uv.needsUpdate = true; perimU += len / SLOT;
  const grp = new THREE.Group(); grp.position.copy(W(cx, 0, cz)); grp.rotation.y = ry;
  const m = new THREE.Mesh(geo, [darkMat, darkMat, darkMat, darkMat, ledMat, darkMat]); m.position.y = 0.55; m.rotation.x = -0.21; m.castShadow = true; grp.add(m);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.9), darkMat); leg.position.set(0, 0.03, -0.45); grp.add(leg);
  scene.add(grp);
}
addBoard(112, 52.5, -5.2, 0); addBoard(30, 109.2, 18, -Math.PI / 2); addBoard(30, 109.2, 50, -Math.PI / 2); addBoard(112, 52.5, 73.2, Math.PI); addBoard(30, -4.2, 50, Math.PI / 2); addBoard(30, -4.2, 18, Math.PI / 2);

// ============ STANDS, CROWD, ROOF, FLOODLIGHTS ============
const concrete = new THREE.MeshStandardMaterial({ color: 0x29303A, roughness: 0.95 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0x1A2432, roughness: 0.8 });
const ROWS = 24, DEPTH = 0.85, RISE = 0.5;
const stands = [{ len: 128, off: 46, ax: 'z', s: -1 }, { len: 128, off: 46, ax: 'z', s: 1 }, { len: 92, off: 66, ax: 'x', s: -1, home: 0.88 }, { len: 92, off: 66, ax: 'x', s: 1, home: 0.12 }];
const fanCount = stands.reduce((a, st) => a + Math.floor(st.len / 0.6) * ROWS, 0);
const fanGeo = new THREE.CapsuleGeometry(0.2, 0.42, 3, 6); fanGeo.translate(0, 0.42, 0);
const fanMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
fanMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = { value: 0 }; sh.uniforms.uHype = { value: 0 }; fanMat.userData.sh = sh;
  sh.vertexShader = 'uniform float uTime; uniform float uHype;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float ph = float(gl_InstanceID) * 12.9898; float r = fract(sin(ph) * 43758.5453);
    float bounce = max(0.0, sin(uTime * (1.5 + r * 3.0) + ph)) * (0.05 + 0.4 * uHype) * step(0.5 - 0.45 * uHype, r);
    transformed.y += bounce; transformed.x += sin(uTime * 0.7 + ph) * 0.03;`);
};
const fans = new THREE.InstancedMesh(fanGeo, fanMat, fanCount);
{
  const m4 = new THREE.Matrix4(), col = new THREE.Color(); let fi = 0;
  const FAN = { home: ['#2F7BEA', '#2557B5', '#E6EDF3', '#5AA2FF'], away: ['#F2702A', '#C4561A', '#1A1D22', '#FFB089'], mix: ['#2B3442', '#3A3F4A', '#6B4F3A', '#C9B7A0', '#9AA7B5', '#4A5A70', '#7A2E2E', '#E2E2D8'] };
  for (const st of stands) {
    for (let r = 0; r < ROWS; r++) {
      const d = st.off + r * DEPTH, hh = RISE * (r + 1) + 1.2;
      const step = new THREE.Mesh(new THREE.BoxGeometry(st.ax === 'z' ? st.len : DEPTH, hh, st.ax === 'z' ? DEPTH : st.len), r % 2 ? concrete : seatMat);
      if (st.ax === 'z') step.position.set(0, hh / 2, st.s * d); else step.position.set(st.s * d, hh / 2, 0);
      step.receiveShadow = true; scene.add(step);
      const n = Math.floor(st.len / 0.6);
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.05) continue;
        const along = -st.len / 2 + (k + 0.5) * 0.6 + (rnd() - 0.5) * 0.1; const sc = 0.85 + rnd() * 0.3;
        m4.makeScale(sc, sc * (0.9 + rnd() * 0.2), sc);
        if (st.ax === 'z') m4.setPosition(along, hh, st.s * d); else m4.setPosition(st.s * d, hh, along);
        fans.setMatrixAt(fi, m4);
        const u = along / st.len + 0.5; const hb = st.ax === 'z' ? lerp(0.85, 0.15, u) : st.home;
        const pool = rnd() < 0.7 ? (rnd() < hb ? FAN.home : FAN.away) : FAN.mix;
        col.set(pool[Math.floor(rnd() * pool.length)]); fans.setColorAt(fi, col); fi++;
      }
    }
    // pitch-side wall carrying the fascia LED ribbon
    const wallLen = st.len; const wall = new THREE.Mesh(new THREE.BoxGeometry(st.ax === 'z' ? wallLen : 0.3, 1.2, st.ax === 'z' ? 0.3 : wallLen), concrete);
    const wd = st.off - 0.6; if (st.ax === 'z') wall.position.set(0, 0.6, st.s * wd); else wall.position.set(st.s * wd, 0.6, 0); scene.add(wall);
    const fg = new THREE.PlaneGeometry(wallLen, 0.9); const fuv = fg.attributes.uv; for (let i = 0; i < fuv.count; i++) fuv.setX(i, fuv.getX(i) * wallLen / 40); fuv.needsUpdate = true;
    const fas = new THREE.Mesh(fg, fasMat); const fd = st.off - 0.76;
    if (st.ax === 'z') { fas.position.set(0, 0.62, st.s * fd); fas.rotation.y = st.s > 0 ? Math.PI : 0; } else { fas.position.set(st.s * fd, 0.62, 0); fas.rotation.y = st.s > 0 ? -Math.PI / 2 : Math.PI / 2; }
    scene.add(fas);
    if (!(st.ax === 'z' && st.s > 0)) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(st.ax === 'z' ? st.len + 8 : 28, 0.8, st.ax === 'z' ? 28 : st.len + 8), new THREE.MeshStandardMaterial({ color: 0x141A23, roughness: 0.9 }));
      const rd = st.off + ROWS * DEPTH * 0.6; if (st.ax === 'z') roof.position.set(0, RISE * ROWS + 11, st.s * rd); else roof.position.set(st.s * rd, RISE * ROWS + 11, 0); scene.add(roof);
      const back = new THREE.Mesh(new THREE.BoxGeometry(st.ax === 'z' ? st.len : 1, RISE * ROWS + 12, st.ax === 'z' ? 1 : st.len), concrete);
      const bd = st.off + ROWS * DEPTH + 0.5; if (st.ax === 'z') back.position.set(0, (RISE * ROWS + 12) / 2, st.s * bd); else back.position.set(st.s * bd, (RISE * ROWS + 12) / 2, 0); scene.add(back);
    }
  }
  fans.count = fi; fans.instanceMatrix.needsUpdate = true; fans.instanceColor.needsUpdate = true; scene.add(fans);
}
const glowTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,246,220,0.5)'); r.addColorStop(1, 'rgba(255,246,220,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
for (const [x, z] of [[-76, -58], [76, -58], [76, 58], [-76, 58]]) {
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 48, 10), concrete); mast.position.set(x, 24, z); scene.add(mast);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 0.6), new THREE.MeshBasicMaterial({ color: 0xFFF3DA, toneMapped: false })); panel.position.set(x, 49, z); panel.lookAt(0, 0, 0); scene.add(panel);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xFFF3DA, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); spr.scale.set(26, 26, 1); spr.position.set(x * 0.985, 49, z * 0.985); scene.add(spr);
}

// ============ BALL PHYSICS ============
const BR = 0.11, G = 9.81, KD = 0.0135, KM = 0.0012; // KD, KM at sea-level air (1.225 kg/m3)
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BR * 1.12, 28, 18), new THREE.MeshStandardMaterial({ roughness: 0.45, map: canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#F7F8FA'; g.fillRect(0, 0, w, h); g.fillStyle = '#1B2230'; for (let i = 0; i < 14; i++) { const x = (i % 7) * w / 7 + (i > 6 ? w / 14 : 0), y = i > 6 ? h * 0.72 : h * 0.3; g.beginPath(); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26); } g.fill(); } g.fillStyle = '#2F7BEA'; g.fillRect(0, h * 0.48, w, 6); }) }));
ballMesh.castShadow = true; scene.add(ballMesh);
const ball = { p: new THREE.Vector3(52.5, BR, 34), v: new THREE.Vector3(), w: new THREE.Vector3(), held: null, inNet: false, last: null };
const _t = new THREE.Vector3();
const POSTS = [[0, 30.28], [0, 37.72], [105, 30.28], [105, 37.72]];
function ballPhysics(b, dt, events) {
  // drag acts on the ball's speed relative to the air; thin or warm air (altitude) lowers both drag and swerve
  const wE = b.p.y > 1.5 ? 0.75 : 0.45; const wvx = Math.cos(ENV.windDir) * ENV.wind * wE, wvz = Math.sin(ENV.windDir) * ENV.wind * wE;
  const rx = b.v.x - wvx, ry = b.v.y, rz = b.v.z - wvz; const sp = Math.hypot(rx, ry, rz); const kd = KD * ENV.rhoRatio;
  if (sp > 0 && (b.p.y > BR + 0.01 || Math.abs(b.v.y) > 0.05)) { b.v.x -= kd * sp * rx * dt; b.v.y -= kd * sp * ry * dt; b.v.z -= kd * sp * rz * dt; } else if (sp > 0) { b.v.x -= KD * 0.6 * sp * b.v.x * dt; b.v.z -= KD * 0.6 * sp * b.v.z * dt; }
  _t.crossVectors(b.w, b.v).multiplyScalar(KM * ENV.rhoRatio * dt); b.v.add(_t);
  const air = b.p.y > BR + 0.005 || b.v.y > 0.05;
  if (air) b.v.y -= G * dt;
  b.p.addScaledVector(b.v, dt);
  if (b.p.y < BR) {
    b.p.y = BR;
    // wet turf: lower bounce, ball skids on; frozen ground bounces high; snow kills it
    const wetB = clamp(ENV.wet / 1.2, 0, 1), snowB = clamp(ENV.snow / 3, 0, 1);
    const eRest = (ENV.frozen ? 0.68 : lerp(0.58, 0.47, wetB)) * (1 - 0.6 * snowB) * (1 - 0.5 * ENV.puddle), keep = lerp(0.86, 0.93, wetB) * (1 - 0.35 * snowB) * (1 - 0.3 * ENV.puddle);
    if (b.v.y < -0.8) { b.v.y = -b.v.y * eRest; b.v.x *= keep; b.v.z *= keep; b.w.multiplyScalar(0.6); if (events) events.bounce = true; }
    else {
      // rolling resistance: a damp skin of water makes it zip, standing water or snow holds it up
      const film = clamp(ENV.wet / 0.8, 0, 1); const roll = lerp(1, 0.72, film) * (1 + 2.6 * ENV.puddle) * (1 + 1.8 * clamp(ENV.snow / 3, 0, 1)) * (ENV.frozen ? 0.85 : 1);
      b.v.y = 0; const hs = Math.hypot(b.v.x, b.v.z); const dec = (0.42 + 0.03 * hs) * roll * dt;
      if (hs > dec) { b.v.x *= (hs - dec) / hs; b.v.z *= (hs - dec) / hs; } else { b.v.x = 0; b.v.z = 0; }
      b.w.multiplyScalar(Math.max(0, 1 - 2.5 * dt));
    }
  }
  b.w.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
  // posts and crossbar
  for (const [px, pz] of POSTS) {
    if (b.p.y < 2.5 + BR) { const dx = b.p.x - px, dz = b.p.z - pz, d = Math.hypot(dx, dz); if (d < BR + 0.06 && d > 0) { const nx = dx / d, nz = dz / d; const vn = b.v.x * nx + b.v.z * nz; if (vn < 0) { b.v.x -= 1.6 * vn * nx; b.v.z -= 1.6 * vn * nz; if (events) events.post = true; } b.p.x = px + nx * (BR + 0.061); b.p.z = pz + nz * (BR + 0.061); } }
  }
  for (const gx of [0, 105]) if (b.p.z > 30.28 && b.p.z < 37.72) { const dx = b.p.x - gx, dy = b.p.y - 2.5, d = Math.hypot(dx, dy); if (d < BR + 0.06 && d > 0) { const nx = dx / d, ny = dy / d; const vn = b.v.x * nx + b.v.y * ny; if (vn < 0) { b.v.x -= 1.6 * vn * nx; b.v.y -= 1.6 * vn * ny; if (events) events.bar = true; } b.p.x = gx + nx * (BR + 0.061); b.p.y = 2.5 + ny * (BR + 0.061); } }
  // net
  if (b.inNet) {
    const gx = b.inNet - 1; const back = gx === 105 ? 107 : -2;
    if ((gx === 105 && b.p.x > back - BR) || (gx === 0 && b.p.x < back + BR)) { b.p.x = back + (gx === 105 ? -BR : BR); b.v.x *= -0.15; b.v.z *= 0.4; b.v.y *= 0.4; }
    if (b.p.z < 30.4 + BR) { b.p.z = 30.4 + BR; b.v.z *= -0.2; } if (b.p.z > 37.6 - BR) { b.p.z = 37.6 - BR; b.v.z *= -0.2; }
    if (b.p.y > 2.3) { b.p.y = 2.3; b.v.y *= -0.2; }
    b.v.multiplyScalar(Math.max(0, 1 - 3 * dt));
  }
}
function simulate(p, v, w, T, step = 1 / 60) {
  const b = { p: p.clone(), v: v.clone(), w: w.clone(), inNet: false }; const out = [];
  for (let t = 0; t <= T; t += step) { out.push({ t, p: b.p.clone(), v: b.v.length() }); ballPhysics(b, step); }
  return out;
}
// launch solvers (bisection on the real physics)
function solveGround(from, to, arrive) {
  const dir = _t.set(to.x - from.x, 0, to.z - from.z); const d = dir.length(); dir.normalize(); const D = dir.clone();
  let lo = 2, hi = 34;
  for (let i = 0; i < 18; i++) {
    const v0 = (lo + hi) / 2; const tr = simulate(from, D.clone().multiplyScalar(v0), new THREE.Vector3(), 6, 1 / 40);
    let hit = tr.find((s) => Math.hypot(s.p.x - from.x, s.p.z - from.z) >= d);
    if (!hit || hit.v < arrive) lo = v0; else hi = v0;
  }
  return D.multiplyScalar((lo + hi) / 2);
}
function solveLofted(from, to, angDeg, spinSide) {
  const dx = to.x - from.x, dz = to.z - from.z; const d = Math.hypot(dx, dz); const a = angDeg * Math.PI / 180;
  const H = new THREE.Vector3(dx / d, 0, dz / d); let lo = 4, hi = 40;
  const w = new THREE.Vector3(0, spinSide || 0, 0);
  for (let i = 0; i < 18; i++) {
    const v0 = (lo + hi) / 2; const v = H.clone().multiplyScalar(v0 * Math.cos(a)); v.y = v0 * Math.sin(a);
    const tr = simulate(from, v, w, 7, 1 / 40); let land = tr.find((s, k) => k > 3 && s.p.y <= BR + 0.02); const reach = land ? Math.hypot(land.p.x - from.x, land.p.z - from.z) : 999;
    if (reach < d) lo = v0; else hi = v0;
  }
  const v0 = (lo + hi) / 2; const v = H.clone().multiplyScalar(v0 * Math.cos(a)); v.y = v0 * Math.sin(a); return { v, w };
}
function solveShot(from, tgt, speed, curl) {
  // aim yaw/pitch so the ball crosses the goal plane at tgt (x is goal line)
  let yaw = Math.atan2(tgt.z - from.z, tgt.x - from.x), pitch = 0.08;
  const w = new THREE.Vector3(0, curl, 0);
  for (let it = 0; it < 6; it++) {
    const v = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(speed);
    const tr = simulate(from, v, w, 2.5, 1 / 120); const dir = Math.sign(tgt.x - from.x);
    const s = tr.find((q) => (q.p.x - tgt.x) * dir >= 0); if (!s) { pitch += 0.05; continue; }
    const ez = tgt.z - s.p.z, ey = tgt.y - s.p.y; const dist = Math.hypot(tgt.x - from.x, tgt.z - from.z);
    yaw += Math.atan2(ez, dist) * dir; pitch += Math.atan2(ey, dist);
  }
  return { v: new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(speed), w };
}

/*@@WORLDVIS@@*/
// ============ PLAYERS ============
const players = []; const officials = [];
let NAT_WALK = 1.35, NAT_RUN = 3.4;
const tq = new THREE.Quaternion(), te = new THREE.Euler(), qa = new THREE.Quaternion();
const rot = (b, x, y, z) => { if (!b) return; tq.setFromEuler(te.set(x, y, z)); b.quaternion.multiply(tq); };
function amplify(b, rest, k) { if (!b) return; qa.copy(rest).invert().multiply(b.quaternion); if (qa.w < 0) { qa.x = -qa.x; qa.y = -qa.y; qa.z = -qa.z; qa.w = -qa.w; } const w = clamp(qa.w, -1, 1); const s = Math.sqrt(1 - w * w); if (s < 1e-4) return; const ang = 2 * Math.acos(w) * k; const ns = Math.sin(ang / 2) / s; qa.set(qa.x * ns, qa.y * ns, qa.z * ns, Math.cos(ang / 2)); b.quaternion.copy(rest).multiply(qa); }

const STATS = { xg: [0, 0], shots: [0, 0], poss: [0, 0], passes: [0, 0], done: [0, 0], goals: [], fouls: [0, 0], yellows: [0, 0], reds: [0, 0], offsides: [0, 0], onTarget: [0, 0] };
// teams change ends at half-time: S.flip mirrors which end each side attacks
const sideOf = (ti) => ti ^ (S.flip || 0);
const own2w = (ti, x, z) => sideOf(ti) === 0 ? V2(x, z) : V2(105 - x, 68 - z);
const w2own = (ti, v) => sideOf(ti) === 0 ? V2(v.x, v.y) : V2(105 - v.x, 68 - v.y);
const goalOf = (ti) => sideOf(ti) === 0 ? V2(105, 34) : V2(0, 34);   // goal this team attacks
const ownGoal = (ti) => sideOf(ti) === 0 ? V2(0, 34) : V2(105, 34);
const dirOf = (ti) => sideOf(ti) === 0 ? 1 : -1;

// ---- players: CC0 MakeHuman bodies, rebound so every bone's rest frame is the model frame ----
// Model frame: +Y up, +Z forward, +X the player's left. Rest pose is a relaxed A-pose.
// So rot(bone, x, y, z): x+ pitches forward-down (legs swing back, spine bends forward), y yaws, z+ rolls toward +X.
const V3 = THREE.Vector3;
const boneKey = (n) => n.replace(/^mixamorig:?/, '').replace(/_\d+$/, '');
function rebind(root) {
  root.updateMatrixWorld(true);
  const bones = []; root.traverse((o) => { if (o.isBone) bones.push(o); });
  const wp = bones.map((b) => b.getWorldPosition(new V3()));
  const pq = new THREE.Quaternion();
  bones.forEach((b, i) => {
    b.parent.updateMatrixWorld(true); b.parent.getWorldQuaternion(pq);
    b.quaternion.copy(pq).invert(); b.position.copy(b.parent.worldToLocal(wp[i].clone())); b.scale.set(1, 1, 1);
    b.updateMatrixWorld(true);
  });
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.calculateInverses(); });
}
const KIT_FRAG = `
  float reg = floor(vColor.r * 7.0 + 0.5);
  vec3 pc = uPal[0]; float rr = 0.52;
  if (reg > 0.5 && reg < 1.5) { pc = uPal[1]; rr = 0.74; }
  else if (reg < 2.5 && reg > 1.5) { pc = uPal[2]; rr = 0.7; }
  else if (reg < 3.5 && reg > 2.5) { pc = uPal[3]; rr = 0.78; }
  else if (reg < 4.5 && reg > 3.5) { pc = uPal[4]; rr = 0.32; }
  else if (reg < 5.5 && reg > 4.5) { pc = uPal[5]; rr = 0.85; }
  else if (reg < 6.5 && reg > 5.5) { pc = uPal[6]; rr = 0.15; }
  else if (reg > 6.5) { pc = uPal[0] * vec3(0.78, 0.55, 0.55); rr = 0.4; }
  diffuseColor.rgb = pc; kitRough = rr;
`;
function kitMaterial(pal) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.02, vertexColors: true });
  m.userData.pal = pal.map((h) => new THREE.Color(h));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPal = { value: m.userData.pal };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uPal[7];')
      .replace('#include <color_fragment>', 'float kitRough = 0.6;\n' + KIT_FRAG)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = kitRough;');
  };
  return m;
}
const BOOTS = [0x111111, 0xF4F4F4, 0xFF5A1F, 0x2BE38B, 0x1E6BFF, 0xFFD400, 0xE0207A];
const HAIR = [0x16110D, 0x1E1510, 0x2B1D12, 0x4A3220, 0x0E0E0E, 0x6B4A2B, 0xB8925A];
const VAR_SKIN = { A: [0x5C3A24, 0x704530, 0x8D5A3B], B: [0xF1C9A5, 0xE0B08A, 0xD9A47A], C: [0xE0B08A, 0xD9A47A, 0xC68E62], D: [0xC68E62, 0xA86B45, 0x8D5A3B] };
let BODY = {};
function makeAvatar(variant, kit, height, build, k) {
  const model = SkeletonUtils.clone(BODY[variant].root);
  const s = height / BODY[variant].h; model.scale.set(s * build, s, s * build);
  const skins = VAR_SKIN[variant]; const skin = k.skin ?? skins[k.seed % skins.length];
  const mat = kitMaterial([skin, kit.shirt, kit.shorts, kit.socks, k.boots ?? BOOTS[k.seed % BOOTS.length], k.hair ?? HAIR[(k.seed * 7) % HAIR.length], 0x1A120C]);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material = mat; } });
  const bones = {}; model.traverse((o) => { if (o.isBone) bones[boneKey(o.name)] = o; });
  const rest = {}; for (const b in bones) rest[b] = bones[b].quaternion.clone();
  return { model, bones, rest, mat, scale: s, variant, footRest: BODY[variant].footRest, gph: Math.random(), crouch: 0, sadW: 0 };
}
function kitOf(T, gk) { return gk ? { shirt: T.gkKit, shorts: 0x15171C, socks: T.gkKit } : { shirt: T.kit, shorts: T.kitShorts, socks: T.kitSocks }; }
function prepBodies(gltf) {
  for (const v of ['A', 'B', 'C', 'D']) {
    let rig = null; gltf[v].scene.traverse((o) => { if (o.name === 'Rig' + v) rig = o; });
    rig.position.set(0, 0, 0); rig.updateMatrixWorld(true);
    const holder = new THREE.Group(); holder.add(rig); rebind(holder);
    let mesh = null; holder.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    mesh.geometry.computeBoundingBox(); const h = mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y;
    const fr = {}; for (const n of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) { let b = null; holder.traverse((o) => { if (o.isBone && boneKey(o.name) === n) b = o; }); fr[n] = b.getWorldPosition(new V3()).y; }
    BODY[v] = { root: holder, h, footRest: fr };
  }
}
const ELITE = 7;
function buildPeople(gltf) {
  prepBodies(gltf);
  TEAMS.forEach((T, ti) => T.players.forEach(([num, name, pos, slot, rating0, height, foot], i) => {
    const rating = Math.min(93, rating0 + ELITE); // World Cup level: every squad member is an elite international
    const gk = pos === 'GK'; const build = 0.95 + rnd() * 0.1; const seed = i * 5 + ti * 3 + 1; const variant = 'ABCD'[(i * 3 + ti) % 4];
    const av = makeAvatar(variant, kitOf(T, gk), height, build, { seed });
    const p = Object.assign(av, {
      ti, i, T, num, name, pos, nat: pos, natSlot: V2(slot[0], slot[1]), slot: V2(slot[0], slot[1]), gk, foot: foot === 'L' ? -1 : 1,
      // attributes from rating, with personal spread
      vmax: clamp(7.2 + (rating - 76) * 0.17 + gauss() * 0.25 + (pos === 'ST' || pos.endsWith('W') || pos.endsWith('M') && pos !== 'DM' ? 0.35 : 0) - (pos === 'CB' ? 0.3 : 0) - (gk ? 1.4 : 0), 6.2, 9.4),
      acc: clamp(4.0 + (rating - 76) * 0.08 + gauss() * 0.3, 3.2, 5.6), agil: clamp(0.85 + (rating - 76) * 0.02 + gauss() * 0.06, 0.7, 1.2),
      passS: clamp((rating - 60) / 30 + (pos.includes('M') ? 0.08 : 0), 0.4, 1), shotS: clamp((rating - 62) / 28 + (pos === 'ST' || pos.endsWith('W') ? 0.12 : -0.1), 0.25, 1), ctrl: clamp((rating - 58) / 32, 0.4, 1),
      tackle: clamp((rating - 60) / 30 + (pos === 'CB' || pos === 'DM' ? 0.12 : -0.08), 0.3, 1), drib: clamp((rating - 66) / 26 + (pos.endsWith('W') || pos === 'AM' ? 0.15 : pos === 'ST' ? 0.08 : pos === 'CB' || gk ? -0.3 : 0), 0.15, 1), rating, staminaMax: clamp(0.8 + rnd() * 0.2, 0, 1), work: 0.75 + rnd() * 0.4, risk: rnd(),
      // personal motion style
      cadence: 0.93 + rnd() * 0.15, stride: 0.9 + rnd() * 0.2, armSwing: 0.75 + rnd() * 0.5, lean: rnd() * 0.12, armOut: 0.05 + rnd() * 0.16, headUp: (rnd() - 0.5) * 0.15, scanF: 0.25 + rnd() * 0.5,
      pos2: V2(0, 0), vel: V2(0, 0), yaw: ti === 0 ? Math.PI / 2 : -Math.PI / 2, bodyYaw: 0, stamina: 1, think: rnd() * 0.3, tgt: V2(0, 0), tSpeed: 0, mode: 'jog',
      act: null, actT: 0, touchCD: 0, beaten: 0, lookYaw: 0, scanT: rnd() * 3, call: 0, accF: 0, accL: 0, runT: 0, phase: rnd() * 10, celebrate: 0, sad: 0
    });
    p.pos2.copy(own2w(ti, slot[0] * 0.85, slot[1]));
    const el = document.createElement('div'); el.className = 'lbl'; el.innerHTML = '<span class="arw" hidden>▼</span><span><b>' + num + '</b>' + surname(name).toUpperCase() + '</span><span class="st"><i></i></span>';
    p.el = el; p.arw = el.firstChild; p.stEl = el.querySelector('.st i');
    p.label = new CSS2DObject(el); p.label.position.set(0, 2.2 / av.scale, 0); p.model.add(p.label);
    scene.add(p.model); players.push(p);
  }));
  // referee and assistants
  for (const [k, kit] of [['ref', 0x111111], ['ar1', 0xF2D21B], ['ar2', 0xF2D21B]]) {
    const av = makeAvatar(k === 'ref' ? 'B' : k === 'ar1' ? 'D' : 'A', { shirt: kit, shorts: 0x111111, socks: 0x111111 }, 1.80, 1.0, { seed: k.length * 3, boots: 0x111111 });
    const o = Object.assign(av, { role: k, pos2: k === 'ref' ? V2(48, 30) : V2(52.5, k === 'ar1' ? -0.8 : 68.8), vel: V2(0, 0), yaw: 0, vmax: 7, acc: 3.5, agil: 1, stamina: 1, staminaMax: 1, cadence: 1, stride: 0.95, armSwing: 0.8, lean: 0.05, armOut: 0.1, headUp: 0, act: null, accF: 0, accL: 0, phase: k.length, i: k === 'ref' ? 0 : k === 'ar1' ? 1 : 2 });
    // name tag over the referee and his assistants
    const el = document.createElement('div'); el.className = 'lbl off'; el.innerHTML = '<span>' + (k === 'ref' ? 'REFEREE' : 'ASSISTANT') + '</span>';
    o.el = el; o.label = new CSS2DObject(el); o.label.position.set(0, 2.2 / av.scale, 0); o.model.add(o.label);
    // assistants carry a red-and-yellow chequered flag in the right hand
    if (k !== 'ref' && o.bones.RightHand) o.bones.RightHand.add(makeFlag(av.scale));
    scene.add(o.model); officials.push(o);
  }
}

function makeFlag(sc) {
  const g = new THREE.Group(); const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d');
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { x.fillStyle = (i + j) % 2 ? '#F2D21B' : '#D7262E'; x.fillRect(i * 16, j * 16, 16, 16); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  stick.position.y = 0.2; g.add(stick);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
  cloth.position.set(0.17, 0.32, 0); g.add(cloth); g.scale.setScalar(1 / sc); g.position.y = 0.06 / sc; return g;
}
// match officials are fictional; a referee and both assistants come from the same national association, as at a World Cup
const REFS = [['Anders Holmqvist', 'SWE', 'Mikael Strand', 'Jonas Halvard'], ['Matteo Ricciardi', 'ITA', 'Paolo Ferrante', 'Luca Benedetti'], ['Daniel Okonkwo', 'NGA', 'Ifeanyi Bello', 'Samuel Oduya'],
  ['Kenji Morita', 'JPN', 'Takeshi Ando', 'Ryo Hasegawa'], ['Rafael Quintero', 'MEX', 'Héctor Salas', 'Iván Montoya'], ['Pierre-Luc Garnier', 'FRA', 'Julien Moreau', 'Antoine Lefèvre'],
  ['Tomás Echeverría', 'ARG', 'Martín Ledesma', 'Gonzalo Ibarra'], ['Youssef Benali', 'MAR', 'Karim Haddou', 'Anas Tazi'], ['Hamid Rezaei', 'IRN', 'Reza Karimi', 'Omid Farahani'],
  ['Callum Rees', 'WAL', 'Owain Pritchard', 'Dylan Hughes'], ['Bruno Teixeira', 'BRA', 'Caio Rangel', 'Diego Paixão'], ['Grant McAllister', 'SCO', 'Ewan Baird', 'Ross Kerr']];
const OFFICIALS = { ref: REFS[0][0], nat: REFS[0][1], ar1: REFS[0][2], ar2: REFS[0][3], fourth: REFS[1][0] + ' (' + REFS[1][1] + ')' };
function pickOfficials(sd) { const i = Math.abs(sd) % REFS.length; const R = REFS[i], F = REFS[(i + 5) % REFS.length]; Object.assign(OFFICIALS, { ref: R[0], nat: R[1], ar1: R[2], ar2: R[3], fourth: F[0] + ' (' + F[1] + ')' });
  for (const o of officials) o.el.firstChild.textContent = o.role === 'ref' ? 'REF · ' + surname(R[0]).toUpperCase() : 'AR · ' + surname(o.role === 'ar1' ? R[2] : R[3]).toUpperCase(); return OFFICIALS; }
// referee's whistle, synthesised: a pea whistle is a ~2.8 kHz tone with a fast warble from the pea (no audio files needed)
let AC = null, SOUND = true;
function whistle(kind) {
  if (!SOUND || !S.started || S.renderOff || document.hidden) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { return; }
  const blasts = kind === 'end' ? [[0, 0.35], [0.5, 0.35], [1.0, 1.1]] : kind === 'long' ? [[0, 0.9]] : kind === 'double' ? [[0, 0.18], [0.26, 0.4]] : [[0, 0.22]];
  const t0 = AC.currentTime + 0.02;
  for (const [st, d] of blasts) {
    const o = AC.createOscillator(), g = AC.createGain(), lfo = AC.createOscillator(), lg = AC.createGain();
    o.type = 'sine'; o.frequency.value = 2850; lfo.frequency.value = 38; lg.gain.value = 140; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0, t0 + st); g.gain.linearRampToValueAtTime(0.07, t0 + st + 0.02); g.gain.setValueAtTime(0.07, t0 + st + d - 0.04); g.gain.linearRampToValueAtTime(0, t0 + st + d);
    o.connect(g); g.connect(AC.destination); o.start(t0 + st); lfo.start(t0 + st); o.stop(t0 + st + d + 0.05); lfo.stop(t0 + st + d + 0.05);
  }
}
// an official's signal: the arm held along the direction of the decision (IFAB Law 5 / guidelines for assistant referees)
function signal(role, dir, up, opts) {
  const o = officials.find((x) => x.role === role); if (!o) return; const d = V2(dir.x, dir.y); if (d.length() < 1e-3) d.set(1, 0); d.normalize();
  o.act = Object.assign({ type: 'signal', t: 0, dur: 2.2, dir: d, up: up || 0 }, opts || {});
}
const arFor = (x, y) => (y < 34 ? (x > 52.5 ? 'ar1' : null) : (x <= 52.5 ? 'ar2' : null)); // each assistant runs one touchline, one half

// ============ MATCH STATE ============
const S = { t: 0, clock: 0, mclock: 0, mscale: 9, half: 1, stop: [2, 4], hold: null, over: false, ht: false, envAcc: 0, lastLogMin: -1, score: [0, 0], speed: 1, paused: false, started: false, cam: 'broadcast', names: 'all', owner: null, poss: 0,
  restart: { type: 'kickoff', team: 0, spot: V2(52.5, 34), taker: null, wait: 2.0 }, intended: null, traj: null, trajT: 0, passInfo: null, shotInfo: null, lastTouch: null, celebrate: 0, follow: null, focus: null };
const teamOf = (ti) => players.filter((p) => p.ti === ti && !p.off);
const fwd = (p) => V2(Math.sin(p.yaw), Math.cos(p.yaw));
const right = (p) => V2(-Math.cos(p.yaw), Math.sin(p.yaw));
const bp2 = () => V2(ball.p.x, ball.p.z);

function say(line) { $('cap2').textContent = $('cap1').textContent; $('cap1').textContent = line; $('capclk').textContent = minuteLabel(); }
function minuteLabel() { const m = S.mclock / 60; const end = S.half * 45; return m >= end ? end + '+' + Math.max(1, Math.ceil(m - end)) + "'" : Math.floor(m) + 1 + "'"; }
let toastT = 0;
function toast(html, secs) { const t = $('toast'); t.innerHTML = html; t.style.opacity = 1; toastT = secs; }

let R0 = null;
function setRestart(type, team, spot) {
  S.restart = { type, team, spot: spot.clone(), taker: null, wait: type === 'kickoff' ? 2.5 : 1.4 };
  if (S.started) dataEvent(type, { team: TEAMS[team].key, x: +spot.x.toFixed(1), y: +spot.y.toFixed(1) });
  S.owner = null; S.intended = null; ball.inNet = false; S.offSet = null; S.poss = team; S.possT = S.t; S.possHow = 'restart';
  S.dead = null; R0 = S.restart; R0.t0 = S.t;
  ball.p.set(spot.x, BR, spot.y); ball.v.set(0, 0, 0); ball.w.set(0, 0, 0);
  // choose taker
  const T = teamOf(team);
  if (type === 'goalkick') S.restart.taker = T.find((p) => p.gk);
  else if (type === 'kickoff') S.restart.taker = T.find((p) => p.pos === 'ST') || T.find((p) => !p.gk);
  else if (type === 'freekick' || type === 'penalty') S.restart.taker = setPieceTaker(type, team, spot);
  else S.restart.taker = T.filter((p) => !p.gk).sort((a, b) => a.pos2.distanceTo(spot) - b.pos2.distanceTo(spot))[0];
}
function trajectory() {
  if (!S.traj || S.t - S.trajT > 0.2) { S.traj = simulate(ball.p, ball.v, ball.w, 4, 1 / 30); S.trajT = S.t; }
  return S.traj;
}
function timeToReach(p, pt) {
  const d = p.pos2.distanceTo(pt); const v = p.vmax * (0.7 + 0.3 * p.stamina);
  const toward = d > 0.01 ? (p.vel.x * (pt.x - p.pos2.x) + p.vel.y * (pt.y - p.pos2.y)) / d : 0;
  const ang = Math.acos(clamp(fwd(p).dot(V2(pt.x - p.pos2.x, pt.y - p.pos2.y).normalize()), -1, 1));
  return 0.18 + d / v + Math.max(0, v - toward) / (2 * p.acc) + ang * 0.12;
}
function interceptFor(p, maxH) {
  const tr = trajectory();
  for (const s of tr) { if (s.p.y > maxH) continue; const pt = V2(s.p.x, s.p.z); if (pt.x < -1 || pt.x > 106 || pt.y < -1 || pt.y > 69) break; if (timeToReach(p, pt) <= s.t + 0.05) return { pt, t: s.t, h: s.p.y }; }
  const last = tr[tr.length - 1]; return { pt: V2(last.p.x, last.p.z), t: last.t + timeToReach(p, V2(last.p.x, last.p.z)), h: last.p.y };
}
function openness(p) { let m = 12; for (const q of players) if (q.ti !== p.ti) m = Math.min(m, q.pos2.distanceTo(p.pos2)); return m; }
// lane safety as a time margin: can any opponent get to a point on the ball's path before the ball does?
function laneSafety(a, b, ti) { const ab = b.clone().sub(a); const L = Math.max(ab.length(), 0.1); const L2 = L * L; let m = 12; for (const o of players) { if (o.ti === ti || o.off) continue; const u = clamp(o.pos2.clone().sub(a).dot(ab) / L2, 0, 1); const cp = a.clone().addScaledVector(ab, u); const dd = o.pos2.distanceTo(cp); const tBall = 0.3 + u * L / 14; const tOpp = 0.22 + Math.max(0, dd - (o.gk ? 1.4 : 0.8)) / 6.5; m = Math.min(m, (tOpp - tBall) * 8 + 2); } return m; }
function offsideLine(ti) { const xs = teamOf(1 - ti).map((o) => w2own(ti, o.pos2).x).sort((a, b) => b - a); return xs[1] ?? 60; }

/*@@TACTICS@@*/
// ---- owner decisions ----
// ---- xG: logistic on goal-mouth angle and distance, fitted offline on Wyscout open-play shots (CC BY 4.0) by scripts/fit_xg.py.
// Constants mirror data/calibration/xg.json; tests/xg_constants.test checks they agree. XG_SCALE is the tuned global scale (docs/simulator.md).
const XG = { b0: -1.464609, b1: 1.413822, b2: -0.089141, scale: 0.9 };
// tuned action weights (docs/simulator.md); a `tune` query parameter overrides them for calibration runs only, e.g. ?tune=passBias:0.5,shotThr:0.05
const TUNE = { passBias: 1.5, shotThr: 0.06, longShot: 0.05, holdScale: 1.5, boxFoul: 0.65, skillCD: 1.25 };
try { for (const kv of (new URLSearchParams(location.search).get('tune') || '').split(',')) { const [k, v] = kv.split(':'); if (k in TUNE && v !== undefined) TUNE[k] = +v; if (k === 'xgScale') XG.scale = +v; } } catch (e) { /* no query string */ }
const sig = (z) => 1 / (1 + Math.exp(-z));
function xgAt(pos, goal) {
  const dx = Math.abs(goal.x - pos.x), dy = pos.y - 34; const dist = Math.hypot(dx, dy);
  let ang = Math.atan2(7.32 * dx, dx * dx + dy * dy - 3.66 * 3.66); if (ang < 0) ang += Math.PI;
  return sig(XG.b0 + XG.b1 * ang + XG.b2 * dist);
}
// the shot's fate is drawn from the play stream, then the strike is aimed to match it: finisher and keeper ratings move the logit by at most +/-0.5
function shotFate(p, gk, xg, pen) {
  const lg = Math.log(xg / (1 - xg)) + 0.5 * clamp((p.shotS - 0.6) / 0.4, -1, 1) - 0.5 * clamp(((gk && gk.ctrl) || 0.8 - 0) - 0.8, -0.2, 0.2) / 0.2;
  const pg = pen ? 0.76 : clamp(sig(lg) * XG.scale, 0.005, 0.95), u = rnd();
  return u < pg ? 'goal' : u < pg + (pen ? 0.17 : 0.2) ? 'save' : 'miss';
}
// aim point (z across the goal, y height) for a fate; the keeper cannot reach a 'goal' (beat), always reaches a 'save'
function fateAim(fate, gk) {
  if (fate === 'goal') { const far = gk.pos2.y < 34 ? 1 : -1; return { tz: 34 + far * (2.2 + rnd() * 1.2), ty: rnd() < 0.55 ? 0.3 + rnd() * 0.5 : 1.3 + rnd() * 0.9 }; }
  if (fate === 'save') return { tz: clamp(gk.pos2.y + gauss() * 0.7, 31.2, 36.8), ty: 0.3 + rnd() * 1.1 };
  return rnd() < 0.55 ? { tz: 34 + (rnd() < 0.5 ? -1 : 1) * (4.3 + rnd() * 5), ty: 0.3 + rnd() * 1.5 } : { tz: 34 + (rnd() - 0.5) * 6, ty: 2.9 + rnd() * 3 };
}
function decide(p) {
  const me = p.pos2, goal = goalOf(p.ti), own = w2own(p.ti, me); const dGoal = me.distanceTo(goal);
  const tc = p.T.tac ? p.T.tac.cur : STYLES.balanced; const phase = p.T.tac ? phaseOf(p.ti) : 'progression'; const wide = Math.abs(me.y - 34) > 17 && own.x > 74;
  let press = 99; for (const o of teamOf(1 - p.ti)) press = Math.min(press, o.pos2.distanceTo(me));
  // shooting
  const angle = Math.abs(Math.atan2(me.y - 34, Math.abs(goal.x - me.x)));
  const xg = clamp(xgAt(me, goal) * (press < 2 ? 0.7 : 1), 0.005, 0.75);
  const od = p.orders && p.orders.k;
  if (!p.gk && od === 'shoot' && dGoal < 32 && press > 1.5 && rnd() < 0.3) return { type: 'shot', xg };
  if (!p.gk && dGoal < 30 && (xg > TUNE.shotThr + p.risk * 0.03 || (dGoal < 16 && rnd() < 0.6) || (dGoal < 27 && press > 2.5 && rnd() < TUNE.longShot * p.shotS))) return { type: 'shot', xg };
  // pass options
  let best = null, bs = -1e9;
  for (const q of teamOf(p.ti)) {
    if (q === p || q.act?.type === 'down') continue;
    const d = q.pos2.distanceTo(me); if (d < 5 || d > 50) continue;
    let lead = q.vel.clone().multiplyScalar(clamp(d / 15, 0.3, 1.6)); let tgt = q.pos2.clone().add(lead); let through = false;
    // a runner going in behind gets the ball played into the space ahead of him, not to his feet
    if (q.runT > 0 && q.vel.length() > 4 && own.x > 35) { const qo0 = w2own(p.ti, q.pos2); const ln = offsideLine(p.ti); if (qo0.x < ln + 1) { tgt = own2w(p.ti, Math.min(ln + 7, 99), clamp(qo0.y + (34 - qo0.y) * 0.15, 6, 62)); through = true; } }
    const gain = w2own(p.ti, tgt).x - own.x; const safe = laneSafety(me, tgt, p.ti); const open = openness(q);
    const qo = w2own(p.ti, tgt); const cross = wide && qo.x > 86 && Math.abs(tgt.y - 34) < 12;
    const lofted = cross || (safe < 1.6 && d > 16) || d > 32 || (ENV.puddle > 0.35 && d > 12);
    // team style: direct sides value forward gain and accept long balls; possession sides keep it short in build-up
    let sc = gain * (0.1 + p.risk * 0.08 + tc.direct * 0.1 + (phase === 'counter' ? 0.15 : 0)) + Math.min(safe, 6) * 0.55 - (safe < 1.6 ? 2.6 : safe < 2.4 ? 1 : 0) + Math.min(open, 8) * 0.25 - (q.gk ? 3 - tc.short * 1.5 : 0) - Math.max(0, d - 30) * 0.05 * (1.4 - tc.direct)
      - (lofted && !cross ? 0.8 - tc.direct * 0.6 + (open < 3 ? 2.2 : 0) : 0) + (cross ? 1.4 : 0) + gauss() * 0.5;
    if (qo.x > 84 && Math.abs(tgt.y - 34) < 18 && safe > 1.2) sc += 1.1; // a ball into the box is worth a little risk
    if (through) sc += safe > 1.2 ? 1.3 + p.passS * 0.8 : -1;
    if (od === 'simple') sc += Math.min(safe, 6) * 0.45 - Math.max(0, gain) * 0.05 - (lofted ? 1 : 0);
    if (phase === 'build-up') sc += d > 30 ? (gain > 15 ? 1.6 * (1 - tc.short) : 0) - 1.5 * tc.short : 0.4 * tc.short;
    if (w2own(p.ti, tgt).x > offsideLine(p.ti) + 0.5 && q.vel.length() < 4) sc -= 4; // would be offside
    if (sc > bs) { bs = sc; best = { q, tgt, lofted: lofted && !(through && safe > 2.2 && d < 30), d, cross, through, safe }; }
  }
  // dribble value
  const ahead = own2w(p.ti, Math.min(own.x + 8, 104), own.y).sub(me).normalize();
  let space = 15; for (const o of teamOf(1 - p.ti)) { const rel = o.pos2.clone().sub(me); if (rel.dot(ahead) > 0) space = Math.min(space, rel.length()); }
  const dribble = space * 0.28 + (p.pos.endsWith('W') || p.pos === 'ST' || p.pos === 'AM' ? 0.8 : 0) + (own.x > 70 ? 0.8 : 0) - (own.x < 25 ? 1.5 : 0) + (phase === 'counter' ? 0.8 : 0) - (phase === 'build-up' ? 0.7 * tc.short : 0) - (press < 2 ? 1.2 * (1 - p.ctrl * 0.5) : 0) - (od === 'simple' ? 1.5 : 0) + gauss() * 0.4;
  if (p.gk) return best && rnd() < 0.25 + 0.75 * tc.short && bs > 1.5 ? { type: 'pass', ...best, lofted: best.d > 25 || best.lofted } : { type: 'clear' };
  if (press < 2.5 && own.x < 22 && (!best || bs < 1)) return { type: 'clear' };
  if (best && (bs > dribble + TUNE.passBias || p.ownT > lerp(3.2, 1.4, tc.tempo) * TUNE.holdScale || (press < 1.8 && bs > 1.2))) return { type: 'pass', ...best, press };
  return { type: 'dribble', dir: ahead, space };
}
function startKick(p, plan) {
  // set the ball: the last touch takes the pace off it so the strike can follow
  if (ball.p.y < 0.6 && p.pos2.distanceTo(bp2()) < 1.4) { ball.v.x = lerp(ball.v.x, p.vel.x * 0.6, 0.85); ball.v.z = lerp(ball.v.z, p.vel.y * 0.6, 0.85); }
  p.act = kickAct(plan, rnd() < 0.82 ? p.foot : -p.foot);
}
// technique and timing of a strike. Biomechanics studies of the instep kick (Lees & Nolan 1998, Kellis & Katis 2007) put the
// backswing-to-contact phase at about 0.2-0.3 s with a proximal-to-distal whip (thigh drives, then the shank snaps through),
// the support foot planted beside the ball and a follow-through that rises with power. A side-foot pass turns the hip out and swings shorter.
function kickAct(plan, foot) {
  if (plan.type === 'shot' && plan.placed === undefined) plan.placed = plan.pen ? rnd() < 0.5 : rnd() < 0.45;
  const kind = plan.type === 'shot' ? (plan.placed && !plan.fk ? 'side' : 'instep') : plan.type === 'clear' ? 'loft' : plan.lofted || plan.cross ? 'loft' : (plan.d || 10) < 18 ? 'side' : 'instep';
  const d = plan.d || 20;
  const P = plan.type === 'shot' ? (plan.placed ? 0.8 : 1.1) : plan.type === 'clear' ? 1.1 : kind === 'side' ? clamp(0.35 + d / 40, 0.35, 0.85) : kind === 'loft' ? clamp(0.7 + d / 110, 0.7, 1.05) : clamp(0.6 + d / 80, 0.6, 1);
  const Tc = lerp(0.2, 0.32, clamp((P - 0.35) / 0.75, 0, 1)), Tf = lerp(0.3, 0.55, clamp((P - 0.35) / 0.75, 0, 1));
  return { type: plan.type === 'shot' ? 'shot' : 'kick', kind, P, t: 0, dur: Tc + Tf, strikeAt: Tc / (Tc + Tf), plan, struck: false, foot, curl: plan.fk || plan.cross ? 1 : 0 };
}
function strike(p) {
  const plan = p.act.plan; const from = ball.p.clone(); from.y = Math.max(from.y, BR);
  let press = 99; for (const o of teamOf(1 - p.ti)) press = Math.min(press, o.pos2.distanceTo(p.pos2));
  const weak = p.act.foot !== p.foot ? 1.5 : 1; const tired = 1 + (1 - p.stamina) * 0.8;
  const err = (plan.type === 'shot' ? 0.045 : 0.042) * (1.4 - (plan.type === 'shot' ? p.shotS : p.passS)) * weak * tired * (press < 2 ? 1.6 : 1);
  let v, w = new THREE.Vector3();
  if (plan.type === 'shot') {
    const gk = teamOf(1 - p.ti).find((q) => q.gk); const gx = goalOf(p.ti).x;
    let farSide = gk.pos2.y < 34 ? 1 : -1; let placed = plan.placed ?? rnd() < 0.45;
    const fate = shotFate(p, gk, plan.xg, !!plan.pen); const aim = fateAim(fate, gk); ball.beatUntil = fate === 'goal' ? S.t + 3 : 0; plan.fate = fate;
    let tz = aim.tz; let ty = aim.ty;
    let speed = placed ? 20 + rnd() * 4 : 25 + rnd() * 6; let curl = placed ? -farSide * dirOf(p.ti) * 9 : (rnd() - 0.5) * 4;
    if (plan.pen) { farSide = rnd() < 0.5 ? 1 : -1; if (fate === 'goal') { tz = 34 + farSide * (1.6 + rnd() * 1.8); ty = rnd() < 0.7 ? 0.25 + rnd() * 0.6 : 1.3 + rnd() * 0.9; } speed = 21 + rnd() * 7; curl = 0; placed = true; gk.act = { type: 'dive', t: 0, dur: 1.5, side: rnd() < 0.5 ? 1 : -1, high: false }; gk.vel.copy(right(gk).multiplyScalar(gk.act.side * 3.2)); }
    if (plan.fk) { if (fate === 'goal') { tz = 34 + farSide * (2.3 + rnd() * 1.2); ty = 1.85 + rnd() * 0.45; } speed = 23 + rnd() * 4; curl = -farSide * dirOf(p.ti) * 13; placed = true; }
    const sol = solveShot(from, new THREE.Vector3(gx, ty, tz), speed, curl);
    v = sol.v; w = sol.w; STATS.shots[p.ti]++; STATS.xg[p.ti] += plan.xg;
    S.shotInfo = { p, kmh: Math.round(speed * 3.6), xg: plan.xg, t: S.t, fate }; S.intended = null;
    dataEvent('shot', { team: p.T.key, player: p.name, kind: plan.pen ? 'penalty' : plan.fk ? 'free kick' : 'open play', phase: phaseOf(p.ti), xg: +plan.xg.toFixed(3), fate, kmh: Math.round(speed * 3.6), x: +p.pos2.x.toFixed(1), y: +p.pos2.y.toFixed(1), stamina: +p.stamina.toFixed(2), slick: +ENV.slick.toFixed(2) });
    say(p.name + (placed ? ' curls one towards the far corner' : ' lets fly') + ', ' + Math.round(speed * 3.6) + ' km/h.');
  } else if (plan.type === 'clear') {
    const tgt = own2w(p.ti, Math.min(w2own(p.ti, p.pos2).x + 45, 90), rnd() < 0.5 ? 6 : 62);
    const sol = solveLofted(from, new THREE.Vector3(tgt.x, 0, tgt.y), 38 + rnd() * 8, 0); v = sol.v; S.intended = null; say(surname(p.name) + ' clears it away.');
  } else {
    const q = plan.q; let tgt = plan.tgt;
    // re-aim at the receiver's run now
    const est = plan.lofted ? plan.d / 16 : plan.d / 13; tgt = q.pos2.clone().addScaledVector(q.vel, est * 0.85);
    tgt.x = clamp(tgt.x, 1, 104); tgt.y = clamp(tgt.y, 1, 67);
    if (plan.lofted) { const sol = solveLofted(from, new THREE.Vector3(tgt.x, 0, tgt.y), plan.d > 35 ? 32 : 24, (rnd() - 0.5) * 6); v = sol.v; w = sol.w; }
    else v = solveGround(from, new THREE.Vector3(tgt.x, 0, tgt.y), clamp(5 + plan.d * 0.13, 6, 10));
    S.intended = q; q.runT = 0;
    const pq = Math.round(clamp(45 + Math.min(laneSafety(p.pos2, tgt, p.ti), 6) * 5 + Math.max(0, w2own(p.ti, tgt).x - w2own(p.ti, p.pos2).x) * 0.7 + p.passS * 15 + gauss() * 4, 25, 99));
    const dz = Math.abs(tgt.y - p.pos2.y);
    S.passInfo = { from: p, to: q, kind: plan.oneTwo ? 'one-two' : plan.through ? 'through ball' : plan.cross ? 'cross' : plan.lofted ? (dz > 28 ? 'switch of play' : plan.d > 35 ? 'long ball' : 'lofted pass') : plan.first ? 'first-time pass' : (plan.d < 16 ? 'short pass' : 'driven pass'), pq, t: S.t };
    // give-and-go: on a short pass forward the passer bursts past his marker expecting it straight back
    const po = w2own(p.ti, p.pos2); if (!plan.lofted && !plan.oneTwo && plan.d < 17 && po.x > 40 && po.x < 88 && w2own(p.ti, tgt).x > po.x - 3 && rnd() < 0.3 * p.passS * (0.6 + (p.T.tac ? p.T.tac.cur.short : 0.5))) { q.oneTwo = { to: p, t: S.t }; p.runT = 1.8; p.call = 1.0; }
    STATS.passes[p.ti]++; { const kk = (STATS.kinds = STATS.kinds || {})[S.passInfo.kind] || (STATS.kinds[S.passInfo.kind] = [0, 0]); kk[0]++; }
    dataEvent('pass', { team: p.T.key, player: p.name, to: q.name, kind: S.passInfo.kind, phase: phaseOf(p.ti), formation: p.T.tac.form, quality: pq, difficulty: (S.passInfo.diff = passDifficulty(p, q, tgt, plan, press, weak)), distM: +plan.d.toFixed(1), stamina: +p.stamina.toFixed(2) });
  }
  // execution error: rotate direction, scale power
  const ang = gauss() * err; const c = Math.cos(ang), s = Math.sin(ang); const vx = v.x * c - v.z * s, vz = v.x * s + v.z * c; v.x = vx; v.z = vz; v.multiplyScalar(1 + gauss() * err * 0.8); v.y += gauss() * err * 2;
  ball.v.copy(v); ball.w.copy(w); ball.p.copy(from); S.owner = null; ball.last = p; S.lastTouch = p; p.touchCD = 0.35; S.traj = null;
  // the body carries on through the ball after a full strike instead of stopping dead
  p.vel.copy(fwd(p).multiplyScalar(1.2 + 2.2 * (p.act.P || 0.8))); p.tgt.copy(p.pos2.clone().addScaledVector(fwd(p), 1.5 + 2 * (p.act.P || 0.8)));
  markOffside(p);
}

// ---- touches, control, tackles, blocks ----
function tryControl(p, dist, h) {
  S.offSet = null;
  const rel = Math.hypot(ball.v.x - p.vel.x, ball.v.z - p.vel.y);
  const pOk = clamp(1.04 - Math.max(0, rel - 9) / 26, 0.35, 0.995) * (0.9 + 0.1 * p.ctrl) * (h > 1 ? 0.8 : h > 0.5 ? 0.9 : 1) * (1 - 0.13 * clamp(ENV.slick, 0, 1) - 0.12 * ENV.puddle - (ENV.vis < 200 ? 0.05 : 0));
  if (rnd() < pOk) {
    const f = fwd(p); const pushDir = p.vel.length() > 1 ? p.vel.clone().normalize() : f;
    ball.v.set(p.vel.x * 0.9 + pushDir.x * 0.7, 0, p.vel.y * 0.9 + pushDir.y * 0.7); ball.w.set(0, 0, 0); if (ball.p.y > BR) ball.v.y = -0.5;
    gainBall(p);
  } else {
    // heavy touch: ball squirts away
    const a = Math.atan2(ball.v.z, ball.v.x) + gauss() * 1.1; const sp = rel * (0.25 + rnd() * 0.25);
    ball.v.set(Math.cos(a) * sp, Math.abs(gauss()) * 1.2, Math.sin(a) * sp); S.owner = null; ball.last = p; S.lastTouch = p; S.traj = null;
  }
  p.touchCD = 0.25;
}
function gainBall(p) {
  if (S.owner !== p) {
    const was = S.lastTouch; if (S.poss !== p.ti) { S.possT = S.t; S.possHow = was && was.ti !== p.ti ? 'won' : 'loose'; } S.offSet = null; S.owner = p; p.ownT = 0; p.dribDir = null; p.nextThink = 0.25 + rnd() * 0.35;
    if (was && was.ti !== p.ti) dataEvent('turnover', { team: p.T.key, player: p.name, from: was.name, x: +p.pos2.x.toFixed(1), y: +p.pos2.y.toFixed(1), ownX: +w2own(p.ti, p.pos2).x.toFixed(1), phase: p.T.tac ? phaseOf(1 - p.ti) : null });
    if (S.intended && S.intended !== p && S.passInfo && S.passInfo.from.ti !== p.ti) say('Cut out by ' + p.name + '.');
    else if (S.passInfo && S.passInfo.from.ti === p.ti && S.passInfo.from !== p && S.t - S.passInfo.t < 6 && !S.passInfo.done) { S.passInfo.done = true; if (S.passInfo.kind !== 'throw-in' && S.passInfo.kind !== 'throw') { STATS.done[p.ti]++; const kk = (STATS.kinds = STATS.kinds || {})[S.passInfo.kind] || (STATS.kinds[S.passInfo.kind] = [0, 0]); kk[1]++; } if (rnd() < 0.3) say(surname(S.passInfo.from.name) + ' finds ' + surname(p.name) + ' with a ' + S.passInfo.kind + '.'); }
    else if (was && was.ti !== p.ti) say(p.name + ' wins it for ' + p.T.club + '.');
    S.poss = p.ti; S.intended = null; S.lastTouch = p; ball.last = p; S.traj = null;
  }
}
function header(p) {
  p.act = { type: 'header', t: 0, dur: 0.75, h: clamp((ball.p.y - 1.75) * 0.9, 0.15, 0.6) }; S.offSet = null;
  // aerial duel: the nearest opponent goes up with him
  const rival = teamOf(1 - p.ti).filter((o) => !o.gk && !o.act && o.pos2.distanceTo(p.pos2) < 1.8).sort((a, b) => a.pos2.distanceTo(p.pos2) - b.pos2.distanceTo(p.pos2))[0];
  if (rival) { rival.act = { type: 'header', t: 0.05, dur: 0.75, h: 0.35 }; dataEvent('aerial_duel', { won: p.name, team: p.T.key, lost: rival.name }); }
  const goal = goalOf(p.ti); const dGoal = p.pos2.distanceTo(goal); const v = new THREE.Vector3(); const own = w2own(p.ti, p.pos2);
  if (own.x < 30) { const tgt = own2w(p.ti, own.x + 28 + rnd() * 10, own.y < 34 ? 8 + rnd() * 10 : 50 + rnd() * 10); v.set(tgt.x - ball.p.x, 0, tgt.y - ball.p.z).normalize().multiplyScalar(12 + rnd() * 4); v.y = 6 + rnd() * 2; S.intended = null; say(surname(p.name) + ' heads it clear.'); }
  else if (dGoal < 16) { const hxg = clamp(xgAt(p.pos2, goal) * 0.8, 0.01, 0.6), gk = teamOf(1 - p.ti).find((q) => q.gk), fate = shotFate(p, gk, hxg, false), aim = fateAim(fate, gk); ball.beatUntil = fate === 'goal' ? S.t + 3 : 0; v.set(goal.x - ball.p.x, 0, aim.tz - ball.p.z).normalize().multiplyScalar(13 + rnd() * 5); v.y = (aim.ty - ball.p.y) * 2.2; STATS.shots[p.ti]++; STATS.xg[p.ti] += hxg; say('Header from ' + p.name + '!'); S.shotInfo = { p, kmh: Math.round(v.length() * 3.6), xg: hxg, t: S.t, fate }; }
  else { const mates = teamOf(p.ti).filter((q) => q !== p && !q.gk).sort((a, b) => a.pos2.distanceTo(p.pos2) - b.pos2.distanceTo(p.pos2)); const q = mates[0]; v.set(q.pos2.x - ball.p.x, 0, q.pos2.y - ball.p.z).normalize().multiplyScalar(8 + rnd() * 4); v.y = 2 + rnd() * 2; S.intended = q; }
  ball.v.copy(v); ball.w.set(0, 0, 0); S.owner = null; ball.last = p; S.lastTouch = p; p.touchCD = 0.4; S.traj = null;
}
function contacts(dt) {
  const bpos = bp2(); const h = ball.p.y;
  for (const p of players) {
    if (p.touchCD > 0) { p.touchCD -= dt; continue; }
    if (p.off || (p.act && p.act.type === 'fall')) continue;
    const foot = p.pos2.clone().addScaledVector(fwd(p), 0.3); const dFoot = foot.distanceTo(bpos); const dBody = p.pos2.distanceTo(bpos);
    // an offside player who becomes involved in play is penalised (IFAB Law 11)
    if (S.offSet && S.offSet.has(p) && S.owner !== p && h < 2.6 && (dFoot < 0.75 || dBody < 0.6)) { callOffside(p); return; }
    // goalkeeper hands
    if (p.gk && S.owner !== p) {
      const hand = handPoint(p); const dh = hand.distanceTo(ball.p);
      const inBox = Math.abs(p.pos2.x - ownGoal(p.ti).x) < 16.5 && Math.abs(p.pos2.y - 34) < 20.16;
      if (inBox && dh < (p.act?.type === 'dive' ? 0.55 : 0.7) && !(ball.beatUntil > S.t && S.shotInfo && S.shotInfo.p.ti !== p.ti)) { gkSave(p); continue; }
    }
    // owner dribble touches handled elsewhere
    if (S.owner === p) continue;
    // nobody reacts to a ball struck past them a split second ago, they can only block it with the body
    const blind = !S.owner && S.passInfo && S.t - S.passInfo.t < 0.3 && p.ti !== S.passInfo.from.ti;
    // slide tackle foot
    if (p.act?.type === 'slide' && !p.act.hit) { const sf = p.pos2.clone().addScaledVector(fwd(p), 1.1); if (S.owner && S.owner.ti !== p.ti && sf.distanceTo(bpos) > 0.75 && sf.distanceTo(S.owner.pos2) < 0.8) { p.act.hit = true; foul(p, S.owner, 'slide'); return; }
      if (sf.distanceTo(bpos) < 0.7 && h < 0.6) { p.act.hit = true; S.offSet = null; const a = p.yaw + gauss() * 0.6; ball.v.set(Math.sin(a) * (5 + rnd() * 4), 0.6, Math.cos(a) * (5 + rnd() * 4)); if (S.owner) { say(p.name + ' slides in and wins it cleanly.'); const o = S.owner; o.act = { type: 'stumble', t: 0, dur: 0.7 }; } S.owner = null; ball.last = p; S.lastTouch = p; S.traj = null; p.touchCD = 0.5; continue; } }
    if (S.owner && S.owner.ti !== p.ti) continue; // challenges on an owned ball are tackles
    // receiving / loose ball
    if (!blind && h < 0.85 && dFoot < 0.55 + 0.2 * p.ctrl) { tryControl(p, dFoot, h); continue; }
    // chest / thigh control on a dropping ball
    if (!blind && h >= 0.85 && h < 1.55 && dBody < 0.5 && ball.v.y < 0.5) { tryControl(p, dBody, h); continue; }
    if (!p.gk && h >= 1.3 && h < 2.6 && dBody < 0.55 && ball.v.y < 2) { header(p); continue; }
    // body block: deflect anything that hits the player
    if (h < 1.8 && dBody < 0.32 && ball.last !== p) { const n = bpos.clone().sub(p.pos2).normalize(); const vn = ball.v.x * n.x + ball.v.z * n.y; if (vn < 0) { S.offSet = null; ball.v.x -= 1.4 * vn * n.x; ball.v.z -= 1.4 * vn * n.y; ball.v.multiplyScalar(0.55); ball.last = p; S.lastTouch = p; S.traj = null; if (S.shotInfo && S.t - S.shotInfo.t < 1.5) say('Blocked by ' + p.name + '!'); } }
  }
}
function handPoint(p) {
  const r = right(p); const f = fwd(p); let lat = 0, up = 1.1, fo = 0.35;
  if (p.act?.type === 'dive') { const u = clamp(p.act.t / 0.45, 0, 1); lat = p.act.side * (0.4 + 1.2 * ease(u)); up = lerp(1.2, p.act.high ? 2.1 : 0.45, ease(u)); fo = 0.3; }
  return new THREE.Vector3(p.pos2.x + r.x * lat + f.x * fo, up, p.pos2.y + r.y * lat + f.y * fo);
}
function gkSave(p) {
  const sp = ball.v.length(); const centered = p.act?.type !== 'dive' || Math.abs(p.act.side) < 0.5; S.offSet = null;
  const grip = 1 - 0.28 * clamp(ENV.slick, 0, 1); // a wet ball squirts out of the gloves
  if (sp < 17 * grip || (centered && sp < 24 * grip && rnd() < 0.7 * grip)) {
    ball.v.set(0, 0, 0); ball.w.set(0, 0, 0); gainBall(p); p.holding = true; p.holdT = 1.6 + rnd() * 1.6;
    if (S.shotInfo && S.t - S.shotInfo.t < 2) { toast('SAVED<small>' + p.name + '</small>', 1.6); say('Held by ' + p.name + '.'); }
  } else {
    const n = new THREE.Vector3(dirOf(p.ti) * (0.6 + rnd() * 0.5), 0.4 + rnd() * 0.5, (rnd() - 0.5) * 1.6).normalize();
    ball.v.copy(n.multiplyScalar(sp * (0.3 + rnd() * 0.15))); ball.w.set(0, 0, 0); S.owner = null; ball.last = p; S.lastTouch = p; S.traj = null;
    toast('SAVED<small>' + p.name + '</small>', 1.6); say('What a save from ' + p.name + ', tipped away!');
  }
  p.touchCD = 0.4;
}

// ---- tackles on the ball owner ----
function challenges(dt) {
  const o = S.owner; if (!o || o.holding || (o.act?.onStrike && !o.act.struck)) return;
  for (const d of teamOf(1 - o.ti)) {
    if (d.gk || d.act || d.beaten > 0) continue;
    const dist = d.pos2.distanceTo(bp2()); const dOwner = d.pos2.distanceTo(o.pos2);
    // slide tackle from the side or behind at speed
    if (dist > 1.6 && dist < 3.0 && d.vel.length() > 5 && rnd() < dt * 0.6 * d.tackle * (0.6 + 0.8 * d.T.tac.cur.press) * (1 + 1.2 * clamp(ENV.slick, 0, 1))) { d.act = { type: 'slide', t: 0, dur: 1.5, hit: false, side: right(d).dot(o.pos2.clone().sub(d.pos2)) > 0 ? -1 : 1 }; dataEvent('slide_tackle', { team: d.T.key, player: d.name }); d.vel.setLength(Math.max(d.vel.length(), 6.5)); continue; }
    if (dist < 1.15 && dOwner < 1.5) {
      const loose = o.pos2.distanceTo(bp2()) > 0.55 ? 1.8 : 1; // easier between touches
      if (rnd() < dt * 0.6 * d.tackle * loose * (1.15 - 0.4 * o.ctrl) * (0.8 + 0.4 * d.T.tac.cur.press)) {
        // foul risk: poor tacklers, tired legs, a wet surface, lunging from behind, a quick dribbler
        const behind = fwd(o).dot(d.pos2.clone().sub(o.pos2).normalize()) < -0.35;
        const inOwnBox = Math.abs(d.pos2.x - ownGoal(d.ti).x) < 16.5 && Math.abs(d.pos2.y - 34) < 20.16; // defenders are more careful in their own box
        const pf = 0.6 * (inOwnBox ? TUNE.boxFoul : 1) * clamp(0.05 + 0.2 * (1 - d.tackle) + 0.1 * clamp(ENV.slick, 0, 1) + 0.14 * (1 - d.stamina) + (behind ? 0.22 : 0) + d.T.tac.cur.foul + (o.vel.length() > 6 ? 0.08 : 0), 0.03, 0.65);
        const tStyle = fwd(d).dot(o.pos2.clone().sub(d.pos2).normalize()) > 0.6 ? 'block' : 'poke'; const tFoot = right(d).dot(bp2().sub(d.pos2)) > 0 ? 1 : -1;
        if (rnd() < pf) { d.act = { type: 'poke', t: 0, dur: 0.55, style: tStyle, foot: tFoot }; foul(d, o, behind ? 'from behind' : rnd() < 0.2 ? 'pull' : 'trip'); return; }
        d.act = { type: 'poke', t: 0, dur: 0.55, style: tStyle, foot: tFoot };
        const a = Math.atan2(ball.p.z - d.pos2.y, ball.p.x - d.pos2.x) + gauss() * 0.7; const sp = 3 + rnd() * 4;
        ball.v.set(Math.cos(a) * sp, 0.3, Math.sin(a) * sp); S.owner = null; ball.last = d; S.lastTouch = d; S.traj = null; d.touchCD = 0.2; o.touchCD = 0.35;
        if (rnd() < 0.4) say(d.name + ' nicks it off ' + surname(o.name) + '.');
        return;
      } else if (rnd() < dt * 0.6) { d.beaten = 0.8; } // sold the dummy
    }
  }
}

// ============ OFF-BALL BRAIN ============
// kick-off position (Law 8): in your own half, and the defending side outside the centre circle
function kickoffSpot(p, team) {
  const sx = Math.min(p.slot.x * 0.85, 49.5); let t = own2w(p.ti, p.gk ? 4 : sx, p.slot.y);
  const c = V2(52.5, 34); const d = t.distanceTo(c);
  if (p.ti !== team && d < 10.2) { const dir = t.clone().sub(c); if (dir.length() < 0.1) dir.set(-dirOf(p.ti), 0); dir.normalize(); if (dir.x * dirOf(p.ti) > -0.2) dir.set(-dirOf(p.ti) * 0.6, Math.sign(dir.y || 1) * 0.8).normalize(); t = c.clone().addScaledVector(dir, 10.4); }
  return t;
}
function think(p) {
  if (S.dead) return setTarget(p, V2(clamp(p.pos2.x, 1, 104), clamp(p.pos2.y, 1, 67)), 0.35, bp2()); // ball out: play has stopped
  const ti = p.ti; const att = S.poss === ti; const b = bp2(); const bo = w2own(ti, b);
  const slot = p.slot; let t, urgency = 0.6, face = null;
  // restart positioning
  const R = S.restart;
  if (R) {
    if (R.taker === p && R.type === 'throw') { if (R.phase === 'fetch') return setTarget(p, R.ballAt, 0.8, R.ballAt); if (R.phase === 'carry') return setTarget(p, R.spot, 0.6, b); return setTarget(p, R.spot, 0.3, b); }
    if (R.taker === p) { const behind = R.type === 'goalkick' || R.type === 'kickoff' ? -0.6 : -0.9; const toward = own2w(ti, 60, 34).sub(R.spot).normalize(); t = R.spot.clone().addScaledVector(toward, behind); urgency = 0.5; return setTarget(p, t, urgency, b); }
    if (R.type === 'kickoff') { t = kickoffSpot(p, R.team); return setTarget(p, t, p.pos2.distanceTo(t) > 15 ? 0.65 : 0.45, b); }
  }
  if (p.gk) {
    const og = ownGoal(ti); const toBall = b.clone().sub(og); const d = toBall.length(); toBall.normalize();
    t = og.clone().addScaledVector(toBall, clamp(d * 0.11, 1.0, 5.5)); t.y = clamp(t.y, 30.2, 37.8);
    // rush out for a loose ball in the box
    const ibx = Math.abs(b.x - og.x) < 16 && Math.abs(b.y - 34) < 18;
    if (!S.owner && ibx && ball.p.y < 1.8) { const mine = interceptFor(p, 2.4); const opp = Math.min(...teamOf(1 - ti).map((o) => interceptFor(o, 0.9).t)); if (mine.t < opp + 0.2) { t = mine.pt; urgency = 1; } }
    return setTarget(p, t, urgency, b);
  }
  // chasing a loose/flighted ball: best on each team goes
  if (!S.owner && !S.restart) {
    const chasers = teamOf(ti).filter((q) => !q.gk).map((q) => ({ q, ic: interceptFor(q, q === S.intended ? 2.6 : 2.2) })).sort((a, c) => (a.ic.t - (a.q === S.intended ? 0.6 : 0)) - (c.ic.t - (c.q === S.intended ? 0.6 : 0)));
    if (chasers[0].q === p || (chasers[1] && chasers[1].q === p && chasers[1].ic.t < 1.2)) return setTarget(p, chasers[0].q === p ? chasers[0].ic.pt : chasers[1].ic.pt, 1, b);
  }
  // team shape
  // line height, compactness and width come from the team's style; a low block sits deep and narrow, a high line squeezes up
  const tc = p.T.tac ? p.T.tac.cur : STYLES.balanced; const phase = p.T.tac ? phaseOf(ti) : 'mid block'; const r = p.pos;
  const prog = bo.x; const back = att ? clamp(prog - 36 + (tc.line - 0.5) * 10, 10 + tc.line * 8, 50) : clamp(prog - 24 + (tc.line - 0.5) * 14, 6 + tc.line * 14, 30 + tc.line * 14);
  const span = att ? 42 : 30 - (1 - tc.line) * 5;
  const depth = clamp((slot.x - 14) / 40, 0, 1); let x = back + depth * span;
  const width = att ? 1.05 * tc.width : 0.72 * (tc.line < 0.3 ? 0.92 : 1); let z = 34 + (slot.y - 34) * width + (bo.y - 34) * (att ? 0.2 : 0.38);
  // personal wander so nobody moves in lockstep
  x += Math.sin(S.t * 0.13 * p.cadence + p.phase) * 2.2; z += Math.cos(S.t * 0.11 + p.phase * 1.7) * 2.4;
  if (att) {
    // full-backs overlap on their side, forwards stay onside and make runs in behind
    if (['LB', 'RB', 'LWB', 'RWB'].includes(r) && Math.sign(slot.y - 34) === Math.sign(bo.y - 34) && bo.x > 50) x += 12;
    const nCB = teamOf(ti).filter((q) => q.pos === 'CB').length;
    if (phase === 'build-up' && tc.short > 0.5) {
      if (r === 'CB' && nCB === 2) { z = 34 + Math.sign(slot.y - 34) * 18; x = Math.max(4, back - 6); } // centre-backs split either side of the box
      if (r === 'DM' && nCB === 2 && teamOf(ti).filter((q) => q.pos === 'DM').length === 1) { x = Math.max(6, back - 3); z = 34; } // the six drops between them
      if (['LB', 'RB', 'LWB', 'RWB'].includes(r)) x += 8; // full-backs push on to give the width
    }
    if (phase === 'final third') {
      if (['LW', 'RW', 'LM', 'RM', 'LWB', 'RWB'].includes(r)) z = lerp(z, slot.y < 34 ? 5 : 63, 0.6); // hold the touchline
      if (r === 'ST' || r === 'AM') x += 4; // attack the box
    }
    // the manager's personal instruction to this player (see talk.js)
    const od = p.orders && p.orders.k;
    if (od) { if (od === 'push') x += 7; else if (od === 'deep') x -= 9; else if (od === 'wide') z = 34 + Math.sign((z - 34) || (slot.y - 34) || 1) * Math.max(Math.abs(z - 34) * 1.3, 25); else if (od === 'inside') z = 34 + (z - 34) * 0.5; }
    const line = offsideLine(ti);
    if (p.runT > 0) { x = line + 7; z = clamp(z + (34 - z) * 0.2, 4, 64); urgency = 1; p.runT -= 0.25; }
    else if ((r === 'ST' || r.endsWith('W') || r === 'AM' || od === 'runs' || (phase === 'counter' && r.endsWith('M'))) && S.owner && S.owner.ti === ti && S.owner !== p && rnd() < (phase === 'counter' ? 0.3 : 0.08) * (od === 'runs' ? 3 : 1) * p.work * (0.5 + tc.runs) && bo.x > 25) { p.runT = 2.5; p.call = 1.2; }
    // the front line pins the opposition's back four: strikers and wingers play on the last defender, the ten between the lines
    if (r === 'ST' || r === 'LW' || r === 'RW') x = Math.max(x, line - 2.5 - (1 - tc.direct) * 3); else if (r === 'AM') x = Math.max(x, line - 9);
    x = Math.min(x, Math.max(line - 0.6, bo.x));
    if (S.owner && S.owner.ti === ti && openness(p) > 5 && rnd() < 0.05) p.call = 1.0;
  } else {
    // press and cover
    const ds = teamOf(ti).filter((q) => !q.gk).sort((a, c) => a.pos2.distanceTo(b) - c.pos2.distanceTo(b));
    // pressing: how far up the pitch a team engages and how many go depends on its press setting; after losing the ball a
    // counter-pressing side swarms with three
    const zone = bo.x < lerp(30, 105, tc.press); const nPress = phase === 'counter-press' ? 3 : zone ? (tc.press > 0.7 ? 2 : 1) : 0;
    const od = p.orders && p.orders.k;
    if (od === 'press' && S.owner && p.pos2.distanceTo(b) < 28) return setTarget(p, b.clone().addScaledVector(S.owner.vel, 0.35), 1, b);
    if (od === 'mark' && p.orders.target && !p.orders.target.off) { const tg = p.orders.target; const og = ownGoal(ti); const m = tg.pos2.clone().add(og.clone().sub(tg.pos2).normalize().multiplyScalar(1.4)); return setTarget(p, m, 0.92, b, true); }
    if (ds[0] === p) {
      const og = ownGoal(ti); const gs = og.clone().sub(b).normalize(); const d = p.pos2.distanceTo(b);
      if (d > 4) { if (nPress >= 1 || d < 9) return setTarget(p, b.clone().addScaledVector(S.owner ? S.owner.vel : V2(ball.v.x, ball.v.z), 0.35), 1, b); return setTarget(p, b.clone().addScaledVector(gs, 6), 0.6, b, true); }
      return setTarget(p, b.clone().addScaledVector(gs, 1.2), 0.42, b, true);
    }
    if (ds[1] === p && nPress >= 2 && S.owner) { const o = S.owner; const recv = teamOf(1 - ti).filter((q) => q !== o && !q.gk).sort((a, c) => a.pos2.distanceTo(o.pos2) - c.pos2.distanceTo(o.pos2))[0]; if (recv) return setTarget(p, b.clone().lerp(recv.pos2, 0.5), 0.95, b, true); }
    if (ds[2] === p && nPress >= 3) return setTarget(p, b.clone().addScaledVector(ownGoal(ti).clone().sub(b).normalize(), 2.5), 0.95, b, true);
    if (ds[1] === p) { const og = ownGoal(ti); const t2 = b.clone().lerp(og, 0.2); return setTarget(p, t2, 0.75, b, true); }
    // goal-side marking of the nearest attacker in my zone
    const zoneW = own2w(ti, x, z); let mk = null, md = 9; for (const o of teamOf(1 - ti)) { const d = o.pos2.distanceTo(zoneW); if (d < md && !o.gk) { md = d; mk = o; } }
    if (mk && w2own(ti, mk.pos2).x < 50) { const og = ownGoal(ti); const m = mk.pos2.clone().add(og.clone().sub(mk.pos2).normalize().multiplyScalar(1.6)); const mo = w2own(ti, m); x = lerp(x, mo.x, 0.65); z = lerp(z, mo.y, 0.65); }
    if (od === 'push') x += 6; else if (od === 'deep') x -= 7; else if (od === 'wide') z = 34 + (z - 34) * 1.25; else if (od === 'inside') z = 34 + (z - 34) * 0.6;
    // recovery sprint if caught upfield of the ball
    if (x < w2own(ti, p.pos2).x - 8) urgency = 0.95;
  }
  t = own2w(ti, clamp(x, 2, 103), clamp(z, 2, 66));
  return setTarget(p, t, urgency, b);
}
function setTarget(p, t, urgency, look, watch) {
  if (p.orders && p.orders.k === 'rest') urgency = Math.min(urgency, 0.72); // told to save his legs: no lung-busting sprints
  p.tgt.copy(t); p.urg = urgency; p.lookAt = look; p.watch = !!watch || (p.pos2.distanceTo(look) < 18 && urgency < 0.9);
}

// ============ LOCOMOTION PHYSICS ============
function moveBody(p, dt) {
  const tired = (0.72 + 0.28 * p.stamina) * (1 - 0.04 * (p.altF || 0) * ENV.altF);
  const grip = 1 - 0.22 * clamp(ENV.slick, 0, 1.2) - 0.15 * ENV.puddle; // studs lose purchase on wet or snowy turf
  let to = p.tgt.clone().sub(p.pos2); const dist = to.length();
  // speed intent by urgency and distance
  let want = 0;
  // arrival hysteresis: once settled on the spot a player stays planted until the target drifts a metre away (no shuffling)
  if ((p.urg ?? 0) < 0.85 && (p.parked ? dist < 0.9 : dist < 0.3)) p.parked = true; else p.parked = false;
  if (!p.parked && dist > 0.25) {
    const cruise = p.urg >= 0.95 ? p.vmax * tired : p.urg > 0.7 ? Math.min(6.2, p.vmax * tired) : p.urg > 0.5 ? 4.2 : 2.4 + p.work;
    want = Math.min(cruise, Math.sqrt(2 * 3.5 * dist) * 0.9 + (p.urg >= 0.95 ? 1 : 0));
  }
  if (p.beaten > 0) { want *= 0.4; p.beaten -= dt; }
  // backpedal / side-step limits when watching the ball
  const moveDir = dist > 0.001 ? to.multiplyScalar(1 / dist) : V2(0, 0);
  const lookDir = p.lookAt ? p.lookAt.clone().sub(p.pos2).normalize() : fwd(p);
  const rel = Math.acos(clamp(moveDir.dot(lookDir), -1, 1));
  // short repositioning is done by shuffling sideways or backwards while facing play; thresholds have hysteresis so the
  // stance never flickers between frames
  let stance = 'fwd'; const ps0 = p.stance || 'fwd';
  if ((p.watch || dist < 3.5) && want < 5.5 && dist > 0.3) {
    if (rel > (ps0 === 'back' ? 1.9 : 2.3)) { stance = 'back'; want = Math.min(want, 3.4); }
    else if (rel > (ps0 === 'fwd' ? 1.05 : 0.8)) { stance = 'side'; want = Math.min(want, 4.6); }
  }
  // velocity steering with turn-rate and accel limits (momentum)
  const sp = p.vel.length(); const desired = moveDir.clone().multiplyScalar(want);
  if (sp > 0.5 && want > 0.5) {
    const cur = Math.atan2(p.vel.y, p.vel.x), tgtA = Math.atan2(desired.y, desired.x); const dA = wrapA(tgtA - cur);
    const omega = p.agil * 10 / (1 + 0.55 * sp) * Math.sqrt(grip);
    const turn = clamp(dA, -omega * dt, omega * dt);
    const nsp = Math.abs(dA) > 1.2 ? Math.max(0, sp - 9 * grip * dt) : sp; // hard cuts need braking
    // planting a foot to cut at speed on a slick surface: sometimes the standing leg goes
    if (Math.abs(dA) > 1.0 && sp > 5 && !p.act && p.ti !== undefined && rnd() < dt * 1.6 * Math.max(0, ENV.slick - 0.15)) { p.act = { type: 'stumble', t: 0, dur: 0.9 }; dataEvent('slip', { player: p.name, team: p.T.key, speed: +sp.toFixed(1) }); if (rnd() < 0.5) say(surname(p.name) + ' loses his footing on the ' + (ENV.snow > 1 ? 'snow' : 'wet surface') + '.'); }
    const a = cur + turn; p.vel.set(Math.cos(a) * nsp, Math.sin(a) * nsp);
  }
  const vs = p.vel.length(); const along = vs > 0.01 ? p.vel.clone().normalize() : moveDir.clone();
  const target = Math.abs(wrapA(Math.atan2(desired.y, desired.x) - Math.atan2(along.y, along.x))) < 1.2 ? want : 0;
  const accMax = ((p.acc * tired) * Math.sqrt(Math.max(0.08, 1 - vs / (p.vmax * 1.02))) + 0.6) * grip; const decMax = 7.5 * grip;
  let nv = vs < target ? Math.min(target, vs + accMax * dt) : Math.max(target, vs - decMax * dt);
  if (vs < 0.05 && want > 0) { p.vel.copy(moveDir).multiplyScalar(Math.min(want, accMax * dt)); }
  else p.vel.copy(along).multiplyScalar(nv);
  const old = p.velPrev || p.vel.clone(); const acc = p.vel.clone().sub(old).multiplyScalar(1 / Math.max(dt, 1e-3)); p.velPrev = p.vel.clone();
  const f = fwd(p), r = right(p); p.accF = lerp(p.accF || 0, clamp(acc.dot(f), -8, 8), clamp(dt * 3, 0, 1)); p.accL = lerp(p.accL || 0, clamp(acc.dot(r), -8, 8), clamp(dt * 3, 0, 1));
  p.pos2.addScaledVector(p.vel, dt);
  // stamina: sprinting drains, jogging and walking recover
  const s2 = p.vel.length();
  // long-term fatigue: every metre covered lowers the ceiling a little (high work rate tires faster)
  // heat (WBGT) and altitude raise the cost of every metre; long-term fatigue runs on match time
  const strain = 1 + 0.9 * ENV.heat + 0.45 * ENV.altF + (ENV.temp < 2 ? 0.08 : 0) + 0.1 * clamp(ENV.puddle + ENV.snow / 4, 0, 1);
  p.cap = Math.max(0.4, (p.cap ?? 1) - s2 * dt * (S.mscale || 1) * 0.000016 * strain * (0.7 + 0.5 * (p.work ?? 0.9)) / p.staminaMax);
  // short-term: sprints burn hard, jogging burns slowly, walking recovers toward the ceiling
  if (s2 > 5.5) p.stamina -= dt * (0.004 + 0.045 * ((s2 - 5.5) / 3) ** 2) * strain / p.staminaMax;
  else if (s2 > 2.2) p.stamina -= dt * 0.0012 * strain / p.staminaMax;
  else p.stamina += dt * 0.012 * p.staminaMax / (1 + 0.6 * ENV.heat + 0.5 * ENV.altF);
  p.stamina = clamp(Math.min(p.stamina, p.cap), 0.12, 1);
  // facing
  // facing follows a smoothed travel direction and turns through a critically damped spring: no snapping, no spinning on the spot
  if (!p.vSm) p.vSm = p.vel.clone(); p.vSm.lerp(p.vel, clamp(dt * 7, 0, 1)); const sv = p.vSm.length();
  p.goingF = p.goingF ? sv > 0.7 : sv > 1.2;
  let wantYaw = p.yaw;
  if (p.goingF) { const my = Math.atan2(p.vSm.x, p.vSm.y); const ly = Math.atan2(lookDir.x, lookDir.y); wantYaw = stance === 'back' ? ly : stance === 'side' ? my + clamp(wrapA(ly - my), -1.1, 1.1) * 0.75 : my; }
  else if (p.lookAt) { const ly = Math.atan2(lookDir.x, lookDir.y); if (Math.abs(wrapA(ly - p.yaw)) > (p.turnIn ? 0.12 : 0.55)) { wantYaw = ly; p.turnIn = true; } else p.turnIn = false; } // small angles are taken by the head and torso
  if (p.faceYaw !== undefined) wantYaw = p.faceYaw;
  const wy = (s2 > 6 ? 7 : 11) * (p.agil || 1); const err = wrapA(wantYaw - p.yaw);
  p.yawV = (p.yawV || 0) + (wy * wy * err - 2 * wy * (p.yawV || 0)) * dt; const lim = (s2 > 6 ? 3.4 : 6.2) * (p.agil || 1);
  p.yawV = clamp(p.yawV, -lim, lim); p.yaw = wrapA(p.yaw + p.yawV * dt);
  p.stance = stance;
}

// ============ ANIMATION LAYER ============
const gv = new THREE.Vector3();
// gait-lab style joint curves: [stride phase from foot strike, degrees]. hip + = flexion, knee + = flexion, ankle + = dorsiflexion
const GAIT = {
  walk: { hip: [[0, 25], [0.15, 18], [0.5, -12], [0.6, -14], [0.75, 5], [0.88, 28], [1, 25]], knee: [[0, 3], [0.15, 18], [0.4, 5], [0.58, 35], [0.72, 60], [0.85, 30], [0.97, 2], [1, 3]], ank: [[0, 0], [0.08, -6], [0.45, 10], [0.6, -14], [0.7, 0], [1, 0]] },
  run: { hip: [[0, 30], [0.15, 14], [0.38, -14], [0.45, -16], [0.6, 10], [0.85, 50], [1, 30]], knee: [[0, 20], [0.12, 40], [0.38, 18], [0.5, 75], [0.66, 108], [0.82, 70], [0.95, 22], [1, 20]], ank: [[0, 3], [0.15, 18], [0.38, -22], [0.5, -10], [0.8, 2], [1, 3]] },
  sprint: { hip: [[0, 40], [0.12, 22], [0.28, -10], [0.35, -12], [0.55, 30], [0.8, 72], [1, 40]], knee: [[0, 25], [0.1, 45], [0.28, 20], [0.42, 95], [0.56, 128], [0.75, 85], [0.93, 28], [1, 25]], ank: [[0, 5], [0.12, 16], [0.28, -25], [0.4, -12], [0.7, 0], [1, 5]] },
};
function keyed(k, x) { for (let i = 1; i < k.length; i++) if (x <= k[i][0]) { const u = (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); const e = u * u * (3 - 2 * u); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * e; } return k[k.length - 1][1]; }
// ---- strike animation: keyframed joint curves (degrees) over the kick's phase, 0 = start of the last stride, 1 = ball contact,
// 2 = recovered. Monotone cubic interpolation keeps joint velocity continuous, so the whip and follow-through read in slow motion.
const KICK = (() => {
  const instep = {
    hip: [[0, 0], [0.4, -12], [0.68, -30], [0.86, -4], [1, 20], [1.3, 62], [1.6, 70], [2, 4]],
    knee: [[0, 15], [0.4, 45], [0.68, 110], [0.86, 98], [1, 22], [1.3, 8], [1.6, 24], [2, 12]],
    ank: [[0, 5], [0.5, 20], [0.7, 45], [1.2, 45], [1.6, 18], [2, 5]],
    hrot: [[0, 0], [0.7, 8], [1.2, 8], [2, 0]], habd: [[0, 0], [0.68, 10], [1, 4], [1.4, 8], [2, 0]],
    sHip: [[0, 5], [0.6, 14], [0.82, 30], [1, 32], [1.4, 26], [2, 8]], sKnee: [[0, 15], [0.6, 22], [0.82, 38], [1, 36], [1.4, 30], [2, 14]],
    pelYaw: [[0, 0], [0.68, -26], [1, 4], [1.4, 26], [2, 0]], pelRoll: [[0, 0], [0.82, 6], [1, 10], [1.4, 6], [2, 0]],
    trunk: [[0, 8], [0.68, 2], [1, 16], [1.4, 22], [2, 8]], trunkSide: [[0, 0], [0.7, 8], [1, 16], [1.4, 12], [2, 0]],
    armO: [[0, 10], [0.68, 80], [1, 70], [1.4, 45], [2, 10]], armOF: [[0, 0], [0.68, -12], [1, 32], [1.4, 42], [2, 0]],
    armK: [[0, 0], [0.68, -34], [1, 22], [1.4, 30], [2, 0]], armKA: [[0, 8], [0.68, 32], [1, 22], [2, 8]],
  };
  const side = {
    hip: [[0, 0], [0.45, -6], [0.72, -16], [1, 22], [1.3, 36], [1.6, 24], [2, 3]],
    knee: [[0, 15], [0.45, 28], [0.72, 48], [1, 14], [1.3, 12], [1.6, 20], [2, 12]],
    ank: [[0, 5], [0.6, -8], [1.2, -8], [2, 5]],
    hrot: [[0, 0], [0.5, 25], [0.75, 55], [1.2, 55], [1.6, 25], [2, 0]], habd: [[0, 0], [0.75, 12], [1.2, 14], [2, 0]],
    sHip: [[0, 5], [0.8, 20], [1, 22], [1.4, 18], [2, 6]], sKnee: [[0, 15], [0.8, 30], [1, 32], [1.4, 28], [2, 15]],
    pelYaw: [[0, 0], [0.72, -14], [1, 4], [1.4, 12], [2, 0]], pelRoll: [[0, 0], [1, 4], [2, 0]],
    trunk: [[0, 8], [1, 14], [1.4, 14], [2, 8]], trunkSide: [[0, 0], [1, 8], [2, 0]],
    armO: [[0, 10], [0.72, 45], [1, 40], [2, 10]], armOF: [[0, 0], [1, 18], [2, 0]],
    armK: [[0, 0], [0.72, -15], [1, 10], [2, 0]], armKA: [[0, 8], [1, 15], [2, 8]],
  };
  const loft = Object.assign({}, instep, {
    hip: [[0, 0], [0.4, -12], [0.68, -32], [0.86, -4], [1, 22], [1.3, 72], [1.6, 82], [2, 4]],
    ank: [[0, 5], [0.5, 15], [0.7, 30], [1.2, 30], [1.6, 15], [2, 5]],
    hrot: [[0, 0], [0.7, 22], [1.2, 26], [2, 0]],
    trunk: [[0, 5], [0.68, -2], [1, -14], [1.4, -12], [2, 5]], sKnee: [[0, 15], [0.6, 22], [0.82, 34], [1, 30], [1.4, 26], [2, 14]],
  });
  // monotone cubic Hermite through the keys
  const prep = (k) => { const n = k.length, m = new Array(n).fill(0); for (let i = 1; i < n - 1; i++) { const d0 = (k[i][1] - k[i - 1][1]) / (k[i][0] - k[i - 1][0]), d1 = (k[i + 1][1] - k[i][1]) / (k[i + 1][0] - k[i][0]); m[i] = d0 * d1 <= 0 ? 0 : 2 / (1 / d0 + 1 / d1); } return { k, m }; };
  const T = {}; for (const [nm, tab] of [['instep', instep], ['side', side], ['loft', loft]]) { T[nm] = {}; for (const c in tab) T[nm][c] = prep(tab[c]); }
  return T;
})();
function kcurve({ k, m }, x) {
  if (x <= k[0][0]) return k[0][1]; const n = k.length; if (x >= k[n - 1][0]) return k[n - 1][1];
  let i = 1; while (x > k[i][0]) i++; const x0 = k[i - 1][0], h = k[i][0] - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * k[i - 1][1] + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * k[i][1] + (t3 - t2) * h * m[i];
}
const KOFF = { instep: [0.33, 0.05], side: [0.16, 0.17], loft: [0.36, 0.02] };
const KBONES = ['Hips', 'Spine', 'Spine1', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm'];
const _kq = KBONES.map(() => new THREE.Quaternion());
function kickPhase(a, u) { return u < a.strikeAt ? u / a.strikeAt : 1 + (u - a.strikeAt) / (1 - a.strikeAt); }
function kickPose(p, a, u, B) {
  const ph = kickPhase(a, u); const K = KICK[a.kind || (a.plan?.lofted ? 'loft' : 'instep')]; const P = a.P || 0.9; const D = Math.PI / 180;
  const c = (n) => kcurve(K[n], ph) * D;
  // scale the swing with power: bigger backswing and follow-through for a hard strike, compact for a soft pass
  const amp = (n, base) => { const v = c(n); return n === 'hip' ? (ph < 1 ? v * lerp(0.75, 1.1, P) : v * lerp(0.55, 1.15, P)) : v * (base ?? 1); };
  const kL = a.foot > 0 ? 'Right' : 'Left', sL = a.foot > 0 ? 'Left' : 'Right', s = a.foot > 0 ? 1 : -1;
  // blend the gait out over the approach and back in after the follow-through
  const w = ph < 0.3 ? ease(ph / 0.3) : ph > 1.65 ? 1 - ease(clamp((ph - 1.65) / 0.35, 0, 1)) : 1;
  KBONES.forEach((n, i) => { if (B[n]) { _kq[i].copy(B[n].quaternion); B[n].quaternion.copy(p.rest[n]); } });
  rot(B.Hips, 0, s * c('pelYaw') * lerp(0.7, 1.1, P), s * c('pelRoll'));
  rot(B.Spine, c('trunk'), -s * c('pelYaw') * 0.45, s * c('trunkSide')); rot(B.Spine1, 0, -s * c('pelYaw') * 0.35, 0);
  rot(B[kL + 'UpLeg'], -amp('hip'), -s * c('hrot'), -s * c('habd'));
  rot(B[kL + 'Leg'], c('knee') * (ph < 1 ? lerp(0.8, 1.05, P) : 1), 0, 0);
  rot(B[kL + 'Foot'], c('ank'), 0, 0);
  rot(B[sL + 'UpLeg'], -c('sHip'), 0, s * 0.06);
  rot(B[sL + 'Leg'], c('sKnee'), 0, 0); rot(B[sL + 'Foot'], -c('sKnee') * 0.45, 0, 0);
  // balance: the arm opposite the kicking leg flies out and sweeps across, the near arm swings back then forward
  rot(B[sL + 'Arm'], -c('armOF'), 0, s * c('armO') * lerp(0.7, 1.1, P)); rot(B[sL + 'ForeArm'], -0.5, 0, 0);
  rot(B[kL + 'Arm'], -c('armK') * lerp(0.6, 1.1, P), 0, -s * c('armKA')); rot(B[kL + 'ForeArm'], -0.6, 0, 0);
  if (w < 1) KBONES.forEach((n, i) => { if (B[n]) { const kq = B[n].quaternion.clone(); B[n].quaternion.copy(_kq[i]).slerp(kq, w); } });
}
function animate(p, dt) {
  const v = p.vel.length(); const f = fwd(p); const vf = p.vel.dot(f); const vl = -p.vel.dot(right(p)); // forward and leftward body-frame speed
  const B = p.bones;
  for (const n in B) B[n].quaternion.copy(p.rest[n]);
  // ---- procedural gait: cadence, stride and joint curves all scale with speed ----
  const spd = Math.hypot(vf, vl); const back = vf < -0.4 && Math.abs(vf) > Math.abs(vl);
  const moving = clamp((spd - 0.15) / 0.5, 0, 1);
  const steps = clamp(1.45 + 0.35 * spd, 1.5, 4.5) * p.cadence; // steps per second
  p.gph = (p.gph + dt * steps * 0.5 * (back ? -1 : 1) * moving + 1) % 1;
  const run = clamp((spd - 2.0) / 1.2, 0, 1), sprint = clamp((spd - 5.5) / 2.5, 0, 1);
  const tau = Math.PI * 2; const bump = (x, c, w) => { let d = Math.abs(x - c); d = Math.min(d, 1 - d); return Math.exp(-(d * d) / (2 * w * w)); };
  const fx = spd > 0.05 ? Math.abs(vf) / spd : 1, lx = spd > 0.05 ? vl / spd : 0; // share of forward vs sideways stepping
  const hipC = lerp(0.04, lerp(0.22, 0.5, sprint), run) * moving, hipA = lerp(0.36, lerp(0.5, 0.78, sprint), run) * moving * p.stride;
  const kSt = lerp(0.22, 0.55, run), kSw = lerp(1.0, lerp(1.55, 2.15, sprint), run), kSwC = lerp(0.72, 0.64, run);
  // athletic ready stance when watching play nearby, deeper for keepers
  const ready = clamp((p.gk ? (S.owner && S.owner.ti !== p.ti && bp2().distanceTo(ownGoal(p.ti)) < 30 ? 1 : 0.35) : (p.watch && p.urg < 0.6 ? 0.55 : 0.12)) * (1 - moving * 0.8), 0, 1);
  p.crouch = lerp(p.crouch, ready, clamp(dt * 4, 0, 1)); const cr = p.crouch;
  let liftL = 0;
  // joint curves (degrees) over one stride from this leg's foot strike, after published gait-lab averages
  const wW = clamp(1 - (spd - 1.8) / 2.7, 0, 1), wS = clamp((spd - 4.5) / 3, 0, 1), wR = 1 - wW - wS;
  const curve = (key, ph) => (wW > 0 ? wW * keyed(GAIT.walk[key], ph) : 0) + (wR > 0 ? wR * keyed(GAIT.run[key], ph) : 0) + (wS > 0 ? wS * keyed(GAIT.sprint[key], ph) : 0);
  for (const [side, off, sg] of [['Left', 0, 1], ['Right', 0.5, -1]]) {
    const ps = (p.gph + off) % 1; const c = Math.cos(tau * ps); const D = Math.PI / 180;
    const hipD = curve('hip', ps) * D * p.stride, kneeD = curve('knee', ps) * D, ankD = curve('ank', ps) * D;
    const flex = hipD * moving * fx; const knee = kneeD * moving * lerp(1, 0.7, 1 - fx) + 0.05 + cr * 0.55;
    const abd = moving * (1 - fx) * 0.3 * c * lx * sg; // side-stepping: swing legs out and in
    rot(B[side + 'UpLeg'], -(flex + cr * 0.42), 0, sg * (0.03 + abd + 0.02 * run));
    rot(B[side + 'Leg'], knee, 0, 0);
    rot(B[side + 'Foot'], -ankD * moving - cr * 0.12, 0, 0);
    if (B[side + 'ToeBase']) rot(B[side + 'ToeBase'], -Math.max(0, -ankD) * 0.6 * moving, 0, 0);
    // arms counter-swing the opposite leg; elbows bend more as speed rises
    const armA = lerp(0.2, lerp(0.6, 1.05, wS), run) * moving * p.armSwing * fx; const ca = Math.cos(tau * (ps - 0.5));
    rot(B[side + 'Arm'], -(armA * ca) + lerp(0.02, 0.18, run) * moving, 0, sg * (cr * 0.35 + 0.05 * run));
    rot(B[side + 'ForeArm'], -(lerp(0.32, lerp(1.5, 1.65, wS), run) * (moving * 0.75 + 0.25) + 0.3 * cr + armA * 0.3 * Math.max(0, ca)), 0, 0);
    rot(B[side + 'Hand'], 0, 0, sg * 0.1);
    // relaxed fingers, curled tighter when running
    for (const fn of ['Index', 'Middle', 'Ring', 'Pinky']) for (let j = 1; j <= 3; j++) rot(B[side + 'Hand' + fn + j], 0, 0, -sg * lerp(0.3, 0.85, run));
    if (side === 'Left') liftL = c;
  }
  // pelvis yaw/roll with the stride, shoulders counter-rotate, bounce handled by the ground solver
  const yawP = 0.12 * moving * liftL * lerp(1, 0.7, run) * fx; const rollP = 0.05 * moving * Math.sin(tau * p.gph * 2) * (1 - run * 0.5);
  rot(B.Hips, cr * 0.15, yawP, rollP);
  rot(B.Spine, (lerp(0.04, 0.12, run) + 0.1 * wS) * moving + cr * 0.25, -yawP * 0.6, -rollP * 0.6); rot(B.Spine1, 0, -yawP * 0.5, 0); rot(B.Spine2, 0, -yawP * 0.4, 0);
  rot(B.Neck, -(lerp(0.04, 0.14, run) * moving + cr * 0.25) * 0.5, yawP * 0.5, 0);
  // idle breathing and weight shifts so nobody stands like a statue
  const idle = 1 - moving; const br = Math.sin(S.t * 1.6 + p.phase);
  rot(B.Spine2, 0.015 * br * idle, 0, 0); rot(B.Hips, 0, 0, 0.035 * Math.sin(S.t * 0.35 + p.phase) * idle);
  // dejected after conceding: head down, shoulders slumped; keeper shakes his head
  p.sadW = lerp(p.sadW, p.sad > 0 ? 1 : 0, clamp(dt * 3, 0, 1));
  if (p.sadW > 0.01) { rot(B.Spine1, 0.2 * p.sadW, 0, 0); rot(B.Head, 0.5 * p.sadW, 0, 0); rot(B.LeftShoulder, 0, 0, -0.1 * p.sadW); rot(B.RightShoulder, 0, 0, 0.1 * p.sadW); }
  if (p.shake > 0) rot(B.Head, 0, Math.sin(S.t * 9) * 0.35 * Math.min(1, p.shake), 0);
  // posture: lean into acceleration and speed, roll into turns, personal carriage
  rot(B.Spine, clamp(p.lean + p.accF * 0.035 + v * 0.022 + (p.stamina < 0.35 && v < 1 ? 0.35 : 0), -0.25, 0.6), 0, 0);
  rot(B.Hips, 0, 0, clamp(-p.accL * 0.028, -0.32, 0.32));
  rot(B.RightArm, 0, 0, -p.armOut); rot(B.LeftArm, 0, 0, p.armOut);
  // torso and head track the ball
  if (p.lookAt) {
    const la = Math.atan2(p.lookAt.x - p.pos2.x, p.lookAt.y - p.pos2.y); let d = wrapA(la - p.yaw);
    p.scanT -= dt; if (p.scanT < 0) { p.scanT = 2 + rnd() * 4; p.scan = 0.6; }
    if (p.scan > 0) { p.scan -= dt; d += Math.sin((0.6 - p.scan) / 0.6 * Math.PI) * 1.2 * (p.i % 2 ? 1 : -1) * p.scanF; }
    const tw = clamp(d, -1.0, 1.0); rot(B.Spine1, 0, tw * 0.35, 0); rot(B.Spine2, 0, tw * 0.25, 0); rot(B.Neck, 0, clamp(d - tw * 0.6, -0.8, 0.8) * 0.5, 0); rot(B.Head, p.headUp + (ball.p.y > 3 ? -0.25 : 0.08), clamp(d - tw * 0.6, -0.8, 0.8) * 0.5, 0);
  }
  // calling for the ball
  if (p.call > 0) { p.call -= dt; const u = Math.sin(clamp(p.call, 0, 1) * Math.PI); rot(B.RightArm, 0, 0.3 * u, -2.3 * u); }
  // tired: hands on hips when standing still
  if (p.stamina < 0.4 && v < 0.5 && !p.gk) { rot(B.RightArm, 0, -0.3, -0.55); rot(B.LeftArm, 0, 0.3, 0.55); rot(B.RightForeArm, 0, 1.4, 0); rot(B.LeftForeArm, 0, -1.4, 0); }
  if (p.gk && p.holding) { rot(B.RightArm, 0, 1.2, -0.3); rot(B.LeftArm, 0, -1.2, 0.3); rot(B.RightForeArm, 0, 0.6, 0); rot(B.LeftForeArm, 0, -0.6, 0); }
  // actions
  p.model.position.set(p.pos2.x - 52.5, 0, p.pos2.y - 34); p.model.rotation.set(0, p.yaw, 0);
  const a = p.act;
  if (a) {
    const u = clamp(a.t / a.dur, 0, 1);
    if (a.type === 'kick' || a.type === 'shot') {
      kickPose(p, a, u, B);
    } else if (a.type === 'header') {
      // two-footed jump: load the knees, take off, arch the back in the air, snap the forehead through at the peak, land soft
      resetB(p, B, LOWER); resetB(p, B, ARMS);
      const load = u < 0.18 ? ease(u / 0.18) : u < 0.3 ? 1 - ease((u - 0.18) / 0.12) : u > 0.82 ? ease((u - 0.82) / 0.1) * (1 - ease(clamp((u - 0.92) / 0.08, 0, 1))) : 0;
      const air = u > 0.25 && u < 0.85 ? Math.sin((u - 0.25) / 0.6 * Math.PI) : 0;
      p.model.position.y = (a.h ?? 0.5) * air;
      const arch = u < 0.5 ? ease(clamp((u - 0.2) / 0.3, 0, 1)) : 1 - ease(clamp((u - 0.5) / 0.12, 0, 1)); const snap = u < 0.5 ? 0 : ease(clamp((u - 0.5) / 0.12, 0, 1)) * (1 - ease(clamp((u - 0.7) / 0.3, 0, 1)));
      rot(B.Spine, -0.3 * arch + 0.4 * snap + 0.25 * load, 0, 0); rot(B.Spine1, -0.12 * arch + 0.16 * snap, 0, 0); rot(B.Neck, -0.2 * arch + 0.25 * snap, 0, 0);
      for (const [sd, sg] of [['Left', 1], ['Right', -1]]) { rot(B[sd + 'UpLeg'], -0.55 * load - 0.3 * air, 0, sg * 0.04); rot(B[sd + 'Leg'], 1.0 * load + 0.6 * air + 0.05, 0, 0); rot(B[sd + 'Foot'], 0.4 * air - 0.25 * load, 0, 0); rot(B[sd + 'Arm'], -0.8 * (air + 0.3 * load), 0, sg * (0.25 + 0.6 * air)); rot(B[sd + 'ForeArm'], -0.4 - 0.8 * air, 0, 0); }
    } else if (a.type === 'dive') {
      // keeper dive: push off the near-side leg, body stretched long, both hands leading to the ball, top leg tucked, then recover
      resetB(p, B, LOWER); resetB(p, B, ARMS);
      const sd = a.side || 1; const lie = ease(clamp(u / 0.3, 0, 1)) * (1 - ease(clamp((u - 0.72) / 0.28, 0, 1)));
      const crouch0 = u < 0.12 ? Math.sin(u / 0.12 * Math.PI / 2) * (1 - lie) : 0;
      p.model.rotateZ(-sd * 1.38 * lie); p.model.position.y = Math.max(0.04, Math.sin(clamp(u / 0.42, 0, 1) * Math.PI) * (a.high ? 0.95 : 0.42)) * (u < 0.72 ? 1 : 1 - ease((u - 0.72) / 0.28));
      const r = right(p); p.model.position.x += r.x * sd * 0.55 * lie; p.model.position.z += r.y * sd * 0.55 * lie;
      // arms: the dive-side arm goes over the head, the other reaches across so both palms meet the ball
      const reach = lie; const near = sd > 0 ? 'Right' : 'Left', far = sd > 0 ? 'Left' : 'Right'; const ns = sd > 0 ? -1 : 1;
      rot(B[near + 'Arm'], -0.35 * reach, 0, ns * 2.75 * reach); rot(B[near + 'ForeArm'], -0.15 * reach, 0, 0);
      rot(B[far + 'Arm'], -0.6 * reach, 0, -ns * 2.5 * reach); rot(B[far + 'ForeArm'], -0.35 * reach, 0, 0);
      rot(B.Spine, -0.08 * reach + 0.2 * crouch0, 0, ns * 0.18 * reach); rot(B.Neck, 0, 0, ns * 0.2 * reach);
      // legs: push-off leg extended, top leg bent at hip and knee
      rot(B[near + 'UpLeg'], -0.2 * reach - 0.5 * crouch0, 0, 0); rot(B[near + 'Leg'], 0.25 * reach + 0.8 * crouch0, 0, 0);
      rot(B[far + 'UpLeg'], -0.7 * reach - 0.5 * crouch0, 0, 0); rot(B[far + 'Leg'], 0.95 * reach + 0.8 * crouch0, 0, 0);
      for (const sdd of ['Left', 'Right']) rot(B[sdd + 'Foot'], 0.45 * reach, 0, 0);
    } else if (a.type === 'slide') {
      // slide tackle: drop onto the hip, lead leg straight through the ball, trailing leg folded under, arm back on the turf, spring up
      resetB(p, B, LOWER); resetB(p, B, ARMS);
      const sd = a.side || 1; const lie = ease(clamp(u / 0.2, 0, 1)) * (1 - ease(clamp((u - 0.68) / 0.32, 0, 1)));
      p.model.rotateZ(sd * 0.28 * lie); p.model.rotateX(-1.15 * lie); p.model.position.y = -0.1 * lie;
      const top = sd > 0 ? 'Right' : 'Left', low = sd > 0 ? 'Left' : 'Right'; const ls = sd > 0 ? 1 : -1;
      rot(B[top + 'UpLeg'], -0.35 * lie, 0, 0); rot(B[top + 'Leg'], 0.08 * lie, 0, 0); rot(B[top + 'Foot'], -0.25 * lie, 0, 0);
      rot(B[low + 'UpLeg'], 0.15 * lie, 0, ls * 0.25 * lie); rot(B[low + 'Leg'], 1.7 * lie, 0, 0); rot(B[low + 'Foot'], 0.4 * lie, 0, 0);
      rot(B.Spine, 0.55 * lie, 0, -ls * 0.15 * lie); rot(B.Spine1, 0.2 * lie, 0, 0); rot(B.Neck, 0.25 * lie, 0, 0);
      rot(B[low + 'Arm'], 0.7 * lie, 0, ls * 0.75 * lie); rot(B[low + 'ForeArm'], -0.2 * lie, 0, 0);
      rot(B[top + 'Arm'], -0.5 * lie, 0, -ls * 0.9 * lie); rot(B[top + 'ForeArm'], -0.6 * lie, 0, 0);
    } else if (a.type === 'skill') {
      // skill moves: shoulder-drop feint, step-over, chop, Marseille roulette, drag-back, elastico
      const sd = a.side, k = Math.sin(u * Math.PI); const L = sd > 0 ? 'Right' : 'Left'; const lsg = sd > 0 ? 1 : -1;
      if (a.move === 'feint') { const z = Math.sin(u * Math.PI * 2) * 0.32; rot(B.Spine, 0.12 * k, -sd * 0.25 * Math.sin(u * Math.PI * 2), -sd * z); rot(B.Hips, 0, 0, -sd * z * 0.4); }
      else if (a.move === 'stepover') { const ph = u * Math.PI * 2; rot(B[L + 'UpLeg'], -0.7 * k, 0, lsg * 0.45 * Math.sin(ph)); rot(B[L + 'Leg'], 0.9 * k, 0, 0); rot(B.Spine, 0.15 * k, 0, sd * 0.22 * Math.sin(ph)); }
      else if (a.move === 'roulette') { const sp = ease(u); p.model.rotateY(-sd * Math.PI * 2 * sp); resetB(p, B, LOWER); rot(B[L + 'UpLeg'], -0.45 * k, 0, 0); rot(B[L + 'Leg'], 0.55 * k, 0, 0); rot(B[L + 'Foot'], -0.35 * k, 0, 0); const o = L === 'Right' ? 'Left' : 'Right'; rot(B[o + 'Leg'], 0.35 * k, 0, 0); rot(B[o + 'UpLeg'], -0.2 * k, 0, 0); rot(B.Spine, 0.18 * k, 0, 0); }
      else if (a.move === 'dragback') { const s1 = ease(clamp(u / 0.35, 0, 1)) * (1 - ease(clamp((u - 0.55) / 0.3, 0, 1))); const pull = clamp((u - 0.3) / 0.35, 0, 1); resetB(p, B, LOWER); rot(B[L + 'UpLeg'], -0.75 * s1 + 0.35 * Math.sin(pull * Math.PI) * s1, 0, 0); rot(B[L + 'Leg'], 0.2 * s1, 0, 0); rot(B[L + 'Foot'], -0.55 * s1, 0, 0); const o = L === 'Right' ? 'Left' : 'Right'; rot(B[o + 'Leg'], 0.35 * s1, 0, 0); rot(B[o + 'UpLeg'], -0.25 * s1, 0, 0); rot(B.Spine, -0.1 * s1, 0, 0); }
      else if (a.move === 'elastico') { const fl = Math.sin(u * Math.PI * 2); resetB(p, B, LOWER); rot(B[L + 'UpLeg'], -0.5 * k, lsg * 0.6 * fl, 0); rot(B[L + 'Leg'], 0.4 * k, 0, 0); rot(B[L + 'Foot'], 0, lsg * 0.5 * fl, 0); const o = L === 'Right' ? 'Left' : 'Right'; rot(B[o + 'Leg'], 0.3 * k, 0, 0); rot(B.Spine, 0.15 * k, 0, -sd * 0.15 * fl); }
      else { rot(B.Spine, 0.25 * k, 0, sd * 0.3 * k); rot(B.LeftLeg, 0.4 * k, 0, 0); rot(B.RightLeg, 0.4 * k, 0, 0); }
      rot(B.LeftArm, 0, 0, 0.55 * k); rot(B.RightArm, 0, 0, -0.55 * k);
    } else if (a.type === 'poke') {
      // standing tackle: plant the support foot, sink, and either block with the inside of the foot or stretch a toe at the ball
      resetB(p, B, LOWER);
      const s = ease(clamp(u / 0.32, 0, 1)) * (1 - ease(clamp((u - 0.62) / 0.38, 0, 1))); const T = (a.foot ?? 1) > 0 ? 'Right' : 'Left', Sp = T === 'Right' ? 'Left' : 'Right'; const tg = T === 'Right' ? -1 : 1;
      if (a.style === 'block') { rot(B[T + 'UpLeg'], -0.7 * s, -tg * 0.75 * s, tg * 0.1 * s); rot(B[T + 'Leg'], 0.3 * s, 0, 0); rot(B[T + 'Foot'], -0.3 * s, 0, 0); }
      else { rot(B[T + 'UpLeg'], -1.0 * s, 0, tg * 0.15 * s); rot(B[T + 'Leg'], 0.15 * s, 0, 0); rot(B[T + 'Foot'], 0.35 * s, 0, 0); }
      rot(B[Sp + 'UpLeg'], -0.45 * s, 0, 0); rot(B[Sp + 'Leg'], 0.75 * s, 0, 0); rot(B[Sp + 'Foot'], -0.3 * s, 0, 0);
      rot(B.Spine, 0.32 * s, 0, 0); rot(B.Hips, 0.12 * s, 0, 0); rot(B.LeftArm, -0.2 * s, 0, 0.75 * s); rot(B.RightArm, -0.2 * s, 0, -0.75 * s);
    } else if (a.type === 'stumble') {
      const s = ease(clamp(u / 0.25, 0, 1)) * (1 - ease(clamp((u - 0.55) / 0.45, 0, 1))); rot(B.Spine, 0.5 * s, 0, 0.18 * s * Math.sin(u * 9)); rot(B.RightArm, -0.4 * s, 0, -1.0 * s); rot(B.LeftArm, -0.3 * s, 0, 0.8 * s); rot(B.LeftLeg, 0.3 * s, 0, 0); rot(B.RightLeg, 0.3 * s, 0, 0);
    } else if (a.type === 'throw' || a.type === 'throwReady' || a.type === 'carry') {
      // throw-in (Law 15): ball taken back behind the head with both hands, back arched, then whipped forward over the head;
      // keepers use the same over-arm action to roll or throw it out
      resetB(p, B, ARMS);
      let lift, bend, arch, fwdA;
      if (a.type === 'carry') { lift = 0; bend = 1.3; arch = 0; fwdA = 0.95; }
      else if (a.type === 'throwReady') { lift = 1; bend = 1.6; arch = -0.12 - 0.04 * Math.sin(S.t * 2); fwdA = 0; }
      else { const back = u < 0.45 ? ease(u / 0.45) : 1 - ease(clamp((u - 0.45) / 0.2, 0, 1)); const rel = ease(clamp((u - 0.42) / 0.22, 0, 1)) * (1 - ease(clamp((u - 0.75) / 0.25, 0, 1)) * 0.6);
        lift = 1 - 0.55 * rel; bend = 1.6 * back + 0.1; arch = -0.35 * back + 0.38 * rel; fwdA = 0.9 * rel; }
      for (const [sd, sg] of [['Left', 1], ['Right', -1]]) { rot(B[sd + 'Arm'], -(0.9 + 1.75 * lift) + 0.4 * fwdA * (1 - lift), 0, sg * (0.3 + 0.15 * lift)); rot(B[sd + 'ForeArm'], -bend, 0, 0); }
      rot(B.Spine, arch, 0, 0); rot(B.Spine1, arch * 0.5, 0, 0);
    } else if (a.type === 'celebrate') {
      const up = 0.5 + 0.5 * Math.sin(S.t * 2 + p.phase);
      if (a.style === 'plane') { rot(B.RightArm, 0, 0, -1.45); rot(B.LeftArm, 0, 0, 1.45); p.model.rotateZ(Math.sin(S.t * 1.5) * 0.18); }
      else if (a.style === 'slide') { const k2 = ease(clamp(u / 0.2, 0, 1)); p.model.position.y = -0.38 * k2; p.model.rotateX(-0.35 * k2); rot(B.LeftLeg, 1.9 * k2, 0, 0); rot(B.RightLeg, 1.9 * k2, 0, 0); rot(B.LeftUpLeg, 0.2 * k2, 0, 0); rot(B.RightUpLeg, 0.2 * k2, 0, 0); rot(B.RightArm, 0, 0, -2.4); rot(B.LeftArm, 0, 0, 2.4); rot(B.Spine, -0.35, 0, 0); }
      else { rot(B.RightArm, 0, 0, -2.3 * up); rot(B.LeftArm, 0, 0, 2.3 * up); p.model.position.y = Math.max(0, Math.sin(S.t * 8 + p.phase)) * 0.28; }
    } else if (a.type === 'fall') {
      // fouled: legs taken, a stumbling step, hands go out to break the fall, a moment down on the turf, then push back up
      resetB(p, B, LOWER); resetB(p, B, ARMS);
      const lie = ease(clamp((u - 0.04) / 0.18, 0, 1)) * (1 - ease(clamp((u - 0.7) / 0.3, 0, 1)));
      const up = u > 0.7 ? Math.sin(clamp((u - 0.7) / 0.3, 0, 1) * Math.PI) : 0;
      p.model.rotateX(1.47 * lie); p.model.position.y = 0.04 * lie;
      rot(B.LeftUpLeg, -0.25 * lie - 0.9 * up, 0, 0.05); rot(B.RightUpLeg, 0.1 * lie - 0.3 * up, 0, -0.05); rot(B.LeftLeg, 0.5 * lie + 1.3 * up, 0, 0); rot(B.RightLeg, 1.0 * lie + 0.6 * up, 0, 0);
      rot(B.LeftFoot, 0.5 * lie, 0, 0); rot(B.RightFoot, 0.5 * lie, 0, 0);
      rot(B.Spine, -0.15 * lie + 0.45 * up, 0, 0); rot(B.Neck, -0.4 * lie, 0, 0); rot(B.Head, -0.2 * lie, 0, 0);
      rot(B.LeftArm, -1.25 * lie, 0, 0.45 * lie + 0.3 * up); rot(B.RightArm, -1.25 * lie, 0, -0.45 * lie - 0.3 * up); rot(B.LeftForeArm, -0.7 * lie, 0, 0); rot(B.RightForeArm, -0.7 * lie, 0, 0);
    } else if (a.type === 'flag') {
      // assistant: flag straight up (offside) then pointed at the spot of the offence
      const s = ease(clamp(u * 5, 0, 1)) * (1 - ease(clamp((u - 0.85) / 0.15, 0, 1))); const pt = ease(clamp((u - 0.5) / 0.15, 0, 1));
      resetB(p, B, ARMS); rot(B.RightArm, -1.2 * pt * s, 0, -(2.9 - 1.2 * pt) * s);
    } else if (a.type === 'card') {
      const s = ease(clamp(u * 4, 0, 1)) * (1 - ease(clamp((u - 0.8) / 0.2, 0, 1))); resetB(p, B, ARMS); rot(B.RightArm, -0.15 * s, 0, -2.95 * s); rot(B.Head, -0.12 * s, 0, 0);
    } else if (a.type === 'point' || a.type === 'signal') {
      // referee and assistant signals: an arm held straight along the direction of the decision (IFAB Law 5 signals)
      const s = ease(clamp(u * 4, 0, 1)) * (1 - ease(clamp((u - 0.82) / 0.18, 0, 1))); resetB(p, B, ARMS);
      const dir = a.dir || fwd(p); const fz = fwd(p), rz = right(p); const c = dir.x * fz.x + dir.y * fz.y, sn = dir.x * rz.x + dir.y * rz.y; const el = 1.5 + (a.up || 0);
      const ang = Math.atan2(Math.abs(sn), c); // 0 = straight ahead, pi/2 = to the side
      const flex = el * Math.cos(clamp(ang, 0, Math.PI / 2)), abd = el * Math.sin(clamp(ang, 0, Math.PI / 2));
      if (a.both) { rot(B.RightArm, -1.45 * s, 0, -0.3 * s); rot(B.LeftArm, -1.45 * s, 0, 0.3 * s); }
      else if (sn >= 0) rot(B.RightArm, -flex * s, 0, -abd * s); else rot(B.LeftArm, -flex * s, 0, abd * s);
    } else if (a.type === 'despair') {
      rot(B.RightArm, 0, 0.5, -2.1); rot(B.LeftArm, 0, -0.5, 2.1); rot(B.RightForeArm, 0, 1.2, 0); rot(B.LeftForeArm, 0, -1.2, 0); rot(B.Head, 0.35, 0, 0);
    }
  }
  if (dt > 0) inertialize(p, dt, B, a);
  // ground contact: drop or lift the body so the lowest foot rests on the turf
  if (!(a && (a.type === 'dive' || a.type === 'slide' || a.type === 'fall' || (a.type === 'celebrate' && a.style === 'slide')))) {
    p.model.updateMatrixWorld(true); let lo = 1e9;
    for (const n of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) lo = Math.min(lo, B[n].getWorldPosition(gv).y - p.model.position.y - p.footRest[n] * p.scale);
    const gTgt = p.model.position.y - clamp(lo, -0.4, 0.3);
    // the pelvis height follows the solved contact through a light filter so switching support feet never pops the body
    p.gY = p.gY === undefined || dt <= 0 || dt > 0.2 ? gTgt : p.gY + (gTgt - p.gY) * (1 - Math.exp(-dt * 26)); p.model.position.y = Math.max(p.gY, gTgt - 0.03);
  }
  if (p.label) { const show = S.names === 'all' || (S.owner === p) || (S.names === 'ball' && S.follow === p); p.label.visible = show; }
}

const LOWER = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
const ARMS = ['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'];
function resetB(p, B, list) { for (const n of list) if (B[n]) B[n].quaternion.copy(p.rest[n]); }
// ---- inertial blending ----
// When an action starts or ends (a tackle, a header, a keeper picking the ball up) the raw pose jumps. The jump is captured as an
// offset per bone and on the root, and that offset decays to nothing over about a fifth of a second, so the body flows from one
// move into the next instead of snapping. This is the inertialization technique used by modern game animation systems.
let ACTID = 0; const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qid = new THREE.Quaternion(), _yax = new THREE.Vector3(0, 1, 0);
function inertialize(p, dt, B, a) {
  const names = p.bnames || (p.bnames = Object.keys(B));
  if (a && !a._id) a._id = ++ACTID;
  const key = (a ? a._id : 0) + '|' + (p.holding ? 1 : 0) + '|' + (p.stamina < 0.4 && p.vel.length() < 0.5 && !p.gk ? 1 : 0);
  _qb.setFromAxisAngle(_yax, p.yaw); const extra = _qb.clone().invert().multiply(p.model.quaternion);
  const rootPos = new THREE.Vector3(p.model.position.x - (p.pos2.x - 52.5), p.model.position.y, p.model.position.z - (p.pos2.y - 34));
  if (key !== p.iKey) {
    if (p.iDisp && p.iKey !== undefined) {
      p.iOff = {}; for (const n of names) p.iOff[n] = p.iDisp[n].clone().multiply(_qa.copy(B[n].quaternion).invert());
      p.iRoot = p.iDispRoot.clone().multiply(extra.clone().invert()); p.iPos = p.iDispPos.clone().sub(rootPos); p.iT = 0;
      p.iTau = a && (a.type === 'kick' || a.type === 'shot') ? 0.06 : 0.09;
    }
    p.iKey = key;
  }
  if (p.iOff) {
    p.iT += dt; const w = Math.exp(-p.iT / p.iTau);
    if (w < 0.01) p.iOff = null;
    else {
      for (const n of names) { _qa.copy(_qid).slerp(p.iOff[n], w); B[n].quaternion.premultiply(_qa); }
      _qa.copy(_qid).slerp(p.iRoot, w); extra.premultiply(_qa); p.model.quaternion.copy(_qb).multiply(extra);
      rootPos.addScaledVector(p.iPos, w); p.model.position.set(rootPos.x + p.pos2.x - 52.5, rootPos.y, rootPos.z + p.pos2.y - 34);
    }
  }
  if (!p.iDisp) { p.iDisp = {}; for (const n of names) p.iDisp[n] = new THREE.Quaternion(); }
  for (const n of names) p.iDisp[n].copy(B[n].quaternion);
  p.iDispRoot = extra.clone(); p.iDispPos = rootPos.clone();
}

// ============ OWNER CONTROL (dribble, kicks, keeper distribution) ============
function ownerControl(p, dt) {
  p.ownT = (p.ownT || 0) + dt;
  const b = bp2(); const dist = p.pos2.distanceTo(b);
  if (dist > 2.6 && !p.holding) { S.owner = null; return; }
  if (p.holding) {
    ball.p.set(p.pos2.x + Math.sin(p.yaw) * 0.35, 1.05, p.pos2.y + Math.cos(p.yaw) * 0.35); ball.v.set(0, 0, 0);
    p.holdT -= dt; p.tgt.copy(p.pos2); p.urg = 0.3; p.lookAt = V2(52.5, 34);
    if (p.holdT <= 0) {
      p.holding = false; const plan = decide(p); const q = plan.q || teamOf(p.ti).find((x) => x.pos === 'CB');
      if (!plan.lofted && plan.d < 30) { p.act = { type: 'throw', t: 0, dur: 0.8 }; ball.p.y = 2.0; const v = solveGround(new THREE.Vector3(ball.p.x, BR, ball.p.z), new THREE.Vector3(q.pos2.x, 0, q.pos2.y), 6); ball.v.copy(v).multiplyScalar(0.95); ball.v.y = 1.5; S.owner = null; ball.last = p; S.intended = q; S.passInfo = { from: p, to: q, kind: 'throw', pq: 70, t: S.t }; p.touchCD = 0.5; S.traj = null; }
      else { ball.p.y = BR; const tgt = own2w(p.ti, 55 + rnd() * 10, 10 + rnd() * 48); const sol = solveLofted(ball.p.clone(), new THREE.Vector3(tgt.x, 0, tgt.y), 34, 0); ball.v.copy(sol.v); S.owner = null; ball.last = p; S.intended = null; p.touchCD = 0.5; p.act = kickAct({ type: 'clear' }, 1); p.act.t = p.act.strikeAt * p.act.dur; p.act.struck = true; S.traj = null; say(surname(p.name) + ' launches it long.'); }
    }
    return;
  }
  if (p.act && (p.act.type === 'kick' || p.act.type === 'shot')) {
    // set up the strike: stand behind and beside the ball, along the kick direction
    const plan = p.act.plan; const aim = plan.aimPt || (plan.type === 'shot' ? goalOf(p.ti) : plan.type === 'clear' ? own2w(p.ti, 95, 34) : plan.q.pos2);
    // stand where the kicking foot meets the ball at contact (offsets measured on the rig: forward, lateral, per technique)
    // motion warping: over the last stride the body is steered so the kicking foot arrives exactly at the ball (predicted
    // forward to the moment of contact) and the hips square up to the target, the same trick broadcast football games use
    const tr = Math.max(p.act.strikeAt * p.act.dur - p.act.t, dt); const bc = b.clone().add(V2(ball.v.x, ball.v.z).multiplyScalar(Math.min(tr, 0.4)));
    const kd = aim.clone().sub(bc).normalize(); const off = KOFF[p.act.kind] || KOFF.instep;
    const stand = bc.clone().addScaledVector(kd, -off[0]).addScaledVector(V2(-kd.y, kd.x), -off[1] * p.act.foot);
    p.tgt.copy(stand); p.urg = 0.9; p.lookAt = bc.clone().addScaledVector(kd, 3); p.watch = false;
    if (!p.act.struck) { p.kWarp = true; p.vel.copy(stand.clone().sub(p.pos2).multiplyScalar(1 / tr)); if (p.vel.length() > 9) p.vel.setLength(9); p.yaw += clamp(wrapA(Math.atan2(kd.x, kd.y) - p.yaw) * Math.min(1, dt / tr), -12 * dt, 12 * dt); }
    if (!p.act.struck && p.act.t / p.act.dur >= p.act.strikeAt) { p.act.struck = true; if (p.act.onStrike) p.act.onStrike(); else if (p.pos2.distanceTo(b) < 2.1 && ball.p.y < 1.0) strike(p); else { p.act = null; S.kickAbort = (S.kickAbort || 0) + 1; } }
    return;
  }
  // give-and-go: the wall pass is played first time back into the runner's path
  if (p.oneTwo && !p.act) { const r = p.oneTwo.to; if (S.t - p.oneTwo.t > 3 || r.off) p.oneTwo = null;
    else if (p.ownT > 0.08) { p.oneTwo = null; const tgt = r.pos2.clone().addScaledVector(r.vel, 0.7); if (laneSafety(p.pos2, tgt, p.ti) > 1.2 && w2own(p.ti, tgt).x < offsideLine(p.ti) + 0.3) { startKick(p, { type: 'pass', q: r, tgt, lofted: false, d: tgt.distanceTo(p.pos2), oneTwo: true }); return; } } }
  // think
  p.nextThink -= dt;
  if (p.nextThink <= 0) {
    p.nextThink = 0.28 + rnd() * 0.3; const plan = decide(p);
    // a touch to settle before passing (quicker under pressure or on the break), shots can be first time
    // elite passers move it on first time when the lane is clean and someone is pressing
    if (plan.type === 'pass' && !plan.lofted && p.ownT > 0.1 && p.ownT < 0.6 && plan.press < 3.5 && plan.safe > 2 && rnd() < 0.35 * p.passS) { plan.first = true; startKick(p, plan); return; }
    if ((plan.type === 'shot' && p.ownT > 0.15) || ((plan.type === 'pass' || plan.type === 'clear') && p.ownT > lerp(1.5, 0.75, p.T.tac ? p.T.tac.cur.tempo : 0.5) * (plan.type === 'clear' ? 0.5 : 1))) { startKick(p, plan); return; }
    if (plan.type === 'dribble') { p.dribDir = plan.dir.clone().rotateAround(V2(0, 0), gauss() * 0.25); p.dribSp = plan.space > 9 ? Math.min(p.vmax * (0.7 + 0.3 * p.stamina), 8) : plan.space > 4 ? 5.5 : 3.6; }
  }
  // take-ons: an elite dribbler facing a defender commits him with a skill move, then bursts away the other side
  p.skillCD = (p.skillCD || 0) - dt;
  if (!p.act && p.skillCD <= 0 && p.ownT > 0.3) {
    const f0 = p.dribDir || fwd(p); const opp = teamOf(1 - p.ti).find((o) => !o.gk && !o.off && o.beaten <= 0 && o.pos2.distanceTo(p.pos2) < 3 && o.pos2.clone().sub(p.pos2).normalize().dot(f0) > 0.5);
    const ox = w2own(p.ti, p.pos2).x;
    if (opp && ox > 40 && rnd() < dt * (0.15 + 0.6 * p.drib) * (ox > 70 ? 1.6 : 1)) {
      const rel = opp.pos2.clone().sub(p.pos2); const away = -Math.sign(f0.x * rel.y - f0.y * rel.x || 1);
      const r0 = rnd(); const move = p.drib > 0.8 && r0 < 0.12 ? 'roulette' : p.drib > 0.85 && r0 < 0.2 ? 'elastico' : p.drib > 0.7 && r0 < 0.45 ? 'stepover' : r0 < 0.6 ? 'dragback' : r0 < 0.75 ? 'cut' : 'feint';
      p.act = { type: 'skill', move, t: 0, dur: { stepover: 0.6, roulette: 0.7, dragback: 0.65, elastico: 0.5 }[move] || 0.45, side: away };
      p.dribDir = f0.clone().rotateAround(V2(0, 0), away * (move === 'cut' ? 1.3 : move === 'dragback' ? 1.9 : move === 'roulette' ? 0.9 : 0.6 + 0.3 * rnd())); p.dribSp = Math.min(p.vmax * 0.9, 7.5);
      const win = rnd() < clamp(0.35 + 0.5 * p.drib - 0.35 * opp.tackle + (move === 'stepover' ? 0.05 : 0), 0.1, 0.85);
      if (win) { opp.beaten = 0.6 + 0.5 * p.drib; if (rnd() < 0.5) say(p.name + ({ stepover: ' with the step-over, ', cut: ' chops inside, ', roulette: ' spins away with a roulette, ', dragback: ' drags it back, ', elastico: ' with the elastico, ' }[move] || ' drops the shoulder, ') + 'and ' + surname(opp.name) + ' is beaten.'); }
      dataEvent('take_on', { team: p.T.key, player: p.name, defender: opp.name, move, success: win }); p.skillCD = 3 * TUNE.skillCD;
    }
  }
  const dd = p.dribDir || fwd(p); const sp = p.dribSp || 3.5;
  // run onto the ball from behind along the dribble direction
  p.tgt.copy(b.clone().addScaledVector(dd, -0.32)); p.urg = sp > 7 ? 1 : sp > 5 ? 0.75 : 0.55; p.lookAt = b.clone().addScaledVector(dd, 6); p.watch = false;
  const foot = p.pos2.clone().addScaledVector(fwd(p), 0.32);
  if (foot.distanceTo(b) < 0.42 && ball.p.y < 0.5) {
    const push = clamp(p.vel.length() * (sp > 7 ? 1.55 : 1.25) + 0.9, 1.8, 11); const jitter = gauss() * (0.12 - p.ctrl * 0.07);
    const d2 = dd.clone().rotateAround(V2(0, 0), jitter); ball.v.set(d2.x * push, 0, d2.y * push); ball.last = p;
  }
}

// ============ RESTARTS, GOALS, OUT OF PLAY ============
function refereeBall() {
  if (S.restart) return;
  const b = ball.p;
  for (const gx of [0, 105]) {
    const crossed = gx === 0 ? b.x < -BR : b.x > 105 + BR;
    if (!crossed || ball.inNet) continue;
    const vetoed = S.shotInfo && S.t - S.shotInfo.t < 5 && S.shotInfo.fate && S.shotInfo.fate !== 'goal'; // the shot's drawn fate stands: no goal from a deflected miss or save
    if (!vetoed && b.z > 30.34 + BR * 0.2 && b.z < 37.66 - BR * 0.2 && b.y < 2.44) { goal(goalOf(0).x === gx ? 0 : 1); ball.inNet = gx + 1; return; }
    const defTeam = ownGoal(0).x === gx ? 0 : 1; const last = S.lastTouch ? S.lastTouch.ti : 1 - defTeam;
    if (last === defTeam) { say('Corner to ' + TEAMS[1 - defTeam].club + '.'); deadBall('corner', 1 - defTeam, V2(gx === 0 ? 0.3 : 104.7, b.z < 34 ? 0.3 : 67.7)); }
    else { say('Goal kick.'); deadBall('goalkick', defTeam, V2(gx === 0 ? 5.5 : 99.5, b.z < 34 ? 28 : 40)); }
    return;
  }
  if (b.z < -BR || b.z > 68 + BR) { const last = S.lastTouch ? S.lastTouch.ti : 0; say('Throw-in to ' + TEAMS[1 - last].club + '.'); deadBall('throw', 1 - last, V2(clamp(b.x, 1, 104), b.z < 0 ? -0.3 : 68.3)); }
}
// the ball is out: play stops, the ball runs on beyond the line, the officials signal, and only then is the restart set up
function deadBall(type, team, spot) {
  S.dead = { type, team, spot, t: 0, dur: type === 'throw' ? 0.7 : 1.1 }; S.owner = null; S.intended = null; S.traj = null; S.offSet = null;
  S.check && S.check.out(type, team, spot);
  const dirT = V2(dirOf(team), 0); const ar = arFor(spot.x, spot.y);
  if (type === 'throw') { if (ar) signal(ar, V2(dirT.x, 0), 0.6); else signal('ref', V2(dirT.x, 0), 0.4); }
  else if (type === 'corner') { const c = V2(spot.x, spot.y); const o = officials.find((x) => x.role === (ar || 'ref')); signal(ar || 'ref', c.clone().sub(o.pos2), 0.8); }
  else signal('ref', V2(spot.x - 52.5, 0), -0.25);
}
function deadTick(dt) {
  const D = S.dead; D.t += dt;
  // the ball rolls on off the pitch and stops at the advertising boards
  const steps = 4; for (let k = 0; k < steps; k++) ballPhysics(ball, dt / steps);
  if (ball.p.z < -3.6 || ball.p.z > 71.6) { ball.p.z = clamp(ball.p.z, -3.6, 71.6); ball.v.z *= -0.3; ball.v.x *= 0.5; }
  if (ball.p.x < -3.5 || ball.p.x > 108.5) { ball.p.x = clamp(ball.p.x, -3.5, 108.5); ball.v.x *= -0.3; ball.v.z *= 0.5; }
  if (Math.abs(ball.p.z - 34) > 34.5 || Math.abs(ball.p.x - 52.5) > 53) { ball.v.x *= Math.max(0, 1 - 2.5 * dt); ball.v.z *= Math.max(0, 1 - 2.5 * dt); }
  for (const p of players) if (!p.off && p.urg > 0.6 && !p.act) p.urg = 0.55; // play has stopped: nobody sprints after a dead ball
  if (D.t >= D.dur) { S.dead = null; setRestart(D.type, D.team, D.spot); if (D.type === 'throw') { const R = S.restart; const bAt = V2(ball.p.x, ball.p.z); R.ballAt = bAt.distanceTo(R.spot) < 8 ? bAt : R.spot.clone().add(V2(0, R.spot.y < 34 ? -1.2 : 1.2)); R.phase = 'fetch'; ball.p.set(R.ballAt.x, BR, R.ballAt.y); ball.v.set(0, 0, 0); } }
}
function goal(ti) {
  S.score[ti]++; if (S.goalsHalf) S.goalsHalf[S.half - 1]++; LED.goalTeam = ti; LED.goalT = 6; STATS.goals.push({ min: minuteLabel(), team: ti });
  const og = S.lastTouch && S.lastTouch.ti !== ti ? S.lastTouch : null; const sc = og ? (S.passInfo && S.passInfo.from.ti === ti ? S.passInfo.from : teamOf(ti).find((q) => q.pos === 'ST')) : S.lastTouch || teamOf(ti).find((q) => q.pos === 'ST');
  const how = og ? 'own goal' : S.shotInfo && S.t - S.shotInfo.t < 4 ? 'shot' : S.passInfo && S.passInfo.from === sc && S.t - S.passInfo.t < 4 ? 'pass' : 'other';
  toast('GOAL<small>' + (og ? og.name + ' (OG)' : sc.name) + ' · ' + TEAMS[ti].club + '</small>', 3.5);
  say(og ? 'GOAL! An own goal by ' + og.name + '. ' : 'GOAL! ' + sc.name + ' scores. ' + TEAMS[0].key + ' ' + S.score[0] + '-' + S.score[1] + ' ' + TEAMS[1].key + '.');
  dataEvent('goal', { team: TEAMS[ti].key, player: og ? og.name : sc.name, ownGoal: !!og, how, score: S.score.join('-') });
  S.celebrate = 7; S.scorer = sc; S.owner = null; S.intended = null; whistle('long'); { const rf = officials.find((o) => o.role === 'ref'); if (rf) signal('ref', V2(52.5, 34).sub(rf.pos2), -0.35, { dur: 2.6 }); }
  S.check && S.check.goal(ti);
  sc.act = { type: 'celebrate', t: 0, dur: 7, style: rnd() < 0.5 ? 'plane' : 'slide' };
  for (const p of teamOf(ti)) if (p !== sc && !p.gk) p.act = { type: 'celebrate', t: 0, dur: 6.5, style: 'jump' };
  for (const p of teamOf(1 - ti)) { p.sad = 6; if (rnd() < 0.5 && !p.gk) p.act = { type: 'despair', t: 0, dur: 2.5 }; }
  const gk = teamOf(1 - ti).find((q) => q.gk); gk.shake = 2;
  S.focus = sc;
}
function runRestart(dt) {
  const R = S.restart; if (!R) return;
  const tk = R.taker; if (!tk) return;
  if (!(S.celebrate > 0)) R.age = (R.age || 0) + dt;
  if (R.type === 'throw') { if (throwIn(R, tk, dt)) return; }
  else { ball.p.set(R.spot.x, BR, R.spot.y); ball.v.set(0, 0, 0); }
  if (S.celebrate > 0) return;
  const close = tk.pos2.distanceTo(R.spot) < 1.4;
  // watchdog: a taker who is sent off, or cannot reach the ball, must not freeze the match
  if (tk.off) { R.taker = teamOf(R.team).filter((p) => !p.gk && !p.off).sort((a, b) => a.pos2.distanceTo(R.spot) - b.pos2.distanceTo(R.spot))[0] || null; return; }
  if (!close && R.age > 20 && R.type !== 'throw') { tk.pos2.lerp(R.spot, clamp(dt * 2, 0, 1)); if (R.age > 60) R.wait = 0; }
  if (close) R.wait -= dt;
  if (R.wait > 0) return;
  // Law 8: at kick-off every player is in his own half and opponents are outside the centre circle (we allow 12 s to get there)
  if (R.type === 'kickoff' && R.age < 25) { for (const q of players) { if (q.off || q === tk) continue; const ox = w2own(q.ti, q.pos2).x; if (ox > 52.4 || (q.ti !== R.team && q.pos2.distanceTo(V2(52.5, 34)) < 9.15)) return; } }
  if (R.type === 'kickoff') whistle('short');
  const mates = teamOf(R.team).filter((q) => q !== tk && !q.gk);
  if (R.type === 'kickoff') {
    const q = mates.filter((m) => m.pos.includes('M')).sort((a, b) => a.pos2.distanceTo(tk.pos2) - b.pos2.distanceTo(tk.pos2))[0] || mates.find((m) => m !== tk && !m.gk);
    S.restart = null; S.owner = tk; tk.ownT = 1; startKick(tk, { type: 'pass', q, tgt: q.pos2.clone(), lofted: false, d: q.pos2.distanceTo(tk.pos2) }); tk.act.t = tk.act.dur * 0.3; ball.last = tk;
    say('Kick-off. ' + TEAMS[R.team].club + ' get us going again.');
  } else if (R.type === 'freekick' || R.type === 'penalty') { setPieceKick(R, tk);
  } else {
    S.restart = null; S.owner = tk; tk.ownT = 1;
    // corners and goal kicks: the taker runs through a full lofted strike and the ball leaves the foot at contact
    const corner = R.type === 'corner'; const tgt = corner ? own2w(R.team, 94 + rnd() * 4, 30 + rnd() * 8) : own2w(R.team, 50 + rnd() * 12, 12 + rnd() * 44);
    tk.act = kickAct({ type: 'pass', lofted: true, cross: corner, d: tgt.distanceTo(tk.pos2), aimPt: tgt }, tk.foot);
    tk.act.onStrike = () => { const sol = solveLofted(ball.p.clone(), new THREE.Vector3(tgt.x, 0, tgt.y), corner ? 30 : 36, corner ? (R.spot.y < 34 ? 1 : -1) * dirOf(R.team) * 5 : 0); ball.v.copy(sol.v); ball.w.copy(sol.w); S.owner = null; ball.last = tk; S.lastTouch = tk; S.intended = null; tk.touchCD = 0.5; S.traj = null; if (corner) say(surname(tk.name) + ' swings the corner in.'); };
  }
}
// throw-in (Law 15): the nearest player jogs to the ball, picks it up, carries it to where it went out, stands with both feet on
// or behind the line, takes it back behind his head with both hands and delivers it over his head to a team-mate showing for it
function throwIn(R, tk, dt) {
  const inward = R.spot.y < 34 ? 1 : -1;
  if (R.phase === 'fetch') {
    ball.p.set(R.ballAt.x, BR, R.ballAt.y); ball.v.set(0, 0, 0);
    if (R.age > 9) R.ballAt.lerp(tk.pos2, clamp(dt * 2, 0, 1)); // a ball boy helps out if the taker is slow getting to it
    if (tk.pos2.distanceTo(R.ballAt) < 0.9) { R.phase = 'carry'; tk.act = { type: 'carry', t: 0, dur: 60 }; }
    return true;
  }
  const f = fwd(tk);
  if (R.phase === 'carry') {
    ball.p.set(tk.pos2.x + f.x * 0.32, 1.15, tk.pos2.y + f.y * 0.32); ball.v.set(0, 0, 0);
    const behindLine = R.spot.y < 34 ? tk.pos2.y <= 0.1 : tk.pos2.y >= 67.9;
    if ((tk.pos2.distanceTo(R.spot) < 0.7 && behindLine) || (R.age > 9 && tk.pos2.distanceTo(R.spot) < 2.5)) { R.phase = 'ready'; R.wait = 0.9 + rnd() * 0.8; tk.act = { type: 'throwReady', t: 0, dur: 60 }; }
    return true;
  }
  if (R.phase === 'ready') {
    ball.p.set(tk.pos2.x - f.x * 0.12, 2.12, tk.pos2.y - f.y * 0.12); ball.v.set(0, 0, 0);
    tk.faceYaw = Math.atan2(0, inward); tk.tgt.copy(R.spot); tk.pos2.lerp(R.spot, clamp(dt * 3, 0, 1));
    R.wait -= dt; if (R.wait > 0 || S.celebrate > 0) return true;
    const opts = teamOf(R.team).filter((q) => q !== tk && !q.gk && q.pos2.distanceTo(tk.pos2) < 22).sort((a, b) => (laneSafety(tk.pos2, b.pos2, R.team) - laneSafety(tk.pos2, a.pos2, R.team)) + (a.pos2.distanceTo(tk.pos2) - b.pos2.distanceTo(tk.pos2)) * 0.05);
    R.q = opts[0] || teamOf(R.team).filter((q) => q !== tk && !q.gk).sort((a, b) => a.pos2.distanceTo(tk.pos2) - b.pos2.distanceTo(tk.pos2))[0];
    R.phase = 'throw'; tk.act = { type: 'throw', t: 0, dur: 0.9 }; return true;
  }
  if (R.phase === 'throw') {
    const u = tk.act ? tk.act.t / tk.act.dur : 1; const k = clamp((u - 0.25) / 0.25, 0, 1);
    tk.pos2.lerp(R.spot, clamp(dt * 3, 0, 1)); ball.p.set(tk.pos2.x + f.x * lerp(-0.12, 0.3, k), lerp(2.12, 2.3, k), tk.pos2.y + f.y * lerp(-0.12, 0.3, k)); ball.v.set(0, 0, 0);
    if (u < 0.5) return true;
    const q = R.q; const from = ball.p.clone(); from.z = clamp(from.z, -0.2, 68.2); const tgt = q.pos2.clone().addScaledVector(q.vel, 0.6); const d = tgt.distanceTo(V2(from.x, from.z));
    const v = new THREE.Vector3(tgt.x - from.x, 0, tgt.y - from.z).normalize().multiplyScalar(clamp(d * 0.72, 6, 14)); v.y = clamp(1 + d * 0.12, 1.5, 3.5);
    ball.p.copy(from); ball.v.copy(v); ball.w.set(0, 0, 0); S.restart = null; S.owner = null; ball.last = tk; S.lastTouch = tk; S.intended = q; tk.touchCD = 0.6; S.traj = null; tk.faceYaw = undefined;
    S.passInfo = { from: tk, to: q, kind: 'throw-in', pq: 70, t: S.t }; dataEvent('throw_in', { team: tk.T.key, player: tk.name, to: q.name, x: +R.spot.x.toFixed(1) });
    S.check && S.check.restartTaken(R, tk);
    return true;
  }
  return false;
}
function restartFormation() {
  // during a restart everyone moves to a sensible spot around the ball (corners load the box)
  const R = S.restart; if (!R) return;
  for (const p of players) {
    if (p === R.taker || p.act?.type === 'celebrate' || p.off) continue;
    if ((R.type === 'freekick' || R.type === 'penalty') && setPieceShape(R, p)) continue;
    if (R.type === 'corner' && !p.gk) {
      const atk = p.ti === R.team; const gx = R.spot.x < 50 ? 0 : 105; const sx = gx === 0 ? 1 : -1;
      if (atk && (p.pos === 'CB' && p.i % 2 === 0 || p.pos === 'ST' || p.pos.endsWith('W') || p.pos === 'CM')) { p.tgt.set(gx + sx * (6 + (p.i % 4) * 2.5), 28 + (p.i * 3.7) % 12); p.urg = 0.6; p.lookAt = R.spot; continue; }
      if (!atk && p.pos !== 'ST') { p.tgt.set(gx + sx * (3 + (p.i % 3) * 3), 29 + (p.i * 2.9) % 10); p.urg = 0.6; p.lookAt = R.spot; continue; }
    }
    if (R.type === 'throw' && !p.gk) {
      if (!R.show) { const inw = R.spot.y < 34 ? 1 : -1; const at = dirOf(R.team); R.show = [R.spot.clone().add(V2(at * 9, inw * 3)), R.spot.clone().add(V2(-at * 4, inw * 11)), R.spot.clone().add(V2(at * 3, inw * 16))].map((v) => V2(clamp(v.x, 3, 102), clamp(v.y, 3, 65)));
        const used = new Set(); R.showers = R.show.map((pt) => { const q = teamOf(R.team).filter((m) => m !== R.taker && !m.gk && !used.has(m)).sort((a, b) => a.pos2.distanceTo(pt) - b.pos2.distanceTo(pt))[0]; used.add(q); return q; }).filter(Boolean);
        R.markers = R.showers.map((m) => { const q = teamOf(1 - R.team).filter((o) => !o.gk && !used.has(o)).sort((a, b) => a.pos2.distanceTo(m.pos2) - b.pos2.distanceTo(m.pos2))[0]; used.add(q); return q; }); }
      const k = R.showers.indexOf(p); if (k >= 0) { p.tgt.copy(R.show[k]); p.urg = 0.7; p.lookAt = R.spot; if (R.phase === 'ready' && rnd() < 0.02) p.call = 0.8; continue; }
      const m = R.markers.indexOf(p); if (m >= 0 && R.showers[m]) { const sh = R.showers[m]; p.tgt.copy(sh.pos2.clone().add(ownGoal(p.ti).clone().sub(sh.pos2).normalize().multiplyScalar(1.5))); p.urg = 0.7; p.lookAt = R.spot; p.watch = true; continue; }
    }
    if (p.gk && R.type !== 'goalkick') { p.tgt.copy(ownGoal(p.ti)).add(V2(dirOf(p.ti) * 1.2, 0)); p.urg = 0.5; p.lookAt = R.spot; }
  }
}

// ============ GOALKEEPER SHOT REACTION ============
function keeperReact(dt) {
  if (S.owner || S.restart || S.dead) return;
  const sp = Math.hypot(ball.v.x, ball.v.z); if (sp < 9) return;
  for (const gk of players.filter((q) => q.gk)) {
    const og = ownGoal(gk.ti); const toward = (og.x - ball.p.x) * ball.v.x > 0; if (!toward || Math.abs(ball.p.x - og.x) > 30) continue;
    if (gk.act?.type === 'dive') continue;
    gk.reactT = (gk.reactT ?? 0.2) - dt; if (gk.reactT > 0) continue;
    // predicted crossing of the goal line
    const tr = trajectory(); const cross = tr.find((s) => Math.abs(s.p.x - og.x) < 0.6); if (!cross) continue;
    const inGoal = cross.p.z > 29.5 && cross.p.z < 38.5 && cross.p.y < 2.8; if (!inGoal) continue;
    const r = right(gk); const rel = V2(cross.p.x - gk.pos2.x, cross.p.z - gk.pos2.y); const lat = rel.dot(r);
    if (Math.abs(lat) > 0.7 || cross.p.y > 1.9) { gk.act = { type: 'dive', t: 0, dur: 1.5, side: Math.sign(lat), high: cross.p.y > 1.4 }; const need = Math.min(Math.abs(lat) - 1.0, 3.2) / Math.max(cross.t, 0.25); gk.vel.copy(r.clone().multiplyScalar(Math.sign(lat) * clamp(need, 0.5, 5.2))); gk.tgt.copy(gk.pos2.clone().addScaledVector(r, Math.sign(lat) * 1.5)); }
    else { gk.tgt.set(cross.p.x + dirOf(gk.ti) * 0.3, cross.p.z); gk.urg = 1; }
    gk.reactT = 0.2 + rnd() * 0.08;
  }
}

// ============ OFFICIALS ============
function officiate(dt) {
  const b = bp2();
  for (const o of officials) {
    if (o.role === 'ref') { const off = V2(b.x < 52.5 ? -10 : 10, b.y < 34 ? 9 : -9); o.tgt = b.clone().add(V2(-off.x * 0.4, off.y)); o.tgt.x = clamp(o.tgt.x, 15, 90); o.tgt.y = clamp(o.tgt.y, 8, 60); }
    else { const ti = o.role === 'ar1' ? 1 : 0; const half = o.role === 'ar1' ? [52.5, 105] : [0, 52.5]; const line = ti === 1 ? 105 - offsideLine(0) : offsideLine(1); o.tgt = V2(clamp(o.role === 'ar1' ? 105 - offsideLine(0) : offsideLine(1), half[0], half[1]), o.pos2.y); }
    o.lookAt = b; const dT = o.pos2.distanceTo(o.tgt); o.urg = dT > 20 ? 0.96 : dT > 8 ? 0.8 : 0.5; o.watch = true; o.agil = 1;
    // restarts: the referee takes up the textbook spot (edge of the centre circle, the corner of the box, beside the penalty spot)
    const R = S.restart;
    if (o.role === 'ref' && R) { const gx = R.spot.x < 52.5 ? 0 : 105, sx = gx === 0 ? 1 : -1;
      if (R.type === 'kickoff') o.tgt = V2(57, 38); else if (R.type === 'corner') o.tgt = V2(gx + sx * 17, R.spot.y < 34 ? 50 : 18); else if (R.type === 'penalty') o.tgt = V2(gx + sx * 14, 26);
      else if (R.type === 'goalkick') o.tgt = V2(gx + sx * 38, 34 + (R.spot.y < 34 ? 10 : -10)); }
    if (o.role !== 'ref' && R && R.type === 'penalty') { const gx = R.spot.x < 52.5 ? 0 : 105; if ((gx === 105) === (o.role === 'ar1')) o.tgt = V2(gx, o.role === 'ar1' ? 21 : 47); }
    if (o.role === 'ref' && S.owner) { const ow = S.owner; const away = o.pos2.clone().sub(ow.pos2); const dd = away.length(); if (dd < 9) { const side = V2(-ow.vel.y, ow.vel.x); if (side.length() < 0.1) side.copy(away); side.normalize(); if (side.dot(away) < 0) side.negate(); o.tgt = o.pos2.clone().addScaledVector(side, 9 - dd + 2); o.urg = 0.96; } }
    if (o.act && o.act.type === 'signal') { const ya = Math.atan2(o.act.dir.x, o.act.dir.y); const a1 = ya + 1.05, a2 = ya - 1.05; o.faceYaw = Math.abs(wrapA(a1 - o.yaw)) < Math.abs(wrapA(a2 - o.yaw)) ? a1 : a2; o.tgt = o.pos2.clone(); }
    if (o.act) { o.act.t += dt; if (o.act.t >= o.act.dur) { o.act = null; o.faceYaw = undefined; } }
    moveBody(o, dt); animate(o, dt);
  }
}

// ============ CAMERA ============
const camPos = new THREE.Vector3(0, 60, 120), camLook = new THREE.Vector3(), camVel = new THREE.Vector3(), lookVel = new THREE.Vector3();
function spring(cur, vel, target, dt, w) { const f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo; const det = 1 / (f + hhoo); const x = cur.clone(); const v = vel.clone(); cur.copy(x.clone().multiplyScalar(f).addScaledVector(v, dt).addScaledVector(target, hhoo).multiplyScalar(det)); vel.copy(v.clone().addScaledVector(target.clone().sub(x), hoo).multiplyScalar(det)); }
const CAMS = [['broadcast', 'Broadcast'], ['dynamic', 'Dynamic'], ['high', 'Tactical'], ['player', 'Player cam'], ['ball', 'Ball cam'], ['goal', 'Behind goal'], ['free', 'Free']];
// ---- camera director: a smoothed point of interest and a framed width, shared by the broadcast and dynamic cameras ----
// The focus leads the ball in its direction of travel with a soft dead zone (so dribbles don't shake the frame). The width
// follows the spread of players near the ball and the moment: tight in the box, wide for switches and long balls, and it
// changes slowly with a rate limit so zooms never snap.
const DIR = { f: new THREE.Vector3(), fv: new THREE.Vector3(), W: 48, Wv: 0, init: false };
function director(dt) {
  const b = W(ball.p.x, 0, ball.p.z); const v = new THREE.Vector3(ball.v.x, 0, ball.v.z); const sp = v.length();
  const lead = v.clone().multiplyScalar(Math.min(0.55, 9 / Math.max(sp, 1e-3) * 0.55));
  if (S.owner) { const d = dirOf(S.owner.ti); lead.x += d * 4; }
  const goal = b.clone().add(lead); goal.x = clamp(goal.x, -40, 40); goal.z = clamp(goal.z, -24, 24);
  if (!DIR.init) { DIR.f.copy(goal); DIR.init = true; }
  const off = goal.clone().sub(DIR.f); const dz = 2.5; const soft = (x) => Math.sign(x) * Math.max(0, Math.abs(x) - dz);
  const tgt = DIR.f.clone().add(new THREE.Vector3(soft(off.x), 0, soft(off.z) * 0.7));
  spring(DIR.f, DIR.fv, tgt, dt, 1.1);
  // framed width from the players who matter: everyone within 20 m of the ball
  let x0 = b.x, x1 = b.x, z0 = b.z, z1 = b.z; for (const p of players) { if (p.off) continue; const q = W(p.pos2.x, 0, p.pos2.y); if (q.distanceTo(b) < 20) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); } }
  let Wt = Math.max(x1 - x0 + 18, (z1 - z0 + 12) * Math.max(1, camera.aspect * 0.75), 44);
  const inBox = Math.abs(b.x) > 36 && Math.abs(b.z) < 22; const air = ball.p.y > 2.5 && sp > 14; const R = S.restart;
  if (inBox) Wt *= 0.86; if (air || sp > 20) Wt = Math.max(Wt, 58);
  if (R) Wt = R.type === 'throw' ? 40 : R.type === 'corner' ? 46 : R.type === 'goalkick' ? 62 : R.type === 'penalty' ? 34 : R.type === 'kickoff' ? 66 : Wt;
  if (camera.aspect < 1) Wt *= 0.75; Wt = clamp(Wt, 32, 72);
  const a = DIR.W, dW = clamp((Wt - a) * Math.min(1, dt * 0.9), -10 * dt, 10 * dt); DIR.W = a + dW;
  return DIR;
}
function updateCamera(dt) {
  if (S.cam === 'debug') return;
  const b = W(ball.p.x, ball.p.y, ball.p.z); let P, L, fov = 30, w = 2.2;
  if (!S.started) { const a = S.t * 0.1; P = new THREE.Vector3(Math.cos(a) * 80, 24 + 6 * Math.sin(S.t * 0.2), Math.sin(a) * 62); L = new THREE.Vector3(0, 2, 0); fov = 40; }
  else if (S.focus && S.celebrate > 0) { const f = S.focus; const fw = W(f.pos2.x, 0, f.pos2.y); const yf = fwd(f); P = new THREE.Vector3(fw.x + yf.x * 7 + 3, 2.6, fw.z + yf.y * 7 + 3); L = new THREE.Vector3(fw.x, 1.3, fw.z); fov = 34; w = 3; }
  else if (S.cam === 'broadcast' || S.cam === 'dynamic') {
    const D = director(dt); const f = D.f;
    if (S.cam === 'broadcast') {
      // TV gantry on the main stand: it barely moves, it pans and zooms. Zoom frames the players around the ball.
      const port = camera.aspect < 1; P = new THREE.Vector3(f.x * (port ? 0.9 : 0.3), port ? 46 : 21, port ? f.z + 44 : 64); L = new THREE.Vector3(f.x, 0.5, f.z);
      const dist = P.distanceTo(L); const hf = 2 * Math.atan(D.W / 2 / dist); fov = port ? clamp(D.W * 1.05, 34, 62) : clamp(2 * Math.atan(Math.tan(hf / 2) / camera.aspect) * 180 / Math.PI, 9, 58); w = 1.4;
    } else {
      // FIFA-style dynamic cam: lower and closer, sits a little behind the attack and leans towards goal
      const d = S.owner ? dirOf(S.owner.ti) : dirOf(S.poss); const back = 10 + D.W * 0.25;
      P = new THREE.Vector3(f.x - d * back * 0.55, 7 + D.W * 0.16, f.z + 16 + D.W * 0.32); L = new THREE.Vector3(f.x + d * 5, 0.6, f.z); fov = 42; w = 1.6;
    }
  }
  else if (S.cam === 'high') { P = new THREE.Vector3(b.x * 0.35, 95, 30); L = new THREE.Vector3(b.x * 0.35, 0, 0); fov = 48; }
  else if (S.cam === 'player') { const p = S.follow || players.find((q) => q.ti === 0 && q.pos === 'ST'); const pw = W(p.pos2.x, 0, p.pos2.y); const yf = fwd(p); P = new THREE.Vector3(pw.x - yf.x * 7.5, 3.4, pw.z - yf.y * 7.5); L = new THREE.Vector3(pw.x + yf.x * 6, 1.2, pw.z + yf.y * 6); fov = 50; w = 3; }
  else if (S.cam === 'ball') { const d = dirOf(S.poss); P = new THREE.Vector3(b.x - d * 10, 3.4, b.z + 6); L = new THREE.Vector3(b.x + d * 4, 0.8, b.z); fov = 50; w = 3; }
  else if (S.cam === 'goal') { const side = b.x > 0 ? 1 : -1; P = new THREE.Vector3(side * 66, 8, 0); L = new THREE.Vector3(b.x * 0.65, 0, b.z * 0.65); fov = 40; }
  if (S.cam === 'free' && S.started && !(S.focus && S.celebrate > 0)) { controls.update(); return; }
  spring(camPos, camVel, P, dt, w); spring(camLook, lookVel, L, dt, w * 1.3);
  camera.position.copy(camPos); camera.lookAt(camLook);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, clamp(dt * 1.5, 0, 1)); camera.updateProjectionMatrix(); }
}

// ============ HUD ============
let lastThird = '';
function hud() {
  const on = S.owner;
  for (const p of players) { const isOn = p === on; p.el.classList.toggle('on', isOn); p.el.classList.toggle('follow', S.follow === p && !isOn); p.arw.hidden = !isOn; p.stEl.style.width = Math.round(p.stamina * 100) + '%'; p.stEl.style.background = p.stamina > 0.6 ? 'var(--good)' : p.stamina > 0.35 ? '#FFD166' : '#FF6B6B'; }
  let c, k, n, s, st = null;
  const pi = S.passInfo, si = S.shotInfo;
  if (si && S.t - si.t < 1.6) { c = si.p.T.css; k = 'SHOT'; n = '#' + si.p.num + ' ' + si.p.name.toUpperCase(); s = si.kmh + ' km/h · xG ' + si.xg.toFixed(2); st = si.p.stamina; }
  else if (!on && pi && S.t - pi.t < 2.5 && S.intended) { c = pi.from.T.css; k = 'PASS'; n = '#' + pi.from.num + ' ' + pi.from.name.toUpperCase(); s = 'To #' + pi.to.num + ' ' + pi.to.name + ' · ' + pi.kind + ' · pass quality ' + pi.pq + (pi.diff != null ? ' · difficulty ' + pi.diff : ''); st = pi.from.stamina; }
  else if (on) { const press = Math.min(...teamOf(1 - on.ti).map((o) => o.pos2.distanceTo(on.pos2))); c = on.T.css; k = 'ON THE BALL'; n = '#' + on.num + ' ' + on.name.toUpperCase(); s = on.T.club + ' · ' + on.pos + ' · ' + (on.vel.length() * 3.6).toFixed(0) + ' km/h · pressure ' + (press < 2.5 ? 'high' : press < 6 ? 'medium' : 'low'); st = on.stamina; }
  else if (S.restart) { const T = TEAMS[S.restart.team]; c = T.css; k = { kickoff: 'KICK-OFF', throw: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: S.restart.indirect ? 'INDIRECT FREE KICK' : 'FREE KICK', penalty: 'PENALTY' }[S.restart.type]; n = T.club.toUpperCase(); s = S.restart.taker ? 'Taken by ' + S.restart.taker.name : ''; }
  else { c = '#9FB0C2'; k = 'LOOSE BALL'; n = '50 / 50'; s = 'Both teams chasing'; }
  const key = k + n + s; if (key !== lastThird) { lastThird = key; $('tbar').style.background = c; $('tk').textContent = k; $('tn').textContent = n; $('ts').textContent = s; }
  $('tstam').style.width = st == null ? '0%' : Math.round(st * 100) + '%';
  const end = S.half * 45 * 60, mc = Math.min(S.mclock, end), m = Math.floor(mc / 60), sec = Math.floor(mc % 60);
  $('clock').textContent = m + ':' + (sec < 10 ? '0' : '') + sec; $('added').textContent = S.mclock > end ? '+' + Math.ceil((S.mclock - end) / 60) : ''; $('added').hidden = S.mclock < end;
  wxChip(); $('score').textContent = S.score[0] + '-' + S.score[1];
}
const mkGroup = (el, defs, get, setv) => { el.innerHTML = ''; for (const [id, label] of defs) { const b = document.createElement('button'); b.textContent = label; b.setAttribute('aria-pressed', get() === id ? 'true' : 'false'); b.onclick = () => { setv(id); mkGroup(el, typeof defs === 'function' ? defs() : defs, get, setv); }; el.appendChild(b); } };
mkGroup($('cams'), CAMS, () => S.cam, (v) => { S.cam = v; controls.enabled = v === 'free'; if (v === 'free') controls.target.copy(camLook); S.follow = v === 'player' ? players.find((q) => q.ti === 0 && q.pos === 'ST') : null; });
mkGroup($('names'), [['all', 'All names'], ['ball', 'Ball only'], ['off', 'Names off']], () => S.names, (v) => { S.names = v; });
const playDefs = () => [['pause', S.paused ? 'Play' : 'Pause'], ['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×'], ['1.5', '1.5×'], ['2', '2×']];
const playSet = (v) => { if (v === 'pause') S.paused = !S.paused; else S.speed = +v; mkGroup($('play'), playDefs(), () => String(S.speed), playSet); };
mkGroup($('play'), playDefs(), () => String(S.speed), playSet);

// ============ MAIN LOOP ============
// ============ CONDENSED BROADCAST (DAT-10, ADR-0004) ============
// The engine simulates the whole match at full density; this director scores each passage of play from 0 to 1 and
// frame() plays passages scoring 0.5 or more live at the chosen speed and fast-forwards the rest at FF_X behind a wipe
// that shows the minute range. Every step still runs, so events, stats, agents and the Verifier see everything.
//   shot or goal 1.0 (5 s after a shot, through the celebration) · ball in a penalty area 0.4 (cut) · set piece near goal 0.6
//   · card 0.6 (6 s) · first 15 s of a half 0.5 · otherwise 0.1. Live status is held 2 s after the score drops.
const FF_X = 40;
const DIRC = { longest: {}, bySc: {}, ffX: FF_X, on: false, ff: false, liveS: 0, ffS: 0, hold: 0, score: 0.1, cardT: -99, cut: null, ranges: [], wipe: null };
onMatchEvent((e) => { if (e.type === 'yellow_card' || e.type === 'red_card') DIRC.cardT = S.t; });
function passageScore() {
  const si = S.shotInfo; if (si && S.t - si.t < 5) return 1;
  if (S.celebrate > 0) return 1;
  const near = (S.owner || { pos2: V2(ball.p.x, ball.p.z) }).pos2; const box = Math.min(near.x, 105 - near.x) < 16.5 && Math.abs(near.y - 34) < 20.16;
  if (box) return 0.4;
  const R = S.restart || S.dead; if (R && (R.type === 'corner' || R.type === 'penalty' || (R.type === 'freekick' && R.spot && Math.min(R.spot.x, 105 - R.spot.x) < 30))) return 0.6;
  if (S.t - DIRC.cardT < 6) return 0.6;
  const mc = S.mclock % (45 * 60); if (mc < 15) return 0.5;
  return 0.1;
}
const minuteOf = () => Math.floor(S.mclock / 60) + 1;
function dirUpdate(dt) {
  if (!DIRC.on) { DIRC.liveS += dt; return; }
  if (S.restart && (S.restart.age || 0) > (DIRC.longest.age || 0)) DIRC.longest = { type: S.restart.type, phase: S.restart.phase, age: +S.restart.age.toFixed(1), min: minuteOf() };
  DIRC.score = passageScore(); DIRC.bySc[DIRC.score] = (DIRC.bySc[DIRC.score] || 0) + dt;
  if (DIRC.score >= 0.5) DIRC.hold = 2; else DIRC.hold = Math.max(0, DIRC.hold - dt);
  const ff = DIRC.score < 0.5 && DIRC.hold <= 0;
  if (ff && !DIRC.ff) DIRC.cut = { from: minuteOf(), fromClock: S.mclock };
  if (!ff && DIRC.ff && DIRC.cut) { DIRC.ranges.push({ from: DIRC.cut.from, to: minuteOf(), seconds: +(S.mclock - DIRC.cut.fromClock).toFixed(1) }); DIRC.cut = null; }
  DIRC.ff = ff; if (ff) DIRC.ffS += dt; else DIRC.liveS += dt;
  if (DIRC.wipe) { DIRC.wipe.style.opacity = ff ? 1 : 0; if (ff && DIRC.cut) DIRC.wipe.textContent = '⏩ ' + DIRC.cut.from + "' → " + minuteOf() + "'"; }
}
function dirStart() {   // at kick-off: condense only full-length matches (half = 45), shorter halves are already compressed; the headless runner scores passages too, to report the watch length
  Object.assign(DIRC, { longest: {}, bySc: {}, on: SET.half >= 45 && new URLSearchParams(location.search).get('condense') !== '0', ff: false, liveS: 0, ffS: 0, hold: 0, ranges: [], cut: null });
  if (!DIRC.wipe) { const d = document.createElement('div'); d.id = 'ffwipe'; d.style.cssText = 'position:fixed;top:14%;left:50%;transform:translateX(-50%);padding:6px 18px;background:rgba(10,14,20,.78);color:#fff;font:700 20px system-ui;letter-spacing:.06em;border-radius:6px;opacity:0;transition:opacity .15s;pointer-events:none;z-index:9'; document.body.appendChild(d); DIRC.wipe = d; }
}
function stepSim(dt) {
  if (S.hold) { holdTick(dt); return; }
  S.clock += dt; S.t += dt; S.mclock += dt * S.mscale;
  matchClock(dt);
  if (S.celebrate > 0) { S.celebrate -= dt; if (S.celebrate <= 0) { S.focus = null; setRestart('kickoff', 1 - S.scorer.ti, V2(52.5, 34)); } }
  if (S.owner) STATS.poss[S.owner.ti] += dt;
  // brains (staggered)
  for (const p of players) {
    if (p === S.owner || p.off || p.act?.type === 'fall') continue;
    p.think -= dt; if (p.think <= 0) { p.think = 0.18 + rnd() * 0.22; think(p); }
  }
  restartFormation();
  if (S.owner) ownerControl(S.owner, dt);
  if (S.celebrate > 0) for (const p of players) { if (p === S.scorer) { const corner = V2(goalOf(p.ti).x === 105 ? 99 : 6, p.pos2.y < 34 ? 3 : 65); p.tgt.copy(corner); p.urg = p.act?.style === 'slide' && p.act.t > 1.8 ? 0.3 : 1; p.lookAt = null; } else if (p.ti === S.scorer.ti && !p.gk) { p.tgt.copy(S.scorer.pos2); p.urg = 0.95; p.lookAt = S.scorer.pos2; } else { p.urg = 0.3; } }
  keeperReact(dt);
  // action clocks run on simulation time so strikes land on the right frame at any playback speed
  for (const p of players) { const a = p.act; if (!a) continue; a.t += dt; const u = a.t / a.dur; if (a.type === 'slide' && u < 0.7) p.vel.multiplyScalar(Math.max(0, 1 - 1.6 * (1 - 0.45 * clamp(ENV.slick, 0, 1)) * dt)); if (a.type === 'stumble' || a.type === 'fall') p.vel.multiplyScalar(Math.max(0, 1 - 2.5 * dt)); if (u >= 1) p.act = null; }
  for (const p of players) { if (p.off) continue; if (p.kWarp) { p.kWarp = false; p.pos2.addScaledVector(p.vel, dt); } else if (p.act?.type === 'dive' || p.act?.type === 'slide') { p.pos2.addScaledVector(p.vel, dt); p.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt)); } else moveBody(p, dt); if (p.sad > 0) p.sad -= dt; if (p.shake > 0) p.shake -= dt; }
  // player separation and shoulder contact
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) { const a = players[i], c = players[j]; const d = a.pos2.distanceTo(c.pos2); if (d < 0.7 && d > 0) { const push = a.pos2.clone().sub(c.pos2).setLength((0.7 - d) * 0.5); a.pos2.add(push); c.pos2.sub(push); } }
  // ball
  if (S.dead) deadTick(dt);
  else if (S.restart) runRestart(dt);
  else {
    const steps = 4; for (let k = 0; k < steps; k++) ballPhysics(ball, dt / steps);
    contacts(dt); challenges(dt); refereeBall();
  }
  officiate(dt);
  verifierTick(dt);
  dirUpdate(dt);
}
const clk = new THREE.Clock();
let ledAcc = 0;
function loop() { frame(Math.min(clk.getDelta(), 0.05), true); }
function frame(dt, draw) {
  const sim = S.paused || window.__mcHeadless ? 0 : dt * S.speed; // the headless runner steps the engine itself, on a fixed step
  if (!S.started && sim > 0) S.t += sim;
  applyWorldVisuals(sim);
  if (S.started && !S.over && players.length && sim > 0) {
    if (DIRC.on) { let budget = sim, guard = 0; while (budget > 0 && !S.over && guard++ < 4000) { const st = Math.min(0.02, budget * (DIRC.ff ? FF_X : 1)); stepSim(st); budget -= DIRC.ff ? st / FF_X : st; } }   // fast-forward spends 1/FF_X of the frame's time per simulated second
    else { const n = Math.ceil(sim / 0.02); for (let i = 0; i < n; i++) stepSim(sim / n); }
  }
  for (const p of players) if (!p.off) animate(p, sim);
  // ball render: roll from displacement
  const bw = W(ball.p.x, ball.p.y, ball.p.z); const mv = bw.clone().sub(ballMesh.position); const hd = Math.hypot(mv.x, mv.z);
  if (hd > 1e-4 && hd < 5) ballMesh.rotateOnWorldAxis(new THREE.Vector3(mv.z, 0, -mv.x).normalize(), hd / BR);
  ballMesh.position.copy(bw);
  ledAcc += dt; if (ledAcc > 1 / 30) { drawLED(ledAcc * (S.paused ? 0 : 1)); ledAcc = 0; }
  if (fanMat.userData.sh) { fanMat.userData.sh.uniforms.uTime.value += dt; const hype = S.celebrate > 0 ? 1 : (S.shotInfo && S.t - S.shotInfo.t < 2 ? 0.6 : 0); fanMat.userData.sh.uniforms.uHype.value = lerp(fanMat.userData.sh.uniforms.uHype.value, hype, clamp(dt * 2, 0, 1)); }
  updateCamera(dt);
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  if (players.length) hud();
  if (draw) { composer.render(); labelRenderer.domElement.style.visibility = S.started ? 'visible' : 'hidden'; labelRenderer.render(scene, camera); }
}
function start() {
  setRestart('kickoff', 0, V2(52.5, 34));
  for (const p of players) { const k = own2w(p.ti, p.gk ? 4 : Math.min(p.slot.x * 0.85, 49.5), p.slot.y); p.pos2.copy(k); p.tgt.copy(k); p.lookAt = V2(52.5, 34); }
  const tk = S.restart.taker; tk.pos2.copy(V2(52.5 - 0.6, 34));
  openSetup();
  $('kick').onclick = kickOff;
  renderer.setAnimationLoop(loop);
}
window.__mc = { DIRC, STADIUMS, climateOf, ENV, initEnv, updateEnv, SET: () => SET, kickOff, openSetup, S, players, officials, ball, stepSim, STATS, animate, frame, camera, scene, composer, BODY };

/*@@SETUP@@*/
// ============ LOAD ============
const loader = new GLTFLoader();
const fail = (err) => { $('load').firstElementChild.textContent = 'COULD NOT LOAD PLAYER MODEL'; console.error(err); };
function glbFrom(pack) {
  const bin = Uint8Array.from(atob(pack.bin), (c) => c.charCodeAt(0));
  const js = new TextEncoder().encode(JSON.stringify(pack.gltf)); const jp = (4 - js.length % 4) % 4; const bp = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + js.length + jp + 8 + bin.length + bp; const buf = new ArrayBuffer(total); const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jp, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(js, 20); u8.fill(0x20, 20 + js.length, 20 + js.length + jp);
  const o = 20 + js.length + jp; dv.setUint32(o, bin.length + bp, true); dv.setUint32(o + 4, 0x004E4942, true); u8.set(bin, o + 8);
  return buf;
}
new THREE.FileLoader().setResponseType('json').load('./players.json', (packs) => {
  Promise.all(Object.entries(packs).map(([v, pk]) => new Promise((res, rej) => loader.parse(glbFrom(pk), './', (g) => res([v, g]), rej))))
    .then((list) => { buildPeople(Object.fromEntries(list)); $('load').hidden = true; start(); }).catch(fail);
}, (e) => { if (e.total) $('loadbar').style.width = Math.round(e.loaded / e.total * 100) + '%'; }, fail);

addEventListener('resize', () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h); composer.setSize(w, h); labelRenderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
