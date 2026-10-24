import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = (path: string) => ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const imports = (file: ts.SourceFile) => file.statements.filter(ts.isImportDeclaration).map(statement => ({
  path: (statement.moduleSpecifier as ts.StringLiteral).text, typeOnly: !!statement.importClause?.isTypeOnly,
}));

test('shared draft and connection consumers cannot import concrete integration authority', () => {
  for (const path of ['src/draft-scope.ts', 'src/session-drafts.ts', 'src/native-drafts.ts', 'src/session-connection.ts', 'src/session-lifecycle.ts']) {
    const dependencies = imports(source(path)).filter(dependency => /^\.\/(pi|copilot|codex|acp)\//.test(dependency.path));
    // Legacy presentation-state decoder, not a controller/protocol dependency.
    assert.deepEqual(dependencies.map(dependency => dependency.path).filter(path => path !== './pi/webview-state'), [], path);
  }
});

test('Codex composition cannot regain concrete session construction or per-session native transport', () => {
  const shell = source('src/main.ts');
  assert.equal(imports(shell).some(dependency => dependency.path === './codex/session' && !dependency.typeOnly), false);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'invoke') {
      const command = node.arguments[0];
      if (command && ts.isStringLiteral(command) && ['start_codex', 'write_codex', 'stop_codex'].includes(command.text)) {
        // Window-generation initialization (stop_codex without a token) is a
        // composition/native-host boundary, not conversation teardown.
        if (command.text !== 'stop_codex' || node.arguments.length > 1) violations.push(node.getText(shell));
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'launchCodex') violations.push(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(shell); assert.deepEqual(violations, []);
});

test('concrete Codex connection owner cannot depend on the project shell, DOM or native implementation', () => {
  const owner = source('src/codex/connection.ts');
  assert.deepEqual(imports(owner).filter(dependency => dependency.path === '../main' || dependency.path === './native' && !dependency.typeOnly), []);
  const globals: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && ['document', 'window', 'HTMLElement', 'Tab'].includes(node.text)) globals.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(owner); assert.deepEqual(globals, []);
});
