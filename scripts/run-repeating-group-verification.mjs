import { spawnSync } from "node:child_process";

const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
const mode = modeArg?.split("=")[1] ?? "all";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const run = (args, options = {}) => {
  const result = spawnSync(npxCommand, args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!["all", "harness", "real"].includes(mode)) {
  console.error(`Unsupported mode "${mode}". Use --mode=all, --mode=harness, or --mode=real.`);
  process.exit(1);
}

run(["turbo", "run", "build", "--filter=@formbricks/surveys"]);
run(["playwright", "install", "chromium"]);

if (mode === "harness") {
  run(["playwright", "test", "-c", "playwright.repeating-group.config.ts", "--grep", "@repeating-group-harness"]);
} else if (mode === "real") {
  run(["playwright", "test", "-c", "playwright.repeating-group.real.config.ts", "--grep", "@repeating-group-real"]);
} else {
  run(["playwright", "test", "-c", "playwright.repeating-group.config.ts"]);
  run(["playwright", "test", "-c", "playwright.repeating-group.real.config.ts", "--grep", "@repeating-group-real"]);
}
