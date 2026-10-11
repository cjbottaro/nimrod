import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// GitHub-style heading IDs, including duplicate headings. Fenced examples are
// parsed as code, not headings or links. This checker never accesses the network.
export function headingIds(tokens) {
  const ids = new Set(), counts = new Map();
  marked.walkTokens(tokens, token => {
    if (token.type !== 'heading') return;
    const plain = marked.parseInline(token.text).replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const base = plain.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  });
  return ids;
}

export async function checkFiles(files, base = root) {
  base = resolve(base);
  const errors = [], cache = new Map();
  const document = async path => {
    if (!cache.has(path)) cache.set(path, marked.lexer(await readFile(path, 'utf8')));
    return cache.get(path);
  };
  for (const file of files) {
    const path = resolve(base, file), tokens = await document(path), links = [];
    marked.walkTokens(tokens, token => {
      if (token.type === 'link' || token.type === 'image') links.push(token.href);
      if (token.type === 'html') {
        for (const match of token.text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) links.push(match[1]);
      }
    });
    for (const href of links) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      try {
        const [pathname, fragment] = href.split('#');
        const target = pathname ? resolve(dirname(path), decodeURIComponent(pathname.split('?')[0])) : path;
        const fromRoot = relative(base, target);
        if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('../') || fromRoot.startsWith('..\\')) throw new Error('target is outside the repository');
        await stat(target);
        if (fragment && extname(target) === '.md') {
          const targetTokens = await document(target);
          const ids = headingIds(targetTokens);
          marked.walkTokens(targetTokens, token => {
            if (token.type !== 'html') return;
            for (const match of token.text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) ids.add(match[1]);
          });
          if (!ids.has(decodeURIComponent(fragment))) throw new Error('missing heading/anchor');
        }
      } catch (error) {
        errors.push(`${relative(base, path)}: ${href} (${error.message})`);
      }
    }
  }
  return errors;
}

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md',
    ...await markdownFiles(resolve(root, 'docs')),
    ...await markdownFiles(resolve(root, '.agents/skills'))];
  const errors = await checkFiles(files);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Checked ${files.length} Markdown files: local links and anchors pass.`);
}
