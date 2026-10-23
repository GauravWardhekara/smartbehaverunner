import * as cp from "child_process";
import { getPythonInterpreterPath } from "./python";

export interface LanguageRuntimeInfo {
  id: string;
  name: string;
  icon: string;
  command: string;
  framework: string;
  fileExtension: string;
  defaultGlueGlobs: string[];
  installed: boolean;
  version: string;
  details?: string;
  status: "ready" | "not_installed" | "warning";
}

function execCommand(
  cmd: string,
  timeoutMs = 4000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    cp.exec(cmd, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        stdout: (stdout || "").trim(),
        stderr: (stderr || "").trim(),
        code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
      });
    });
  });
}

export async function probeAllLanguageRuntimes(
  activeDocumentPath?: string,
  workspaceRoot?: string
): Promise<LanguageRuntimeInfo[]> {
  const probes = [
    probePython(activeDocumentPath, workspaceRoot),
    probeNode(),
    probeJava(),
    probeDotNet(),
    probeRuby(),
    probePhp(),
    probeRust(),
    probeGo(),
  ];

  const results = await Promise.allSettled(probes);
  return results.map((r, i) => {
    if (r.status === "fulfilled") {
      return r.value;
    }
    const def = RUNTIME_DEFINITIONS[i];
    return {
      ...def,
      installed: false,
      version: "Probe error",
      details: String(r.reason),
      status: "warning",
    };
  });
}

const RUNTIME_DEFINITIONS: Omit<LanguageRuntimeInfo, "installed" | "version" | "status" | "details">[] = [
  {
    id: "python",
    name: "Python (Behave)",
    icon: "🐍",
    command: "python --version",
    framework: "Behave / Cucumber-Py",
    fileExtension: ".py",
    defaultGlueGlobs: ["features/**/*.py", "tests/**/*.py", "steps/**/*.py"],
  },
  {
    id: "javascript",
    name: "JavaScript / TypeScript",
    icon: "🟨",
    command: "node --version",
    framework: "Cucumber.js / Playwright / WebdriverIO",
    fileExtension: ".js, .ts, .jsx, .tsx",
    defaultGlueGlobs: ["features/**/*.js", "features/**/*.ts", "src/test/**/*.ts"],
  },
  {
    id: "java",
    name: "Java (Cucumber-JVM)",
    icon: "☕",
    command: "java -version",
    framework: "Cucumber-JVM / TestNG / JUnit",
    fileExtension: ".java",
    defaultGlueGlobs: ["src/test/**/*.java"],
  },
  {
    id: "csharp",
    name: "C# / .NET (Reqnroll / SpecFlow)",
    icon: "🔷",
    command: "dotnet --version",
    framework: "Reqnroll / SpecFlow / Cucumber .NET",
    fileExtension: ".cs",
    defaultGlueGlobs: ["*specs*/**/*.cs", "Features/**/*.cs"],
  },
  {
    id: "ruby",
    name: "Ruby (Cucumber)",
    icon: "💎",
    command: "ruby --version",
    framework: "Cucumber-Ruby",
    fileExtension: ".rb",
    defaultGlueGlobs: ["features/**/*.rb"],
  },
  {
    id: "php",
    name: "PHP (Behat)",
    icon: "🐘",
    command: "php --version",
    framework: "Behat",
    fileExtension: ".php",
    defaultGlueGlobs: ["features/**/*.php"],
  },
  {
    id: "rust",
    name: "Rust (cucumber-rs)",
    icon: "🦀",
    command: "rustc --version",
    framework: "cucumber-rs",
    fileExtension: ".rs",
    defaultGlueGlobs: ["tests/**/*.rs", "features/**/*.rs"],
  },
  {
    id: "go",
    name: "Go (Godog)",
    icon: "🐹",
    command: "go version",
    framework: "Godog",
    fileExtension: ".go",
    defaultGlueGlobs: ["features/**/*_test.go", "*_test.go"],
  },
];

async function probePython(activeDoc?: string, wsFolder?: string): Promise<LanguageRuntimeInfo> {
  const py = getPythonInterpreterPath(activeDoc || "", wsFolder || "");
  const baseDef = RUNTIME_DEFINITIONS[0];

  let version = "";
  let installed = false;
  let details = "";

  if (py.path) {
    const res = await execCommand(`"${py.path}" --version`);
    if (res.code === 0 && (res.stdout || res.stderr)) {
      installed = true;
      version = (res.stdout || res.stderr).replace(/^Python\s*/i, "").trim();
      details = `Interpreter: ${py.path} (${py.source})`;

      // Probe behave CLI
      const behaveRes = await execCommand(`"${py.path}" -m behave --version`);
      if (behaveRes.code === 0) {
        const bVer = (behaveRes.stdout || behaveRes.stderr).trim();
        details += ` • Behave: ${bVer}`;
      }
    }
  }

  if (!installed) {
    const fallback = await execCommand("python --version");
    if (fallback.code === 0) {
      installed = true;
      version = (fallback.stdout || fallback.stderr).replace(/^Python\s*/i, "").trim();
      details = "Resolved from system PATH";
    }
  }

  return {
    ...baseDef,
    installed,
    version: version || "Not detected",
    details: details || "Please select a Python interpreter in VS Code",
    status: installed ? "ready" : "not_installed",
  };
}

async function probeNode(): Promise<LanguageRuntimeInfo> {
  const baseDef = RUNTIME_DEFINITIONS[1];
  const res = await execCommand("node --version");
  const installed = res.code === 0 && Boolean(res.stdout);
  let details = "";
  if (installed) {
    const npmRes = await execCommand("npm --version");
    details = npmRes.code === 0 ? `npm v${npmRes.stdout}` : "Node.js runtime";
  }
  return {
    ...baseDef,
    installed,
    version: installed ? res.stdout : "Not detected",
    details: details || "Install Node.js to run Cucumber.js tests",
    status: installed ? "ready" : "not_installed",
  };
}

async function probeJava(): Promise<LanguageRuntimeInfo> {
  const baseDef = RUNTIME_DEFINITIONS[2];
  // java -version writes to stderr
  const res = await execCommand("java -version");
  const output = res.stderr || res.stdout;
  const match = output.match(/version\s*"?([0-9._]+)/i) || output.match(/openjdk\s*"?([0-9._]+)/i);
  const installed = Boolean(match);
  return {
    ...baseDef,
    installed,
    version: match ? match[1] : (installed ? "Installed" : "Not detected"),
    details: installed ? output.split(/\r?\n/)[0] : "Install JDK to run Cucumber-JVM tests",
    status: installed ? "ready" : "not_installed",
  };
}

async function probeDotNet(): Promise<LanguageRuntimeInfo> {
  const baseDef = RUNTIME_DEFINITIONS[3];
  const res = await execCommand("dotnet --version");
  const installed = res.code === 0 && Boolean(res.stdout);
  return {
    ...baseDef,
    installed,
    version: installed ? res.stdout.split(/\r?\n/)[0] : "Not detected",
    details: installed ? ".NET SDK ready for Reqnroll/SpecFlow" : "Install .NET SDK for C# BDD",
    status: installed ? "ready" : "not_installed",
  };
}

async function probeRuby(): Promise<LanguageRuntimeInfo> {
  const baseDef = RUNTIME_DEFINITIONS[4];
  const res = await execCommand("ruby --version");
  const installed = res.code === 0 && Boolean(res.stdout);
  const match = res.stdout.match(/ruby\s+([0-9.p]+)/i);
  return {
    ...baseDef,
    installed,
    version: match ? match[1] : (installed ? res.stdout.split(/\r?\n/)[0] : "Not detected"),
    details: installed ? res.stdout.split(/\r?\n/)[0] : "Install Ruby for Cucumber-Ruby",
    status: installed ? "ready" : "not_installed",
  };
}

async function probePhp(): Promise<LanguageRuntimeInfo> {
  const baseDef = RUNTIME_DEFINITIONS[5];
  const res = await execCommand("php --version");
  const installed = res.code === 0 && Boolean(res.stdout);
  const match = res.stdout.match(/PHP\s+([0-9.]+)/i);
  return {
    ...baseDef,
    installed,
    version: match ? match[1] : (installed ? "Installed" : "Not detected"),
    details: installed ? "PHP CLI available for Behat" : "Install PHP for Behat testing",
    status: installed ? "ready" : "not_installed",
  };
}

async function probeRust(): Promise<LanguageRuntimeInfo> {
  const baseDef = RUNTIME_DEFINITIONS[6];
  const res = await execCommand("rustc --version");
  const installed = res.code === 0 && Boolean(res.stdout);
  const match = res.stdout.match(/rustc\s+([0-9.]+)/i);
  return {
    ...baseDef,
    installed,
    version: match ? match[1] : (installed ? "Installed" : "Not detected"),
    details: installed ? "Rust toolchain available for cucumber-rs" : "Install Rust for cucumber-rs",
    status: installed ? "ready" : "not_installed",
  };
}

async function probeGo(): Promise<LanguageRuntimeInfo> {
  const baseDef = RUNTIME_DEFINITIONS[7];
  const res = await execCommand("go version");
  const installed = res.code === 0 && Boolean(res.stdout);
  const match = res.stdout.match(/go\s*version\s*go([0-9.]+)/i);
  return {
    ...baseDef,
    installed,
    version: match ? match[1] : (installed ? "Installed" : "Not detected"),
    details: installed ? "Go toolchain available for Godog" : "Install Go for Godog testing",
    status: installed ? "ready" : "not_installed",
  };
}
