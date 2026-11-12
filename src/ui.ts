import type { Coordinate } from './types';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function safeColor(value: string): string { return /^#[\da-f]{6}$/i.test(value) ? value : '#b92535'; }

export function coordinates(value: Coordinate): string { return `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}`; }

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function arrivalLabel(timestamp: number, now = Date.now()): string {
  const minutes = Math.ceil((timestamp - now) / 60000);
  return minutes < 0 ? 'Passed' : minutes === 0 ? 'Due' : `${minutes} min`;
}

export function vehicleAge(timestamp?: number, now = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Update time unavailable';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 60 ? `Updated ${seconds}s ago` : `Updated ${Math.floor(seconds / 60)}m ago`;
}

export function headingLabel(degrees: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((degrees % 360 + 360) % 360) / 45) % 8];
}
