import type { Coordinate, Network, RouteDetail, RoutePattern, Stop } from './types';
import type { Journey, RideLeg } from './planner';
import { distanceMeters } from './planner';

interface Edge { a: Coordinate; b: Coordinate; start: number; end: number; part: number }
interface Projection { along: number; away: number }
interface Match { along: number; first: number; cost: number; previous?: Match }
export interface RideGeometry { segments: Coordinate[][]; approximate: boolean }
const interpolate = (a: Coordinate,b: Coordinate,t: number): Coordinate => ({ lat:a.lat+(b.lat-a.lat)*t, lon:a.lon+(b.lon-a.lon)*t });
function stopProjections(point: Coordinate, edges: Edge[]): Projection[] {
  const cos=Math.cos(point.lat*Math.PI/180), scale=111195;
  const nearby: Projection[] = [];
  for (const edge of edges) {
    const ax=(edge.a.lon-point.lon)*cos*scale,ay=(edge.a.lat-point.lat)*scale;
    const dx=(edge.b.lon-edge.a.lon)*cos*scale,dy=(edge.b.lat-edge.a.lat)*scale;
    const ratio=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    const away=Math.hypot(ax+ratio*dx,ay+ratio*dy);
    if (away <= 100) nearby.push({ along: edge.start + (edge.end - edge.start) * ratio, away });
  }
  const visits: Projection[] = [];
  for (const candidate of nearby.sort((a, b) => a.away - b.away)) {
    if (visits.some(visit => Math.abs(visit.along - candidate.along) < 15)) continue;
    visits.push(candidate);
    if (visits.length === 12) break;
  }
  return visits;
}
function visits(pattern: RoutePattern) { return pattern.stops.length>2 && pattern.stops[0].id===pattern.stops.at(-1)!.id ? pattern.stops.slice(0,-1) : pattern.stops; }
function boardingIndex(pattern: RoutePattern, ride: RideLeg): number | undefined {
  const stops=visits(pattern), loop=pattern.loop===true || stops.length!==pattern.stops.length;
  const matches=(at: number) => at>=0 && at<stops.length && (loop || at+ride.stops.length<=stops.length) && ride.stops.every((stop,i)=>stops[(at+i)%stops.length]?.id===stop.id);
  if (ride.boardingIndex!==undefined) return matches(ride.boardingIndex)?ride.boardingIndex:undefined;
  const options=stops.flatMap((_stop,i)=>matches(i)?[i]:[]);
  return options.length===1?options[0]:undefined;
}

function validTraceStep(along: number, straight: number) {
  return along >= straight * .8 && along <= Math.max(2_000, straight * 6);
}

/** The nearest point can belong to another pass through the same street. Match the ordered visits together. */
function matchTrace(stops: readonly Stop[], projections: Projection[][], loopLength: number): number[] | undefined {
  let matches: Match[] = projections[0].map(({ along, away }) => ({ along, first: along, cost: away }));
  for (let index = 1; index < stops.length && matches.length; index++) {
    const straight = distanceMeters(stops[index - 1], stops[index]);
    const positions = projections[index];
    const candidates = loopLength ? [...positions, ...positions.map(p => ({ ...p, along: p.along + loopLength }))] : positions;
    matches = candidates.flatMap(({ along, away }) => {
      let best: Match | undefined;
      for (const previous of matches) {
        const progress = along - previous.along;
        if (!validTraceStep(progress, straight) || loopLength && along - previous.first > loopLength) continue;
        const cost = previous.cost + away + progress * .01;
        if (!best || cost < best.cost) best = { along, cost, first: previous.first, previous };
      }
      return best ? [best] : [];
    });
  }
  let match: Match | undefined;
  for (const candidate of matches) if (!match || candidate.cost < match.cost) match = candidate;
  if (!match) return;
  const along: number[] = [];
  for (; match; match = match.previous) along.push(match.along);
  return along.reverse();
}

function clipTrace(edges: Edge[], total: number, start: number, end: number) {
  const segments: Coordinate[][] = [];
  let current: Coordinate[] = [], previousPart = -1;
  for (let cycle = Math.floor(start / total); cycle <= Math.floor(end / total); cycle++) {
    previousPart = -1;
    for (const edge of edges) {
      const from = Math.max(start - cycle * total, edge.start), to = Math.min(end - cycle * total, edge.end);
      if (to <= from) continue;
      if (edge.part !== previousPart) {
        current = [interpolate(edge.a, edge.b, (from - edge.start) / (edge.end - edge.start))];
        segments.push(current);
        previousPart = edge.part;
      }
      current.push(interpolate(edge.a, edge.b, (to - edge.start) / (edge.end - edge.start)));
    }
  }
  return segments;
}

/** Clip one selected directed variant from boarding to alighting; never draw an unused tail/variant. */
export function rideGeometry(ride: RideLeg, network: Pick<Network, 'patterns'>): RideGeometry {
  const fallback=(): RideGeometry => ({segments:ride.stops.length>1?[ride.stops]:[],approximate:true});
  if (ride.stops.length < 2) return fallback();
  const candidates=network.patterns.filter(pattern=>pattern.routeId===ride.routeId && pattern.direction===ride.direction && (!ride.patternId || pattern.id===ride.patternId) && boardingIndex(pattern,ride)!==undefined);
  if (candidates.length!==1) return fallback();
  const pattern=candidates[0], stops=visits(pattern), board=boardingIndex(pattern,ride)!;
  const parts=(pattern.shapeSegments?.length?pattern.shapeSegments:[pattern.shape]).filter(part=>part.length>1);
  if (!parts.length || stops.length>2000 || parts.flat().length>30000 || parts.some(part=>part.some(point=>!Number.isFinite(point.lat)||!Number.isFinite(point.lon)))) return fallback();
  const edges: Edge[]=[]; let total=0;
  parts.forEach((part,index)=>{ if(index) total+=distanceMeters(parts[index-1].at(-1)!,part[0]); for(let i=1;i<part.length;i++) { const length=distanceMeters(part[i-1],part[i]); if(length>0) { edges.push({a:part[i-1],b:part[i],start:total,end:total+length,part:index}); total+=length; } } });
  if (!edges.length) return fallback();
  const loop = pattern.loop === true || stops.length !== pattern.stops.length;
  const loopLength = loop && distanceMeters(parts[0][0], parts.at(-1)!.at(-1)!) <= 60 ? total : 0;
  const projections = stops.map(stop => stopProjections(stop, edges));
  // A route-level trace can serve both directed patterns. Prefer a match supported by the full stop sequence.
  for (const useWholePattern of [true, false]) {
    if (!useWholePattern && ride.stops.length === stops.length && board === 0) break;
    const ordered = useWholePattern ? stops : ride.stops;
    const positions = useWholePattern ? projections : ride.stops.map((_, index) => projections[(board + index) % stops.length]);
    for (const reverse of [false, true]) {
      const matched = matchTrace(ordered, reverse ? positions.map(options => options.map(p => ({ ...p, along: total - p.along }))) : positions, loopLength);
      if (!matched) continue;
      const along = useWholePattern ? ride.stops.map((_, index) => matched[(board + index) % stops.length] + Math.floor((board + index) / stops.length) * loopLength) : matched;
      const start = along[0], end = along.at(-1)!;
      if (end <= start || end - start > total || along.some((at, index) => index && !validTraceStep(at - along[index - 1], distanceMeters(ride.stops[index - 1], ride.stops[index])))) continue;
      const directed = reverse ? [...edges].reverse().map(({ a, b, start, end, part }) => ({ a: b, b: a, start: total - end, end: total - start, part })) : edges;
      const segments = clipTrace(directed, total, start, end);
      if (segments.length) return { segments, approximate: false };
    }
  }
  return fallback();
}

/** Load details only for used routes whose planning snapshot lacks a usable trace. */
export async function journeyRideGeometries(rides: RideLeg[], network: Network, getRoute: (id: string) => Promise<RouteDetail>) {
  const paths = new Map<RideLeg, Coordinate[][]>();
  const pending = new Map<string, Promise<RouteDetail | undefined>>();
  await Promise.all(rides.map(async ride => {
    let geometry = rideGeometry(ride, network);
    if (geometry.approximate) {
      let details = pending.get(ride.routeId);
      if (!details) {
        details = getRoute(ride.routeId).catch(() => undefined);
        pending.set(ride.routeId, details);
      }
      const route = await details;
      // The detail's stop list may have changed since the trip was planned. Require a unique matching visit.
      if (route) geometry = rideGeometry({ ...ride, boardingIndex: undefined }, route);
    }
    if (!geometry.approximate) paths.set(ride, geometry.segments);
  }));
  return paths;
}

export interface Transfer { index: number; from: Stop; to: Stop; fromRoute: string; toRoute: string }
export function journeyTransfers(journey: Journey): Transfer[] {
  const rides=journey.legs.filter(leg=>leg.kind==='ride');
  return rides.slice(1).flatMap((ride,i)=>{
    const from=rides[i].stops.at(-1),to=ride.stops[0];
    return from&&to?[{index:i+1,from,to,fromRoute:rides[i].routeName,toRoute:ride.routeName}]:[];
  });
}
