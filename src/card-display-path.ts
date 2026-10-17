/** Lexical display formatting only. Never used to authorize or open a file. */
interface AbsolutePath { root: string; parts: string[]; separator: string; windows: boolean; }
function normalize(parts: string[]): string[] {
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop(); else result.push(part);
  }
  return result;
}
function absolute(path: string): AbsolutePath | undefined {
  if (/^[a-z]:[\\/]/i.test(path)) {
    return { root: path.slice(0, 2), parts: normalize(path.slice(3).split(/[\\/]/)), separator: path.includes('\\') ? '\\' : '/', windows: true };
  }
  const unc = /^\\\\([^\\/]+)[\\/]([^\\/]+)(?:[\\/]|$)/.exec(path);
  if (unc) return { root: `\\\\${unc[1]}\\${unc[2]}`, parts: normalize(path.slice(unc[0].length).split(/[\\/]/)), separator: '\\', windows: true };
  if (path.startsWith('/')) return { root: '/', parts: normalize(path.split('/')), separator: '/', windows: false };
}
function full(path: AbsolutePath): string {
  return path.root === '/' ? '/' + path.parts.join('/') : path.root + path.separator + path.parts.join(path.separator);
}

/** Strip only an owning-project ancestor, not a similarly named prefix. Keep outside paths absolute. */
export function displayFilePath(path: string, projectDirectory?: string): string {
  if (!path) return path;
  const project = projectDirectory ? absolute(projectDirectory) : undefined;
  let target = absolute(path);
  if (!target && project) {
    // Drive-relative paths/URIs have no unambiguous project-relative interpretation.
    if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith('\\')) return path;
    target = { ...project, parts: normalize([...project.parts, ...path.split(project.windows ? /[\\/]/ : '/')]) };
  }
  if (!target) return path;
  if (project && target.windows === project.windows && target.root === project.root
    && project.parts.every((part, index) => target!.parts[index] === part)) {
    return target.parts.slice(project.parts.length).join(target.separator) || '.';
  }
  return full(target);
}
