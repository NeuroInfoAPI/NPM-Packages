import { existsSync, readFileSync, writeFileSync } from "node:fs";

const output = new URL("../../packages/core/dist/NeuroInfoAPI-Client.js", import.meta.url);
if (!existsSync(output) && process.argv.includes("-IfExists")) process.exit(0);

const manifest = JSON.parse(readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8"));
const source = readFileSync(output, "utf8");
const pattern = /^const clientVersion = "[^"]+";/m;
if (!pattern.test(source)) throw new Error("Client version constant not found in compiled client.");

const updated = source.replace(pattern, () => "const clientVersion = " + JSON.stringify(manifest.version) + ";");
if (updated !== source) writeFileSync(output, updated);
