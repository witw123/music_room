import { readFileSync } from "node:fs";

function parseKeys(path) {
  const content = readFileSync(path, "utf8");
  return new Set(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.split("=", 1)[0]?.trim())
      .filter(Boolean)
  );
}

const rootEnvKeys = parseKeys(".env.example");
const productionEnvKeys = parseKeys("deploy/linux/.env.production.example");

const missingInProduction = [...rootEnvKeys].filter((key) => !productionEnvKeys.has(key));
const missingInRoot = [...productionEnvKeys].filter((key) => !rootEnvKeys.has(key));

if (missingInProduction.length === 0 && missingInRoot.length === 0) {
  console.log("Environment templates are in sync.");
  process.exit(0);
}

if (missingInProduction.length > 0) {
  console.error(
    `Missing in deploy/linux/.env.production.example: ${missingInProduction.join(", ")}`
  );
}

if (missingInRoot.length > 0) {
  console.error(`Missing in .env.example: ${missingInRoot.join(", ")}`);
}

process.exit(1);
