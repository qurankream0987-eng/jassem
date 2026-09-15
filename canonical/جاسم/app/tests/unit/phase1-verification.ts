import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function pass(msg: string) { console.log(`${GREEN}PASS${RESET} ${msg}`); }
function fail(msg: string) { console.log(`${RED}FAIL${RESET} ${msg}`); process.exitCode = 1; }

console.log("============================================================");
console.log("   JASIM PHASE 1 -- CRITICAL FIX VERIFICATION");
console.log("============================================================\n");

const taskRuntimePath = join(__dirname, "../../api/core/task-runtime.ts");
const source = readFileSync(taskRuntimePath, "utf-8");

// CHECK 1: No empty {} passed to capabilityRegistry.execute()
const capEmptyMatches = source.match(/capabilityRegistry\.execute\s*\([^,]+,\s*\{\}\s*,/g) || [];
if (capEmptyMatches.length === 0) {
  pass("No empty {} passed to capabilityRegistry.execute()");
} else {
  fail(`Found ${capEmptyMatches.length} occurrences of {} passed to capabilityRegistry.execute()`);
}

// CHECK 2: stepInputs variable is passed to capabilityRegistry.execute()
const capInputMatches = source.match(/capabilityRegistry\.execute\s*\([^,]+,\s*stepInputs\s*,/g) || [];
if (capInputMatches.length > 0) {
  pass(`stepInputs is passed to capabilityRegistry.execute() (${capInputMatches.length} occurrences)`);
} else {
  fail("stepInputs is NOT passed to capabilityRegistry.execute()");
}

// CHECK 3: No empty {} passed to toolRuntime.invoke()
const toolEmptyMatches = source.match(/toolRuntime\.invoke\s*\([^,]+,\s*\{\}\s*,/g) || [];
if (toolEmptyMatches.length === 0) {
  pass("No empty {} passed to toolRuntime.invoke()");
} else {
  fail(`Found ${toolEmptyMatches.length} occurrences of {} passed to toolRuntime.invoke()`);
}

// CHECK 4: stepInputs variable is passed to toolRuntime.invoke()
const toolInputMatches = source.match(/toolRuntime\.invoke\s*\([^,]+,\s*stepInputs\s*,/g) || [];
if (toolInputMatches.length > 0) {
  pass(`stepInputs is passed to toolRuntime.invoke() (${toolInputMatches.length} occurrences)`);
} else {
  fail("stepInputs is NOT passed to toolRuntime.invoke()");
}

// CHECK 5: No llmRouter.process() calls
const processMatches = source.match(/llmRouter\.process\s*\(/g) || [];
if (processMatches.length === 0) {
  pass("No broken llmRouter.process() calls found");
} else {
  fail(`Found ${processMatches.length} broken llmRouter.process() calls`);
}

// CHECK 6: llmRouter.route() is used
const routeMatches = source.match(/llmRouter\.route\s*\(/g) || [];
if (routeMatches.length > 0) {
  pass(`llmRouter.route() is used for LLM fallback (${routeMatches.length} occurrences)`);
} else {
  fail("llmRouter.route() is NOT used for LLM fallback");
}

// CHECK 7: DAG builder uses step.dependencies
const depsMatches = source.match(/step\.dependencies/g) || [];
const dependsOnMatches = source.match(/step\.dependsOn/g) || [];
if (depsMatches.length > 0 && dependsOnMatches.length === 0) {
  pass(`DAG builder uses step.dependencies (${depsMatches.length} refs), no step.dependsOn`);
} else {
  fail(`DAG builder still references step.dependsOn (${dependsOnMatches.length} refs)`);
}

// CHECK 8: TypeScript compilation
console.log("");
try {
  const result = execSync("npx tsc -p tsconfig.server.json --noEmit 2>&1", {
    cwd: join(__dirname, "../.."),
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const taskRuntimeErrors = result.split("\n").filter((line: string) => line.includes("task-runtime.ts"));
  if (taskRuntimeErrors.length === 0) {
    pass("task-runtime.ts compiles with 0 TypeScript errors");
  } else {
    fail(`task-runtime.ts has ${taskRuntimeErrors.length} TypeScript errors`);
    taskRuntimeErrors.forEach((e: string) => console.log("    " + e));
  }
} catch (e: any) {
  // tsc returns exit code 2 when there are errors, but we still want to parse output
  const result = e.stdout || e.message || "";
  const taskRuntimeErrors = result.split("\n").filter((line: string) => line.includes("task-runtime.ts"));
  if (taskRuntimeErrors.length === 0) {
    pass("task-runtime.ts compiles with 0 TypeScript errors");
  } else {
    fail(`task-runtime.ts has ${taskRuntimeErrors.length} TypeScript errors`);
    taskRuntimeErrors.forEach((e: string) => console.log("    " + e));
  }
}

// CHECK 9: Build succeeds
try {
  execSync("npm run build", {
    cwd: join(__dirname, "../.."),
    encoding: "utf-8",
    stdio: "pipe",
  });
  pass("Build completes successfully");
} catch (e: any) {
  fail(`Build failed: ${e.message}`);
}

// CHECK 10: No references to non-existent taskStepDependencies table
const missingTableMatches = source.match(/taskStepDependencies/g) || [];
if (missingTableMatches.length === 0) {
  pass("No references to non-existent taskStepDependencies table");
} else {
  fail(`Found ${missingTableMatches.length} references to missing taskStepDependencies table`);
}

console.log("\n============================================================");
console.log("   VERIFICATION COMPLETE");
console.log("============================================================");
