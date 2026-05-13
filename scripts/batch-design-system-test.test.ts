import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  dedupeDesignSystemIds,
  resolveDryRunDesignSystems,
  validateExplicitDesignSystemIds,
} from "./batch-design-system-test.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("dedupeDesignSystemIds trims and preserves first-seen order", () => {
  assert.deepEqual(dedupeDesignSystemIds([" default ", "kami", "default", "", "kami "]), ["default", "kami"]);
});

test("validateExplicitDesignSystemIds rejects unknown design system ids", () => {
  assert.throws(
    () => validateExplicitDesignSystemIds(["default", "typo"], ["default", "kami"]),
    /unknown design system id\(s\): typo/,
  );
});

test("validateExplicitDesignSystemIds returns the normalized explicit ids when all exist", () => {
  assert.deepEqual(validateExplicitDesignSystemIds([" default ", "kami", "default"], ["default", "kami"]), ["default", "kami"]);
});

test("resolveDryRunDesignSystems normalizes explicit ids without daemon access", () => {
  assert.deepEqual(resolveDryRunDesignSystems({ designSystems: [" default ", "kami", "default"] }), ["default", "kami"]);
});

test("resolveDryRunDesignSystems rejects --all-design-systems in dry-run mode", () => {
  assert.throws(
    () => resolveDryRunDesignSystems({ allDesignSystems: true }),
    /dry-run with --all-design-systems still requires daemon access/,
  );
});

test("CLI dry-run with explicit design systems succeeds without daemon discovery", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(HERE, "batch-design-system-test.ts"),
      "--prompt",
      "Test prompt",
      "--design-systems",
      "default,kami",
      "--dry-run",
    ],
    {
      cwd: path.resolve(HERE, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        OD_DAEMON_URL: "",
        OD_PORT: "",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /design systems \(2\): default, kami/);
  assert.doesNotMatch(result.stdout + result.stderr, /cannot determine daemon URL/);
});
