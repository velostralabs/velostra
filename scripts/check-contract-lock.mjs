import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = resolve(
  repositoryRoot,
  process.argv[2] ?? "contracts/package-lock.json",
);
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") {
  throw new Error("contracts/package-lock.json must be a valid npm lockfile v3");
}

const platformSpecificRequired = Object.entries(lock.packages)
  .filter(([, metadata]) => Array.isArray(metadata?.os) && metadata.optional !== true)
  .map(([packagePath, metadata]) => ({
    packagePath,
    supportedOs: metadata.os,
  }));

if (platformSpecificRequired.length > 0) {
  throw new Error(
    `Platform-specific packages must remain optional: ${JSON.stringify(platformSpecificRequired)}`,
  );
}

const packagePaths = Object.keys(lock.packages);
const localPathKeys = packagePaths.filter((packagePath) =>
  /(?:^|[\\/])(?:Users|home)[\\/]/i.test(packagePath),
);
const serialized = JSON.stringify(lock);
const hasLocalFileDependency =
  /file:(?:\.\.[\\/])+(?:Users|home)[\\/]/i.test(serialized) ||
  /file:[A-Za-z]:[\\/]/.test(serialized);

if (localPathKeys.length > 0 || hasLocalFileDependency) {
  throw new Error("Contract lockfile contains a machine-local dependency path");
}

const nestedFsevents = lock.packages["node_modules/ganache/node_modules/fsevents"];
if (nestedFsevents && nestedFsevents.optional !== true) {
  throw new Error("Ganache fsevents must stay optional for Linux/Windows npm ci");
}

process.stdout.write(
  `CONTRACT LOCKFILE PORTABILITY PASSED (${packagePaths.length} package records)\n`,
);
