export { compactNote } from './compact-note';

export type NoteKind = 'service' | 'availability' | 'backup' | 'freshness' | 'comparison' | 'estimate' | 'connection' | 'action' | 'info';
export interface Note { kind: NoteKind; tone: 'info' | 'warning' | 'error'; title: string; message: string; details?: string[] }
type Context = 'data' | 'service' | 'error' | 'action' | 'estimate' | 'location';
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
