import { Files } from '@cucumber/language-server';
import { FileSystem, Uri, workspace } from 'vscode';

/**
 * Converts a Behave step pattern into a regular expression string
 * compatible with @cucumber/language-service's RegExp wrapper format (`/.../`).
 *
 * This supports:
 * - Untyped placeholders: `{seconds}`, `{name}`
 * - Typed placeholders: `{n:d}`, `{cost:f}`, `{user:w}`, `{msg:s}`
 * - Standard Cucumber parameter types: `{int}`, `{float}`, `{word}`, `{string}`, `{}`
 * - Quoted placeholders: `'{seconds}'`, `"{seconds}"` (allows single, double, or unquoted in steps)
 * - cfparse cardinality: `{opt:w?}`, `{items:w*}`, `{items:w+}`
 * - Optional text: `apple(s)` -> `apple(?:s)?`
 * - Word alternatives: `red/blue` -> `(?:red|blue)`
 * - Trailing punctuation / periods: `seconds.` (properly escaped so it doesn't break regex)
 * - Scenario outline parameters: `<param>` accepted anywhere
 */
export function behaveStepToCucumberRegexString(pattern: string, quoteChar: string): string {
  // If it's already a regex (starts with ^ or ends with $ or has (?P<)
  if (/^\^|\$$|\(\?P</.test(pattern)) {
    let clean = pattern.replace(/\(\?P<[a-zA-Z0-9_]+>/g, '(');
    if (!clean.startsWith('^')) clean = '^' + clean;
    if (!clean.endsWith('$')) clean = clean + '$';
    clean = clean.replace(/(?<!\\)\//g, '\\/');
    return clean;
  }

  // 1. Pre-process alternatives like red/blue -> (?:red/blue|red|blue)
  // Preserves literal slash phrases like date/time while also supporting individual alternatives
  let processed = pattern.replace(/\b([a-zA-Z0-9_]+)(?:\/([a-zA-Z0-9_]+))+\b/g, (match) => {
    const parts = match.split('/');
    return `(?:${match}|${parts.join('|')})`;
  });

  // 2. Pre-process optional like apple(s) -> apple(?:s)?
  processed = processed.replace(/\(([a-zA-Z0-9_\s]+)\)\??/g, '(?:$1)?');

  // 3. Tokenize placeholders and already-processed (?:...) groups
  const preserved: { raw: string; name?: string; type?: string; isQuoted?: boolean; isGroup?: boolean }[] = [];

  // Match quoted placeholders: '{name}', "{name}", \'{name}\', \"{name}\", '{}', '"{}"'
  processed = processed.replace(/(?:\\?(['"]))\{([a-zA-Z0-9_]*)(?::([a-zA-Z0-9_?*+]+))?\}(?:\\?\1)/g, (m, _q, name, type) => {
    preserved.push({ raw: m, name, type, isQuoted: true });
    return `__TOKEN_${preserved.length - 1}__`;
  });

  // Match unquoted placeholders: {name}, {name:type}, {}
  processed = processed.replace(/\{([a-zA-Z0-9_]*)(?::([a-zA-Z0-9_?*+]+))?\}/g, (m, name, type) => {
    preserved.push({ raw: m, name, type, isQuoted: false });
    return `__TOKEN_${preserved.length - 1}__`;
  });

  // Match (?:...) groups
  processed = processed.replace(/\(\?:[^\)]+\)\??/g, (m) => {
    preserved.push({ raw: m, isGroup: true });
    return `__TOKEN_${preserved.length - 1}__`;
  });

  // 4. Escape regex special chars outside placeholders: . * + ? ^ $ { } ( ) | [ ] \ /
  let escaped = processed.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

  // 5. Replace back the tokens with regex capture groups
  escaped = escaped.replace(/([ \t]*)__TOKEN_(\d+)__/g, (_, ws, idxStr) => {
    const item = preserved[Number(idxStr)];
    if (item.isGroup) {
      return (ws || '') + item.raw;
    }

    const namePart = (item.name ?? '').trim();
    let typePart = (item.type ?? '').trim();
    let cardinality = '';
    if (typePart && /[?*+]$/.test(typePart)) {
      cardinality = typePart.slice(-1);
      typePart = typePart.slice(0, -1);
    }

    let base = '.*?';
    if (typePart === 'd' || typePart === 'n' || namePart === 'int') {
      base = '-?\\d+';
    } else if (typePart === 'f' || namePart === 'float') {
      base = '-?\\d*(?:\\.\\d+)?';
    } else if (typePart === 'w' || namePart === 'word') {
      base = '\\w+';
    } else if (typePart === 's' || namePart === 'string') {
      base = '.*';
    }

    const baseWithOutline = `(?:${base}|<[^>]+>)`;

    if (item.isQuoted) {
      // Escape the enclosing quoteChar if used in the regex character class
      const qClass = quoteChar === '"' ? "['\\\"]" : "[\\'\"]";
      return (ws || '') + `${qClass}?(${baseWithOutline})${qClass}?`;
    }

    if (cardinality === '?') {
      return ws ? `(?:${ws}(${baseWithOutline}))?` : `(?:(${baseWithOutline}))?`;
    } else if (cardinality === '*') {
      return (ws || '') + `(?:(${baseWithOutline}(?:\\s*,?\\s*${baseWithOutline})*))?`;
    } else if (cardinality === '+') {
      return (ws || '') + `(${baseWithOutline}(?:\\s*,?\\s*${baseWithOutline})*)`;
    }
    return (ws || '') + `(${baseWithOutline})`;
  });

  return `^${escaped}$`;
}

/**
 * Normalizes Python Behave step definition decorators so they are 100% compatible
 * with @cucumber/language-service and @cucumber/language-server tree-sitter AST queries
 * and regular expression / expression matching.
 *
 * This runs purely in-memory when the language server indexes step definitions,
 * without modifying the actual source files on disk or altering line counts.
 */
export function normalizeBehavePythonForCucumber(pySource: string): string {
  // 1. Remove behave. prefix from decorators: @behave.given -> @given
  let res = pySource.replace(/@\s*behave\s*\.\s*(given|when|then|step)\b/gi, '@$1');

  // 2. Unwrap re.compile: @given(re.compile(r"...")) -> @given(r"...")
  res = res.replace(
    /@\s*(given|when|then|step)\s*\(\s*re\.compile\s*\(\s*([rRuU]{0,2}("""|'''|"|')[\s\S]*?\3)\s*\)\s*\)/gi,
    '@$1($2)'
  );

  // 3. Fix raw/unicode prefixes on triple quotes: @given(r"""...""") -> @given("""...""")
  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*[rRuU]{1,2}("""|''')/gi, '@$1($2');

  // 4. Fix triple-quoted strings in step decorators: @given("""...""") -> @given("...")
  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*("""|''')([\s\S]*?)\2\s*\)/gi, (_match, kw, q3, content) => {
    const q1 = q3 === '"""' ? '"' : "'";
    return `@${kw}(${q1}${content}${q1})`;
  });

  // 5. Fix raw/unicode string prefixes: r"...", u"...", ur"...", ru"..." in step decorators
  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*[rRuU]{1,2}(['"])/gi, '@$1($2');

  // 6. Convert step patterns into slash-wrapped regexes (`/^...$/`)
  // @cucumber/language-service natively parses `/^...$/` into a RegularExpression
  // avoiding false positives from Cucumber Expression parser on periods, parentheses, quotes, and cfparse types
  res = res.replace(/@\s*(given|when|then|step)\s*\(\s*(['"])((?:\\.|(?!\2)[\s\S])*?)\2\s*\)/gi, (_match, kw, q, pattern) => {
    const regexPattern = behaveStepToCucumberRegexString(pattern, q);
    return `@${kw}(${q}/${regexPattern}/${q})`;
  });

  return res;
}

export class VscodeFiles implements Files {
  constructor(private readonly fs: FileSystem) {}

  async exists(uri: string): Promise<boolean> {
    try {
      await this.fs.stat(Uri.parse(uri));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(uri: string): Promise<string> {
    const parsedUri = Uri.parse(uri);
    // 1. If file is open in editor (supports dirty/unsaved edits), use document text
    const openDoc = workspace.textDocuments.find(
      (doc) => doc.uri.toString() === uri || doc.uri.fsPath === parsedUri.fsPath
    );
    let content: string;
    if (openDoc) {
      content = openDoc.getText();
    } else {
      const data = await this.fs.readFile(parsedUri);
      content = new TextDecoder().decode(data);
    }

    // 2. If it is a Python file, normalize Behave step definitions in-memory
    if (uri.endsWith('.py') || parsedUri.path.endsWith('.py')) {
      return normalizeBehavePythonForCucumber(content);
    }

    return content;
  }

  async findUris(glob: string): Promise<readonly string[]> {
    const uris = await workspace.findFiles(glob);
    const results = new Set(uris.map((file) => file.toString()));

    // When querying Python glue, ensure all standard Behave steps directories are scanned
    if (glob.includes('.py')) {
      const behaveGlobs = [
        '**/steps/**/*.py',
        'steps/**/*.py',
        '**/*_steps.py',
        '**/step_*.py',
        '**/steps.py',
        'features/**/*.py',
        'tests/**/*.py',
      ];
      for (const bg of behaveGlobs) {
        if (bg !== glob) {
          const extraUris = await workspace.findFiles(bg);
          for (const u of extraUris) {
            results.add(u.toString());
          }
        }
      }
    }

    return Array.from(results);
  }

  relativePath(uri: string): string {
    return workspace.asRelativePath(Uri.parse(uri), true);
  }
}
