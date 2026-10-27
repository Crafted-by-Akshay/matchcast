
// ============ WORLD VISUALS: sky, sun, floodlights, rain, snow, fog, lightning, wet turf ============
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uCloud: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uSunVis: { value: 1 } },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform vec3 uSun, uZen, uHor, uGlow; uniform float uCloud, uFlash, uTime, uSunVis; varying vec3 vD;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      float y = max(vD.y, 0.0); vec3 col = mix(uHor, uZen, pow(y, 0.55));
      float sd = max(dot(normalize(vD), normalize(uSun)), 0.0);
      col += uGlow * pow(sd, 6.0) * 0.55 * (1.0 - uCloud * 0.8);
      col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9998, sd) * 6.0 * uSunVis * (1.0 - uCloud);
      vec2 uv = vD.xz / (vD.y + 0.25) * 2.0 + vec2(uTime * 0.01, 0.0);
      float cl = n(uv) * 0.6 + n(uv * 2.3) * 0.3 + n(uv * 5.1) * 0.1; float cov = smoothstep(1.0 - uCloud * 1.05, 1.0 - uCloud * 0.6 + 0.12, cl);
      vec3 cloudCol = mix(uHor * 0.9 + vec3(0.06), uZen * 0.5 + uHor * 0.5, 0.35) * (1.0 - uCloud * 0.45);
      col = mix(col, cloudCol, cov * smoothstep(0.0, 0.18, y) * clamp(uCloud * 1.4, 0.0, 1.0));
      col += vec3(0.75, 0.8, 1.0) * uFlash;
      // a few stars on clear nights
      float star = step(0.9985, h(floor(vD.xz / (vD.y + 0.05) * 140.0))) * smoothstep(0.15, 0.6, y) * (1.0 - uCloud) * clamp(1.0 - length(uZen) * 4.0, 0.0, 1.0);
      gl_FragColor = vec4(col + star, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(620, 48, 24), skyMat); sky.renderOrder = -1; scene.add(sky);
scene.background = null;
const hemi = scene.children.find((o) => o.isHemisphereLight);
const fogC = new THREE.Color(); scene.fog = new THREE.FogExp2(0x9aa8b6, 0.0008);
// floodlights: four mast lights aimed at the centre spot, plus the bright lamp panels already on the masts
const floods = [];
for (const [x, z] of [[-76, -58], [76, -58], [76, 58], [-76, 58]]) { const l = new THREE.DirectionalLight(0xF4F1EA, 0); l.position.set(x, 50, z); scene.add(l); floods.push(l); }
const floodSprites = scene.children.filter((o) => o.isSprite); const floodPanels = scene.children.filter((o) => o.isMesh && o.material && o.material.isMeshBasicMaterial && o.geometry.type === 'BoxGeometry');
// precipitation: rain streaks and snowflakes in a box that follows the camera
const RAIN_N = 7000;
const rainGeo = new THREE.BufferGeometry(); const rainPos = new Float32Array(RAIN_N * 6); const rainSeed = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) { rainSeed[i * 3] = Math.random() * 70 - 35; rainSeed[i * 3 + 1] = Math.random() * 30; rainSeed[i * 3 + 2] = Math.random() * 70 - 35; }
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xBFD3E6, transparent: true, opacity: 0.0, depthWrite: false });
const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; scene.add(rain);
const flakeTex = canvasTex(32, 32, (g) => { const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); });
const SNOW_N = 5000; const snowGeo = new THREE.BufferGeometry(); const snowPos = new Float32Array(SNOW_N * 3); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: flakeTex, size: 0.18, transparent: true, depthWrite: false, opacity: 0 })); snowPts.frustumCulled = false; scene.add(snowPts);
let precipT = 0;
function stepPrecip(dt) {
  const wx = WX[ENV.wx] || WX.clear; const isSnow = ENV.wx === 'snow' && ENV.temp < 1.5; const rate = isSnow ? 0 : wx.rain;
  const nR = Math.floor(RAIN_N * clamp(rate / 16, 0, 1)); const nS = isSnow ? SNOW_N : 0; precipT += dt;
  const c = camera.position; const wx_ = DM.cos(ENV.windDir) * ENV.wind * 0.6, wz_ = DM.sin(ENV.windDir) * ENV.wind * 0.6;
  rainGeo.setDrawRange(0, nR * 2); rainMat.opacity = nR ? 0.28 + 0.25 * clamp(rate / 16, 0, 1) : 0;
  const fall = 9.5, len = 0.55;
  for (let i = 0; i < nR; i++) {
    const s = rainSeed.subarray(i * 3, i * 3 + 3); let y = 30 - ((s[1] + precipT * fall) % 30);
    const x = c.x + ((s[0] + wx_ * precipT * 0.3) % 70 + 105) % 70 - 35, z = c.z + ((s[2] + wz_ * precipT * 0.3) % 70 + 105) % 70 - 35; y += Math.max(0, c.y - 12);
    rainPos.set([x, y, z, x - wx_ * len / fall, y + len, z - wz_ * len / fall], i * 6);
  }
  rainGeo.attributes.position.needsUpdate = nR > 0;
  snowPts.material.opacity = nS ? 0.9 : 0; snowGeo.setDrawRange(0, nS);
  for (let i = 0; i < nS; i++) { const s = rainSeed.subarray(i * 3, i * 3 + 3); const y = 30 - ((s[1] + precipT * 1.1) % 30); snowPos.set([c.x + ((s[0] + DM.sin(precipT * 0.7 + i) * 0.6 + wx_ * precipT * 0.5) % 70 + 105) % 70 - 35, y + Math.max(0, c.y - 12), c.z + ((s[2] + wz_ * precipT * 0.5) % 70 + 105) % 70 - 35], i * 3); }
  snowGeo.attributes.position.needsUpdate = nS > 0;
}
const C = (h) => new THREE.Color(h); const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
const SKY = { day: [C(0x2F6FCF), C(0xA9C9EE), C(0xFFF0D0)], gold: [C(0x3B5B9A), C(0xF2A65C), C(0xFFB46A)], dusk: [C(0x101B36), C(0xC8654A), C(0xFF7A4A)], night: [C(0x03060D), C(0x0B1424), C(0x223355)] };
const OVC = { day: C(0x8D98A4), night: C(0x161A20) };
function applyWorldVisuals(dt) {
  if (!ENV.set) return;
  const wx = WX[ENV.wx]; const el = ENV.sunEl; const az = ENV.sunAz * Math.PI / 180; const cloud = ENV.wx === 'fog' ? 0.9 : wx.cloud;
  // sky colours by sun elevation: day > golden hour > dusk > night, then greyed by cloud
  const pickSky = (i) => { if (el > 12) return SKY.day[i]; if (el > 2) return tmpC.copy(SKY.gold[i]).lerp(SKY.day[i], (el - 2) / 10); if (el > -7) return tmpC.copy(SKY.dusk[i]).lerp(SKY.gold[i], (el + 7) / 9); return tmpC.copy(SKY.night[i]).lerp(SKY.dusk[i], clamp((el + 14) / 7, 0, 1)); };
  const dayAmt = clamp((el + 6) / 18, 0, 1); const ovc = tmpC2.copy(OVC.night).lerp(OVC.day, dayAmt);
  skyMat.uniforms.uZen.value.copy(pickSky(0)).lerp(ovc, cloud * 0.85); skyMat.uniforms.uHor.value.copy(pickSky(1)).lerp(ovc, cloud * 0.75); skyMat.uniforms.uGlow.value.copy(pickSky(2));
  // sun direction in scene space: pitch long axis runs east-west (x = east), z = south
  const sd = new THREE.Vector3(DM.sin(az) * DM.cos(el * Math.PI / 180), DM.sin(el * Math.PI / 180), -DM.cos(az) * DM.cos(el * Math.PI / 180));
  skyMat.uniforms.uSun.value.copy(sd); skyMat.uniforms.uCloud.value = cloud; skyMat.uniforms.uTime.value += dt; skyMat.uniforms.uSunVis.value = el > -1 ? 1 : 0;
  ENV.flash = Math.max(0, (ENV.flash || 0) - dt * 4.5); const fl = ENV.flash > 0 ? (DM.sin(ENV.flash * 40) > 0 ? ENV.flash : ENV.flash * 0.3) : 0; skyMat.uniforms.uFlash.value = fl * 0.9;
  // sunlight: strength by elevation, softened by cloud; warm near the horizon
  const sunUp = clamp(DM.sin(el * Math.PI / 180) * 1.6, 0, 1); const sunI = 2.7 * DM.pow(sunUp, 0.7) * (1 - 0.8 * cloud);
  const floodOn = el < 12 || (cloud > 0.85 && el < 22) || ENV.wx === 'storm' || ENV.wx === 'fog';
  const floodLvl = floodOn ? clamp((12 - el) / 10, 0.35, 1) : 0;
  if (sunI > 0.25) { sun.position.copy(sd).multiplyScalar(140); sun.intensity = sunI; sun.color.setRGB(1, lerp(0.72, 0.96, clamp(el / 25, 0, 1)), lerp(0.5, 0.88, clamp(el / 25, 0, 1))); sun.castShadow = true; }
  else { sun.position.set(-30, 110, 20); sun.intensity = 1.6 * floodLvl + 0.15; sun.color.setRGB(0.97, 0.97, 1); sun.castShadow = floodLvl > 0.2; }
  hemi.intensity = lerp(0.18, 0.75, dayAmt) * (1 - 0.25 * cloud) + 0.25 * floodLvl + fl * 1.6; hemi.color.copy(skyMat.uniforms.uZen.value).lerp(C(0xffffff), 0.5);
  sun2.intensity = 0.25 + 0.6 * dayAmt + 0.5 * floodLvl;
  for (const l of floods) l.intensity = 0.55 * floodLvl;
  for (const s of floodSprites) s.material.opacity = floodLvl; for (const p of floodPanels) p.material.color.setScalar(floodOn ? 1 : 0.25);
  renderer.toneMappingExposure = lerp(1.15, 0.95, dayAmt) * (1 - 0.1 * cloud) + 0.1 * floodLvl;
  // fog: visibility sets the extinction distance (Koschmieder: 3/visibility for 5% contrast)
  fogC.copy(skyMat.uniforms.uHor.value).lerp(ovc, 0.5); scene.fog.color.copy(fogC); const vis = ENV.vis;
  scene.fog.density = clamp(3.2 / vis, 0.0004, 0.035) + (wx.rain > 3 ? 0.002 : 0);
  // turf: wet grass goes darker and glossier; snow whitens it; the ball goes orange on snow
  const wet = clamp(ENV.wet / 1.2, 0, 1); ground.material.roughness = lerp(0.95, 0.42, wet); ground.material.color.setScalar(lerp(1, 0.78, wet));
  if (ENV.snow > 0.2) ground.material.color.lerp(C(0xffffff), clamp(ENV.snow / 2, 0, 0.85)).multiplyScalar(1 + 0.8 * clamp(ENV.snow / 2, 0, 1));
  ballMesh.material.color.set(ENV.snow > 1 ? 0xFF7A1A : 0xffffff);
  bloom.strength = 0.4 + 0.35 * floodLvl;
  stepPrecip(dt);
}
// regenerate the turf for the chosen stadium: grass tone and its groundsman's mowing pattern
function paintStadium(st, month) {
  const c = CLIMATE[st.id]; const winter = st.lat > 0 ? [10, 11, 0, 1].includes(month) : [5, 6, 7].includes(month);
  PSTYLE = { mow: st.mow, turf: st.turf, wear: winter ? 0.55 : 0.3, shade: st.id === 'milan' && winter };
  paintPitch(pitchTex.image.getContext('2d'), pitchTex.image.width, pitchTex.image.height); pitchTex.needsUpdate = true;
  seatMat.color.set(st.seats);
}
