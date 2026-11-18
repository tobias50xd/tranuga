import { circleMarker, divIcon, layerGroup, map, marker, polygon, polyline, tileLayer, type LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../../../src/types';
import { accuracyRing, constrainedCenter, overviewZoom, type MapScene } from './map-scene';

const latLng = (p: Coordinate): [number, number] => [p.lat, p.lon];
const markerIcon = (element: HTMLElement) => divIcon({ html: element, className: 'transit-map-annotation', iconAnchor: [14, 14], iconSize: [28, 28] });

export default function MapRenderer(scene: MapScene) {
  const { center, lines, stops, annotations, bounds, locked, dark, location, focusPoint, zoomRequest } = scene;
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<ReturnType<typeof map> | null>(null);
  const tiles = useRef<ReturnType<typeof tileLayer> | null>(null);
  const markers = useRef(new Map<string, { node: HTMLElement; layer: ReturnType<typeof marker> }>());
  const [nodes, setNodes] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const handlers = useRef(scene);
  useEffect(() => { handlers.current = scene; }, [scene]);

  useEffect(() => {
    if (!container.current) return;
    const view = map(container.current, { zoomControl: false, attributionControl: false, maxZoom: 18, zoomSnap: 0 })
      .setView(latLng(center), 14);
    const activeMarkers = markers.current;
    const tile = tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(view);
    instance.current = view;
    tiles.current = tile;
    const resize = new ResizeObserver(() => view.invalidateSize({ pan: false }));
    resize.observe(container.current);
    const pick = (event: LeafletMouseEvent) => handlers.current.onPick?.({ lat: event.latlng.lat, lon: event.latlng.lng });
    view.on('click', pick);
    return () => {
      resize.disconnect();
      activeMarkers.clear();
      view.remove();
      instance.current = null;
    };
  }, [center]);

  useEffect(() => {
    const view = instance.current;
    if (!view) return;
    const geometry = layerGroup().addTo(view);
    for (const line of lines) if (line.points.length > 1) polyline(line.points.map(latLng), {
      color: line.color, weight: line.approximate ? 4 : 5, opacity: .95,
      dashArray: line.approximate ? '6,8' : undefined, interactive: false,
    }).addTo(geometry);
    for (const stop of stops) {
      const dot = circleMarker(latLng(stop), { radius: 4, color: '#172822', weight: 2, fillColor: '#fff', fillOpacity: 1, bubblingMouseEvents: false }).addTo(geometry);
      const label = document.createElement('span');
      label.textContent = stop.name;
      dot.bindTooltip(label);
      dot.on('click', () => handlers.current.onStop?.(stop.id));
    }
    return () => { geometry.remove(); };
  }, [center, lines, stops]);

  useEffect(() => {
    const view = instance.current;
    if (!view || !bounds) return;
    view.setMinZoom(0);
    const [west, south, east, north] = bounds;
    if (west === east && south === north) view.setView([south, west], 18, { animate: false });
    else view.fitBounds([[south, west], [north, east]], { padding: [32, 32], animate: false });
  }, [bounds, center]);

  useEffect(() => {
    const view = instance.current;
    if (!view) return;
    function enforce() {
      if (!view || !bounds) return;
      const { x: width, y: height } = view.getSize();
      const minimum = overviewZoom(bounds, width, height, 256);
      view.setMinZoom(minimum);
      const zoom = Math.max(view.getZoom(), minimum);
      const previous = view.getCenter();
      const next = constrainedCenter({ lat: previous.lat, lon: previous.lng }, bounds, width, height, 256 * 2 ** zoom);
      if (Math.abs(next.lat - previous.lat) + Math.abs(next.lon - previous.lng) > .00001) view.setView(latLng(next), zoom, { animate: false });
    }
    if (locked && bounds) {
      enforce();
      view.on('moveend resize', enforce);
    } else view.setMinZoom(0);
    return () => { view.off('moveend resize', enforce); };
  }, [bounds, center, locked]);

  useEffect(() => {
    const view = instance.current;
    if (view && focusPoint) view.setView(latLng(focusPoint), Math.max(16, view.getZoom()), { animate: false });
  }, [center, focusPoint]);

  useEffect(() => {
    const view = instance.current;
    if (!view || !location) return;
    view.setView(latLng(location), Math.max(16, view.getZoom()), { animate: false });
    const ring = polygon(accuracyRing(location).map(latLng), { color: '#267bea', weight: 1, fillOpacity: .18, interactive: false }).addTo(view);
    return () => { ring.remove(); };
  }, [center, location]);

  useEffect(() => {
    if (zoomRequest) instance.current?.zoomIn(zoomRequest.delta, { animate: false });
  }, [zoomRequest]);

  useEffect(() => {
    const element = tiles.current?.getContainer();
    if (element) element.style.filter = dark ? 'brightness(.48) saturate(.35)' : '';
  }, [center, dark]);

  useEffect(() => {
    const view = instance.current;
    if (!view) return;
    let changed = false;
    const ids = new Set(annotations.map(annotation => annotation.id));
    for (const [id, entry] of markers.current) if (!ids.has(id)) {
      entry.layer.remove(); markers.current.delete(id); changed = true;
    }
    for (const annotation of annotations) {
      const entry = markers.current.get(annotation.id);
      if (entry) {
        const previous = entry.layer.getLatLng();
        if (previous.lat !== annotation.point.lat || previous.lng !== annotation.point.lon) entry.layer.setLatLng(latLng(annotation.point));
        const element = entry.layer.getElement();
        if (element && element.title !== annotation.label) element.title = annotation.label;
        continue;
      }
      const node = document.createElement('div');
      const layer = marker(latLng(annotation.point), {
        icon: markerIcon(node), title: annotation.label, keyboard: !!annotation.onPress, interactive: !!annotation.onPress,
      }).addTo(view);
      layer.on('click', () => handlers.current.annotations.find(item => item.id === annotation.id)?.onPress?.());
      markers.current.set(annotation.id, { node, layer });
      changed = true;
    }
    if (changed || nodes.size !== markers.current.size) setNodes(new Map([...markers.current].map(([id, entry]) => [id, entry.node])));
  }, [annotations, center, nodes.size]);

  return <div ref={container} role="region" aria-label="Transit map" style={{ width: '100%', height: '100%', background: dark ? '#202b25' : '#e8ede4' }}>
    {annotations.map(item => {
      const node = nodes.get(item.id);
      return node ? createPortal(item.content, node, item.id) : null;
    })}
  </div>;
}
