import assert from 'node:assert/strict';
import test from 'node:test';
import { displayFilePath, fileReadPresentation, searchPresentation } from '../src/card-plugin-ui';

test('card paths are project-relative only for a complete project ancestor', () => {
  for (const [path, project, expected] of [
    ['/project/src/file.ts', '/project', 'src/file.ts'],
    ['/project/src/file.ts', '/project/', 'src/file.ts'],
    ['/project-other/src/file.ts', '/project', '/project-other/src/file.ts'],
    ['/other/file.ts', '/project', '/other/file.ts'],
    ['/project', '/project', '.'],
    ['/etc/file', '/', 'etc/file'],
    ['src/file.ts', '/project', 'src/file.ts'],
    ['./src/../file.ts', '/project', 'file.ts'],
    ['../other/file.ts', '/project', '/other/file.ts'],
    ['/project/../other/file.ts', '/project', '/other/file.ts'],
    ['/project//src/./file.ts', '/project', 'src/file.ts'],
    ['/Project/file.ts', '/project', '/Project/file.ts'],
    ['/project/dir\\name/file.ts', '/project', 'dir\\name/file.ts'],
    ['/project/.worktrees/task/src/file.ts', '/project/.worktrees/task', 'src/file.ts'],
    ['/project/src/file.ts', '/project/.worktrees/task', '/project/src/file.ts'],
  ]) assert.equal(displayFilePath(path, project), expected, `${project}: ${path}`);
});

test('display-only Windows drive and UNC paths preserve volumes and segment boundaries', () => {
  for (const [path, project, expected] of [
    ['C:\\project\\src\\file.ts', 'C:\\project', 'src\\file.ts'],
    ['C:/project/src/file.ts', 'C:\\project', 'src/file.ts'],
    ['C:\\project-other\\file.ts', 'C:\\project', 'C:\\project-other\\file.ts'],
    ['D:\\project\\file.ts', 'C:\\project', 'D:\\project\\file.ts'],
    ['..\\outside\\file.ts', 'C:\\project', 'C:\\outside\\file.ts'],
    ['\\\\server\\share\\project\\file.ts', '\\\\server\\share\\project', 'file.ts'],
    ['\\\\server\\other\\file.ts', '\\\\server\\share\\project', '\\\\server\\other\\file.ts'],
  ]) assert.equal(displayFilePath(path, project), expected, `${project}: ${path}`);
});

test('missing project context never invents a directory, and full paths precede requested lines', () => {
  assert.equal(displayFilePath('/outside/src/file.ts'), '/outside/src/file.ts');
  assert.equal(displayFilePath('src/file.ts'), 'src/file.ts');
  assert.equal(displayFilePath('file:///some/uri', '/project'), 'file:///some/uri');
  assert.equal(fileReadPresentation({ path: '/project/src/file.ts', projectDirectory: '/project', range: 'lines 3–9', sections: [] }).preview, 'src/file.ts · lines 3–9');
  assert.equal(fileReadPresentation({ path: '/outside/src/file.ts', projectDirectory: '/project', range: 'line 3', sections: [] }).preview, '/outside/src/file.ts · line 3');
  assert.equal(searchPresentation({ query: 'pattern', scope: ['/project/src', '/outside', '/project'], projectDirectory: '/project', sections: [] }).preview, 'pattern · in src · /outside · .');
});
