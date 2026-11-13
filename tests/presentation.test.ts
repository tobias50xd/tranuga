import { describe, expect, it, vi } from 'vitest';
import { buildNotes, classifyNote, renderNotes, compactNote } from '../src/notes';
import { routeState, sortRoutes } from '../src/route-presentation';
import { matchStops, normalizePlaces, PlaceSearch } from '../src/places';
import { knownStops, GEORGIA_AGENCY, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY } from '../src/replication';
import type { Route } from '../src/types';

const route = (id: string, active = true, availability?: Route['availability']): Route => ({ id, shortName: id, name: id, active, availability, color: '#123456', agencyId: 'test' });
const feature = (properties: unknown = { name: 'Tate Student Center', city: 'Athens', state: 'Georgia' }, coordinates: unknown = [-83.377, 33.948]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
const collection = (features: unknown[] = [feature()]) => ({ type: 'FeatureCollection', features });

describe('route presentation', () => {
  it('puts confirmed active routes first, sorts numbers naturally and preserves the original catalog', () => {
    const input = [route('1', false), route('10'), route('2'), route('3', true, 'unknown'), route('4', true, 'published')];
    expect(sortRoutes(input).map(value => value.id)).toEqual(['2', '10', '3', '4', '1']);
    expect(input[0].id).toBe('1');
    expect(routeState(route('1', false, 'current'))).toBe('inactive');
    expect(routeState(route('1', false, 'unknown'))).toBe('unconfirmed');
    expect(routeState(route('1', true, 'published'))).toBe('unconfirmed');
  });
});

describe('readable travel notes', () => {
  it('groups duplicate technical details while keeping distinct operator alerts intact', () => {
    const notes = buildNotes(['Saved backup A', 'Saved backup B', 'Saved backup A']);
    expect(notes).toHaveLength(1); expect(notes[0].kind).toBe('backup'); expect(notes[0].details).toHaveLength(2);
    const service = buildNotes(['Detour at Main Street', 'Route 2 cancelled'], 'service');
    expect(service.map(note => note.message)).toEqual(['Detour at Main Street', 'Route 2 cancelled']);
  });
  it.each([
    ['Sources disagree; disputed stop sequences are excluded', 'comparison'],
    ['Routes excluded from planning: no current stops', 'availability'],
    ['A saved snapshot is older than two minutes', 'backup'],
    ['Vehicle positions have no timestamp', 'freshness'],
    ['Travel is estimated', 'estimate'],
    ['Provider unavailable', 'connection'],
  ])('classifies %s as %s', (message, kind) => { expect(classifyNote(message).kind).toBe(kind); });
  it('escapes provider text and keeps errors accessible even if their text mentions backup data', () => {
    const html = renderNotes(['<img src=x onerror=alert(1)>'], 'service');
    expect(html).not.toContain('<img'); expect(html).toContain('&lt;img'); expect(html).toContain('aria-hidden="true"');
    expect(renderNotes(['Saved data unavailable'], 'error')).toContain('role="alert"');
    expect(renderNotes(['Select your destination'], 'action')).toContain('Select your destination');
    expect(renderNotes([])).toBe('');
  });
});

describe('place and stop search', () => {
  it('normalizes GeoJSON longitude/latitude and address labels, drops malformed points and deduplicates', () => {
    const result = normalizePlaces(collection([feature(), feature(), feature({}, [0,0]), feature({ name: 'Bad' }, ['-83', 33]), feature({ name: 'Bad' }, [0, 91]), feature({ housenumber: '123', street: 'Main Street', city: 'Athens' })]));
    expect(result).toHaveLength(2); expect(result[0]).toMatchObject({ label: 'Tate Student Center', detail: 'Athens, Georgia', lat: 33.948, lon: -83.377 });
    expect(result[1].label).toBe('123 Main Street'); expect(normalizePlaces({ error: true })).toEqual([]);
  });
  it('matches stop words in any order and never mixes Ohio with reviewed Georgia stop hints', () => {
    const stops = [{ id: '1', name: 'Tate Student Center', lat: 33.948, lon: -83.377 }];
    expect(matchStops(stops, 'STUDENT tate')[0].label).toBe(stops[0].name);
    expect(matchStops(stops, 'x')).toEqual([]);
    expect(knownStops(GEORGIA_AGENCY)).toHaveLength(608);
    expect(knownStops(PASSIO_UGA_AGENCY)).toHaveLength(114);
    expect(knownStops(PASSIO_ATHENS_AGENCY)).toEqual([]);
  });
  it('sends queries only in a no-store JSON body, uses a short memory cache and expires it', async () => {
    let now = 1000; const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(collection()));
    const search = new PlaceSearch(fetcher, () => now), bias = { lat: 33.948, lon: -83.377 };
    await search.search('Ta', bias); expect(fetcher).not.toHaveBeenCalled();
    const result = await search.search('Tate', bias); expect(result).toHaveLength(1);
    await search.search('TATE', bias); expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]; expect(url).toBe('/api/places');
    expect(options).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'omit' });
    expect(JSON.parse(String(options?.body))).toEqual({ query: 'Tate', ...bias });
    now += 300001; await search.search('Tate', bias); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not store failed or cancelled searches', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockImplementation(async () => Response.json(collection()));
    const search = new PlaceSearch(fetcher), bias = { lat: 0, lon: 0 };
    await expect(search.search('Tate', bias)).rejects.toThrow('unavailable');
    const controller = new AbortController(); controller.abort();
    await expect(search.search('Tate', bias, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await search.search('Tate', bias); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe('compact note fragments',()=>{
 it('keeps warnings collapsed and opens actionable errors',()=>{
  expect(renderNotes(['Showing static stops; current stop availability could not be confirmed.'])).toContain('<details class="notes-dropdown">');
  expect(renderNotes(['Choose a start and destination from the suggestions, or use the map.'], 'action')).toContain('<details class="notes-dropdown" open>');
  expect(renderNotes(['Showing static stops; current stop availability could not be confirmed.'])).toContain('Static stops · service unconfirmed');
 });
});

it('compacts known diagnostics while preserving counts, route letters, negation and clock times',()=>{
 expect(compactNote('3 data disagreements detected. Matching reports take precedence; disputed stop sequences are excluded from trip planning.')).toBe('3 source conflicts · disputed stop order excluded');
 expect(compactNote('Some vehicle positions are older than two minutes or have no timestamp. Check their update time.')).toBe('GPS >2 min / time unknown');
 expect(compactNote('Transit request failed (503).')).toBe('HTTP 503 · retry');
 const alert=compactNote('Route A is not operating until 22:00. Use Route 12 instead.');
 for(const token of ['Route A','not','until 22:00','Route 12']) expect(alert).toContain(token);
});

it('keeps cancellation wording visible when an operator alert also contains a diagnostic phrase',()=>{
 const alert='Route A is not operating until 22:00; vehicle positions are older than two minutes. Use Route 12 instead.';
 const html=renderNotes([alert],'service');
 const fragment=html.match(/<p>(.*?)<\/p>/)![1];
 for(const token of ['Route A','not operating','until 22:00','Route 12'])expect(fragment).toContain(token);
 expect(compactNote(alert,true)).toContain('not operating until 22:00');
});
