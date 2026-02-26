const fs = require("node:fs");
const path = require("node:path");
const { writeConfigFile } = require("./generate-config.js");

const DIST_DIR = path.resolve(process.cwd(), "dist");

const STATIC_FILES = [
  "index.html",
  "styles.css",
  "main.js",
  "auth.js",
  "storage.js",
  "products.js",
  "records.js",
  "targets.js",
  "reports.js",
  "ai-chat-ui.js",
  "analytics-engine.js",
];

const STATIC_DIRS = ["vendor"];

function ensurePathExists(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`[build-pages] Missing required path: ${relativePath}`);
  }
  return absolutePath;
}

function copyStaticAssets() {
  for (const relativeFile of STATIC_FILES) {
    const sourcePath = ensurePathExists(relativeFile);
    const destinationPath = path.join(DIST_DIR, relativeFile);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }

  for (const relativeDir of STATIC_DIRS) {
    const sourcePath = ensurePathExists(relativeDir);
    const destinationPath = path.join(DIST_DIR, relativeDir);
    fs.cpSync(sourcePath, destinationPath, {
      recursive: true,
      dereference: true,
      force: true,
    });
  }
}

function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  copyStaticAssets();
  const configPath = writeConfigFile(path.join(DIST_DIR, "config.js"));

  console.log(`[build-pages] Prepared Pages assets at ${DIST_DIR}`);
  console.log(`[build-pages] Wrote runtime config to ${configPath}`);
}

main();
