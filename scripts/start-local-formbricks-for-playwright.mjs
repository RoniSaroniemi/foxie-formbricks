import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const repoRoot = process.cwd();
const appUrl = process.env.REPEATING_GROUP_LOCAL_APP_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.REPEATING_GROUP_LOCAL_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/formbricks?schema=public";
const redisUrl = process.env.REPEATING_GROUP_LOCAL_REDIS_URL ?? "redis://127.0.0.1:6379";
const appPort = new URL(appUrl).port || "3100";
const nextAuthSecret = process.env.NEXTAUTH_SECRET ?? "foxie-dev-secret-not-for-production-use";
const encryptionKey =
  process.env.ENCRYPTION_KEY ??
  "d28e6bda55b45e988a68416305c74e8b10c2daf52ab315ae3b06a389bcc706fe";
const cronSecret = process.env.CRON_SECRET ?? "foxie-dev-cron-secret";
const dockerComposeArgs = ["compose", "-f", "docker-compose.dev.yml"];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
    },
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const capture = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout.trim();
};

run("docker", [...dockerComposeArgs, "up", "-d", "postgres", "valkey"]);

const postgresContainerId = capture("docker", [...dockerComposeArgs, "ps", "-q", "postgres"]);
if (!postgresContainerId) {
  console.error("Unable to determine postgres container id for docker-compose.dev.yml");
  process.exit(1);
}

let postgresReady = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const readiness = spawnSync("docker", ["exec", postgresContainerId, "pg_isready", "-U", "postgres"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  if (readiness.status === 0) {
    postgresReady = true;
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (!postgresReady) {
  console.error("Postgres did not become ready in time.");
  process.exit(1);
}

const databaseExists = capture("docker", [
  "exec",
  postgresContainerId,
  "psql",
  "-U",
  "postgres",
  "-tAc",
  "SELECT 1 FROM pg_database WHERE datname = 'formbricks'",
]);

if (databaseExists !== "1") {
  run("docker", ["exec", postgresContainerId, "createdb", "-U", "postgres", "formbricks"]);
}

run("pnpm", ["--filter", "@formbricks/database", "generate"]);
run("pnpm", ["--filter", "@formbricks/database", "db:push"]);

const child = spawn("pnpm", ["--filter", "@formbricks/web", "exec", "next", "dev", "-p", appPort, "--turbopack"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    NEXTAUTH_URL: appUrl,
    WEBAPP_URL: appUrl,
    NEXTAUTH_SECRET: nextAuthSecret,
    ENCRYPTION_KEY: encryptionKey,
    CRON_SECRET: cronSecret,
    EMAIL_VERIFICATION_DISABLED: process.env.EMAIL_VERIFICATION_DISABLED ?? "1",
    PASSWORD_RESET_DISABLED: process.env.PASSWORD_RESET_DISABLED ?? "1",
  },
});

const closeChild = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => closeChild("SIGINT"));
process.on("SIGTERM", () => closeChild("SIGTERM"));
process.on("exit", () => closeChild("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
