import {
  capturePlaceholderRangesFromBehavePattern,
  findMatchingDefinitions,
  parseStepLine,
} from "./stepMatcher";
import type { StepDefinition, StepKeyword } from "./types";

/** Undefined-step finding for `.feature` lines; map to LSP Diagnostic in the server. */
export type FeatureUndefinedStepDiagnostic = {
  line: number;
  startCharacter: number;
  endCharacter: number;
  message: string;
  code: string;
};

export type FeatureSemanticTokenKind =
  | "comment"
  | "tag"
  | "structuralKeyword"
  | "title"
  | "stepKeyword"
  | "stepText"
  | "docstring"
  | "table"
  | "placeholder";

export type FeatureSemanticTokenSpan = {
  line: number;
  start: number;
  length: number;
  kind: FeatureSemanticTokenKind;
};

const FEATURE_RE = /^\s*Feature:\s*(.+)\s*$/;
const BACKGROUND_RE = /^\s*Background:\s*(.*)\s*$/;
const SCENARIO_RE = /^\s*Scenario:\s*(.+)\s*$/;
const SCENARIO_OUTLINE_RE = /^\s*Scenario Outline:\s*(.+)\s*$/;
const EXAMPLES_RE = /^\s*Examples:\s*(.*)\s*$/;
const RULE_RE = /^\s*Rule:\s*(.+)\s*$/;

function pushComment(line: string, lineIndex: number, out: FeatureSemanticTokenSpan[]): void {
  const i = line.indexOf("#");
  if (i >= 0) {
    out.push({
      line: lineIndex,
      start: i,
      length: line.length - i,
      kind: "comment",
    });
  }
}

function pushKeywordTitle(
  line: string,
  lineIndex: number,
  keyword: string,
  titlePart: string,
  out: FeatureSemanticTokenSpan[]
): void {
  const kwStart = line.indexOf(keyword);
  if (kwStart >= 0) {
    out.push({
      line: lineIndex,
      start: kwStart,
      length: keyword.length,
      kind: "structuralKeyword",
    });
  }
  const trimmedTitle = titlePart.trim();
  if (trimmedTitle.length === 0) {
    return;
  }
  const titleStart = line.indexOf(trimmedTitle, kwStart >= 0 ? kwStart + keyword.length : 0);
  if (titleStart >= 0) {
    out.push({
      line: lineIndex,
      start: titleStart,
      length: trimmedTitle.length,
      kind: "title",
    });
  }
}

function pushTagsLine(line: string, lineIndex: number, out: FeatureSemanticTokenSpan[]): void {
  const re = /@\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push({
      line: lineIndex,
      start: m.index,
      length: m[0].length,
      kind: "tag",
    });
  }
}

/** Scenario outline `<name>` in step or table cells. */
const OUTLINE_PLACEHOLDER_RE = /<[^>]+>/g;

function collectOutlinePlaceholderRanges(segment: string): { start: number; end: number }[] {
  const raw: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  OUTLINE_PLACEHOLDER_RE.lastIndex = 0;
  while ((m = OUTLINE_PLACEHOLDER_RE.exec(segment)) !== null) {
    raw.push({ start: m.index, end: m.index + m[0].length });
  }
  return raw;
}

function pickNonOverlappingRanges(
  raw: { start: number; end: number }[]
): { start: number; end: number }[] {
  const sorted = [...raw].sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end
  );
  const picked: { start: number; end: number }[] = [];
  let coverUntil = -1;
  for (const r of sorted) {
    if (r.start < coverUntil) {
      continue;
    }
    picked.push(r);
    coverUntil = r.end;
  }
  return picked;
}

/** Split [from, from+sliceLen) into gap + placeholder spans (non-overlapping). */
function pushSliceWithPlaceholders(
  line: string,
  lineIndex: number,
  from: number,
  sliceLen: number,
  gapKind: "stepText" | "table",
  out: FeatureSemanticTokenSpan[],
  definitionCaptureRangesInSegment?: { start: number; end: number }[]
): void {
  if (sliceLen <= 0) {
    return;
  }
  const segment = line.slice(from, from + sliceLen);
  const raw: { start: number; end: number }[] = [
    ...collectOutlinePlaceholderRanges(segment),
  ];
  if (definitionCaptureRangesInSegment) {
    const segLen = segment.length;
    for (const r of definitionCaptureRangesInSegment) {
      const start = Math.max(0, r.start);
      const end = Math.min(segLen, r.end);
      if (end > start) {
        raw.push({ start, end });
      }
    }
  }
  const matches = pickNonOverlappingRanges(raw);
  let last = 0;
  for (const r of matches) {
    if (r.start > last) {
      out.push({
        line: lineIndex,
        start: from + last,
        length: r.start - last,
        kind: gapKind,
      });
    }
    out.push({
      line: lineIndex,
      start: from + r.start,
      length: r.end - r.start,
      kind: "placeholder",
    });
    last = r.end;
  }
  if (last < segment.length) {
    out.push({
      line: lineIndex,
      start: from + last,
      length: segment.length - last,
      kind: gapKind,
    });
  }
}

function pushTextWithPlaceholders(
  line: string,
  lineIndex: number,
  from: number,
  sliceLen: number,
  out: FeatureSemanticTokenSpan[],
  definitionCaptureRangesInSegment?: { start: number; end: number }[]
): void {
  pushSliceWithPlaceholders(
    line,
    lineIndex,
    from,
    sliceLen,
    "stepText",
    out,
    definitionCaptureRangesInSegment
  );
}

function processStepLine(
  line: string,
  lineIndex: number,
  previousKeyword: StepKeyword | null,
  semanticOut: FeatureSemanticTokenSpan[],
  definitions: StepDefinition[] | undefined,
  diagnosticOut: FeatureUndefinedStepDiagnostic[]
): StepKeyword | null {
  const stepInfo = parseStepLine(line, previousKeyword);
  const kwMatch = line.match(/^\s*(Given|When|Then|And|But|\*)(\s+|(?=\s*$))/i);
  if (!kwMatch || kwMatch.index === undefined) {
    return previousKeyword;
  }

  const kw = kwMatch[1];
  const kwStart = kwMatch.index + kwMatch[0].indexOf(kw);
  semanticOut.push({
    line: lineIndex,
    start: kwStart,
    length: kw.length,
    kind: "stepKeyword",
  });

  const afterKw = kwMatch.index + kwMatch[0].length;
  const rest = line.slice(afterKw);
  const trimmedRest = rest.trimEnd();

  let matchedStepDefs: StepDefinition[] = [];
  if (definitions !== undefined && stepInfo) {
    matchedStepDefs = findMatchingDefinitions(
      stepInfo.text,
      stepInfo.effectiveKeyword,
      definitions
    );
  }

  let defCapturesInSegment: { start: number; end: number }[] | undefined;
  if (
    matchedStepDefs.length > 0 &&
    stepInfo &&
    trimmedRest.length > 0
  ) {
    const lead = rest.match(/^\s*/)?.[0].length ?? 0;
    for (const def of matchedStepDefs) {
      const relToTrim = capturePlaceholderRangesFromBehavePattern(
        stepInfo.text,
        def.pattern
      );
      if (relToTrim && relToTrim.length > 0) {
        defCapturesInSegment = relToTrim.map((r) => ({
          start: lead + r.start,
          end: lead + r.end,
        }));
        break;
      }
    }
  }

  if (trimmedRest.length > 0) {
    pushTextWithPlaceholders(
      line,
      lineIndex,
      afterKw,
      trimmedRest.length,
      semanticOut,
      defCapturesInSegment
    );
  }

  let nextKeyword = previousKeyword;
  if (stepInfo?.effectiveKeyword) {
    nextKeyword = stepInfo.effectiveKeyword;
  }

  if (definitions !== undefined && stepInfo) {
    if (matchedStepDefs.length === 0) {
      const stepLead = line.match(/^\s*(Given|When|Then|And|But|\*)\s+/i);
      const startChar = stepLead ? stepLead[0].length : 0;
      diagnosticOut.push({
        line: lineIndex,
        startCharacter: startChar,
        endCharacter: line.length,
        message: `Undefined step: "${stepInfo.text}"`,
        code: "undefined-step",
      });
    }
  }

  return nextKeyword;
}

function isTagOnlyLine(trimmed: string): boolean {
  return /^(@\S+(?:\s+@\S+)*)$/.test(trimmed);
}

function isTableRow(trimmed: string): boolean {
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function pushTableLineTokens(line: string, lineIndex: number, out: FeatureSemanticTokenSpan[]): void {
  const firstPipe = line.indexOf("|");
  const lastPipe = line.lastIndexOf("|");
  if (firstPipe < 0 || lastPipe < firstPipe) {
    return;
  }
  const spanLen = lastPipe - firstPipe + 1;
  pushSliceWithPlaceholders(line, lineIndex, firstPipe, spanLen, "table", out);
}

function pushDocstringLine(
  line: string,
  lineIndex: number,
  delimStart: number,
  out: FeatureSemanticTokenSpan[]
): void {
  const from = delimStart;
  const len = line.length - from;
  if (len > 0) {
    out.push({
      line: lineIndex,
      start: from,
      length: len,
      kind: "docstring",
    });
  }
}

export type AnalyzeFeatureDocumentResult = {
  semanticSpans: FeatureSemanticTokenSpan[];
  undefinedStepDiagnostics: FeatureUndefinedStepDiagnostic[];
};

/**
 * Single structural pass over `.feature` content: semantic spans and optional undefined-step
 * diagnostics (when `definitions` is provided). Aligns with {@link parseFeatureFile} structure.
 */
export function analyzeFeatureDocument(
  content: string,
  definitions?: StepDefinition[]
): AnalyzeFeatureDocumentResult {
  const lines = content.split(/\n/);
  const out: FeatureSemanticTokenSpan[] = [];
  const diagnostics: FeatureUndefinedStepDiagnostic[] = [];

  let previousKeyword: StepKeyword | null = null;
  let inFeature = false;
  let collectingBackground = false;
  let hadScenarioOrOutline = false;
  let inExamplesTable = false;
  let docDelim: '"""' | "```" | null = null;
  let inDocstring = false;

  const flushScenarioKeywords = (): void => {
    previousKeyword = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();

    if (inDocstring && docDelim) {
      const openCol = line.indexOf(docDelim);
      if (openCol >= 0) {
        pushDocstringLine(line, lineIndex, openCol, out);
        inDocstring = false;
        docDelim = null;
      } else {
        const t = line.trimStart();
        const start = t.length === 0 ? line.length : line.length - t.length;
        if (start < line.length) {
          out.push({
            line: lineIndex,
            start,
            length: line.length - start,
            kind: "docstring",
          });
        }
      }
      continue;
    }

    if (trimmed.startsWith("#") || trimmed === "") {
      if (trimmed.startsWith("#")) {
        pushComment(line, lineIndex, out);
      }
      continue;
    }

    if (inExamplesTable && !isTableRow(trimmed)) {
      inExamplesTable = false;
    }

    const openDoc = line.match(/^\s*(\"\"\"|```)/);
    if (openDoc && openDoc.index !== undefined) {
      const delim = openDoc[1] as '"""' | "```";
      const delimStart = openDoc.index + openDoc[0].indexOf(delim);
      const afterOpen = line.slice(delimStart + delim.length);
      const closeIdx = afterOpen.indexOf(delim);
      if (closeIdx >= 0) {
        const totalLen = delim.length + closeIdx + delim.length;
        out.push({
          line: lineIndex,
          start: delimStart,
          length: totalLen,
          kind: "docstring",
        });
      } else {
        inDocstring = true;
        docDelim = delim;
        pushDocstringLine(line, lineIndex, delimStart, out);
      }
      continue;
    }

    if (!inFeature) {
      if (isTagOnlyLine(trimmed)) {
        pushTagsLine(line, lineIndex, out);
        continue;
      }
      const fm = line.match(FEATURE_RE);
      if (fm) {
        pushKeywordTitle(line, lineIndex, "Feature:", fm[1].trim(), out);
        inFeature = true;
        collectingBackground = false;
        hadScenarioOrOutline = false;
        flushScenarioKeywords();
        inExamplesTable = false;
      }
      continue;
    }

    if (isTagOnlyLine(trimmed)) {
      pushTagsLine(line, lineIndex, out);
      continue;
    }

    if (isTableRow(trimmed)) {
      if (inExamplesTable || collectingBackground || hadScenarioOrOutline) {
        pushTableLineTokens(line, lineIndex, out);
      }
      continue;
    }

    if (RULE_RE.test(line)) {
      collectingBackground = false;
      hadScenarioOrOutline = false;
      flushScenarioKeywords();
      inExamplesTable = false;
      const rm = line.match(RULE_RE);
      if (rm) {
        pushKeywordTitle(line, lineIndex, "Rule:", rm[1].trim(), out);
      }
      continue;
    }

    const fm = line.match(FEATURE_RE);
    if (fm) {
      pushKeywordTitle(line, lineIndex, "Feature:", fm[1].trim(), out);
      collectingBackground = false;
      hadScenarioOrOutline = false;
      flushScenarioKeywords();
      inExamplesTable = false;
      continue;
    }

    const bgMatch = line.match(BACKGROUND_RE);
    if (bgMatch) {
      hadScenarioOrOutline = false;
      flushScenarioKeywords();
      collectingBackground = true;
      inExamplesTable = false;
      pushKeywordTitle(line, lineIndex, "Background:", bgMatch[1].trim(), out);
      continue;
    }

    const outlineMatch = line.match(SCENARIO_OUTLINE_RE);
    if (outlineMatch) {
      collectingBackground = false;
      hadScenarioOrOutline = true;
      flushScenarioKeywords();
      inExamplesTable = false;
      pushKeywordTitle(line, lineIndex, "Scenario Outline:", outlineMatch[1].trim(), out);
      continue;
    }

    const scenarioMatch = line.match(SCENARIO_RE);
    if (scenarioMatch) {
      collectingBackground = false;
      hadScenarioOrOutline = true;
      flushScenarioKeywords();
      inExamplesTable = false;
      pushKeywordTitle(line, lineIndex, "Scenario:", scenarioMatch[1].trim(), out);
      continue;
    }

    const examplesMatch = line.match(EXAMPLES_RE);
    if (examplesMatch) {
      inExamplesTable = true;
      flushScenarioKeywords();
      pushKeywordTitle(line, lineIndex, "Examples:", examplesMatch[1].trim(), out);
      continue;
    }

    if (
      line.match(/^\s*(Feature|Scenario|Scenario Outline|Background|Rule):/i)
    ) {
      flushScenarioKeywords();
      continue;
    }

    previousKeyword = processStepLine(
      line,
      lineIndex,
      previousKeyword,
      out,
      definitions,
      diagnostics
    );
  }

  out.sort((a, b) =>
    a.line !== b.line ? a.line - b.line : a.start !== b.start ? a.start - b.start : a.length - b.length
  );
  return {
    semanticSpans: dedupeSpans(out),
    undefinedStepDiagnostics: diagnostics,
  };
}

/**
 * Semantic highlight spans only (no definition matching).
 */
export function computeFeatureSemanticTokenSpans(content: string): FeatureSemanticTokenSpan[] {
  return analyzeFeatureDocument(content).semanticSpans;
}

function dedupeSpans(spans: FeatureSemanticTokenSpan[]): FeatureSemanticTokenSpan[] {
  const seen = new Set<string>();
  const next: FeatureSemanticTokenSpan[] = [];
  for (const s of spans) {
    const key = `${s.line}:${s.start}:${s.length}:${s.kind}`;
    if (!seen.has(key)) {
      seen.add(key);
      next.push(s);
    }
  }
  return next;
}
