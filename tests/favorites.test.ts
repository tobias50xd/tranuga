import { describe, expect, it } from 'vitest';
import { Favorites, favoriteKey, FAVORITES_KEY } from '../src/favorites';
import { sortRoutes, routeOperator } from '../src/route-presentation';
import { GEORGIA_AGENCY, PASSIO_ATHENS_AGENCY } from '../src/replication';
import { normalizeRoutes } from '../src/api/normalize';
import type { Route } from '../src/types';
const route=(id:string,operator:Route['operator'],active=true):Route=>({id,operator,active,name:id,shortName:id,color:'#123456',agencyId:'uga'});
const memory=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};};
describe('route favorites and operator order',()=>{
 it('pins favorites before UGA, then city routes, with service state and natural numbers within groups',()=>{
  const routes=[route('1','city'),route('10','uga'),route('2','uga'),route('3','uga',false),route('4','city',false)];
  expect(sortRoutes(routes).map(route=>route.id)).toEqual(['2','10','3','1','4']);
  expect(sortRoutes(routes,new Set(['4'])).map(route=>route.id)).toEqual(['4','2','10','3','1']);
  expect(routes[0].id).toBe('1');
 });
 it('preserves explicit operator flags and supports reviewed older snapshots',()=>{
  const result=normalizeRoutes([{id:1,isAthensBus:true},{id:2,isAthensBus:false}],'uga','uga');
  expect(result.map(routeOperator)).toEqual(['city','uga']);
  expect(routeOperator({...route('5750',undefined),agencyId:'uga'})).toBe('uga');
  expect(routeOperator({...route('1',undefined),agencyId:'3994'})).toBe('uga');
 });
 it('persists star toggles without sharing equal native IDs between Georgia and Ohio',()=>{
  const storage=memory(),favorites=new Favorites(storage);
  expect(favorites.toggle(GEORGIA_AGENCY,'1')).toBe(true);
  const restored=new Favorites(storage); expect(restored.has(GEORGIA_AGENCY,'1')).toBe(true);expect(restored.has(PASSIO_ATHENS_AGENCY,'1')).toBe(false);
  expect(restored.toggle(GEORGIA_AGENCY,'1')).toBe(false);expect(new Favorites(storage).has(GEORGIA_AGENCY,'1')).toBe(false);
 });
 it('survives corrupt or unavailable storage and bounds retained entries',()=>{
  const storage=memory();storage.setItem(FAVORITES_KEY,'{');expect(new Favorites(storage).has(GEORGIA_AGENCY,'1')).toBe(false);
  storage.setItem(FAVORITES_KEY,JSON.stringify([1,'bad',favoriteKey(GEORGIA_AGENCY,'1')]));expect(new Favorites(storage).has(GEORGIA_AGENCY,'1')).toBe(true);
  const blocked=new Favorites({getItem(){throw new Error('blocked');},setItem(){throw new Error('full');}});
  expect(blocked.toggle(GEORGIA_AGENCY,'1')).toBe(true);expect(blocked.has(GEORGIA_AGENCY,'1')).toBe(true);
  for(let i=0;i<501;i++)blocked.toggle(GEORGIA_AGENCY,String(i+2));
  expect(blocked.has(GEORGIA_AGENCY,'1')).toBe(false);expect(blocked.has(GEORGIA_AGENCY,'502')).toBe(true);
 });
});
