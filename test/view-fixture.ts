import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

export function webviewHtml(..._unused: unknown[]): string {
  return `<!doctype html><html><head><style>${readFileSync('src/pi/transcript.css', 'utf8')}\n${readFileSync('src/theme.css', 'utf8')}</style></head><body>${readFileSync('src/pi/transcript.html', 'utf8')}</body></html>`;
}
export function rendererBundle(): string {
  return buildSync({ entryPoints: ['src/pi/webview-client.ts'], bundle: true, format: 'iife', globalName: 'PiView', platform: 'browser', write: false }).outputFiles![0].text;
}
