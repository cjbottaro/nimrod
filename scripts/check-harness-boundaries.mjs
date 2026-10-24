import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Pi's inherited presentation implementation is still shared. These protocol/
// lifecycle entry points are not. For new implementation directories there are
// no legacy shared-file exceptions: expose a consumer port instead.
const privatePi = /^(?:session|transport|client|protocol|native|integration(?:-.+)?|view-policy|session-(?:lifecycle|startup|history|deletion|file))\.ts$/;
const presentationConsumers = ['src/pi/tool-card.ts', 'src/pi/card-plugins/catalog.ts'];
export function checkHarnessBoundaries(root) {
  const src = resolve(root, 'src');
  const implementations = readdirSync(src, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(resolve(src, entry.name, 'integration.ts'))).map(entry => resolve(src, entry.name));
  const consumers = [...readdirSync(src).filter(name => name.endsWith('.ts') && !['bundled-harnesses.ts', 'bundled-card-renderers.ts'].includes(name)).map(name => resolve(src, name)),
    ...presentationConsumers.map(path => resolve(root, path)).filter(existsSync)];
  const failures = [];
  const report = (file, node, message) => { const position = file.getLineAndCharacterOfPosition(node.getStart(file)); failures.push(`${relative(root, file.fileName)}:${position.line + 1}: ${message}`); };
  for (const path of consumers) {
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let dependency;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency = node.moduleSpecifier.text;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependency = node.argument.literal.text;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency = node.arguments[0].text;
      if (dependency !== undefined) {
        const specifier = dependency;
        if (specifier.startsWith('.') && !/\.(?:css|html)(?:\?.*)?$/.test(specifier)) {
          const target = resolve(dirname(path), specifier.replace(/\?.*$/, '')) + (specifier.endsWith('.ts') ? '' : '.ts');
          const implementation = implementations.find(directory => target.startsWith(directory + sep));
          if (implementation) {
            const owned = relative(implementation, target);
            if (relative(src, implementation) !== 'pi' || privatePi.test(owned)) report(file, node, `shared consumer imports integration authority (${specifier}); use its registered port`);
          }
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'kind' && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'backend') report(file, node, 'shared consumer discriminates a concrete backend');
      if (path === resolve(src, 'main.ts') && ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && /^(?:start|write|stop)_/.test(node.arguments[0].text)) report(file, node, 'shell bypasses registered native ownership');
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return failures;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const failures = checkHarnessBoundaries(process.cwd());
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
}
