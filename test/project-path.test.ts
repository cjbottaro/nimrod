import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPathParts } from '../src/project-path';

test('project display splits names and parents without changing roots or platform separators', () => {
  for (const [path, name, parent] of [
    ['/work/nimrod', 'nimrod', '/work'],
    ['/work/nimrod/', 'nimrod', '/work'],
    ['/nimrod', 'nimrod', '/'],
    ['/', '/', ''],
    ['C:\\Projects\\nimrod', 'nimrod', 'C:\\Projects'],
    ['C:\\nimrod', 'nimrod', 'C:\\'],
    ['C:\\', 'C:\\', ''],
    ['C:/', 'C:/', ''],
    ['C:/Projects/nimrod', 'nimrod', 'C:/Projects'],
    ['\\\\server\\share\\nimrod', 'nimrod', '\\\\server\\share'],
    ['\\\\server\\share\\', '\\\\server\\share\\', ''],
    ['nimrod', 'nimrod', ''],
  ]) assert.deepEqual(projectPathParts(path), { name, parent }, path);
});
