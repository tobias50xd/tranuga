import { describe, expect, it } from 'vitest';
import { arrivalLabel, coordinates, escapeHtml, headingLabel, safeColor, vehicleAge } from '../src/ui';

describe('safe and meaningful transit presentation', () => {
  it('escapes untrusted operator text and restricts CSS colors', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(safeColor('url(https://evil.test)')).toBe('#b92535');
    expect(safeColor('#123aBC')).toBe('#123aBC');
  });
  it('shows due, future and passed arrivals without negative minutes', () => {
    expect(arrivalLabel(100000, 100000)).toBe('Due');
    expect(arrivalLabel(161000, 100000)).toBe('2 min');
    expect(arrivalLabel(0, 100000)).toBe('Passed');
  });
  it('reports bus heading and stale observation ages', () => {
    expect(headingLabel(0)).toBe('N'); expect(headingLabel(90)).toBe('E');
    expect(headingLabel(359)).toBe('N'); expect(headingLabel(-90)).toBe('W');
    expect(vehicleAge(undefined)).toContain('unavailable');
    expect(vehicleAge(100000, 280000)).toBe('Updated 3m ago');
  });
  it('formats map and geolocation points identically', () => {
    expect(coordinates({ lat: 33.948, lon: -83.377 })).toBe('33.94800, -83.37700');
  });
});
