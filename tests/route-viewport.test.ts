import { describe, expect, it } from 'vitest';
import { routeViewportBounds } from '../src/route-viewport';

describe('route-relative viewport limits',()=>{
  it.each([[900,600],[300,200],[900,200],[300,600]])('allows half-overlap at each panning edge for a %s × %s viewport',(width,height)=>{
    const route={min:{x:100,y:200},max:{x:700,y:600}},view={x:width,y:height};
    const bounds=routeViewportBounds(route,view);
    for(const [axis,size] of [['x',width],['y',height]] as const) {
      const required=Math.min(route.max[axis]-route.min[axis],size)/2;
      for(const edge of [bounds.min[axis],bounds.max[axis]-size]) {
        const overlap=Math.min(edge+size,route.max[axis])-Math.max(edge,route.min[axis]);
        expect(overlap).toBeCloseTo(required);
      }
    }
  });
  it('keeps horizontal, vertical and point routes in the viewport at their pan limits',()=>{
    for(const end of [{x:600,y:0},{x:0,y:400},{x:0,y:0}]) {
      const bounds=routeViewportBounds({min:{x:0,y:0},max:end},{x:300,y:200});
      expect(bounds.min.x).toBeLessThanOrEqual(0);expect(bounds.max.x).toBeGreaterThanOrEqual(end.x);
      expect(bounds.min.y).toBeLessThanOrEqual(0);expect(bounds.max.y).toBeGreaterThanOrEqual(end.y);
      if(!end.x) {expect(bounds.min.x).toBe(-300);expect(bounds.max.x).toBe(300);}
      if(!end.y) {expect(bounds.min.y).toBe(-200);expect(bounds.max.y).toBe(200);}
    }
  });
});
