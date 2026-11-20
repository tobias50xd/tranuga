import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinate, Route, RouteDetail, Stop, Vehicle } from './types';
import type { Journey, RideLeg } from './planner';
import { escapeHtml as e, safeColor, vehicleAge, headingLabel } from './ui';
import { routeViewportBounds } from './route-viewport';
import { journeyTransfers } from './journey-map';
import { VehicleMotion } from './vehicle-motion';
import { uniqueVehicles, vehicleIsStale } from './vehicle-selection';
import { getCurrentLocation } from './location';
export const VEHICLE_REFRESH_MS = 15_000;
interface BusMarker { marker: L.Marker; motion: VehicleMotion }

export class TransitMap {
  private map: L.Map;
  private routes = L.featureGroup();
  private stops = L.featureGroup();
  private selectedStop = L.layerGroup();
  private vehicles = L.featureGroup();
  private journey = L.featureGroup();
  private points = L.layerGroup();
  private userLocation = L.layerGroup();
  private locationButton!: HTMLButtonElement;
  private locationStatus!: HTMLDivElement;
  private locating = false;
  private routeLocked: boolean;
  private routeBounds?: L.LatLngBounds;
  private applyingLock = false;
  private busMarkers = new Map<string, BusMarker>();
  private frame?: number;
  private lifetime = new AbortController();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(element: HTMLElement, center: Coordinate, onPick?: (point: Coordinate) => void, routeLocked = false, private onRouteLockChange?: (locked: boolean) => void) {
    this.routeLocked = routeLocked;
    // Leaflet 1.9 queues zoom callbacks that can outlive a removed map. Use immediate
    // zooms so navigation can safely destroy a map in the same animation frame.
    this.map = L.map(element, { zoomControl: false, zoomAnimation: false, fadeAnimation: false, zoomSnap: .25, maxBoundsViscosity: 1, bounceAtZoomLimits: false }).setView([center.lat, center.lon], 14);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.routes.addTo(this.map); this.stops.addTo(this.map); this.vehicles.addTo(this.map);
    this.journey.addTo(this.map); this.points.addTo(this.map); this.selectedStop.addTo(this.map);
    this.userLocation.addTo(this.map); this.addLocationControl();
    this.map.on('click', event => { onPick?.({ lat: event.latlng.wrap().lat, lon: event.latlng.wrap().lng }); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finishMotion(); }, { signal:this.lifetime.signal });
    this.map.on('resize zoomend', () => this.updateRouteLock());
  }

  setRouteLocked(locked: boolean) { this.routeLocked = locked; this.updateRouteLock(); }

  private addLocationControl() {
    const control = new L.Control({position:'bottomright'});
    control.onAdd = () => {
      const container = L.DomUtil.create('div','leaflet-bar map-locate-control');
      this.locationButton = document.createElement('button');
      this.locationButton.type='button'; this.locationButton.className='map-locate-button';
      this.locationButton.title='Show my location'; this.locationButton.setAttribute('aria-label','Show my location');
      this.locationButton.setAttribute('aria-busy','false');
      this.locationButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
      this.locationStatus=document.createElement('div'); this.locationStatus.className='map-location-status';
      this.locationStatus.setAttribute('role','status'); this.locationStatus.setAttribute('aria-live','polite'); this.locationStatus.hidden=true;
      container.append(this.locationButton,this.locationStatus);
      L.DomEvent.disableClickPropagation(container); L.DomEvent.disableScrollPropagation(container);
      L.DomEvent.on(container,'keydown',L.DomEvent.stopPropagation);
      this.locationButton.addEventListener('click',()=>void this.locate(),{signal:this.lifetime.signal});
      return container;
    };
    control.addTo(this.map);
  }

  private locationMessage(message: string, error = false) {
    this.locationStatus.hidden=false; this.locationStatus.textContent=message;
    this.locationStatus.setAttribute('role',error?'alert':'status');
    this.locationStatus.setAttribute('aria-live',error?'assertive':'polite');
    this.locationStatus.classList.toggle('is-error',error);
  }

  private async locate() {
    if (this.locating || this.lifetime.signal.aborted) return;
    this.locating=true; this.locationButton.disabled=true; this.locationButton.setAttribute('aria-busy','true');
    this.locationMessage('Finding your location…');
    try {
      const location=await getCurrentLocation();
      if (this.lifetime.signal.aborted) return;
      const target=L.latLng(location.lat,location.lon), zoom=Math.min(this.map.getMaxZoom(),Math.max(16,this.map.getZoom()));
      this.map.setView(target,zoom,{animate:false});
      let unlocked=false;
      // Route bounds may clamp a requested center. The explicit location action takes priority.
      if (this.routeLocked && this.map.latLngToContainerPoint(target).distanceTo(this.map.getSize().divideBy(2))>1) {
        this.setRouteLocked(false); this.onRouteLockChange?.(false); unlocked=true;
        this.map.setView(target,zoom,{animate:false});
      }
      this.userLocation.clearLayers();
      const accuracy=location.accuracy===undefined?'':` · Accuracy ±${Math.round(location.accuracy)} m`;
      if (location.accuracy!==undefined) L.circle(target,{radius:location.accuracy,color:'#1a73e8',weight:1,fillColor:'#1a73e8',fillOpacity:.12,interactive:false,className:'user-location-accuracy'}).addTo(this.userLocation);
      const marker=L.marker(target,{title:'Your location',zIndexOffset:1500,icon:L.divIcon({className:'user-location-marker',html:'<span aria-hidden="true"></span>',iconSize:[20,20],iconAnchor:[10,10]})});
      marker.bindPopup(`<strong>Your location</strong>${e(accuracy)}<br>Last requested position`).addTo(this.userLocation);
      marker.getElement()?.setAttribute('aria-label','Your location');
      this.locationMessage(`Centered on your location${accuracy}.${unlocked?' Route lock turned off to center here.':''}`);
    } catch (error) {
      if (!this.lifetime.signal.aborted) this.locationMessage(error instanceof Error?error.message:'Could not determine your location. Try again.',true);
    } finally {
      this.locating=false;
      if (!this.lifetime.signal.aborted) { this.locationButton.disabled=false; this.locationButton.setAttribute('aria-busy','false'); }
    }
  }

  private updateRouteLock() {
    if (this.applyingLock) return;
    this.applyingLock = true;
    try {
      this.map.setMaxBounds(L.latLngBounds([]));
      if (!this.routeLocked || !this.routeBounds?.isValid()) { this.map.setMinZoom(0); return; }
      const minimum = Math.min(this.map.getMaxZoom(), this.map.getBoundsZoom(this.routeBounds, false, L.point(48, 48)));
      this.map.setMinZoom(minimum);
      const zoom = this.map.getZoom();
      const projected = L.bounds(this.map.project(this.routeBounds.getNorthWest(), zoom), this.map.project(this.routeBounds.getSouthEast(), zoom));
      const limit = routeViewportBounds({min:projected.min!,max:projected.max!}, this.map.getSize());
      const bounds = L.latLngBounds(this.map.unproject(L.point(limit.min.x,limit.min.y),zoom), this.map.unproject(L.point(limit.max.x,limit.max.y),zoom));
      this.map.setMaxBounds(bounds);
      this.map.panInsideBounds(bounds, {animate:false});
    } finally { this.applyingLock = false; }
  }

  private fitRoute(bounds: L.LatLngBounds) {
    this.routeBounds = bounds.isValid() ? bounds : undefined;
    this.applyingLock = true;
    try {
      this.map.setMaxBounds(L.latLngBounds([])); this.map.setMinZoom(0);
      if (this.routeBounds) this.map.fitBounds(bounds, {padding:[24,24],maxZoom:this.map.getMaxZoom(),animate:false});
    } finally { this.applyingLock = false; }
    this.updateRouteLock();
  }

  showRoute(detail: RouteDetail, onStop: (stop: Stop) => void, direction?: string) {
    this.routes.clearLayers(); this.stops.clearLayers(); this.selectedStop.clearLayers(); this.journey.clearLayers();
    const patterns = detail.patterns.filter(pattern => !direction || pattern.id === direction);
    for (const pattern of patterns) {
      const segments = pattern.shapeSegments?.length ? pattern.shapeSegments : [pattern.shape.length > 1 ? pattern.shape : pattern.stops];
      for (const shape of segments) if (shape.length > 1) L.polyline(shape.map(p => [p.lat, p.lon]), { color: safeColor(detail.route.color), weight: 6, opacity: .9, dashArray: pattern.shape.length > 1 || pattern.shapeSegments?.length ? undefined : '6,8' }).addTo(this.routes);
    }
    const visibleStops = direction ? [...new Map(patterns.flatMap(p => p.stops).map(s => [s.id, s])).values()] : detail.stops;
    for (const stop of visibleStops) {
      const marker = L.circleMarker([stop.lat, stop.lon], { radius: 5, color: '#172721', weight: 2, fillColor: '#fff', fillOpacity: 1, className: 'route-stop-marker' });
      marker.bindTooltip(e(stop.name));
      marker.on('click', () => onStop(stop));
      marker.addTo(this.stops);
    }
    this.showVehicles(detail.vehicles, detail.route.color);
    const bounds = this.routes.getBounds().extend(this.stops.getBounds());
    this.fitRoute(bounds);
  }

  selectStop(stop: Stop) {
    this.selectedStop.clearLayers();
    const position: L.LatLngExpression = [stop.lat, stop.lon];
    L.circleMarker(position, { radius: 13, color: '#7fbdff', weight: 2, fillColor: '#3388ee', fillOpacity: .28, interactive: false, className: 'selected-stop-halo' }).addTo(this.selectedStop);
    L.circleMarker(position, { radius: 7, color: '#fff', weight: 2, fillColor: '#1d66cc', fillOpacity: 1, interactive: false, className: 'selected-stop-dot' }).addTo(this.selectedStop);
    this.focus(stop);
  }

  showVehicles(vehicles: Vehicle[], color: string) { this.syncVehicles(vehicles, () => color); }

  private syncVehicles(vehicles: Vehicle[], color: (bus: Vehicle) => string, name: (bus: Vehicle) => string | undefined = () => undefined) {
    const now=Date.now(), present=new Set<string>();
    for (const bus of uniqueVehicles(vehicles)) {
      const key=bus.id; present.add(key);
      let state=this.busMarkers.get(key);
      if (!state) {
        state={marker:L.marker([bus.lat,bus.lon],{icon:L.divIcon({className:'bus-marker',iconSize:[26,26],iconAnchor:[13,13]})}).addTo(this.vehicles),motion:new VehicleMotion(bus, VEHICLE_REFRESH_MS)};
        this.busMarkers.set(key,state);
      } else state.motion.update(bus,now,this.reducedMotion.matches || document.hidden);
      const latest=state.motion.latest, stale=vehicleIsStale(latest,now);
      state.marker.setIcon(L.divIcon({
        className: 'bus-marker', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<span class="bus-pointer ${stale ? 'stale' : ''}" style="--bus-color:${safeColor(color(latest))}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M12 3 20 19 12 15.2 4 19Z"/></svg></span>`,
      }));
      state.marker.getElement()?.setAttribute('aria-label',`Bus ${latest.id}, ${headingLabel(latest.heading)}`);
      const routeName=name(latest);
      const popup=`<strong>Bus ${e(latest.id)}</strong>${routeName?`<br>${e(routeName)}`:''}<br>${e(latest.destination||'')}<br>Heading ${e(headingLabel(latest.heading))} · ${Math.round(latest.heading)}°<br>${e(vehicleAge(latest.updatedAt))}${stale?'<br>Last known position — may be stale':''}`;
      if (state.marker.getPopup()) state.marker.setPopupContent(popup); else state.marker.bindPopup(popup);
      this.placeBus(state,now);
    }
    for (const [key,state] of this.busMarkers) if (!present.has(key)) { this.vehicles.removeLayer(state.marker); this.busMarkers.delete(key); }
    this.animateVehicles();
  }
  private placeBus(state: BusMarker, now: number) {
    const point = state.motion.sample(now);
    const coordinate = L.latLng(point.lat, point.lon);
    state.marker.setLatLng(coordinate);
    const icon = state.marker.getElement();
    if (!icon) return;
    // Leaflet rounds marker positions to pixels. Keep the fractional position for slow movement at low zoom.
    L.DomUtil.setPosition(icon, this.map.project(coordinate).subtract(this.map.getPixelOrigin()));
    icon.querySelector<HTMLElement>('.bus-pointer')?.style.setProperty('--heading', `${point.heading}deg`);
  }
  private animateVehicles() {
    if (this.frame!==undefined || document.hidden || ![...this.busMarkers.values()].some(state=>state.motion.moving(Date.now()))) return;
    const tick=() => {
      this.frame=undefined;
      if (this.lifetime.signal.aborted) return;
      if (this.reducedMotion.matches || document.hidden) { this.finishMotion(); return; }
      const now=Date.now();
      for (const state of this.busMarkers.values()) this.placeBus(state,now);
      this.animateVehicles();
    };
    this.frame=requestAnimationFrame(tick);
  }
  private finishMotion() {
    if (this.frame!==undefined) cancelAnimationFrame(this.frame); this.frame=undefined;
    for (const state of this.busMarkers.values()) { state.motion.finish(); this.placeBus(state,Date.now()); }
  }
  private clearVehicles() {
    if (this.frame!==undefined) cancelAnimationFrame(this.frame); this.frame=undefined;
    this.busMarkers.clear(); this.vehicles.clearLayers();
  }
  showJourneyVehicles(vehicles: Vehicle[], routes: ReadonlyMap<string, Route>) {
    this.syncVehicles(vehicles, bus => routes.get(bus.routeId)?.color || '#b92535', bus => routes.get(bus.routeId)?.name);
  }

  showPoints(origin?: Coordinate, destination?: Coordinate) {
    this.points.clearLayers();
    for (const [point, label, color] of [[origin, 'A', '#172721'], [destination, 'B', '#b92535']] as const) {
      if (point) L.marker([point.lat, point.lon], { icon: L.divIcon({ className: 'point-marker', html: `<span style="background:${color}">${label}</span>`, iconSize: [30, 36], iconAnchor: [15, 36] }) }).addTo(this.points);
    }
  }

  showJourney(journey: Journey, routes: ReadonlyMap<string, Route>, geometry: ReadonlyMap<RideLeg, Coordinate[][]>) {
    this.journey.clearLayers(); this.routes.clearLayers(); this.stops.clearLayers();
    for (const leg of journey.legs) {
      if (leg.kind==='wait') continue;
      if (leg.kind==='walk') {
        L.polyline([[leg.from.lat,leg.from.lon],[leg.to.lat,leg.to.lon]],{color:'#718477',weight:3,dashArray:'5,7',className:'journey-walk'}).addTo(this.journey);
        continue;
      }
      const color=safeColor(routes.get(leg.routeId)?.color||'#b92535');
      for (const segment of geometry.get(leg) ?? []) {
        const line=L.polyline(segment.map(point=>[point.lat,point.lon]),{color,weight:6,opacity:.9,className:'journey-ride'}).bindTooltip(e(leg.routeName)).addTo(this.routes);
        line.getElement()?.setAttribute('data-route-id',leg.routeId);
      }
      for (const stop of [leg.stops[0],leg.stops.at(-1)]) if (stop) L.circleMarker([stop.lat,stop.lon],{radius:5,color,weight:3,fillColor:'#fff',fillOpacity:1}).bindTooltip(e(stop.name)).addTo(this.stops);
    }
    for (const transfer of journeyTransfers(journey)) {
      const stops=transfer.from.id===transfer.to.id?[transfer.to]:[transfer.from,transfer.to];
      for (const stop of stops) L.marker([stop.lat,stop.lon],{
        icon:L.divIcon({className:'transfer-marker',html:`<span aria-hidden="true">↔<small>${transfer.index}</small></span>`,iconSize:[34,34],iconAnchor:[17,17]}),
        title:`Transfer ${transfer.index}: ${stop.name} · ${transfer.fromRoute} → ${transfer.toRoute}`,zIndexOffset:1000,
      }).bindTooltip(e(`Transfer ${transfer.index} · ${stop.name} · ${transfer.fromRoute} → ${transfer.toRoute}`)).addTo(this.stops);
    }
    // Nearby buses on the used lines must not widen the selected journey's camera.
    const bounds=this.routes.getBounds().extend(this.journey.getBounds()).extend(this.stops.getBounds());
    this.fitRoute(bounds);
  }

  focus(point: Coordinate) { this.map.setView([point.lat, point.lon], 15, { animate: false }); }
  clearJourney() { this.journey.clearLayers(); this.routes.clearLayers(); this.stops.clearLayers(); this.clearVehicles(); this.routeBounds=undefined; this.updateRouteLock(); }
  destroy() { this.lifetime.abort(); this.clearVehicles(); this.map.remove(); }
}
