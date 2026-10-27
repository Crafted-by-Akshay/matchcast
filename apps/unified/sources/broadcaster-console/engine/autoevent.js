// ============ AUTO-EVENTING (v9): computer vision over the broadcast picture ============
// A tracker that sees only PIXELS. Every 0.2 s the broadcast camera's view is rendered small (640x360) and read back; from
// those pixels alone it finds players, officials and the ball by kit colour, places them on the pitch through the camera
// calibration, tracks them, works out who is who from how they look, and derives speeds, possession and passes.
// The camera matrix stands in for the calibration a real system solves from the pitch lines each frame. The engine's own
// player and ball positions are read ONLY by the scorer (visEval) that grades the tracker against ground truth.
//<core>
// ---- vision core: pure functions over an RGBA buffer and a pinhole camera; no engine state ----
const VC = {};
VC.lut = Uint8Array.from({ length: 256 }, (_, i) => Math.round(255 * DM.pow(i / 255, 1 / 2.2)));   // linear render target -> display gamma
// camera model from the calibration: a ray for each pixel and a projection back into the image
VC.camera = (mw, pmi, pm, mwi, W, H) => {
  const ap = (m, x, y, z, w) => [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w];
  const nv = (x, y) => { const q = ap(pmi, x, y, -1, 1); return [q[0] / q[3], q[1] / q[3], q[2] / q[3]]; };
  const rotv = (v) => [mw[0] * v[0] + mw[4] * v[1] + mw[8] * v[2], mw[1] * v[0] + mw[5] * v[1] + mw[9] * v[2], mw[2] * v[0] + mw[6] * v[1] + mw[10] * v[2]];
  const n0 = nv(0, 0), n1 = nv(1, 0), n2 = nv(0, 1);
  const C = rotv(n0), A = rotv([n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]]), B = rotv([n2[0] - n0[0], n2[1] - n0[1], n2[2] - n0[2]]);
  const P = [mw[12], mw[13], mw[14]];
  const cam = { W, H, P, A, B, C };
  // pixel (u,v), top-left origin -> point on the horizontal plane at height h, in pitch metres (x along, y across)
  cam.ground = (u, v, h) => { const x = (u + 0.5) / W * 2 - 1, y = 1 - (v + 0.5) / H * 2; const dx = A[0] * x + B[0] * y + C[0], dy = A[1] * x + B[1] * y + C[1], dz = A[2] * x + B[2] * y + C[2];
    if (dy > -1e-6 && P[1] > h) return null; const t = (h - P[1]) / dy; if (t <= 0) return null; return [P[0] + dx * t + 52.5, P[2] + dz * t + 34]; };
  // pitch point (x,y) at height h -> pixel
  cam.proj = (x, y, h) => { const v = ap(mwi, x - 52.5, h, y - 34, 1); const c = ap(pm, v[0], v[1], v[2], 1); if (c[3] <= 0) return null; return [(c[0] / c[3] + 1) / 2 * W, (1 - c[1] / c[3]) / 2 * H]; };
  // how many pixels tall a 1.8 m person standing at (x,y) appears
  cam.pxH = (x, y) => { const a = cam.proj(x, y, 0), b = cam.proj(x, y, 1.8); return a && b ? DM.hypot(a[0] - b[0], a[1] - b[1]) : 0; };
  return cam;
};
// colour classes: 0 grass/background, 1 home shirt, 2 away shirt, 3 home GK, 4 away GK, 5 black (referee kit, dark shorts),
// 6 white (ball, lines, white shorts), 7 yellow (assistant referees' shirts, yellow boots; not tracked), 8 other foreground (skin, hair, boots, shorts), 9 off the field
VC.NCLS = 10;
const hueOf = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 1) return 0; let h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d; h *= 60; return h < 0 ? h + 360 : h; };
const hueD = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
VC.hsv = (hex) => { const r = hex >> 16 & 255, g = hex >> 8 & 255, b = hex & 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return [hueOf(r, g, b), mx ? (mx - mn) / mx : 0, mx / 255]; };
// per-frame classification. refs: kit hues from the published palettes. Grass is learned from the frame itself (median of on-field pixels).
VC.classify = (buf, cam, refs, out) => {
  const { W, H, P, A, B, C } = cam, L = VC.lut, N = W * H; const cls = out && out.length === N ? out : new Uint8Array(N);
  // where each pixel's ray meets the ground: 2 = on the pitch (2.5 m margin), 1 = up to 12 m outside (boards, run-off), 0 = stands and sky
  if (!VC.zone || VC.zone.length !== N) VC.zone = new Uint8Array(N); const zone = VC.zone; zone.fill(0);
  for (let v = 0; v < H; v++) { const y = 1 - (v + 0.5) / H * 2; for (let u = 0; u < W; u++) { const x = (u + 0.5) / W * 2 - 1; const dy = A[1] * x + B[1] * y + C[1]; if (dy >= -1e-6) continue; const t = -P[1] / dy;
    const gx = P[0] + (A[0] * x + B[0] * y + C[0]) * t + 52.5, gy = P[2] + (A[2] * x + B[2] * y + C[2]) * t + 34;
    zone[v * W + u] = gx > -2.5 && gx < 107.5 && gy > -2.5 && gy < 70.5 ? 2 : gx > -12 && gx < 117 && gy > -12 && gy < 80 ? 1 : 0; } }
  // grass statistics (median hue, saturation, brightness) in horizontal bands: fog and rain thicken with distance, i.e. up the frame
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }; const BH = 24, nb = Math.ceil(H / BH), band = [];
  for (let bi = 0; bi < nb; bi++) { const hs = [], ss = [], vs = [];
    for (let v = bi * BH + 2; v < Math.min(H, bi * BH + BH); v += 4) for (let u = 2; u < W; u += 5) { if (zone[v * W + u] !== 2) continue; const q = ((H - 1 - v) * W + u) * 4; const r = L[buf[q]], g = L[buf[q + 1]], b = L[buf[q + 2]]; const mx = Math.max(r, g, b); const hh = hueOf(r, g, b); if (hueD(hh, 140) > 40) continue; hs.push(hh); ss.push(mx ? (mx - Math.min(r, g, b)) / mx : 0); vs.push(mx); }
    band.push(hs.length > 12 ? [med(hs), med(ss), med(vs)] : null); }
  // bands with no visible grass borrow from the nearest band that has some
  for (let bi = 0; bi < nb; bi++) if (!band[bi]) { for (let d = 1; d < nb; d++) { const x = band[bi + d] || band[bi - d]; if (x) { band[bi] = x; break; } } if (!band[bi]) band[bi] = [137, 0.49, 87]; }
  for (let v = 0; v < H; v++) {
    // rain, fog and floodlights wash colours out; the grass tells us by how much (0.49 = turf saturation in clear daylight)
    const row = (H - 1 - v) * W, bd0 = band[Math.min(nb - 1, (v / BH) | 0)], gH = bd0[0], gS = bd0[1], gV = bd0[2];
    const k = Math.max(0.4, Math.min(1.15, gS / 0.49)), blackV = 0.55 + (1 - k) * 0.45;
    for (let u = 0; u < W; u++) {
      const o = v * W + u; if (!zone[o]) { cls[o] = 9; continue; }
      const q = (row + u) * 4; const r = L[buf[q]], g = L[buf[q + 1]], b = L[buf[q + 2]];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b), dd = mx - mn; const s = mx ? dd / mx : 0; const vr = mx / gV;
      if (s < 0.22 && vr > 1.45) { cls[o] = 6; continue; }                              // white: ball, lines, white shorts and boots
      let h = 0; if (dd > 0) { h = mx === r ? (g - b) / dd : mx === g ? 2 + (b - r) / dd : 4 + (r - g) / dd; h *= 60; if (h < 0) h += 360; }
      let c = 0; const dg = h > gH ? h - gH : gH - h;
      if (dg < 24 && s > gS * 0.55 && vr > 0.45 && vr < 1.55) c = 0;                    // grass, lit or in shadow
      else if (vr < blackV && s < 0.4) c = 5;                                            // black: referee, dark shorts and boots, hair
      else if (s > 0.15 * k) {
        let best = 8, bd = 1e9;
        for (const [ci, rh, rs, rv] of refs) { const dh = hueD(h, rh); if (dh > 22 || s < rs * k || vr < rv) continue; if (dh < bd) { bd = dh; best = ci; } }
        c = best;
      } else c = 8;
      cls[o] = c;
    }
  }
  // perimeter boards sit just outside the lines and show club colours. Off-pitch pixels only count when they stack on top of
  // something standing on the pitch (a player near the touchline seen against the boards), so sweep each column upwards.
  for (let v = H - 2; v >= 0; v--) for (let u = 0; u < W; u++) { const o = v * W + u; if (zone[o] !== 1 || cls[o] === 9) continue; const c = cls[o];
    if (c === 0) { cls[o] = 9; continue; } const d = cls[o + W]; if (d === 0 || d === 9) cls[o] = 9; }
  return { cls, band, zone };
};
// connected components (4-connected) of the classes in set; each comp keeps its pixel list, bbox and class
VC.components = (cls, W, H, want) => {
  const N = W * H, lab = new Int32Array(N).fill(-1), comps = []; const st = new Int32Array(N);
  for (let o = 0; o < N; o++) {
    const c = cls[o]; if (!want[c] || lab[o] >= 0) continue;
    const id = comps.length; const px = []; let u0 = 1e9, u1 = -1, v0 = 1e9, v1 = -1; let sp = 0; st[sp++] = o; lab[o] = id;
    while (sp) { const q = st[--sp]; px.push(q); const u = q % W, v = (q / W) | 0; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      if (u > 0 && lab[q - 1] < 0 && cls[q - 1] === c) { lab[q - 1] = id; st[sp++] = q - 1; } if (u < W - 1 && lab[q + 1] < 0 && cls[q + 1] === c) { lab[q + 1] = id; st[sp++] = q + 1; }
      if (v > 0 && lab[q - W] < 0 && cls[q - W] === c) { lab[q - W] = id; st[sp++] = q - W; } if (v < H - 1 && lab[q + W] < 0 && cls[q + W] === c) { lab[q + W] = id; st[sp++] = q + W; } }
    comps.push({ c, px, u0, u1, v0, v1, n: px.length });
  }
  return { comps, lab };
};
// distance (m) from a pitch point to the nearest painted line: the line model a real system calibrates against
VC.lineDist = (x, y) => {
  const seg = (x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy))); return DM.hypot(x - x0 - t * dx, y - y0 - t * dy); };
  const arc = (cx, cy, r, inside) => { const d = DM.hypot(x - cx, y - cy); return inside && !inside() ? 1e9 : Math.abs(d - r); };
  let d = Math.min(seg(0, 0, 105, 0), seg(0, 68, 105, 68), seg(0, 0, 0, 68), seg(105, 0, 105, 68), seg(52.5, 0, 52.5, 68), arc(52.5, 34, 9.15), DM.hypot(x - 52.5, y - 34) - 0.2);
  for (const [g, s] of [[0, 1], [105, -1]]) d = Math.min(d, seg(g, 13.84, g + s * 16.5, 13.84), seg(g, 54.16, g + s * 16.5, 54.16), seg(g + s * 16.5, 13.84, g + s * 16.5, 54.16), seg(g, 24.84, g + s * 5.5, 24.84), seg(g, 43.16, g + s * 5.5, 43.16), seg(g + s * 5.5, 24.84, g + s * 5.5, 43.16),
    arc(g + s * 11, 34, 9.15, () => s * (x - g) > 16.5), DM.hypot(x - g - s * 11, y - 34) - 0.2, arc(g, 0, 1), arc(g, 68, 1));
  return d;
};
// ---- detection: kit-colour blobs -> people standing on the pitch, white specks -> ball candidates ----
// People are found by their shirts (home, away, both goalkeepers) and the referee by an all-black
// kit. Blob sizes are judged against how big a 1.8 m person looks at that spot, which the camera calibration tells us.
VC.KIT = [0, 1, 1, 1, 1, 0, 0, 0, 0, 0];
VC.detect = (cls, cam, buf) => {
  const { W, H } = cam; const fg = (o) => { const c = cls[o]; return c !== 0 && c !== 9; };
  const { comps } = VC.components(cls, W, H, [0, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  // scale at a blob: assume its lower edge sits at height h0 above the grass
  const scaleAt = (u, v, h0) => { const g = cam.ground(u, v, h0); if (!g) return null; const hp = cam.pxH(g[0], g[1]); return hp > 0.5 ? { g, hp } : null; };
  const shirts = comps.filter((c) => VC.KIT[c.c]);
  // shirt fragments (a number on the back, a shaded arm) merge back into one shirt when they are close and stay person-sized
  for (const c of shirts) { const s = scaleAt((c.u0 + c.u1) / 2, c.v1 + 0.5, 0.95); c.hp = s ? s.hp : 0; }
  let merged = true; while (merged) { merged = false;
    for (let i = 0; i < shirts.length && !merged; i++) for (let j = i + 1; j < shirts.length && !merged; j++) { const a = shirts[i], b = shirts[j]; if (a.c !== b.c || !a.hp) continue;
      const gu = Math.max(a.u0, b.u0) - Math.min(a.u1, b.u1), gv = Math.max(a.v0, b.v0) - Math.min(a.v1, b.v1); if (gu > 2 || gv > 2) continue;
      const w = Math.max(a.u1, b.u1) - Math.min(a.u0, b.u0) + 1, h = Math.max(a.v1, b.v1) - Math.min(a.v0, b.v0) + 1; if (w > a.hp * 0.36 + 2 || h > a.hp * 0.36 + 2) continue;
      a.px = a.px.concat(b.px); a.n += b.n; a.u0 = Math.min(a.u0, b.u0); a.u1 = Math.max(a.u1, b.u1); a.v0 = Math.min(a.v0, b.v0); a.v1 = Math.max(a.v1, b.v1); shirts.splice(j, 1); merged = true; } }
  const people = [];
  // two team-mates overlapping on screen make one wide or tall blob: split it with k-means on pixel positions
  const parts = [];
  for (const c of shirts) {
    if (!c.hp) continue; const ew = c.hp * 0.2 + 1, eh = c.hp * 0.26 + 1; const w = c.u1 - c.u0 + 1, h = c.v1 - c.v0 + 1;
    const nw = Math.max(1, Math.round(w / (ew * 1.25))), nh = Math.max(1, Math.round(h / (eh * 1.3))); const k = Math.min(4, nw * nh);
    if (k <= 1 || c.n < 6) { parts.push(c); continue; }
    const cen = []; for (let a = 0; a < nw; a++) for (let b = 0; b < nh && cen.length < k; b++) cen.push([c.u0 + (a + 0.5) * w / nw, c.v0 + (b + 0.5) * h / nh]);
    let asg = new Int32Array(c.n);
    for (let it = 0; it < 6; it++) { const sm = cen.map(() => [0, 0, 0]);
      for (let i = 0; i < c.n; i++) { const q = c.px[i], u = q % W, v = (q / W) | 0; let bi = 0, bd = 1e9; for (let j = 0; j < cen.length; j++) { const d = DM.sq(u - cen[j][0]) + DM.sq(v - cen[j][1]); if (d < bd) { bd = d; bi = j; } } asg[i] = bi; sm[bi][0] += u; sm[bi][1] += v; sm[bi][2]++; }
      for (let j = 0; j < cen.length; j++) if (sm[j][2]) cen[j] = [sm[j][0] / sm[j][2], sm[j][1] / sm[j][2]]; }
    for (let j = 0; j < cen.length; j++) { const px = []; let u0 = 1e9, u1 = -1, v0 = 1e9, v1 = -1; for (let i = 0; i < c.n; i++) if (asg[i] === j) { const q = c.px[i], u = q % W, v = (q / W) | 0; px.push(q); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      if (px.length) parts.push({ c: c.c, px, n: px.length, u0, u1, v0, v1, hp: c.hp, split: k }); }
  }
  for (const c of parts) {
    const sc = scaleAt((c.u0 + c.u1) / 2, c.v1 + 0.5, 0.95); if (!sc) continue; const hp = sc.hp;
    if (c.n < Math.max(2, hp * hp * 0.012)) continue;                       // too small for a shirt at this distance: noise
    // feet: scan down from the shirt through legs, socks and boots until the grass shows again
    let su = 0; for (const q of c.px) su += q % W; const cu = su / c.n; const a0 = Math.max(0, Math.floor(c.u0 - 1)), a1 = Math.min(W - 1, Math.ceil(c.u1 + 1));
    const lim = Math.min(H - 1, Math.round(c.v1 + hp * 0.75)); let fv = c.v1, gap = 0;
    for (let v = c.v1 + 1; v <= lim; v++) { let any = false; for (let u = a0; u <= a1; u++) if (fg(v * W + u)) { any = true; break; } if (any) { fv = v; gap = 0; } else if (++gap > 1) break; }
    const legs = fv - c.v1; const footV = legs >= hp * 0.3 ? fv + 1 : c.v1 + hp * 0.53;
    // head: scan up from the shirt for skin and hair
    let tv = c.v0, gp = 0; for (let v = c.v0 - 1; v >= Math.max(0, c.v0 - hp * 0.35); v--) { let any = false; for (let u = a0 + 1; u <= a1 - 1; u++) if (fg(v * W + u)) { any = true; break; } if (any) { tv = v; gp = 0; } else if (++gp > 1) break; }
    const g = cam.ground(cu, footV, 0); if (!g) continue;
    people.push({ cls: c.c, u: cu, v: footV, x: g[0], y: g[1], top: tv, sv0: c.v0, sv1: c.v1, u0: c.u0, u1: c.u1, hp: cam.pxH(g[0], g[1]), legs: legs >= hp * 0.3, n: c.n, split: c.split || 1 });
  }
  // socks are kit-coloured too: a small blob just under a bigger same-colour shirt is that player's lower legs
  for (let i = people.length - 1; i >= 0; i--) { const c = people[i]; if (people.some((p) => p !== c && p.cls === c.cls && p.n >= c.n && c.u0 <= p.u1 + 2 && c.u1 >= p.u0 - 2 && c.sv0 > p.sv1 && c.sv0 - p.sv1 < p.hp * 0.62)) people.splice(i, 1); }
  // referee: an all-black kit, big like a shirt (away and goalkeeper shorts are black too, but sit right under a shirt; hair is tiny)
  const ns = people.map((p) => p.n).sort((a, b) => a - b), medN = ns.length ? ns[ns.length >> 1] : 4;
  for (const c of comps) { if (c.c !== 5 || c.n < Math.max(3, medN * 0.6)) continue; const sc = scaleAt((c.u0 + c.u1) / 2, c.v1 + 0.5, 0.1); if (!sc) continue; const hp = sc.hp; const h = c.v1 - c.v0 + 1;
    if ((hp > 9 && h < hp * 0.5) || h > hp * 1.15 + 2 || c.u1 - c.u0 + 1 > hp * 0.45 + 3) continue;
    let under = false; for (const p of people) if (c.u1 >= p.u0 - 1 && c.u0 <= p.u1 + 1 && c.v0 >= p.sv0 && c.v0 <= p.sv1 + 3) under = true; if (under) continue;
    let su = 0; for (const q of c.px) su += q % W; const cu = su / c.n; const fv = hp > 9 ? c.v1 + 1 + hp * 0.04 : c.v1 + 1; const g = cam.ground(cu, fv, 0); if (!g || g[0] < 0.5 || g[0] > 104.5 || g[1] < 0.5 || g[1] > 67.5) continue;
    people.push({ cls: 5, u: cu, v: fv, x: g[0], y: g[1], top: c.v0 - hp * 0.12, sv0: c.v0, sv1: c.v1, u0: c.u0, u1: c.u1, hp, n: c.n, split: 1 }); }
  // one person per spot: kit-coloured boots and socks near a player are part of him (players never stand closer than 0.7 m)
  people.sort((a, b) => b.n - a.n);
  for (let i = people.length - 1; i >= 0; i--) { const c = people[i]; for (let j = 0; j < i; j++) { const p = people[j]; const d = DM.hypot(p.x - c.x, p.y - c.y); if ((p.cls === c.cls && d < 0.75) || (d < 0.6 && c.n < p.n * 0.45)) { people.splice(i, 1); break; } } }
  // a black blob right next to a player is his shorts or hair seen from above, not the referee
  for (let i = people.length - 1; i >= 0; i--) { const c = people[i]; if (c.cls === 5 && people.some((p) => p.cls !== 5 && DM.hypot(p.x - c.x, p.y - c.y) < 0.9)) people.splice(i, 1); }
  // only people standing on the field of play (and its run-off) count; the boards and benches are outside
  const ppl = people.filter((p) => p.x > -3 && p.x < 108 && p.y > -3 && p.y < 71);
  // ball candidates: small, round-ish white specks that are not shorts or boots of someone, and not a stretch of line or rain
  const balls = [];
  for (const c of comps) { if (c.c !== 6) continue; const w = c.u1 - c.u0 + 1, h = c.v1 - c.v0 + 1; let su = 0, sv = 0; for (const q of c.px) { su += q % W; sv += (q / W) | 0; } const u = su / c.n, v = sv / c.n;
    const g = cam.ground(u, v + 0.5, 0.11); if (!g || g[0] < -3 || g[0] > 108 || g[1] < -3 || g[1] > 71) continue; const hp = cam.pxH(g[0], g[1]);
    const d = Math.max(1, hp * 0.22 / 1.8);
    // a speck of painted line (or a spot): within about two pixels of the line model, measured along the ground in depth
    const g2 = cam.ground(u, v + 1.5, 0.11); const mpp = g2 ? DM.hypot(g2[0] - g[0], g2[1] - g[1]) : 0.3; if (VC.lineDist(g[0], g[1]) < 0.2 + 1.6 * mpp) continue;
    if (g[0] < -0.3 || g[0] > 105.3 || ((g[0] < 1.2 || g[0] > 103.8) && g[1] > 29 && g[1] < 39) || ((g[0] < 1.5 || g[0] > 103.5) && (g[1] < 1.5 || g[1] > 66.5))) continue;   // goal frames, nets and corner flags
    if (w > d * 2 + 2 || h > d * 2 + 2 || c.n > (d + 2) * (d + 2) * 1.3 || Math.max(w, h) > 2.6 * Math.min(w, h) + 1) continue;
    // inside a player's silhouette and above his ankles: white shorts or socks, not the ball
    let body = false; for (const p of ppl) if (u >= p.u0 - 2 && u <= p.u1 + 2 && v >= p.top && v < p.v - p.hp * 0.12) body = true; if (body) continue;
    // brightness: a lit ball is the brightest thing on the grass; rain streaks and line specks are greyer
    let vm = 0; if (buf) for (const q of c.px) { const k = ((H - 1 - ((q / W) | 0)) * W + q % W) * 4; vm = Math.max(vm, VC.lut[buf[k]], VC.lut[buf[k + 1]], VC.lut[buf[k + 2]]); }
    let dn = 1e9; for (const p of ppl) dn = Math.min(dn, DM.hypot(p.x - g[0], p.y - g[1]));
    // isolation: share of the ring of pixels around the speck that is grass. A ball rolls free; a white boot or sock is joined to a leg
    let ring = 0, rg = 0; for (let v = c.v0 - 1; v <= c.v1 + 1; v++) for (let u = c.u0 - 1; u <= c.u1 + 1; u++) { if (v < 0 || u < 0 || v >= H || u >= W || (v >= c.v0 && v <= c.v1 && u >= c.u0 && u <= c.u1)) continue; ring++; const k = cls[v * W + u]; if (k === 0) rg++; }
    const iso = ring ? rg / ring : 0;
    balls.push({ u, v, x: g[0], y: g[1], n: c.n, d, w, h, vm, dn, iso }); }
  return { people: ppl, balls };
};
// appearance of one detected person, measured from pixels: apparent height (m), and the colour of head (skin), hair and boots.
// Colours are divided by the local grass brightness so floodlights and cloud do not change a player's signature.
VC.features = (buf, cls, cam, p, band) => {
  const { W, H } = cam, L = VC.lut; const gV = band[Math.min(band.length - 1, (p.v / 24) | 0)][2] || 87;
  const f = { h: p.legs && p.hp > 9 ? (p.v - p.top) / p.hp * 1.8 : 0, q: Math.max(0, Math.min(1, (p.hp - 9) / 14)) };
  const mean = (v0, v1, want) => { let r = 0, g = 0, b = 0, n = 0; for (let v = Math.max(0, Math.round(v0)); v <= Math.min(H - 1, Math.round(v1)); v++) for (let u = Math.max(0, Math.floor(p.u0) - 1); u <= Math.min(W - 1, Math.ceil(p.u1) + 1); u++) { const o = v * W + u; if (!want(cls[o])) continue; const q = ((H - 1 - v) * W + u) * 4; r += L[buf[q]]; g += L[buf[q + 1]]; b += L[buf[q + 2]]; n++; } return n ? [r / n / gV, g / n / gV, b / n / gV, n] : null; };
  if (f.q > 0) { f.hair = mean(p.top, p.top + 0.6, (c) => c !== 0 && c !== 9); f.skin = mean(p.top + 1, p.sv0 - 1, (c) => c === 8 || c === 6); f.boot = p.legs ? mean(p.v - 1 - p.hp * 0.04, p.v - 1, (c) => c !== 0 && c !== 9) : null; }
  return f;
};
// Hungarian assignment (rows to columns, minimum total cost); returns the column for each row
VC.hungarian = (C) => {
  const n = C.length, m = C[0] ? C[0].length : 0, N = Math.max(n, m), INF = 1e9; const a = (i, j) => (i < n && j < m ? C[i][j] : 0);
  const u = new Float64Array(N + 1), v = new Float64Array(N + 1), p = new Int32Array(N + 1), way = new Int32Array(N + 1);
  for (let i = 1; i <= N; i++) { p[0] = i; let j0 = 0; const minv = new Float64Array(N + 1).fill(INF), used = new Uint8Array(N + 1);
    do { used[j0] = 1; const i0 = p[j0]; let d = INF, j1 = 0; for (let j = 1; j <= N; j++) if (!used[j]) { const cur = a(i0 - 1, j - 1) - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < d) { d = minv[j]; j1 = j; } }
      for (let j = 0; j <= N; j++) if (used[j]) { u[p[j]] += d; v[j] -= d; } else minv[j] -= d; j0 = j1; } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0); }
  const r = new Array(n).fill(-1); for (let j = 1; j <= N; j++) if (p[j] - 1 < n && j - 1 < m) r[p[j] - 1] = j - 1; return r;
};
//</core>

// ============ the live pipeline: capture -> classify -> detect -> track -> identify -> auto-events, plus the scorer ============
const VIS = { on: false, boxes: true, period: 0.2, acc: 0, job: null, sc: 1, rt: null, buf: null, cls: null, W: 640, H: 360, t: 0,
  tracks: [], nextId: 1, ball: null, gal: [], last: [], poss: null, pend: null, passes: [], pstat: [], ev: null, win: null, cost: null, gtPass: [], gtPend: null, lastOwner: null, nextAcc: 60, nextChk: 10 };
const hexHue = (h) => VC.hsv(h)[0];
// kit hues from the published palettes; minimum saturation and brightness were tuned so skin never reads as an orange shirt
const visRefs = () => [[1, hexHue(TEAMS[0].kit), 0.5, 0.5], [2, hexHue(TEAMS[1].kit), 0.66, 0.9], [3, hexHue(TEAMS[0].gkKit), 0.35, 0.9], [4, hexHue(TEAMS[1].gkKit), 0.25, 0.8]];
const clsOf = (p) => p.gk ? 3 + p.ti : 1 + p.ti;
function visReset() {
  VIS.tracks = []; VIS.ball = null; VIS.hyps = []; VIS.prevBalls = []; VIS.poss = null; VIS.pend = null; VIS.passes = []; VIS.job = null; VIS.acc = 0; VIS.t = S.t; VIS.gtPass = []; VIS.gtPend = null; VIS.lastOwner = S.owner;
  VIS.last = players.map(() => null); VIS.pstat = players.map(() => ({ dist: 0, top: 0, n: 0 }));
  // signature gallery: the team sheet gives each player's height; colours are learned from pixels once the tracker knows who is who
  VIS.gal = players.map((p) => ({ h: TEAMS[p.ti].players[p.i][5], hw: 3, hair: null, hairW: 0, skin: null, skinW: 0, boot: null, bootW: 0 }));
  VIS.ev = visZero(); VIS.win = visZero(); VIS.cost = { cap: 0, cls: 0, det: 0, n: 0, t0: performance.now() }; VIS.nextAcc = S.t + 60; VIS.nextChk = S.t + 10;
}
const visZero = () => ({ gt: 0, det: 0, tp: 0, se: 0, idN: 0, idOK: 0, idUnk: 0, sw: 0, spN: 0, spE: 0, bIn: 0, bHit: 0, bSe: 0, bSpN: 0, bSpE: 0, prev: new Map() });
// ---- 1. capture: the broadcast camera's current view rendered small into an off-screen target and read back ----
function visCapture(sc) {
  const a = camera.aspect, L = Math.round(640 * (sc || 1)); const W = a >= 1 ? L : Math.round(L * a), H = a >= 1 ? Math.round(L / a) : L;
  if (!VIS.rt || VIS.W !== W || VIS.H !== H) { VIS.rt && VIS.rt.dispose(); VIS.rt = new THREE.WebGLRenderTarget(W, H); VIS.W = W; VIS.H = H; VIS.buf = new Uint8Array(W * H * 4); VIS.cls = null; }
  // reuse this frame's shadow map unless nothing has been drawn since the last capture (headless stepping)
  const au = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = !VIS.drawn; VIS.drawn = false;
  renderer.setRenderTarget(VIS.rt); renderer.render(scene, camera); renderer.readRenderTargetPixels(VIS.rt, 0, 0, W, H, VIS.buf); renderer.setRenderTarget(null); renderer.shadowMap.autoUpdate = au;
  return VIS.buf;
}
function visCam(J) { camera.updateMatrixWorld(); const M = { mw: camera.matrixWorld.elements.slice(), pmi: camera.projectionMatrixInverse.elements.slice(), pm: camera.projectionMatrix.elements.slice(), mwi: camera.matrixWorldInverse.elements.slice() }; if (J) J.camM = M; return VC.camera(M.mw, M.pmi, M.pm, M.mwi, VIS.W, VIS.H); }
// ground truth at the instant of capture, for the scorer only
function visTruth() { return { ppl: players.map((p) => ({ i: p.i, ti: p.ti, x: p.pos2.x, y: p.pos2.y, sp: p.vel.length(), cls: clsOf(p), off: p.off })).concat(officials.filter((o) => o.role === 'ref').map((o) => ({ i: -1, x: o.pos2.x, y: o.pos2.y, sp: 0, cls: 5 }))),
  ball: { x: ball.p.x, y: ball.p.z, h: ball.p.y, sp: DM.hypot(ball.v.x, ball.v.z) } }; }
// one job per capture, spread over three frames so no single frame pays for all of it
function visStep() {
  const J = VIS.job; const t0 = performance.now();
  if (J.stage === 0) {
    // capture resolution adapts to how big people look: tiny figures on the tactical camera get more pixels
    let sc = 1; { const c1 = VC.camera(camera.matrixWorld.elements, camera.projectionMatrixInverse.elements, camera.projectionMatrix.elements, camera.matrixWorldInverse.elements, 640, 360); const g = c1.ground(320, 200, 0); const hp = g ? c1.pxH(g[0], g[1]) : 20; sc = clamp(9 / Math.max(hp, 1), 1, 1.75); }
    VIS.sc = Math.round(sc * 4) / 4; visCapture(VIS.sc); J.cam = visCam(J); J.truth = visTruth(); J.t = S.t; J.ko = !!(S.restart && S.restart.type === 'kickoff'); J.stage = 1; VIS.cost.cap += performance.now() - t0;
  } else if (J.stage === 1) {
    const r = VC.classify(VIS.buf, J.cam, visRefs(), VIS.cls); VIS.cls = r.cls; J.band = r.band; J.stage = 2; VIS.cost.cls += performance.now() - t0;
  } else {
    const det = VC.detect(VIS.cls, J.cam, VIS.buf); for (const p of det.people) p.f = VC.features(VIS.buf, VIS.cls, J.cam, p, J.band);
    J.det = det; visTrack(J); visIdentify(J); visBall(J); visEvents(J); visEval(J); VIS.job = null; VIS.cost.det += performance.now() - t0; VIS.cost.n++; VIS.lastJ = J;
    if (VIS.rec) VIS.rec.push({ t: J.t, ko: J.ko, flip: S.flip || 0, cam: ['mw', 'pmi', 'pm', 'mwi'].map((k) => Array.from(J.camM[k])), W: VIS.W, H: VIS.H, det: J.det, truth: J.truth, owner: S.owner ? players.indexOf(S.owner) : -1, slots: J.ko ? players.map((p) => [p.slot.x, p.slot.y]) : null });
    if ($('visp') && !$('visp').hidden) visPanel();
  }
}
// ---- 4. tracking: constant-velocity alpha-beta filters, greedy association inside a gate, birth and death ----
function visTrack(J) {
  const t = J.t, dt = Math.max(0.05, t - VIS.t); VIS.t = t; const D = J.det.people;
  for (const k of VIS.tracks) { k.x += k.vx * dt; k.y += k.vy * dt; if (k.missT > 0.6) { k.vx *= 0.7; k.vy *= 0.7; } const s = J.cam.proj(k.x, k.y, 0); k.inView = !!s && s[0] > 2 && s[0] < VIS.W - 2 && s[1] > 2 && s[1] < VIS.H + 4; }
  const pairs = []; for (const k of VIS.tracks) for (let j = 0; j < D.length; j++) { if (D[j].cls !== k.cls) continue; const d = DM.hypot(D[j].x - k.x, D[j].y - k.y); if (d < VID.gate + VID.gv * dt + Math.min(8, 7 * k.missT)) pairs.push([d - Math.min(k.hits, 10) * 0.02 - (k.missT > 0 ? VID.rb : 0), k, j]); }
  pairs.sort((a, b) => a[0] - b[0]); const usedK = new Set(), usedD = new Set();
  for (const [, k, j] of pairs) { if (usedK.has(k) || usedD.has(j)) continue; usedK.add(k); usedD.add(j); const z = D[j];
    const rx = z.x - k.x, ry = z.y - k.y, re = k.missT > 0.3; const al = re ? 1 : 0.55, be = re ? 0 : 0.16;
    k.x += al * rx; k.y += al * ry; if (re) { k.vx = 0; k.vy = 0; } else { k.vx += be * rx / dt; k.vy += be * ry / dt; } const sp = DM.hypot(k.vx, k.vy); if (sp > 10.5) { k.vx *= 10.5 / sp; k.vy *= 10.5 / sp; }
    k.hits++; k.miss = 0; k.missT = 0; k.seen = t; k.det = z; visSig(k.sig, z.f, 1); visSpeed(k, t, z); }
  for (const k of VIS.tracks) if (!usedK.has(k)) { k.miss++; k.missT += dt; k.det = null; }
  VIS.tracks = VIS.tracks.filter((k) => k.missT < (k.inView ? (k.hits > 4 ? VID.life : VID.life0) : 8));
  for (let j = 0; j < D.length; j++) if (!usedD.has(j)) { const z = D[j]; const k = { id: VIS.nextId++, cls: z.cls, x: z.x, y: z.y, vx: 0, vy: 0, hits: 1, miss: 0, missT: 0, seen: t, born: t, pid: -1, stable: 0, inView: true, det: z, sig: visSigNew() }; visSig(k.sig, z.f, 1); VIS.tracks.push(k); }
  // two tracks on one person: keep the older
  VIS.tracks.sort((a, b) => b.hits - a.hits); for (let i = VIS.tracks.length - 1; i >= 0; i--) { const a = VIS.tracks[i]; if (VIS.tracks.some((b, j) => j < i && b.cls === a.cls && DM.hypot(b.x - a.x, b.y - a.y) < 0.55)) VIS.tracks.splice(i, 1); }
}
// speed from a least-squares line through the last second of measured positions: steadier than differencing two looks
function visSpeed(k, t, z) {
  const H = k.hist || (k.hist = []); H.push([t, z.x, z.y]); while (H.length && t - H[0][0] > 1.0) H.shift(); if (H.length < 3) { k.sp = DM.hypot(k.vx, k.vy); return; }
  let st = 0, sx = 0, sy = 0; for (const h of H) { st += h[0]; sx += h[1]; sy += h[2]; } const n = H.length; st /= n; sx /= n; sy /= n; let tt = 0, tx = 0, ty = 0;
  for (const h of H) { const d = h[0] - st; tt += d * d; tx += d * (h[1] - sx); ty += d * (h[2] - sy); } k.sp = tt > 1e-6 ? Math.min(10.5, DM.hypot(tx / tt, ty / tt)) : 0;
}
const visSigNew = () => ({ h: 0, hw: 0, hair: null, hairW: 0, skin: null, skinW: 0, boot: null, bootW: 0 });
// running weighted means of a signature (height and three colours)
function visSig(g, f, w) {
  if (!f || !f.q) return; const q = f.q * w; const mix = (k, v) => { if (!v || v[3] < 1) return; const W0 = g[k + 'W']; const x = v.slice(0, 3); g[k] = g[k] ? g[k].map((a, i) => (a * W0 + x[i] * q) / (W0 + q)) : x; g[k + 'W'] = W0 + q; };
  if (f.h > 1.2 && f.h < 2.4) { g.h = (g.h * g.hw + f.h * q) / (g.hw + q); g.hw += q; } mix('hair', f.hair); mix('skin', f.skin); mix('boot', f.boot);
}
// how unlike a track's signature is to a player's gallery signature (sum of capped squared z-scores)
function visAppCost(a, b) {
  let c = 0; const term = (x, xw, y, yw, s0, fl) => { if (xw < 0.4 || yw < 0.4 || !x || !y) return 0; const d2 = Array.isArray(x) ? x.reduce((s, v, i) => s + DM.sq(v - y[i]), 0) : DM.sq(x - y); return Math.min(6, d2 / (s0 * s0 * (1 / xw + 1 / yw) + fl * fl)); };
  c += term(a.h, a.hw, b.h, b.hw, 0.12, VID.fh); c += term(a.hair, a.hairW, b.hair, b.hairW, 0.3, VID.fc); c += term(a.skin, a.skinW, b.skin, b.skinW, 0.25, VID.fc); c += term(a.boot, a.bootW, b.boot, b.bootW, 0.2, VID.fc);
  return c;
}
const VID = { learn: 0.35, keep: 3, keepMax: 6, unk: 5.5, far: 8, ko: 1, shape: 2, sig: 5, app: 1, fh: 0.05, fc: 0.15, life: 1.2, life0: 0.4, near: 3, gate: 2.6, gv: 2, rb: 0 };   // identification constants (tuned on recorded runs)
const VID0 = Object.assign({}, VID);
// ---- 5. identification: match each team's tracks to its team sheet (Hungarian) on looks, continuity and plausibility ----
function visIdentify(J) {
  const t = J.t; const ko = J.ko;
  for (const ti of [0, 1]) {
    // goalkeepers wear a unique kit, so their colour alone names them
    const gk = players.find((p) => p.ti === ti && p.gk && !p.off); const gks = VIS.tracks.filter((k) => k.cls === 3 + ti).sort((a, b) => b.hits - a.hits); gks.forEach((k, j) => { k.pid = j === 0 && gk ? players.indexOf(gk) : -1; });
    const R = VIS.tracks.filter((k) => k.cls === 1 + ti && k.hits >= 2 && k.missT < 1.2); const P = players.map((p, i) => i).filter((i) => players[i].ti === ti && !players[i].gk && !players[i].off);
    if (!R.length) continue;
    // formation fit (role-based identification): the team-sheet shape, shifted and squeezed to where the identified players stand.
    // Teams keep their shape, so a player far from his role's spot is probably someone else.
    let fit = null; const tp = (pi) => { const s = players[pi].slot; return own2w(ti, s.x, s.y); };
    { const A = VIS.tracks.filter((k) => k.cls === 1 + ti && k.pid >= 0 && k.hits >= 2 && k.missT < 3 && !players[k.pid].gk); if (A.length >= 4) { const T = A.map((k) => tp(k.pid)), n = A.length;
      const mT = [T.reduce((a, q) => a + q.x, 0) / n, T.reduce((a, q) => a + q.y, 0) / n], mX = [A.reduce((a, k) => a + k.x, 0) / n, A.reduce((a, k) => a + k.y, 0) / n];
      const sc = [0, 1].map((j) => { let nu = 0, de = 0; A.forEach((k, i) => { const dt = (j ? T[i].y : T[i].x) - mT[j]; nu += dt * ((j ? k.y : k.x) - mX[j]); de += dt * dt; }); return de > 1 ? clamp(nu / de, 0.3, 1.3) : 1; });
      fit = (pi) => { const q = tp(pi); return [mX[0] + sc[0] * (q.x - mT[0]), mX[1] + sc[1] * (q.y - mT[1])]; }; } }
    // appearance counts relative to the best-matching team-mate: only differences between candidates matter
    const AP = R.map((k) => { const a = P.map((pi) => visAppCost(k.sig, VIS.gal[pi])); const mn = Math.min(...a); return a.map((x) => (x - mn) * VID.app); });
    const C = R.map((k, r) => P.map((pi, j) => { const p = players[pi]; let c = AP[r][j];
      if (fit && !ko) { const f = fit(pi); c += VID.shape * Math.min(6, (DM.sq(k.x - f[0]) + DM.sq(k.y - f[1])) / (VID.sig * VID.sig)); }
      if (k.pid === pi) c -= VID.keep + Math.min(VID.keepMax, k.stable * 0.25);                                   // keep identities unless the evidence says otherwise
      const L = VIS.last[pi]; if (L && L.k !== k.id) { const dt = t - L.t, d = DM.hypot(L.x - k.x, L.y - k.y); if (d > 9.5 * dt + 3) c += VID.far;   // seen elsewhere too recently
        else if (!VIS.tracks.some((o) => o.id === L.k && o.missT < 0.5)) c -= VID.near * Math.max(0, 1 - d / (2 + 6 * dt)); }   // his last track ended right here: probably him again
      if (ko) { const kp = own2w(ti, Math.min(p.slot.x * 0.85, 49.5), p.slot.y); c += VID.ko * Math.min(10, DM.sq(DM.hypot(kp.x - k.x, kp.y - k.y) / 3.5)); }   // team-sheet formation at kick-off
      return c; }).concat(R.map(() => VID.unk)));                                                        // or leave unidentified
    const as = VC.hungarian(C);
    R.forEach((k, r) => { const pi = as[r] >= 0 && as[r] < P.length ? P[as[r]] : -1; if (pi === k.pid) k.stable++; else { if (k.pid >= 0 && pi >= 0) VIS.idSwitch = (VIS.idSwitch || 0) + 1; k.pid = pi; k.stable = 0; } });
  }
  // the gallery learns from tracks whose identity has held for a while (fast during the kick-off calibration window)
  for (const k of VIS.tracks) { if (k.pid < 0 || !k.det) continue; const p = players[k.pid]; VIS.last[k.pid] = { x: k.x, y: k.y, t, k: k.id };
    if (k.stable >= 3 || (ko && k.stable >= 1)) visSig(VIS.gal[k.pid], k.det.f, ko ? 1 : VID.learn);
    const st = VIS.pstat[k.pid]; const sp = k.sp || 0; if (k.hits > 5) { st.top = Math.max(st.top, sp); st.n++; } if (k.lx !== undefined) { const d = DM.hypot(k.x - k.lx, k.y - k.ly); if (d < 3) st.dist += d; } k.lx = k.x; k.ly = k.y; if (!p) continue; }
}
// ---- the ball: a small white blob, followed with its own filter; a lost ball is re-found near the players ----
const VB = { decay: 0.7, hyst: 1.05, spawn: 1.2, min: 1.5, boot: 1.2, miss: 0.8 };   // ball-tracker constants (tuned on recorded runs)
function visBall(J) {
  const t = J.t, C = J.det.balls, prev = VIS.prevBalls || []; VIS.prevBalls = C;
  // how ball-like each speck is: the right size for that distance, round, free of a body, and seen near the same spot a moment
  // ago (rain and glints flicker; a ball persists)
  for (const c of C) { let sup = 0; for (const q of prev) { const d = DM.hypot(q.x - c.x, q.y - c.y); if (d < 3) sup = Math.max(sup, d < 0.05 ? 0.3 : 1); } c.sup = sup;
    c.score = Math.min(1, c.n / (0.78 * c.d * c.d + 1)) + (c.w >= 2 && c.h >= 2 ? 0.3 : 0) + 0.4 * (c.iso === undefined ? 0.75 : c.iso) + sup - (c.n === 1 && c.dn < 1 ? VB.boot : 0); }
  // several ball hypotheses run at once, each scored by the evidence along its path; the best-supported one is the ball.
  // A white boot or a glint can win a frame, but it rarely keeps a smooth path as long as the real ball does.
  const HY = VIS.hyps || (VIS.hyps = []); const used = new Set();
  for (const h of HY) { const dt = t - h.t; h.px = h.x + h.vx * dt; h.py = h.y + h.vy * dt; }
  const pr = []; for (const h of HY) { const gate = 1.6 + 20 * Math.min(1, t - h.seen); for (const c of C) { const d = DM.hypot(c.x - h.px, c.y - h.py); if (d < gate) pr.push([d / gate - c.score * 0.2, h, c]); } }
  pr.sort((a, b) => a[0] - b[0]); const hu = new Set();
  for (const [, h, c] of pr) { if (hu.has(h) || used.has(c)) continue; hu.add(h); used.add(c); const dt = Math.max(0.05, t - h.t), rx = c.x - h.px, ry = c.y - h.py;
    if (t - h.seen < 0.7) { h.x = h.px + 0.75 * rx; h.y = h.py + 0.75 * ry; h.vx += 0.45 * rx / dt; h.vy += 0.45 * ry / dt; } else { h.vx = rx / dt * 0.3; h.vy = ry / dt * 0.3; h.x = c.x; h.y = c.y; }
    const sp = DM.hypot(h.vx, h.vy); if (sp > 42) { h.vx *= 42 / sp; h.vy *= 42 / sp; } h.t = t; h.seen = t; h.ev = h.ev * VB.decay + c.score; h.n++; h.u = c.u; h.v = c.v; }
  for (const h of HY) if (!hu.has(h)) { h.x = h.px; h.y = h.py; h.t = t; h.vx *= 0.85; h.vy *= 0.85; h.ev *= VB.miss; }
  for (const c of C) if (!used.has(c) && c.score > VB.spawn) HY.push({ x: c.x, y: c.y, vx: 0, vy: 0, t, seen: t, ev: c.score * 0.5, n: 1, id: (VIS.hypId = (VIS.hypId || 0) + 1) });
  for (let i = HY.length - 1; i >= 0; i--) if (t - HY[i].seen > 1.2 || HY[i].ev < 0.4) HY.splice(i, 1);
  HY.sort((a, b) => b.ev - a.ev); if (HY.length > 12) HY.length = 12;
  // hysteresis: keep following the current ball unless another path is clearly better supported
  const cur = VIS.ball && HY.find((h) => h.id === VIS.ball.id); let top = HY[0]; if (cur && top && top !== cur && top.ev < cur.ev * VB.hyst) top = cur;
  if (!top || top.ev < VB.min) { if (VIS.ball) VIS.ball.t = t; return; }
  const B = VIS.ball && VIS.ball.id === top.id ? VIS.ball : (VIS.ball = { id: top.id, hist: [] });
  Object.assign(B, { x: top.x, y: top.y, vx: top.vx, vy: top.vy, t, seen: top.seen, u: top.u, v: top.v });
  if (top.seen === t) { B.hist.push([t, B.x, B.y, DM.hypot(B.vx, B.vy)]); if (B.hist.length > 60) B.hist.shift(); }
}
// ---- 6. auto-eventing: possession from the nearest identified player, passes from possession changing hands ----
function visEvents(J) {
  const t = J.t, B = VIS.ball; if (!B || B.seen !== t) return;
  let own = null, od = 1.5; for (const k of VIS.tracks) { if (k.pid < 0 || k.missT > 0 || players[k.pid].gk && k.cls < 3) continue; const d = DM.hypot(k.x - B.x, k.y - B.y); if (d < od) { od = d; own = k; } }
  const bsp = DM.hypot(B.vx, B.vy); if (!own || bsp > 14) { return; }
  const pid = own.pid, P = VIS.poss;
  if (P && P.pid === pid) { P.lastT = t; P.lx = B.x; P.ly = B.y; VIS.pend = null; return; }
  // a new player on the ball must hold it for two looks (0.4 s) before possession changes hands
  if (!VIS.pend || VIS.pend.pid !== pid) { VIS.pend = { pid, t, x: B.x, y: B.y, n: 1 }; return; } if (++VIS.pend.n < 2) return;
  const N = VIS.pend; VIS.pend = null;
  if (P && t - P.lastT < 8) {
    const a = players[P.pid], b = players[pid], dist = DM.hypot(N.x - P.lx, N.y - P.ly), dur = Math.max(0.2, N.t - P.lastT);
    let peak = 0; for (const h of B.hist) if (h[0] >= P.lastT && h[0] <= N.t) peak = Math.max(peak, h[3]);
    if (dist >= 4 && dist / dur < 40) { const ev = { t: N.t, t0: P.lastT, from: P.pid, to: pid, team: a.ti, ok: a.ti === b.ti, dist, kmh: dist / dur * 3.6, peak: peak * 3.6 }; VIS.passes.push(ev); if (VIS.passes.length > 400) VIS.passes.shift();
      dataEvent('vision_pass', { team: a.T.key, player: a.name, to: b.name, completed: ev.ok, distM: +dist.toFixed(1), kmh: Math.round(ev.kmh), peakKmh: Math.round(ev.peak), source: 'pixels' }); }
  }
  VIS.poss = { pid, t: N.t, lastT: t, lx: B.x, ly: B.y };
}
// ---- 7. the scorer: grades the tracker against the simulator's ground truth (the only place the sim state is read) ----
function visEval(J) {
  const T = J.truth, cam = J.cam; const inV = (x, y) => { const s = cam.proj(x, y, 0); return s && s[0] >= 0 && s[0] < VIS.W && s[1] >= 0 && s[1] < VIS.H + 3; };
  const G = T.ppl.filter((g) => !g.off && inV(g.x, g.y)); const D = J.det.people;
  for (const E of [VIS.ev, VIS.win]) {
    // detection: one-to-one matches within 2 m and the right kit
    const pr = []; for (const g of G) for (let j = 0; j < D.length; j++) if (D[j].cls === g.cls) { const d = DM.hypot(D[j].x - g.x, D[j].y - g.y); if (d < 2) pr.push([d, g, j]); }
    pr.sort((a, b) => a[0] - b[0]); const ug = new Set(), ud = new Set(); for (const [d, g, j] of pr) { if (ug.has(g) || ud.has(j)) continue; ug.add(g); ud.add(j); E.se += d; }
    E.gt += G.length; E.det += D.length; E.tp += ug.size;
    // identity and speed: each visible player against the confirmed track that covers him
    const tk = VIS.tracks.filter((k) => k.hits >= 2 && k.missT === 0 && k.cls !== 5); const pt = []; for (const g of G) if (g.i >= 0) for (const k of tk) if (k.cls === g.cls) { const d = DM.hypot(k.x - g.x, k.y - g.y); if (d < 2) pt.push([d, g, k]); }
    pt.sort((a, b) => a[0] - b[0]); const ug2 = new Set(), uk = new Set();
    for (const [, g, k] of pt) { if (ug2.has(g) || uk.has(k)) continue; ug2.add(g); uk.add(k); const gi = players.findIndex((p) => p.ti === g.ti && p.i === g.i);
      E.idN++; if (k.pid === gi) E.idOK++; else if (k.pid < 0) E.idUnk++; const pv = E.prev.get(gi); if (k.pid >= 0) { if (pv !== undefined && pv !== k.pid) E.sw++; E.prev.set(gi, k.pid); }
      if (k.hits >= 5 && k.sp !== undefined) { E.spN++; E.spE += Math.abs(k.sp - g.sp); } }
    // ball: found when the vision ball is within 1.5 m of the real one (ground position)
    if (inV(T.ball.x, T.ball.y)) { E.bIn++; const B = VIS.ball; if (B && B.seen === J.t) { const e = DM.hypot(B.x - T.ball.x, B.y - T.ball.y); if (e < 1.5) { E.bHit++; E.bSe += e; if (T.ball.h < 0.5 && B.hist.length > 3) { E.bSpN++; E.bSpE += Math.abs(DM.hypot(B.vx, B.vy) - T.ball.sp); } } } }
  }
  if (S.t >= VIS.nextChk) { VIS.nextChk = S.t + 10; const w = VIS.win; if (w.gt >= 30) { const r = visRates(w); const ok = r.recall >= 85 && r.id >= 70 && r.posErr < 1; vRes('vision', ok, 'Detection ' + r.recall + '%, ID ' + r.id + '%, position error ' + r.posErr + ' m on the ' + S.cam + ' camera'); } VIS.win = visZero(); }
  if (S.t >= VIS.nextAcc) { VIS.nextAcc = S.t + 60; const r = visReport(); dataEvent('vision_accuracy', { camera: S.cam, recallPct: r.detection.recall, precisionPct: r.detection.precision, posErrM: r.detection.posErr, idPct: r.identity.accuracy, idSwitches: r.identity.switches, speedErrMs: r.speed.playerErr, ballFoundPct: r.ball.found, passRecallPct: r.passes.recall, passPrecisionPct: r.passes.precision, msPerCapture: r.cost.msPerCapture }); }
}
function visRates(E) { return { recall: Math.round(E.tp / Math.max(1, E.gt) * 1000) / 10, precision: Math.round(E.tp / Math.max(1, E.det) * 1000) / 10, posErr: Math.round(E.se / Math.max(1, E.tp) * 100) / 100, id: Math.round(E.idOK / Math.max(1, E.idN) * 1000) / 10 }; }
// passes: the sim's completed passes (a pass event, then a team-mate takes control) against the vision's, matched within 1.5 s
function visPassScore() {
  const G = VIS.gtPass, V = VIS.passes.filter((v) => v.ok); const usedV = new Set(); let hit = 0, strict = 0, hitOn = 0, nOn = 0;
  for (const g of G) { if (g.on) nOn++; let m = null; for (const v of V) if (!usedV.has(v) && v.team === g.ti && Math.abs(v.t - g.t1) < 1.5) { m = v; break; } if (m) { usedV.add(m); hit++; if (g.on) hitOn++; if (m.from === g.from && m.to === g.to) strict++; } }
  return { gt: G.length, vis: V.length, recall: Math.round(hit / Math.max(1, G.length) * 1000) / 10, recallOnScreen: Math.round(hitOn / Math.max(1, nOn) * 1000) / 10, precision: Math.round(usedV.size / Math.max(1, V.length) * 1000) / 10, playersRight: Math.round(strict / Math.max(1, hit) * 1000) / 10 };
}
function visReport() {
  const E = VIS.ev || visZero(), r = visRates(E), c = VIS.cost || { n: 0 };
  return { on: VIS.on, camera: S.cam, captures: c.n || 0, resolution: VIS.W + 'x' + VIS.H, detection: { gt: E.gt, recall: r.recall, precision: r.precision, posErr: r.posErr },
    identity: { frames: E.idN, accuracy: r.id, unknownPct: Math.round(E.idUnk / Math.max(1, E.idN) * 1000) / 10, switches: E.sw },
    speed: { playerErr: Math.round(E.spE / Math.max(1, E.spN) * 100) / 100, ballErr: Math.round(E.bSpE / Math.max(1, E.bSpN) * 100) / 100 },
    ball: { inView: E.bIn, found: Math.round(E.bHit / Math.max(1, E.bIn) * 1000) / 10, posErr: Math.round(E.bSe / Math.max(1, E.bHit) * 100) / 100 }, passes: visPassScore(),
    cost: { msPerCapture: c.n ? Math.round((c.cap + c.cls + c.det) / c.n * 10) / 10 : 0, capture: c.n ? Math.round(c.cap / c.n * 10) / 10 : 0, classify: c.n ? Math.round(c.cls / c.n * 10) / 10 : 0, detectTrack: c.n ? Math.round(c.det / c.n * 10) / 10 : 0 } };
}

// ---- 8. on screen: boxes and names from the vision pipeline (not the sim), and the accuracy panel ----
const visCol = (k) => k.cls === 1 ? TEAMS[0].css : k.cls === 2 ? TEAMS[1].css : k.cls === 3 ? '#' + TEAMS[0].gkKit.toString(16).padStart(6, '0') : k.cls === 4 ? '#' + TEAMS[1].gkKit.toString(16).padStart(6, '0') : '#CFD6DE';
const visTV = new THREE.Vector3();
function visOverlay() {
  const cv = $('visov'); if (!cv) return; const show = VIS.on && VIS.boxes && S.started && !S.over; if (cv.hidden === show) cv.hidden = !show; if (!show) return;
  const w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2); if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const P = (x, y, z) => { visTV.set(x - 52.5, z, y - 34).project(camera); return visTV.z < 1 ? [(visTV.x + 1) / 2 * w, (1 - visTV.y) / 2 * h] : null; };
  const lag = clamp(S.t - VIS.t, 0, 0.5); g.font = '600 11px "JetBrains Mono",ui-monospace,monospace'; g.textBaseline = 'bottom'; g.lineWidth = 1.5;
  const own = VIS.poss && VIS.ball && S.t - VIS.ball.seen < 0.8 ? VIS.poss.pid : -1;
  for (const k of VIS.tracks) {
    if (k.hits < 2 || k.missT > 0.45) continue; const x = k.x + k.vx * lag, y = k.y + k.vy * lag; const hh = k.sig.hw > 1 ? k.sig.h : 1.8; const a = P(x, y, 0), b = P(x, y, hh + 0.08); if (!a || !b) continue;
    const bh = Math.max(8, a[1] - b[1]), bw = Math.max(5, bh * 0.42), c = visCol(k), sp = (k.sp || 0) * 3.6;
    g.strokeStyle = c; g.globalAlpha = k.pid >= 0 || k.cls === 5 ? 0.95 : 0.55; g.lineWidth = k.pid === own && own >= 0 ? 3 : 1.5; g.strokeRect(a[0] - bw / 2, b[1], bw, bh);
    const p = k.pid >= 0 ? players[k.pid] : null; let txt = k.cls === 5 ? 'REF' : p ? p.num + ' ' + surname(p.name).toUpperCase() : '?' + k.id; if (sp >= 25) txt += ' ' + Math.round(sp) + ' km/h';
    if (bh > 14 || p) { const tw = g.measureText(txt).width + 6; g.globalAlpha = 0.82; g.fillStyle = sp >= 27 ? '#FFD166' : 'rgba(9,13,19,0.85)'; g.fillRect(a[0] - tw / 2, b[1] - 15, tw, 14); g.globalAlpha = 1; g.fillStyle = sp >= 27 ? '#1A1206' : c; g.fillText(txt, a[0] - tw / 2 + 3, b[1] - 2); }
  }
  g.globalAlpha = 1; const B = VIS.ball;
  if (B && S.t - B.seen < 0.6) { const a = P(B.x + B.vx * lag, B.y + B.vy * lag, 0.11); if (a) { g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.beginPath(); g.arc(a[0], a[1], 7, 0, 7); g.stroke(); const sp = DM.hypot(B.vx, B.vy) * 3.6; if (sp > 20) { g.fillStyle = '#FFFFFF'; g.fillText(Math.round(sp) + ' km/h', a[0] + 9, a[1] - 4); } } }
  // the pass the vision just saw
  const lp = VIS.passes[VIS.passes.length - 1]; if (lp && S.t - lp.t < 2.5) { const a = players[lp.from], b = players[lp.to]; const txt = 'PASS ' + a.num + ' → ' + b.num + ' · ' + lp.dist.toFixed(0) + ' m · ' + Math.round(lp.kmh) + ' km/h'; g.font = '700 13px "JetBrains Mono",ui-monospace,monospace'; const tw = g.measureText(txt).width + 14; g.fillStyle = 'rgba(9,13,19,0.85)'; g.fillRect(w / 2 - tw / 2, h * 0.16, tw, 24); g.fillStyle = lp.ok ? '#7CE0A3' : '#FF8A8A'; g.fillText(txt, w / 2 - tw / 2 + 7, h * 0.16 + 19); }
}
function visPanel() {
  const r = visReport(), el = $('visp-b'); if (!el) return; const fmt = (v, u) => (r.detection.gt ? v + u : '–');
  $('visp-s').textContent = 'pixels only · ' + r.resolution + ' · ' + Math.round(1 / VIS.period) + ' Hz · ' + r.cost.msPerCapture + ' ms';
  const top = VIS.pstat.map((s, i) => [s, i]).filter(([s]) => s.n > 8).sort((a, b) => b[0].top - a[0].top).slice(0, 3);
  const lastP = VIS.passes.slice(-3).reverse();
  el.innerHTML = '<div class="vp-g">' + [['Detected', fmt(r.detection.recall, '%'), 'precision ' + fmt(r.detection.precision, '%')], ['Position', fmt(r.detection.posErr, ' m'), 'mean error'], ['Identity', fmt(r.identity.accuracy, '%'), r.identity.switches + ' switches'],
    ['Speed', fmt(r.speed.playerErr, ' m/s'), 'player error'], ['Ball', fmt(r.ball.found, '%'), 'found in view'], ['Passes', r.passes.gt ? r.passes.recall + '%' : '–', 'recall · ' + (r.passes.vis ? r.passes.precision + '% prec' : '–')]]
    .map(([k, v, s]) => '<div><small>' + k + '</small><b>' + v + '</b><em>' + s + '</em></div>').join('') + '</div>' +
    '<div class="vp-l"><small>Auto-events from pixels</small>' + (lastP.length ? lastP.map((p) => '<div>' + (p.ok ? 'Pass ' : 'Lost ') + '<b>' + players[p.from].num + '</b> ' + surname(players[p.from].name) + ' → <b>' + players[p.to].num + '</b> ' + surname(players[p.to].name) + '<span>' + p.dist.toFixed(0) + ' m · ' + Math.round(p.kmh) + ' km/h</span></div>').join('') : '<div class="vp-m">Watching for passes…</div>') +
    (top.length ? '<div class="vp-m">Top speed (vision): ' + top.map(([s, i]) => surname(players[i].name) + ' ' + (s.top * 3.6).toFixed(0)).join(' · ') + ' km/h</div>' : '') + '</div>' +
    '<div class="vp-m">Scored live against the simulator\'s ground truth. The tracker itself never reads player positions.</div>';
}
function visToggle(on) {
  VIS.on = on === undefined ? !VIS.on : !!on; if (VIS.on) visReset(); const b = $('visb'); if (b) b.setAttribute('aria-pressed', VIS.on ? 'true' : 'false');
  if ($('visp')) $('visp').hidden = !VIS.on; if (!VIS.on && $('visov')) $('visov').hidden = true; if (VIS.on) visPanel();
  if (S.started) dataEvent(VIS.on ? 'vision_on' : 'vision_off', { camera: S.cam });
}
function visTick(dt) {
  if (!VIS.on || !S.started || S.renderOff || !players.length) return;
  // ground-truth completed passes, for the scorer: a pass event, then a team-mate takes control
  const o = S.owner; if (o !== VIS.lastOwner) { const G = VIS.gtPend; if (o && G && o.ti === G.from.ti && o !== G.from && S.t - G.t < 8) { visTV.set(ball.p.x - 52.5, 0, ball.p.z - 34).project(camera); VIS.gtPass.push({ from: players.indexOf(G.from), to: players.indexOf(o), ti: o.ti, t0: G.t, t1: S.t, on: Math.abs(visTV.x) < 1 && Math.abs(visTV.y) < 1 }); } if (o) VIS.gtPend = null; VIS.lastOwner = o; }
  VIS.acc += S.paused ? 0 : dt * S.speed; if (VIS.job) { visStep(); return; }
  if (VIS.acc >= VIS.period) { VIS.acc = Math.min(VIS.acc - VIS.period, VIS.period); VIS.job = { stage: 0 }; visStep(); }
}
onMatchEvent((ev) => { if (!VIS.on) return; if (ev.type === 'pass') { const p = players.find((q) => q.name === ev.player && q.T.key === ev.team); if (p) VIS.gtPend = { from: p, t: S.t }; } if (ev.type === 'kickoff' && ev.half === 1) visReset(); });
VCHK.push(['vision', 'Auto-eventing accuracy', 'Vision', 'Pixel-only tracker against ground truth while Vision is on: detection 85%+, identity 70%+, position error under 1 m']);
{ const _fr = frame; frame = function (dt, draw) { _fr(dt, draw); if (draw) VIS.drawn = true; visTick(dt); if (draw) visOverlay(); }; window.__mc.frame = frame; }
{ const b = document.createElement('button'); b.id = 'visb'; b.textContent = '👁 Vision'; b.setAttribute('aria-pressed', 'false'); b.title = 'Computer vision: tag players, ball, speeds and passes from the pixels'; b.onclick = () => visToggle(); $('datab').after(b); }
if ($('visp-x')) $('visp-x').onclick = () => visToggle(false);
if ($('visp-box')) $('visp-box').onclick = (e) => { VIS.boxes = !VIS.boxes; e.currentTarget.setAttribute('aria-pressed', VIS.boxes ? 'true' : 'false'); };
// test hooks: record the detections of a run once (slow under software GL), then replay tracking and identification in seconds
const VB0 = Object.assign({}, VB);
function visReplay(rec, gtPass, P) { Object.assign(VB, VB0); Object.assign(VID, VID0); if (P) for (const k in P) Object.assign(k === 'VB' ? VB : k === 'VID' ? VID : VIS, P[k]); const on = VIS.on; VIS.on = true; visReset(); const st = S.t, sf = S.flip;
  for (const R of rec) { if (R.slots) players.forEach((p, i) => p.slot.set(R.slots[i][0], R.slots[i][1])); S.t = R.t; S.flip = R.flip; VIS.W = R.W; VIS.H = R.H; const J = { t: R.t, ko: R.ko, det: R.det, truth: R.truth, cam: VC.camera(R.cam[0], R.cam[1], R.cam[2], R.cam[3], R.W, R.H) }; visTrack(J); visIdentify(J); visBall(J); visEvents(J); visEval(J); VIS.cost.n++; }
  VIS.gtPass = gtPass || []; S.t = st; S.flip = sf; VIS.on = on; return visReport(); }
window.__mc.vis = { VIS, VC, report: visReport, reset: visReset, toggle: visToggle, capture: visCapture, replay: visReplay };

// ---- shirt numbers: printed on every player's back (and small on the chest) so people and cameras can read who is who ----
// The kit shader colours body regions from a palette; here the shirt region also samples a digit atlas, placed with the
// body's bind-pose coordinates so the number stays glued to the back as the skeleton moves. Numbers take the shorts colour
// when it contrasts with the shirt (white on blue, black on orange), as real kits do.
const DIGITS = canvasTex(640, 96, (g) => { g.clearRect(0, 0, 640, 96); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 92px "Barlow Condensed","Arial Narrow",Arial,sans-serif';
  for (let i = 0; i < 10; i++) { g.save(); g.translate(i * 64 + 32, 50); g.scale(0.72, 1); g.fillText(String(i), 0, 0); g.restore(); } });
const NUM_FRAG = `
  if (reg > 0.5 && reg < 1.5 && uNum.w > 0.5) {
    float yn = vKP.y / uNum.z, hw = 0.085 * uNum.z; vec2 nb = vec2(-1.0); float big = 0.0;
    if (vKN.z < -0.3 && yn > 0.64 && yn < 0.8) { nb = vec2(0.5 - vKP.x / (2.0 * hw), (yn - 0.64) / 0.16); big = 1.0; }
    else if (vKN.z > 0.45 && yn > 0.745 && yn < 0.795) { nb = vec2(0.5 + (vKP.x + 0.045 * uNum.z) / (0.06 * uNum.z), (yn - 0.745) / 0.05); }
    if (nb.x > 0.0 && nb.x < 1.0) {
      float dg = uNum.y, lx = (nb.x - 0.25) * 2.0;
      if (uNum.x > -0.5) { dg = nb.x < 0.5 ? uNum.x : uNum.y; lx = nb.x < 0.5 ? nb.x * 2.0 : nb.x * 2.0 - 1.0; }
      if (lx > 0.0 && lx < 1.0) diffuseColor.rgb = mix(diffuseColor.rgb, uNumCol, texture2D(uDigits, vec2((dg + lx) / 10.0, nb.y)).a);
    }
  }
`;
{ const _km = kitMaterial;
  kitMaterial = function (pal) {
    const m = _km(pal); const ob = m.onBeforeCompile; const U = m.userData; U.uNum = { value: new THREE.Vector4(-1, 0, 1.8, 0) }; U.uNumCol = { value: new THREE.Color(0xffffff) };
    m.onBeforeCompile = (sh, r) => { ob(sh, r); sh.uniforms.uNum = U.uNum; sh.uniforms.uNumCol = U.uNumCol; sh.uniforms.uDigits = { value: DIGITS };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKP; varying vec3 vKN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvKP = position; vKN = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKP; varying vec3 vKN; uniform vec4 uNum; uniform vec3 uNumCol; uniform sampler2D uDigits;').replace('diffuseColor.rgb = pc; kitRough = rr;', 'diffuseColor.rgb = pc; kitRough = rr;\n' + NUM_FRAG); };
    return m; };
  const _bp = buildPeople;
  buildPeople = function (g) { _bp(g); const lum = (h) => (0.2126 * (h >> 16 & 255) + 0.7152 * (h >> 8 & 255) + 0.0722 * (h & 255)) / 255;
    for (const p of players) { const k = kitOf(p.T, p.gk); const U = p.mat.userData; U.uNum.value.set(p.num >= 10 ? Math.floor(p.num / 10) : -1, p.num % 10, BODY[p.variant].h, 1);
      U.uNumCol.value.set(Math.abs(lum(k.shorts) - lum(k.shirt)) > 0.3 ? k.shorts : lum(k.shirt) > 0.55 ? 0x14181F : 0xF4F6F8); } };
}
