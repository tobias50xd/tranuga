import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef, type MapRef } from '@maplibre/maplibre-react-native';
import type { Feature, LineString, Point } from 'geojson';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accuracyRing, constrainedCenter, overviewZoom, type MapScene } from './map-scene';

const lngLat = (p: { lat: number; lon: number }): [number, number] => [p.lon, p.lat];
const padding = { top: 32, right: 32, bottom: 32, left: 32 };

export default function MapRenderer({ center, lines, stops, annotations, bounds, locked, dark, location, focusPoint, zoomRequest, onPick, onStop }: MapScene) {
  const map = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const zoom = useRef(13);
  const minZoom = bounds && locked && size.width ? overviewZoom(bounds, size.width, size.height, 512) : 0;
  const style = useMemo(() => JSON.stringify({
    version: 8,
    sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#202b25' : '#e8ede4' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: dark ? { 'raster-brightness-max': .48, 'raster-saturation': -.65 } : {} }],
  }), [dark]);
  const lineFeatures = useMemo<Feature<LineString>[]>(() => lines.filter(line => line.points.length > 1).map(line => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: line.points.map(lngLat) },
    properties: { color: line.color, approximate: !!line.approximate },
  })), [lines]);
  const stopFeatures = useMemo<Feature<Point>[]>(() => stops.map(stop => ({
    type: 'Feature', id: stop.id, geometry: { type: 'Point', coordinates: lngLat(stop) }, properties: { id: stop.id },
  })), [stops]);

  useEffect(() => {
    if (!loaded || !size.width) return;
    if (bounds && (bounds[0] !== bounds[2] || bounds[1] !== bounds[3])) camera.current?.fitBounds(bounds, { padding, duration: 0 });
    else if (bounds) camera.current?.jumpTo({ center: [bounds[0], bounds[1]], zoom: 18 });
  }, [bounds, loaded, size]);
  useEffect(() => {
    if (loaded && focusPoint) camera.current?.jumpTo({ center: lngLat(focusPoint), zoom: Math.max(15, zoom.current) });
  }, [focusPoint, loaded]);
  useEffect(() => {
    if (loaded && location) camera.current?.jumpTo({ center: lngLat(location), zoom: Math.max(15, zoom.current) });
  }, [loaded, location]);
  useEffect(() => {
    if (zoomRequest && loaded) camera.current?.zoomTo(Math.min(18, Math.max(minZoom, zoom.current + zoomRequest.delta)), { duration: 0 });
    // A change to the route lock enforces the new bounds without reapplying an earlier button press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, zoomRequest]);
  const enforce = useCallback((lon: number, lat: number, level: number) => {
    if (!bounds || !locked || !size.width) return;
    const nextZoom = Math.max(minZoom, level);
    const next = constrainedCenter({ lon, lat }, bounds, size.width, size.height, 512 * 2 ** nextZoom);
    if (Math.abs(next.lon - lon) + Math.abs(next.lat - lat) > .00001 || nextZoom - level > .01) {
      camera.current?.jumpTo({ center: lngLat(next), zoom: nextZoom });
    }
  }, [bounds, locked, minZoom, size]);
  useEffect(() => {
    if (!loaded || !locked) return;
    let active = true;
    void map.current?.getViewState().then(state => {
      if (active) enforce(state.center[0], state.center[1], state.zoom);
    }).catch(() => {});
    return () => { active = false; };
  }, [enforce, loaded, locked]);
  const accuracy = location ? accuracyRing(location) : [];

  return <Map ref={map} style={{ flex: 1 }} androidView="texture" mapStyle={style} touchRotate={false} touchPitch={false}
    attribution={false}
    onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    }}
    onDidFinishLoadingMap={() => setLoaded(true)}
    onRegionDidChange={({ nativeEvent }) => {
      zoom.current = nativeEvent.zoom;
      enforce(nativeEvent.center[0], nativeEvent.center[1], nativeEvent.zoom);
    }}
    onPress={onPick ? ({ nativeEvent }) => onPick({ lon: nativeEvent.lngLat[0], lat: nativeEvent.lngLat[1] }) : undefined}>
    <Camera ref={camera} initialViewState={{ center: lngLat(center), zoom: 13 }} minZoom={minZoom} maxZoom={18} />
    <GeoJSONSource id="transit-lines" data={{ type: 'FeatureCollection', features: lineFeatures }}>
      <Layer id="solid-lines" type="line" filter={['==', ['get', 'approximate'], false]}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': .95 }} />
      <Layer id="approximate-lines" type="line" filter={['==', ['get', 'approximate'], true]}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [1.6, 2] }} />
    </GeoJSONSource>
    <GeoJSONSource id="transit-stops" data={{ type: 'FeatureCollection', features: stopFeatures }}
      onPress={onStop ? event => {
        const id = event.nativeEvent.features[0]?.properties?.id;
        if (typeof id === 'string') { event.stopPropagation(); onStop(id); }
      } : undefined}>
      <Layer id="stops" type="circle" paint={{ 'circle-color': '#fff', 'circle-stroke-color': '#172822', 'circle-radius': 4, 'circle-stroke-width': 2 }} />
    </GeoJSONSource>
    <GeoJSONSource id="accuracy" data={{ type: 'FeatureCollection', features: accuracy.length
      ? [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [accuracy.map(lngLat)] }, properties: {} }] : [] }}>
      <Layer id="accuracy-fill" type="fill" paint={{ 'fill-color': '#267bea', 'fill-opacity': .18 }} />
    </GeoJSONSource>
    {annotations.map(annotation => <Marker key={annotation.id} id={annotation.id} lngLat={lngLat(annotation.point)}
      onPress={annotation.onPress}>{annotation.content}</Marker>)}
  </Map>;
}
