import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const untilText = process.env.TRIP_MONITOR_UNTIL;
if (!untilText) throw new Error('Set TRIP_MONITOR_UNTIL to an ISO-8601 UTC timestamp.');
const until = new Date(untilText);
if (!Number.isFinite(until.getTime())) throw new Error('TRIP_MONITOR_UNTIL is invalid.');

const root = process.cwd(), logFile = process.env.TRIP_MONITOR_LOG || '/tmp/tranuga-hourly-trip-monitor.log';
const line = message => {
  const value = `[${new Date().toISOString()}] ${message}\n`;
  appendFileSync(logFile, value); process.stdout.write(value);
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const nextHour = value => {
  const result = new Date(value); result.setUTCMinutes(0, 0, 0); result.setUTCHours(result.getUTCHours() + 1); return result;
};
const run = slot => new Promise(resolve => {
  line(`starting hourly crawl ${slot}`);
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/hourly-trip-monitor.test.ts', '--reporter=default'], {
    cwd: root,
    env: { ...process.env, HOURLY_TRIP_CHECK: '1', HOURLY_SLOT: slot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { appendFileSync(logFile, data); process.stdout.write(data); });
  child.stderr.on('data', data => { appendFileSync(logFile, data); process.stderr.write(data); });
  child.on('exit', (code, signal) => { line(`finished hourly crawl ${slot} (code=${code ?? 'null'}, signal=${signal ?? 'none'})`); resolve(code ?? 1); });
});

let scheduled = nextHour(Date.now());
line(`monitor active; first=${scheduled.toISOString()}, last=${until.toISOString()}, four API reads per slot`);
while (scheduled <= until) {
  const delay = scheduled.getTime() - Date.now();
  if (delay > 0) await wait(delay);
  await run(scheduled.toISOString());
  scheduled = new Date(scheduled.getTime() + 3_600_000);
}
line('monitor complete');
