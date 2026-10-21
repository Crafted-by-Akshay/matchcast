// ============ FAN MODES: one match, five ways to watch it, six languages, two full-time recaps ============
// Personalisation layer (brief stage e). It never edits the engine: it wraps say/toast/hud/updateCamera/stepSim/fullTime/
// summary/openTalk/renderTalk by reassigning their bindings, listens on the match event bus, and reads state every frame.
const FAN = { mode: 'analyst', club: 0, player: null, metric: 'speed', subj: 'teams', lang: 'en', voice: false, prevCam: null, capEn: '', lastOwner: null, lastPI: null, recap: null, nextLine: 0, popOpen: false, fr: 0 };
const FAN_MODES = [['analyst', '📊'], ['casual', '🍿'], ['club', '🛡️'], ['player', '🎯'], ['metric', '🔢']];
const FAN_METRICS = ['speed', 'dist', 'pass', 'poss', 'xg'];
const FAN_LANGS = [['en', 'English', 'en-GB'], ['ta', 'தமிழ்', 'ta-IN'], ['es', 'Español', 'es-ES'], ['hi', 'हिन्दी', 'hi-IN'], ['fr', 'Français', 'fr-FR'], ['ar', 'العربية', 'ar-SA']];
const FAN_LNAME = { en: 'English', ta: 'Tamil', es: 'Spanish', hi: 'Hindi', fr: 'French', ar: 'Arabic' };
// ---- fixed UI labels, hand-written per language (never machine-translated at runtime) ----
const FANL = {
  en: { q: 'How do you want to watch?', wm: 'Watch mode', analyst: 'Analyst', casual: 'Casual fan', club: 'My club', player: 'Player focus', metric: 'One metric',
    d_analyst: 'Every number: xG, pass quality, live stats', d_casual: 'Just the story and the big moments', d_club: 'Back one side. We score, we celebrate', d_player: 'Follow one player all match', d_metric: 'Only the number you care about',
    yclub: 'Your club', yplayer: 'Your player', ymetric: 'Your metric', both: 'Both teams', speed: 'Top speed', dist: 'Distance', pass: 'Pass accuracy', poss: 'Possession', xg: 'xG (expected goals)',
    lang: 'Language', voice: 'Read captions aloud', noai: 'Live translation needs Claude here. Captions stay in English.', follow: 'Follow', following: 'Following', done: 'Done', pick: 'Pick a player…',
    touch: 'Touches', passes: 'Passes', top: 'Top speed', spr: 'Sprints', tk: 'Tackles', sh: 'Shots', sta: 'Stamina', p90: 'per-90 pace',
    sposs: 'Poss', sshots: 'Shots', sot: 'On target', sxg: 'xG', spass: 'Pass %', spulse: 'Momentum',
    ra: 'Analyst recap', rf: 'Fan story', km: 'Key moments', tap: 'Tap a moment to see why it mattered', byai: 'Written by Claude', bytpl: 'Written from the event log', rcen: 'Shown in English: AI translation is not available here.',
    GOAL: 'GOAL', WE: 'WE SCORE!', SAVED: 'SAVED', YC: 'YELLOW CARD', RC: 'RED CARD', PEN: 'PENALTY', ADDED: 'MINUTES ADDED', SH2: 'SECOND HALF', CHANCE: 'CHANCE FOR US', CLOSE: 'SO CLOSE!', RES: 'PLAY RESUMES',
    k_goal: 'Goal', k_card: 'Card', k_chance: 'Big chance', k_turn: 'Turning point' },
  ta: { q: 'எப்படிப் பார்க்க விரும்புகிறீர்கள்?', wm: 'பார்வை முறை', analyst: 'பகுப்பாய்வாளர்', casual: 'சாதாரண ரசிகர்', club: 'என் அணி', player: 'வீரர் கவனம்', metric: 'ஒரே அளவீடு',
    d_analyst: 'ஒவ்வொரு எண்ணும்: xG, பாஸ் தரம், நேரலை புள்ளிவிவரம்', d_casual: 'கதையும் பெரிய தருணங்களும் மட்டும்', d_club: 'ஒரு அணியின் பக்கம். நாம் அடித்தால் நாம் கொண்டாடுவோம்', d_player: 'ஆட்டம் முழுவதும் ஒரு வீரரைப் பின்தொடருங்கள்', d_metric: 'உங்களுக்கு முக்கியமான எண் மட்டும்',
    yclub: 'உங்கள் அணி', yplayer: 'உங்கள் வீரர்', ymetric: 'உங்கள் அளவீடு', both: 'இரு அணிகளும்', speed: 'அதிகபட்ச வேகம்', dist: 'கடந்த தூரம்', pass: 'பாஸ் துல்லியம்', poss: 'பந்து கட்டுப்பாடு', xg: 'xG (எதிர்பார்க்கப்படும் கோல்கள்)',
    lang: 'மொழி', voice: 'வர்ணனையை உரக்கப் படி', noai: 'நேரலை மொழிபெயர்ப்புக்கு Claude தேவை. வர்ணனை ஆங்கிலத்தில் தொடரும்.', follow: 'பின்தொடர்', following: 'பின்தொடர்கிறது', done: 'சரி', pick: 'ஒரு வீரரைத் தேர்ந்தெடுங்கள்…',
    touch: 'தொடுதல்கள்', passes: 'பாஸ்கள்', top: 'அதிகபட்ச வேகம்', spr: 'வேக ஓட்டங்கள்', tk: 'டேக்கிள்கள்', sh: 'ஷாட்கள்', sta: 'சக்தி', p90: '90 நிமிட வேகம்',
    sposs: 'கட்டுப்பாடு', sshots: 'ஷாட்கள்', sot: 'இலக்கில்', sxg: 'xG', spass: 'பாஸ் %', spulse: 'உத்வேகம்',
    ra: 'பகுப்பாய்வு சுருக்கம்', rf: 'ரசிகர் கதை', km: 'முக்கிய தருணங்கள்', tap: 'ஒரு தருணத்தைத் தொட்டு அது ஏன் முக்கியம் என்று பாருங்கள்', byai: 'Claude எழுதியது', bytpl: 'நிகழ்வுப் பதிவிலிருந்து எழுதப்பட்டது', rcen: 'ஆங்கிலத்தில் காட்டப்படுகிறது: இங்கே AI மொழிபெயர்ப்பு இல்லை.',
    GOAL: 'கோல்!', WE: 'நாம் கோல் அடித்தோம்!', SAVED: 'தடுக்கப்பட்டது', YC: 'மஞ்சள் அட்டை', RC: 'சிவப்பு அட்டை', PEN: 'பெனால்டி', ADDED: 'கூடுதல் நிமிடங்கள்', SH2: 'இரண்டாம் பாதி', CHANCE: 'நமக்கு வாய்ப்பு!', CLOSE: 'மயிரிழையில்!', RES: 'ஆட்டம் மீண்டும் தொடங்குகிறது',
    k_goal: 'கோல்', k_card: 'அட்டை', k_chance: 'பெரிய வாய்ப்பு', k_turn: 'திருப்புமுனை' },
  es: { q: '¿Cómo quieres ver el partido?', wm: 'Modo de vista', analyst: 'Analista', casual: 'Aficionado casual', club: 'Mi club', player: 'Foco en un jugador', metric: 'Una métrica',
    d_analyst: 'Todos los números: xG, calidad de pase, estadísticas en vivo', d_casual: 'Solo la historia y los grandes momentos', d_club: 'Ponte de un lado. Si marcamos, lo celebramos', d_player: 'Sigue a un jugador todo el partido', d_metric: 'Solo el dato que te importa',
    yclub: 'Tu club', yplayer: 'Tu jugador', ymetric: 'Tu métrica', both: 'Ambos equipos', speed: 'Velocidad máxima', dist: 'Distancia', pass: 'Precisión de pase', poss: 'Posesión', xg: 'xG (goles esperados)',
    lang: 'Idioma', voice: 'Leer la narración en voz alta', noai: 'La traducción en vivo necesita Claude. La narración sigue en inglés.', follow: 'Seguir', following: 'Siguiendo', done: 'Listo', pick: 'Elige un jugador…',
    touch: 'Toques', passes: 'Pases', top: 'Velocidad máx.', spr: 'Sprints', tk: 'Entradas', sh: 'Tiros', sta: 'Energía', p90: 'ritmo por 90',
    sposs: 'Pos.', sshots: 'Tiros', sot: 'A puerta', sxg: 'xG', spass: 'Pase %', spulse: 'Impulso',
    ra: 'Resumen del analista', rf: 'La historia del aficionado', km: 'Momentos clave', tap: 'Toca un momento para ver por qué importó', byai: 'Escrito por Claude', bytpl: 'Escrito a partir del registro de eventos', rcen: 'Se muestra en inglés: la traducción con IA no está disponible aquí.',
    GOAL: '¡GOL!', WE: '¡GOL NUESTRO!', SAVED: 'PARADA', YC: 'TARJETA AMARILLA', RC: 'TARJETA ROJA', PEN: 'PENALTI', ADDED: 'MINUTOS AÑADIDOS', SH2: 'SEGUNDO TIEMPO', CHANCE: '¡OCASIÓN NUESTRA!', CLOSE: '¡CASI!', RES: 'SE REANUDA EL JUEGO',
    k_goal: 'Gol', k_card: 'Tarjeta', k_chance: 'Gran ocasión', k_turn: 'Punto de inflexión' },
  hi: { q: 'आप मैच कैसे देखना चाहते हैं?', wm: 'देखने का तरीका', analyst: 'विश्लेषक', casual: 'आम दर्शक', club: 'मेरी टीम', player: 'खिलाड़ी पर नज़र', metric: 'एक पैमाना',
    d_analyst: 'हर आँकड़ा: xG, पास की गुणवत्ता, लाइव आँकड़े', d_casual: 'सिर्फ़ कहानी और बड़े पल', d_club: 'एक टीम का साथ दें। हम गोल करें, हम जश्न मनाएँ', d_player: 'पूरे मैच एक खिलाड़ी को फ़ॉलो करें', d_metric: 'सिर्फ़ वही आँकड़ा जो आपके लिए मायने रखता है',
    yclub: 'आपकी टीम', yplayer: 'आपका खिलाड़ी', ymetric: 'आपका पैमाना', both: 'दोनों टीमें', speed: 'सर्वाधिक रफ़्तार', dist: 'तय की गई दूरी', pass: 'पास सटीकता', poss: 'गेंद पर कब्ज़ा', xg: 'xG (अपेक्षित गोल)',
    lang: 'भाषा', voice: 'कमेंट्री बोलकर सुनाएँ', noai: 'लाइव अनुवाद के लिए यहाँ Claude चाहिए। कमेंट्री अंग्रेज़ी में रहेगी।', follow: 'फ़ॉलो करें', following: 'फ़ॉलो हो रहा है', done: 'ठीक है', pick: 'खिलाड़ी चुनें…',
    touch: 'टच', passes: 'पास', top: 'सर्वाधिक रफ़्तार', spr: 'स्प्रिंट', tk: 'टैकल', sh: 'शॉट', sta: 'स्टैमिना', p90: 'प्रति 90 रफ़्तार',
    sposs: 'कब्ज़ा', sshots: 'शॉट', sot: 'निशाने पर', sxg: 'xG', spass: 'पास %', spulse: 'लय',
    ra: 'विश्लेषक सारांश', rf: 'प्रशंसक की कहानी', km: 'अहम पल', tap: 'कोई पल चुनें और देखें कि वह क्यों अहम था', byai: 'Claude ने लिखा', bytpl: 'इवेंट लॉग से लिखा गया', rcen: 'अंग्रेज़ी में दिखाया गया: यहाँ AI अनुवाद उपलब्ध नहीं है।',
    GOAL: 'गोल!', WE: 'हमने गोल किया!', SAVED: 'बचाव!', YC: 'पीला कार्ड', RC: 'लाल कार्ड', PEN: 'पेनल्टी', ADDED: 'अतिरिक्त मिनट', SH2: 'दूसरा हाफ़', CHANCE: 'हमारे लिए मौका!', CLOSE: 'बस ज़रा-सा चूके!', RES: 'खेल फिर शुरू',
    k_goal: 'गोल', k_card: 'कार्ड', k_chance: 'बड़ा मौका', k_turn: 'निर्णायक मोड़' },
  fr: { q: 'Comment voulez-vous regarder le match ?', wm: 'Mode de visionnage', analyst: 'Analyste', casual: 'Fan occasionnel', club: 'Mon club', player: 'Focus joueur', metric: 'Une seule stat',
    d_analyst: 'Tous les chiffres : xG, qualité de passe, stats en direct', d_casual: 'L\'histoire et les grands moments, c\'est tout', d_club: 'Choisissez votre camp. On marque, on fête ça', d_player: 'Suivez un joueur tout le match', d_metric: 'Juste le chiffre qui compte pour vous',
    yclub: 'Votre club', yplayer: 'Votre joueur', ymetric: 'Votre stat', both: 'Les deux équipes', speed: 'Vitesse max', dist: 'Distance', pass: 'Précision des passes', poss: 'Possession', xg: 'xG (buts attendus)',
    lang: 'Langue', voice: 'Lire les commentaires à voix haute', noai: 'La traduction en direct nécessite Claude. Les commentaires restent en anglais.', follow: 'Suivre', following: 'Suivi', done: 'OK', pick: 'Choisissez un joueur…',
    touch: 'Touches', passes: 'Passes', top: 'Vitesse max', spr: 'Sprints', tk: 'Tacles', sh: 'Tirs', sta: 'Énergie', p90: 'rythme sur 90',
    sposs: 'Poss.', sshots: 'Tirs', sot: 'Cadrés', sxg: 'xG', spass: 'Passes %', spulse: 'Dynamique',
    ra: 'Résumé de l\'analyste', rf: 'Le récit du supporter', km: 'Moments clés', tap: 'Touchez un moment pour voir pourquoi il a compté', byai: 'Écrit par Claude', bytpl: 'Écrit à partir du journal des événements', rcen: 'Affiché en anglais : la traduction par IA n\'est pas disponible ici.',
    GOAL: 'BUT !', WE: 'ON MARQUE !', SAVED: 'ARRÊT', YC: 'CARTON JAUNE', RC: 'CARTON ROUGE', PEN: 'PENALTY', ADDED: 'MINUTES AJOUTÉES', SH2: 'DEUXIÈME MI-TEMPS', CHANCE: 'OCCASION POUR NOUS !', CLOSE: 'SI PRÈS !', RES: 'REPRISE DU JEU',
    k_goal: 'But', k_card: 'Carton', k_chance: 'Grosse occasion', k_turn: 'Tournant' },
  ar: { q: 'كيف تريد أن تشاهد المباراة؟', wm: 'طريقة المشاهدة', analyst: 'محلل', casual: 'مشجع عادي', club: 'فريقي', player: 'التركيز على لاعب', metric: 'مقياس واحد',
    d_analyst: 'كل الأرقام: الأهداف المتوقعة، جودة التمرير، إحصاءات مباشرة', d_casual: 'القصة واللحظات الكبيرة فقط', d_club: 'اختر جانبك. نسجّل فنحتفل', d_player: 'تابع لاعبًا واحدًا طوال المباراة', d_metric: 'الرقم الذي يهمك فقط',
    yclub: 'فريقك', yplayer: 'لاعبك', ymetric: 'مقياسك', both: 'الفريقان', speed: 'السرعة القصوى', dist: 'المسافة المقطوعة', pass: 'دقة التمرير', poss: 'الاستحواذ', xg: 'xG (الأهداف المتوقعة)',
    lang: 'اللغة', voice: 'قراءة التعليق بصوت عالٍ', noai: 'الترجمة المباشرة تحتاج إلى Claude هنا. سيبقى التعليق بالإنجليزية.', follow: 'تابِع', following: 'قيد المتابعة', done: 'تم', pick: 'اختر لاعبًا…',
    touch: 'لمسات', passes: 'تمريرات', top: 'السرعة القصوى', spr: 'انطلاقات سريعة', tk: 'تدخلات', sh: 'تسديدات', sta: 'اللياقة', p90: 'المعدل لكل 90 دقيقة',
    sposs: 'استحواذ', sshots: 'تسديدات', sot: 'على المرمى', sxg: 'xG', spass: 'تمرير %', spulse: 'الزخم',
    ra: 'ملخص المحلل', rf: 'حكاية المشجع', km: 'لحظات حاسمة', tap: 'اضغط على لحظة لترى لماذا كانت مهمة', byai: 'كتبه Claude', bytpl: 'مكتوب من سجل الأحداث', rcen: 'معروض بالإنجليزية: الترجمة بالذكاء الاصطناعي غير متاحة هنا.',
    GOAL: 'هدف!', WE: 'سجّلنا!', SAVED: 'تصدٍّ!', YC: 'بطاقة صفراء', RC: 'بطاقة حمراء', PEN: 'ركلة جزاء', ADDED: 'دقائق إضافية', SH2: 'الشوط الثاني', CHANCE: 'فرصة لنا!', CLOSE: 'كادت!', RES: 'استئناف اللعب',
    k_goal: 'هدف', k_card: 'بطاقة', k_chance: 'فرصة كبيرة', k_turn: 'نقطة تحول' },
};
const fanT = (k) => (FANL[FAN.lang] && FANL[FAN.lang][k]) || FANL.en[k] || k;
const fanRTL = () => FAN.lang === 'ar';
const fanEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fanByName = (n) => players.find((p) => p.name === n);
const fanOrd = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const fanMin = (e) => Math.max(1, Math.floor(e.minute) + 1);

// ---- player tracker: a small reusable per-player odometer fed from the sim step ----
// Distance sums frame-to-frame displacement (jumps over 1.5 m are restarts, not running). Speed is smoothed so one
// physics tick can't set a record; a sprint starts above 7.0 m/s (25 km/h) and ends below 5.5 m/s (hysteresis).
const PTRK = new Map();
function trackerReset() { PTRK.clear(); for (const p of players) PTRK.set(p, { d: 0, t: 0, v: 0, top: 0, spr: 0, inSpr: false, touch: 0, pa: 0, pc: 0, tk: 0, sh: 0, xg: 0, last: p.pos2.clone() }); FAN.lastOwner = null; FAN.lastPI = null; }
function trackPlayers(dt) {
  if (!S.started || S.over || !PTRK.size) return;
  for (const p of players) { const r = PTRK.get(p); if (!r || p.off) continue; const dx = p.pos2.distanceTo(r.last); if (dx < 1.5 && !S.hold) { r.d += dx; r.t += dt; } r.last.copy(p.pos2);
    const v = p.vel.length(); r.v += (v - r.v) * Math.min(1, dt * 6); if (r.v > r.top) r.top = r.v; if (!r.inSpr && r.v > 7.0) { r.inSpr = true; r.spr++; if (p === FAN.player) fanPlayerLine('spr', r); } else if (r.inSpr && r.v < 5.5) r.inSpr = false; }
  if (S.owner && S.owner !== FAN.lastOwner) { const r = PTRK.get(S.owner); if (r) r.touch++; } FAN.lastOwner = S.owner;
  const pi = S.passInfo; if (pi && pi.done && pi !== FAN.lastPI) { FAN.lastPI = pi; if (pi.kind !== 'throw-in' && pi.kind !== 'throw') { const r = PTRK.get(pi.from); if (r) r.pc++; if (pi.from === FAN.player) fanPlayerLine('pass', r); } }
}
function playerStats(p) { const r = PTRK.get(p); if (!r) return null; return { name: p.name, team: p.T.key, touches: r.touch, passesCompleted: r.pc, passesAttempted: r.pa, distanceKm: +(r.d / 1000).toFixed(2), per90Km: r.t > 20 ? +(r.d / r.t * 5400 / 1000).toFixed(1) : null, topSpeedKmh: +(r.top * 3.6).toFixed(1), sprints: r.spr, tackles: r.tk, shots: r.sh, xg: +r.xg.toFixed(2), staminaPct: Math.round(p.stamina * 100) }; }
// team-level metrics for the One metric mode, the strip and the recap
function teamMetric(k, ti) {
  const ps = players.filter((p) => p.ti === ti).map((p) => [p, PTRK.get(p)]).filter((x) => x[1]);
  if (k === 'speed') { const b = ps.sort((a, b) => b[1].top - a[1].top)[0]; return b ? { v: b[1].top * 3.6, txt: (b[1].top * 3.6).toFixed(1), unit: 'km/h', who: surname(b[0].name) } : { v: 0, txt: '–' }; }
  if (k === 'dist') { const d = ps.reduce((a, x) => a + x[1].d, 0) / 1000; return { v: d, txt: d.toFixed(2), unit: 'km' }; }
  if (k === 'pass') { const v = STATS.passes[ti] ? STATS.done[ti] / STATS.passes[ti] * 100 : 0; return { v, txt: Math.round(v) + '%', unit: STATS.done[ti] + '/' + STATS.passes[ti] }; }
  if (k === 'poss') { const v = possPct(ti); return { v, txt: v + '%' }; }
  return { v: STATS.xg[ti], txt: STATS.xg[ti].toFixed(2), unit: STATS.shots[ti] + ' ' + fanT('sshots').toLowerCase() };
}
function playerMetric(k, p) {
  const r = PTRK.get(p); if (!r) return { v: 0, txt: '–' };
  if (k === 'speed') return { v: r.top * 3.6, txt: (r.top * 3.6).toFixed(1), unit: 'km/h' };
  if (k === 'dist') return { v: r.d / 1000, txt: (r.d / 1000).toFixed(2), unit: 'km' + (r.t > 20 ? ' · ' + (r.d / r.t * 5.4).toFixed(1) + ' ' + fanT('p90') : '') };
  if (k === 'pass') return { v: r.pa ? r.pc / r.pa * 100 : 0, txt: r.pa ? Math.round(r.pc / r.pa * 100) + '%' : '–', unit: r.pc + '/' + r.pa };
  if (k === 'poss') { const tot = [...PTRK.values()].filter((x, i) => players[i] && players[i].ti === p.ti).reduce((a, x) => a + x.touch, 0); return { v: r.touch, txt: r.touch, unit: fanT('touch').toLowerCase() + (tot ? ' · ' + Math.round(r.touch / tot * 100) + '%' : '') }; }
  return { v: r.xg, txt: r.xg.toFixed(2), unit: r.sh + ' ' + fanT('sh').toLowerCase() };
}
// momentum over the last 5 match minutes: shots, chance quality, passing volume and high regains. Uses the Explain layer's pulse when present.
function fanPulse() {
  const X = window.MCX; try { const v = X && (typeof X.pulse === 'function' ? X.pulse() : X.pulse); if (Array.isArray(v) && v.length === 2) return v.map(Number); if (v && v.home != null) return [+v.home, +v.away]; if (typeof v === 'number') return [50 + v / 2, 50 - v / 2]; } catch (e) {}
  const E = ENV.events.filter((e) => e.minute >= ENV.minute - 5); const m = [1, 1];
  for (const e of E) { const ti = e.team === TEAMS[0].key ? 0 : e.team === TEAMS[1].key ? 1 : -1; if (ti < 0) continue; if (e.type === 'shot') m[ti] += 2 + (e.xg || 0) * 8; if (e.type === 'pass') m[ti] += 0.15; if (e.type === 'turnover' && e.ownX > 60) m[ti] += 1; if (e.type === 'corner') m[ti] += 0.6; }
  const s = m[0] + m[1]; return [Math.round(m[0] / s * 100), Math.round(m[1] / s * 100)];
}
// pass difficulty 0-99: the Explain layer's rating when present, otherwise distance, kind and pressure on the passer
function fanPassDiff(pi) {
  const X = window.MCX; try { if (X && typeof X.passDifficulty === 'function') { const v = X.passDifficulty(pi); if (v != null) return Math.round(v); } } catch (e) {}
  if (pi.difficulty != null) return pi.difficulty; const d = pi.from.pos2.distanceTo(pi.to.pos2); const press = Math.min(...teamOf(1 - pi.from.ti).map((o) => o.pos2.distanceTo(pi.from.pos2)));
  const k = /lofted|long|cross|through/.test(pi.kind || '') ? 18 : 0; return Math.round(clamp(d * 1.4 + k + (press < 2.5 ? 22 : press < 6 ? 10 : 0), 3, 97));
}

// ---- the commentary voice: the same event, worded for the viewer's mode ----
const FAN_LINE = (s) => s.replace(/, \d+ km\/h/g, '').replace(/\s*xG [\d.]+/g, '');
function fanVoice(line) {
  if (!line || !S.started) return line; const m = FAN.mode; let L = line, x;
  const si = S.shotInfo && S.t - S.shotInfo.t < 2.5 ? S.shotInfo : null, pi = S.passInfo;
  if (m === 'analyst') {
    if ((x = /^(.+?) (curls one towards the far corner|lets fly)/.exec(L)) && si) L += ' xG ' + si.xg.toFixed(2) + ' from ' + Math.round(si.p.pos2.distanceTo(goalOf(si.p.ti))) + ' m; ' + si.p.T.key + ' now ' + STATS.xg[si.p.ti].toFixed(2) + ' xG from ' + STATS.shots[si.p.ti] + ' shots.';
    else if (/^Cut out by/.test(L) && pi) L += ' The ' + pi.kind + ' rated quality ' + pi.pq + ', difficulty ' + fanPassDiff(pi) + '.';
    else if ((x = /^(.+) wins it for (.+)\.$/.exec(L))) { const p = fanByName(x[1]); if (p) { const ox = Math.round(w2own(p.ti, p.pos2).x); L += ' Regain ' + ox + ' m from own goal' + (ox > 60 ? ': a high turnover.' : '.'); } }
    else if (/^Corner to/.test(L)) L += ' Corners so far ' + ENV.events.filter((e) => e.type === 'corner' && e.team === TEAMS[0].key).length + '–' + ENV.events.filter((e) => e.type === 'corner' && e.team === TEAMS[1].key).length + '.';
    else if (/^GOAL!/.test(L)) L += ' Match xG ' + STATS.xg.map((v) => v.toFixed(2)).join('–') + ', shots ' + STATS.shots.join('–') + (si ? '; this chance was worth ' + si.xg.toFixed(2) + '.' : '.');
    else if (/(trips|clips|hauls back|catches) /.test(L)) L += ' Fouls ' + STATS.fouls.join('–') + '.';
    return L;
  }
  if (m === 'casual' || m === 'club') {
    L = FAN_LINE(L);
    if ((x = /^(.+?) (curls one towards the far corner|lets fly)/.exec(L))) L = (si && si.xg > 0.25 ? 'Big chance! ' : '') + surname(x[1]) + ' has a go!';
    else if ((x = /^Cut out by (.+)\.$/.exec(L))) L = surname(x[1]) + ' reads it and steals the ball!';
    else if ((x = /^(.+) wins it for (.+)\.$/.exec(L))) L = surname(x[1]) + ' wins the ball back for ' + x[2] + '.';
    else if ((x = /^The flag is up\. (.+) strayed offside\.$/.exec(L))) L = 'Offside! ' + surname(x[1]) + ' went a moment too early.';
    else if ((x = /^(.+?) (goes to ground and catches|clips|hauls back|trips) (.+?)\. (PENALTY!|Free kick\.)$/.exec(L))) L = 'Foul by ' + surname(x[1]) + '. ' + (x[4] === 'PENALTY!' ? 'Penalty!' : 'Free kick.');
    else if ((x = /^What a save from (.+), tipped away!$/.exec(L))) L = 'Wow! ' + surname(x[1]) + ' keeps it out!';
    else if ((x = /^GOAL! (.+) scores\./.exec(L)) && m === 'casual') L = '⚽ GOAL! ' + x[1] + ' scores! ' + fanScoreline() + '.';
    if (m === 'club') L = fanWe(L);
    return L;
  }
  if (m === 'player' && FAN.player && L.includes(surname(FAN.player.name))) return '★ ' + L;
  return L;
}
const fanScoreline = () => TEAMS[0].club + ' ' + S.score[0] + ', ' + TEAMS[1].club + ' ' + S.score[1];
// My club: the same line from the supporter's end. Our club becomes we/us, our players become "our", theirs "their".
function fanWe(L) {
  const me = TEAMS[FAN.club], them = TEAMS[1 - FAN.club]; let x;
  if ((x = /^(?:⚽ )?GOAL! (?:An own goal by )?(.+?)(?: scores)?[.!]/.exec(L))) { const g = STATS.goals[STATS.goals.length - 1]; const ours = g ? g.team === FAN.club : false; const us = S.score[FAN.club], th = S.score[1 - FAN.club];
    return ours ? 'GOAL! WE SCORE! ' + surname(x[1]) + '! ' + (us > th ? us + '-' + th + ' to us!' : us === th ? 'Level at ' + us + '-' + th + '!' : 'Back in it, ' + us + '-' + th + '.') : them.club + ' score through ' + surname(x[1]) + '. ' + us + '-' + th + '. Heads up, there\'s time.'; }
  if (/\d+, .+ \d+\./.test(L)) return L; // scoreline sentences stay neutral
  const q = me.club.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  L = L.replace(new RegExp(q + '\'s', 'g'), 'our').replace(new RegExp('(to|for|against|by|from|beat) ' + q, 'g'), '$1 us').replace(new RegExp('(^|\\. )' + q + ' get us', 'g'), '$1We get us').replace(new RegExp('(^|\\. )' + q, 'g'), '$1We').replace(new RegExp(q, 'g'), 'us').replace(/We get us going/g, 'We get going');
  for (const p of players) { const sn = surname(p.name); if (L.startsWith(p.name) || L.startsWith(sn + ' ')) { L = (p.ti === FAN.club ? 'Our ' : 'Their ') + sn + L.slice(L.startsWith(p.name) ? p.name.length : sn.length); break; } }
  return L;
}
// player focus: his own milestones get a caption of their own, at most one every 6 s of play
function fanPlayerLine(kind, r) {
  if (FAN.mode !== 'player' || S.t < FAN.nextLine || !S.started || S.over) return; const p = FAN.player, sn = surname(p.name);
  const L = { spr: '★ ' + sn + ' bursts away: sprint ' + r.spr + ', top speed ' + (r.top * 3.6).toFixed(1) + ' km/h.', pass: '★ ' + sn + ' finds a team-mate. ' + r.pc + ' of ' + r.pa + ' passes completed.', tk: '★ ' + sn + ' wins a challenge. That\'s ' + r.tk + ' today.', sh: '★ ' + sn + ' shoots! Shot ' + r.sh + ' of his match.' }[kind];
  if (!L || (kind === 'pass' && r.pc % 3)) return; FAN.nextLine = S.t + 6; say(L);
}

// ---- language: hand-written labels above; live captions go through Claude with a cache and a rate limit ----
const FAN_TX = new Map(); const FAN_Q = []; let fanTxBusy = false;
function fanShow(en) {
  if (FAN.lang === 'en' || !en) return en; const k = FAN.lang + '|' + en; if (FAN_TX.has(k)) return FAN_TX.get(k);
  if (SAMPLE && !FAN_Q.includes(en)) { FAN_Q.push(en); if (FAN_Q.length > 6) FAN_Q.shift(); } return en;
}
// one batched request at a time, at most every 1.6 s, newest lines first; stale lines fall off the queue
async function fanTxPump() {
  if (fanTxBusy || !SAMPLE || FAN.lang === 'en' || !FAN_Q.length) return; fanTxBusy = true; const lang = FAN.lang; const batch = FAN_Q.splice(-4);
  try {
    const out = await SAMPLE.json('Translate these live football commentary lines into ' + FAN_LNAME[lang] + '. Keep player names, club names, numbers and the ★ symbol unchanged. Natural broadcast style, short. Return a JSON array of strings, same order and length.\n\n' + JSON.stringify(batch), { modelTier: 'quick', cache: false });
    const arr = Array.isArray(out) ? out : out && (out.lines || out.translations);
    if (Array.isArray(arr)) batch.forEach((en, i) => { if (typeof arr[i] === 'string' && arr[i].trim()) { FAN_TX.set(lang + '|' + en, arr[i].trim()); if (FAN_TX.size > 500) FAN_TX.delete(FAN_TX.keys().next().value); } });
    if (lang === FAN.lang && FAN_TX.has(lang + '|' + FAN.capEn) && $('cap1').textContent === FAN.capEn) { $('cap1').textContent = FAN_TX.get(lang + '|' + FAN.capEn); fanSpeak($('cap1').textContent); }
  } catch (e) {}
  fanTxBusy = false;
}
setInterval(fanTxPump, 1600);
function fanSpeak(text) {
  if (!FAN.voice || !window.speechSynthesis || !text) return;
  try { const L = FAN_LANGS.find((x) => x[0] === FAN.lang); const u = new SpeechSynthesisUtterance(text.replace(/★/g, '')); u.lang = L[2]; const v = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(FAN.lang)); if (v) u.voice = v; u.rate = 1.05;
    if (speechSynthesis.speaking && !/GOAL|★|!/.test(text)) return; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
// toast headlines are fixed words: swapped from the hand-written table, so they never wait for the network
function fanToastLang(h) {
  if (FAN.lang === 'en') return h;
  return h.replace(/^GOAL</, fanT('GOAL') + '<').replace(/^SAVED</, fanT('SAVED') + '<').replace('YELLOW CARD<', fanT('YC') + '<').replace('RED CARD<', fanT('RC') + '<').replace(/^PENALTY</, fanT('PEN') + '<').replace('MINUTES ADDED', fanT('ADDED')).replace(/^SECOND HALF</, fanT('SH2') + '<').replace(/^PLAY RESUMES</, fanT('RES') + '<');
}

// ---- wraps: captions, banners, per-frame HUD, camera, sim step ----
const _fanSay = say; say = function (line) { const en = fanVoice(String(line == null ? '' : line)); FAN.capEn = en; const shown = fanShow(en); _fanSay(shown); if (FAN.lang === 'en' || shown !== en || !SAMPLE) fanSpeak(shown); };
const _fanToast = toast; toast = function (html, secs) {
  html = String(html); const g = /^GOAL<small>/.test(html) && STATS.goals.length ? STATS.goals[STATS.goals.length - 1] : null; const t = $('toast'); t.classList.remove('fan-mute', 'fan-big');
  if (g && FAN.mode === 'club') { if (g.team === FAN.club) { html = html.replace(/^GOAL/, fanT('WE')); t.classList.add('fan-big'); } else { t.classList.add('fan-mute'); secs = Math.min(secs, 1.6); } }
  if (FAN.mode === 'casual' && g) t.classList.add('fan-big');
  return _fanToast(fanToastLang(html), secs);
};
const _fanHud = hud; hud = function () { _fanHud(); try { fanFrame(); } catch (e) { console.error(e); } };
const _fanStep = stepSim; stepSim = function (dt) { _fanStep(dt); trackPlayers(dt); }; window.__mc.stepSim = stepSim;
const _fanCam = updateCamera; updateCamera = function (dt) {
  const p = FAN.mode === 'player' && S.cam === 'player' && S.started && !(S.focus && S.celebrate > 0) ? FAN.player : null;
  if (!p || p.off) return _fanCam(dt);
  // follow cam: high behind-and-beside the player in his attacking direction (flips with the ends at half-time), looking a
  // little towards the ball so the play he is part of stays in frame
  const pw = W(p.pos2.x, 0, p.pos2.y), b = W(ball.p.x, 0, ball.p.z), d = dirOf(p.ti), port = camera.aspect < 1;
  const dd = Math.min(pw.distanceTo(b), 60), k = 1 + dd / 70; const L = pw.clone().lerp(b, port ? clamp(dd / 200, 0.05, 0.2) : clamp(0.12 + dd / 300, 0.12, 0.3)); L.y = 0.8; if (port) L.x -= d * 5; // portrait: aim a little behind him so he sits above the player card
  // portrait screens look down the length of the pitch (play runs up the screen); landscape sits beside and behind
  const P = port ? new THREE.Vector3(pw.x - d * 14 * k, 11 * k, pw.z + 3) : new THREE.Vector3(pw.x - d * 13 * k, 9 * k, pw.z + 15 * k);
  spring(camPos, camVel, P, dt, 2.6); spring(camLook, lookVel, L, dt, 3.2); camera.position.copy(camPos); camera.lookAt(camLook);
  const fov = port ? 52 : 40; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, clamp(dt * 1.5, 0, 1)); camera.updateProjectionMatrix(); }
};
// the camera buttons keep the followed player instead of resetting to the home striker
const fanCamSet = (v) => { S.cam = v; controls.enabled = v === 'free'; if (v === 'free') controls.target.copy(camLook); S.follow = v === 'player' ? (FAN.player || players.find((q) => q.ti === 0 && q.pos === 'ST')) : (FAN.mode === 'player' ? FAN.player : null); };
const fanCams = () => mkGroup($('cams'), CAMS, () => S.cam, fanCamSet); fanCams();
// talk tab: a Follow button next to the player you just called; Talk keeps working as before
const _fanRT = renderTalk; renderTalk = function () { _fanRT(); const p = TK.p, h = $('tk-head'); if (!p || !h || h.querySelector('.fan-fol')) return; const b = document.createElement('button'); b.className = 'btn sm fan-fol'; b.textContent = FAN.player === p && FAN.mode === 'player' ? '👁 ' + fanT('following') : '👁 ' + fanT('follow'); b.onclick = () => { fanSet({ mode: 'player', player: p }, 'talk'); renderTalk(); }; h.appendChild(b); };

// ---- events: per-player counters, club alerts, casual banners ----
onMatchEvent((e) => {
  if (e.type === 'kickoff' && e.half === 1) { trackerReset(); FAN.recap = null; FAN.nextLine = 0; if (FAN.mode === 'player') fanFollow(); fanLog('kickoff'); return; }
  const p = e.player ? fanByName(e.player) : null; const r = p && PTRK.get(p);
  if (e.type === 'pass' && r) r.pa++;
  if ((e.type === 'slide_tackle' || e.type === 'turnover') && r) { r.tk++; if (p === FAN.player) fanPlayerLine('tk', r); }
  if (e.type === 'shot' && r) { r.sh++; r.xg += e.xg || 0; if (p === FAN.player) fanPlayerLine('sh', r); }
  if (e.type === 'shot' && p) {
    const big = (e.xg || 0) >= 0.2;
    if (FAN.mode === 'club' && p.ti === FAN.club && (e.xg || 0) >= 0.12) _fanToast('<span style="color:' + TEAMS[FAN.club].css + '">' + fanT('CHANCE') + '</span><small>' + fanEsc(p.name) + '</small>', 1.6);
    else if (FAN.mode === 'casual' && big) FAN.close = { t: S.t, n: STATS.goals.length, p };
  }
});
// casual: a near miss gets its own banner once we know it didn't go in
function fanCasualClose() { const c = FAN.close; if (!c || S.t - c.t < 1.8) return; FAN.close = null; if (STATS.goals.length === c.n && S.started && !S.over) _fanToast(fanT('CLOSE') + '<small>' + fanEsc(c.p.name) + '</small>', 1.6); }

// ---- per-frame HUD: ring under the followed player, stats strip, metric tile, player card ----
let fanRing = null;
function fanRingMesh() {
  const g = new THREE.Group(); const m1 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
  const r1 = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.12, 48), m1); const m2 = m1.clone(); m2.opacity = 0.22; const r2 = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), m2);
  for (const r of [r1, r2]) { r.rotation.x = -Math.PI / 2; r.renderOrder = 3; g.add(r); } g.userData = { m1, m2 }; g.visible = false; scene.add(g); return g;
}
function fanFrame() {
  FAN.fr++; const p = FAN.mode === 'player' ? FAN.player : null;
  if (!fanRing) fanRing = fanRingMesh();
  fanRing.visible = !!(p && !p.off && S.started); if (fanRing.visible) { const c = new THREE.Color(p.T.css); fanRing.userData.m1.color.copy(c); fanRing.userData.m2.color.copy(c); const w = W(p.pos2.x, 0.035, p.pos2.y); fanRing.position.copy(w); const s = 1 + 0.08 * Math.sin(S.t * 5); fanRing.scale.set(s, 1, s); }
  if (p && !p.off && S.follow !== p) S.follow = p;
  if (FAN.mode === 'analyst' && $('tk').textContent === 'PASS' && S.passInfo) { const ts = $('ts'); if (!ts.textContent.includes('difficulty')) ts.textContent += ' · difficulty ' + fanPassDiff(S.passInfo); }
  fanCasualClose();
  if (FAN.fr % 6) return;
  // sit under the conditions chip; on phones the camera bar wraps under it too, so go below that
  const wx = $('wxchip'), fh = $('fan-hud'), cr = $('ctrl').getBoundingClientRect(); if (wx && fh && !wx.hidden) fh.style.top = Math.round(Math.max(wx.getBoundingClientRect().bottom, cr.left < 220 && cr.height ? cr.bottom : 0) + 6) + 'px';
  if (!S.started) return; fanStrip(); fanMetricTile(); fanCard();
}
function fanStrip() {
  const el = $('fan-strip'); if (FAN.mode !== 'analyst') { el.hidden = true; return; } el.hidden = false; const pu = fanPulse();
  const pct = (ti) => STATS.passes[ti] ? Math.round(STATS.done[ti] / STATS.passes[ti] * 100) : 0; const row = (k, a, b) => '<div><span>' + fanT(k) + '</span><b>' + a + '</b><b>' + b + '</b></div>';
  el.innerHTML = '<div class="fh"><i style="background:' + TEAMS[0].css + '"></i>' + TEAMS[0].key + '<i style="background:' + TEAMS[1].css + '"></i>' + TEAMS[1].key + '</div>' + row('sposs', possPct(0) + '%', possPct(1) + '%') + row('sshots', STATS.shots[0], STATS.shots[1]) + row('sot', Math.max(STATS.onTarget[0], S.score[0]), Math.max(STATS.onTarget[1], S.score[1])) + row('sxg', STATS.xg[0].toFixed(2), STATS.xg[1].toFixed(2)) + row('spass', pct(0) + '%', pct(1) + '%')
    + '<div class="pu"><span>' + fanT('spulse') + '</span><i><b style="width:' + pu[0] + '%;background:' + TEAMS[0].css + '"></b><b style="width:' + pu[1] + '%;background:' + TEAMS[1].css + '"></b></i></div>';
}
function fanMetricTile() {
  const el = $('fan-metric'); if (FAN.mode !== 'metric') { el.hidden = true; return; } el.hidden = false; const k = FAN.metric;
  if (FAN.subj === 'player' && FAN.player) { const v = playerMetric(k, FAN.player); el.innerHTML = '<span class="mk">' + fanT(k) + '</span><div class="mp"><i style="background:' + FAN.player.T.css + '">' + FAN.player.num + '</i>' + fanEsc(surname(FAN.player.name)) + '</div><b class="mv">' + v.txt + '</b><small>' + (v.unit || '') + '</small>'; return; }
  const a = teamMetric(k, 0), b = teamMetric(k, 1), s = (a.v + b.v) || 1;
  el.innerHTML = '<span class="mk">' + fanT(k) + '</span><div class="mt2">' + [a, b].map((v, ti) => '<div><em style="color:' + TEAMS[ti].css + '">' + TEAMS[ti].key + '</em><b class="mv">' + v.txt + '</b><small>' + (v.unit || '') + (v.who ? ' · ' + fanEsc(v.who) : '') + '</small></div>').join('') + '</div><i class="mb"><b style="width:' + Math.round(a.v / s * 100) + '%;background:' + TEAMS[0].css + '"></b><b style="width:' + Math.round(b.v / s * 100) + '%;background:' + TEAMS[1].css + '"></b></i>';
}
function fanCard() {
  const el = $('fan-pcard'); const p = FAN.mode === 'player' ? FAN.player : null; if (!p) { el.hidden = true; return; } el.hidden = false; const s = playerStats(p); if (!s) return;
  const cell = (k, v) => '<div><b>' + v + '</b><small>' + fanT(k) + '</small></div>';
  el.innerHTML = '<div class="pch"><i style="background:' + p.T.css + '">' + p.num + '</i><div><b>' + fanEsc(p.name) + '</b><small>' + p.pos + ' · ' + fanEsc(p.T.club) + (S.owner === p ? ' · ⚽' : '') + '</small></div><span class="pcl">👁 ' + fanT('following') + '</span></div>'
    + '<div class="pcg">' + cell('touch', s.touches) + cell('passes', s.passesCompleted + '/' + s.passesAttempted) + cell('dist', s.distanceKm.toFixed(2) + '<u>km</u>') + cell('top', s.topSpeedKmh.toFixed(1) + '<u>km/h</u>') + cell('spr', s.sprints) + cell('tk', s.tackles) + cell('sh', s.shots) + cell('sta', s.staminaPct + '%') + '</div>'
    + (s.per90Km ? '<div class="pcf">' + s.per90Km + ' km ' + fanT('p90') + '</div>' : '');
}

// ---- state changes: one place applies a choice, logs it to the dataset and refreshes every view ----
function fanFollow() {
  if (!players.length) return; if (!FAN.player || FAN.player.off) FAN.player = players.find((q) => q.ti === FAN.club && q.pos === 'ST') || players.find((q) => q.ti === FAN.club && !q.gk);
  if (S.cam !== 'player') FAN.prevCam = S.cam; S.cam = 'player'; S.follow = FAN.player; controls.enabled = false; fanCams();
}
function fanSet(o, why) {
  const was = FAN.mode; Object.assign(FAN, o); if (o.player && o.mode == null && FAN.mode === 'metric') FAN.subj = 'player';
  if (FAN.mode === 'player') fanFollow(); else if (was === 'player' || o.mode) { if (S.cam === 'player' && was === 'player' && FAN.mode !== 'player') { S.cam = FAN.prevCam && FAN.prevCam !== 'player' ? FAN.prevCam : 'broadcast'; fanCams(); } S.follow = null; }
  fanApply(); fanLog(why || 'change');
}
function fanLog(why) { if (!S.started) return; dataEvent('viewer_mode', { mode: FAN.mode, club: FAN.mode === 'club' ? TEAMS[FAN.club].key : null, player: FAN.player && (FAN.mode === 'player' || FAN.subj === 'player') ? FAN.player.name : null, metric: FAN.mode === 'metric' ? FAN.metric : null, metricFor: FAN.mode === 'metric' ? FAN.subj : null, language: FAN.lang, voice: FAN.voice, trigger: why }); }
function fanApply() {
  const B = document.body; for (const [m] of FAN_MODES) B.classList.toggle('fm-' + m, FAN.mode === m);
  B.style.setProperty('--fan-acc', FAN.mode === 'club' ? TEAMS[FAN.club].css : FAN.mode === 'player' && FAN.player ? FAN.player.T.css : '#8CC2FF');
  const tms = document.querySelectorAll('#bug .tm'); tms.forEach((t, i) => t.classList.toggle('fan-mine', FAN.mode === 'club' && i === FAN.club));
  $('cap').dir = fanRTL() ? 'rtl' : 'ltr'; const note = $('fan-capnote'); note.hidden = FAN.lang === 'en' || !!SAMPLE; note.textContent = fanT('noai');
  const md = FAN_MODES.find((x) => x[0] === FAN.mode); $('fan-chip').innerHTML = '<span>' + md[1] + '</span><b>' + fanT(FAN.mode) + '</b>' + (FAN.mode === 'club' ? '<em style="background:' + TEAMS[FAN.club].css + '">' + TEAMS[FAN.club].key + '</em>' : FAN.mode === 'player' && FAN.player ? '<em style="background:' + FAN.player.T.css + '">' + FAN.player.num + '</em>' : '') + (FAN.lang !== 'en' ? '<small>' + FAN.lang.toUpperCase() + '</small>' : '') + '<i>▾</i>';
  $('fan-chip').title = fanT('wm');
  if (FAN.popOpen) fanPicker($('fan-pop'), false); const ip = $('fan-intro'); if (ip && !$('intro').hidden) fanPicker(ip, true);
  lastThird = ''; fanStrip(); fanMetricTile(); fanCard(); if (FAN.recap && !$('endp').hidden) fanRecapRender();
}
// ---- the picker: same component in the intro card (compact) and in the live popover ----
function fanPicker(box, compact) {
  if (!players.length) return; box.dir = fanRTL() ? 'rtl' : 'ltr';
  const modeB = FAN_MODES.map(([m, ic]) => '<button class="fm-b" data-m="' + m + '" aria-pressed="' + (FAN.mode === m) + '"><i>' + ic + '</i><b>' + fanT(m) + '</b>' + (compact ? '' : '<small>' + fanT('d_' + m) + '</small>') + '</button>').join('');
  let sub = '';
  if (FAN.mode === 'club') sub = '<div class="fm-sub"><span>' + fanT('yclub') + '</span>' + TEAMS.map((T, ti) => '<button class="fm-c" data-c="' + ti + '" aria-pressed="' + (FAN.club === ti) + '" style="--tc:' + T.css + '"><i></i>' + fanEsc(T.club) + '</button>').join('') + '</div>';
  if (FAN.mode === 'player' || FAN.mode === 'metric') {
    const sel = '<select class="fm-sel" aria-label="' + fanT('yplayer') + '"><option value="">' + fanT('pick') + '</option>' + TEAMS.map((T, ti) => '<optgroup label="' + fanEsc(T.club) + '">' + players.filter((p) => p.ti === ti).map((p) => '<option value="' + players.indexOf(p) + '"' + (FAN.player === p ? ' selected' : '') + (p.off ? ' disabled' : '') + '>' + p.num + ' · ' + fanEsc(p.name) + ' (' + p.pos + ')</option>').join('') + '</optgroup>').join('') + '</select>';
    if (FAN.mode === 'player') sub = '<div class="fm-sub"><span>' + fanT('yplayer') + '</span>' + sel + '</div>';
    else sub = '<div class="fm-sub"><span>' + fanT('ymetric') + '</span>' + FAN_METRICS.map((k) => '<button class="fm-k" data-k="' + k + '" aria-pressed="' + (FAN.metric === k) + '">' + fanT(k).replace(/ \(.*\)/, '') + '</button>').join('') + '</div><div class="fm-sub"><button class="fm-s" data-s="teams" aria-pressed="' + (FAN.subj === 'teams') + '">' + fanT('both') + '</button><button class="fm-s" data-s="player" aria-pressed="' + (FAN.subj === 'player') + '">' + fanT('yplayer') + '</button>' + (FAN.subj === 'player' ? sel : '') + '</div>';
  }
  const lang = '<div class="fm-sub fm-lang"><span>' + fanT('lang') + '</span>' + FAN_LANGS.map(([k, n]) => '<button class="fm-l" data-l="' + k + '" lang="' + k + '" aria-pressed="' + (FAN.lang === k) + '">' + n + '</button>').join('') + '<button class="fm-v" aria-pressed="' + FAN.voice + '" title="' + fanT('voice') + '">' + (FAN.voice ? '🔊' : '🔇') + (compact ? '' : ' ' + fanT('voice')) + '</button></div>' + (FAN.lang !== 'en' && !SAMPLE ? '<p class="fm-note">' + fanT('noai') + '</p>' : '');
  box.innerHTML = '<div class="fm-h">' + fanT('q') + (compact ? '' : '<button class="fm-x" aria-label="' + fanT('done') + '">' + fanT('done') + '</button>') + '</div><div class="fm-modes">' + modeB + '</div>' + sub + lang;
  box.querySelectorAll('.fm-b').forEach((b) => b.onclick = () => fanSet({ mode: b.dataset.m }, 'picker'));
  box.querySelectorAll('.fm-c').forEach((b) => b.onclick = () => fanSet({ club: +b.dataset.c }, 'picker'));
  box.querySelectorAll('.fm-k').forEach((b) => b.onclick = () => fanSet({ metric: b.dataset.k }, 'picker'));
  box.querySelectorAll('.fm-s').forEach((b) => b.onclick = () => { if (b.dataset.s === 'player' && !FAN.player) FAN.player = players.find((q) => q.ti === FAN.club && q.pos === 'ST'); fanSet({ subj: b.dataset.s }, 'picker'); });
  box.querySelectorAll('.fm-l').forEach((b) => b.onclick = () => fanSet({ lang: b.dataset.l }, 'picker'));
  const sl = box.querySelector('.fm-sel'); if (sl) sl.onchange = () => { if (sl.value !== '') fanSet({ player: players[+sl.value] }, 'picker'); };
  const v = box.querySelector('.fm-v'); v.onclick = () => { FAN.voice = !FAN.voice; if (!FAN.voice && window.speechSynthesis) speechSynthesis.cancel(); fanApply(); fanLog('voice'); };
  const x = box.querySelector('.fm-x'); if (x) x.onclick = () => fanPop(false);
}
function fanPop(open) { FAN.popOpen = open; const el = $('fan-pop'); el.hidden = !open; $('fan-chip').setAttribute('aria-expanded', open); if (open) { fanPicker(el, false); el.style.top = Math.round($('fan-chip').getBoundingClientRect().bottom + 6) + 'px'; } }
(() => { const n = document.createElement('div'); n.id = 'fan-capnote'; n.hidden = true; $('cap').appendChild(n); })();
$('fan-chip').onclick = () => fanPop(!FAN.popOpen);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && FAN.popOpen) fanPop(false); });
// intro card: the picker sits above KICK OFF; the live HUD appears with the scoreboard
(() => { const go = document.querySelector('#intro .go'); const d = document.createElement('div'); d.id = 'fan-intro'; d.className = 'fan-pk'; go.parentNode.insertBefore(d, go); })();
$('su-go').addEventListener('click', () => setTimeout(() => { fanPicker($('fan-intro'), true); fanApply(); }, 0));
const _fanKO = kickOff; kickOff = function () { _fanKO(); $('fan-hud').hidden = false; fanApply(); }; window.__mc.kickOff = kickOff; $('kick').onclick = kickOff;
const _fanOS = openSetup; openSetup = function () { _fanOS(); $('fan-hud').hidden = true; $('fan-pcard').hidden = true; fanPop(false); if (fanRing) fanRing.visible = false; }; window.__mc.openSetup = openSetup;

// ============ FULL-TIME RECAP: two different stories from one event log, plus a key-moments timeline ============
function fanMoments() {
  const E = ENV.events, out = []; const key = (k) => k === TEAMS[0].key ? 0 : 1; let sc = [0, 0];
  for (const e of E) {
    if (e.type === 'goal') { const ti = key(e.team), pre = sc.slice(); sc[ti]++; const shot = [...E].reverse().find((s) => s.type === 'shot' && s.simT <= e.simT && e.simT - s.simT < 5);
      const swing = pre[0] === pre[1] ? 'broke the deadlock' : pre[ti] < pre[1 - ti] ? (sc[ti] === sc[1 - ti] ? 'levelled the match' : 'cut the gap') : 'stretched the lead';
      out.push({ min: fanMin(e), type: 'goal', icon: '⚽', team: ti, title: (e.ownGoal ? 'Own goal, ' + e.player : e.player) + ' (' + TEAMS[ti].key + ')', why: (e.ownGoal ? 'An own goal by ' + e.player + ' ' : TEAMS[ti].club + ' ' + swing + ' through ' + e.player + '. ') + (shot ? 'The chance was worth xG ' + (+shot.xg).toFixed(2) + ' (about ' + Math.max(1, Math.round(shot.xg * 100)) + ' in 100 go in), struck at ' + shot.kmh + ' km/h' + (shot.kind !== 'open play' ? ' from a ' + shot.kind : '') + '. ' : '') + 'Score now ' + TEAMS[0].key + ' ' + sc[0] + '-' + sc[1] + ' ' + TEAMS[1].key + '.', w: 10 });
      if (pre[ti] < pre[1 - ti] && sc[ti] === sc[1 - ti] || pre[0] !== pre[1] && sc[0] !== sc[1] && Math.sign(pre[0] - pre[1]) !== Math.sign(sc[0] - sc[1])) out[out.length - 1].turn = true; }
    else if (e.type === 'red_card') out.push({ min: fanMin(e), type: 'card', icon: '🟥', team: key(e.team), title: 'Red card: ' + e.player, why: e.player + ' was sent off (' + e.reason + '). ' + TEAMS[key(e.team)].club + ' played the rest with ten, which usually costs a side about a third of its attacking output.', w: 9, turn: true });
    else if (e.type === 'yellow_card') out.push({ min: fanMin(e), type: 'card', icon: '🟨', team: key(e.team), title: 'Yellow: ' + e.player, why: e.player + ' was booked for ' + e.reason + '. One more and ' + TEAMS[key(e.team)].club + ' go down to ten, so he has to stay on his feet from here.', w: 3 });
    else if (e.type === 'shot' && e.xg >= 0.2 && !E.some((g) => g.type === 'goal' && g.simT >= e.simT && g.simT - e.simT < 5)) out.push({ min: fanMin(e), type: 'chance', icon: '😱', team: key(e.team), title: 'Big chance: ' + e.player, why: e.player + '\'s ' + (e.kind === 'open play' ? 'shot' : e.kind) + ' carried xG ' + (+e.xg).toFixed(2) + ': roughly a ' + Math.round(e.xg * 100) + '% chance, and it didn\'t go in. A swing moment: ' + TEAMS[key(e.team)].club + ' were ' + (e.xg >= 0.4 ? 'expected to score' : 'well placed') + ' there.', w: 4 + e.xg * 6 });
    else if (e.type === 'tactical_change') out.push({ min: fanMin(e), type: 'turn', icon: '🔁', team: key(e.team), title: TEAMS[key(e.team)].key + ' switch to ' + e.formation, why: TEAMS[key(e.team)].club + ' changed shape to ' + e.formation + (e.style ? ', ' + e.style : '') + '. ' + (e.why ? 'Reason: ' + e.why + '.' : '') + ' Press ' + (e.press != null ? Math.round(e.press * 100) + '%' : 'adjusted') + ', line height ' + (e.line != null ? Math.round(e.line * 100) + '%' : 'adjusted') + '.', w: 5 });
    else if (e.type === 'suspended' || e.type === 'cooling_break') out.push({ min: fanMin(e), type: 'turn', icon: e.type === 'suspended' ? '⚡' : '🧊', title: e.type === 'suspended' ? 'Lightning delay' : 'Cooling break', why: e.type === 'suspended' ? 'Play stopped for lightning ' + e.km + ' km away. Momentum resets after a delay like this.' : 'A FIFA cooling break at WBGT ' + e.wbgtC + '°C: both coaches get a chance to talk tactics.', w: 4 });
  }
  // momentum turning point: the 5-minute window where the share of threat swung hardest
  const w = S.score[0] === S.score[1] ? -1 : S.score[0] > S.score[1] ? 0 : 1; let sc2 = [0, 0], dec = null; for (const m of out) if (m.type === 'goal') { const was = sc2[m.team] > sc2[1 - m.team]; sc2[m.team]++; if (m.team === w && !was && sc2[w] > sc2[1 - w]) dec = m; }
  if (dec) { dec.turn = true; dec.why += ' It proved to be the winner.'; }
  const sw = fanSwing(); if (sw) { if (out.some((m) => m.turn)) sw.turn = false; out.push(sw); }
  out.sort((a, b) => a.min - b.min); const keep = out.filter((m) => m.type !== 'chance' && m.type !== 'card' || m.w >= 6 || m.icon === '🟨');
  return (keep.length > 12 ? keep.sort((a, b) => b.w - a.w).slice(0, 12).sort((a, b) => a.min - b.min) : keep);
}
function fanSwing() {
  const E = ENV.events; const end = Math.max(...E.map((e) => e.minute), 1); const win = []; const key = (k) => k === TEAMS[0].key ? 0 : k === TEAMS[1].key ? 1 : -1;
  for (let m = 0; m < end; m += 5) { const v = [1, 1]; for (const e of E) { if (e.minute < m || e.minute >= m + 5) continue; const ti = key(e.team); if (ti < 0) continue; if (e.type === 'shot') v[ti] += 2 + e.xg * 8; if (e.type === 'pass') v[ti] += 0.15; if (e.type === 'turnover' && e.ownX > 60) v[ti] += 1; } win.push({ m, s: v[0] / (v[0] + v[1]) }); }
  let best = null; for (let i = 1; i < win.length; i++) { const d = win[i].s - win[i - 1].s; if (!best || Math.abs(d) > Math.abs(best.d)) best = { d, m: win[i].m, a: win[i - 1].s, b: win[i].s }; }
  if (!best || Math.abs(best.d) < 0.18) return null; const ti = best.d > 0 ? 0 : 1;
  return { min: best.m + 1, type: 'turn', icon: '📈', team: ti, title: 'Momentum swings to ' + TEAMS[ti].key, why: 'From minute ' + (best.m + 1) + ' ' + TEAMS[ti].club + '\'s share of the threat (shots, chance quality, passing and high regains) jumped from ' + Math.round((ti ? 1 - best.a : best.a) * 100) + '% to ' + Math.round((ti ? 1 - best.b : best.b) * 100) + '% in five minutes: the spell when the game tilted their way.', w: 6, turn: true };
}
// the facts both recaps are written from
function fanFacts() {
  const t = TEAMS.map((T) => T.club); const sc = S.score; const winner = sc[0] === sc[1] ? -1 : sc[0] > sc[1] ? 0 : 1;
  const ps = players.map((p) => playerStats(p)).filter(Boolean); const by = (k) => ps.slice().sort((a, b) => b[k] - a[k])[0];
  const goals = ENV.events.filter((e) => e.type === 'goal').map((e) => ({ min: fanMin(e), player: e.player, team: e.team, own: e.ownGoal }));
  const scorers = {}; goals.forEach((g) => { if (!g.own) scorers[g.player] = (scorers[g.player] || 0) + 1; });
  const hero = (() => { const w = winner >= 0 ? TEAMS[winner].key : null; const gs = Object.entries(scorers).filter(([n]) => !w || ps.find((p) => p.name === n)?.team === w).sort((a, b) => b[1] - a[1])[0]; if (gs) return { name: gs[0], why: gs[1] > 1 ? gs[1] + ' goals' : 'the goal that mattered' };
    const r = ps.filter((x) => !w || x.team === w).sort((a, b) => (b.tackles * 2 + b.passesCompleted * 0.3 + b.shots) - (a.tackles * 2 + a.passesCompleted * 0.3 + a.shots))[0]; return r ? { name: r.name, why: r.passesCompleted + ' completed passes and ' + r.tackles + ' tackles' } : null; })();
  return { teams: t, keys: TEAMS.map((T) => T.key), score: sc.slice(), winner, stadium: SET.st.name + ', ' + SET.st.city, weather: WX[ENV.wx].label, wet: ['drizzle', 'rain', 'heavy', 'storm', 'fog', 'snow'].includes(ENV.wx), startWeather: WX[ENV.startWx]?.label, tempC: Math.round(ENV.temp), pitch: ENV.pitch,
    xg: STATS.xg.map((x) => +x.toFixed(2)), shots: STATS.shots.slice(), onTarget: [0, 1].map((ti) => Math.max(STATS.onTarget[ti], ENV.events.filter((e) => e.type === 'goal' && !e.ownGoal && e.team === TEAMS[ti].key).length)), poss: [possPct(0), possPct(1)], passes: STATS.passes.slice(), done: STATS.done.slice(), fouls: STATS.fouls.slice(), yellows: STATS.yellows.slice(), reds: STATS.reds.slice(), offsides: STATS.offsides.slice(),
    forms: TEAMS.map((T, ti) => resolvedTac(ti).form), formsEnd: TEAMS.map((T) => T.tac.form), styles: TEAMS.map((T) => STYLES[T.tac.style].label), changes: ENV.events.filter((e) => e.type === 'tactical_change').map((e) => ({ min: fanMin(e), team: e.team, formation: e.formation, why: e.why })),
    goals, hero, top: { passer: by('passesCompleted'), runner: by('distanceKm'), quickest: by('topSpeedKmh'), tackler: by('tackles') }, viewer: { mode: FAN.mode, club: FAN.mode === 'club' ? t[FAN.club] : null, player: FAN.player && FAN.mode === 'player' ? playerStats(FAN.player) : null } };
}
function fanRecapTemplates(F, moments) {
  const [A, B] = F.teams, [a, b] = F.score, w = F.winner; const pc = (ti) => F.passes[ti] ? Math.round(F.done[ti] / F.passes[ti] * 100) : 0; const pt = F.poss[0] >= F.poss[1] ? 0 : 1;
  const res = w < 0 ? A + ' and ' + B + ' drew ' + a + '-' + b : F.teams[w] + ' beat ' + F.teams[1 - w] + ' ' + Math.max(a, b) + '-' + Math.min(a, b);
  const xw = F.xg[0] > F.xg[1] + 0.3 ? 0 : F.xg[1] > F.xg[0] + 0.3 ? 1 : -1;
  const fair = F.shots[0] + F.shots[1] === 0 ? 'neither side managed a shot, so the defences won the day' : xw < 0 ? 'the chances were close to even, so the result is about right' : w === xw ? F.teams[xw] + ' created the better chances and the result reflects it' : w < 0 ? F.teams[xw] + ' did enough to win on chances and will feel they dropped points' : 'the scoreline flatters ' + F.teams[w] + ', who were second-best on chance quality';
  const turn = moments.find((m) => m.turn && m.type !== 'turn') || moments.find((m) => m.turn) || moments.find((m) => m.type === 'goal');
  const an = [
    res + '. On expected goals it finished ' + F.xg[0].toFixed(2) + '–' + F.xg[1].toFixed(2) + ': ' + fair + '.',
    F.teams[pt] + ' had ' + F.poss[pt] + '% of the ball. Pass completion ' + F.keys[0] + ' ' + pc(0) + '% (' + F.done[0] + '/' + F.passes[0] + '), ' + F.keys[1] + ' ' + pc(1) + '% (' + F.done[1] + '/' + F.passes[1] + '). Shots ' + F.shots.join('–') + ', on target ' + F.onTarget.join('–') + '.',
    A + ' started in a ' + F.forms[0] + ' (' + F.styles[0].toLowerCase() + '), ' + B + ' in a ' + F.forms[1] + ' (' + F.styles[1].toLowerCase() + ').' + (F.changes.length ? ' In-game changes: ' + F.changes.slice(0, 3).map((c) => c.team + ' to ' + c.formation + ' at ' + c.min + '\'' + (c.why ? ' (' + c.why.toLowerCase() + ')' : '')).join('; ') + '.' : ' Neither coach changed shape.'),
    turn ? 'Turning point, ' + turn.min + '\': ' + turn.why : 'No single moment decided it; the game was settled by steady pressure.',
    'By the numbers: ' + [F.top.passer && F.top.passer.name + ' completed the most passes (' + F.top.passer.passesCompleted + ')', F.top.quickest && F.top.quickest.name + ' hit the top speed (' + F.top.quickest.topSpeedKmh + ' km/h)', F.top.runner && F.top.runner.name + ' covered the most ground (' + F.top.runner.distanceKm + ' km' + (F.top.runner.per90Km ? ', a ' + F.top.runner.per90Km + ' km per-90 pace' : '') + ')', F.top.tackler && F.top.tackler.tackles ? F.top.tackler.name + ' won the most challenges (' + F.top.tackler.tackles + ')' : null].filter(Boolean).join('; ') + '.',
    'Discipline: fouls ' + F.fouls.join('–') + ', yellows ' + F.yellows.join('–') + (F.reds[0] + F.reds[1] ? ', reds ' + F.reds.join('–') : '') + ', offsides ' + F.offsides.join('–') + '. Conditions: ' + F.weather.toLowerCase() + ', ' + F.tempC + '°C, pitch ' + F.pitch.toLowerCase() + '.' ];
  // fan story: emotion first, numbers only where they make the story
  const my = F.viewer.club ? F.teams.indexOf(F.viewer.club) : -1; const we = (ti) => my === ti ? 'we' : F.teams[ti]; const We = (ti) => my === ti ? 'We' : F.teams[ti];
  const big = moments.filter((m) => m.type === 'chance').sort((x, y) => y.w - x.w)[0];
  const open = (a + b === 0 ? 'Nobody could find the net at ' : a + b >= 4 ? 'What a game at ' : 'A tense, tight night at ') + F.stadium + (F.wet ? ', with the ' + F.weather.toLowerCase() + ' adding to the drama' : '') + '.';
  const story = F.goals.length ? F.goals.map((g, i) => { const ti = F.keys.indexOf(g.team); const s = i === 0 ? (g.own ? 'An own goal opened the scoring in the ' + fanOrd(g.min) + ' minute, and ' + we(ti) + ' were ahead.' : g.player + ' broke the deadlock in the ' + fanOrd(g.min) + ' minute' + (my === ti ? ' and we went wild.' : my >= 0 ? '. Gutted.' : '.')) : (g.own ? 'Then an own goal in the ' + fanOrd(g.min) + ' gave ' + we(ti) + ' another.' : g.player + ' struck in the ' + fanOrd(g.min) + (my === ti ? ' for us!' : my >= 0 ? ' for them.' : ' for ' + F.teams[ti] + '.')); return s; }).join(' ') : 'Chances came and went at both ends, but the keepers had the final word.';
  const vp = F.viewer.player, pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const heroL = (F.hero ? 'The hero: ' + F.hero.name + ', with ' + F.hero.why + '.' : '') + (vp && (!F.hero || vp.name !== F.hero.name) ? ' Your player to watch, ' + vp.name + ', ended with ' + pl(vp.touches, 'touch').replace('touchs', 'touches') + ', ' + vp.passesCompleted + ' completed passes, ' + pl(vp.sprints, 'sprint') + ' and a top speed of ' + vp.topSpeedKmh + ' km/h.' : '');
  const lose = w >= 0 ? 1 - w : -1, ch = lose >= 0 ? F.changes.filter((c) => c.team === F.keys[lose]).slice(-1)[0] : null; const pt2 = F.poss[0] >= F.poss[1] ? 0 : 1;
  const push = lose >= 0 ? (my === lose ? 'We threw everything at them' : F.teams[lose] + ' pushed for a way back') + (ch ? ', switching to a ' + ch.formation + ' in the ' + fanOrd(ch.min) + ' minute' : '') + ', but ' + (my === w ? 'we held firm.' : my === lose ? 'it wasn\'t to be.' : F.teams[w] + ' held firm.') : (pt2 >= 0 ? We(pt2) + ' had more of the ball, but neither side could find a winner.' : '');
  const heart = big ? 'Heart-in-mouth moment: ' + big.min + '\', ' + big.title.replace('Big chance: ', '') + ' had a glorious chance and somehow it stayed out.' : moments.find((m) => m.icon === '🟥') ? 'And the red card changed everything.' : '';
  const end = w < 0 ? 'Honours even. ' + (my >= 0 ? 'A point for us, and we\'ll take it.' : 'Both sets of fans go home with something.') : my >= 0 ? (my === w ? 'The final whistle, and the three points are ours. What a feeling.' : 'Not our night. We go again.') : 'At the final whistle, ' + F.teams[w] + ' celebrate in front of their fans.';
  return { analyst: an.join('\n\n'), fan: [open, story, heart, push, heroL, end].filter(Boolean).join(' ') };
}
function fanRecap() {
  const moments = fanMoments(), F = fanFacts(), T = fanRecapTemplates(F, moments);
  FAN.recap = { language: 'en', source: 'template', analyst: T.analyst, fan: T.fan, moments: moments.map((m) => ({ minute: m.min, type: m.type, title: m.title, explanation: m.why, turningPoint: !!m.turn })), _m: moments, tab: FAN.mode === 'analyst' ? 'a' : 'f', sel: -1, tr: FAN.lang !== 'en' && !SAMPLE };
  fanRecapRender();
  if (SAMPLE) { const lang = FAN.lang; const rec = FAN.recap; $('fan-rc-src').textContent = '✦ …';
    SAMPLE.json('You are writing two full-time recaps of a football match for a broadcast app, in ' + FAN_LNAME[lang] + '. Use ONLY the facts in the JSON. Return JSON {"analyst": string, "fan": string, "moments": [string]}.\n- analyst: 4 short paragraphs for a data-hungry viewer: result vs xG, possession and passing, tactics and changes, the turning point; cite numbers.\n- fan: one warm, emotional paragraph of 5-7 sentences for a casual fan: the story, the drama, the hero; at most two numbers.' + (F.viewer.club ? ' Write the fan recap as a ' + F.viewer.club + ' supporter, using "we".' : '') + (F.viewer.player ? ' Give ' + F.viewer.player.name + ' a sentence in both recaps.' : '') + '\n- moments: one short explanation per key moment, same order, saying why it mattered.\n\nFacts: ' + JSON.stringify(F) + '\nKey moments: ' + JSON.stringify(rec.moments.map((m) => m.minute + '\' ' + m.title + ': ' + m.explanation)), { modelTier: 'quick', cache: false })
      .then((o) => { if (FAN.recap !== rec || !o || !o.analyst || !o.fan) throw 0; Object.assign(rec, { analyst: String(o.analyst), fan: String(o.fan), language: lang, source: 'claude', tr: false }); if (Array.isArray(o.moments)) o.moments.forEach((t, i) => { if (rec._m[i] && typeof t === 'string' && t.trim()) { rec._m[i].why = t; rec.moments[i].explanation = t; } }); fanRecapRender(); })
      .catch(() => { if (FAN.recap === rec) fanRecapRender(); });
  }
}
function fanRecapRender() {
  const R = FAN.recap; if (!R) return; let box = $('fan-recap'); if (!box) { box = document.createElement('div'); box.id = 'fan-recap'; $('end-why').after(box); }
  const lastMin = Math.max(90, ...R._m.map((m) => m.min)); box.dir = fanRTL() && !R.tr ? 'rtl' : 'ltr';
  box.innerHTML = '<div class="rc-tabs" role="tablist"><button role="tab" data-r="f" aria-selected="' + (R.tab === 'f') + '">' + fanT('rf') + '</button><button role="tab" data-r="a" aria-selected="' + (R.tab === 'a') + '">' + fanT('ra') + '</button><span id="fan-rc-src">' + (R.source === 'claude' ? '✦ ' + fanT('byai') : fanT('bytpl')) + '</span></div>'
    + '<div class="rc-body">' + (R.tr ? '<p class="fm-note">' + fanT('rcen') + '</p>' : '') + (R.tab === 'a' ? R.analyst : R.fan).split(/\n\n+/).map((t) => '<p>' + fanEsc(t) + '</p>').join('') + '</div>'
    + '<div class="rc-km"><b>' + fanT('km') + '</b><small>' + fanT('tap') + '</small></div><div class="rc-tl" dir="ltr"><i class="ht" style="left:' + (45 / lastMin * 100) + '%"></i>' + R._m.map((m, i) => '<button class="rc-dot' + (m.turn ? ' turn' : '') + '" data-i="' + i + '" aria-pressed="' + (R.sel === i) + '" style="left:' + clamp(m.min / lastMin * 100, 2, 98) + '%;--tc:' + (m.team != null ? TEAMS[m.team].css : '#9FB0C2') + '" title="' + m.min + '\' ' + fanEsc(m.title) + '">' + m.icon + '</button>').join('') + '</div>'
    + '<div class="rc-list">' + R._m.map((m, i) => '<button class="rc-m" data-i="' + i + '" aria-pressed="' + (R.sel === i) + '" style="--tc:' + (m.team != null ? TEAMS[m.team].css : '#9FB0C2') + '"><em>' + m.min + '\'</em>' + m.icon + ' ' + fanEsc(m.title) + (m.turn ? ' <u>' + fanT('k_turn') + '</u>' : '') + '</button>').join('') + '</div>'
    + (R.sel >= 0 && R._m[R.sel] ? '<div class="rc-why" aria-live="polite"><b>' + R._m[R.sel].min + '\' ' + R._m[R.sel].icon + ' ' + fanEsc(R._m[R.sel].title) + '</b><p>' + fanEsc(R._m[R.sel].why) + '</p></div>' : '');
  box.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { R.tab = b.dataset.r; fanRecapRender(); });
  box.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { R.sel = R.sel === +b.dataset.i ? -1 : +b.dataset.i; fanRecapRender(); });
}
const _fanFT = fullTime; fullTime = function (why) { _fanFT(why); try { fanRecap(); } catch (e) { console.error(e); } };
// dataset export: the recap, the moments and the viewer's personalisation travel with the match
const _fanSum = summary; summary = function (why) { const o = _fanSum(why); const R = FAN.recap; o.viewer = { mode: FAN.mode, club: FAN.mode === 'club' ? TEAMS[FAN.club].key : null, player: FAN.player ? FAN.player.name : null, metric: FAN.mode === 'metric' ? FAN.metric : null, language: FAN.lang };
  if (R) o.recap = { language: R.language, source: R.source, analyst: R.analyst, fan: R.fan, keyMoments: R.moments }; if (PTRK.size) o.playerTracking = players.map(playerStats); return o; };
// ---- test hooks ----
window.__mc.fan = { get mode() { return FAN.mode; }, get state() { return Object.assign({}, FAN, { player: FAN.player && FAN.player.name }); }, setMode: (m) => fanSet({ mode: m }, 'api'), setClub: (ti) => fanSet({ club: ti }, 'api'), setPlayer: (p) => fanSet({ player: typeof p === 'number' ? players[p] : typeof p === 'string' ? fanByName(p) : p }, 'api'),
  setMetric: (k, subj) => fanSet({ metric: k, subj: subj || FAN.subj }, 'api'), setLang: (l) => fanSet({ lang: l }, 'api'), setVoice: (v) => { FAN.voice = !!v; fanApply(); }, stats: (p) => playerStats(typeof p === 'number' ? players[p] : p || FAN.player), teamMetric, recap: () => FAN.recap, buildRecap: fanRecap, voiceOf: fanVoice, pop: fanPop, tx: FAN_TX, trackPlayers };
