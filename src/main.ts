import './style.css';
import { UGA_AGENCY, discoverAgencies, locateAgencies, findAgenciesByCode } from './api';
import { createTransitService, GEORGIA_AGENCY, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY } from './replication';
import { planJourney, parseCoordinate } from './planner';
import { TransitMap } from './map';
import type { Agency, Coordinate, Network, Route, RouteDetail, Stop, StopDetail } from './types';
import { escapeHtml as e, safeColor, coordinates, clockTime, arrivalLabel, vehicleAge, headingLabel } from './ui';

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
    <nav aria-label="Main navigation"><button data-nav="routes">Routes</button><button data-nav="plan">Plan a trip <span aria-hidden="true">↗</span></button><button data-nav="agencies">Networks</button></nav>
    <div class="place"><span class="status-dot"></span><span id="agency-name">${e(agency.name)}</span></div>
  </div></header>
  <aside class="source-bar" aria-label="Data reliability"><details id="data-sources"><summary id="source-summary">Checking transit sources…</summary><div id="source-status"></div><div class="source-actions"><button class="button" id="sync-data">Sync all sources</button><button class="button" id="provider-info">Provider information</button></div><p class="help-text">Matching reports take precedence. One healthy source can serve as backup. Replicas may share an upstream; agreement does not guarantee accuracy.</p><div id="sync-status" role="status"></div><div id="provider-details"></div></details></aside>
  <main id="main" tabindex="-1"></main>
  <footer><strong>tranuga.</strong><span>Independent explorer · UGA, Avail InfoPoint &amp; Passio</span><span>Times are estimates. Check operator alerts before travel.</span></footer>
  <div id="announcement" class="sr-only" role="status" aria-live="polite"></div>`;

const main = document.querySelector<HTMLElement>('#main')!;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
function announce(message: string) { $('#announcement').textContent = message; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'The transit service is unavailable. Try again shortly.'; }
function warning(messages: string[]) { return messages.length ? `<div class="notice" role="status">${messages.map(message => `<p>${e(message)}</p>`).join('')}</div>` : ''; }
function setView(next: typeof view) {
  map?.destroy(); map = undefined; view = next; operation++;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nav]')) {
    const active = button.dataset.nav === (next === 'detail' ? 'routes' : next);
    button.classList.toggle('current', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
}
function focusTitle() { main.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }); }
function renderReplication() {
  const report = service.report;
  $('#source-summary').textContent = `${report.healthy}/${report.total} ${report.mode === 'replicas' ? 'backend replicas' : 'data feeds'} responding · Data sources`;
  $('#source-status').innerHTML = report.sources.map(source => `<div class="source-row"><strong>${e(source.label)}</strong><span class="source-state ${source.state}">${e(source.state === 'healthy' ? 'Available' : source.state === 'degraded' ? 'Partly available' : source.state === 'cached' ? 'Saved backup' : 'Unavailable')}</span><small>${e(source.detail || source.error || (source.lastSuccessAt ? `Checked ${clockTime(source.lastSuccessAt)}` : ''))}</small></div>`).join('') + `<p class="help-text">Last comparison: ${report.agreements} matching records · ${report.conflicts} disagreements · ${report.cached} saved records. ${report.mode === 'replicas' ? 'Two of three matching replicas corroborate a record.' : agency.kind === 'uga' ? 'Georgia campus and city routes each have two comparable channels; other feeds do not count as votes for missing coverage.' : 'This agency has one configured feed, with saved last-good data for short outages.'}</p>`;
  $<HTMLButtonElement>('#provider-info').hidden = !service.hasPassioFor();
}
$('#sync-data').onclick = async () => {
  const current = service; const button = $<HTMLButtonElement>('#sync-data'); button.disabled = true;
  $('#sync-status').textContent = 'Crawling configured feeds, stops and predictions…';
  try { const result = await current.sync(); if (service !== current) return; if (view === 'routes') { routes = result.routes; renderRouteCards(); } $('#sync-status').textContent = `Merged ${result.routes.length} routes, ${result.stops.length} stops and ${result.vehicles.length} reported buses. ${result.warnings.join(' ')}`; }
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

async function showRoutes(refresh = false) {
  setView('routes'); const token = operation;
  main.innerHTML = `<section class="catalog container">
    <div class="eyebrow">YOUR NEXT CONNECTION</div>
    <div class="page-heading"><div><h1 tabindex="-1">Athens, in motion<span>.</span></h1><p>Find your route. See your bus. Go somewhere.</p></div><button id="catalog-plan" class="button primary">Plan a trip <span aria-hidden="true">↗</span></button></div>
    <div class="catalog-toolbar"><div><h2>Explore the routes</h2><span id="route-count" class="muted">Connecting to ${e(agency.name)}…</span></div><div class="filters"><label class="search"><span aria-hidden="true">⌕</span><input id="route-search" type="search" placeholder="Search routes" aria-label="Search routes"></label><label class="toggle"><input type="checkbox" id="active-only"> Active only</label><button id="refresh-routes" class="icon-button" aria-label="Refresh routes">↻</button></div></div>
    <div id="catalog-status" role="status"></div><div id="routes" class="route-grid" aria-label="Bus routes"><div class="loading">Loading available routes…</div></div>
    <aside class="catalog-note"><span class="note-number">01 — 02 — GO</span><div><h3>A little less waiting. A little more going.</h3><p>Select a route for its stops and bus positions, or let the trip planner find a connection from any point on the map.</p></div><span class="note-arrow" aria-hidden="true">↗</span></aside>
  </section>`;
  $('#catalog-plan').onclick = showPlanner;
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
      $('#catalog-status').innerHTML = `<div class="notice error" role="alert">${e(errorMessage(error))} Use refresh to try again.</div>`;
    }
  }
  if (token === operation) { renderRouteCards(); renderReplication(); if (!crawled.has(service)) { crawled.add(service); void crawlLive(); } }
}

function renderRouteCards() {
  if (view !== 'routes') return;
  const query = $<HTMLInputElement>('#route-search').value.trim().toLowerCase();
  const activeOnly = $<HTMLInputElement>('#active-only').checked;
  const confirmed = (route: Route) => route.active && route.availability !== 'published' && route.availability !== 'unknown';
  const filtered = routes.filter(route => (!activeOnly || confirmed(route)) && `${route.name} ${route.shortName} ${route.id}`.toLowerCase().includes(query));
  $('#route-count').textContent = `${routes.length} routes · ${routes.filter(confirmed).length} active${catalogTime ? ` · Checked ${clockTime(catalogTime)}` : ''}`;
  $('#routes').innerHTML = filtered.map(route => `<button class="route-card" data-route="${e(route.id)}" style="--route-color:${safeColor(route.color)}">
    <div class="card-top"><span class="route-badge">${e(route.shortName || route.id)}</span><span class="service-state ${confirmed(route) ? 'active' : ''}"><i></i>${confirmed(route) ? 'Active service' : route.availability === 'published' || route.availability === 'unknown' ? 'Service unconfirmed' : 'Not active'}</span></div>
    <h3>${e(route.name)}</h3><div class="card-bottom"><span>View route &amp; stops</span><span class="card-arrow" aria-hidden="true">↗</span></div>
  </button>`).join('') || `<div class="empty">${routes.length ? 'No routes match your search.' : 'No routes available. Refresh to try again.'}</div>`;
  document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button => button.onclick = () => void showRoute(button.dataset.route!));
}

async function showRoute(routeId: string) {
  setView('detail'); const token = operation; detail = undefined; selectedStop = undefined; selectedDirection = '';
  main.innerHTML = `<section class="container detail-page"><button class="text-button" id="back-routes">← All routes</button><div id="route-detail" class="loading" role="status">Loading route, stops and live buses…</div></section>`;
  $('#back-routes').onclick = () => void showRoutes();
  try {
    const result = await service.getRoute(routeId);
    if (token !== operation) return;
    detail = result;
    $('#route-detail').className = '';
    $('#route-detail').innerHTML = `<div class="detail-title"><span class="route-badge large" style="--route-color:${safeColor(result.route.color)}">${e(result.route.shortName)}</span><div><div class="eyebrow">${e(agency.name)}</div><h1 tabindex="-1">${e(result.route.name)}</h1></div><div class="detail-stats" id="detail-stats"></div></div>
      <div id="service-messages">${warning(result.messages)}</div><div id="route-warnings">${warning(result.warnings)}</div>
      <div class="route-layout"><div class="map-wrap"><div id="route-map" class="map" role="region" aria-label="Route map with stops and bus directions"></div><div class="map-caption"><span><i class="legend-line" style="background:${safeColor(result.route.color)}"></i>Route</span><span>○ Stop</span><span>↑ Bus heading</span><span>Grey = stale position</span></div></div>
      <aside class="stop-panel"><div class="panel-heading"><h2>Along the way</h2><label class="sr-only" for="route-direction">Route direction</label><select id="route-direction"><option value="">All directions</option>${result.patterns.map(pattern => `<option value="${e(pattern.id)}">${e(pattern.direction)}</option>`).join('')}</select></div><div id="stop-detail" aria-live="polite"></div><div id="route-stops"></div></aside></div>
      <div class="vehicles-section"><h2>On the road</h2><p class="muted">Positions refresh every 15 seconds. Arrows show the reported heading.</p>${service.hasPassioFor(result.route.id) ? '<form id="bus-search" class="bus-search"><label for="bus-query">Find a bus by fleet number</label><input id="bus-query" placeholder="Bus number" required maxlength="40"><button class="button" type="submit">Find bus</button></form><div id="bus-search-result" role="status"></div>' : ''}<div id="vehicle-list" class="vehicle-list"></div></div>`;
    map = new TransitMap($('#route-map'), agency.center || center);
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
      try { const buses = await service.searchBuses(query); if (token !== operation || $<HTMLInputElement>('#bus-query').value.trim() !== query) return; $('#bus-search-result').innerHTML = buses.map(bus => `<p>Bus ${e(bus.id)} · ${e(routes.find(route => route.id === bus.routeId)?.name || bus.routeId)} · ${e(headingLabel(bus.heading))} · ${e(vehicleAge(bus.updatedAt))}</p>`).join('') || '<p>No matching bus is reported by the provider.</p>'; }
      catch (error) { if (token === operation) $('#bus-search-result').textContent = errorMessage(error); }
      finally { if (token === operation) renderReplication(); }
    });
    void service.getMessages().then(messages => { if (token === operation) $('#service-messages').innerHTML = warning([...new Set([...result.messages, ...messages])]); }).catch(error => { if (token === operation) $('#service-messages').innerHTML += warning([`Service alerts could not be loaded: ${errorMessage(error)}`]); });
  } catch (error) {
    if (token === operation) $('#route-detail').innerHTML = `<div class="notice error" role="alert">${e(errorMessage(error))}</div><button class="button" id="retry-route">Retry route</button>`;
    document.querySelector<HTMLButtonElement>('#retry-route')?.addEventListener('click', () => void showRoute(routeId));
  }
}

function renderStops() {
  if (!detail) return;
  const stops = selectedDirection ? detail.patterns.find(pattern => pattern.id === selectedDirection)?.stops || [] : detail.stops;
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
    selectedStop = result;
    $('#stop-detail').innerHTML = `<div class="stop-arrivals"><div class="eyebrow">STOP ${e(stop.id)}</div><h3>${e(result.stop.name || stop.name)}</h3>${result.departures.filter(d => d.arrivalTime >= Date.now() - 30000).sort((a, b) => a.arrivalTime - b.arrivalTime).slice(0, 10).map(dep => `<div class="arrival-row"><span>${e(routes.find(r => r.id === dep.routeId)?.shortName || dep.routeId)} ${e(dep.direction || '')}</span><strong>${arrivalLabel(dep.arrivalTime)}</strong><small>${dep.scheduled ? 'Scheduled' : 'Predicted'} · ${clockTime(dep.arrivalTime)}</small></div>`).join('') || '<p>No upcoming predictions are available for this stop.</p>'}<button class="text-button" id="stop-as-origin">Start a trip here ↗</button>${service.hasPassioFor(detail?.route.id, stop.id) ? '<br><button class="text-button" id="show-timetable">Provider timetable</button><div id="stop-timetable"></div>' : ''}</div>`;
    $('#stop-as-origin').onclick = () => { origin = selectedStop!.stop; showPlanner(); };
    document.querySelector<HTMLButtonElement>('#show-timetable')?.addEventListener('click', async () => {
      $('#stop-timetable').textContent = 'Loading timetable…';
      try { const timetable = await service.getTimetable(stop.id, detail?.route.id); if (token !== operation || stopToken !== stopOperation) return; $('#stop-timetable').innerHTML = `<p>${timetable.times.length ? timetable.times.map(time => e(time)).join(' · ') : 'No next clock times are supplied.'}</p><small>Provider clock times${timetable.timezone ? ` · ${e(timetable.timezone)}` : ''}. Dates and live availability are not implied.</small>`; }
      catch (error) { if (token === operation && stopToken === stopOperation) $('#stop-timetable').textContent = errorMessage(error); }
    });
    renderReplication();
  } catch (error) {
    if (token === operation && stopToken === stopOperation) $('#stop-detail').innerHTML = `<div class="notice error" role="alert">${e(errorMessage(error))}</div>`;
  }
}

function renderVehicles() {
  if (!detail || view !== 'detail') return;
  $('#detail-stats').innerHTML = `<strong>${detail.vehicles.length}</strong><span>buses reported</span>`;
  $('#vehicle-list').innerHTML = detail.vehicles.map(bus => `<article class="vehicle-card"><span class="vehicle-heading" style="transform:rotate(${Number.isFinite(bus.heading) ? bus.heading : 0}deg)" aria-hidden="true">↑</span><div><strong>Bus ${e(bus.id)}</strong><p>${e(bus.destination || detail!.route.name)}</p><small>${e(headingLabel(bus.heading))} · ${Math.round(bus.heading)}° · ${e(vehicleAge(bus.updatedAt))}</small>${!bus.updatedAt || Date.now() - bus.updatedAt > 120000 ? '<span class="stale-label">Last known position</span>' : ''}</div></article>`).join('') || '<div class="empty">No buses are currently reported on this route.</div>';
}

function showPlanner() {
  setView('plan'); pickMode = undefined; planning = false;
  main.innerHTML = `<section class="container planner-page"><div class="eyebrow">MAKE A CONNECTION</div><div class="page-heading"><div><h1 tabindex="-1">Your way from A to B<span>.</span></h1><p>Pick two points. We’ll compare the available bus connections.</p></div></div>
    <div class="planner-layout"><aside class="trip-panel"><form id="trip-form"><fieldset id="trip-fields">
      <label class="field-label" for="trip-origin"><span class="point-label" aria-hidden="true">A</span>Start</label><input id="trip-origin" placeholder="Latitude, longitude" value="${origin ? coordinates(origin) : ''}" required><div class="field-actions"><button type="button" id="pick-origin" class="text-button">⊕ Pick on map</button><button type="button" id="locate" class="text-button">⌖ My location</button></div>
      <label class="field-label" for="trip-destination"><span class="point-label destination" aria-hidden="true">B</span>Destination</label><input id="trip-destination" placeholder="Latitude, longitude" value="${destination ? coordinates(destination) : ''}" required><div class="field-actions"><button type="button" id="pick-destination" class="text-button">⊕ Pick on map</button><button type="button" id="swap" class="text-button">⇅ Swap</button></div>
      <label class="field-label" for="max-walk">Maximum walk to / from the bus</label><select id="max-walk"><option value="800">800 m · about 10 minutes</option><option value="1200" selected>1.2 km · about 15 minutes</option><option value="2000">2 km · about 25 minutes</option></select>
      <button class="button primary full" type="submit" id="find-trip">Find quickest bus trip <span aria-hidden="true">↗</span></button>
      <p class="help-text">Use decimal coordinates or click the map. Walking follows straight-line distances; allow extra time for paths and crossings. Transfers can include up to 300 m of walking.</p>
      </fieldset></form><div id="trip-status" role="status"></div><div id="trip-result" aria-live="polite"></div>${service.hasPassioFor() ? '<details class="operator-comparison"><summary>Compare with the provider</summary><p class="help-text">Sends these two points to Passio when requested. Its suggested paths are shown separately from our bus-only estimate.</p><button class="button" id="compare-provider">Request provider comparison</button><div id="operator-result" role="status"></div></details>' : ''}</aside>
      <div class="map-wrap planner-map-wrap"><div id="trip-map" class="map" role="region" aria-label="Trip map. Pick start and destination points using the buttons."></div><div id="map-instruction" class="map-instruction">Choose a start and destination to get going.</div></div></div>
      <div class="notice planning-note"><strong>Fastest under the available data.</strong><p>The planner compares directed bus trips, walking and transfers. Missing predictions use a 7.5-minute wait and estimated bus travel. Trips are estimates, not a timetable guarantee. Only routes marked active are used.</p></div></section>`;
  map = new TransitMap($('#trip-map'), agency.center || center, point => {
    if (!pickMode || planning) return;
    if (pickMode === 'origin') origin = point; else destination = point;
    $<HTMLInputElement>(`#trip-${pickMode}`).value = coordinates(point);
    pickMode = undefined; $('#map-instruction').textContent = 'Point selected. Choose the other point or find your trip.';
    resetTripResult();
    map?.showPoints(origin, destination);
  });
  map.showPoints(origin, destination);
  for (const id of ['#trip-origin', '#trip-destination']) $<HTMLInputElement>(id).oninput = () => {
    origin = parseCoordinate($<HTMLInputElement>('#trip-origin').value) || undefined;
    destination = parseCoordinate($<HTMLInputElement>('#trip-destination').value) || undefined;
    resetTripResult(); map?.showPoints(origin, destination);
  };
  $('#pick-origin').onclick = () => choosePoint('origin');
  $('#pick-destination').onclick = () => choosePoint('destination');
  $('#swap').onclick = () => {
    const a = $<HTMLInputElement>('#trip-origin'), b = $<HTMLInputElement>('#trip-destination');
    [a.value, b.value] = [b.value, a.value];
    origin = parseCoordinate(a.value) || undefined; destination = parseCoordinate(b.value) || undefined;
    resetTripResult();
    map?.showPoints(origin, destination);
  };
  $('#locate').onclick = () => void locateUser();
  $<HTMLFormElement>('#trip-form').onsubmit = event => { event.preventDefault(); void findTrip(); };
  document.querySelector<HTMLButtonElement>('#compare-provider')?.addEventListener('click', async () => {
    const token = operation; const revision = ++comparisonRevision;
    const from = parseCoordinate($<HTMLInputElement>('#trip-origin').value), to = parseCoordinate($<HTMLInputElement>('#trip-destination').value);
    if (!from || !to) { $('#operator-result').textContent = 'Enter valid start and destination coordinates first.'; return; }
    const button = $<HTMLButtonElement>('#compare-provider'); button.disabled = true; $('#operator-result').textContent = 'Requesting operator suggestions…';
    try { const comparison = await service.compareJourney(from, to); if (token !== operation || revision !== comparisonRevision) return; $('#operator-result').innerHTML = comparison.routes.map(route => `<article><h3>${e(route.label)}</h3><p>${route.durationSeconds !== undefined ? `${Math.ceil(route.durationSeconds / 60)} min` : 'Duration unavailable'}${route.transfers !== undefined ? ` · ${route.transfers} transfers` : ''}</p><ol>${route.legs.map(leg => `<li>${e(leg.mode === 'ride' ? leg.routeName || 'Bus' : 'Walk')}${leg.fromStopName ? ` · ${e(leg.fromStopName)} → ${e(leg.toStopName || '')}` : ''}</li>`).join('')}</ol></article>`).join('') || '<p>The provider returned no transit suggestion for these points.</p>'; $('#operator-result').innerHTML += warning(comparison.warnings); }
    catch (error) { if (token === operation && revision === comparisonRevision) $('#operator-result').textContent = errorMessage(error); }
    finally { if (token === operation) button.disabled = false; }
  });
  focusTitle();
}

function resetTripResult() { $('#trip-result').innerHTML = ''; $('#trip-status').innerHTML = ''; comparisonRevision++; const comparison = document.querySelector('#operator-result'); if (comparison) comparison.innerHTML = ''; map?.clearJourney(); }

function choosePoint(kind: 'origin' | 'destination') {
  pickMode = kind;
  $('#map-instruction').textContent = `Click the map to choose your ${kind === 'origin' ? 'start' : 'destination'}.`;
  announce($('#map-instruction').textContent!);
}

function geolocate(): Promise<Coordinate> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location is unavailable in this browser. Enter coordinates or pick a point on the map.')); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }), error => reject(new Error(error.code === 1 ? 'Location permission was denied. Pick a start on the map or enter coordinates.' : 'Could not determine your location. Pick a point on the map.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

async function locateUser() {
  if (planning) return;
  const token = operation;
  const fields = $<HTMLFieldSetElement>('#trip-fields'); fields.disabled = true; planning = true;
  $('#trip-status').textContent = 'Finding your location…';
  try {
    const point = await geolocate(); if (token !== operation) return;
    origin = point; $<HTMLInputElement>('#trip-origin').value = coordinates(point);
    resetTripResult();
    map?.showPoints(origin, destination); map?.focus(point);
    $('#trip-status').textContent = 'Current location selected.';
  } catch (error) { if (token === operation) $('#trip-status').innerHTML = `<p class="error" role="alert">${e(errorMessage(error))}</p>`; }
  finally { if (token === operation) { planning = false; fields.disabled = false; } }
}

async function findTrip() {
  if (planning) return;
  const from = parseCoordinate($<HTMLInputElement>('#trip-origin').value);
  const to = parseCoordinate($<HTMLInputElement>('#trip-destination').value);
  if (!from || !to) { $('#trip-status').innerHTML = '<p class="error" role="alert">Enter valid latitude, longitude coordinates for both points (for example 33.948, -83.377).</p>'; return; }
  origin = from; destination = to; map?.showPoints(origin, destination);
  const token = operation; planning = true; pickMode = undefined;
  const fields = $<HTMLFieldSetElement>('#trip-fields'); fields.disabled = true;
  $('#trip-result').innerHTML = ''; $('#trip-status').textContent = 'Comparing available routes, arrivals and transfers…';
  try {
    // Refresh the network for each search so old predictions are not reused as current.
    network = await service.getNetwork();
    if (token !== operation) return;
    const result = planJourney(network, from, to, { now: Date.now(), maxWalkMeters: Number($<HTMLSelectElement>('#max-walk').value) });
    $('#trip-status').innerHTML = warning([...network.messages, ...network.warnings]);
    if (result.status === 'unavailable') { $('#trip-result').innerHTML = `<div class="empty"><h3>No bus connection found</h3><p>${e(result.reason)}</p><p>Try a point closer to a stop or increase the walking limit.</p></div>`; return; }
    const trip = result.journey;
    $('#trip-result').innerHTML = `<div class="trip-summary"><div class="eyebrow">QUICKEST ESTIMATED CONNECTION</div><strong>${Math.ceil(trip.durationSeconds / 60)} <small>min</small></strong><p>Arrive ${clockTime(trip.arrivalTime)} · ${trip.transfers} transfer${trip.transfers === 1 ? '' : 's'} · ${Math.round(trip.walkingMeters)} m walking</p><span class="estimate-badge">${trip.confidence === 'live-assisted' ? 'Uses live predictions + estimates' : 'Estimated timing'}</span></div>
      <ol class="journey-legs">${trip.legs.map(leg => `<li class="journey-leg ${leg.kind}"><span class="leg-icon" aria-hidden="true">${leg.kind === 'walk' ? '↗' : leg.kind === 'wait' ? '◷' : '→'}</span><div><strong>${leg.kind === 'ride' ? e(leg.routeName) : leg.kind === 'wait' ? 'Wait for your bus' : 'Walk'}</strong><span>${clockTime(leg.startTime)} – ${clockTime(leg.endTime)}</span><p>${leg.kind === 'ride' ? `${e(leg.stops[0]?.name)} → ${e(leg.stops.at(-1)?.name)}<br>${e(leg.direction)} · ${leg.source === 'live' ? 'Live assisted' : 'Estimated'}` : `${Math.ceil((leg.endTime - leg.startTime) / 60000)} min`}</p></div></li>`).join('')}</ol><details class="assumptions"><summary>How this estimate works</summary>${trip.assumptions.map(item => `<p>${e(item)}</p>`).join('')}</details>`;
    map?.showJourney(trip, new Map(network.routes.map(route => [route.id, route.color])));
    $('#map-instruction').textContent = 'Bus lines connect the stops used. Walking lines show straight-line estimates.';
    announce(`Trip found. ${Math.ceil(trip.durationSeconds / 60)} minutes, arriving ${clockTime(trip.arrivalTime)}.`);
  } catch (error) {
    if (token === operation) $('#trip-status').innerHTML = `<div class="notice error" role="alert">${e(errorMessage(error))}</div>`;
  } finally { if (token === operation) { planning = false; fields.disabled = false; renderReplication(); } }
}

async function showAgencies() {
  setView('agencies'); const token = operation; const revision = ++agencyRevision;
  main.innerHTML = `<section class="container networks-page"><div class="eyebrow">BEYOND CAMPUS</div><div class="page-heading"><div><h1 tabindex="-1">Find your network<span>.</span></h1><p>Start with UGA or explore an agency connected to myStop / InfoPoint.</p></div></div>
    <button class="network-home" id="select-uga"><span class="route-badge">UGA</span><span><strong>University of Georgia</strong><small>Athens, Georgia · Default network</small></span><span aria-hidden="true">↗</span></button>
    <div class="network-presets"><button class="network-home" id="select-ohio"><span class="route-badge">OH</span><span><strong>Athens Public Transit</strong><small>Athens, Ohio · Passio · Three backend replicas</small></span><span aria-hidden="true">↗</span></button><button class="network-home" id="select-passio-uga"><span class="route-badge">GA</span><span><strong>UGA on Passio</strong><small>Campus only · Three backend replicas</small></span><span aria-hidden="true">↗</span></button></div>
    <div class="network-tools"><label class="search"><span aria-hidden="true">⌕</span><input id="agency-search" placeholder="Search agencies" aria-label="Search agencies"></label><button class="button" id="nearby-agencies">⌖ Find nearby</button><form id="code-form"><label class="sr-only" for="agency-code">Authority code</label><input id="agency-code" placeholder="Authority code" required maxlength="50"><button class="button" type="submit">Find by code</button></form></div>
    <div id="agency-status" role="status">Loading the authority directory…</div><div id="agencies" class="agency-grid"></div>
    <p class="help-text">Agency support and data quality vary. Discovery comes from the operator’s original HTTP directory through our gateway. Newly added agency hosts need gateway approval before use.</p></section>`;
  $('#select-uga').onclick = () => void selectAgency(UGA_AGENCY);
  $('#select-ohio').onclick = () => void selectAgency(PASSIO_ATHENS_AGENCY);
  $('#select-passio-uga').onclick = () => void selectAgency(PASSIO_UGA_AGENCY);
  $('#agency-search').oninput = renderAgencies;
  $('#nearby-agencies').onclick = () => void searchAgencies('nearby');
  $<HTMLFormElement>('#code-form').onsubmit = event => { event.preventDefault(); void searchAgencies('code'); };
  focusTitle();
  try { const result = await discoverAgencies(); if (token !== operation || revision !== agencyRevision) return; agencyChoices = result; $('#agency-status').textContent = `${result.length} agencies in the directory`; renderAgencies(); }
  catch (error) { if (token === operation && revision === agencyRevision) $('#agency-status').innerHTML = `<p class="error" role="alert">${e(errorMessage(error))}</p><button id="retry-agencies" class="button">Retry directory</button>`; document.querySelector<HTMLButtonElement>('#retry-agencies')?.addEventListener('click', () => void showAgencies()); }
}

async function searchAgencies(kind: 'nearby' | 'code') {
  const token = operation; const revision = ++agencyRevision;
  $('#agency-status').textContent = kind === 'nearby' ? 'Finding agencies near you…' : 'Looking up authority code…';
  try {
    const result = kind === 'nearby' ? await locateAgencies(await geolocate()) : await findAgenciesByCode($<HTMLInputElement>('#agency-code').value.trim());
    if (token !== operation || revision !== agencyRevision) return;
    agencyChoices = result; $<HTMLInputElement>('#agency-search').value = '';
    $('#agency-status').textContent = `${result.length} agencies found`; renderAgencies();
  } catch (error) { if (token === operation && revision === agencyRevision) $('#agency-status').innerHTML = `<p class="error" role="alert">${e(errorMessage(error))}</p>`; }
}

function renderAgencies() {
  const query = $<HTMLInputElement>('#agency-search').value.toLowerCase();
  $('#agencies').innerHTML = agencyChoices.filter(item => item.name.toLowerCase().includes(query)).map(item => `<button class="agency-card" data-agency="${e(item.id)}"><strong>${e(item.name)}</strong><span>Explore routes ↗</span></button>`).join('') || '<p class="empty">No agencies found.</p>';
  document.querySelectorAll<HTMLButtonElement>('[data-agency]').forEach(button => button.onclick = () => { const choice = agencyChoices.find(item => item.id === button.dataset.agency); if (choice) void selectAgency(choice); });
}

async function selectAgency(choice: Agency) {
  agency = choice.kind === 'uga' ? GEORGIA_AGENCY : choice; service = createTransitService(agency); routes = []; network = undefined; detail = undefined; origin = undefined; destination = undefined;
  $('#agency-name').textContent = agency.name;
  $('#sync-status').textContent = ''; $('#provider-details').textContent = ''; $<HTMLButtonElement>('#sync-data').disabled = false; renderReplication();
  await showRoutes(true);
}

window.setInterval(async () => {
  if (document.hidden || pollBusy || view !== 'detail' || !detail) return;
  pollBusy = true; const token = operation;
  try {
    const vehicles = await service.refreshVehicles();
    if (token !== operation || !detail) return;
    detail.vehicles = vehicles.filter(bus => bus.routeId === detail!.route.id);
    map?.showVehicles(detail.vehicles, detail.route.color); renderVehicles();
    renderReplication();
    $('#route-warnings').innerHTML = warning(detail.warnings);
  } catch (error) {
    if (token === operation) $('#route-warnings').innerHTML = warning([`Live refresh failed: ${errorMessage(error)} Showing the last received positions.`]);
  } finally { pollBusy = false; }
}, 15000);

window.setInterval(() => { if (view !== 'agencies') void crawlLive(); }, 60000);

void showRoutes();
