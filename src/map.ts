import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinate, Network, RouteDetail, Stop, Vehicle } from './types';
import type { Journey } from './planner';
import { escapeHtml as e, safeColor, vehicleAge, headingLabel } from './ui';

export class TransitMap {
  private map: L.Map;
  private routes = L.featureGroup();
  private stops = L.featureGroup();
  private vehicles = L.featureGroup();
  private journey = L.featureGroup();
  private points = L.layerGroup();

  constructor(element: HTMLElement, center: Coordinate, onPick?: (point: Coordinate) => void) {
    // Leaflet 1.9 queues zoom callbacks that can outlive a removed map. Use immediate
    // zooms so navigation can safely destroy a map in the same animation frame.
    this.map = L.map(element, { zoomControl: false, zoomAnimation: false, fadeAnimation: false }).setView([center.lat, center.lon], 14);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.routes.addTo(this.map); this.stops.addTo(this.map); this.vehicles.addTo(this.map);
    this.journey.addTo(this.map); this.points.addTo(this.map);
    this.map.on('click', event => { const point = event.latlng.wrap(); onPick?.({ lat: point.lat, lon: point.lng }); });
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
      const marker = L.circleMarker([stop.lat, stop.lon], { radius: 5, color: '#172721', weight: 2, fillColor: '#fff', fillOpacity: 1 });
      marker.bindTooltip(e(stop.name));
      marker.on('click', () => onStop(stop));
      marker.addTo(this.stops);
    }
    this.showVehicles(detail.vehicles, detail.route.color);
    const bounds = this.routes.getBounds().extend(this.stops.getBounds());
    if (bounds.isValid()) this.map.fitBounds(bounds.pad(.12), { maxZoom: 16, animate: false });
  }

  showVehicles(vehicles: Vehicle[], color: string) {
    this.vehicles.clearLayers();
    for (const bus of vehicles) this.addVehicle(bus, color);
  }

  private addVehicle(bus: Vehicle, color: string, routeName?: string) {
    const stale = !bus.updatedAt || Date.now() - bus.updatedAt > 120000;
    const icon = L.divIcon({ className: 'bus-marker', html: `<span class="bus-pointer ${stale ? 'stale' : ''}" style="--bus-color:${safeColor(color)};--heading:${Number.isFinite(bus.heading) ? bus.heading : 0}deg"><span>↑</span></span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
    L.marker([bus.lat, bus.lon], { icon, title: `Bus ${bus.id}, ${headingLabel(bus.heading)}` })
      .bindPopup(`<strong>Bus ${e(bus.id)}</strong>${routeName ? `<br>${e(routeName)}` : ''}<br>${e(bus.destination || '')}<br>Heading ${e(headingLabel(bus.heading))} · ${Math.round(bus.heading)}°<br>${e(vehicleAge(bus.updatedAt))}${stale ? '<br>Last known position — may be stale' : ''}`)
      .addTo(this.vehicles);
  }

  showPoints(origin?: Coordinate, destination?: Coordinate) {
    this.points.clearLayers();
    for (const [point, label, color] of [[origin, 'A', '#172721'], [destination, 'B', '#b92535']] as const) {
      if (point) L.marker([point.lat, point.lon], { icon: L.divIcon({ className: 'point-marker', html: `<span style="background:${color}">${label}</span>`, iconSize: [30, 36], iconAnchor: [15, 36] }) }).addTo(this.points);
    }
  }

  showJourney(journey: Journey, network: Network) {
    this.journey.clearLayers(); this.routes.clearLayers(); this.stops.clearLayers(); this.vehicles.clearLayers();
    const routeById = new Map(network.routes.map(route => [route.id, route]));
    const rides = journey.legs.filter(leg => leg.kind === 'ride');
    const usedRouteIds = new Set(rides.map(leg => leg.routeId));
    const shownPatterns = new Set<string>(), drawnRideKeys = new Set<string>();
    for (const ride of rides) {
      const route = routeById.get(ride.routeId), color = safeColor(route?.color ?? '#b92535');
      for (const pattern of network.patterns.filter(candidate => candidate.routeId === ride.routeId && candidate.direction === ride.direction)) {
        if (shownPatterns.has(pattern.id)) continue;
        shownPatterns.add(pattern.id);
        const lines = pattern.shapeSegments?.length ? pattern.shapeSegments : [pattern.shape.length > 1 ? pattern.shape : pattern.stops];
        for (const line of lines) if (line.length > 1) {
          L.polyline(line.map(point => [point.lat, point.lon]), {
            color, weight: 6, opacity: .72, dashArray: pattern.shape.length > 1 || pattern.shapeSegments?.length ? undefined : '7,8',
          }).bindTooltip(e(route?.name ?? ride.routeName)).addTo(this.routes);
          drawnRideKeys.add(`${ride.routeId}\0${ride.direction}`);
        }
      }
      for (const stop of [ride.stops[0], ride.stops.at(-1)]) if (stop) {
        L.circleMarker([stop.lat, stop.lon], { radius: 5, color, weight: 3, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(e(stop.name)).addTo(this.stops);
      }
    }
    for (const leg of journey.legs) {
      if (leg.kind === 'wait') continue;
      if (leg.kind === 'ride' && drawnRideKeys.has(`${leg.routeId}\0${leg.direction}`)) continue;
      const points = leg.kind === 'ride' ? leg.stops : [leg.from, leg.to];
      L.polyline(points.map(point => [point.lat, point.lon]), {
        color: leg.kind === 'ride' ? safeColor(routeById.get(leg.routeId)?.color ?? '#b92535') : '#52625a',
        weight: leg.kind === 'ride' ? 6 : 3,
        dashArray: leg.kind === 'walk' ? '5,7' : undefined,
      }).addTo(this.journey);
    }
    for (const bus of network.vehicles.filter(vehicle => usedRouteIds.has(vehicle.routeId))) {
      const route = routeById.get(bus.routeId); this.addVehicle(bus, route?.color ?? '#b92535', route?.name);
    }
    const bounds = this.routes.getBounds().extend(this.journey.getBounds()).extend(this.stops.getBounds()).extend(this.vehicles.getBounds());
    if (bounds.isValid()) this.map.fitBounds(bounds.pad(.15), { maxZoom: 17, animate: false });
  }

  focus(point: Coordinate) { this.map.setView([point.lat, point.lon], 15, { animate: false }); }
  clearJourney() { this.journey.clearLayers(); }
  destroy() { this.map.remove(); }
}
