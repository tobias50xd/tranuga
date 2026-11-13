import './style.css';
import { UGA_AGENCY, discoverAgencies, locateAgencies, findAgenciesByCode } from './api';
import { createTransitService, knownStops, ATHENS_INFO_AGENCY, GEORGIA_AGENCY, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY } from './replication';
import { planJourney, parseCoordinate, type Journey } from './planner';
import { TransitMap } from './map';
import { renderNotes, compactNote } from './notes';
import { Favorites } from './favorites';
import { sortRoutes, routeState, routeStateLabel, routeOperator } from './route-presentation';
import { PlaceInput, PlaceSearch } from './places';
import { inAthens, isAthensAgency, vehiclesInScope, networkInScope } from './athens';
import { readPreferences, savePreference, THEME_KEY, ATHENS_LOCK_KEY } from './preferences';
import type { Agency, Coordinate, Network, Route, RouteDetail, Stop, StopDetail } from './types';
import { escapeHtml as e, safeColor, coordinates, clockTime, arrivalLabel, vehicleAge, headingLabel } from './ui';

const preferences = readPreferences();
let athensLocked = preferences.athensLocked;
document.documentElement.dataset.theme = preferences.theme;
const app = document.querySelector<HTMLDivElement>('#app')!;
const center = { lat: 33.948, lon: -83.377 };
let agency: Agency = GEORGIA_AGENCY;
let service = createTransitService(agency);
let routes: Route[] = [];
let view: 'routes' | 'detail' | 'plan' | 'agencies' = 'routes';
let detail: RouteDetail | undefined;
let map: TransitMap | undefined;
let origin: Coordinate | undefined;
let destination: Coordinate | undefined;
let originLabel = '';
let destinationLabel = '';
let pointInputs: Partial<Record<'origin' | 'destination', PlaceInput>> = {};
const placeSearch = new PlaceSearch();
const favorites = new Favorites();
let displayedJourney: Journey | undefined;
let pickMode: 'origin' | 'destination' | undefined;
let operation = 0;
let pollBusy = false;
let catalogTime: number | undefined;
let network: Network | undefined;
let agencyChoices: Agency[] = [];
let selectedDirection = '';
let selectedStop: StopDetail | undefined;
let stopOperation = 0;
let planning = false;
let agencyRevision = 0;
let crawling = false;
let comparisonRevision = 0;
const crawled = new WeakSet<object>();

app.innerHTML = `
  <a href="#main" class="skip-link">Skip to content</a>
  <header class="header"><div class="header-inner">
    <button class="brand" id="home" aria-label="tranuga home"><span class="brand-mark" aria-hidden="true">↳</span>tranuga<span class="brand-period">.</span></button>
    <nav aria-label="Main navigation"><button data-nav="routes">Routes</button><button data-nav="plan">Plan a trip <span aria-hidden="true">↗</span></button><button data-nav="agencies">Networks</button><div class="menu-preferences"><button id="theme-toggle" class="menu-toggle" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z"/></svg>Dark mode<span class="menu-value"></span></button><button id="athens-toggle" class="menu-toggle" aria-pressed="true" title="Keep networks, buses and maps in Athens, Georgia"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Athens lock<span class="menu-value"></span></button></div></nav>
    <div class="place"><span class="status-dot"></span><span id="agency-name">${e(agency.name)}</span></div>
  </div></header>
  <aside class="source-bar" aria-label="Data reliability"><details id="data-sources"><summary id="source-summary">Checking transit sources…</summary><div id="source-status"></div><div class="source-actions"><button class="button" id="sync-data">Sync all sources</button><button class="button" id="provider-info">Provider information</button></div><p class="help-text">Matching reports take precedence. One healthy source can serve as backup. Replicas may share an upstream; agreement does not guarantee accuracy.</p><div id="sync-status" role="status"></div><div id="provider-details"></div></details></aside>
  <main id="main" tabindex="-1"></main>
  <footer><div class="footer-main"><strong>tranuga.</strong><span>Independent explorer · UGA, Avail InfoPoint &amp; Passio</span><span>Times are estimates. Check operator alerts before travel.</span></div><div class="project-note"><p>A student-based open source project, for development purposes only.</p><p>Vibe coded with ❤️ by Codex</p></div></footer>
  <div id="announcement" class="sr-only" role="status" aria-live="polite"></div>`;

const main = document.querySelector<HTMLElement>('#main')!;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
function announce(message: string) { $('#announcement').textContent = message; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'The transit service is unavailable. Try again shortly.'; }
const warning = renderNotes;
type HistoryMode = 'push' | 'replace' | 'none';
function setPath(path: string, mode: HistoryMode) {
  if (mode === 'none' || window.location.pathname === path) return;
  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({}, '', path);
}
function setView(next: typeof view) {
  Object.values(pointInputs).forEach(input => input.destroy()); pointInputs = {};
  map?.destroy(); map = undefined; displayedJourney = undefined; view = next; operation++;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nav]')) {
    const active = button.dataset.nav === (next === 'detail' ? 'routes' : next);
    button.classList.toggle('current', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
}
function renderPreferences() {
  const dark = document.documentElement.dataset.theme === 'dark';
  for (const [id, enabled] of [['#theme-toggle', dark], ['#athens-toggle', athensLocked]] as const) {
    const button = $<HTMLButtonElement>(id); button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('.menu-value')!.textContent = enabled ? 'On' : 'Off';
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15221b' : '#b92535');
}
$('#theme-toggle').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme; savePreference(THEME_KEY, theme); renderPreferences();
};
$('#athens-toggle').onclick = async () => {
  athensLocked = !athensLocked; savePreference(ATHENS_LOCK_KEY, String(athensLocked)); renderPreferences();
  announce(athensLocked ? 'Athens lock on. Showing Athens, Georgia only.' : 'Athens lock off. Other networks and unrestricted maps are available.');
  if (athensLocked && !isAthensAgency(agency)) { await selectAgency(GEORGIA_AGENCY); return; }
  if (athensLocked) {
    if (!origin || !inAthens(origin)) { origin = undefined; originLabel = ''; }
    if (!destination || !inAthens(destination)) { destination = undefined; destinationLabel = ''; }
  }
  if (view === 'plan') showPlanner('none');
  else if (view === 'agencies') await showAgencies('none');
  else if (view === 'detail' && detail) await showRoute(detail.route.id, 'none');
  else await showRoutes(false, 'none');
};
renderPreferences();
function pointAllowed(point: Coordinate) { return !athensLocked || inAthens(point); }
function localPointError() { return warning(['Athens lock is on. Choose a point in Athens, Georgia, or turn off Athens lock in the main menu.'], 'action'); }
function focusTitle() { main.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }); }
function writeNotes(selector: string, html: string) {
  const target=$(selector), wasOpen=!!target.querySelector('.notes-dropdown[open]');
  const expanded=[...target.querySelectorAll('.note-details[open]')].map(node=>node.closest<HTMLElement>('[data-note-kind]')?.dataset.noteKind);
  target.innerHTML=html;
  if (wasOpen) target.querySelector('details')?.setAttribute('open','');
  for (const kind of expanded) target.querySelector(`[data-note-kind="${kind}"] .note-details`)?.setAttribute('open','');
}
function setRouteLoading(active: boolean) {
  const button=$<HTMLButtonElement>('#find-trip'); button.setAttribute('aria-busy',String(active));
  button.querySelector('.calculation-label')!.textContent=active?'Calculating route…':'Find quickest bus trip';
  $('#trip-progress').hidden=!active; $('#trip-form').setAttribute('aria-busy',String(active));
}
function renderReplication() {
  const report = service.report;
  $('#source-summary').textContent = `${report.healthy}/${report.total} ${report.mode === 'replicas' ? 'backend replicas' : 'data feeds'} responding · Data sources`;
  $('#source-status').innerHTML = report.sources.map(source => `<div class="source-row"><strong>${e(source.label)}</strong><span class="source-state ${source.state}">${e(source.state === 'healthy' ? 'Available' : source.state === 'degraded' ? 'Partly available' : source.state === 'cached' ? 'Saved backup' : 'Unavailable')}</span><small>${e(source.detail || source.error || (source.lastSuccessAt ? `Checked ${clockTime(source.lastSuccessAt)}` : ''))}</small></div>`).join('') + `<p class="help-text">Last comparison: ${report.agreements} matching records · ${report.conflicts} disagreements · ${report.cached} saved records. ${report.mode === 'replicas' ? 'Two of three matching replicas corroborate a record.' : agency.kind === 'uga' ? 'Georgia campus and city routes each have two comparable channels; other feeds do not count as votes for missing coverage.' : 'This agency has one configured feed, with saved last-good data for short outages.'}</p>`;
  $<HTMLButtonElement>('#provider-info').hidden = !service.hasPassioFor();
}
$('#sync-data').onclick = async () => {
  const current = service; const button = $<HTMLButtonElement>('#sync-data'); button.disabled = true;
  $('#sync-status').textContent = 'Crawling configured feeds, stops and predictions…';
  try { const raw = await current.sync(); if (service !== current) return; const result = networkInScope(raw, athensLocked); if (view === 'routes') { routes = result.routes; renderRouteCards(); } $('#sync-status').textContent = `Merged ${result.routes.length} routes, ${result.stops.length} stops and ${result.vehicles.length} reported buses. ${result.warnings.join(' ')}`; }
  catch (error) { if (service === current) $('#sync-status').textContent = errorMessage(error); }
  finally { if (service === current) { button.disabled = false; renderReplication(); } }
};
$('#provider-info').onclick = async () => {
  const current = service; $('#provider-details').textContent = 'Loading provider information…';
  try { const info = await current.getSystemInfo(); if (service !== current) return; $('#provider-details').innerHTML = `<h3>${e(info.name)}</h3><p class="help-text">Agency ${e(info.id)} · Web API version ${e(info.version || 'unavailable')} · ${info.routeGroups.length} route variants in the grouped chooser.</p><ul class="provider-groups">${info.routeGroups.map(group => `<li>${e(group.name)} <small>(${e(group.variantId)})</small></li>`).join('')}</ul>`; }
  catch (error) { if (service === current) $('#provider-details').textContent = errorMessage(error); }
  finally { if (service === current) renderReplication(); }
};
async function crawlLive() {
  if (crawling || document.hidden) return; const current = service; crawling = true;
  try { await current.crawlLive(); } finally { crawling = false; if (service === current) renderReplication(); }
}

document.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach(button => button.onclick = () => {
  if (button.dataset.nav === 'routes') void showRoutes();
  if (button.dataset.nav === 'plan') showPlanner();
  if (button.dataset.nav === 'agencies') void showAgencies();
});
$('#home').onclick = () => void showRoutes();

async function showRoutes(refresh = false, historyMode: HistoryMode = 'push') {
  setPath('/routes', historyMode);
  setView('routes'); const token = operation;
  main.innerHTML = `<section class="catalog container">
    <div class="eyebrow">YOUR NEXT CONNECTION</div>
    <div class="page-heading"><div><h1 tabindex="-1">Athens, in motion<span>.</span></h1><p>Find your route. See your bus. Go somewhere.</p></div><button id="catalog-plan" class="button primary">Plan a trip <span aria-hidden="true">↗</span></button></div>
    <div class="catalog-toolbar"><div><h2>Explore the routes</h2><span id="route-count" class="muted">Connecting to ${e(agency.name)}…</span></div><div class="filters"><label class="search"><span aria-hidden="true">⌕</span><input id="route-search" type="search" placeholder="Search routes" aria-label="Search routes"></label><label class="toggle"><input type="checkbox" id="active-only"> Active only</label><button id="refresh-routes" class="icon-button" aria-label="Refresh routes">↻</button></div></div>
    <div id="catalog-status" role="status"></div><div id="routes" class="route-grid" aria-label="Bus routes"><div class="loading">Loading available routes…</div></div>
    <aside class="catalog-note"><span class="note-number">01 — 02 — GO</span><div><h3>A little less waiting. A little more going.</h3><p>Select a route for its stops and bus positions, or let the trip planner find a connection from any point on the map.</p></div><span class="note-arrow" aria-hidden="true">↗</span></aside>
  </section>`;
  $('#catalog-plan').onclick = () => showPlanner();
  $('#refresh-routes').onclick = () => void showRoutes(true);
  $('#route-search').oninput = renderRouteCards;
  $('#active-only').onchange = renderRouteCards;
  focusTitle();
  if (!routes.length || refresh) {
    try {
      if (refresh) service.client.clear();
      const result = await service.listRoutes();
      if (token !== operation) return;
      routes = result; catalogTime = Date.now(); network = undefined;
    } catch (error) {
      if (token !== operation) return;
      $('#catalog-status').innerHTML = `${warning([errorMessage(error)], 'error')}`;
    }
  }
  if (token === operation) { renderRouteCards(); renderReplication(); if (!crawled.has(service)) { crawled.add(service); void crawlLive(); } }
}

function renderRouteCards() {
  if (view !== 'routes') return;
  const query = $<HTMLInputElement>('#route-search').value.trim().toLowerCase();
  const activeOnly = $<HTMLInputElement>('#active-only').checked;
  const confirmed = (route: Route) => routeState(route) === 'active';
  const filtered = sortRoutes(routes, favorites.routeIds(agency, routes)).filter(route => (!activeOnly || confirmed(route)) && `${route.name} ${route.shortName} ${route.id}`.toLowerCase().includes(query));
  $('#route-count').textContent = `${routes.length} routes · ${routes.filter(confirmed).length} active${catalogTime ? ` · Checked ${clockTime(catalogTime)}` : ''}`;
  $('#routes').innerHTML = filtered.map(route => `<article class="route-card route-${routeState(route)}${favorites.has(agency,route.id) ? ' is-favorite' : ''}" style="--route-color:${safeColor(route.color)}"><button class="route-open" data-route="${e(route.id)}">
    <div class="card-top"><span class="route-badge">${e(route.shortName || route.id)}</span><span class="service-state ${confirmed(route) ? 'active' : ''}"><i></i>${routeStateLabel[routeState(route)]}</span></div>
    <h3>${e(route.name)}</h3><span class="operator-label">${routeOperator(route) === 'uga' ? 'UGA' : routeOperator(route) === 'city' ? 'City bus' : 'Transit network'}</span><div class="card-bottom"><span>View route &amp; stops</span><span class="card-arrow" aria-hidden="true">↗</span></div>
  </button><button class="favorite-button" data-favorite="${e(route.id)}" aria-pressed="${favorites.has(agency,route.id)}" aria-label="${favorites.has(agency,route.id) ? 'Remove favorite' : 'Add favorite'}: ${e(route.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg></button></article>`).join('') || `<div class="empty">${routes.length ? 'No routes match your search.' : 'No routes available. Refresh to try again.'}</div>`;
  document.querySelectorAll<HTMLButtonElement>('[data-favorite]').forEach(button => button.onclick = () => {
    const id=button.dataset.favorite!; const selected=favorites.toggle(agency,id); renderRouteCards();
    document.querySelector<HTMLButtonElement>(`[data-favorite="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
    announce(selected ? 'Route added to favorites.' : 'Route removed from favorites.');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button => button.onclick = () => void showRoute(button.dataset.route!));
}

async function showRoute(routeId: string, historyMode: HistoryMode = 'push') {
  setPath(`/routes/${encodeURIComponent(routeId)}`, historyMode);
  setView('detail'); const token = operation; detail = undefined; selectedStop = undefined; selectedDirection = '';
  main.innerHTML = `<section class="container detail-page"><button class="text-button" id="back-routes">← All routes</button><div id="route-detail" class="loading" role="status">Loading route, stops and live buses…</div></section>`;
  $('#back-routes').onclick = () => void showRoutes();
  try {
    const raw = await service.getRoute(routeId);
    const result = { ...raw, vehicles: vehiclesInScope(raw.vehicles, athensLocked) };
    if (token !== operation) return;
    detail = result;
    $('#route-detail').className = '';
    $('#route-detail').innerHTML = `<div class="detail-title"><span class="route-badge large" style="--route-color:${safeColor(result.route.color)}">${e(result.route.shortName)}</span><div><div class="eyebrow">${e(agency.name)}</div><h1 tabindex="-1">${e(result.route.name)}</h1></div><div class="detail-stats" id="detail-stats"></div></div>
      <div class="route-layout"><div class="map-wrap"><div id="route-map" class="map" role="region" aria-label="Route map with stops and bus directions"></div><div class="map-caption"><span><i class="legend-line" style="background:${safeColor(result.route.color)}"></i>Route</span><span>○ Stop</span><span>↑ Bus heading</span><span>Grey = stale position</span><span>Brief GPS smoothing</span></div></div>
      <aside class="stop-panel"><div class="panel-heading"><h2>Along the way</h2><label class="sr-only" for="route-direction">Route direction</label><select id="route-direction"><option value="">All directions</option>${result.patterns.map(pattern => `<option value="${e(pattern.id)}">${e(pattern.direction)}</option>`).join('')}</select></div><div id="stop-detail" aria-live="polite"></div><div id="route-stops"></div></aside></div>
      <div class="route-notes"><div id="service-messages">${warning(result.messages, 'service')}</div><div id="route-warnings">${warning(result.warnings)}</div></div>
      <div class="vehicles-section"><h2>On the road</h2><p class="muted">Positions refresh every 15 seconds. Arrows show the reported heading.</p>${service.hasPassioFor(result.route.id) ? '<form id="bus-search" class="bus-search"><label for="bus-query">Find a bus by fleet number</label><input id="bus-query" placeholder="Bus number" required maxlength="40"><button class="button" type="submit">Find bus</button></form><div id="bus-search-result" role="status"></div>' : ''}<div id="vehicle-list" class="vehicle-list"></div></div>`;
    map = new TransitMap($('#route-map'), agency.center || center, undefined, athensLocked);
    map.showRoute(result, stop => void showStop(stop));
    $<HTMLSelectElement>('#route-direction').onchange = event => {
      selectedDirection = (event.target as HTMLSelectElement).value;
      map?.showRoute(detail!, stop => void showStop(stop), selectedDirection);
      renderStops();
    };
    renderStops(); renderVehicles(); focusTitle();
    renderReplication();
    document.querySelector<HTMLFormElement>('#bus-search')?.addEventListener('submit', async event => {
      event.preventDefault(); const query = $<HTMLInputElement>('#bus-query').value.trim(); $('#bus-search-result').textContent = 'Looking up that bus…';
      try { const buses = vehiclesInScope(await service.searchBuses(query), athensLocked); if (token !== operation || $<HTMLInputElement>('#bus-query').value.trim() !== query) return; $('#bus-search-result').innerHTML = buses.map(bus => `<p>Bus ${e(bus.id)} · ${e(routes.find(route => route.id === bus.routeId)?.name || bus.routeId)} · ${e(headingLabel(bus.heading))} · ${e(vehicleAge(bus.updatedAt))}</p>`).join('') || '<p>No matching bus is reported by the provider.</p>'; }
      catch (error) { if (token === operation) $('#bus-search-result').textContent = errorMessage(error); }
      finally { if (token === operation) renderReplication(); }
    });
    void service.getMessages().then(messages => { if (token === operation) writeNotes('#service-messages', warning([...new Set([...result.messages, ...messages])], 'service')); }).catch(error => { if (token === operation) $('#service-messages').innerHTML += warning([`Service alerts could not be loaded: ${errorMessage(error)}`]); });
  } catch (error) {
    if (token === operation) $('#route-detail').innerHTML = `${warning([errorMessage(error)], 'error')}<button class="button" id="retry-route">Retry route</button>`;
    document.querySelector<HTMLButtonElement>('#retry-route')?.addEventListener('click', () => void showRoute(routeId));
  }
}

function renderStops() {
  if (!detail) return;
  const stops = (selectedDirection ? detail.patterns.find(pattern => pattern.id === selectedDirection)?.stops || [] : detail.stops).filter(pointAllowed);
  $('#route-stops').innerHTML = `<p class="stop-count">${stops.length} stops · select one for arrivals</p><ol class="stop-list">${stops.map((stop, index) => `<li><button data-stop="${e(stop.id)}"><span class="stop-sequence">${index + 1}</span><span>${e(stop.name)}</span><span aria-hidden="true">↗</span></button></li>`).join('')}</ol>`;
  document.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach(button => button.onclick = () => {
    const stop = stops.find(s => s.id === button.dataset.stop); if (stop) void showStop(stop);
  });
}

async function showStop(stop: Stop) {
  const token = operation; const stopToken = ++stopOperation;
  $('#stop-detail').innerHTML = `<div class="stop-arrivals"><h3>${e(stop.name)}</h3><p>Loading arrivals…</p></div>`;
  $('#stop-detail').scrollIntoView({ block: 'nearest' });
  map?.focus(stop);
  try {
    const result = await service.getStop(stop.id);
    if (token !== operation || stopToken !== stopOperation || view !== 'detail') return;
    if (!pointAllowed(result.stop)) throw new Error('This stop is outside Athens. Turn off Athens lock to explore it.');
    selectedStop = result;
    $('#stop-detail').innerHTML = `<div class="stop-arrivals"><div class="eyebrow">STOP ${e(stop.id)}</div><h3>${e(result.stop.name || stop.name)}</h3>${result.departures.filter(d => d.arrivalTime >= Date.now() - 30000).sort((a, b) => a.arrivalTime - b.arrivalTime).slice(0, 10).map(dep => `<div class="arrival-row"><span>${e(routes.find(r => r.id === dep.routeId)?.shortName || dep.routeId)} ${e(dep.direction || '')}</span><strong>${arrivalLabel(dep.arrivalTime)}</strong><small>${dep.scheduled ? 'Scheduled' : 'Predicted'} · ${clockTime(dep.arrivalTime)}</small></div>`).join('') || '<p>No upcoming predictions are available for this stop.</p>'}<button class="text-button" id="stop-as-origin">Start a trip here ↗</button>${service.hasPassioFor(detail?.route.id, stop.id) ? '<br><button class="text-button" id="show-timetable">Provider timetable</button><div id="stop-timetable"></div>' : ''}</div>`;
    $('#stop-as-origin').onclick = () => { origin = selectedStop!.stop; originLabel = selectedStop!.stop.name; showPlanner(); };
    document.querySelector<HTMLButtonElement>('#show-timetable')?.addEventListener('click', async () => {
      $('#stop-timetable').textContent = 'Loading timetable…';
      try { const timetable = await service.getTimetable(stop.id, detail?.route.id); if (token !== operation || stopToken !== stopOperation) return; $('#stop-timetable').innerHTML = `<p>${timetable.times.length ? timetable.times.map(time => e(time)).join(' · ') : 'No next clock times are supplied.'}</p><small>Provider clock times${timetable.timezone ? ` · ${e(timetable.timezone)}` : ''}. Dates and live availability are not implied.</small>`; }
      catch (error) { if (token === operation && stopToken === stopOperation) $('#stop-timetable').textContent = errorMessage(error); }
    });
    renderReplication();
  } catch (error) {
    if (token === operation && stopToken === stopOperation) $('#stop-detail').innerHTML = `${warning([errorMessage(error)], 'error')}`;
  }
}

function renderVehicles() {
  if (!detail || view !== 'detail') return;
  $('#detail-stats').innerHTML = `<strong>${detail.vehicles.length}</strong><span>buses reported</span>`;
  $('#vehicle-list').innerHTML = detail.vehicles.map(bus => `<article class="vehicle-card"><span class="vehicle-heading" style="transform:rotate(${Number.isFinite(bus.heading) ? bus.heading : 0}deg)" aria-hidden="true">↑</span><div><strong>Bus ${e(bus.id)}</strong><p>${e(bus.destination || detail!.route.name)}</p><small>${e(headingLabel(bus.heading))} · ${Math.round(bus.heading)}° · ${e(vehicleAge(bus.updatedAt))}</small>${!bus.updatedAt || Date.now() - bus.updatedAt > 120000 ? '<span class="stale-label">Last known position</span>' : ''}</div></article>`).join('') || '<div class="empty">No buses are currently reported on this route.</div>';
}

function pointField(kind: 'origin' | 'destination', label: string, value: string) {
  const id = `trip-${kind}`;
  return `<label class="field-label" for="${id}"><span class="point-label ${kind === 'destination' ? 'destination' : ''}" aria-hidden="true">${kind === 'origin' ? 'A' : 'B'}</span>${label}</label><div class="place-field"><input id="${id}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-hints" aria-describedby="${id}-status" autocomplete="off" spellcheck="false" maxlength="120" placeholder="Search a stop, place or address" value="${e(value)}" required><ul id="${id}-hints" class="place-hints" role="listbox" aria-label="${label} suggestions" hidden></ul><p class="place-status" id="${id}-status" role="status"></p></div>`;
}

function showPlanner(historyMode: HistoryMode = 'push') {
  setPath('/plan', historyMode);
  setView('plan'); pickMode = undefined; planning = false;
  main.innerHTML = `<section class="container planner-page"><div class="eyebrow">MAKE A CONNECTION</div><div class="page-heading"><div><h1 tabindex="-1">Your way from A to B<span>.</span></h1><p>${athensLocked ? 'Search places or stops in Athens, Georgia.' : 'Search places or stops.'} We’ll compare the available bus connections.</p></div></div>
    <div class="planner-layout"><aside class="trip-panel"><form id="trip-form"><fieldset id="trip-fields">
      ${pointField('origin', 'Start', originLabel || (origin ? coordinates(origin) : ''))}<div class="field-actions"><button type="button" id="pick-origin" class="text-button">⊕ Pick on map</button><button type="button" id="locate" class="text-button">⌖ My location</button></div>
      ${pointField('destination', 'Destination', destinationLabel || (destination ? coordinates(destination) : ''))}<div class="field-actions"><button type="button" id="pick-destination" class="text-button">⊕ Pick on map</button><button type="button" id="swap" class="text-button">⇅ Swap</button></div>
      <label class="field-label" for="max-walk">Maximum walk to / from the bus</label><select id="max-walk"><option value="800">800 m · about 10 minutes</option><option value="1200" selected>1.2 km · about 15 minutes</option><option value="2000">2 km · about 25 minutes</option></select>
      <button class="button primary full" type="submit" id="find-trip"><span class="calculation-label">Find quickest bus trip</span> <span aria-hidden="true">↗</span></button><div id="trip-progress" class="calculation-progress" role="progressbar" aria-label="Route calculation" aria-valuetext="Loading routes, arrivals and bus positions" hidden><span></span></div>
      <p class="help-text">Type a stop, place or address and choose a suggestion, or pick on the map. Decimal coordinates also work. Walking follows straight-line distances; allow extra time for paths and crossings. Transfers can include up to 300 m of walking.</p>
      <p class="search-credit">Address search: <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Photon</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>. Address queries go to Photon after a short pause.</p></fieldset></form><div id="trip-status" role="status"></div><div id="trip-result" aria-live="polite"></div>${service.hasPassioFor() ? '<details class="operator-comparison"><summary>Compare with the provider</summary><p class="help-text">Sends these two points to Passio when requested. Its suggested paths are shown separately from our bus-only estimate.</p><button class="button" id="compare-provider">Request provider comparison</button><div id="operator-result" role="status"></div></details>' : ''}</aside>
      <div class="map-wrap planner-map-wrap"><div id="trip-map" class="map" role="region" aria-label="Trip map. Pick start and destination points using the buttons."></div><div id="map-instruction" class="map-instruction">${athensLocked ? 'Choose a start and destination in Athens, Georgia.' : 'Choose a start and destination to get going.'}</div><div class="map-caption journey-legend"><span>━ Used ride segment</span><span>┄ Approximate / walking</span><span class="transfer-key">↔ Transfer stop</span></div></div></div><div id="trip-notes"></div>
      <div class="planning-note">${warning(['The planner loads the full directed route topology, connects lines at shared or nearby stops, and ranks usable service with current ETAs and recent bus positions. Missing live timing uses a 7.5-minute wait and estimated bus travel. Trips are estimates, not a timetable guarantee.'], 'estimate')}</div></section>`;
  map = new TransitMap($('#trip-map'), agency.center || center, point => {
    if (!pickMode || planning) return;
    const label = pickMode === 'origin' ? 'Start selected on map' : 'Destination selected on map';
    if (pickMode === 'origin') { origin = point; originLabel = label; } else { destination = point; destinationLabel = label; }
    pointInputs[pickMode]?.setValue(label);
    pickMode = undefined; $('#map-instruction').textContent = 'Point selected. Choose the other point or find your trip.';
    resetTripResult();
    map?.showPoints(origin, destination);
  }, athensLocked);
  map.showPoints(origin, destination);
  const token = operation, current = service;
  let stopHints = knownStops(agency);
  // Fetch only stop directories; address typing never triggers a full ETA crawl.
  void current.getStops().then(stops => {
    if (token === operation) stopHints = [...new Map([...stops, ...stopHints].map(stop => [stop.id, stop])).values()];
  }).catch(() => { /* Reviewed local stops and map selection remain available. */ });
  for (const kind of ['origin', 'destination'] as const) {
    pointInputs[kind] = new PlaceInput($<HTMLInputElement>(`#trip-${kind}`), () => stopHints, agency.center || center, placeSearch, (place, text) => {
      const point = place || parseCoordinate(text) || undefined;
      if (kind === 'origin') { origin = point; originLabel = text; } else { destination = point; destinationLabel = text; }
      pickMode = undefined; resetTripResult(); map?.showPoints(origin, destination);
    }, pointAllowed);
  }
  $('#pick-origin').onclick = () => choosePoint('origin');
  $('#pick-destination').onclick = () => choosePoint('destination');
  $('#swap').onclick = () => {
    [origin, destination] = [destination, origin]; [originLabel, destinationLabel] = [destinationLabel, originLabel];
    pointInputs.origin?.setValue(originLabel); pointInputs.destination?.setValue(destinationLabel);
    resetTripResult();
    map?.showPoints(origin, destination);
  };
  $('#locate').onclick = () => void locateUser();
  $<HTMLFormElement>('#trip-form').onsubmit = event => { event.preventDefault(); void findTrip(); };
  document.querySelector<HTMLButtonElement>('#compare-provider')?.addEventListener('click', async () => {
    const token = operation; const revision = ++comparisonRevision;
    const from = origin, to = destination;
    if (!from || !to) { $('#operator-result').textContent = 'Choose start and destination suggestions or use the map first.'; return; }
    if (!pointAllowed(from) || !pointAllowed(to)) { $('#operator-result').innerHTML = localPointError(); return; }
    const button = $<HTMLButtonElement>('#compare-provider'); button.disabled = true; $('#operator-result').textContent = 'Requesting operator suggestions…';
    try { const comparison = await service.compareJourney(from, to); if (token !== operation || revision !== comparisonRevision) return; $('#operator-result').innerHTML = comparison.routes.map(route => `<article><h3>${e(route.label)}</h3><p>${route.durationSeconds !== undefined ? `${Math.ceil(route.durationSeconds / 60)} min` : 'Duration unavailable'}${route.transfers !== undefined ? ` · ${route.transfers} transfers` : ''}</p><ol>${route.legs.map(leg => `<li>${e(leg.mode === 'ride' ? leg.routeName || 'Bus' : 'Walk')}${leg.fromStopName ? ` · ${e(leg.fromStopName)} → ${e(leg.toStopName || '')}` : ''}</li>`).join('')}</ol></article>`).join('') || '<p>The provider returned no transit suggestion for these points.</p>'; $('#operator-result').innerHTML += warning(comparison.warnings); }
    catch (error) { if (token === operation && revision === comparisonRevision) $('#operator-result').textContent = errorMessage(error); }
    finally { if (token === operation) button.disabled = false; }
  });
  focusTitle();
}

function resetTripResult() { displayedJourney = undefined; $('#trip-notes').innerHTML = ''; $('#trip-result').innerHTML = ''; $('#trip-status').innerHTML = ''; comparisonRevision++; const comparison = document.querySelector('#operator-result'); if (comparison) comparison.innerHTML = ''; map?.clearJourney(); }

function choosePoint(kind: 'origin' | 'destination') {
  pickMode = kind;
  $('#map-instruction').textContent = `Click the map to choose your ${kind === 'origin' ? 'start' : 'destination'}.`;
  announce($('#map-instruction').textContent!);
}

function geolocate(): Promise<Coordinate> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location is unavailable in this browser. Search for a place or pick a point on the map.')); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }), error => reject(new Error(error.code === 1 ? 'Location permission was denied. Search for a place or pick a start on the map.' : 'Could not determine your location. Pick a point on the map.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

async function locateUser() {
  if (planning) return;
  const token = operation;
  const fields = $<HTMLFieldSetElement>('#trip-fields'); fields.disabled = true; planning = true;
  $('#trip-status').textContent = 'Finding your location…';
  try {
    const point = await geolocate(); if (token !== operation) return;
    if (!pointAllowed(point)) throw new Error('Your location is outside Athens, Georgia. Pick a local start or turn off Athens lock in the main menu.');
    origin = point; originLabel = 'Current location'; pointInputs.origin?.setValue(originLabel);
    resetTripResult();
    map?.showPoints(origin, destination); map?.focus(point);
    $('#trip-status').textContent = 'Current location selected.';
  } catch (error) { if (token === operation) $('#trip-status').innerHTML = warning([errorMessage(error)], 'location'); }
  finally { if (token === operation) { planning = false; fields.disabled = false; } }
}

async function findTrip() {
  if (planning) return;
  const from = origin, to = destination;
  if (!from || !to) { $('#trip-status').innerHTML = warning(['Choose a start and destination from the suggestions, or use the map. Valid decimal coordinates also work.'], 'action'); return; }
  if (!pointAllowed(from) || !pointAllowed(to)) { $('#trip-status').innerHTML = localPointError(); return; }
  displayedJourney = undefined; map?.clearJourney(); origin = from; destination = to; map?.showPoints(origin, destination);
  const token = operation; planning = true; pickMode = undefined;
  const fields = $<HTMLFieldSetElement>('#trip-fields'); fields.disabled = true; setRouteLoading(true);
  $('#trip-notes').innerHTML = '';
  $('#trip-result').innerHTML = ''; $('#trip-status').textContent = 'Comparing available routes, arrivals and transfers…';
  try {
    // Refresh the network for each search so old predictions are not reused as current.
    const currentNetwork = networkInScope(await service.getNetwork(), athensLocked); network = currentNetwork;
    if (token !== operation) return;
    const result = planJourney(currentNetwork, from, to, { now: Date.now(), maxWalkMeters: Number($<HTMLSelectElement>('#max-walk').value) });
    $('#trip-status').innerHTML = ''; $('#trip-notes').innerHTML = warning(currentNetwork.messages, 'service') + warning(currentNetwork.warnings);
    if (result.status === 'unavailable') { $('#trip-result').innerHTML = `<div class="empty"><h3>No bus connection found</h3><p>${e(result.reason)}</p><p>Try a point closer to a stop or increase the walking limit.</p></div>`; return; }
    const trip = result.journey; displayedJourney = trip; let rideNumber = 0;
    const routeById = new Map(currentNetwork.routes.map(route => [route.id, route]));
    const rideLegs = trip.legs.filter(leg => leg.kind === 'ride');
    const usedLines = [...new Map(rideLegs.map(leg => [JSON.stringify([leg.routeId,leg.direction]), {
      route: routeById.get(leg.routeId), leg, busCount: currentNetwork.vehicles.filter(bus => bus.routeId === leg.routeId).length,
    }])).values()];
    $('#trip-result').innerHTML = `<div class="trip-summary"><div class="eyebrow">QUICKEST ESTIMATED CONNECTION</div><strong>${Math.ceil(trip.durationSeconds / 60)} <small>min</small></strong><p>Arrive ${clockTime(trip.arrivalTime)} · ${trip.transfers} transfer${trip.transfers === 1 ? '' : 's'} · ${Math.round(trip.walkingMeters)} m walking</p><span class="estimate-badge">${trip.confidence === 'live-assisted' ? 'Uses live predictions + estimates' : 'Estimated timing'}</span></div>
      <section class="trip-lines" aria-labelledby="trip-lines-title"><h2 id="trip-lines-title">Bus lines for this trip</h2><ul>${usedLines.map(({ route, leg, busCount }) => `<li style="--route-color:${safeColor(route?.color ?? '#b92535')}"><span class="route-badge">${e(route?.shortName || leg.routeId)}</span><span><strong>${e(route?.name || leg.routeName)}</strong><small>${e(leg.direction)} · <span data-line-buses="${e(leg.routeId)}">${busCount} bus${busCount === 1 ? '' : 'es'} reported</span></small></span></li>`).join('')}</ul></section>
      <ol class="journey-legs">${trip.legs.map(leg => `<li class="journey-leg ${leg.kind}"><span class="leg-icon" aria-hidden="true">${leg.kind === 'walk' ? '↗' : leg.kind === 'wait' ? '◷' : '→'}</span><div>${leg.kind === 'ride' && rideNumber++ > 0 ? `<span class="transfer-hint">↔ Change at ${e(leg.stops[0]?.name)}</span>` : ''}<strong>${leg.kind === 'ride' ? e(leg.routeName) : leg.kind === 'wait' ? 'Wait for your bus' : 'Walk'}</strong><span>${clockTime(leg.startTime)} – ${clockTime(leg.endTime)}</span><p>${leg.kind === 'ride' ? `${e(leg.stops[0]?.name)} → ${e(leg.stops.at(-1)?.name)}<br>${e(leg.direction)} · ${leg.source === 'live' ? 'Live ETA' : leg.source === 'vehicle' ? 'Recent bus position' : 'Estimated'}` : `${Math.ceil((leg.endTime - leg.startTime) / 60000)} min`}</p></div></li>`).join('')}</ol><details class="assumptions"><summary>How this estimate works</summary><ul>${trip.assumptions.map(item => `<li>${e(compactNote(item))}</li>`).join('')}</ul><details class="note-details"><summary>Full text</summary>${trip.assumptions.map(item => `<p>${e(item)}</p>`).join('')}</details></details>`;
    map?.showJourney(trip, currentNetwork);
    $('#map-instruction').textContent = 'Used ride segments only · ↔ transfer stops · dashed lines: estimates';
    announce(`Trip found. ${Math.ceil(trip.durationSeconds / 60)} minutes, arriving ${clockTime(trip.arrivalTime)}.`);
  } catch (error) {
    if (token === operation) $('#trip-status').innerHTML = `${warning([errorMessage(error)], 'error')}`;
  } finally { if (token === operation) { planning = false; fields.disabled = false; setRouteLoading(false); renderReplication(); } }
}

async function showAgencies(historyMode: HistoryMode = 'push') {
  setPath('/networks', historyMode);
  setView('agencies'); const token = operation; const revision = ++agencyRevision;
  main.innerHTML = `<section class="container networks-page"><div class="eyebrow">BEYOND CAMPUS</div><div class="page-heading"><div><h1 tabindex="-1">Find your network<span>.</span></h1><p>${athensLocked ? 'Athens lock is on. Choose a local network below.' : 'Start with UGA or explore an agency connected to myStop / InfoPoint.'}</p></div></div>
    <button class="network-home" id="select-uga"><span class="route-badge">UGA</span><span><strong>University of Georgia</strong><small>Athens, Georgia · Default network</small></span><span aria-hidden="true">↗</span></button>
    <div class="network-presets"><button class="network-home" id="select-ohio"><span class="route-badge">OH</span><span><strong>Athens Public Transit</strong><small>Athens, Ohio · Passio · Three backend replicas</small></span><span aria-hidden="true">↗</span></button><button class="network-home" id="select-passio-uga"><span class="route-badge">GA</span><span><strong>UGA on Passio</strong><small>Campus only · Three backend replicas</small></span><span aria-hidden="true">↗</span></button></div>
    <div class="network-tools"><label class="search"><span aria-hidden="true">⌕</span><input id="agency-search" placeholder="Search agencies" aria-label="Search agencies"></label><button class="button" id="nearby-agencies">⌖ Find nearby</button><form id="code-form"><label class="sr-only" for="agency-code">Authority code</label><input id="agency-code" placeholder="Authority code" required maxlength="50"><button class="button" type="submit">Find by code</button></form></div>
    <div id="agency-status" role="status">Loading the authority directory…</div><div id="agencies" class="agency-grid"></div>
    <p class="help-text">Agency support and data quality vary. Discovery comes from the operator’s original HTTP directory through our gateway. Newly added agency hosts need gateway approval before use.</p></section>`;
  $('#select-uga').onclick = () => void selectAgency(UGA_AGENCY);
  $<HTMLButtonElement>('#select-ohio').hidden = athensLocked;
  $('.network-tools').hidden = athensLocked;
  $('#select-ohio').onclick = () => void selectAgency(PASSIO_ATHENS_AGENCY);
  $('#select-passio-uga').onclick = () => void selectAgency(PASSIO_UGA_AGENCY);
  $('#agency-search').oninput = renderAgencies;
  $('#nearby-agencies').onclick = () => void searchAgencies('nearby');
  $<HTMLFormElement>('#code-form').onsubmit = event => { event.preventDefault(); void searchAgencies('code'); };
  focusTitle();
  if (athensLocked) {
    agencyChoices = [ATHENS_INFO_AGENCY]; $('#agency-status').textContent = 'Athens lock is on · Athens, Georgia networks only. Turn it off in the main menu to explore elsewhere.'; renderAgencies(); return;
  }
  try { const result = await discoverAgencies(); if (token !== operation || revision !== agencyRevision) return; agencyChoices = result; $('#agency-status').textContent = `${result.length} agencies in the directory`; renderAgencies(); }
  catch (error) { if (token === operation && revision === agencyRevision) $('#agency-status').innerHTML = `${warning([errorMessage(error)], 'error')}<button id="retry-agencies" class="button">Retry directory</button>`; document.querySelector<HTMLButtonElement>('#retry-agencies')?.addEventListener('click', () => void showAgencies()); }
}

async function searchAgencies(kind: 'nearby' | 'code') {
  if (athensLocked) return;
  const token = operation; const revision = ++agencyRevision;
  $('#agency-status').textContent = kind === 'nearby' ? 'Finding agencies near you…' : 'Looking up authority code…';
  try {
    const result = kind === 'nearby' ? await locateAgencies(await geolocate()) : await findAgenciesByCode($<HTMLInputElement>('#agency-code').value.trim());
    if (token !== operation || revision !== agencyRevision) return;
    agencyChoices = result; $<HTMLInputElement>('#agency-search').value = '';
    $('#agency-status').textContent = `${result.length} agencies found`; renderAgencies();
  } catch (error) { if (token === operation && revision === agencyRevision) $('#agency-status').innerHTML = `${warning([errorMessage(error)], 'error')}`; }
}

function renderAgencies() {
  const query = $<HTMLInputElement>('#agency-search').value.toLowerCase();
  $('#agencies').innerHTML = agencyChoices.filter(item => (!athensLocked || isAthensAgency(item)) && item.name.toLowerCase().includes(query)).map(item => `<button class="agency-card" data-agency="${e(item.id)}"><strong>${e(item.name)}</strong><span>Explore routes ↗</span></button>`).join('') || '<p class="empty">No agencies found.</p>';
  document.querySelectorAll<HTMLButtonElement>('[data-agency]').forEach(button => button.onclick = () => { const choice = agencyChoices.find(item => item.id === button.dataset.agency); if (choice) void selectAgency(choice); });
}

async function selectAgency(choice: Agency) {
  if (athensLocked && !isAthensAgency(choice)) { announce('Turn off Athens lock in the main menu to explore other networks.'); return; }
  agency = choice.kind === 'uga' ? GEORGIA_AGENCY : choice; service = createTransitService(agency); routes = []; network = undefined; detail = undefined; origin = undefined; destination = undefined; originLabel = ''; destinationLabel = '';
  $('#agency-name').textContent = agency.name;
  $('#sync-status').textContent = ''; $('#provider-details').textContent = ''; $<HTMLButtonElement>('#sync-data').disabled = false; renderReplication();
  await showRoutes(true);
}

window.setInterval(async () => {
  if (document.hidden || pollBusy || !(view==='detail' && detail || view==='plan' && displayedJourney && network)) return;
  pollBusy=true; const token=operation;
  try {
    const vehicles=vehiclesInScope(await service.refreshVehicles(),athensLocked);
    if (token!==operation) return;
    if (view==='detail' && detail) {
      detail.vehicles=vehicles.filter(bus=>bus.routeId===detail!.route.id);
      map?.showVehicles(detail.vehicles,detail.route.color); renderVehicles();
      writeNotes('#route-warnings',warning(detail.warnings));
    } else if (view==='plan' && displayedJourney && network) {
      network.vehicles=vehicles; map?.showJourneyVehicles(displayedJourney,network);
      document.querySelectorAll<HTMLElement>('[data-line-buses]').forEach(element=>{
        const count=vehicles.filter(bus=>bus.routeId===element.dataset.lineBuses).length;
        element.textContent=`${count} bus${count===1?'':'es'} reported`;
      });
    }
    renderReplication();
  } catch (error) {
    if (token!==operation) return;
    const message=warning([`Live refresh failed: ${errorMessage(error)} Showing the last received positions.`]);
    if (view==='detail') writeNotes('#route-warnings',message);
    else if (view==='plan') writeNotes('#trip-notes',message);
  } finally { pollBusy=false; }
},15000);

window.setInterval(() => { if (view !== 'agencies') void crawlLive(); }, 60000);

function showCurrentPath() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/plan') { showPlanner('none'); return; }
  if (path === '/routes') { void showRoutes(false, 'none'); return; }
  if (path === '/networks') { void showAgencies('none'); return; }
  const routeMatch = /^\/routes\/([^/]+)$/.exec(path);
  if (routeMatch) {
    try { void showRoute(decodeURIComponent(routeMatch[1]), 'none'); return; }
    catch { /* Invalid path encoding falls through to the catalog. */ }
  }
  void showRoutes(false, 'replace');
}

window.addEventListener('popstate', showCurrentPath);
showCurrentPath();
