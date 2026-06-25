// Syntax highlighting via Prism. Runs at render time — in Node (the CLI's
// standalone-HTML render) and in the browser (the live app) — so the highlighted
// spans are baked into the markup; no client-side Prism is needed in the
// standalone file. We highlight WHOLE blocks (not per line) so multi-line
// constructs (Python docstrings, block comments, template strings) are correct,
// then slice the token stream back into lines for the diff.
import Prism from 'prismjs';
// Core already bundles markup/css/clike/javascript. Add the rest in dep order
// (typescript/jsx need javascript+markup, which are present; tsx needs both).
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-yaml.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-rust.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-java.js';
import 'prismjs/components/prism-ruby.js';
import 'prismjs/components/prism-c.js';
import 'prismjs/components/prism-cpp.js';
import 'prismjs/components/prism-csharp.js';

export interface Seg {
  text: string;
  cls: string; // Prism token classes, or '' for plain text
}

const EXT_LANG: Record<string, string> = {
  py: 'python',
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  rs: 'rust',
  go: 'go',
  md: 'markdown',
  java: 'java',
  rb: 'ruby',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  html: 'markup',
  xml: 'markup',
};

/** Prism language id for a file path, or '' if we don't have a grammar. */
export function langFor(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? '';
}

/**
 * Highlight `code` and return one Seg[] per line. Segment texts concatenated
 * per line reproduce the original line exactly, so line indices line up with
 * the input — which is what lets us reattach highlighting to diff lines.
 */
export function highlightLines(code: string, lang: string): Seg[][] {
  const lines: Seg[][] = [[]];
  const pushText = (text: string, cls: string): void => {
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i] !== '') lines[lines.length - 1]!.push({ text: parts[i]!, cls });
    }
  };
  const grammar = (Prism.languages as Record<string, Prism.Grammar | undefined>)[lang];
  if (!grammar) {
    pushText(code, '');
    return lines;
  }
  const walk = (toks: Array<string | Prism.Token>, cls: string): void => {
    for (const t of toks) {
      if (typeof t === 'string') {
        pushText(t, cls);
        continue;
      }
      const alias = t.alias ? (Array.isArray(t.alias) ? t.alias.join(' ') : t.alias) : '';
      const tcls = `${cls ? cls + ' ' : ''}token ${t.type}${alias ? ' ' + alias : ''}`;
      if (typeof t.content === 'string') pushText(t.content, tcls);
      else if (Array.isArray(t.content)) walk(t.content, tcls);
      else walk([t.content], tcls);
    }
  };
  walk(Prism.tokenize(code, grammar), '');
  return lines;
}
