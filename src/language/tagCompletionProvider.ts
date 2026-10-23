import * as vscode from "vscode";

const BUILT_IN_TAGS: { tag: string; doc: string }[] = [
  { tag: "@wip", doc: "Work In Progress: Marks scenarios under active development. Executed with `behave --wip`." },
  { tag: "@skip", doc: "Skip: Skips the scenario or feature during test execution." },
  { tag: "@smoke", doc: "Smoke: Fast critical-path test suite to verify essential build health." },
  { tag: "@regression", doc: "Regression: Comprehensive regression test suite." },
  { tag: "@sanity", doc: "Sanity: Quick verification of specific module functionality." },
  { tag: "@slow", doc: "Slow: Marks long-running scenarios to run in overnight or dedicated suites." },
  { tag: "@fast", doc: "Fast: Lightweight quick-execution scenarios." },
  { tag: "@integration", doc: "Integration: Tests multi-service or end-to-end integration flows." },
  { tag: "@unit", doc: "Unit: High-speed scenario verifying isolated BDD logic." },
  { tag: "@manual", doc: "Manual: Scenario intended for manual verification." },
  { tag: "@fixture", doc: "Fixture: Behave fixture setup/cleanup hook (e.g. `@fixture.browser.firefox`)." },
  { tag: "@xfail", doc: "Expected Failure: Marks a scenario that is currently expected to fail." },
  { tag: "@not_implemented", doc: "Not Implemented: Marks a scenario whose step definitions are not yet implemented." },
];

export class BehaveTagCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    const lineText = document.lineAt(position.line).text;
    const beforeCursor = lineText.slice(0, position.character);

    // Look for @ preceding cursor
    const atMatch = beforeCursor.match(/@(\w*)$/);
    if (!atMatch) {
      return [];
    }

    const tagStartCol = position.character - atMatch[0].length;
    const replaceRange = new vscode.Range(
      position.line,
      tagStartCol,
      position.line,
      position.character
    );

    const discoveredTags = new Set<string>();
    for (const b of BUILT_IN_TAGS) {
      discoveredTags.add(b.tag);
    }

    // Collect tags from all currently open feature documents and recent files
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "feature" || doc.fileName.endsWith(".feature")) {
        const text = doc.getText();
        const matches = text.match(/@[\w.-]+/g);
        if (matches) {
          for (const m of matches) {
            discoveredTags.add(m);
          }
        }
      }
    }

    // Also scan workspace files quickly if few tags discovered
    if (discoveredTags.size <= BUILT_IN_TAGS.length) {
      try {
        const files = await vscode.workspace.findFiles("**/*.feature", "**/node_modules/**", 15);
        for (const file of files) {
          const content = await vscode.workspace.fs.readFile(file);
          const str = Buffer.from(content).toString("utf-8");
          const matches = str.match(/@[\w.-]+/g);
          if (matches) {
            for (const m of matches) {
              discoveredTags.add(m);
            }
          }
        }
      } catch {
        // ignore read errors
      }
    }

    const items: vscode.CompletionItem[] = [];
    let sortIdx = 0;

    for (const tag of discoveredTags) {
      const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Keyword);
      item.range = replaceRange;
      item.insertText = tag;

      const builtIn = BUILT_IN_TAGS.find((b) => b.tag === tag);
      if (builtIn) {
        item.detail = "Behave Standard Tag";
        item.documentation = new vscode.MarkdownString(builtIn.doc);
        item.sortText = `0_${String(sortIdx++).padStart(4, "0")}`;
      } else {
        item.detail = "Workspace Tag";
        item.documentation = new vscode.MarkdownString(`Custom tag defined in workspace feature files. Run with \`behave --tags=${tag}\`.`);
        item.sortText = `1_${String(sortIdx++).padStart(4, "0")}`;
      }

      items.push(item);
    }

    return items;
  }
}
