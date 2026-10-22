
// ============ WORLD: STADIUMS, CLIMATE, WEATHER, PITCH ============
// Five real host cities with researched monthly climate normals. Stadium names are fictional, modelled on
// each city's landmark ground. Everything below runs on match time, so a 5-minute half still lives through
// 45 minutes of weather, light and fatigue.
const CLIMATE = /*@@CLIMATE@@*/null;
const STADIUMS = [
  { id: 'london', name: 'The Arch', city: 'London', country: 'England', flag: '🇬🇧', lat: 51.556, lon: -0.28, alt: 40, tz: (m) => (m >= 3 && m <= 9 ? 1 : 0), cap: '90,000',
    grass: 'Hybrid grass, sand root zone', drain: 22, heated: true, roof: 'Partial roof', mow: 'stripes', turf: ['#2E7A3E', '#29703A'], seats: 0x9E1B22,
    kickoffs: ['12:30', '15:00', '17:30', '20:00'], blurb: 'Drizzle can arrive at any hour. Floodlights by 16:00 in winter.', grad: ['#1C2E52', '#7A1E2B'] },
  { id: 'madrid', name: 'Castellana Arena', city: 'Madrid', country: 'Spain', flag: '🇪🇸', lat: 40.453, lon: -3.688, alt: 660, tz: (m) => (m >= 3 && m <= 9 ? 2 : 1), cap: '83,000',
    grass: 'Hybrid grass on a retractable tray', drain: 25, heated: true, roof: 'Retractable roof', mow: 'checker', turf: ['#2F7A3B', '#2A6F36'], seats: 0xD9DDE3,
    kickoffs: ['14:00', '16:15', '18:30', '21:00'], blurb: 'Dry heat in summer, so La Liga kicks off at 21:00. Thin, dry air at 660 m.', grad: ['#3B2A12', '#C9A227'] },
  { id: 'rio', name: 'Arena Guanabara', city: 'Rio de Janeiro', country: 'Brazil', flag: '🇧🇷', lat: -22.912, lon: -43.23, alt: 10, tz: () => -3, cap: '78,000',
    grass: 'Bermuda grass', drain: 18, heated: false, roof: 'Ring roof', mow: 'wide', turf: ['#3A8A40', '#347E3A'], seats: 0x1E4FA8,
    kickoffs: ['16:00', '18:30', '21:30'], blurb: 'Summer is hot and humid with late-day downpours. Dew settles on night games.', grad: ['#0B5D3B', '#E2B714'] },
  { id: 'milan', name: 'Arena Lombarda', city: 'Milan', country: 'Italy', flag: '🇮🇹', lat: 45.478, lon: 9.124, alt: 130, tz: (m) => (m >= 3 && m <= 9 ? 2 : 1), cap: '75,000',
    grass: 'Hybrid grass, steep stands shade it', drain: 12, heated: true, roof: 'Full ring roof', mow: 'circles', turf: ['#2C6F3A', '#285F33'], seats: 0x8B1E2E,
    kickoffs: ['12:30', '15:00', '18:00', '20:45'], blurb: 'Po Valley fog in winter. The pitch gets little sun.', grad: ['#1A1A1A', '#8B1E2E'] },
  { id: 'mexico', name: 'Estadio Coloso', city: 'Mexico City', country: 'Mexico', flag: '🇲🇽', lat: 19.303, lon: -99.15, alt: 2240, tz: () => -6, cap: '83,000',
    grass: 'Hybrid grass', drain: 20, heated: false, roof: 'Ring roof', mow: 'diagonal', turf: ['#2F7D3C', '#2A7137'], seats: 0x2E6B3A,
    kickoffs: ['12:00', '17:00', '19:00', '21:00'], blurb: '2,240 m: the ball flies further and lungs burn. Afternoon storms in the rainy season.', grad: ['#0F4D2E', '#B3202A'] },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// weather states, rain rate (mm/h), mean persistence (min), cloud cover, base visibility (m)
const WX = {
  clear:    { label: 'Sunny', icon: '☀️', rain: 0, dur: 150, cloud: 0.05, vis: 20000 },
  partly:   { label: 'Partly cloudy', icon: '⛅', rain: 0, dur: 110, cloud: 0.45, vis: 20000 },
  overcast: { label: 'Overcast', icon: '☁️', rain: 0, dur: 140, cloud: 0.92, vis: 12000 },
  drizzle:  { label: 'Drizzle', icon: '🌦️', rain: 0.6, dur: 70, cloud: 0.95, vis: 6000 },
  rain:     { label: 'Rain', icon: '🌧️', rain: 3.5, dur: 55, cloud: 1, vis: 3000 },
  heavy:    { label: 'Heavy rain', icon: '🌧️', rain: 14, dur: 30, cloud: 1, vis: 900 },
  storm:    { label: 'Thunderstorm', icon: '⛈️', rain: 22, dur: 40, cloud: 1, vis: 700 },
  fog:      { label: 'Fog', icon: '🌫️', rain: 0, dur: 120, cloud: 0.85, vis: 140 },
  snow:     { label: 'Snow', icon: '❄️', rain: 1.2, dur: 80, cloud: 1, vis: 1200 },
};
// which states can follow which (fronts thicken gradually, storms build from cloud, fog lifts to cloud)
const WX_NEXT = { clear: ['partly', 'fog'], partly: ['clear', 'overcast', 'storm', 'drizzle'], overcast: ['partly', 'drizzle', 'rain', 'snow', 'fog'], drizzle: ['overcast', 'rain'],
  rain: ['drizzle', 'heavy', 'overcast'], heavy: ['rain', 'storm'], storm: ['heavy', 'rain', 'overcast'], fog: ['overcast', 'partly', 'clear'], snow: ['overcast', 'rain'] };
const ENV = { set: null, wx: 'clear', minute: 0, local: 15, temp: 15, td: 8, rh: 60, wind: 3, windDir: 0, gust: 1, wbgt: 15, rho: 1.225, rhoRatio: 1, water: 0, leaf: 0, wet: 0, dew: 0, snow: 0, frozen: false,
  sunEl: 30, sunAz: 180, light: 'day', vis: 20000, slick: 0, puddle: 0, log: [], events: [], coolingDue: [], strikes: 0, susp: null, seed: 0 };
let wordsRnd = mulberry(1); // reseeded per match in kickOff
let wrnd = mulberry(1); // reseeded per match so a setup + seed reproduces the same weather story
const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// one match seed, named sub-streams (play, words, tactics, setup); weather has its own mulberry(seed) in initEnv. No stream's draws change another's
const subStream = (seed, name) => mulberry(hash32(seed + ':' + name));
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const wgauss = () => { let u = 0, v = 0; while (!u) u = wrnd(); while (!v) v = wrnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const climateOf = (st, m) => { const c = CLIMATE[st.id]; const g = (k) => c[k] ? c[k][m] : 0; return { hi: g('hi'), lo: g('lo'), rh: g('rh'), rainDays: g('rainDays'), rainMm: g('rainMm'), thunder: g('thunderDays'), fog: g('fogDays'), snowD: g('snowDays'), sun: g('sunHours'), wind: g('windKmh'), cloud: g('cloudPct') / 100, conv: c.convective || 0 }; };
const satVP = (t) => 6.1094 * Math.exp(17.625 * t / (t + 243.04)); // hPa, Magnus
const dewFrom = (t, rh) => { const a = Math.log(Math.max(1, rh) / 100) + 17.625 * t / (243.04 + t); return 243.04 * a / (17.625 - a); };
// diurnal temperature curve: coolest near sunrise, warmest mid-afternoon
const diurnal = (h) => { h = ((h % 24) + 24) % 24; return h >= 6 && h <= 15 ? 0.5 - 0.5 * Math.cos(Math.PI * (h - 6) / 9) : 0.5 + 0.5 * Math.cos(Math.PI * (((h - 15 + 24) % 24)) / 15); };
// solar position (NOAA-style, mid-month day of year)
function solar(st, m, local) {
  const N = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349][m]; const decl = 23.44 * Math.sin(2 * Math.PI * (284 + N) / 365) * Math.PI / 180;
  const B = 2 * Math.PI * (N - 81) / 364; const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solarT = local - st.tz(m) + st.lon / 15 + eot / 60; const H = (solarT - 12) * 15 * Math.PI / 180; const lat = st.lat * Math.PI / 180;
  const el = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  const ws = Math.acos(clamp(-Math.tan(lat) * Math.tan(decl), -1, 1)) * 180 / Math.PI / 15; const noon = 12 + st.tz(m) - st.lon / 15 - eot / 60;
  return { el: el * 180 / Math.PI, az: (az * 180 / Math.PI + 360) % 360, sunrise: noon - ws, sunset: noon + ws };
}
const hhmm = (h) => { h = ((h % 24) + 24) % 24; const H = Math.floor(h), M = Math.round((h - H) * 60); return (M === 60 ? H + 1 : H) + ':' + String(M % 60).padStart(2, '0'); };
// hourly climatological odds of each weather family at this hour of this month
function wxOdds(st, m, hour) {
  const c = climateOf(st, m); const h = ((hour % 24) + 24) % 24;
  // convective cities rain mostly mid-afternoon to evening; others spread over the day
  const convShape = (h >= 14 && h <= 21) ? 2.4 : (h >= 22 || h <= 2) ? 0.9 : 0.35; const shape = lerp(1, convShape, c.conv);
  const tempHere = lerp(c.lo, c.hi, diurnal(h));
  let pStorm = clamp(c.thunder / 30.4 * 0.16 * (h >= 13 && h <= 22 ? 2.2 : 0.4), 0, 0.5);
  let pWet = clamp(c.rainDays / 30.4 * 0.28 * shape, 0, 0.75) ; const perDay = c.rainMm / Math.max(1, c.rainDays);
  const heavyShare = clamp((perDay - 4) / 14, 0.05, 0.6), drizzleShare = clamp(1 - perDay / 9, 0.1, 0.7);
  const fogShape = (h >= 20 || h <= 10) ? 1.8 : 0.25; let pFog = clamp(c.fog / 30.4 * 0.3 * fogShape, 0, 0.6);
  const pSnowFrac = tempHere < 1.5 && c.snowD > 0 ? clamp(c.snowD / Math.max(1, c.rainDays), 0.2, 0.9) : 0;
  pStorm = Math.min(pStorm, pWet * 0.8); pWet -= pStorm;
  const wet = { drizzle: pWet * drizzleShare, rain: pWet * (1 - drizzleShare - heavyShare * 0.6), heavy: pWet * heavyShare * 0.6 };
  const snow = (wet.drizzle + wet.rain + wet.heavy) * pSnowFrac; for (const k in wet) wet[k] *= 1 - pSnowFrac;
  const dry = Math.max(0, 1 - pStorm - pWet - pFog); const cl = clamp(c.cloud, 0.05, 0.95);
  const o = { clear: dry * (1 - cl) * 0.85, partly: dry * (0.15 * (1 - cl) + 0.45 * cl), overcast: dry * cl * 0.55, drizzle: wet.drizzle, rain: Math.max(0, wet.rain), heavy: wet.heavy, storm: pStorm, fog: pFog, snow };
  let s = 0; for (const k in o) s += o[k]; for (const k in o) o[k] /= s; return o;
}
const pick = (o) => { let r = wrnd(), s = 0; for (const k in o) { s += o[k]; if (r <= s) return k; } return Object.keys(o)[0]; };
// family odds for the setup screen (rain, storm, fog, snow over the 2 hours of a match)
function matchOdds(st, m, kick) {
  const acc = { sun: 0, cloud: 0, rain: 0, storm: 0, fog: 0, snow: 0 }; for (let i = 0; i < 4; i++) { const o = wxOdds(st, m, kick + i * 0.6); acc.sun += o.clear + o.partly * 0.6; acc.cloud += o.overcast + o.partly * 0.4; acc.rain += o.drizzle + o.rain + o.heavy; acc.storm += o.storm; acc.fog += o.fog; acc.snow += o.snow; }
  for (const k in acc) acc[k] /= 4;
  // chance of seeing it at least once in a ~2 h window is higher than the instantaneous odds
  return { sun: acc.sun, cloud: acc.cloud, rain: 1 - Math.pow(1 - acc.rain, 2.2), storm: 1 - Math.pow(1 - acc.storm, 2.2), fog: 1 - Math.pow(1 - acc.fog, 1.6), snow: 1 - Math.pow(1 - acc.snow, 2) };
}
const FORCE = { auto: null, sunny: 'clear', cloudy: 'overcast', rain: 'rain', storm: 'storm', fog: 'fog', snow: 'snow' };
// one-off draw of the match day: the day's own temperature anomaly, humidity, wind, and whether it rained before kick-off
function initEnv(set) {
  ENV.set = set; ENV.seed = set.seed; wrnd = mulberry(set.seed); const st = set.st, m = set.month, c = climateOf(st, m);
  ENV.anom = clamp(wgauss() * 2.4, -5, 5); ENV.rhAnom = wgauss() * 7; ENV.windBase = Math.max(0.5, c.wind / 3.6 * Math.exp(wgauss() * 0.35)); ENV.windDir = wrnd() * Math.PI * 2;
  ENV.local = set.kick; ENV.minute = 0; ENV.log = []; ENV.events = []; ENV.strikes = 0; ENV.susp = null; ENV.lastStrike = -99; ENV.snow = 0;
  const forced = FORCE[set.weather]; ENV.wx = forced || pick(wxOdds(st, m, set.kick));
  if (ENV.wx === 'snow' && lerp(c.lo, c.hi, diurnal(set.kick)) + ENV.anom > 3) ENV.anom -= (lerp(c.lo, c.hi, diurnal(set.kick)) + ENV.anom) - 1; // forced snow needs a cold day
  // antecedent moisture: rain in the hours before kick-off, groundsman's watering, evening dew
  let pre = 0; for (let h = 3; h >= 1; h--) { const o = wxOdds(st, m, set.kick - h); const r = wrnd(); if (r < o.heavy + o.storm) pre += 4; else if (r < o.heavy + o.storm + o.rain) pre += 1.6; else if (r < o.heavy + o.storm + o.rain + o.drizzle) pre += 0.4; }
  if (WX[ENV.wx].rain > 0) pre += WX[ENV.wx].rain * 0.4;
  // ponded water only from heavy pre-match rain; any rain or the groundsman's sprinklers leave the leaves wet
  ENV.water = clamp((pre - 2) * 0.25, 0, 2); ENV.leaf = pre > 0.3 ? 1 : set.water ? 0.5 : 0; ENV.dew = 0;
  updateEnv(0, true);
  // FIFA heat protocol: cooling breaks at 30' and 75' when WBGT at kick-off exceeds 32 °C
  ENV.coolingDue = ENV.wbgt > 32 ? [30, 75] : [];
  ENV.startWx = ENV.wx; logEnv(true);
}
function updateEnv(dtMin, first) {
  const set = ENV.set; if (!set) return; const st = set.st, m = set.month, c = climateOf(st, m);
  if (!first) { ENV.minute += dtMin; ENV.local += dtMin / 60; }
  // weather transitions: leave the current state at 1/persistence, choose the next by today's odds at this hour
  if (!first && set.dynamic) {
    const cur = WX[ENV.wx]; const pLeave = 1 - Math.exp(-dtMin / cur.dur);
    if (wrnd() < pLeave) {
      const o = wxOdds(st, m, ENV.local); const nx = {}; let s = 0;
      for (const k of WX_NEXT[ENV.wx]) { let w = o[k] + 0.02; if (k === 'snow' && ENV.temp > 2) w = 0; if (k === 'fog' && (ENV.wind > 4 || ENV.sunEl > 25)) w *= 0.1; nx[k] = w; s += w; }
      if (s > 0) { for (const k in nx) nx[k] /= s; const was = ENV.wx; ENV.wx = pick(nx); if (ENV.wx !== was) weatherChanged(was, ENV.wx); }
    }
  }
  const wx = WX[ENV.wx]; const sol = solar(st, m, ENV.local); ENV.sunEl = sol.el; ENV.sunAz = sol.az; ENV.sunset = sol.sunset; ENV.sunrise = sol.sunrise;
  // air temperature: diurnal climate curve + today's anomaly; cloud blunts daytime heating, rain cools the air
  const base = lerp(c.lo, c.hi, diurnal(ENV.local)) + ENV.anom; const sunny = clamp(ENV.sunEl / 40, 0, 1);
  const tTarget = base - wx.cloud * sunny * 1.8 - (wx.rain > 0 ? Math.min(4, 1 + wx.rain * 0.18) : 0) - (ENV.wx === 'storm' ? 2 : 0) - (ENV.wx === 'fog' && sunny < 0.2 ? 1.2 : 0);
  ENV.temp = first ? tTarget : lerp(ENV.temp, tTarget, clamp(dtMin / 25, 0, 1));
  // humidity: dew point holds roughly steady through the day; rain and fog saturate the air
  const tMean = (c.hi + c.lo) / 2; let td = dewFrom(tMean, clamp(c.rh + ENV.rhAnom, 15, 98)); if (wx.rain > 0 || ENV.wx === 'fog') td = Math.max(td, ENV.temp - (ENV.wx === 'fog' ? 0.3 : 1.2));
  ENV.td = Math.min(td, ENV.temp); ENV.rh = clamp(100 * satVP(ENV.td) / satVP(ENV.temp), 5, 100);
  // wind: storms gust hard, fog needs calm air; stadium bowls shelter the pitch to about half the open-air wind
  const wMul = ENV.wx === 'storm' ? 2.4 : ENV.wx === 'heavy' ? 1.6 : ENV.wx === 'fog' ? 0.3 : ENV.wx === 'rain' ? 1.25 : 1; ENV.windDir += (wgauss() * 0.05) * Math.sqrt(Math.max(dtMin, 0.01));
  ENV.wind = ENV.windBase * wMul; ENV.gust = ENV.wx === 'storm' ? 1.8 : 1.35;
  // heat stress: simplified WBGT (Australian BoM) plus a direct-sun term
  const e = ENV.rh / 100 * satVP(ENV.temp); ENV.wbgt = 0.567 * ENV.temp + 0.393 * e + 3.94 + 2.6 * sunny * (1 - wx.cloud) - Math.min(1.5, ENV.wind * 0.15);
  // air density from altitude (barometric formula) and temperature: drag and swerve scale with it
  const P = 101325 * Math.pow(1 - 2.25577e-5 * st.alt, 5.25588); ENV.rho = P / (287.05 * (ENV.temp + 273.15)) * (1 - 0.378 * e * 100 / P); ENV.rhoRatio = ENV.rho / 1.225;
  // pitch water budget (mm on the surface): rain in, drainage and evaporation out; dew forms on clear calm nights near the dew point
  const rainIn = (ENV.wx === 'snow' && ENV.temp < 1) ? 0 : wx.rain; const roofCut = st.roof === 'Retractable roof' && (ENV.wx === 'storm' || ENV.wx === 'heavy') && set.roofAuto ? 0.1 : 1;
  const evap = Math.max(0.02, (0.04 + 0.012 * Math.max(0, ENV.temp) + 0.03 * ENV.wind) * (1 - ENV.rh / 110) * (0.4 + sunny));
  if (!first) {
    // ponding: rain beyond what the sand root zone can take in stays on the surface (drain = infiltration, mm/h)
    ENV.water += (rainIn * roofCut - st.drain * ENV.water / (ENV.water + 1.5) - evap) * dtMin / 60; ENV.water = clamp(ENV.water, 0, 8);
    // leaf wetness: soaks within minutes of rain, dries over the next hour or so (faster in sun, heat and wind)
    ENV.leaf = rainIn * roofCut > 0.2 ? Math.min(1, ENV.leaf + dtMin / 5) : Math.max(0, ENV.leaf - dtMin * evap / 9);
    const dewOK = ENV.sunEl < 3 && ENV.temp - ENV.td < 2.2 && ENV.wind < 3.5 && wx.rain === 0; ENV.dew = clamp(ENV.dew + (dewOK ? 0.25 : -0.6 * (0.3 + sunny)) * dtMin / 60, 0, 0.35);
    if (ENV.wx === 'snow' && ENV.temp < 1.5) ENV.snow = Math.min(12, ENV.snow + 3 * dtMin / 60 * (st.heated ? 0.7 : 1)); else ENV.snow = Math.max(0, ENV.snow - (Math.max(0, ENV.temp) * 0.25 + (wx.rain > 0 ? 0.8 : 0)) * dtMin / 60);
  } else if (ENV.sunEl < 3 && ENV.temp - ENV.td < 2.5 && wx.rain === 0) ENV.dew = 0.2;
  ENV.frozen = ENV.temp < -1.5 && !st.heated;
  ENV.vis = ENV.wx === 'fog' ? clamp(wx.vis * (1 + 0.5 * wgauss() * 0.3), 60, 400) : wx.vis;
  ENV.light = ENV.sunEl > 8 ? 'day' : ENV.sunEl > -6 ? 'dusk' : 'night';
  // what the players feel
  const surf = ENV.water + 0.6 * (ENV.leaf || 0) + ENV.dew; ENV.wet = surf; ENV.slick = clamp(surf / 1.2, 0, 1) + (ENV.snow > 0.5 ? 0.4 : 0); ENV.puddle = clamp((ENV.water - 1.6) / 2.5, 0, 1);
  ENV.pitch = ENV.snow > 1 ? 'Snow-covered' : ENV.frozen ? 'Frozen, hard' : ENV.water > 3.2 ? 'Waterlogged' : ENV.water > 1.6 ? 'Standing water' : surf > 0.5 ? 'Wet, quick' : surf > 0.12 ? (ENV.dew > 0.6 * (ENV.leaf || 0) + ENV.water ? 'Dewy, slick' : 'Damp') : 'Dry, firm';
  ENV.heat = clamp((ENV.wbgt - 21) / 11, 0, 1.3); ENV.altF = st.alt / 2240;
}
function weatherChanged(a, b) {
  const lines = { drizzle: 'A fine drizzle is drifting across the stadium.', rain: 'Rain is falling now. The surface will start to quicken.', heavy: 'The heavens have opened. Water is gathering on the pitch.', storm: 'Thunder rolls in over the stadium. The officials are watching the sky.',
    fog: 'Fog is rolling in. Visibility is dropping.', overcast: 'Cloud has closed in overhead.', partly: 'Breaks in the cloud now.', clear: 'The sky has cleared.', snow: 'Snow is falling!' };
  if (S.started) { say(lines[b] || ''); toast(WX[b].icon + '<small>' + WX[b].label.toUpperCase() + '</small>', 2.2); }
  dataEvent('weather_change', { from: a, to: b });
}
function logEnv(force) {
  const r = { minute: Math.round(ENV.minute), local: hhmm(ENV.local), weather: ENV.wx, tempC: +ENV.temp.toFixed(1), dewPointC: +ENV.td.toFixed(1), rh: Math.round(ENV.rh), windKmh: +(ENV.wind * 3.6).toFixed(1), windDirDeg: Math.round((ENV.windDir * 180 / Math.PI + 360) % 360),
    wbgtC: +ENV.wbgt.toFixed(1), airDensity: +ENV.rho.toFixed(3), sunElevDeg: +ENV.sunEl.toFixed(1), light: ENV.light, visibilityM: Math.round(ENV.vis), pitchWaterMm: +ENV.water.toFixed(2), dew: +ENV.dew.toFixed(2), snowCm: +ENV.snow.toFixed(1), pitch: ENV.pitch,
    score: S.score.slice(), avgStamina: players.length ? +(players.reduce((a, p) => a + p.stamina, 0) / players.length).toFixed(3) : 1 };
  ENV.log.push(r);
}
// every match event goes to the dataset log and to any live subscriber (insight, overlay and personalisation modules)
const EVT_SUBS = []; function onMatchEvent(f) { EVT_SUBS.push(f); }
function dataEvent(type, extra) {
  const ev = Object.assign({ minute: +(ENV.minute).toFixed(1), local: hhmm(ENV.local), type, weather: ENV.wx, tempC: +ENV.temp.toFixed(1), pitch: ENV.pitch, pitchWaterMm: +ENV.water.toFixed(2) }, extra || {});
  ENV.events.push(ev); if (ENV.events.length > 20000) ENV.events.shift();
  ev.simT = +S.t.toFixed(2); for (const f of EVT_SUBS) { try { f(ev); } catch (e) { console.error(e); } }
}
// lightning: strikes land at random distances while a storm sits overhead; inside 13 km (8 miles, FIFA) the referee suspends play until 30 minutes pass without a strike
function stormTick(dtMin) {
  if (ENV.wx !== 'storm') return; const rate = 0.35; // cloud-to-ground strikes per minute within ~20 km of a storm overhead
  if (wrnd() < rate * dtMin) {
    const km = 1.5 + wrnd() * 18; ENV.flash = 1; ENV.flashKm = km; ENV.strikes++; dataEvent('lightning', { km: +km.toFixed(1) });
    if (km < 13 && S.started && !ENV.susp && !S.over && !S.ht && !S.hold) { ENV.susp = { left: 7, why: 'lightning' }; say('Lightning ' + km.toFixed(0) + ' km away. The referee takes the players off. Play is suspended.'); }
  }
}
