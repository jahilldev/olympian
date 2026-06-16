#!/usr/bin/env node
// Builds the Hermes agent sandbox image and writes the required env vars into
// api/.env. Docker is the recommended sandbox mode: every agent invocation runs
// in an isolated container with only the job directory and HERMES_HOME mounted.

import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--home") args.home = argv[++i];
    else if (a === "--image") args.image = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function log(msg) {
  console.log(`  ${msg}`);
}
function section(msg) {
  console.log(`\n${msg}`);
}

/** Replace KEY=... lines in place (preserving comments/order); append missing keys. */
function upsertEnv(envPath, updates) {
  const examplePath = join(REPO_ROOT, "api", ".env.example");
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    log(`created ${rel(envPath)} from .env.example`);
  }
  const raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = raw.length ? raw.split("\n") : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  writeFileSync(envPath, next.join("\n").replace(/\n*$/, "\n"));
}

function rel(p) {
  return p.startsWith(REPO_ROOT) ? p.slice(REPO_ROOT.length + 1) : p;
}

function commandExists(cmd) {
  try {
    return execSync(`command -v ${cmd}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: npm run hermes:docker -- [--home <path>] [--image <name>]",
    );
    return;
  }

  const envPath = join(REPO_ROOT, "api", ".env");
  const hermesHome = resolve(args.home ?? join(REPO_ROOT, "api", ".hermes"));
  mkdirSync(hermesHome, { recursive: true });

  const image = args.image ?? "hermes-agent:latest";

  if (!commandExists("docker")) {
    console.error("\nDocker is required but was not found on PATH.");
    process.exit(1);
  }

  section(`Building agent image ${image} from api/Dockerfile.agent …`);
  try {
    execSync(`docker build -f api/Dockerfile.agent -t ${image} api`, {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  } catch {
    console.error(
      `\nImage build failed. Confirm the Hermes install line in api/Dockerfile.agent, then re-run.`,
    );
    process.exit(1);
  }

  upsertEnv(envPath, {
    SANDBOX_MODE: "default",
    DOCKER_AGENT_IMAGE: image,
    HERMES_HOME: hermesHome,
  });

  log(`wrote settings to ${rel(envPath)}`);

  section("Next steps");
  log("Set your model and provider in api/.env:");
  log("  HERMES_PRIMARY_MODEL=<model>");
  log("  HERMES_PRIMARY_PROVIDER=<provider>");
  log(
    "  HERMES_MODEL_BASE_URL=http://localhost:11434/v1  # if using a local endpoint",
  );
  log("Then start the service:  npm run dev");
  console.log("");
}

main();
