window.CLAP_PLUS_VERSION = 28;
/* ============================================================
   Clap+ : plateformes, rappels, partage, vote, recommandations,
   import CSV et bilan annuel.
   Chargé après clap.js (utilise ses fonctions et variables globales).
   ============================================================ */

const DAY = 86400000;
const IMG_LOGO = 'https://image.tmdb.org/t/p/w92';
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
let voteState = null;

/* ---------- Fenêtre générique ---------- */
function openAppModal(html) {
  $('appModalContent').innerHTML = html;
  $('appModal').style.display = 'block';
}
function closeAppModal() {
  if ($('appModal')) { $('appModal').style.display = 'none'; $('appModalContent').innerHTML = ''; }
  voteState = null;
}

/* ============================================================
   1. PLATEFORMES (« Où regarder » + filtre)
   ============================================================ */
let providerCatalog = null;

async function loadProviderCatalog() {
  if (providerCatalog) return providerCatalog;
  try {
    const [m, t] = await Promise.all([
      tmdb('/watch/providers/movie?watch_region=FR', 24 * 3600 * 1000),
      tmdb('/watch/providers/tv?watch_region=FR', 24 * 3600 * 1000)
    ]);
    const map = new Map();
    [...(m.results || []), ...(t.results || [])].forEach(p => { if (!map.has(p.provider_id)) map.set(p.provider_id, p); });
    const prio = p => p.display_priorities?.FR ?? p.display_priority ?? 999;
    providerCatalog = [...map.values()].sort((a, b) => prio(a) - prio(b)).slice(0, 18);
    return providerCatalog;
  } catch { return []; }
}

async function renderProviderPicker() {
  const box = $('providerPicker');
  if (!box) return;
  const cat = await loadProviderCatalog();
  if (!cat.length) { box.innerHTML = '<div class="empty">Plateformes indisponibles pour le moment.</div>'; return; }
  box.innerHTML = cat.map(p => `
    <button type="button" class="chip ${prefs.providers.includes(p.provider_id) ? 'on' : ''}" data-act="prov" data-id="${p.provider_id}">
      <img src="${IMG_LOGO}${esc(p.logo_path)}" alt="" loading="lazy">${esc(p.provider_name)}
    </button>`).join('');
}

function toggleProvider(id) {
  const i = prefs.providers.indexOf(id);
  if (i >= 0) prefs.providers.splice(i, 1); else prefs.providers.push(id);
  if (!prefs.providers.length) prefs.onlyMine = false;
  savePrefs();
  renderProviderPicker();
  applyOnlyMine();
  reAvail();
}

function toggleOnlyMine(on) {
  if (on && !prefs.providers.length) {
    toast('Choisis d’abord tes plateformes dans Profil');
    on = false;
  }
  prefs.onlyMine = !!on;
  savePrefs();
  applyOnlyMine();
}
function applyOnlyMine() {
  document.body.classList.toggle('only-mine', !!prefs.onlyMine);
  document.querySelectorAll('.onlyMineToggle').forEach(c => { c.checked = !!prefs.onlyMine; });
}

const provCache = new Map();
async function fetchProviders(id, type) {
  const key = `${type}:${id}`;
  if (provCache.has(key)) return provCache.get(key);
  try {
    const d = await tmdb(`/${type}/${id}/watch/providers`, 6 * 3600 * 1000);
    const fr = d.results?.FR || {};
    const res = { flat: fr.flatrate || [], other: !!((fr.rent || []).length || (fr.buy || []).length) };
    provCache.set(key, res);
    return res;
  } catch { return null; }
}

function provSlot(item, extra = '', forceType) {
  const t = forceType || typeOf(item);
  if (t === 'person') return '';
  return `<div class="prov ${extra}" data-pid="${item.id}" data-ptype="${t === 'tv' ? 'tv' : 'movie'}"></div>`;
}

function renderProv(r, mine) {
  if (!r.flat.length) return `<span class="small">${r.other ? 'Location / achat uniquement' : 'Pas en streaming (FR)'}</span>`;
  const hit = r.flat.some(p => mine.has(p.provider_id));
  return r.flat.slice(0, 6).map(p =>
    `<img class="plogo ${mine.has(p.provider_id) ? 'mine' : ''}" src="${IMG_LOGO}${esc(p.logo_path)}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}" loading="lazy">`
  ).join('') + (hit ? '<span class="pmine">Sur tes plateformes</span>' : '');
}

function paintProv(el, r) {
  const mine = new Set(prefs.providers);
  el._r = r;
  el.innerHTML = renderProv(r, mine);
  if (el.classList.contains('big') || el.classList.contains('nohide')) return;
  const hit = r.flat.some(p => mine.has(p.provider_id));
  const card = el.closest('.card, .home-mini-card');
  if (card) card.dataset.avail = (mine.size === 0 || hit) ? '1' : '0';
}

function reAvail() {
  document.querySelectorAll('.prov').forEach(el => { if (el._r) paintProv(el, el._r); });
}

async function loadProv(el) {
  const r = await fetchProviders(el.dataset.pid, el.dataset.ptype);
  if (r) paintProv(el, r);
}

const provObserver = ('IntersectionObserver' in window)
  ? new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { provObserver.unobserve(en.target); loadProv(en.target); } });
    }, { rootMargin: '250px' })
  : null;

function hydrateProviders() {
  document.querySelectorAll('.prov:not([data-seen])').forEach(el => {
    el.dataset.seen = '1';
    const cached = provCache.get(`${el.dataset.ptype}:${el.dataset.pid}`);
    if (cached) paintProv(el, cached);           // immédiat : pas de clignotement
    else if (provObserver) provObserver.observe(el); // sinon on charge quand la carte approche de l'écran
    else loadProv(el);
  });
}

/* ============================================================
   2. RAPPELS (épisodes + sorties ciné de la watchlist)
   ============================================================ */
function dayDiff(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = new Date(y, (m || 1) - 1, d || 1);
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((t - n) / DAY);
}
const whenLabel = n => (n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} jours`);

async function computeReminders() {
  const out = [];
  watchlist.filter(m => typeOf(m) === 'movie' && m.release_date).forEach(m => {
    const n = dayDiff(m.release_date);
    if (n >= 0 && n <= 7) out.push({ key: `m${m.id}:${m.release_date}`, icon: '', text: `${titleOf(m)} sort ${whenLabel(n)} au cinéma`, n, id: m.id, type: 'movie' });
  });
  const tracked = seriesList.filter(s => s.status !== 'Terminé');
  const infos = await Promise.all(tracked.map(async s => {
    try { return [s, await tmdb(`/tv/${s.id}`, 3600000)]; } catch { return null; }
  }));
  infos.filter(Boolean).forEach(([s, d]) => {
    const ne = d.next_episode_to_air;
    if (!ne?.air_date) return;
    const n = dayDiff(ne.air_date);
    if (n >= 0 && n <= 7) out.push({ key: `e${s.id}:${ne.season_number}x${ne.episode_number}`, icon: '', text: `${s.name} · S${ne.season_number}E${ne.episode_number} ${whenLabel(n)}`, n, id: s.id, type: 'tv' });
  });
  return out.sort((a, b) => a.n - b.n);
}

async function notifyReminders(list) {
  if (!prefs.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
  const seen = getStorage('cine_notified', {});
  const fresh = list.filter(r => r.n <= 1 && !seen[r.key]);
  for (const r of fresh) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body: r.text, icon: 'icon-192.png', badge: 'icon-192.png', tag: r.key };
      if (reg) await reg.showNotification('Clap', opts); else new Notification('Clap', opts);
      seen[r.key] = Date.now();
    } catch { /* notification impossible ici */ }
  }
  Object.keys(seen).forEach(k => { if (Date.now() - seen[k] > 30 * DAY) delete seen[k]; });
  setStorage('cine_notified', seen);
}

async function refreshReminders() {
  const box = $('reminders');
  if (!box) return;
  let list = [];
  try { list = await computeReminders(); } catch { /* ignore */ }
  box.innerHTML = list.length ? `
    <div class="card section">
      <h3>Rappels</h3>
      ${list.map(r => `<div class="reminder"><span>${r.icon} ${esc(r.text)}</span>${btn('details', 'Détails', { id: r.id, type: r.type })}</div>`).join('')}
    </div>` : '';
  notifyReminders(list);
}

async function toggleNotif(on) {
  const el = $('notifToggle');
  if (on) {
    if (!('Notification' in window)) {
      toast('Notifications indisponibles ici (sur iPhone, installe d’abord l’appli sur l’écran d’accueil)');
      if (el) el.checked = false;
      return;
    }
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    if (p !== 'granted') {
      toast('Notifications refusées dans les réglages du navigateur');
      if (el) el.checked = false;
      return;
    }
  }
  prefs.notif = !!on;
  savePrefs();
  if (on) refreshReminders();
}

/* ============================================================
   3. SOCIAL : liens de partage, goûts, vote à plusieurs
   ============================================================ */
const b64e = obj => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64d = str => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
};

const packItem = m => [m.id, typeOf(m) === 'tv' ? 't' : 'm', titleOf(m), m.poster_path || ''];
const appUrl = () => location.href.split('#')[0];
const shareLink = (kind, payload) => `${appUrl()}#${kind}=${b64e(payload)}`;

async function shareOrCopy(title, text, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Lien copié'); }
  catch { prompt('Copie ce lien :', url); }
}

function shareList(listId) {
  let name, movies;
  if (listId === 'watchlist') { name = 'Ma watchlist'; movies = watchlist; }
  else {
    const l = customLists.find(x => x.id === +listId);
    if (!l) return;
    name = l.name; movies = l.movies;
  }
  if (!movies.length) { toast('Cette liste est vide'); return; }
  const url = shareLink('list', { n: name, u: userProfile.name || '', i: movies.slice(0, 120).map(packItem) });
  shareOrCopy('Clap', `${userProfile.name || 'Un ami'} te partage « ${name} » sur Clap`, url);
}

function shareTaste() {
  const movies = watchedMovies.filter(m => typeOf(m) === 'movie');
  if (movies.length < 3) { toast('Marque au moins 3 films comme vus'); return; }
  const g = Object.entries(genreCountsOfWatched()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
  const loved = movies.filter(m => (m.rating || 0) >= 4).slice(0, 12).map(packItem);
  const url = shareLink('taste', { u: userProfile.name || '', w: movies.slice(0, 300).map(m => [m.id, m.rating || 0]), g, l: loved });
  shareOrCopy('Clap', `${userProfile.name || 'Un ami'} veut comparer vos goûts ciné sur Clap`, url);
}

// Les données reçues par lien ne sont jamais de confiance : on valide tout et on échappe à l'affichage
function sharedItems(arr) {
  return (arr || [])
    .filter(x => Array.isArray(x) && Number.isFinite(+x[0]))
    .slice(0, 150)
    .map(([id, t, title, p]) => {
      const type = t === 't' ? 'tv' : 'movie';
      const s = String(title || '').slice(0, 200);
      return remember({ id: +id, title: s, name: s, poster_path: /^\/[\w.-]+$/.test(p || '') ? p : null }, type);
    });
}

function handleSharedHash() {
  const m = location.hash.match(/^#(list|taste)=(.+)$/);
  if (!m) return;
  let data;
  try { data = b64d(m[2]); } catch { toast('Lien de partage invalide'); return; }
  history.replaceState(null, '', appUrl());
  if (m[1] === 'list') showSharedList(data); else showTaste(data);
}

let sharedCurrent = null;
const miniCard = (m, buttons) => `
  <div class="vote-item">
    <img loading="lazy" src="${poster(m.poster_path)}" alt="">
    <div>${esc(titleOf(m))}</div>
    <div class="buttons" style="justify-content:center">${buttons}</div>
  </div>`;

function showSharedList(data) {
  const items = sharedItems(data?.i);
  if (!items.length) { toast('Liste vide ou invalide'); return; }
  sharedCurrent = { name: String(data.n || 'Liste partagée').slice(0, 80), items };
  openAppModal(`
    <h3>${esc(sharedCurrent.name)}</h3>
    <p class="small">${data.u ? 'Partagée par ' + esc(String(data.u).slice(0, 40)) + ' · ' : ''}${items.length} titres</p>
    <div class="buttons">
      ${btn('sharedAddWL', 'Tout ajouter à mon À voir')}
      ${btn('sharedSave', 'Enregistrer comme liste')}
    </div>
    <div class="vote-grid" style="margin-top:14px">
      ${items.map(m => miniCard(m, btn('details', 'Détails', ref(m)) + btn('watchlist', '＋ À voir', ref(m)))).join('')}
    </div>`);
}

function sharedAddWL() {
  if (!sharedCurrent) return;
  let n = 0;
  sharedCurrent.items.forEach(m => {
    if (watchlist.some(w => w.id === m.id) || watchedMovies.some(w => w.id === m.id)) return;
    watchlist.unshift({ ...safeItem(m), title: titleOf(m), addedAt: new Date().toISOString() });
    n++;
  });
  saveAll();
  toast(n ? `${n} titres ajoutés à ton À voir` : 'Tout est déjà dans ta liste');
}

function sharedSave() {
  if (!sharedCurrent) return;
  customLists.push({ id: Date.now(), name: sharedCurrent.name, movies: sharedCurrent.items.map(m => ({ ...safeItem(m), title: titleOf(m) })) });
  saveAll();
  toast(`Liste « ${sharedCurrent.name} » enregistrée`);
}

function showTaste(data) {
  const their = new Map((data?.w || []).filter(x => Array.isArray(x)).map(([id, r]) => [+id, +r || 0]));
  if (!their.size) { toast('Lien invalide'); return; }
  const name = String(data.u || 'Ton ami').slice(0, 40);
  const mine = new Map(watchedMovies.filter(m => typeOf(m) === 'movie').map(m => [m.id, m.rating || 0]));

  const common = [...their.keys()].filter(id => mine.has(id));
  const both = common.filter(id => their.get(id) && mine.get(id));
  const ratingScore = both.length >= 2
    ? Math.max(0, 100 - 25 * (both.reduce((s, id) => s + Math.abs(their.get(id) - mine.get(id)), 0) / both.length))
    : 50;
  const overlap = Math.min(100, Math.round(common.length / Math.max(1, Math.min(mine.size, their.size)) * 100));
  const myG = Object.entries(genreCountsOfWatched()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
  const tg = (data.g || []).map(String).slice(0, 5);
  const sharedG = tg.filter(g => myG.includes(g));
  const genreScore = tg.length && myG.length ? Math.round(sharedG.length / new Set([...tg, ...myG]).size * 100) : 50;
  const score = mine.size ? Math.round(0.5 * ratingScore + 0.25 * overlap + 0.25 * genreScore) : null;

  const loved = sharedItems(data.l).filter(m => !mine.has(m.id) && !watchlist.some(w => w.id === m.id)).slice(0, 8);

  openAppModal(`
    <h3>Toi & ${esc(name)}</h3>
    <div class="card stat" style="margin:12px 0">
      <b style="font-size:40px">${score === null ? '—' : score + '%'}</b>
      <span class="small">${score === null ? 'Marque quelques films comme vus pour calculer votre compatibilité' : 'de compatibilité ciné'}</span>
    </div>
    <p class="small">
      ${common.length} film${common.length > 1 ? 's' : ''} en commun
      ${sharedG.length ? ' · genres communs : ' + esc(sharedG.join(', ')) : ''}
    </p>
    ${loved.length ? `
      <h4 style="margin-top:14px">Films que ${esc(name)} a adorés et que tu n’as pas vus</h4>
      <div class="vote-grid" style="margin-top:10px">
        ${loved.map(m => miniCard(m, btn('details', 'Détails', ref(m)) + btn('watchlist', '＋ À voir', ref(m)))).join('')}
      </div>` : ''}`);
}

/* ---------- Vote à plusieurs (on se passe le téléphone) ---------- */
function renderVoteSetup() {
  const sel = $('voteSource');
  if (!sel) return;
  const opts = [['watchlist', `À voir (${watchlist.length})`], ...customLists.map(l => [String(l.id), `${l.name} (${l.movies.length})`])];
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig === sig) return;
  const cur = sel.value;
  sel.innerHTML = opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  sel.dataset.sig = sig;
  if (opts.some(o => o[0] === cur)) sel.value = cur;
}

function startVote() {
  const src = $('voteSource')?.value || 'watchlist';
  const pool = src === 'watchlist' ? watchlist : (customLists.find(l => String(l.id) === src)?.movies || []);
  const names = ($('votePlayers')?.value || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
  const count = Number($('voteCount')?.value || 6);
  if (names.length < 2) { toast('Entre au moins 2 prénoms, séparés par des virgules'); return; }
  if (pool.length < 2) { toast('Il faut au moins 2 films dans la liste choisie'); return; }
  const cands = shuffle(pool).slice(0, count).map(m => remember(m));
  voteState = { cands, players: names, i: 0, picks: new Set(), score: Object.fromEntries(cands.map(c => [c.id, 0])), phase: 'handoff', winner: null };
  renderVote();
}

function renderVote() {
  const v = voteState;
  if (!v) return;
  const who = esc(v.players[v.i] || '');
  if (v.phase === 'handoff') {
    openAppModal(`
      <h3>Passe le téléphone à <b>${who}</b></h3>
      <p class="small">Joueur ${v.i + 1} sur ${v.players.length}. Les autres ne regardent pas</p>
      <div class="buttons">${btn('voteReady', 'Je suis prêt·e')}</div>`);
  } else if (v.phase === 'pick') {
    openAppModal(`
      <h3>${who}, qu’est-ce qui te tente ?</h3>
      <p class="small">Touche les films que tu veux bien regarder, puis valide.</p>
      <div class="vote-grid">
        ${v.cands.map(m => `<div class="vote-item ${v.picks.has(m.id) ? 'on' : ''}" data-act="votePick" data-id="${m.id}"><img loading="lazy" src="${poster(m.poster_path)}" alt=""><div>${esc(titleOf(m))}</div></div>`).join('')}
      </div>
      <div class="buttons"><button class="primary" type="button" data-act="voteNext">Valider mes choix</button></div>`);
  } else {
    const sorted = [...v.cands].sort((a, b) => v.score[b.id] - v.score[a.id]);
    const tie = sorted.filter(c => v.score[c.id] === v.score[sorted[0].id]).length > 1;
    const win = v.winner;
    openAppModal(`
      <h3>${tie ? 'Égalité : le hasard a tranché' : 'Le groupe a choisi'}</h3>
      <div class="card result-card" style="margin:12px 0">
        <img class="poster" src="${poster(win.poster_path)}" alt="${esc(titleOf(win))}">
        <div>
          <h2>${esc(titleOf(win))}</h2>
          <p class="small">${v.score[win.id]}/${v.players.length} votes</p>
          <div class="buttons">
            ${btn('details', 'Détails', ref(win))}
            ${btn('watched', 'Marquer comme vu', ref(win))}
            ${btn('voteAgain', 'Relancer le vote')}
          </div>
        </div>
      </div>
      <h4>Classement</h4>
      ${sorted.map(c => `<div class="reminder"><span>${esc(titleOf(c))}</span><span class="small">${v.score[c.id]}/${v.players.length}</span></div>`).join('')}`);
  }
}

function voteNext() {
  const v = voteState;
  if (!v) return;
  v.picks.forEach(id => { v.score[id] = (v.score[id] || 0) + 1; });
  v.picks = new Set();
  v.i++;
  if (v.i < v.players.length) v.phase = 'handoff';
  else {
    v.phase = 'result';
    const max = Math.max(...Object.values(v.score));
    v.winner = rand(v.cands.filter(c => v.score[c.id] === max));
  }
  renderVote();
}

/* ============================================================
   4. RECOMMANDATIONS « Pour toi »
   ============================================================ */
let recoSig = '';
let recoSeeds = [];

async function loadRecommendations(force = false) {
  const box = $('recoList');
  if (!box) return;
  const movies = watchedMovies.filter(m => typeOf(m) === 'movie');
  if (!movies.length) {
    box.innerHTML = '<div class="empty">Marque quelques films comme vus (et note-les) pour recevoir des recommandations.</div>';
    delete box.dataset.done;
    return;
  }
  const loved = movies.filter(m => (m.rating || 0) >= 4);
  const pool = loved.length >= 2 ? loved : movies;
  const sig = pool.map(m => m.id).join(',');
  if (!force && box.dataset.done === sig) return;
  if (force || sig !== recoSig) { recoSig = sig; recoSeeds = shuffle(pool).slice(0, 3); }
  if (!box.children.length) box.innerHTML = '<div class="small">Chargement…</div>';

  try {
    const lists = await Promise.all(recoSeeds.map(async seed => {
      try { return { seed, res: (await tmdb(`/movie/${seed.id}/recommendations`, 3600000)).results || [] }; }
      catch { return { seed, res: [] }; }
    }));
    const have = new Set([...watchedMovies, ...watchlist].map(m => m.id));
    const topG = Object.entries(genreCountsOfWatched()).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([n]) => GENRES.find(g => g.name === n)?.id);
    const scored = new Map();
    lists.forEach(({ seed, res }) => res.forEach(m => {
      if (have.has(m.id) || !m.poster_path || (m.vote_count || 0) < 50) return;
      const s = scored.get(m.id) || { m, score: 0, why: titleOf(seed) };
      s.score += 1 + (m.vote_average || 0) / 10 + (m.genre_ids || []).filter(g => topG.includes(g)).length * 0.5;
      scored.set(m.id, s);
    }));
    const top = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 6);
    if (!top.length) { box.innerHTML = '<div class="empty">Pas encore de suggestion — note quelques films de plus.</div>'; return; }
    const verb = loved.length >= 2 ? 'aimé' : 'vu';
    renderHomeList('recoList', top.map(t => t.m), 'movie', new Map(top.map(t => [t.m.id, `Parce que tu as ${verb} ${t.why}`])));
    box.dataset.done = sig;
  } catch {
    box.innerHTML = '<div class="empty">Impossible de charger les recommandations.</div>';
  }
}

/* ============================================================
   5. IMPORT CSV (Letterboxd ou fichier générique)
   ============================================================ */
function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  const pushRow = () => { row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else cur += c;
  }
  if (cur !== '' || row.length) pushRow();
  if (rows.length < 2) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const pickCol = (r, names) => { for (const n of names) if (r[n]) return r[n]; return ''; };

async function importRows(rows, kind, onProgress) {
  let ok = 0, miss = 0, done = 0;
  const queue = rows.slice();
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      try {
        const title = pickCol(r, ['name', 'title', 'titre', 'film', 'movie']);
        const year = parseInt(pickCol(r, ['year', 'année', 'annee', 'release year', 'release_year']), 10) || null;
        if (!title) { miss++; }
        else {
          let data = await tmdb(`/search/movie?query=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}&include_adult=false`, 3600000);
          let results = data.results || [];
          if (!results.length && year) {
            data = await tmdb(`/search/movie?query=${encodeURIComponent(title)}&include_adult=false`, 3600000);
            results = data.results || [];
          }
          const hit = (year && results.find(m => Math.abs((parseInt((m.release_date || '').slice(0, 4), 10) || 0) - year) <= 1)) || results[0];
          if (hit) {
            const rRaw = parseFloat(pickCol(r, ['rating', 'note']));
            const rating = rRaw > 0 ? Math.min(5, Math.max(1, Math.round(rRaw))) : null;
            applyImported(hit, kind, rating, pickCol(r, ['watched date', 'date', 'date de visionnage']), pickCol(r, ['review', 'critique']));
            ok++;
          } else miss++;
        }
      } catch { miss++; }
      done++;
      onProgress(done, rows.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { ok, miss };
}

function applyImported(hit, kind, rating, dateStr, review) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : null;
  const addedAt = d && !isNaN(d) ? d.toISOString() : new Date().toISOString();
  const item = { ...safeItem({ ...hit, media_type: 'movie' }), title: hit.title || hit.name, rating: rating || null, addedAt };
  if (kind === 'watched' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) item.watchedOn = dateStr;
  if (kind === 'watched' && review) item.review = review.slice(0, 2000);
  if (kind === 'watched') {
    const ex = watchedMovies.find(m => m.id === hit.id);
    if (ex) { if (rating && !ex.rating) ex.rating = rating; if (review && !ex.review) ex.review = review.slice(0, 2000); }
    else watchedMovies.push(item);
  } else if (!watchlist.some(m => m.id === hit.id) && !watchedMovies.some(m => m.id === hit.id)) {
    watchlist.push({ ...item, rating: null });
  }
}

async function importCSV(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const status = $('importStatus');
  let totalOk = 0, totalMiss = 0;
  saveUndo('Import Letterboxd');
  for (const f of files) {
    const rows = parseCSV(await f.text());
    if (!rows.length) { if (status) status.textContent = `${f.name} : aucun film trouvé`; continue; }
    const kind = /watchlist/i.test(f.name) ? 'watchlist' : 'watched';
    const { ok, miss } = await importRows(rows.slice(0, 1500), kind, (d, t) => { if (status) status.textContent = `${f.name} : ${d}/${t}…`; });
    totalOk += ok; totalMiss += miss;
  }
  input.value = '';
  watchlist = watchlist.filter(w => !watchedMovies.some(m => m.id === w.id));
  saveAll();
  if (status) status.textContent = `${totalOk} films importés${totalMiss ? ` · ${totalMiss} introuvables` : ''}.`;
  toast(`${totalOk} films importés`);
}


/* ---------- Nettoyage + annulation ---------- */
function saveUndo(label) {
  try { localStorage.setItem('cine_undo', JSON.stringify({ label, at: new Date().toISOString(), watched: watchedMovies, watchlist })); } catch { /* trop volumineux : pas d'annulation */ }
  renderCleanup();
}
function undoLast() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem('cine_undo') || 'null'); } catch { /* ignoré */ }
  if (!u) { toast('Rien à annuler'); return; }
  if (!confirm(`Annuler « ${u.label} » et revenir à l’état d’avant (${u.watched.length} vus, ${u.watchlist.length} à voir) ?`)) return;
  watchedMovies = u.watched; watchlist = u.watchlist;
  try { localStorage.removeItem('cine_undo'); } catch { /* ignoré */ }
  saveAll();
  toast('Annulé');
}
function clearData(kind) {
  const isW = kind === 'watched';
  const n = (isW ? watchedMovies : watchlist).length;
  if (!n) { toast(isW ? 'Aucun film vu à supprimer' : 'Ta watchlist est déjà vide'); return; }
  if (!confirm(`Supprimer ${isW ? 'TOUS tes films vus' : 'TOUTE ta watchlist'} (${n} films) ? Tu pourras annuler juste après.`)) return;
  saveUndo(isW ? 'Suppression des films vus' : 'Suppression de la watchlist');
  if (isW) watchedMovies = []; else watchlist = [];
  saveAll();
  toast('Supprimé — tu peux annuler dans Profil');
}
function renderCleanup() {
  const box = $('undoBox');
  if (!box) return;
  let u = null;
  try { u = JSON.parse(localStorage.getItem('cine_undo') || 'null'); } catch { /* ignoré */ }
  box.innerHTML = u ? `<button type="button" class="primary" data-act="undoLast">Annuler : ${esc(u.label)}</button><p class="small" style="margin:6px 0 0">Sauvegardé le ${formatDate(u.at)}</p>` : '<p class="small" style="margin:0">Rien à annuler pour l’instant.</p>';
}

/* ============================================================
   JOURNAL DE VISIONNAGE + CRITIQUES (façon Letterboxd)
   ============================================================ */
const watchedDate = m => (m.watchedOn || (m.addedAt ? String(m.addedAt).slice(0, 10) : ''));
const starsText = n => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function renderJournal(box) {
  const list = [...watchedMovies].sort((a, b) => watchedDate(b).localeCompare(watchedDate(a)) || new Date(b.addedAt) - new Date(a.addedAt));
  const groups = new Map();
  list.forEach(m => {
    const k = watchedDate(m).slice(0, 7) || '0000-00';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  });
  box.innerHTML = [...groups.entries()].map(([k, items]) => {
    const d = new Date(`${k}-01T12:00:00`);
    const label = isNaN(d) ? 'Date inconnue' : cap(d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
    return `<div class="j-month"><span>${esc(label)}</span><span>${items.length} film${items.length > 1 ? 's' : ''}</span></div>` + items.map(m => {
      const dd = new Date(`${watchedDate(m)}T12:00:00`);
      const ok = !isNaN(dd);
      return `<div class="j-row">
        <div class="j-day">${ok ? String(dd.getDate()).padStart(2, '0') : '–'}<small>${ok ? dd.toLocaleDateString('fr-FR', { weekday: 'short' }) : ''}</small></div>
        <img class="j-poster" loading="lazy" src="${poster(m.poster_path)}" alt="" data-act="details" data-id="${m.id}" data-type="${typeOf(m)}">
        <div class="j-main">
          <div class="j-title">${esc(m.title || m.name)} <span class="small">${yearOf(m) === '----' ? '' : yearOf(m)}</span></div>
          ${m.rating ? `<div class="j-stars">${starsText(m.rating)}</div>` : ''}
          ${m.review ? `<p class="j-review">${esc(m.review)}</p>` : ''}
          <div class="buttons" style="margin-top:6px">
            ${btn('review', m.review ? 'Modifier' : 'Critique', { id: m.id })}
            ${btn('details', 'Détails', ref(m))}
            ${btn('rmWatched', 'Retirer', { id: m.id })}
          </div>
        </div>
      </div>`;
    }).join('');
  }).join('');
}

let reviewDraft = null;
function openReview(id) {
  const m = watchedMovies.find(x => x.id === id);
  if (!m) return;
  reviewDraft = { id, n: m.rating || 0 };
  openAppModal(`
    <h3>${esc(m.title || m.name)} <span class="small">${yearOf(m) === '----' ? '' : yearOf(m)}</span></h3>
    <label>Vu le</label>
    <input id="rvDate" type="date" value="${esc(watchedDate(m))}" max="${new Date().toISOString().slice(0, 10)}">
    <label>Ta note</label>
    <div class="rating-row" id="rvStars"></div>
    <label>Ta critique (facultatif)</label>
    <textarea id="rvText" rows="5" maxlength="2000" placeholder="Qu’en as-tu pensé ? Ce qui t’a marqué, ce qui t’a fait rire, ce que tu en retiens…">${esc(m.review || '')}</textarea>
    <div class="buttons"><button class="primary" data-act="rvSave">Enregistrer</button><button onclick="closeAppModal()">Annuler</button></div>`);
  paintReviewStars();
}
function paintReviewStars() {
  const box = $('rvStars');
  if (!box || !reviewDraft) return;
  box.innerHTML = [1, 2, 3, 4, 5].map(n => btn('rvStar', `${reviewDraft.n >= n ? '★' : '☆'} ${n}`, { n })).join('');
}
function saveReview() {
  if (!reviewDraft) return;
  const date = $('rvDate')?.value || '';
  const text = ($('rvText')?.value || '').trim().slice(0, 2000);
  const { id, n } = reviewDraft;
  watchedMovies = watchedMovies.map(m => m.id === id ? { ...m, rating: n || null, review: text, watchedOn: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : m.watchedOn } : m);
  saveAll();
  closeAppModal();
  toast('Journal mis à jour');
}

/* ---------- Accueil plus chaleureux ---------- */
function renderHello() {
  const box = $('hello');
  if (!box) return;
  const h = new Date().getHours();
  const hi = h < 6 ? 'Encore debout' : h < 18 ? 'Bonjour' : 'Bonsoir';
  const name = (userProfile.name || '').trim();
  const month = new Date().toISOString().slice(0, 7);
  const nMonth = watchedMovies.filter(m => watchedDate(m).startsWith(month)).length;
  let line = 'Qu’est-ce qu’on regarde ce soir ?';
  if (nMonth > 1) line = `${nMonth} films vus ce mois-ci. Qu’est-ce qu’on regarde ensuite ?`;
  else if (watchlist.length) line = `Tu as ${watchlist.length} film${watchlist.length > 1 ? 's' : ''} qui t’attend${watchlist.length > 1 ? 'ent' : ''} dans ta liste.`;
  box.innerHTML = `<h2 style="margin:0 0 2px">${hi}${name ? ' ' + esc(name) : ''}</h2><p class="small" style="margin:0 0 14px">${esc(line)}</p>`;
}

Object.assign(ACTIONS, {
  undoLast: () => undoLast(),
  clearWatched: () => clearData('watched'),
  clearWatchlist: () => clearData('watchlist'),
  wview: d => { watchedView = d.v; setStorage('cine_wview', watchedView); renderWatched(); },
  review: d => openReview(+d.id),
  rvStar: d => { if (reviewDraft) { reviewDraft.n = reviewDraft.n === +d.n ? 0 : +d.n; paintReviewStars(); } },
  rvSave: () => saveReview()
});

/* ---------- Export vers Letterboxd (CSV) ---------- */
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildLetterboxdCSV(kind) {
  const movies = (kind === 'watchlist' ? watchlist : watchedMovies).filter(m => typeOf(m) === 'movie');
  const head = kind === 'watchlist' ? ['tmdbID', 'Title', 'Year'] : ['tmdbID', 'Title', 'Year', 'WatchedDate', 'Rating', 'Review'];
  const lines = [head.join(',')];
  movies.forEach(m => {
    const y = yearOf(m);
    const row = [m.id, m.title || m.name || '', y === '----' ? '' : y];
    if (kind !== 'watchlist') {
      row.push(watchedDate(m), m.rating ? m.rating : '', m.review || '');
    }
    lines.push(row.map(csvCell).join(','));
  });
  return { csv: lines.join('\r\n') + '\r\n', count: movies.length };
}
function exportLetterboxd(kind) {
  const { csv, count } = buildLetterboxdCSV(kind);
  if (!count) { toast(kind === 'watchlist' ? 'Ta watchlist est vide' : 'Aucun film vu à exporter'); return; }
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = kind === 'watchlist' ? 'clap-watchlist-letterboxd.csv' : 'clap-vus-letterboxd.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${count} films exportés`);
}

function exportPosters(kind) {
  const list = (kind === 'watchlist' ? watchlist : watchedMovies).filter(m => typeOf(m) === 'movie');
  if (!list.length) { toast('Rien à exporter'); return; }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = list.map(m => {
    const img = m.poster_path ? `${IMG}${m.poster_path}` : '';
    const y = yearOf(m);
    return `<figure>${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<div class="np"></div>'}<figcaption>${esc(m.title || m.name)}<small>${y === '----' ? '' : y}${m.rating ? ' · ' + '★'.repeat(m.rating) : ''}</small></figcaption></figure>`;
  }).join('');
  const title = kind === 'watchlist' ? 'Ma watchlist' : 'Mes films vus';
  const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Clap</title><style>body{margin:0;padding:16px;background:#0b1020;color:#fff;font-family:system-ui,sans-serif}h1{font-size:20px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}figure{margin:0}img,.np{width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:8px;background:#1b2340;display:flex;align-items:center;justify-content:center;font-size:32px}figcaption{font-size:12px;margin-top:4px}small{display:block;color:#9aa6d0}</style><h1>${title} (${list.length})</h1><main>${cards}</main></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  a.download = kind === 'watchlist' ? 'clap-watchlist-affiches.html' : 'clap-vus-affiches.html';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${list.length} affiches exportées`);
}

/* ============================================================
   6. BILAN ANNUEL (image partageable)
   ============================================================ */
let recapReady = false;

function renderRecapYears() {
  const sel = $('recapYear');
  if (!sel) return;
  const ys = new Set(watchedMovies.map(m => new Date(m.addedAt).getFullYear()).filter(Boolean));
  ys.add(new Date().getFullYear());
  const list = [...ys].sort((a, b) => b - a);
  const sig = list.join(',');
  if (sel.dataset.sig === sig) return;
  const cur = sel.value;
  sel.innerHTML = list.map(y => `<option value="${y}">${y}</option>`).join('');
  sel.dataset.sig = sig;
  if (list.map(String).includes(cur)) sel.value = cur;
}

const loadImg = url => new Promise(res => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const t = setTimeout(() => res(null), 6000);
  img.onload = () => { clearTimeout(t); res(img); };
  img.onerror = () => { clearTimeout(t); res(null); };
  img.src = url;
});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

async function generateRecap() {
  const year = Number($('recapYear')?.value) || new Date().getFullYear();
  const films = watchedMovies.filter(m => new Date(m.addedAt).getFullYear() === year);
  if (!films.length) { toast(`Aucun film vu en ${year}`); return; }

  const canvas = $('recapCanvas');
  const W = 1080, H = 1350;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = (w, s) => { ctx.font = `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; };

  const rated = films.filter(m => m.rating);
  const avg = rated.length ? (rated.reduce((a, m) => a + m.rating, 0) / rated.length).toFixed(1) : '–';
  const gc = {};
  films.forEach(m => (m.genre_ids || []).forEach(id => { const n = GENRE_MAP[id]; if (n) gc[n] = (gc[n] || 0) + 1; }));
  const topG = Object.entries(gc).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const best = [...films].sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.vote_average || 0) - (a.vote_average || 0)).slice(0, 4);
  const posters = await Promise.all(best.map(m => (m.poster_path ? loadImg(`https://image.tmdb.org/t/p/w342${m.poster_path}`) : Promise.resolve(null))));

  // fond
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2a2f6b'); bg.addColorStop(0.55, '#141a2e'); bg.addColorStop(1, '#0b1020');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 120, 20, W * 0.85, 120, 520);
  glow.addColorStop(0, 'rgba(99,102,241,.45)'); glow.addColorStop(1, 'rgba(99,102,241,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  font('700', 34); ctx.fillStyle = '#a5b4fc'; ctx.fillText('MON ANNÉE CINÉ', 60, 110);
  font('800', 190); ctx.fillStyle = '#ffffff'; ctx.fillText(String(year), 54, 290);
  if (userProfile.name) { font('600', 36); ctx.fillStyle = '#97a0c0'; ctx.fillText(fitText(ctx, userProfile.name, 900), 60, 345); }

  // 3 stats
  const stats = [[String(films.length), 'films vus'], [String(avg), 'note moyenne'], [topG[0]?.[0] || '–', 'genre n°1']];
  stats.forEach(([big, label], i) => {
    const x = 60 + i * 330, y = 400;
    ctx.fillStyle = 'rgba(255,255,255,.08)'; roundRect(ctx, x, y, 300, 160, 24); ctx.fill();
    font('800', i === 2 ? 44 : 78); ctx.fillStyle = '#ffffff'; ctx.fillText(fitText(ctx, big, 260), x + 24, y + 95);
    font('500', 26); ctx.fillStyle = '#97a0c0'; ctx.fillText(label, x + 24, y + 138);
  });

  // genres
  font('700', 28); ctx.fillStyle = '#a5b4fc'; ctx.fillText('MES GENRES', 60, 630);
  const maxC = Math.max(1, ...topG.map(g => g[1]));
  topG.forEach(([name, c], i) => {
    const y = 660 + i * 56;
    font('600', 28); ctx.fillStyle = '#e8ecf8'; ctx.fillText(fitText(ctx, name, 260), 60, y + 30);
    const w = Math.max(24, Math.round(520 * c / maxC));
    const grad = ctx.createLinearGradient(340, 0, 340 + w, 0);
    grad.addColorStop(0, '#dc2626'); grad.addColorStop(1, '#7f1d1d');
    ctx.fillStyle = grad; roundRect(ctx, 340, y, w, 40, 12); ctx.fill();
    font('700', 26); ctx.fillStyle = '#ffffff'; ctx.fillText(String(c), 340 + w + 14, y + 30);
  });
  if (!topG.length) { font('500', 28); ctx.fillStyle = '#97a0c0'; ctx.fillText('Pas encore de genres enregistrés', 60, 700); }

  // coups de cœur
  font('700', 28); ctx.fillStyle = '#a5b4fc'; ctx.fillText('MES COUPS DE CŒUR', 60, 950);
  best.forEach((m, i) => {
    const x = 60 + i * 260, y = 970, w = 180, h = 270;
    ctx.save(); roundRect(ctx, x, y, w, h, 16); ctx.clip();
    if (posters[i]) ctx.drawImage(posters[i], x, y, w, h);
    else { ctx.fillStyle = '#1b2340'; ctx.fillRect(x, y, w, h); }
    ctx.restore();
    font('600', 22); ctx.fillStyle = '#e8ecf8'; ctx.fillText(fitText(ctx, titleOf(m), w), x, y + h + 30);
  });

  // pied de page
  font('800', 30); ctx.fillStyle = '#ffffff'; ctx.fillText('Clap', 60, 1325);
  ctx.textAlign = 'right'; font('500', 24); ctx.fillStyle = '#97a0c0'; ctx.fillText('Mon bilan ciné', W - 60, 1323);
  ctx.textAlign = 'left';

  canvas.style.display = 'block';
  if ($('recapActions')) $('recapActions').style.display = 'flex';
  recapReady = true;
}

function downloadRecap() {
  if (!recapReady) return;
  const a = document.createElement('a');
  a.href = $('recapCanvas').toDataURL('image/png');
  a.download = `clap-bilan-${$('recapYear')?.value || ''}.png`;
  a.click();
}

function shareRecap() {
  if (!recapReady) return;
  $('recapCanvas').toBlob(async blob => {
    if (!blob) { downloadRecap(); return; }
    const file = new File([blob], 'clap-bilan.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Mon année ciné', text: 'Mon bilan ciné sur Clap' }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    downloadRecap();
  }, 'image/png');
}

/* ============================================================
   Animes (rubriques Découvrir)
   ============================================================ */
let animeLoaded = false, animeLoading = false;
async function loadAnime() {
  if (animeLoaded || animeLoading) return;
  animeLoading = true;
  try {
    const [tvr, mvr] = await Promise.all([
      tmdb('/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc&vote_count.gte=50'),
      tmdb('/discover/movie?with_genres=16&with_original_language=ja&sort_by=popularity.desc&vote_count.gte=100')
    ]);
    renderHomeList('animeSeries', (tvr.results || []).slice(0, 6), 'tv');
    renderHomeList('animeMovies', (mvr.results || []).slice(0, 6), 'movie');
    animeLoaded = true;
  } catch {
    ['animeSeries', 'animeMovies'].forEach(id => { if ($(id)) $(id).innerHTML = '<div class="empty">Impossible de charger.</div>'; });
  } finally { animeLoading = false; }
}

/* ============================================================
   Objectifs annuels
   ============================================================ */
const getGoals = () => Object.assign({ films: 0, series: 0, anime: 0 }, prefs.goals || {});

function yearProgress() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear() + 1, 0, 1);
  return { year: now.getFullYear(), day: Math.floor((now - start) / DAY) + 1, total: Math.round((end - start) / DAY) };
}

function goalCounts() {
  const { year } = yearProgress();
  const inYear = d => d && new Date(d).getFullYear() === year;
  let series = 0, anime = 0;
  seriesList.forEach(s => (s.seasons || []).forEach(se => (se.episodes || []).forEach(ep => {
    if (ep.watched && inYear(ep.watchedAt)) { if (s.isAnime) anime++; else series++; }
  })));
  return {
    films: watchedMovies.filter(m => typeOf(m) === 'movie' && inYear(m.addedAt)).length,
    series, anime
  };
}

function paceMsg(done, goal, unit) {
  if (done >= goal) return 'Objectif atteint !';
  const { day, total } = yearProgress();
  const diff = Math.round(done - goal * day / total);
  const state = diff > 0 ? `en avance de ${diff}` : diff < 0 ? `en retard de ${-diff}` : 'pile dans le rythme';
  const left = goal - done;
  const perWeek = Math.ceil(left / Math.max(1, (total - day) / 7) * 10) / 10;
  const proj = done > 0 ? ` · à ce rythme : ~${Math.round(done / day * total)}` : '';
  return `${state} · reste ${left} ${unit} (${perWeek.toLocaleString('fr-FR')}/semaine)${proj}`;
}

function goalRows(detail) {
  const g = getGoals(), c = goalCounts();
  return [['films', 'Films', 'films'], ['series', 'Séries', 'épisodes'], ['anime', 'Animes', 'épisodes']]
    .filter(([k]) => g[k] > 0)
    .map(([k, label, unit]) => {
      const pct = Math.min(100, Math.round(c[k] / g[k] * 100));
      return `<div class="goal">
        <div class="goal-head"><b>${label}</b><span>${c[k]}/${g[k]}</span></div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        ${detail ? `<div class="small" style="margin-top:4px">${paceMsg(c[k], g[k], unit)}</div>` : ''}
      </div>`;
    }).join('');
}

function renderGoals() {
  const { year } = yearProgress();
  if ($('goalYear')) $('goalYear').textContent = year;
  const full = goalRows(true);
  if ($('goalsBars')) $('goalsBars').innerHTML = full || '<div class="small">Aucun objectif défini.</div>';
  const mini = $('goalsMini');
  if (mini) {
    const rows = goalRows(false);
    mini.innerHTML = rows ? `<div class="card section goal-mini" data-act="goalsOpen"><h3>Mes objectifs ${year}</h3>${rows}</div>` : '';
  }
}

function setGoal() {
  const v = id => Math.max(0, Math.min(99999, parseInt($(id)?.value, 10) || 0));
  prefs.goals = { films: v('goalFilms'), series: v('goalSeries'), anime: v('goalAnime') };
  savePrefs();
  renderGoals();
}

function fillGoalInputs() {
  const g = getGoals();
  [['goalFilms', 'films'], ['goalSeries', 'series'], ['goalAnime', 'anime']].forEach(([id, k]) => {
    if ($(id) && document.activeElement !== $(id)) $(id).value = g[k] || '';
  });
}

/* ============================================================
   Reprendre : prochain épisode de chaque série en cours
   ============================================================ */
function nextToWatch(s, today) {
  const seasons = [...(s.seasons || [])].sort((a, b) => a.seasonNumber - b.seasonNumber);
  for (const se of seasons) {
    const eps = [...(se.episodes || [])].sort((a, b) => a.episodeNumber - b.episodeNumber);
    for (const ep of eps) {
      if (ep.watched) continue;
      if (ep.airDate && ep.airDate > today) return null; // rattrapé : le suivant n'est pas encore sorti
      return { se, ep };
    }
  }
  return null;
}

function renderResume() {
  const box = $('resume');
  if (!box) return;
  const today = new Date().toLocaleDateString('en-CA');
  const rows = [];
  seriesList.filter(s => s.status !== 'Terminé').forEach(s => {
    const nx = nextToWatch(s, today);
    if (!nx) return;
    const eps = (s.seasons || []).flatMap(se => se.episodes || []);
    const seen = eps.filter(e => e.watched);
    const last = Math.max(Date.parse(s.addedAt) || 0, ...seen.map(e => (e.watchedAt ? Date.parse(e.watchedAt) : 0)));
    rows.push({ s, nx, last, seen: seen.length, total: eps.length });
  });
  rows.sort((a, b) => b.last - a.last);
  if (!rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="section">
      <h2>Reprendre</h2>
      <div class="home-grid">
        ${rows.slice(0, 6).map(({ s, nx, seen, total }) => {
          const d = { sid: s.id, season: nx.se.seasonNumber, ep: nx.ep.episodeNumber };
          return `<div class="home-mini-card">
            <img class="home-mini-poster" loading="lazy" src="${poster(s.poster_path)}" alt="${esc(s.name)}">
            <div>
              <div><strong>${esc(s.name)}${s.isAnime ? '' : ''}</strong></div>
              <div class="small">S${nx.se.seasonNumber}E${nx.ep.episodeNumber} · ${esc(nx.ep.name)}</div>
              <div class="small">${seen}/${total} vus</div>
              <div class="buttons" style="margin-top:8px">
                ${btn('resumeSeen', 'Vu', d)}
                ${btn('resumeOpen', 'Ouvrir', { sid: s.id })}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function openSeriesFromResume(sid) {
  seriesList = seriesList.map(s => s.id === sid ? { ...s, expanded: true } : s);
  setStorage('cine_series', seriesList);
  renderAll();
  showTab('series', navBtn('series'));
}

/* ---------- Mise à jour des séries suivies (nouveaux épisodes / saisons) ---------- */
function mergeSeries(s, fresh) {
  const seasons = (s.seasons || []).map(se => ({ ...se, episodes: [...(se.episodes || [])] }));
  fresh.seasons.forEach(fs => {
    let se = seasons.find(x => x.seasonNumber === fs.seasonNumber);
    if (!se) { se = { seasonNumber: fs.seasonNumber, name: fs.name, expanded: false, episodes: [] }; seasons.push(se); }
    fs.episodes.forEach(fe => {
      const i = se.episodes.findIndex(x => x.episodeNumber === fe.episodeNumber);
      if (i >= 0) se.episodes[i] = { ...se.episodes[i], name: fe.name || se.episodes[i].name, airDate: fe.airDate || se.episodes[i].airDate };
      else se.episodes.push({ ...fe, watched: false, rating: null, watchedAt: null });
    });
    se.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  });
  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return { ...s, seasons, isAnime: fresh.isAnime, syncedAt: Date.now() };
}

let syncing = false;
async function syncSeries(force = false) {
  if (syncing) return;
  syncing = true;
  try {
    const now = Date.now();
    const today = new Date().toLocaleDateString('en-CA');
    const targets = seriesList
      .filter(s => s.status !== 'Terminé' && (force || !s.syncedAt || now - s.syncedAt > 12 * 3600 * 1000))
      .slice(0, 25);
    if (!targets.length) return;
    const results = new Map();
    await Promise.all(targets.map(async s => {
      try {
        const d = await tmdb(`/tv/${s.id}`, 3600000);
        const seasons = [];
        for (const se of (d.seasons || []).filter(x => x.season_number > 0)) {
          const have = (s.seasons || []).find(x => x.seasonNumber === se.season_number);
          const stale = !have || have.episodes.length !== se.episode_count ||
            have.episodes.some(e => !e.airDate || e.airDate >= today);
          if (!stale) continue;
          const sd = await tmdb(`/tv/${s.id}/season/${se.season_number}`, 3600000);
          seasons.push({
            seasonNumber: se.season_number, name: se.name || `Saison ${se.season_number}`,
            episodes: (sd.episodes || []).map(ep => ({
              episodeNumber: ep.episode_number, name: ep.name || `Épisode ${ep.episode_number}`, airDate: ep.air_date || null
            }))
          });
        }
        results.set(s.id, { isAnime: animeOf(d), seasons });
      } catch { /* on réessaiera plus tard */ }
    }));
    if (!results.size) return;
    seriesList = seriesList.map(s => (results.has(s.id) ? mergeSeries(s, results.get(s.id)) : s));
    setStorage('cine_series', seriesList); // pas saveAll : une synchro ne compte pas comme une journée d'activité
    renderAll();
  } finally { syncing = false; }
}

/* ============================================================
   Onglet « À venir » : épisodes, films en salle, nouvelles séries et animes
   ============================================================ */
const navBtn = id => document.querySelector(`#mainTabs [data-tab="${id}"]`);
const ymdIn = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString('en-CA'); };
const fmtDay = ds => {
  const n = dayDiff(ds);
  const [y, m, d] = ds.split('-').map(Number);
  let long = new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  long = long.charAt(0).toUpperCase() + long.slice(1);
  return n === 0 ? `Aujourd’hui<small>${long}</small>` : n === 1 ? `Demain<small>${long}</small>` : long;
};

let upData = null, upLoading = null;

async function loadUpcomingData() {
  if (upData && Date.now() - upData.t < 30 * 60000) return upData;
  if (upLoading) return upLoading;
  upLoading = (async () => {
    const from = ymdIn(0), to = ymdIn(180);
    const safe = p => p.catch(() => ({ results: [] }));
    const tracked = seriesList.filter(s => s.status !== 'Terminé');
    const [movies, prem, animePrem, nexts] = await Promise.all([
      (async () => { if (!window._upcomingMovies?.length) await loadUpcomingMovies(); return window._upcomingMovies || []; })(),
      safe(tmdb(`/discover/tv?sort_by=popularity.desc&first_air_date.gte=${from}&first_air_date.lte=${to}`)),
      safe(tmdb(`/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc&first_air_date.gte=${from}&first_air_date.lte=${to}`)),
      Promise.all(tracked.map(async s => {
        try { return [s.id, (await tmdb(`/tv/${s.id}`, 3600000)).next_episode_to_air || null]; } catch { return [s.id, null]; }
      }))
    ]);
    upData = { t: Date.now(), movies, prem: [...(animePrem.results || []), ...(prem.results || [])], nexts: new Map(nexts) };
    return upData;
  })();
  try { return await upLoading; } finally { upLoading = null; }
}

function buildUpcoming() {
  const range = Number(prefs.upRange) || 90;
  const today = ymdIn(0), last = ymdIn(range);
  const inRange = d => d && d >= today && d <= last;
  const out = [];
  const have = id => watchlist.some(m => m.id === id) || watchedMovies.some(m => m.id === id);

  // 1. Épisodes des séries suivies : ceux déjà connus + le prochain annoncé par TMDB
  seriesList.filter(s => s.status !== 'Terminé').forEach(s => {
    const seen = new Set();
    const push = (sn, en, name, date) => {
      const k = `${sn}x${en}`;
      if (seen.has(k) || !inRange(date)) return;
      seen.add(k);
      out.push({ date, kind: 'episode', anime: !!s.isAnime, mine: true, sid: s.id, title: s.name, poster: s.poster_path, sub: `S${sn}E${en} · ${name || 'Épisode ' + en}` });
    };
    (s.seasons || []).forEach(se => (se.episodes || []).forEach(ep => { if (!ep.watched) push(se.seasonNumber, ep.episodeNumber, ep.name, ep.airDate); }));
    const ne = upData?.nexts.get(s.id);
    if (ne) push(ne.season_number, ne.episode_number, ne.name, ne.air_date);
  });

  // 2. Films : ceux de ta watchlist d'abord, puis les sorties populaires
  const ids = new Set();
  watchlist.forEach(m => {
    const date = typeOf(m) === 'tv' ? m.first_air_date : m.release_date;
    if (!inRange(date)) return;
    ids.add(typeOf(m) + m.id);
    out.push({ date, kind: typeOf(m) === 'tv' ? 'tv' : 'movie', anime: animeOf(m), mine: true, item: remember(m, typeOf(m)), title: titleOf(m), poster: m.poster_path, inList: true });
  });
  (upData?.movies || []).forEach(m => {
    if (!inRange(m.release_date) || ids.has('movie' + m.id) || watchedMovies.some(w => w.id === m.id)) return;
    ids.add('movie' + m.id);
    out.push({ date: m.release_date, kind: 'movie', anime: animeOf(m), mine: false, item: remember(m, 'movie'), title: titleOf(m), poster: m.poster_path, inList: false });
  });

  // 3. Nouvelles séries / animes (sauf celles déjà suivies : leurs épisodes sont déjà listés)
  (upData?.prem || []).forEach(m => {
    if (!inRange(m.first_air_date) || !m.poster_path || ids.has('tv' + m.id) || seriesList.some(s => s.id === m.id)) return;
    ids.add('tv' + m.id);
    out.push({ date: m.first_air_date, kind: 'tv', anime: animeOf(m), mine: false, item: remember(m, 'tv'), title: titleOf(m), poster: m.poster_path, inList: false });
  });

  const f = prefs.upFilter || 'all';
  const keep = e => (f === 'all') || (f === 'movie' && e.kind === 'movie') || (f === 'series' && e.kind !== 'movie' && !e.anime) || (f === 'anime' && e.anime);
  return out.filter(keep).filter(e => !prefs.upMine || e.mine)
    .sort((a, b) => a.date.localeCompare(b.date) || (b.mine - a.mine) || a.title.localeCompare(b.title, 'fr'))
    .slice(0, 200);
}

function upRow(e) {
  const type = e.kind === 'movie' ? 'movie' : 'tv';
  const id = e.kind === 'episode' ? e.sid : e.item.id;
  const label = e.kind === 'episode' ? e.sub : e.kind === 'movie' ? 'Film · en salle' : 'Nouvelle série';
  const followed = type === 'tv' && seriesList.some(s => s.id === id);
  const inList = e.kind === 'movie' && (watchlist.some(m => m.id === id) || watchedMovies.some(m => m.id === id));
  let badges = '';
  if (e.anime) badges += '<span class="badge">Anime</span>';
  if (e.kind === 'episode' || followed) badges += '<span class="badge">Tu suis</span>';
  else if (e.inList || inList) badges += '<span class="badge">Dans ta liste</span>';
  let buttons = btn('details', 'Détails', { id, type });
  if (e.kind === 'movie' && !inList) buttons += btn('watchlist', '＋ À voir', { id, type });
  if (e.kind === 'tv' && !followed) buttons += btn('follow', 'Suivre', { id, type });
  return `<div class="up-row ${e.mine ? 'mine' : ''}">
    <img loading="lazy" src="${poster(e.poster)}" alt="">
    <div>
      <div class="up-title">${esc(e.title)}</div>
      <div class="small">${esc(label)}</div>
      <div>${badges}</div>
      <div class="buttons" style="margin-top:6px">${buttons}</div>
    </div>
  </div>`;
}

async function renderUpcoming() {
  const box = $('upcomingList');
  if (!box) return;
  document.querySelectorAll('#upFilters .fchip').forEach(b => b.classList.toggle('on', b.dataset.v === (prefs.upFilter || 'all')));
  if ($('upRange') && document.activeElement !== $('upRange')) $('upRange').value = String(prefs.upRange || 90);
  if ($('upMine')) $('upMine').checked = !!prefs.upMine;
  if (!upData && !box.children.length) box.innerHTML = '<div class="small">Chargement…</div>';
  try { await loadUpcomingData(); }
  catch { box.innerHTML = '<div class="empty">Impossible de charger les sorties.</div>'; return; }
  if (!$('upcoming')?.classList.contains('active')) return; // l'utilisateur a changé d'onglet entre-temps
  const list = buildUpcoming();
  if (!list.length) { box.innerHTML = '<div class="empty">Rien de prévu sur cette période avec ces filtres.</div>'; return; }
  let html = '', cur = '';
  list.forEach(e => {
    if (e.date !== cur) { cur = e.date; html += `<div class="up-date">${fmtDay(e.date)}</div>`; }
    html += upRow(e);
  });
  box.innerHTML = html;
}

function setUpcoming() {
  prefs.upRange = Number($('upRange')?.value) || 90;
  prefs.upMine = !!$('upMine')?.checked;
  savePrefs();
  renderUpcoming();
}

/* ============================================================
   Filmographie d'un acteur (depuis la recherche)
   ============================================================ */
async function showPersonFilms(id, name) {
  openAppModal(`<h3>${esc(name)}</h3><div class="small">Chargement…</div>`);
  try {
    const d = await tmdb(`/person/${id}/combined_credits`, 3600000);
    const seen = new Set();
    const items = (d.cast || [])
      .filter(m => m.poster_path && ['movie', 'tv'].includes(m.media_type) && (m.vote_count || 0) >= 5)
      .filter(m => !(m.genre_ids || []).some(g => g === 10767 || g === 10763))            // talk-shows, actualités
      .filter(m => !/^(self|himself|herself|lui-même|elle-même)\b/i.test(m.character || '')) // apparitions « en tant que soi »
      .filter(m => { const k = m.media_type + m.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 48);
    if (!items.length) { openAppModal(`<h3>${esc(name)}</h3><div class="empty">Aucun titre trouvé.</div>`); return; }
    openAppModal(`
      <h3>${esc(name)}</h3>
      <p class="small">${items.length} titres, du plus populaire au moins populaire</p>
      <div class="vote-grid">
        ${items.map(raw => {
          const m = remember(raw, raw.media_type);
          return `<div class="vote-item">
            <img loading="lazy" src="${poster(m.poster_path)}" alt="">
            <div>${esc(titleOf(m))}</div>
            <div class="small">${yearOf(m)} · ${mediaTypeLabel(typeOf(m))}</div>
            <div class="buttons" style="justify-content:center">${btn('details', 'Détails', ref(m))}${btn('watchlist', '＋ À voir', ref(m))}</div>
          </div>`;
        }).join('')}
      </div>`);
  } catch {
    openAppModal(`<h3>${esc(name)}</h3><div class="empty">Impossible de charger sa filmographie.</div>`);
  }
}

/* ============================================================
   Branchements
   ============================================================ */
function renderPlus() {
  renderCleanup();
  renderHello();
  renderVoteSetup();
  renderRecapYears();
  renderGoals();
  renderResume();
  if ($('upcoming')?.classList.contains('active')) renderUpcoming();
}

Object.assign(ACTIONS, {
  prov: d => toggleProvider(+d.id),
  person: d => showPersonFilms(+d.id, d.name),
  resumeSeen: d => toggleEpisodeWatched(+d.sid, +d.season, +d.ep),
  resumeOpen: d => openSeriesFromResume(+d.sid),
  goalsOpen: () => showTab('stats', navBtn('stats')),
  upFilter: d => { prefs.upFilter = d.v; savePrefs(); renderUpcoming(); },
  listShare: d => shareList(d.list),
  sharedAddWL: () => sharedAddWL(),
  sharedSave: () => sharedSave(),
  votePick: (d, el) => {
    if (!voteState) return;
    const id = +d.id;
    if (voteState.picks.has(id)) { voteState.picks.delete(id); el.classList.remove('on'); }
    else { voteState.picks.add(id); el.classList.add('on'); }
  },
  voteReady: () => { if (voteState) { voteState.phase = 'pick'; renderVote(); } },
  voteNext: () => voteNext(),
  voteAgain: () => startVote()
});


/* ============================================================
   CLASSIQUES : AFI 100 Years...100 Movies (édition 2007)
   ============================================================ */
const AFI_CATS = ["Action & aventure", "Drame", "Comédie", "Romance", "Science-fiction", "Western", "Thriller & policier", "Guerre", "Comédie musicale", "Famille & animation"];
const AFI = [[1,"Citizen Kane",1941,"Drame"],[2,"The Godfather",1972,"Thriller & policier"],[3,"Casablanca",1942,"Romance"],[4,"Raging Bull",1980,"Drame"],[5,"Singin' in the Rain",1952,"Comédie musicale"],[6,"Gone with the Wind",1939,"Romance"],[7,"Lawrence of Arabia",1962,"Action & aventure"],[8,"Schindler's List",1993,"Drame"],[9,"Vertigo",1958,"Thriller & policier"],[10,"The Wizard of Oz",1939,"Famille & animation"],[11,"City Lights",1931,"Comédie"],[12,"The Searchers",1956,"Western"],[13,"Star Wars",1977,"Science-fiction"],[14,"Psycho",1960,"Thriller & policier"],[15,"2001: A Space Odyssey",1968,"Science-fiction"],[16,"Sunset Boulevard",1950,"Drame"],[17,"The Graduate",1967,"Comédie"],[18,"The General",1926,"Action & aventure"],[19,"On the Waterfront",1954,"Drame"],[20,"It's a Wonderful Life",1946,"Drame"],[21,"Chinatown",1974,"Thriller & policier"],[22,"Some Like It Hot",1959,"Comédie"],[23,"The Grapes of Wrath",1940,"Drame"],[24,"E.T. the Extra-Terrestrial",1982,"Science-fiction"],[25,"To Kill a Mockingbird",1962,"Drame"],[26,"Mr. Smith Goes to Washington",1939,"Comédie"],[27,"High Noon",1952,"Western"],[28,"All About Eve",1950,"Drame"],[29,"Double Indemnity",1944,"Thriller & policier"],[30,"Apocalypse Now",1979,"Guerre"],[31,"The Maltese Falcon",1941,"Thriller & policier"],[32,"The Godfather Part II",1974,"Thriller & policier"],[33,"One Flew Over the Cuckoo's Nest",1975,"Drame"],[34,"Snow White and the Seven Dwarfs",1937,"Famille & animation"],[35,"Annie Hall",1977,"Comédie"],[36,"The Bridge on the River Kwai",1957,"Guerre"],[37,"The Best Years of Our Lives",1946,"Drame"],[38,"The Treasure of the Sierra Madre",1948,"Action & aventure"],[39,"Dr. Strangelove",1964,"Comédie"],[40,"The Sound of Music",1965,"Comédie musicale"],[41,"King Kong",1933,"Action & aventure"],[42,"Bonnie and Clyde",1967,"Thriller & policier"],[43,"Midnight Cowboy",1969,"Drame"],[44,"The Philadelphia Story",1940,"Comédie"],[45,"Shane",1953,"Western"],[46,"It Happened One Night",1934,"Comédie"],[47,"A Streetcar Named Desire",1951,"Drame"],[48,"Rear Window",1954,"Thriller & policier"],[49,"Intolerance",1916,"Drame"],[50,"The Lord of the Rings: The Fellowship of the Ring",2001,"Action & aventure"],[51,"West Side Story",1961,"Comédie musicale"],[52,"Taxi Driver",1976,"Thriller & policier"],[53,"The Deer Hunter",1978,"Guerre"],[54,"M*A*S*H",1970,"Guerre"],[55,"North by Northwest",1959,"Thriller & policier"],[56,"Jaws",1975,"Thriller & policier"],[57,"Rocky",1976,"Drame"],[58,"The Gold Rush",1925,"Comédie"],[59,"Nashville",1975,"Drame"],[60,"Duck Soup",1933,"Comédie"],[61,"Sullivan's Travels",1941,"Comédie"],[62,"American Graffiti",1973,"Comédie"],[63,"Cabaret",1972,"Comédie musicale"],[64,"Network",1976,"Drame"],[65,"The African Queen",1951,"Action & aventure"],[66,"Raiders of the Lost Ark",1981,"Action & aventure"],[67,"Who's Afraid of Virginia Woolf?",1966,"Drame"],[68,"Unforgiven",1992,"Western"],[69,"Tootsie",1982,"Comédie"],[70,"A Clockwork Orange",1971,"Science-fiction"],[71,"Saving Private Ryan",1998,"Guerre"],[72,"The Shawshank Redemption",1994,"Drame"],[73,"Butch Cassidy and the Sundance Kid",1969,"Western"],[74,"The Silence of the Lambs",1991,"Thriller & policier"],[75,"In the Heat of the Night",1967,"Thriller & policier"],[76,"Forrest Gump",1994,"Drame"],[77,"All the President's Men",1976,"Thriller & policier"],[78,"Modern Times",1936,"Comédie"],[79,"The Wild Bunch",1969,"Western"],[80,"The Apartment",1960,"Comédie"],[81,"Spartacus",1960,"Action & aventure"],[82,"Sunrise",1927,"Romance"],[83,"Titanic",1997,"Romance"],[84,"Easy Rider",1969,"Drame"],[85,"A Night at the Opera",1935,"Comédie"],[86,"Platoon",1986,"Guerre"],[87,"12 Angry Men",1957,"Drame"],[88,"Bringing Up Baby",1938,"Comédie"],[89,"The Sixth Sense",1999,"Thriller & policier"],[90,"Swing Time",1936,"Comédie musicale"],[91,"Sophie's Choice",1982,"Drame"],[92,"Goodfellas",1990,"Thriller & policier"],[93,"The French Connection",1971,"Thriller & policier"],[94,"Pulp Fiction",1994,"Thriller & policier"],[95,"The Last Picture Show",1971,"Drame"],[96,"Do the Right Thing",1989,"Drame"],[97,"Blade Runner",1982,"Science-fiction"],[98,"Yankee Doodle Dandy",1942,"Comédie musicale"],[99,"Toy Story",1995,"Famille & animation"],[100,"Ben-Hur",1959,"Action & aventure"]]; // [rang, titre, année, catégorie]
let afiBusy = false;

async function afiFind(row) {
  const [, title, year] = row;
  const q = encodeURIComponent(title);
  let res = await tmdb(`/search/movie?query=${q}&year=${year}`, 24 * 3600 * 1000);
  let list = res.results || [];
  if (!list.length) { res = await tmdb(`/search/movie?query=${q}`, 24 * 3600 * 1000); list = res.results || []; }
  return list.find(r => (r.release_date || '').slice(0, 4) === String(year)) || list[0] || null;
}

async function loadAFI() {
  const sel = $('afiCat');
  const box = $('afiList');
  if (!sel || !box || afiBusy) return;
  const cat = sel.value;
  const rows = AFI.filter(r => r[3] === cat);
  afiBusy = true;
  box.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    const cache = getStorage('cine_afi', {});
    const found = await Promise.all(rows.map(async r => {
      const key = r[0];
      if (cache[key]) return cache[key];
      try {
        const hit = await afiFind(r);
        if (hit) { cache[key] = safeItem({ ...hit, media_type: 'movie' }); return cache[key]; }
      } catch { /* ignoré */ }
      return null;
    }));
    setStorage('cine_afi', { ...getStorage('cine_afi', {}), ...cache });
    const reasons = new Map();
    const items = [];
    found.forEach((it, i) => {
      if (!it) return;
      reasons.set(it.id, `AFI n°${rows[i][0]}${watchedMovies.some(m => m.id === it.id) ? ' · vu' : ''}`);
      items.push(it);
    });
    renderHomeList('afiList', items, 'movie', reasons);
    const seen = items.filter(it => watchedMovies.some(m => m.id === it.id)).length;
    const info = $('afiInfo');
    if (info) info.textContent = `${seen}/${rows.length} vus dans cette catégorie · classés par rang AFI`;
  } catch {
    box.innerHTML = '<div class="empty">Impossible de charger.</div>';
  } finally {
    afiBusy = false;
  }
}

function afiWatchedCount() {
  const cache = getStorage('cine_afi', {});
  const ids = new Set(watchedMovies.filter(m => typeOf(m) === 'movie').map(m => m.id));
  return AFI.filter(r => cache[r[0]] && ids.has(cache[r[0]].id)).length;
}

// Résout les 100 films en arrière-plan (une seule fois) pour que le badge puisse se débloquer
async function resolveAFIAll() {
  const missing = AFI.filter(r => !getStorage('cine_afi', {})[r[0]]);
  if (!missing.length) return;
  const found = {};
  const queue = missing.slice();
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      try {
        const hit = await afiFind(r);
        if (hit) found[r[0]] = safeItem({ ...hit, media_type: 'movie' });
      } catch { /* on réessaiera au prochain lancement */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (Object.keys(found).length) {
    setStorage('cine_afi', { ...getStorage('cine_afi', {}), ...found });
    renderAll();
  }
}

function initAFI() {
  setTimeout(resolveAFIAll, 4000);
  const sel = $('afiCat');
  if (!sel) return;
  sel.innerHTML = AFI_CATS.map(c => `<option value="${c}">${c} (${AFI.filter(r => r[3] === c).length})</option>`).join('');
  loadAFI();
}

function initPlus() {
  initAFI();
  applyOnlyMine();
  fillGoalInputs();
  loadAnime();
  syncSeries();
  if ($('notifToggle')) $('notifToggle').checked = !!prefs.notif;
  renderProviderPicker();
  renderPlus();
  refreshReminders();
  loadRecommendations();
  handleSharedHash();

  window.addEventListener('hashchange', handleSharedHash);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshReminders(); syncSeries(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAppModal(); });
  document.addEventListener('click', e => { if (e.target === $('appModal')) closeAppModal(); });

  new MutationObserver(hydrateProviders).observe(document.body, { childList: true, subtree: true });
  hydrateProviders();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPlus);
else initPlus();
