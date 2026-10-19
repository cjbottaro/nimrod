import { presentationPlugin, type DomCardRenderer } from '../dom-card-renderer';
import type { ToolCardBlock } from '../tool-card';
import { defaultToolRenderer } from './tool';
import readPlugin from './read';
import bashPlugin from './bash';
import writePlugin from './write';
import grepPlugin from './grep';
import findPlugin from './find';
import lsPlugin from './ls';
import codemodePlugin from './codemode';
import { editDomRenderer } from './edit';
import { normalizedToolName } from './tool-input';

/** Metadata-driven matching, just like external plugins; each call mounts its own instance. */
export const bundledToolPlugins: readonly DomCardRenderer<ToolCardBlock>[] = [
  readPlugin, bashPlugin, editDomRenderer, writePlugin, grepPlugin, findPlugin, lsPlugin, codemodePlugin,
];
const genericPlugin = presentationPlugin(defaultToolRenderer);

/** Selection stays fixed for the mounted shell, including while arguments are incomplete. */
export function bundledToolRenderer(data: Readonly<ToolCardBlock>): DomCardRenderer<ToolCardBlock> {
  const name = normalizedToolName(data.name);
  return bundledToolPlugins.find(plugin => plugin.tools?.includes(name)) || genericPlugin;
}
