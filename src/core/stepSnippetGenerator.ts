export interface GeneratedStepSnippet {
  decoratorKeyword: string;
  pattern: string;
  paramNames: string[];
  code: string;
}

/**
 * Converts a concrete feature step line into a Python Behave step definition snippet.
 */
export function generateStepSnippet(
  keyword: string,
  stepText: string
): GeneratedStepSnippet {
  let kw = keyword.toLowerCase();
  if (kw === "and" || kw === "but" || kw === "*") {
    kw = "then";
  }
  const decoratorKeyword = ["given", "when", "then", "step"].includes(kw)
    ? kw
    : "step";

  const paramNames: string[] = [];
  const usedNames = new Set<string>();

  function makeUniqueName(base: string): string {
    let clean = base.toLowerCase().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
    if (!clean || /^\d/.test(clean)) {
      clean = "param";
    }
    let candidate = clean;
    let counter = 1;
    while (usedNames.has(candidate) || candidate === "context") {
      candidate = `${clean}_${counter++}`;
    }
    usedNames.add(candidate);
    return candidate;
  }

  // 1. Replace outline variables like <name>
  let processed = stepText.replace(/<([^>]+)>/g, (_, varName) => {
    const p = makeUniqueName(varName);
    paramNames.push(p);
    return `{${p}}`;
  });

  // 2. Replace quoted strings: "..." or '...'
  processed = processed.replace(/(?:(\w+)\s+)?(["'])(.*?)\2/g, (_match, prefix, _quote, val) => {
    const hint = prefix ? prefix : val && val.length < 20 ? val : "param";
    const p = makeUniqueName(hint);
    paramNames.push(p);
    return prefix ? `${prefix} "{${p}}"` : `"{${p}}"`;
  });

  // 3. Replace isolated numbers: e.g. 42
  processed = processed.replace(/\b(\d+)\b/g, () => {
    const p = makeUniqueName("count");
    paramNames.push(p);
    return `{${p}:d}`;
  });

  const paramsList = ["context", ...paramNames].join(", ");
  const commentKeyword = keyword.charAt(0).toUpperCase() + keyword.slice(1);
  const code = [
    `@${decoratorKeyword}(u'${processed}')`,
    `def step_impl(${paramsList}):`,
    `    raise NotImplementedError(u'STEP: ${commentKeyword} ${stepText}')`,
  ].join("\n");

  return {
    decoratorKeyword,
    pattern: processed,
    paramNames,
    code,
  };
}
