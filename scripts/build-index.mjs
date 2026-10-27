#!/usr/bin/env node
// Validates every tools/<id>/tool.yaml against the schema and writes dist/index.json.
//   node scripts/build-index.mjs           # validate + build
//   node scripts/build-index.mjs --check   # validate only (use in PR CI)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, statSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import Ajv from "ajv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const SCHEMA_VERSION = 1;

const registry = YAML.parse(readFileSync(join(root, "registry.yaml"), "utf8"));
const baseUrl = (process.env.REGISTRY_BASE_URL || registry.publishUrl || "").replace(/\/$/, "");
const schema = JSON.parse(readFileSync(join(root, "schema", "tool.schema.json"), "utf8"));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

const errors = [];
const tools = [];
const hostPorts = {};
const toolsDir = join(root, "tools");

for (const dir of readdirSync(toolsDir).sort()) {
  if (dir.startsWith("_") || dir.startsWith(".")) continue;
  const folder = join(toolsDir, dir);
  if (!statSync(folder).isDirectory()) continue;
  const file = join(folder, "tool.yaml");
  if (!existsSync(file)) {
    errors.push(`${dir}: missing tool.yaml`);
    continue;
  }
  let tool;
  try {
    tool = YAML.parse(readFileSync(file, "utf8"));
  } catch (e) {
    errors.push(`${dir}/tool.yaml: ${e.message}`);
    continue;
  }
  if (!validate(tool)) {
    for (const err of validate.errors) errors.push(`${dir}/tool.yaml ${err.instancePath || "/"} ${err.message}`);
    continue;
  }
  if (tool.id !== dir) errors.push(`${dir}/tool.yaml: id '${tool.id}' must match folder name`);
  for (const pattern of [tool.source?.asset, tool.detect?.pattern].filter(Boolean)) {
    try {
      new RegExp(pattern);
    } catch {
      errors.push(`${dir}/tool.yaml: invalid regex ${pattern}`);
    }
  }
  // ${option} references must point at declared options.
  const optionIds = new Set((tool.options ?? []).map((o) => o.id));
  if (optionIds.size !== (tool.options ?? []).length) errors.push(`${dir}: duplicate option ids`);
  for (const o of tool.options ?? []) {
    if (o.type === "port" && !(Number(o.default) >= 1 && Number(o.default) <= 65535)) errors.push(`${dir}: option ${o.id} default must be a port number`);
    if (o.type === "select" && o.choices?.length && !o.choices.includes(o.default)) errors.push(`${dir}: option ${o.id} default must be one of its choices`);
  }
  const refs = [...JSON.stringify({ source: tool.source, run: tool.run ?? [] }).matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
  for (const r of new Set(refs)) if (!optionIds.has(r)) errors.push(`${dir}: \${${r}} is used but no option has id '${r}'`);

  // Note default host ports so clashes between Docker tools can be reported.
  const defaults = Object.fromEntries((tool.options ?? []).map((o) => [o.id, o.default ?? ""]));
  for (const p of (tool.run ?? []).filter((r) => r.type === "docker").flatMap((r) => r.ports ?? [])) {
    const spec = p.replace(/\$\{([^}]+)\}/g, (_, id) => defaults[id] ?? "");
    const parts = spec.split("/")[0].split(":");
    if (parts.length >= 2) (hostPorts[parts[parts.length - 2]] ??= []).push(dir);
  }

  if (tool.install.type === "npm-global" && tool.source.type !== "npm") errors.push(`${dir}: npm-global needs an npm source`);
  if (tool.install.type === "docker-pull" && tool.source.type !== "docker") errors.push(`${dir}: docker-pull needs a docker source`);
  if (tool.install.type === "winget" && tool.source.type !== "winget") errors.push(`${dir}: winget install needs a winget source`);

  // Local icon / README files are published next to index.json and linked absolutely.
  for (const field of ["icon", "readme"]) {
    if (tool[field] && !/^https?:\/\//.test(tool[field])) {
      const local = join(folder, tool[field]);
      if (isAbsolute(tool[field]) || !existsSync(local)) {
        errors.push(`${dir}: ${field} file '${tool[field]}' not found`);
        continue;
      }
      if (!checkOnly) {
        mkdirSync(join(root, "dist", "tools", dir), { recursive: true });
        copyFileSync(local, join(root, "dist", "tools", dir, tool[field]));
      }
      tool[field] = baseUrl ? `${baseUrl}/tools/${dir}/${tool[field]}` : undefined;
    }
  }
  if (!tool.readme && existsSync(join(folder, "README.md")) && !checkOnly) {
    mkdirSync(join(root, "dist", "tools", dir), { recursive: true });
    copyFileSync(join(folder, "README.md"), join(root, "dist", "tools", dir, "README.md"));
    if (baseUrl) tool.readme = `${baseUrl}/tools/${dir}/README.md`;
  }
  tools.push(tool);
}

for (const [port, users] of Object.entries(hostPorts)) {
  if (users.length > 1) console.warn(`! default host port ${port} is shared by ${users.join(", ")} (fine unless they run together; users can change it in Configure)`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}

if (checkOnly) {
  console.log(`✓ ${tools.length} tool manifests valid`);
  process.exit(0);
}

const index = {
  schemaVersion: SCHEMA_VERSION,
  registry: {
    id: registry.id,
    name: registry.name,
    description: registry.description,
    homepage: registry.homepage || undefined,
    maintainers: registry.maintainers ?? [],
  },
  generatedAt: new Date().toISOString(),
  tools,
};
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`✓ wrote dist/index.json with ${tools.length} tools`);
