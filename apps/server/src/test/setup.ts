import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const originalFallbackPath = process.env.AUTH_FAKE_PERSIST_PATH;
let currentFallbackPath: string | null = null;

beforeEach(() => {
  currentFallbackPath = `.tmp/test-auth-fallback-${process.env.JEST_WORKER_ID ?? "0"}-${randomUUID()}.json`;
  process.env.AUTH_FAKE_PERSIST_PATH = currentFallbackPath;
});

afterEach(async () => {
  const pathToRemove = currentFallbackPath;
  currentFallbackPath = null;

  if (originalFallbackPath === undefined) {
    delete process.env.AUTH_FAKE_PERSIST_PATH;
  } else {
    process.env.AUTH_FAKE_PERSIST_PATH = originalFallbackPath;
  }

  if (pathToRemove) {
    await rm(resolve(process.cwd(), pathToRemove), { force: true });
  }
});
