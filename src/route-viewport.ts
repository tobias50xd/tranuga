interface PixelPoint { x: number; y: number }
export interface PixelBounds { min: PixelPoint; max: PixelPoint }

/** Outer viewport limits: retain half of each route extent at overview,
 * or half of the viewport's extent when zoomed in closer than the route. */
export function routeViewportBounds(route: PixelBounds, viewport: PixelPoint): PixelBounds {
  const overlapX = Math.min(route.max.x - route.min.x, viewport.x) / 2;
  const overlapY = Math.min(route.max.y - route.min.y, viewport.y) / 2;
  return {
    min: { x: route.min.x + overlapX - viewport.x, y: route.min.y + overlapY - viewport.y },
    max: { x: route.max.x - overlapX + viewport.x, y: route.max.y - overlapY + viewport.y },
  };
}
