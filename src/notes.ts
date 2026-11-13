import { escapeHtml as e } from './ui';
import { compactNote } from './compact-note';
export { compactNote } from './compact-note';

export type NoteKind = 'service' | 'availability' | 'backup' | 'freshness' | 'comparison' | 'estimate' | 'connection' | 'action' | 'info';
export interface Note { kind: NoteKind; tone: 'info' | 'warning' | 'error'; title: string; message: string; details?: string[] }
type Context = 'data' | 'service' | 'error' | 'action' | 'estimate' | 'location';
const paths: Record<NoteKind, string> = {
  service:'M5 4h14v13H5z M7 8h10 M7 12h2m6 0h2 M7 17v3m10-3v3',
  availability:'M12 3 2 21h20L12 3z M12 9v5m0 3v1',
  backup:'M5 7h14v13H5z M3 3h18v4H3z M9 11h6',
  freshness:'M12 3a9 9 0 1 0 9 9 M12 7v5l3 2 M17 3h4v4',
  comparison:'M4 5h6v6H4z M14 13h6v6h-6z M14 5h6m-3-3v6 M4 16h6',
  estimate:'M5 3h14v18H5z M8 7h8 M8 11h2m4 0h2 M8 15h2m4 0h2',
  connection:'M4 9a12 12 0 0 1 16 0 M7 12a8 8 0 0 1 10 0 M10 15a4 4 0 0 1 4 0 M12 19h.01 M3 3l18 18',
  action:'M12 22s7-7 7-13A7 7 0 0 0 5 9c0 6 7 13 7 13z M12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  info:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v6m0-10v1',
};
export function noteIcon(kind: NoteKind): string { return `<svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]}"></path></svg>`; }
export function classifyNote(message: string, context: Context = 'data'): Note {
  if (context === 'service') return { kind:'service',tone:'warning',title:'Service update',message };
  if (context === 'action') return {kind:'action',tone:'error',title:'Choose your trip points',message};
  if (context === 'location') return {kind:'action',tone:'error',title:'Location unavailable',message};
  if (context === 'estimate') return {kind:'estimate',tone:'info',title:'About this estimate',message};
  if (context === 'error') return {kind:'connection',tone:'error',title:'Data could not be refreshed',message:'Try again shortly. Any displayed backup data keeps its original update time.',details:[message]};
  if (/disagree|disputed|conflict/i.test(message)) return {kind:'comparison',tone:'warning',title:'Sources disagree',message:'Matching reports take precedence. Unresolved stop-order conflicts are left out of trip planning.',details:[message]};
  if (/excluded|no current stops|stop sequence|current service|current-service|published routes/i.test(message)) return {kind:'availability',tone:'warning',title:'Some routes cannot be planned',message:'Only routes with confirmed service and usable stop information are included in trip results.',details:[message]};
  if (/backup|saved|static stops|static topology/i.test(message)) return {kind:'backup',tone:'warning',title:'Backup data is in use',message:'A source is unavailable. The app is using another source or a saved snapshot, with original update times preserved.',details:[message]};
  if (/older|stale|timestamp|freshness|update dates?|last known|last received/i.test(message)) return {kind:'freshness',tone:'warning',title:'Check the update time',message:'Some information may be old or have an unknown observation time. Check the bus update label before relying on its position.',details:[message]};
  if (/trace|straight.line|approximate|estimated|timetable guarantee/i.test(message)) return {kind:'estimate',tone:'info',title:'Allow a little extra time',message,details:undefined};
  if (/unavailable|failed|timed out|could not|couldn't|cannot be reached/i.test(message)) return {kind:'connection',tone:'warning',title:'Data could not be refreshed',message:'Try again shortly. Any displayed backup data keeps its original update time.',details:[message]};
  return {kind:'info',tone:'info',title:'Good to know',message};
}
export function buildNotes(messages: string[], context: Context = 'data'): Note[] {
  const notes: Note[] = [];
  for (const text of [...new Set(messages.map(value=>value.trim()).filter(Boolean))]) {
    const note=classifyNote(text,context);
    const prior=note.details && notes.find(value=>value.kind===note.kind && value.title===note.title);
    if (prior?.details) prior.details.push(...note.details!); else notes.push(note);
  }
  return notes.sort((a,b)=>({error:0,warning:1,info:2}[a.tone]-{error:0,warning:1,info:2}[b.tone]));
}
export function renderNotes(messages: string[], context: Context = 'data'): string {
  const notes=buildNotes(messages,context); if (!notes.length) return '';
  const titles: Record<NoteKind,string> = { service:'Service', availability:'Plan limits', backup:'Backup', freshness:'GPS age', comparison:'Sources', estimate:'Estimates', connection:'Connection', action:context==='location'?'Location':'Trip points', info:'Info' };
  const urgent = notes.some(note => note.tone === 'error');
  return `<details class="notes-dropdown"${urgent?' open':''}><summary>Notes (${notes.length})<span class="note-peek">${e([...new Set(notes.map(note=>titles[note.kind]))].slice(0,3).join(' · '))}</span></summary><div class="notes" aria-label="Travel notes">${notes.map(note=>{
    const originals=note.details || [note.message];
    const fragments=[...new Set(originals.map(text=>compactNote(text,note.kind==='service')))];
    return `<article class="note note-${note.tone}" data-note-kind="${note.kind}"${note.tone==='error'?' role="alert"':''}>${noteIcon(note.kind)}<div><h3>${e(titles[note.kind])}</h3><p>${fragments.map(e).join(' · ')}</p><details class="note-details"><summary>Full text${originals.length>1?` (${originals.length})`:''}</summary><ul>${originals.map(detail=>`<li>${e(detail)}</li>`).join('')}</ul></details></div></article>`;
  }).join('')}</div></details>`;
}
