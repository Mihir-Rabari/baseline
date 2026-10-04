import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/src');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [resolve(directory, entry.name)] : []);
}
describe('Website icon conventions', () => {
  it('keeps glyphs in one icon set, at the control size, and out of accessible names', () => {
    let checked = 0;
    for (const file of files(root)) {
      const text = readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const icons = new Set<string>();
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        expect(node.moduleSpecifier.text, file).not.toMatch(/react-icons|heroicons|fontawesome/);
        if (node.moduleSpecifier.text === 'lucide-react' && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const item of node.importClause.namedBindings.elements) if (!item.isTypeOnly) icons.add(item.name.text);
        }
      }
      if (text.includes('type LucideIcon')) icons.add('Icon');
      function visit(node: ts.Node) {
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && icons.has(node.tagName.getText(source))) {
          const props = node.attributes.properties.filter(ts.isJsxAttribute);
          const hidden = props.find(prop => prop.name.getText(source) === 'aria-hidden');
          expect(hidden, `${file}: ${node.tagName.getText(source)}`).toBeDefined();
          expect(hidden?.initializer?.getText(source) ?? '').not.toMatch(/false/);
          const className = props.find(prop => prop.name.getText(source) === 'className')?.initializer?.getText(source) ?? '';
          // A radio-menu selection dot is intentionally smaller than a glyph.
          expect(className, file).toContain(node.tagName.getText(source) === 'Circle' ? 'h-2 w-2' : 'h-4 w-4');
          const stroke = props.find(prop => prop.name.getText(source) === 'strokeWidth');
          if (stroke) expect(stroke.initializer?.getText(source), file).toMatch(/^\{2\}$/);
          checked++;
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(checked).toBeGreaterThan(20);
  });
  it('keeps emoji and custom pictograms out of production UI while allowing data charts', () => {
    for (const file of files(root)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u);
      if (!file.endsWith('charts.tsx') && !file.endsWith('area-chart.tsx')) expect(text, file).not.toMatch(/<svg\b/);
    }
  });
});
