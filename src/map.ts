import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinate, Network, RouteDetail, Stop, Vehicle } from './types';
import type { Journey } from './planner';
import { escapeHtml as e, safeColor, vehicleAge, headingLabel } from './ui';
import { ATHENS_BOUNDS, inAthens } from './athens';
import { rideGeometry, journeyTransfers } from './journey-map';
import { VehicleMotion } from './vehicle-motion';
interface BusMarker { marker: L.Marker; motion: VehicleMotion }

export class TransitMap {
  private map: L.Map;
  private routes = L.featureGroup();
  private stops = L.featureGroup();
  private vehicles = L.featureGroup();
  private journey = L.featureGroup();
  private points = L.layerGroup();
  private athensLocked: boolean;
  private busMarkers = new Map<string, BusMarker>();
  private frame?: number;
  private lifetime = new AbortController();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(element: HTMLElement, center: Coordinate, onPick?: (point: Coordinate) => void, athensLocked = false) {
    this.athensLocked = athensLocked;
    // Leaflet 1.9 queues zoom callbacks that can outlive a removed map. Use immediate
    // zooms so navigation can safely destroy a map in the same animation frame.
    this.map = L.map(element, { zoomControl: false, zoomAnimation: false, fadeAnimation: false, zoomSnap: .25, maxBoundsViscosity: 1, bounceAtZoomLimits: !athensLocked }).setView([center.lat, center.lon], 14);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.routes.addTo(this.map); this.stops.addTo(this.map); this.vehicles.addTo(this.map);
    this.journey.addTo(this.map); this.points.addTo(this.map);
    this.map.on('click', event => { const point = { lat: event.latlng.wrap().lat, lon: event.latlng.wrap().lng }; if (!this.athensLocked || inAthens(point)) onPick?.(point); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.finishMotion(); }, { signal:this.lifetime.signal });
    if (this.athensLocked) {
      const bounds = L.latLngBounds([ATHENS_BOUNDS.south, ATHENS_BOUNDS.west], [ATHENS_BOUNDS.north, ATHENS_BOUNDS.east]);
      const restrict = () => {
        this.map.setMinZoom(0);
        const minimum = this.map.getBoundsZoom(bounds, false, L.point(24, 24));
        this.map.setMinZoom(minimum); this.map.setMaxBounds(bounds);
        // At the overview scale, center the entire city rather than its last focused stop.
        if (this.map.getZoom() <= minimum) this.map.setView(bounds.getCenter(), minimum, { animate: false });
      };
      this.map.on('resize', restrict);
      this.map.on('zoomend', () => { if (this.map.getZoom() <= this.map.getMinZoom()) this.map.panTo(bounds.getCenter(), { animate: false }); });
      restrict();
    }
  }

  showRoute(detail: RouteDetail, onStop: (stop: Stop) => void, direction?: string) {
    this.routes.clearLayers(); this.stops.clearLayers(); this.journey.clearLayers();
    const patterns = detail.patterns.filter(pattern => !direction || pattern.id === direction);
    for (const pattern of patterns) {
      const segments = pattern.shapeSegments?.length ? pattern.shapeSegments : [pattern.shape.length > 1 ? pattern.shape : pattern.stops];
      for (const shape of segments) if (shape.length > 1) L.polyline(shape.map(p => [p.lat, p.lon]), { color: safeColor(detail.route.color), weight: 6, opacity: .9, dashArray: pattern.shape.length > 1 || pattern.shapeSegments?.length ? undefined : '6,8' }).addTo(this.routes);
    }
    const visibleStops = direction ? [...new Map(patterns.flatMap(p => p.stops).map(s => [s.id, s])).values()] : detail.stops;
    for (const stop of visibleStops) {
      if (this.athensLocked && !inAthens(stop)) continue;
      const marker = L.circleMarker([stop.lat, stop.lon], { radius: 5, color: '#172721', weight: 2, fillColor: '#fff', fillOpacity: 1 });
      marker.bindTooltip(e(stop.name));
      marker.on('click', () => onStop(stop));
      marker.addTo(this.stops);
    }
    this.showVehicles(detail.vehicles, detail.route.color);
    const bounds = this.routes.getBounds().extend(this.stops.getBounds());
    if (bounds.isValid()) this.map.fitBounds(bounds.pad(.12), { maxZoom: 16, animate: false });
  }

  showVehicles(vehicles: Vehicle[], color: string) { this.syncVehicles(vehicles, () => color); }

  private syncVehicles(vehicles: Vehicle[], color: (bus: Vehicle) => string, name: (bus: Vehicle) => string | undefined = () => undefined) {
    const now=Date.now(), present=new Set<string>();
    for (const bus of vehicles) {
      if (this.athensLocked && !inAthens(bus)) continue;
      const key=JSON.stringify([bus.routeId,bus.id]); present.add(key);
      let state=this.busMarkers.get(key);
      if (!state) {
        state={marker:L.marker([bus.lat,bus.lon],{icon:L.divIcon({className:'bus-marker',iconSize:[34,34],iconAnchor:[17,17]})}).addTo(this.vehicles),motion:new VehicleMotion(bus)};
        this.busMarkers.set(key,state);
      } else state.motion.update(bus,now,this.reducedMotion.matches || document.hidden);
      const latest=state.motion.latest, stale=!latest.updatedAt || now-latest.updatedAt>120000;
      state.marker.setIcon(L.divIcon({className:'bus-marker',html:`<span class="bus-pointer ${stale?'stale':''}" style="--bus-color:${safeColor(color(latest))};--heading:${Number.isFinite(latest.heading)?latest.heading:0}deg"><span>↑</span></span>`,iconSize:[34,34],iconAnchor:[17,17]}));
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
    const point=state.motion.sample(now); state.marker.setLatLng([point.lat,point.lon]);
    state.marker.getElement()?.querySelector<HTMLElement>('.bus-pointer')?.style.setProperty('--heading',`${point.heading}deg`);
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
  showJourneyVehicles(journey: Journey, network: Network) {
    const ids=new Set(journey.legs.filter(leg=>leg.kind==='ride').map(leg=>leg.routeId));
    const routes=new Map(network.routes.map(route=>[route.id,route]));
    this.syncVehicles(network.vehicles.filter(bus=>ids.has(bus.routeId)),bus=>routes.get(bus.routeId)?.color||'#b92535',bus=>routes.get(bus.routeId)?.name);
  }

  showPoints(origin?: Coordinate, destination?: Coordinate) {
    this.points.clearLayers();
    for (const [point, label, color] of [[origin, 'A', '#172721'], [destination, 'B', '#b92535']] as const) {
      if (point && (!this.athensLocked || inAthens(point))) L.marker([point.lat, point.lon], { icon: L.divIcon({ className: 'point-marker', html: `<span style="background:${color}">${label}</span>`, iconSize: [30, 36], iconAnchor: [15, 36] }) }).addTo(this.points);
    }
  }

  showJourney(journey: Journey, network: Network) {
    this.journey.clearLayers(); this.routes.clearLayers(); this.stops.clearLayers();
    const routeById=new Map(network.routes.map(route=>[route.id,route]));
    for (const leg of journey.legs) {
      if (leg.kind==='wait') continue;
      if (leg.kind==='walk') {
        L.polyline([[leg.from.lat,leg.from.lon],[leg.to.lat,leg.to.lon]],{color:'#718477',weight:3,dashArray:'5,7',className:'journey-walk'}).addTo(this.journey);
        continue;
      }
      const color=safeColor(routeById.get(leg.routeId)?.color||'#b92535');
      const geometry=rideGeometry(leg,network);
      for (const segment of geometry.segments) {
        const line=L.polyline(segment.map(point=>[point.lat,point.lon]),{color,weight:6,opacity:.9,dashArray:geometry.approximate?'7,8':undefined,className:'journey-ride'}).bindTooltip(e(leg.routeName)).addTo(this.routes);
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
    this.showJourneyVehicles(journey,network);
    // Nearby buses on the used lines must not widen the selected journey's camera.
    const bounds=this.routes.getBounds().extend(this.journey.getBounds()).extend(this.stops.getBounds());
    if (bounds.isValid()) this.map.fitBounds(bounds.pad(.15),{maxZoom:17,animate:false});
  }

  focus(point: Coordinate) { if (!this.athensLocked || inAthens(point)) this.map.setView([point.lat, point.lon], 15, { animate: false }); }
  clearJourney() { this.journey.clearLayers(); this.routes.clearLayers(); this.stops.clearLayers(); this.clearVehicles(); }
  destroy() { this.lifetime.abort(); this.clearVehicles(); this.map.remove(); }
}
