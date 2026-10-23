import fs from "node:fs";
import path from "node:path";

const versionArg = process.argv[2];
if (!versionArg) {
  console.error("Usage: node scripts/extract-changelog.mjs <version-or-tag> [output-path]");
  process.exit(1);
}

const cleanVersion = versionArg.replace(/^v/, "").trim();
const changelogPath = path.resolve(process.cwd(), "CHANGELOG.md");
const outputPath = path.resolve(process.cwd(), process.argv[3] || "RELEASE_NOTES.md");

if (!fs.existsSync(changelogPath)) {
  console.error(`CHANGELOG.md not found at ${changelogPath}`);
  process.exit(1);
}

const content = fs.readFileSync(changelogPath, "utf-8");
const lines = content.split(/\r?\n/);

let recording = false;
const sectionLines = [];

for (const line of lines) {
  const versionMatch = line.match(/^##\s+\[?v?([0-9]+\.[0-9]+\.[0-9]+[^\]]*)\]?/);
  if (versionMatch) {
    const versionFound = versionMatch[1].trim();
    if (versionFound.startsWith(cleanVersion)) {
      recording = true;
      continue;
    } else if (recording) {
      break;
    }
  }

  if (recording) {
    sectionLines.push(line);
  }
}

let result = sectionLines.join("\n").trim();
if (!result) {
  console.warn(`Warning: No changelog section found for version ${cleanVersion}`);
  result = `### Soqaro ${versionArg}\n\n多平台客户端正式发布。详见项目 CHANGELOG.md。`;
}

fs.writeFileSync(outputPath, result + "\n", "utf-8");
console.log(`Release notes extracted to ${outputPath} (${result.length} characters)`);
