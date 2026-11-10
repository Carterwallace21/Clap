/* ============================================================
   Clap – script de l'appli
   À coller dans ton <script>…</script> (ou à charger via <script src>)
   Les noms de fonctions utilisés par ton HTML sont conservés.
   ============================================================ */

const IMG = 'https://image.tmdb.org/t/p/w500';
// Clé v3 (courte) OU "Read Access Token" v4 (long, envoyé en Bearer)
const CLAP_VERSION = 27; // doit être identique dans clap-plus.js
const TMDB_KEY = 'f1de9e030815c6b8ffcc131f2d144956';

const GENRES = [
  { id: 28, name: 'Action' }, { id: 12, name: 'Aventure' }, { id: 16, name: 'Animation' },
  { id: 35, name: 'Comédie' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentaire' },
  { id: 18, name: 'Drame' }, { id: 10751, name: 'Famille' }, { id: 14, name: 'Fantastique' },
  { id: 36, name: 'Histoire' }, { id: 27, name: 'Horreur' }, { id: 10402, name: 'Musique' },
  { id: 9648, name: 'Mystère' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Science-fiction' },
  { id: 53, name: 'Thriller' }, { id: 10752, name: 'Guerre' }
];
const GENRE_MAP = Object.fromEntries(GENRES.map(g => [g.id, g.name]));
const NO_POSTER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750"><rect width="100%" height="100%" fill="#1f2937"/><text x="50%" y="50%" fill="#9ca3af" font-family="sans-serif" font-size="32" text-anchor="middle">Pas d\'image</text></svg>'
);

/* ---------- Utilitaires ---------- */
const $ = id => document.getElementById(id);
const ensureElement = (id, fallback = null) => $(id) || fallback;
const rand = arr => arr[Math.floor(Math.random() * arr.length)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function toast(msg) {
  let t = $('nwToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'nwToast';
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#111827;color:#fff;padding:10px 16px;border-radius:12px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .2s;opacity:0;pointer-events:none;font-size:14px';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.opacity = '0'; }, 2200);
}

/* ---------- Stockage ---------- */
function getStorage(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function setStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('Stockage plein ou indisponible', e); toast('⚠️ Sauvegarde impossible (stockage plein)'); }
}

function normalizeLegacySeries(list) {
  return (list || []).map(series => ({
    id: series.id,
    name: series.name || series.title || 'Série',
    poster_path: series.poster_path || null,
    status: series.status || 'En cours',
    addedAt: series.addedAt || new Date().toISOString(),
    nextEpisodeAirDate: series.nextEpisodeAirDate || null,
    expanded: !!series.expanded,
    isAnime: typeof series.isAnime === 'boolean' ? series.isAnime : undefined,
    syncedAt: series.syncedAt || 0,
    selectedSeason: series.selectedSeason || ((series.seasons || [])[0]?.seasonNumber || 1),
    seasons: Array.isArray(series.seasons) ? series.seasons.map(season => ({
      seasonNumber: season.seasonNumber,
      name: season.name || `Saison ${season.seasonNumber}`,
      expanded: !!season.expanded,
      episodes: Array.isArray(season.episodes) ? season.episodes.map(ep => ({
        episodeNumber: ep.episodeNumber,
        name: ep.name || `Épisode ${ep.episodeNumber}`,
        watched: !!ep.watched,
        rating: ep.rating || null,
        watchedAt: ep.watchedAt || null,
        airDate: ep.airDate || null
      })) : []
    })) : []
  }));
}

/* ---------- État ---------- */
let selectedActor = null;
let genreChart = null;
let ratingChart = null;
let homeLoaded = false;
let homeLoading = false;
let searchSuggestTimeout = null;
let searchSeq = 0;

let watchedMovies = getStorage('cine_watched', []);
let watchlist = getStorage('cine_watchlist', []);
let seriesList = normalizeLegacySeries(getStorage('cine_series', []));
let customLists = getStorage('cine_customLists', []);
let favoriteMovies = getStorage('cine_favoriteMovies', []);
let favoriteSeries = getStorage('cine_favoriteSeries', []);
let favoritePeople = getStorage('cine_favoritePeople', []);
let userProfile = getStorage('cine_profile', { name: '', avatarData: '' });
let activityTracker = getStorage('cine_activity', { watchedTonight: 0, partyModeUses: 0, activityDates: {} });
let prefs = Object.assign({ providers: [], onlyMine: false, notif: false }, getStorage('cine_prefs', {}));
function savePrefs() { setStorage('cine_prefs', prefs); }
// Filtre TMDB « seulement mes plateformes » (streaming, France)
function providerFilter() {
  return prefs.onlyMine && prefs.providers.length
    ? `&watch_region=FR&with_watch_monetization_types=flatrate&with_watch_providers=${prefs.providers.join('|')}`
    : '';
}

function saveAll() {
  const today = new Date().toISOString().slice(0, 10);
  activityTracker.activityDates = activityTracker.activityDates || {};
  activityTracker.activityDates[today] = (activityTracker.activityDates[today] || 0) + 1;

  setStorage('cine_watched', watchedMovies);
  setStorage('cine_watchlist', watchlist);
  setStorage('cine_series', seriesList);
  setStorage('cine_customLists', customLists);
  setStorage('cine_favoriteMovies', favoriteMovies);
  setStorage('cine_favoriteSeries', favoriteSeries);
  setStorage('cine_favoritePeople', favoritePeople);
  setStorage('cine_profile', userProfile);
  setStorage('cine_activity', activityTracker);
  renderAll();
}

/* ---------- Items & registre (plus de JSON dans les onclick) ---------- */
const itemCache = new Map();
const keyOf = (id, type) => `${type}:${id}`;
const typeOf = item => item.media_type || 'movie';
const titleOf = item => item.title || item.name || 'Sans titre';

function remember(item, type) {
  const t = type || typeOf(item);
  const full = { ...item, media_type: t };
  itemCache.set(keyOf(item.id, t), full);
  return full;
}

function getItem(id, type) {
  const cached = itemCache.get(keyOf(id, type));
  if (cached) return cached;
  const pool = [
    ...watchedMovies, ...watchlist,
    ...seriesList.map(s => ({ ...s, media_type: 'tv' })),
    ...customLists.flatMap(l => l.movies),
    ...favoriteMovies, ...favoriteSeries, ...favoritePeople
  ];
  return pool.find(m => m.id === id && typeOf(m) === type) || null;
}

function safeItem(item) {
  return {
    id: item.id,
    title: item.title || null,
    name: item.name || null,
    poster_path: item.poster_path || null,
    profile_path: item.profile_path || null,
    media_type: item.media_type || 'movie',
    vote_average: item.vote_average || 0,
    release_date: item.release_date || '',
    first_air_date: item.first_air_date || '',
    overview: item.overview || '',
    genre_ids: item.genre_ids || [],
    original_language: item.original_language || '',
    rating: item.rating || null,
    addedAt: item.addedAt || new Date().toISOString()
  };
}

function mediaTypeLabel(type) {
  if (type === 'tv') return 'Série';
  if (type === 'person') return 'Acteur';
  return 'Film';
}
function yearOf(item) {
  const v = item.release_date || item.first_air_date || '';
  return v ? v.slice(0, 4) : '----';
}
const poster = path => (path ? `${IMG}${path}` : NO_POSTER);
function formatDate(date) {
  const d = new Date(date);
  return isNaN(d) ? 'Date inconnue' : d.toLocaleDateString('fr-FR');
}

/* ---------- Helpers HTML ---------- */
function btn(act, label, attrs = {}) {
  const a = Object.entries(attrs).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button type="button" data-act="${act}" ${a}>${label}</button>`;
}
const ref = (item, type) => ({ id: item.id, type: type || typeOf(item) });
const stars = (act, attrs, current) =>
  [1, 2, 3, 4, 5].map(n => btn(act, `${current === n ? '★' : '☆'} ${n}`, { ...attrs, n })).join('');
const isFav = (id, type) =>
  ({ movie: favoriteMovies, tv: favoriteSeries, person: favoritePeople }[type] || []).some(f => f.id === id);
const favBtn = item => btn('fav', isFav(item.id, typeOf(item)) ? '★ Favori' : '☆ Favoris', ref(item));

function listSelect(item) {
  if (!customLists.length) return '';
  return `<select data-change="addToList" data-id="${item.id}" data-type="${esc(typeOf(item))}">
    <option value="">＋ Liste</option>
    ${customLists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}
  </select>`;
}

/* ---------- API TMDB (avec cache) ---------- */
const tmdbCache = new Map();
async function tmdb(path, ttl = 10 * 60 * 1000) {
  const hit = tmdbCache.get(path);
  if (hit && Date.now() - hit.t < ttl) return hit.data;

  const bearer = TMDB_KEY.length > 40;
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3${path}${sep}language=fr-FR${bearer ? '' : '&api_key=' + TMDB_KEY}`;
  const headers = { accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${TMDB_KEY}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Erreur API TMDB: ${res.status}`);
  const data = await res.json();
  tmdbCache.set(path, { t: Date.now(), data });
  return data;
}

/* ---------- Navigation ---------- */
function fillGenres() {
  const select = $('genreSelect');
  if (select) select.innerHTML = GENRES.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

function showTab(id, btnEl) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#mainTabs .tab-btn').forEach(el => el.classList.remove('active'));
  $(id)?.classList.add('active');
  btnEl?.classList.add('active');

  if (id === 'stats') renderChart();
  if (id === 'upcoming' && typeof renderUpcoming === 'function') renderUpcoming();
  if (id === 'discover') { loadHomeSections(); loadRecommendations(); refreshReminders(); if (typeof loadAnime === 'function') loadAnime(); }
  if (id === 'series') { renderNextEpisodes(); renderMovieCalendar(); }
}

function showSeriesTab(panel, btnEl) {
  document.querySelectorAll('.series-panel').forEach(el => {
    el.style.display = 'none';
    el.classList.remove('active');
  });
  document.querySelectorAll('#series .tabs .tab-btn').forEach(el => el.classList.remove('active'));

  const target = $(`seriesPanel-${panel}`);
  if (target) { target.style.display = 'block'; target.classList.add('active'); }
  btnEl?.classList.add('active');

  if (panel === 'next') renderNextEpisodes();
  if (panel === 'calendar') renderMovieCalendar();
}

function toggleRandomMode() {
  const mode = $('randomMode')?.value || 'genre';
  if ($('genreBlock')) $('genreBlock').style.display = mode === 'genre' ? 'block' : 'none';
  if ($('actorBlock')) $('actorBlock').style.display = mode === 'actor' ? 'block' : 'none';
}

/* ---------- Recherche (façon YouTube) ---------- */
let searchActive = -1;
let searchTyped = '';
let recentSearches = getStorage('cine_recent', []);

function hideSuggestions() {
  const box = $('searchSuggestions');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  searchActive = -1;
}

function saveRecent(q) {
  recentSearches = [q, ...recentSearches.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  setStorage('cine_recent', recentSearches);
}

function showRecents() {
  const box = $('searchSuggestions');
  const q = $('searchInput')?.value.trim() || '';
  if (!box || q || !recentSearches.length) return;
  searchActive = -1;
  box.innerHTML = recentSearches.map(r => `
    <div class="search-suggestion-item sug-row" data-act="pickSuggestion" data-title="${esc(r)}">
      <span class="sug-ico">🕘</span>
      <div class="sug-grow"><div class="suggestion-title">${esc(r)}</div></div>
      <button type="button" class="sug-x" data-act="rmRecent" data-q="${esc(r)}" aria-label="Supprimer de l’historique">✕</button>
    </div>`).join('');
  box.style.display = 'block';
}

function removeRecent(q) {
  recentSearches = recentSearches.filter(x => x !== q);
  setStorage('cine_recent', recentSearches);
  showRecents();
  if (!recentSearches.length) hideSuggestions();
}

function clearSearch() {
  const input = $('searchInput');
  if (input) { input.value = ''; input.focus(); }
  searchSeq++;
  clearTimeout(searchSuggestTimeout);
  $('searchWrap')?.classList.remove('has-text');
  if ($('searchResults')) $('searchResults').innerHTML = '';
  hideSuggestions();
  showRecents();
}

function handleSearchInput() {
  const q = $('searchInput')?.value.trim() || '';
  searchTyped = $('searchInput')?.value || '';
  $('searchWrap')?.classList.toggle('has-text', !!searchTyped);
  clearTimeout(searchSuggestTimeout);
  if (q.length < 1) { hideSuggestions(); showRecents(); return; }
  if (q.length < 2) { hideSuggestions(); return; }

  const seq = ++searchSeq;
  searchSuggestTimeout = setTimeout(async () => {
    try {
      const data = await tmdb(`/search/multi?query=${encodeURIComponent(q)}&include_adult=false&page=1`);
      if (seq !== searchSeq) return; // réponse périmée
      const results = (data.results || [])
        .filter(r => ['movie', 'tv', 'person'].includes(r.media_type))
        .slice(0, 7);
      renderSuggestions(results, q);
    } catch { hideSuggestions(); }
  }, 180);
}

// Partie tapée en normal, suite proposée en gras (comme YouTube)
function highlightTitle(title, q) {
  const t = String(title), ql = q.toLowerCase();
  const i = t.toLowerCase().indexOf(ql);
  if (i === -1) return esc(t);
  return `${esc(t.slice(0, i))}<span class="sug-typed">${esc(t.slice(i, i + q.length))}</span><b>${esc(t.slice(i + q.length))}</b>`.replace(/<b><\/b>/, '');
}

function renderSuggestions(results, q = '') {
  const box = $('searchSuggestions');
  if (!box) return;
  if (!results.length) { hideSuggestions(); return; }
  searchActive = -1;

  box.innerHTML = results.map(item => {
    const title = titleOf(item);
    const hasDate = item.release_date || item.first_air_date;
    const meta = `${mediaTypeLabel(item.media_type)}${hasDate ? ' · ' + yearOf(item) : ''}`;
    const isPerson = item.media_type === 'person';
    const img = poster(isPerson ? item.profile_path : item.poster_path);
    return `
      <div class="search-suggestion-item sug-row" data-act="pickSuggestion" data-title="${esc(title)}">
        <img class="sug-img${isPerson ? ' round' : ''}" loading="lazy" src="${img}" alt="">
        <div class="sug-grow">
          <div class="suggestion-title">${highlightTitle(title, q)}</div>
          <div class="suggestion-meta">${esc(meta)}</div>
        </div>
        <span class="sug-go" aria-hidden="true">↖</span>
      </div>`;
  }).join('');
  box.style.display = 'block';
}

function pickSuggestion(title) {
  const input = $('searchInput');
  if (input) input.value = title;
  $('searchWrap')?.classList.toggle('has-text', !!title);
  hideSuggestions();
  searchContent();
}

function moveActive(dir) {
  const rows = [...document.querySelectorAll('#searchSuggestions .search-suggestion-item')];
  if (!rows.length) return;
  searchActive = (searchActive + dir + rows.length + 1) % (rows.length + 1);
  if (searchActive === rows.length) searchActive = -1; // retour à ce que l'utilisateur a tapé
  rows.forEach((r, i) => r.classList.toggle('active', i === searchActive));
  const input = $('searchInput');
  if (input) input.value = searchActive === -1 ? searchTyped : rows[searchActive].dataset.title;
  rows[searchActive]?.scrollIntoView({ block: 'nearest' });
}

function handleSearchKeydown(event) {
  const open = $('searchSuggestions')?.style.display === 'block';
  if (event.key === 'ArrowDown' && open) { event.preventDefault(); moveActive(1); }
  else if (event.key === 'ArrowUp' && open) { event.preventDefault(); moveActive(-1); }
  else if (event.key === 'Escape') { hideSuggestions(); }
  else if (event.key === 'Enter') {
    event.preventDefault();
    hideSuggestions();
    searchContent();
  }
}

async function searchContent() {
  const q = $('searchInput')?.value.trim() || '';
  if (!q) return;
  hideSuggestions();
  saveRecent(q);

  const box = $('searchResults');
  if (!box) return;
  box.innerHTML = '<div class="small">Chargement...</div>';

  try {
    const data = await tmdb(`/search/multi?query=${encodeURIComponent(q)}&include_adult=false`);
    const results = (data.results || [])
      .filter(r => ['movie', 'tv', 'person'].includes(r.media_type))
      .slice(0, 12);
    box.innerHTML = results.length
      ? results.map(renderSearchCard).join('')
      : '<div class="empty">Aucun résultat.</div>';
  } catch {
    box.innerHTML = '<div class="empty">Erreur pendant la recherche.</div>';
  }
}

function renderSearchCard(raw) {
  const item = remember(raw);
  const type = typeOf(item);
  const isPerson = type === 'person';
  const overview = item.overview || item.known_for_department || 'Aucune description disponible.';

  return `
    <div class="card result-card">
      <img class="poster" loading="lazy" src="${poster(item.poster_path || item.profile_path)}" alt="${esc(titleOf(item))}">
      <div>
        <h3>${esc(titleOf(item))}</h3>
        <div>
          <span class="badge">${mediaTypeLabel(type)}</span>
          ${!isPerson ? `<span class="badge">${yearOf(item)}</span>` : ''}
          ${animeOf(item) ? '<span class="badge">🎌 Anime</span>' : ''}
          ${item.vote_average ? `<span class="badge">⭐ ${Number(item.vote_average).toFixed(1)}</span>` : ''}
        </div>
        <p class="small" style="margin-top:10px;">${esc(overview)}</p>
        ${!isPerson ? provSlot(item) : ''}
        <div class="buttons">
          ${!isPerson ? `
            ${btn('watched', 'Vu', ref(item))}
            ${btn('watchlist', 'À voir', ref(item))}
            ${btn('details', 'Détails', ref(item))}
            ${btn('share', 'Partager', ref(item))}
            ${type === 'tv' ? btn('follow', 'Suivre la série', ref(item)) : ''}
            ${listSelect(item)}
          ` : ''}
          ${isPerson ? btn('person', '🎬 Ses films', { id: item.id, name: titleOf(item) }) : ''}
          ${favBtn(item)}
        </div>
      </div>
    </div>`;
}

/* ---------- Accueil / Découvrir ---------- */
async function loadHomeSections() {
  if (homeLoaded || homeLoading) return;
  homeLoading = true;

  try {
    const today = new Date();
    const monthAgo = new Date(); monthAgo.setDate(today.getDate() - 30);
    const fmt = d => d.toISOString().slice(0, 10);

    const [tm, ttv, nm, ns] = await Promise.all([
      tmdb('/trending/movie/week'),
      tmdb('/trending/tv/week'),
      tmdb(`/discover/movie?sort_by=popularity.desc&primary_release_date.gte=${fmt(monthAgo)}&primary_release_date.lte=${fmt(today)}&vote_count.gte=20`),
      tmdb(`/discover/tv?sort_by=popularity.desc&first_air_date.gte=${fmt(monthAgo)}&first_air_date.lte=${fmt(today)}&vote_count.gte=10`)
    ]);

    renderHomeList('trendingMovies', (tm.results || []).slice(0, 6), 'movie');
    renderHomeList('trendingSeries', (ttv.results || []).slice(0, 6), 'tv');
    renderHomeList('newMovies', (nm.results || []).slice(0, 6), 'movie');
    renderHomeList('newSeries', (ns.results || []).slice(0, 6), 'tv');

    await loadUpcomingMovies();
    renderMovieCalendar();
    homeLoaded = true;
  } catch (err) {
    console.error(err);
    ['trendingMovies', 'trendingSeries', 'newMovies', 'newSeries'].forEach(id => {
      const el = $(id);
      if (el) el.innerHTML = `<div class="empty">Impossible de joindre TMDB (${esc(err?.message || 'réseau')}).<br>Vérifie ta connexion, ton DNS privé ou ton bloqueur de pubs.<br><button type="button" class="primary" data-act="retryHome" style="margin-top:8px">↻ Réessayer</button></div>`;
    });
  } finally {
    homeLoading = false;
  }
}

// Sorties à venir : les 6 prochains mois (plus de date codée en dur)
async function loadUpcomingMovies() {
  try {
    const fmt = d => d.toISOString().slice(0, 10);
    const start = new Date();
    const end = new Date(); end.setMonth(end.getMonth() + 6);

    const pages = await Promise.all([1, 2, 3].map(p =>
      tmdb(`/discover/movie?sort_by=popularity.desc&primary_release_date.gte=${fmt(start)}&primary_release_date.lte=${fmt(end)}&with_release_type=2|3&page=${p}`)
    ));
    const seen = new Set();
    window._upcomingMovies = pages
      .flatMap(p => p.results || [])
      .filter(m => m.poster_path && !seen.has(m.id) && seen.add(m.id))
      .slice(0, 40);
  } catch {
    window._upcomingMovies = [];
  }
}

function renderHomeList(containerId, items, mediaType, reasons) {
  const box = $(containerId);
  if (!box) return;
  if (!items.length) { box.innerHTML = '<div class="empty">Aucun résultat.</div>'; return; }

  box.innerHTML = items.map(raw => {
    const item = remember(raw, mediaType);
    return `
      <div class="home-mini-card">
        <img class="home-mini-poster" loading="lazy" src="${poster(item.poster_path)}" alt="${esc(titleOf(item))}">
        <div>
          <div><strong>${esc(titleOf(item))}</strong></div>
          <div class="small">${yearOf(item)} ${item.vote_average ? `· ⭐ ${Number(item.vote_average).toFixed(1)}` : ''}</div>
          ${reasons?.get(item.id) ? `<div class="small">${esc(reasons.get(item.id))}</div>` : ''}
          ${provSlot(item)}
          <div class="buttons" style="margin-top:8px;">
            ${btn('watchlist', 'À voir', ref(item))}
            ${btn('watched', 'Vu', ref(item))}
            ${btn('details', 'Détails', ref(item))}
            ${btn('share', 'Partager', ref(item))}
            ${mediaType === 'tv' ? btn('follow', 'Suivre', ref(item)) : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ---------- Films : vus / à voir ---------- */
function addWatched(item) {
  const movie = {
    ...safeItem(item),
    title: item.title || item.name,
    addedAt: new Date().toISOString(),
    rating: item.rating || null
  };
  if (!watchedMovies.some(m => m.id === movie.id && typeOf(m) === typeOf(movie))) watchedMovies.unshift(movie);
  watchlist = watchlist.filter(m => m.id !== movie.id);
  saveAll();
  toast(`✅ « ${movie.title} » ajouté aux vus`);
}

function addWatchlist(item) {
  const movie = {
    ...safeItem(item),
    title: item.title || item.name,
    addedAt: new Date().toISOString(),
    rating: item.rating || null
  };
  if (watchlist.some(m => m.id === movie.id && typeOf(m) === typeOf(movie))) {
    toast('Déjà dans ta watchlist');
    return;
  }
  watchlist.unshift(movie);
  saveAll();
  toast(`📝 « ${movie.title} » ajouté à ta watchlist`);
}

function removeWatched(id) { watchedMovies = watchedMovies.filter(m => m.id !== id); saveAll(); }
function removeWatchlist(id) { watchlist = watchlist.filter(m => m.id !== id); saveAll(); }

function rateMovie(id, rating) {
  watchedMovies = watchedMovies.map(m => m.id === id ? { ...m, rating: m.rating === rating ? null : rating } : m);
  saveAll();
}
function rateWatchlistMovie(id, rating) {
  watchlist = watchlist.map(m => m.id === id ? { ...m, rating: m.rating === rating ? null : rating } : m);
  saveAll();
}

function sortItems(list, sortBy) {
  const s = [...list];
  if (sortBy === 'title') s.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'fr'));
  else if (sortBy === 'rating') s.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else s.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  return s;
}

let watchedView = getStorage('cine_wview', 'journal');

function renderWatched() {
  const box = $('watchedList');
  if (!box) return;
  document.querySelectorAll('[data-act="wview"]').forEach(b => b.classList.toggle('on', b.dataset.v === watchedView));
  if ($('watchedSort')) $('watchedSort').style.display = watchedView === 'list' ? '' : 'none';
  if (!watchedMovies.length) { box.innerHTML = '<div class="empty">Ton journal est vide pour l’instant 🍿<br>Marque un film comme « Vu » et il apparaîtra ici, avec sa date.</div>'; return; }
  if (watchedView === 'journal') { renderJournal(box); return; }

  box.innerHTML = sortItems(watchedMovies, $('watchedSort')?.value || 'addedAt').map(movie => `
    <div class="card list-card" style="margin-bottom:12px;">
      <img class="list-poster" loading="lazy" src="${poster(movie.poster_path)}" alt="">
      <div>
      <h3>${esc(movie.title)}</h3>
      <p class="small">Ajouté le ${formatDate(movie.addedAt)}</p>
      <div class="rating-row">${stars('rate', { id: movie.id }, movie.rating)}</div>
      <p class="small" style="margin-top:10px;">Ta note : <strong>${movie.rating ? movie.rating + '/5' : 'Non noté'}</strong></p>
      ${movie.review ? `<p class="j-review">${esc(movie.review)}</p>` : ''}
      <div class="buttons">
        ${btn('review', '✍️ Critique', { id: movie.id })}
        ${btn('details', 'Détails', ref(movie))}
        ${btn('share', 'Partager', ref(movie))}
        ${btn('rmWatched', 'Retirer', { id: movie.id })}
        ${favBtn(movie)}
        ${listSelect(movie)}
      </div>
      </div>
    </div>`).join('');
}

function renderWatchlist() {
  const box = $('watchlist');
  const randomBox = $('watchlistRandomResult');
  if (!box) return;
  if (!watchlist.length) {
    box.innerHTML = '<div class="empty">Ta watchlist est vide.</div>';
    if (randomBox) randomBox.innerHTML = '';
    return;
  }

  box.innerHTML = sortItems(watchlist, $('watchlistSort')?.value || 'addedAt').map(movie => `
    <div class="card list-card" style="margin-bottom:12px;">
      <img class="list-poster" loading="lazy" src="${poster(movie.poster_path)}" alt="">
      <div>
      <h3>${esc(movie.title)}</h3>
      <p class="small">Ajouté le ${formatDate(movie.addedAt)}</p>
      ${provSlot(movie)}
      <div class="rating-row">${stars('rateWL', { id: movie.id }, movie.rating)}</div>
      <p class="small" style="margin-top:10px;">Note d'envie : <strong>${movie.rating ? movie.rating + '/5' : 'Non noté'}</strong></p>
      <div class="buttons">
        ${btn('details', 'Détails', ref(movie))}
        ${btn('share', 'Partager', ref(movie))}
        ${btn('watched', 'Marquer comme vu', ref(movie))}
        ${btn('rmWatchlist', 'Retirer', { id: movie.id })}
        ${favBtn(movie)}
        ${listSelect(movie)}
      </div>
      </div>
    </div>`).join('');
}

/* ---------- Favoris ---------- */
function toggleFavorite(id, type) {
  const item = getItem(id, type);
  const list = { movie: favoriteMovies, tv: favoriteSeries, person: favoritePeople }[type];
  if (!item || !list) return;

  const i = list.findIndex(f => f.id === id);
  if (i >= 0) list.splice(i, 1);
  else list.push(safeItem({ ...item, media_type: type }));
  saveAll();
}

function renderFavorites() {
  if ($('favoriteMoviesCount')) $('favoriteMoviesCount').textContent = favoriteMovies.length;
  if ($('favoriteSeriesCount')) $('favoriteSeriesCount').textContent = favoriteSeries.length;
  if ($('favoritePeopleCount')) $('favoritePeopleCount').textContent = favoritePeople.length;

  const box = $('favoritePeopleList');
  if (!box) return;
  box.innerHTML = favoritePeople.length
    ? favoritePeople.map(p => `
        <div class="card" style="margin-bottom:8px;">
          <h4>${esc(p.name)}</h4>
          ${btn('fav', 'Retirer des favoris', { id: p.id, type: 'person' })}
        </div>`).join('')
    : '<div class="empty">Aucun favori.</div>';
}

/* ---------- Profil ---------- */
function updateProfile() {
  userProfile = { name: $('profileName')?.value || '', avatarData: userProfile.avatarData };
  saveAll();
}

function handleAvatarUpload() {
  const file = $('profileAvatarFile')?.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      // Réduction à 256px max pour ne pas saturer le localStorage
      const scale = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      userProfile.avatarData = c.toDataURL('image/jpeg', 0.8);
      saveAll();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function badgeChip(b) {
  return `<span class="badge" data-act="badge" data-name="${esc(b)}" style="cursor:pointer;">${esc(b)}</span>`;
}

function renderProfile() {
  if ($('displayName')) $('displayName').textContent = userProfile.name || 'Anonyme';

  const avatar = $('displayAvatar');
  if (avatar) {
    if (userProfile.avatarData) { avatar.src = userProfile.avatarData; avatar.style.display = 'block'; }
    else avatar.style.display = 'none';
  }

  const el = $('profileBadges');
  if (el) {
    const { badges } = calculateBadges();
    el.innerHTML = badges.length ? badges.map(badgeChip).join(' ') : 'Aucun badge pour l\'instant.';
  }
}

/* ---------- Séries ---------- */
async function addSeries(item) {
  if (seriesList.some(s => s.id === item.id)) { toast('Série déjà suivie'); return; }
  toast('Ajout de la série…');

  try {
    const details = await tmdb(`/tv/${item.id}`);
    const realSeasons = (details.seasons || []).filter(s => s.season_number > 0);

    // Saisons chargées en parallèle
    const seasons = await Promise.all(realSeasons.map(async season => {
      const base = { seasonNumber: season.season_number, name: season.name || `Saison ${season.season_number}`, expanded: false };
      try {
        const sd = await tmdb(`/tv/${item.id}/season/${season.season_number}`, 60 * 60 * 1000);
        return {
          ...base,
          episodes: (sd.episodes || []).map(ep => ({
            episodeNumber: ep.episode_number,
            name: ep.name || `Épisode ${ep.episode_number}`,
            watched: false, rating: null, airDate: ep.air_date || null
          }))
        };
      } catch { return { ...base, episodes: [] }; }
    }));

    seriesList.unshift({
      id: item.id,
      name: item.name || item.title,
      poster_path: item.poster_path || null,
      status: 'En cours',
      seasons,
      addedAt: new Date().toISOString(),
      nextEpisodeAirDate: null,
      expanded: false,
      isAnime: animeOf(item),
      selectedSeason: seasons.length ? seasons[0].seasonNumber : 1
    });
    saveAll();
    toast(`📺 « ${item.name || item.title} » suivie`);
  } catch (err) {
    console.error(err);
    toast("Impossible d'ajouter cette série.");
  }
}

// Helpers de mise à jour immuable
function updateSeries(sid, fn) { seriesList = seriesList.map(s => s.id === sid ? fn(s) : s); saveAll(); }
function updateSeason(sid, sn, fn) {
  updateSeries(sid, s => ({ ...s, seasons: (s.seasons || []).map(se => se.seasonNumber === sn ? fn(se) : se) }));
}
function updateEpisodes(sid, sn, fn) {
  updateSeason(sid, sn, se => ({ ...se, episodes: (se.episodes || []).map(fn) }));
}

const removeSeries = id => { seriesList = seriesList.filter(s => s.id !== id); saveAll(); };
const toggleSeriesExpanded = sid => updateSeries(sid, s => ({ ...s, expanded: !s.expanded }));
const toggleSeriesStatus = sid => updateSeries(sid, s => ({ ...s, status: s.status === 'Terminé' ? 'En cours' : 'Terminé' }));
const selectSeason = (sid, sn) => updateSeries(sid, s => ({ ...s, selectedSeason: Number(sn) }));
// Anime = genre Animation + langue d'origine japonaise (fonctionne avec une fiche détaillée ou une carte de liste)
function animeOf(x) {
  const ids = x?.genre_ids || (x?.genres || []).map(g => g.id);
  return ids.includes(16) && x?.original_language === 'ja';
}
// Date de visionnage : posée quand un épisode passe à « vu », conservée s'il l'était déjà
const stampEp = (ep, watched) => ({
  ...ep, watched,
  watchedAt: watched ? (ep.watched ? ep.watchedAt : new Date().toISOString()) : null
});

const toggleEpisodeWatched = (sid, sn, en) =>
  updateEpisodes(sid, sn, ep => ep.episodeNumber === en ? stampEp(ep, !ep.watched) : ep);
const rateEpisode = (sid, sn, en, rating) =>
  updateEpisodes(sid, sn, ep => ep.episodeNumber === en ? { ...ep, rating: ep.rating === rating ? null : rating } : ep);
const markSeasonWatched = (sid, sn, watched = true) =>
  updateEpisodes(sid, sn, ep => stampEp(ep, watched));
const markSeriesWatched = (sid, watched = true) =>
  updateSeries(sid, s => ({ ...s, seasons: (s.seasons || []).map(se => ({ ...se, episodes: (se.episodes || []).map(ep => stampEp(ep, watched)) })) }));
// « Vu jusqu'ici » : tout ce qui précède, saisons précédentes comprises
const markWatchedUntil = (sid, sn, en) =>
  updateSeries(sid, s => ({ ...s, seasons: (s.seasons || []).map(se => ({
    ...se,
    episodes: (se.episodes || []).map(ep =>
      (se.seasonNumber < sn || (se.seasonNumber === sn && ep.episodeNumber <= en)) ? stampEp(ep, true) : ep)
  })) }));

function getSeriesStats(series) {
  const eps = (series.seasons || []).flatMap(s => s.episodes || []);
  const ratings = eps.map(ep => ep.rating).filter(Boolean);
  return {
    watchedCount: eps.filter(ep => ep.watched).length,
    totalCount: eps.length,
    avgRating: ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null
  };
}

function renderSeries() {
  const box = $('seriesList');
  if (!box) return;
  if (!seriesList.length) {
    box.innerHTML = '<div class="empty">Ajoute une série depuis l’onglet Découvrir.</div>';
    return;
  }

  const f = $('seriesFilter')?.value || 'all';
  const shown = seriesList.filter(s => f === 'all' || (f === 'anime') === !!s.isAnime);
  if (!shown.length) {
    box.innerHTML = `<div class="empty">${f === 'anime' ? 'Aucun anime suivi pour l’instant.' : 'Aucune série (hors anime) suivie pour l’instant.'}</div>`;
    return;
  }

  box.innerHTML = shown.map(series => {
    const stats = getSeriesStats(series);
    const progress = stats.totalCount ? Math.round(stats.watchedCount / stats.totalCount * 100) : 0;
    const selNum = series.selectedSeason || series.seasons[0]?.seasonNumber || 1;
    const sel = series.seasons.find(s => s.seasonNumber === selNum);
    const sid = { sid: series.id };

    const seasonBlock = !series.expanded ? '' : `
      <div style="margin-top:16px;">
        <label>Choisir une saison</label>
        <select data-change="season" data-sid="${series.id}">
          ${series.seasons.map(se => `<option value="${se.seasonNumber}" ${se.seasonNumber === selNum ? 'selected' : ''}>${esc(se.name)}</option>`).join('')}
        </select>
        ${sel ? `
          <div class="season-card">
            <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
              <div>
                <h4>${esc(sel.name)}</h4>
                <p class="small">${sel.episodes.filter(ep => ep.watched).length}/${sel.episodes.length} épisodes vus</p>
              </div>
              <div class="buttons" style="margin-top:0;">
                ${btn('sSeasonOn', 'Saison vue', { ...sid, season: sel.seasonNumber })}
                ${btn('sSeasonOff', 'Décocher saison', { ...sid, season: sel.seasonNumber })}
              </div>
            </div>
            <div style="margin-top:12px;">
              ${sel.episodes.length ? sel.episodes.map(ep => {
                const e = { ...sid, season: sel.seasonNumber, ep: ep.episodeNumber };
                return `
                  <div class="episode-card">
                    <div class="episode-head">
                      <div>
                        <strong>S${sel.seasonNumber}E${ep.episodeNumber}</strong>
                        <span class="small"> · ${esc(ep.name)}</span>
                        ${ep.airDate ? `<div class="small">Diffusion : ${formatDate(ep.airDate)}</div>` : ''}
                      </div>
                      <div class="buttons" style="margin-top:0;">
                        ${btn('epToggle', ep.watched ? '✅ Vu' : '⬜ Pas vu', e)}
                        ${btn('epUntil', 'Vu jusqu’à cet épisode', e)}
                      </div>
                    </div>
                    <div class="rating-row">${stars('epRate', e, ep.rating)}</div>
                    <div class="small" style="margin-top:8px;">Note épisode : <strong>${ep.rating ? ep.rating + '/5' : 'Non noté'}</strong></div>
                  </div>`;
              }).join('') : '<div class="empty">Aucun épisode trouvé pour cette saison.</div>'}
            </div>
          </div>` : '<div class="empty" style="margin-top:12px;">Aucune saison trouvée.</div>'}
      </div>`;

    return `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <div>
            <h3>${esc(series.name)}${series.isAnime ? ' 🎌' : ''}</h3>
            <p class="small">
              ${stats.watchedCount}/${stats.totalCount} épisodes vus · ${esc(series.status)}
              ${stats.avgRating ? ` · Note moyenne épisodes : ${stats.avgRating}/5` : ''}
            </p>
          </div>
          <div class="buttons" style="margin-top:0;">
            ${btn('sExpand', series.expanded ? 'Masquer' : 'Ouvrir la série', sid)}
            ${btn('sAll', 'Tout vu', sid)}
            ${btn('sNone', 'Tout décocher', sid)}
            ${btn('sStatus', 'Basculer statut', sid)}
            ${btn('details', 'Détails', { id: series.id, type: 'tv' })}
            ${btn('sRemove', 'Retirer', sid)}
          </div>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${progress}%"></div></div>
        ${seasonBlock}
      </div>`;
  }).join('');
}

async function renderNextEpisodes() {
  const box = $('nextEpisodesList');
  if (!box) return;
  const tracked = seriesList.filter(s => s.status !== 'Terminé');
  if (!tracked.length) { box.innerHTML = '<div class="empty">Aucune série suivie.</div>'; return; }

  // Cache 1 h : on ne refait pas N appels à chaque changement d'onglet
  const items = await Promise.all(tracked.map(async series => {
    try {
      const d = await tmdb(`/tv/${series.id}`, 60 * 60 * 1000);
      return { ...series, nextEpisode: d.next_episode_to_air || null, nextEpisodeAirDate: d.next_episode_to_air?.air_date || null };
    } catch { return { ...series, nextEpisode: null, nextEpisodeAirDate: null }; }
  }));

  const filtered = items
    .filter(s => s.nextEpisodeAirDate)
    .sort((a, b) => new Date(a.nextEpisodeAirDate) - new Date(b.nextEpisodeAirDate));

  box.innerHTML = filtered.length ? filtered.map(s => `
    <div class="card" style="margin-bottom:12px;">
      <h3>${esc(s.name)}</h3>
      <p class="small">Prochain épisode : <strong>${formatDate(s.nextEpisodeAirDate)}</strong></p>
      ${s.nextEpisode ? `<p class="small">S${s.nextEpisode.season_number}E${s.nextEpisode.episode_number} · ${esc(s.nextEpisode.name || 'Sans titre')}</p>` : ''}
      <div class="buttons" style="margin-top:8px;">${btn('details', 'Voir synopsis & bande-annonce', { id: s.id, type: 'tv' })}</div>
    </div>`).join('')
    : '<div class="empty">Aucun prochain épisode connu pour le moment.</div>';
}

function renderMovieCalendar() {
  const box = $('movieCalendarList');
  if (!box) return;
  const items = [...(window._upcomingMovies || [])]
    .sort((a, b) => new Date(a.release_date || '9999-12-31') - new Date(b.release_date || '9999-12-31'));
  if (!items.length) { box.innerHTML = '<div class="empty">Calendrier indisponible pour le moment.</div>'; return; }

  box.innerHTML = items.map(raw => {
    const movie = remember(raw, 'movie');
    return `
      <div class="home-mini-card">
        <img class="home-mini-poster" loading="lazy" src="${poster(movie.poster_path)}" alt="${esc(movie.title)}">
        <div>
          <div><strong>${esc(movie.title)}</strong></div>
          <div class="small">Sortie : ${movie.release_date ? formatDate(movie.release_date) : 'Inconnue'}</div>
          <div class="buttons" style="margin-top:8px;">
            ${btn('watchlist', 'Ajouter à ma liste', ref(movie))}
            ${btn('details', 'Détails', ref(movie))}
            ${btn('share', 'Partager', ref(movie))}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ---------- Badges & stats ---------- */
const BADGE_DESCRIPTIONS = {
  '🎬 Premier clap': 'Regarder 1 film',
  '🍿 Habitué du canapé': 'Regarder 10 films',
  '📽️ Binge-watcher': 'Regarder 20 films',
  '🏆 Monstre du grand écran': 'Regarder 50 films',
  '🔪 Amateur de thrillers': 'Voir 5 thrillers',
  '👻 Enfant de minuit': 'Voir 5 films d\'horreur',
  '😂 Maître du rire': 'Voir 5 comédies',
  '🚀 Voyageur spatial': 'Voir 5 films de science-fiction',
  '⚔️ Cœur d\'action': 'Voir 5 films d\'action',
  '💘 Cœur tendre': 'Voir 5 romances',
  '🕵️ Détective du dimanche': 'Voir 5 films de mystère',
  '🏛️ Roi des classiques': 'Voir 5 films sortis avant 2000',
  '📼 Nostalgique VHS': 'Voir 5 films des années 80/90',
  '🎞️ Cinéphile curieux': 'Regarder des films de 10 années différentes',
  '🧭 Explorateur cinéma': 'Voir des films de 8 genres différents',
  '📺 Sériephile': 'Suivre 3 séries',
  '📡 Accro aux épisodes': 'Suivre 5 séries',
  '⏭️ Marathonien': 'Voir 50 épisodes',
  '✅ Finisher': 'Terminer 3 séries',
  '📝 Collectionneur': 'Ajouter 20 titres à la watchlist',
  '🎯 Toujours prêt': 'Avoir 10 films dans la watchlist',
  '🗂️ Curateur': 'Créer 3 listes personnalisées',
  '⭐ Goût affirmé': 'Noter 10 films',
  '🌟 Fan absolu': 'Ajouter 5 favoris',
  '🎭 Fidèle au casting': 'Ajouter 3 acteurs/réalisateurs en favoris',
  '🪞 Signature perso': 'Remplir ton profil local',
  '🌙 Vu ce soir': 'Utiliser le bouton "Vu ce soir" 3 fois',
  '📆 Régulier': 'Avoir une activité sur 7 jours différents',
  '🔥 En feu': 'Voir 5 films en une semaine',
  '🦍 Regelegorilla': '🤫 Badge secret : avoir vu les 100 films classiques de l’AFI',
  '👑 Identité ciné': 'Débloquer 5 badges'
};

function genreCountsOfWatched() {
  const counts = {};
  watchedMovies.forEach(m => (m.genre_ids || []).forEach(id => {
    const name = GENRE_MAP[id];
    if (name) counts[name] = (counts[name] || 0) + 1;
  }));
  return counts;
}

function calculateBadges() {
  const badges = [];
  const add = (cond, name) => { if (cond) badges.push(name); };
  const episodes = seriesList.reduce((sum, s) => sum + getSeriesStats(s).watchedCount, 0);
  const ratings = watchedMovies.map(m => m.rating).filter(Boolean);
  const g = genreCountsOfWatched();
  const year = m => parseInt(m.release_date?.slice(0, 4)) || null;

  add(watchedMovies.length >= 1, '🎬 Premier clap');
  add(watchedMovies.length >= 10, '🍿 Habitué du canapé');
  add(watchedMovies.length >= 20, '📽️ Binge-watcher');
  add(watchedMovies.length >= 50, '🏆 Monstre du grand écran');

  add((g['Thriller'] || 0) >= 5, '🔪 Amateur de thrillers');
  add((g['Horreur'] || 0) >= 5, '👻 Enfant de minuit');
  add((g['Comédie'] || 0) >= 5, '😂 Maître du rire');
  add((g['Science-fiction'] || 0) >= 5, '🚀 Voyageur spatial');
  add((g['Action'] || 0) >= 5, '⚔️ Cœur d\'action');
  add((g['Romance'] || 0) >= 5, '💘 Cœur tendre');
  add((g['Mystère'] || 0) >= 5, '🕵️ Détective du dimanche');

  add(watchedMovies.filter(m => year(m) && year(m) < 2000).length >= 5, '🏛️ Roi des classiques');
  add(watchedMovies.filter(m => year(m) >= 1980 && year(m) < 2000).length >= 5, '📼 Nostalgique VHS');
  add(new Set(watchedMovies.map(year).filter(Boolean)).size >= 10, '🎞️ Cinéphile curieux');
  add(Object.keys(g).length >= 8, '🧭 Explorateur cinéma');

  add(seriesList.length >= 3, '📺 Sériephile');
  add(seriesList.length >= 5, '📡 Accro aux épisodes');
  add(episodes >= 50, '⏭️ Marathonien');
  add(seriesList.filter(s => s.status === 'Terminé').length >= 3, '✅ Finisher');

  add(watchlist.length >= 20, '📝 Collectionneur');
  add(watchlist.length >= 10, '🎯 Toujours prêt');
  add(customLists.length >= 3, '🗂️ Curateur');
  add(ratings.length >= 10, '⭐ Goût affirmé');

  add(favoriteMovies.length + favoriteSeries.length >= 5, '🌟 Fan absolu');
  add(favoritePeople.length >= 3, '🎭 Fidèle au casting');
  add(!!(userProfile.name && userProfile.avatarData), '🪞 Signature perso');
  add(activityTracker.watchedTonight >= 3, '🌙 Vu ce soir');
  add(Object.keys(activityTracker.activityDates || {}).length >= 7, '📆 Régulier');

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  add(watchedMovies.filter(m => new Date(m.addedAt) >= weekAgo).length >= 5, '🔥 En feu');
  add(typeof afiWatchedCount === 'function' && afiWatchedCount() >= 100, '🦍 Regelegorilla');
  add(badges.length >= 5, '👑 Identité ciné');

  return { badges, descriptions: BADGE_DESCRIPTIONS };
}

function showBadgeDetails(name) {
  const description = BADGE_DESCRIPTIONS[name];
  if (!description) return;
  if ($('badgeTitle')) $('badgeTitle').textContent = name;
  if ($('badgeDescription')) $('badgeDescription').textContent = 'Objectif: ' + description;
  if ($('badgeModal')) $('badgeModal').style.display = 'block';
}
function closeBadgeModal() { if ($('badgeModal')) $('badgeModal').style.display = 'none'; }

function renderStats() {
  const episodes = seriesList.reduce((sum, s) => sum + getSeriesStats(s).watchedCount, 0);
  const ratings = watchedMovies.map(m => m.rating).filter(Boolean);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) + '/5' : '-';
  const { badges } = calculateBadges();

  const values = {
    statWatched: watchedMovies.length, statWatchlist: watchlist.length,
    statSeries: seriesList.length, statEpisodes: episodes,
    seriesOngoing: seriesList.filter(s => s.status === 'En cours').length,
    seriesFinished: seriesList.filter(s => s.status === 'Terminé').length,
    seriesEpisodes: episodes,
    statsFilms: watchedMovies.length, statsATvoir: watchlist.length,
    statsSeries: seriesList.length, statsEpisodes: episodes,
    statsRating: avg,
    statsBadges: badges.length ? badges.map(badgeChip).join(' ') : 'Aucun badge pour l\'instant.'
  };
  Object.entries(values).forEach(([id, val]) => { const el = $(id); if (el) el.innerHTML = val; });
}

function renderChart() {
  const genreCanvas = $('genreChart');
  if (!genreCanvas || typeof Chart === 'undefined') return;

  const counts = genreCountsOfWatched();
  const labels = Object.keys(counts);
  if (genreChart) genreChart.destroy();
  genreChart = new Chart(genreCanvas, {
    type: 'pie',
    data: {
      labels,
      datasets: [{ data: Object.values(counts), backgroundColor: labels.map((_, i) => `hsl(${(i * 47) % 360} 70% 55%)`) }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } } }
  });

  const ratingCanvas = $('ratingChart');
  if (!ratingCanvas) return;
  const rc = [0, 0, 0, 0, 0];
  watchedMovies.forEach(m => { if (m.rating >= 1 && m.rating <= 5) rc[m.rating - 1]++; });
  if (ratingChart) ratingChart.destroy();
  ratingChart = new Chart(ratingCanvas, {
    type: 'bar',
    data: { labels: ['1', '2', '3', '4', '5'], datasets: [{ label: 'Nombre de films', data: rc, backgroundColor: '#3b82f6' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { color: '#fff', precision: 0 } }, x: { ticks: { color: '#fff' } } },
      plugins: { legend: { labels: { color: '#fff' } } }
    }
  });
}

/* ---------- Tirage au sort ---------- */
function featuredCard(movie, heading, buttons) {
  return `
    <div class="card result-card">
      <img class="poster" loading="lazy" src="${poster(movie.poster_path)}" alt="${esc(titleOf(movie))}">
      <div>
        ${heading ? `<h3>${heading}</h3>` : ''}
        <h2>${esc(titleOf(movie))}</h2>
        <div>
          <span class="badge">${yearOf(movie)}</span>
          ${movie.vote_average ? `<span class="badge">⭐ ${Number(movie.vote_average).toFixed(1)}</span>` : ''}
        </div>
        <p class="small" style="margin-top:10px;">${esc(movie.overview || 'Pas de synopsis disponible.')}</p>
        ${provSlot(movie, 'nohide')}
        <div class="buttons">${buttons}</div>
      </div>
    </div>`;
}

function discoverQuery(genreId) {
  const decade = $('decadeSelect')?.value || '';
  const minRating = Number($('minRatingSelect')?.value || 0);
  const maxRuntime = Number($('maxRuntimeSelect')?.value || 0);
  let q = `with_genres=${genreId}&sort_by=popularity.desc&page=${Math.floor(Math.random() * 5) + 1}&vote_count.gte=100`;
  if (decade) q += `&primary_release_date.gte=${decade}-01-01&primary_release_date.lte=${Number(decade) + 9}-12-31`;
  if (minRating > 0) q += `&vote_average.gte=${minRating}`;
  if (maxRuntime > 0) q += `&with_runtime.lte=${maxRuntime}`;
  return q + providerFilter();
}

async function searchActor() {
  const q = $('actorInput')?.value.trim() || '';
  if (!q) return;
  const box = $('actorResults');
  if (!box) return;
  box.innerHTML = '<div class="small">Chargement...</div>';

  try {
    const data = await tmdb(`/search/person?query=${encodeURIComponent(q)}&include_adult=false`);
    const results = (data.results || []).slice(0, 8);
    box.innerHTML = results.length ? results.map(a => `
      <div class="card">
        <h3>${esc(a.name)}</h3>
        <p class="small">${esc(a.known_for_department || 'Acteur')}</p>
        ${btn('selectActor', 'Choisir', { id: a.id, name: a.name })}
      </div>`).join('') : '<div class="empty">Aucun acteur trouvé.</div>';
  } catch {
    box.innerHTML = '<div class="empty">Erreur pendant la recherche acteur.</div>';
  }
}

function selectActor(actor) {
  selectedActor = actor;
  const box = $('actorResults');
  if (box) box.innerHTML = `<div class="card"><strong>${esc(actor.name)}</strong> sélectionné.</div>`;
}

async function pickRandomMovie() {
  const mode = $('randomMode')?.value || 'genre';
  const box = $('randomResult');
  if (!box) return;
  if ($('movieOfTheNightResult')) $('movieOfTheNightResult').innerHTML = '';
  box.innerHTML = '<div class="card">Chargement...</div>';

  try {
    let movie = null;

    let label = '';
    if (mode === 'genre') {
      const genreId = Number($('genreSelect')?.value || 28);
      label = `🎲 ${GENRE_MAP[genreId] || 'Hasard'}`;
      const data = await tmdb(`/discover/movie?${discoverQuery(genreId)}`, 0);
      movie = rand((data.results || []).filter(m => m.poster_path));
    } else {
      if (!selectedActor) { box.innerHTML = '<div class="empty">Choisis un acteur d’abord.</div>'; return; }
      const data = await tmdb(`/person/${selectedActor.id}/movie_credits`);
      const decade = Number($('decadeSelect')?.value || 0);
      const minRating = Number($('minRatingSelect')?.value || 0);
      const yr = m => parseInt((m.release_date || '').slice(0, 4), 10) || 0;
      const pool = (data.cast || [])
        .filter(m => m.poster_path && (m.vote_count || 0) >= 20)
        .filter(m => !decade || (yr(m) >= decade && yr(m) <= decade + 9))
        .filter(m => !minRating || (m.vote_average || 0) >= minRating);
      label = `🎲 ${selectedActor.name}`;
      movie = rand(pool);
    }

    if (!movie) { box.innerHTML = '<div class="empty">Aucune suggestion trouvée.</div>'; return; }

    const m = remember(movie, 'movie');
    box.innerHTML = featuredCard(m, label, `
      ${btn('watched', 'Marquer comme vu', ref(m))}
      ${btn('watchlist', 'Ajouter à ma liste', ref(m))}
      ${btn('details', 'Détails', ref(m))}
      ${btn('share', 'Partager', ref(m))}
      ${btn('tonight', 'Vu ce soir', ref(m))}
      ${listSelect(m)}`);
  } catch {
    box.innerHTML = '<div class="empty">Erreur pendant la génération.</div>';
  }
}

async function pickMovieOfTheNight() {
  const box = $('movieOfTheNightResult');
  if (!box) return;
  if ($('randomResult')) $('randomResult').innerHTML = '';
  box.innerHTML = '<div class="card">Chargement...</div>';

  try {
    const page = Math.floor(Math.random() * 5) + 1;
    const data = await tmdb(`/discover/movie?sort_by=popularity.desc&page=${page}&vote_count.gte=200${providerFilter()}`);
    const movie = rand((data.results || []).filter(m => m.poster_path));
    if (!movie) { box.innerHTML = '<div class="empty">Aucun film trouvé.</div>'; return; }

    const m = remember(movie, 'movie');
    box.innerHTML = featuredCard(m, '🎬 Film du soir', `
      ${btn('watchlist', 'À voir', ref(m))}
      ${btn('watched', 'Vu', ref(m))}
      ${btn('details', 'Détails', ref(m))}
      ${btn('share', 'Partager', ref(m))}`);
  } catch {
    box.innerHTML = '<div class="empty">Impossible de générer le film du soir.</div>';
  }
}

function watchedTonight(item) {
  activityTracker.watchedTonight += 1;
  addWatched(item); // sauvegarde + toast
  toast('Film marqué comme vu ce soir ! 🌙');
}

function pickRandomFromWatchlist() {
  const box = $('watchlistRandomResult');
  if (!box) return;
  if (!watchlist.length) { box.innerHTML = '<div class="empty">Ta watchlist est vide.</div>'; return; }

  const m = remember(rand(watchlist));
  box.innerHTML = featuredCard(m, '🎲 Film tiré au hasard de ta watchlist', `
    ${btn('watched', 'Je l’ai vu', ref(m))}
    ${btn('details', 'Détails', ref(m))}
    ${btn('share', 'Partager', ref(m))}
    ${btn('rerollWL', 'Relancer')}`);
}

/* ---------- Listes personnalisées ---------- */
function createCustomList() {
  const input = $('customListName');
  const name = input?.value.trim() || '';
  if (!name) return;
  customLists.push({ id: Date.now(), name, movies: [] });
  if (input) input.value = '';
  saveAll();
}

function addToCustomList(listId, id, type) {
  const list = customLists.find(l => l.id === listId);
  const item = getItem(id, type);
  if (!list || !item) return;
  if (list.movies.some(m => m.id === id)) { toast('Déjà dans cette liste'); return; }
  list.movies.push({ ...safeItem({ ...item, media_type: type }), title: titleOf(item) });
  saveAll();
  toast(`🗂️ Ajouté à « ${list.name} »`);
}

function removeFromCustomList(listId, movieId) {
  const list = customLists.find(l => l.id === listId);
  if (list) { list.movies = list.movies.filter(m => m.id !== movieId); saveAll(); }
}

function deleteCustomList(listId) {
  if (!confirm('Supprimer cette liste ?')) return;
  customLists = customLists.filter(l => l.id !== listId);
  saveAll();
}

function renderCustomLists() {
  const box = $('customLists');
  if (!box) return;
  if (!customLists.length) { box.innerHTML = '<div class="empty">Pas encore de liste 🗂️<br>Essaie « Soirées entre potes », « À voir en hiver » ou « Mes coups de cœur ».</div>'; return; }

  box.innerHTML = customLists.map(list => `
    <div class="card" style="margin-bottom:12px;">
      <h3>${esc(list.name)} <span class="small">· ${list.movies.length} film${list.movies.length > 1 ? 's' : ''}</span></h3>
      ${list.movies.length ? `<div class="strip">${list.movies.slice(0, 10).map(m => `<img loading="lazy" src="${poster(m.poster_path)}" alt="${esc(m.title)}" title="${esc(m.title)}" data-act="details" data-id="${m.id}" data-type="${typeOf(m)}">`).join('')}</div>` : ''}
      <div class="buttons" style="margin-bottom:8px;">
        ${btn('listRandom', '🎲 Au hasard', { list: list.id })}
        ${btn('listShare', '🔗 Partager', { list: list.id })}
        ${btn('listDelete', 'Supprimer liste', { list: list.id })}
      </div>
      <div>${list.movies.map(movie => `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span>${esc(movie.title)}</span>
          <div>
            ${btn('details', 'Détails', ref(movie))}
            ${btn('listRemove', 'Retirer', { list: list.id, id: movie.id })}
          </div>
        </div>`).join('')}</div>
    </div>`).join('');
}

function pickRandomFromList(listId) {
  const list = customLists.find(l => l.id === listId);
  const box = $('watchlistRandomResult');
  if (!list || !list.movies.length || !box) return;

  const m = remember(rand(list.movies));
  box.innerHTML = featuredCard(m, `🎲 Film tiré au hasard de ${esc(list.name)}`, `
    ${btn('watched', 'Je l’ai vu', ref(m))}
    ${btn('details', 'Détails', ref(m))}
    ${btn('share', 'Partager', ref(m))}
    ${btn('listRandom', 'Relancer', { list: listId })}`);
}

/* ---------- Détails (modal) ---------- */
async function openDetails(id, mediaType) {
  const modal = $('detailsModal');
  const content = $('detailsContent');
  if (!modal || !content) return;

  modal.style.display = 'block';
  content.innerHTML = '<div class="card">Chargement...</div>';

  try {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const d = await tmdb(`/${type}/${id}?append_to_response=videos,watch/providers&include_video_language=fr,en,null`);
    remember({ ...d, genre_ids: (d.genres || []).map(g => g.id) }, type); // garde les genres pour les badges

    const videos = d.videos?.results || [];
    const trailer = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
                    videos.find(v => v.site === 'YouTube' && v.type === 'Teaser');
    const title = titleOf(d);
    const date = d.release_date || d.first_air_date || '';
    const genres = (d.genres || []).map(g => g.name).join(', ');
    const providers = (d['watch/providers']?.results?.FR?.flatrate || []).map(p => p.provider_name);
    const next = type === 'tv' ? d.next_episode_to_air : null;
    const runtime = type === 'movie' && d.runtime ? `${Math.floor(d.runtime / 60)}h${String(d.runtime % 60).padStart(2, '0')}` : '';

    content.innerHTML = `
      <div class="result-card" style="grid-template-columns: 220px 1fr;">
        <img class="poster" style="height:320px;" src="${poster(d.poster_path)}" alt="${esc(title)}">
        <div>
          <h2>${esc(title)}</h2>
          <div>
            <span class="badge">${type === 'tv' ? 'Série' : 'Film'}</span>
            ${date ? `<span class="badge">${date.slice(0, 4)}</span>` : ''}
            ${runtime ? `<span class="badge">${runtime}</span>` : ''}
            ${d.vote_average ? `<span class="badge">⭐ ${Number(d.vote_average).toFixed(1)}</span>` : ''}
            ${genres ? `<span class="badge">${esc(genres)}</span>` : ''}
          </div>
          <p style="margin-top:14px; line-height:1.5;">${esc(d.overview || 'Aucun synopsis disponible.')}</p>
          ${next ? `<p class="small"><strong>Prochain épisode :</strong> S${next.season_number}E${next.episode_number} · ${esc(next.name || 'Sans titre')} · ${next.air_date ? formatDate(next.air_date) : 'Date inconnue'}</p>` : ''}
          <p class="small" style="margin-top:12px"><strong>Où regarder (FR)</strong></p>${provSlot(d, 'big', type)}
          <div class="buttons" style="margin-top:16px;">${btn('share', 'Partager', { id, type, title })}</div>
          ${trailer ? `
            <div style="margin-top:16px;">
              <h3>Bande-annonce</h3>
              <a href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}" target="_blank" rel="noopener noreferrer"
                 style="display:inline-block; background:#3b82f6; color:white; padding:10px 14px; border-radius:12px; text-decoration:none;">
                Voir la bande-annonce sur YouTube
              </a>
            </div>` : '<p class="small" style="margin-top:16px;">Aucune bande-annonce trouvée.</p>'}
        </div>
      </div>`;
  } catch {
    content.innerHTML = '<div class="empty">Impossible de charger les détails.</div>';
  }
}

function closeDetailsModal() {
  if ($('detailsModal')) $('detailsModal').style.display = 'none';
  if ($('detailsContent')) $('detailsContent').innerHTML = '';
}

function shareTitle(title, type) {
  const label = type === 'tv' ? 'série' : 'film';
  const text = `Regarde ce ${label} sur Clap : ${title}`;
  const url = window.location.href;

  if (navigator.share) { navigator.share({ title: 'Clap', text, url }).catch(() => {}); return; }
  navigator.clipboard.writeText(`${text} - ${url}`)
    .then(() => toast('Lien copié dans le presse-papiers'))
    .catch(() => prompt('Copie ce texte :', `${text} - ${url}`));
}

/* ---------- Export / import des données ---------- */
function exportData() {
  const data = {};
  Object.keys(localStorage).filter(k => k.startsWith('cine_')).forEach(k => { data[k] = localStorage.getItem(k); });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `clap-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      Object.entries(data).forEach(([k, v]) => { if (k.startsWith('cine_') && typeof v === 'string') localStorage.setItem(k, v); });
      location.reload();
    } catch { toast('Fichier invalide'); }
  };
  reader.readAsText(file);
}

/* ---------- Cloche des badges ---------- */
let soundEnabled = getStorage('cine_sound', true);
let knownBadges = getStorage('cine_badgesSeen', null);
let audioCtx = null;

function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* pas d'audio dispo */ }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

// Petite cloche synthétisée (aucun fichier audio nécessaire)
function playBell() {
  if (!soundEnabled) return;
  unlockAudio();
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const base = 880;
  [[1, 0.5, 2.2], [2.76, 0.22, 1.4], [5.4, 0.12, 0.8], [8.93, 0.06, 0.5]].forEach(([ratio, gain, dur]) => {
    const o = audioCtx.createOscillator();
    const v = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = base * ratio;
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.01);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(v);
    v.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
}

function toggleSound() {
  soundEnabled = !!$('soundToggle')?.checked;
  setStorage('cine_sound', soundEnabled);
  if (soundEnabled) playBell(); // aperçu
}

// Appelée à chaque rendu : sonne si un badge vient d'être débloqué
function checkNewBadges() {
  const { badges } = calculateBadges();
  if (knownBadges === null) { // premier lancement : on mémorise sans sonner
    knownBadges = badges;
    setStorage('cine_badgesSeen', knownBadges);
    return;
  }
  const fresh = badges.filter(b => !knownBadges.includes(b));
  if (!fresh.length) return;
  knownBadges = [...new Set([...knownBadges, ...badges])];
  setStorage('cine_badgesSeen', knownBadges);
  playBell();
  setTimeout(() => toast(`🏆 Badge débloqué : ${fresh.join(' · ')}`), 1500);
}

/* ---------- Rendu global ---------- */
function renderAll() {
  renderWatched();
  renderWatchlist();
  renderSeries();
  renderStats();
  renderCustomLists();
  renderFavorites();
  renderProfile();
  checkNewBadges();
  renderPlus();
  if ($('stats')?.classList.contains('active')) renderChart();
}

/* ---------- Délégation d'événements (remplace tous les onclick inline) ---------- */
const withItem = (d, fn) => { const it = getItem(+d.id, d.type || 'movie'); if (it) fn(it); };

const ACTIONS = {
  watched: d => withItem(d, addWatched),
  watchlist: d => withItem(d, addWatchlist),
  follow: d => withItem(d, addSeries),
  tonight: d => withItem(d, watchedTonight),
  details: d => openDetails(+d.id, d.type),
  share: d => { const it = getItem(+d.id, d.type); shareTitle(it ? titleOf(it) : (d.title || ''), d.type); },
  fav: d => toggleFavorite(+d.id, d.type),
  rmWatched: d => removeWatched(+d.id),
  rmWatchlist: d => removeWatchlist(+d.id),
  rate: d => rateMovie(+d.id, +d.n),
  rateWL: d => rateWatchlistMovie(+d.id, +d.n),
  rerollWL: () => pickRandomFromWatchlist(),
  listRandom: d => pickRandomFromList(+d.list),
  listDelete: d => deleteCustomList(+d.list),
  listRemove: d => removeFromCustomList(+d.list, +d.id),
  sExpand: d => toggleSeriesExpanded(+d.sid),
  sAll: d => markSeriesWatched(+d.sid, true),
  sNone: d => markSeriesWatched(+d.sid, false),
  sStatus: d => toggleSeriesStatus(+d.sid),
  sRemove: d => { if (confirm('Retirer cette série ?')) removeSeries(+d.sid); },
  sSeasonOn: d => markSeasonWatched(+d.sid, +d.season, true),
  sSeasonOff: d => markSeasonWatched(+d.sid, +d.season, false),
  epToggle: d => toggleEpisodeWatched(+d.sid, +d.season, +d.ep),
  epUntil: d => markWatchedUntil(+d.sid, +d.season, +d.ep),
  epRate: d => rateEpisode(+d.sid, +d.season, +d.ep, +d.n),
  badge: d => showBadgeDetails(d.name),
  pickSuggestion: d => pickSuggestion(d.title),
  rmRecent: d => removeRecent(d.q),
  retryHome: () => { homeLoaded = false; loadHomeSections(); },
  selectActor: d => selectActor({ id: +d.id, name: d.name })
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el.dataset, el);

  // Fermer les suggestions / modales au clic extérieur
  const wrap = document.querySelector('.search-wrap');
  if (wrap && !wrap.contains(e.target)) hideSuggestions();
  if (e.target === $('badgeModal')) closeBadgeModal();
  if (e.target === $('detailsModal')) closeDetailsModal();
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const d = el.dataset;
  if (d.change === 'season') selectSeason(+d.sid, el.value);
  if (d.change === 'addToList' && el.value) { addToCustomList(+el.value, +d.id, d.type); el.value = ''; }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDetailsModal(); closeBadgeModal(); hideSuggestions(); }
});

/* ---------- Démarrage ---------- */
function versionBanner() {
  if (window.CLAP_PLUS_VERSION === CLAP_VERSION) return;
  const d = document.createElement('div');
  d.style.cssText = 'background:#b45309;color:#fff;padding:10px 14px;font-size:14px;text-align:center';
  d.textContent = window.CLAP_PLUS_VERSION
    ? '⚠️ Fichiers de versions différentes : remplace TOUS les fichiers du site (index.html, clap.js, clap-plus.js, sw.js…) puis recharge avec Ctrl+F5.'
    : '⚠️ Le fichier clap-plus.js est introuvable ou cassé : envoie-le au même endroit que index.html puis recharge avec Ctrl+F5.';
  document.body.prepend(d);
}

function init() {
  versionBanner();
  fillGenres();
  try { renderAll(); } catch (e) { console.error('renderAll', e); }
  loadHomeSections();
  toggleRandomMode();
  if ($('profileName')) $('profileName').value = userProfile.name || '';
  if ($('soundToggle')) $('soundToggle').checked = soundEnabled;
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
