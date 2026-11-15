// Packs and publishes the workspace packages. Used by .github/workflows/publish.yml
// (npm Trusted Publishing via OIDC, no token or 2FA prompt needed).
// Usage: node scripts/helpers/publish.mjs (always all packages)
// Expects `npm run build` to have run. Identical, already published versions are skipped.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const registry = "https://registry.npmjs.org/";
const repository = "https://github.com/NeuroInfoAPI/NPM-Packages.git";
const order = ["core", "native", "node", "bun"];

const selected = order;

const run = promisify(execFile);
// On Windows npm.cmd would need a shell; run npm's JS entry point with node instead.
const npmCommand = process.platform === "win32" ? [process.execPath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : ["npm"];
async function npm(args) {
  try {
    const { stdout, stderr } = await run(npmCommand[0], [...npmCommand.slice(1), ...args], { maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, output: (stdout + stderr).trim(), stdout };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || error.message, stdout: error.stdout ?? "" };
  }
}

const manifests = Object.fromEntries(order.map((name) => [name, JSON.parse(readFileSync(new URL(`../../packages/${name}/package.json`, import.meta.url), "utf8"))]));
for (const name of order) {
  const manifest = manifests[name];
  if (manifest.name !== `@neuroinfoapi-client/${name}` || manifest.private || !manifest.version) throw new Error(`Invalid release manifest for packages/${name}.`);
  if (manifest.repository?.url !== repository) throw new Error(`packages/${name} must have repository.url ${repository} (required for provenance).`);
  if (name !== "core" && manifest.dependencies?.["@neuroinfoapi-client/core"] !== manifests.core.version) {
    throw new Error(`${name} must depend on the exact local core version ${manifests.core.version}.`);
  }
}

function distTag(version) {
  const prerelease = /-([0-9A-Za-z-]+)/.exec(version)?.[1];
  if (!prerelease) return "latest";
  return /^[0-9]+$/.test(prerelease) ? "next" : prerelease;
}

async function publishedIntegrity(id) {
  const result = await npm(["view", id, "dist.integrity", "--json", "--prefer-online", `--registry=${registry}`]);
  if (result.ok) return JSON.parse(result.stdout);
  if (/E404/.test(result.output)) return null;
  throw new Error(`Registry check failed for ${id}: ${result.output}`);
}

const releaseDirectory = mkdtempSync(join(tmpdir(), "nia-release-"));
try {
  const artifacts = {};
  for (const name of selected) {
    const packed = await npm(["pack", `./packages/${name}`, "--json", "--ignore-scripts", "--pack-destination", releaseDirectory]);
    if (!packed.ok) throw new Error(`npm pack failed for ${name}: ${packed.output}`);
    const artifact = JSON.parse(packed.stdout)[0];
    for (const required of ["dist/index.js", "dist/index.d.ts", "LICENSE"]) {
      if (!artifact.files.some((file) => file.path === required)) throw new Error(`${name} package is missing ${required}.`);
    }
    artifacts[name] = artifact;
    console.log(`Prepared ${artifact.id} (${artifact.entryCount} files).`);
  }

  const integrities = await Promise.all(selected.map((name) => publishedIntegrity(artifacts[name].id)));
  const pending = [];
  selected.forEach((name, index) => {
    const artifact = artifacts[name];
    if (integrities[index] === null) pending.push(name);
    else if (integrities[index] !== artifact.integrity) throw new Error(`${artifact.id} already exists with different contents. Bump its version before publishing.`);
    else console.log(`${artifact.id} already has identical contents; skipping.`);
  });

  // All uploads run in parallel; Trusted Publishing needs no token and adds provenance automatically.
  const results = await Promise.all(
    pending.map(async (name) => {
      const artifact = artifacts[name];
      const tag = distTag(manifests[name].version);
      console.log(`Publishing ${artifact.id} with tag ${tag}...`);
      const upload = await npm(["publish", join(releaseDirectory, artifact.filename), "--access", "public", "--tag", tag, "--ignore-scripts", `--registry=${registry}`]);
      if (upload.ok) return { id: artifact.id, ok: true };
      // A failed upload may still be a conflict with an identical, already accepted release.
      if ((await publishedIntegrity(artifact.id).catch(() => null)) === artifact.integrity) return { id: artifact.id, ok: true, note: "already published with identical contents" };
      return { id: artifact.id, ok: false, output: upload.output };
    }),
  );
  for (const result of results) {
    if (result.ok) console.log(`Published ${result.id}${result.note ? ` (${result.note})` : ""}.`);
    else console.error(`npm publish failed for ${result.id}:\n${result.output}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) throw new Error(`Publishing failed for: ${failed.map((result) => result.id).join(", ")}. Rerun the workflow; identical versions are skipped.`);
  console.log("Release complete.");
} finally {
  rmSync(releaseDirectory, { recursive: true, force: true });
}
