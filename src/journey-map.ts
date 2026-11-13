import type { Coordinate, Network, RoutePattern, Stop } from './types';
import type { Journey, RideLeg } from './planner';
import { distanceMeters } from './planner';

interface Edge { a: Coordinate; b: Coordinate; start: number; end: number; part: number }
interface Projection { along: number; away: number }
export interface RideGeometry { segments: Coordinate[][]; approximate: boolean }
const interpolate = (a: Coordinate,b: Coordinate,t: number): Coordinate => ({ lat:a.lat+(b.lat-a.lat)*t, lon:a.lon+(b.lon-a.lon)*t });
function project(point: Coordinate, edges: Edge[]): Projection {
  const cos=Math.cos(point.lat*Math.PI/180), scale=111195;
  let best: Projection={along:0,away:Infinity};
  for (const edge of edges) {
    const ax=(edge.a.lon-point.lon)*cos*scale,ay=(edge.a.lat-point.lat)*scale;
    const dx=(edge.b.lon-edge.a.lon)*cos*scale,dy=(edge.b.lat-edge.a.lat)*scale;
    const ratio=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    const away=Math.hypot(ax+ratio*dx,ay+ratio*dy);
    if (away<best.away) best={along:edge.start+(edge.end-edge.start)*ratio,away};
  }
  return best;
}
function visits(pattern: RoutePattern) { return pattern.stops.length>2 && pattern.stops[0].id===pattern.stops.at(-1)!.id ? pattern.stops.slice(0,-1) : pattern.stops; }
function boardingIndex(pattern: RoutePattern, ride: RideLeg): number | undefined {
  const stops=visits(pattern), loop=pattern.loop===true || stops.length!==pattern.stops.length;
  const matches=(at: number) => at>=0 && at<stops.length && (loop || at+ride.stops.length<=stops.length) && ride.stops.every((stop,i)=>stops[(at+i)%stops.length]?.id===stop.id);
  if (ride.boardingIndex!==undefined) return matches(ride.boardingIndex)?ride.boardingIndex:undefined;
  const options=stops.flatMap((_stop,i)=>matches(i)?[i]:[]);
  return options.length===1?options[0]:undefined;
}

/** Clip one selected directed variant from boarding to alighting; never draw an unused tail/variant. */
export function rideGeometry(ride: RideLeg, network: Network): RideGeometry {
  const fallback=(): RideGeometry => ({segments:ride.stops.length>1?[ride.stops]:[],approximate:true});
  const candidates=network.patterns.filter(pattern=>pattern.routeId===ride.routeId && pattern.direction===ride.direction && (!ride.patternId || pattern.id===ride.patternId) && boardingIndex(pattern,ride)!==undefined);
  if (candidates.length!==1) return fallback();
  const pattern=candidates[0], stops=visits(pattern), board=boardingIndex(pattern,ride)!;
  const parts=(pattern.shapeSegments?.length?pattern.shapeSegments:[pattern.shape]).filter(part=>part.length>1);
  if (!parts.length || stops.length>2000 || parts.flat().length>30000 || parts.some(part=>part.some(point=>!Number.isFinite(point.lat)||!Number.isFinite(point.lon)))) return fallback();
  const edges: Edge[]=[]; let total=0;
  parts.forEach((part,index)=>{ if(index) total+=distanceMeters(parts[index-1].at(-1)!,part[0]); for(let i=1;i<part.length;i++) { const length=distanceMeters(part[i-1],part[i]); if(length>0) { edges.push({a:part[i-1],b:part[i],start:total,end:total+length,part:index}); total+=length; } } });
  if (!edges.length) return fallback();
  const loop=pattern.loop===true || stops.length!==pattern.stops.length;
  const closed=distanceMeters(parts[0][0],parts.at(-1)!.at(-1)!)<=60;
  const positions=stops.map(stop=>project(stop,edges));
  if (positions.some(value=>value.away>100)) return fallback();
  const along: number[]=[]; let wraps=0;
  for (const position of positions) {
    if (along.length && position.along+wraps*total < along.at(-1)!-1) {
      if (!loop || !closed || ++wraps>1) return fallback();
    }
    along.push(position.along+wraps*total);
  }
  const start=along[board]; let end=start;
  for(let step=1;step<ride.stops.length;step++) {
    const index=(board+step)%stops.length;
    let next=along[index]+Math.floor((board+step)/stops.length)*total;
    if(next<end-1 || next-end>Math.max(2000,distanceMeters(ride.stops[step-1],ride.stops[step])*6)) return fallback();
    if (next-end<distanceMeters(ride.stops[step-1],ride.stops[step])*.8) return fallback();
    end=next;
  }
  if (end<=start || end-start>total+1 || (Math.floor(start/total)!==Math.floor((end-.001)/total) && !closed)) return fallback();
  const segments: Coordinate[][]=[]; let current: Coordinate[]=[]; let previousPart=-1,previousCycle=-1;
  for(let cycle=Math.floor(start/total);cycle<=Math.floor(end/total);cycle++) for(const edge of edges) {
    const from=Math.max(start,edge.start+cycle*total),to=Math.min(end,edge.end+cycle*total);
    if(to<=from) continue;
    const a=interpolate(edge.a,edge.b,(from-edge.start-cycle*total)/(edge.end-edge.start));
    const b=interpolate(edge.a,edge.b,(to-edge.start-cycle*total)/(edge.end-edge.start));
    if(edge.part!==previousPart || cycle!==previousCycle) { if(current.length>1) segments.push(current); current=[]; }
    if(!current.length) current.push(a); current.push(b); previousPart=edge.part; previousCycle=cycle;
  }
  if(current.length>1) segments.push(current);
  return segments.length?{segments,approximate:false}:fallback();
}

export interface Transfer { index: number; from: Stop; to: Stop; fromRoute: string; toRoute: string }
export function journeyTransfers(journey: Journey): Transfer[] {
  const rides=journey.legs.filter(leg=>leg.kind==='ride');
  return rides.slice(1).flatMap((ride,i)=>{
    const from=rides[i].stops.at(-1),to=ride.stops[0];
    return from&&to?[{index:i+1,from,to,fromRoute:rides[i].routeName,toRoute:ride.routeName}]:[];
  });
}
