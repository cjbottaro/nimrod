import { readFileSync } from 'node:fs';

export interface CapturedWebExample {
  start: { type: 'tool.execution_start'; data: { toolCallId: string; toolName: string; arguments: Record<string, unknown>; [key: string]: unknown } };
  complete: { type: 'tool.execution_complete'; data: { toolCallId: string; success: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } } };
}
export type WebExampleName = 'search-answer' | 'search-scoped' | 'fetch-page' | 'fetch-redirect' | 'fetch-partial' | 'fetch-permission-error';

/** A fresh copy for each consumer; fixtures never load sessions or execute requests. */
export function capturedWebExample(name: WebExampleName): CapturedWebExample {
  return JSON.parse(readFileSync(new URL(`./fixtures/copilot/web/${name}.json`, import.meta.url), 'utf8'));
}
