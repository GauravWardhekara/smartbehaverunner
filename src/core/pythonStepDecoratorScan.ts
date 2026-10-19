import { tryParseBehaveStepDecoratorLine } from "./pythonStepDecorators";

const FUNCTION_DEF_REGEX = /^\s*def\s+\w+\s*\(/;

export function isPythonFunctionDefinitionLine(line: string): boolean {
  return FUNCTION_DEF_REGEX.test(line);
}

/**
 * Walk upward from the line above `functionLine` and collect Behave step decorators
 * (@given/@when/@then/@step) until a non-decorator boundary is hit.
 */
export function collectBehaveStepDecoratorsAboveFunction(
  lines: string[],
  functionLine: number
): Array<{ keyword: string; pattern: string }> {
  const decorators: Array<{ keyword: string; pattern: string }> = [];

  for (let i = functionLine - 1; i >= 0; i--) {
    const lineText = lines[i] ?? "";

    if (lineText.match(/^\s*(#.*)?$/)) {
      continue;
    }

    const decoratorInfo = tryParseBehaveStepDecoratorLine(lineText);
    if (decoratorInfo) {
      decorators.push(decoratorInfo);
      continue;
    }

    if (lineText.match(/^\s*@\w+/)) {
      continue;
    }

    break;
  }

  return decorators;
}
