import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { load } from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedSpec: Record<string, unknown> | undefined;

/** Carrega openapi.yaml (raiz do pacote) uma única vez e reaproveita entre requisições. */
export function loadOpenApiSpec(): Record<string, unknown> {
  if (!cachedSpec) {
    const raw = readFileSync(path.resolve(__dirname, "../../openapi.yaml"), "utf-8");
    cachedSpec = load(raw) as Record<string, unknown>;
  }
  return cachedSpec;
}
