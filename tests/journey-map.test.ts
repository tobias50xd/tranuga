import { describe, expect, it } from 'vitest';
import { rideGeometry, journeyTransfers } from '../src/journey-map';
import type { Journey, RideLeg } from '../src/planner';
import type { Network, RoutePattern, Stop } from '../src/types';
const stop=(id:string,lon:number,lat=33.95):Stop=>({id,name:id,lat,lon});
const [a,b,c,d]=[stop('a',-83.393),stop('b',-83.392),stop('c',-83.391),stop('d',-83.390)];
const ride=(stops:Stop[],extra:Partial<RideLeg>={}):RideLeg=>({kind:'ride',routeId:'1',routeName:'One',direction:'0',from:{...stops[0],name:stops[0].name},to:{...stops.at(-1)!,name:stops.at(-1)!.name},startTime:0,endTime:1000,stops,source:'estimated',...extra});
const pattern=(extra:Partial<RoutePattern>={}):RoutePattern=>({id:'p',routeId:'1',direction:'0',stops:[a,b,c,d],shape:[a,b,{lat:33.9502,lon:-83.3915},c,d],...extra});
const network=(patterns:RoutePattern[]):Network=>({agencyId:'uga',routes:[],stops:[a,b,c,d],patterns,vehicles:[],departures:[],messages:[],warnings:[],updatedAt:0});
const journey=(legs:Journey['legs']):Journey=>({legs,arrivalTime:1000,departureTime:0,durationSeconds:1,walkingMeters:0,transfers:legs.filter(l=>l.kind==='ride').length-1,confidence:'estimated',assumptions:[]});

describe('journey segment geometry',()=>{
 it('draws only boarding-to-alighting geometry, excluding both unused route tails',()=>{
  const result=rideGeometry(ride([b,c],{patternId:'p',boardingIndex:1}),network([pattern()]));
  expect(result.approximate).toBe(false);expect(result.segments).toHaveLength(1);
  expect(result.segments[0][0]).toMatchObject({lat:b.lat,lon:b.lon});expect(result.segments[0].at(-1)).toMatchObject({lat:c.lat,lon:c.lon});
  expect(result.segments.flat().every(p=>p.lon>=b.lon && p.lon<=c.lon)).toBe(true);
  expect(result.segments.flat()).toContainEqual({lat:33.9502,lon:-83.3915});
 });
 it('selects the exact variant and falls back rather than combining ambiguous variants',()=>{
  const data=network([pattern(),pattern({id:'other',shape:[a,b,c,d]})]);
  expect(rideGeometry(ride([b,c],{patternId:'p',boardingIndex:1}),data).approximate).toBe(false);
  expect(rideGeometry(ride([b,c]),data)).toEqual({segments:[[b,c]],approximate:true});
  expect(rideGeometry(ride([b,c],{patternId:'missing'}),data).approximate).toBe(true);
 });
 it('preserves only the used directed portion around a closed loop',()=>{
  const square=[stop('a',-83.393),stop('b',-83.391),stop('c',-83.391,33.952),stop('d',-83.393,33.952)];
  const loop=pattern({stops:square,shape:[...square,square[0]],loop:true});
  const result=rideGeometry(ride([square[3],square[0],square[1]],{patternId:'p',boardingIndex:3}),network([loop]));
  expect(result.approximate).toBe(false);expect(result.segments.flat()).not.toContainEqual(square[2]);
  expect(result.segments[0][0]).toMatchObject({lat:square[3].lat,lon:square[3].lon});
  expect(result.segments.at(-1)!.at(-1)).toMatchObject({lat:square[1].lat,lon:square[1].lon});
 });
 it('retains multipart gaps and never inserts a line across them',()=>{
  const data=network([pattern({shape:[],shapeSegments:[[a,b],[c,d]]})]);
  const result=rideGeometry(ride([a,b,c,d],{patternId:'p',boardingIndex:0}),data);
  expect(result.segments).toHaveLength(2);expect(result.approximate).toBe(false);
 });
 it('uses only ridden stop connectors when a trace is missing, reversed or unrelated',()=>{
  for(const shape of [[],[d,c,b,a],[{lat:40,lon:-70},{lat:41,lon:-71}]]) {
   expect(rideGeometry(ride([b,c],{patternId:'p',boardingIndex:1}),network([pattern({shape})]))).toEqual({segments:[[b,c]],approximate:true});
  }
 });
 it('rejects an incorrect repeated-stop visit and keeps transfer walk endpoints distinct',()=>{
  expect(rideGeometry(ride([b,c],{patternId:'p',boardingIndex:0}),network([pattern()])).approximate).toBe(true);
  const first=ride([a,b]),second=ride([c,d],{routeId:'2',routeName:'Two'});
  const result=journeyTransfers(journey([first,{kind:'walk',from:{...b,name:b.name},to:{...c,name:c.name},startTime:0,endTime:1,distanceMeters:90},second]));
  expect(result).toEqual([{index:1,from:b,to:c,fromRoute:'One',toRoute:'Two'}]);
  expect(journeyTransfers(journey([first]))).toEqual([]);
 });
});
