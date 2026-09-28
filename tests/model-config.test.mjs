import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_ID, MODELS, findModel, resolveConfiguredModel } from "../lib/models.ts";

test("retired Novita model resolves to the supported default", () => {
  const retired = "deepseek/deepseek-v3.2";
  assert.equal(DEFAULT_MODEL_ID, "deepseek/deepseek-v4.1-flash");
  assert.equal(MODELS.some(model => model.id === retired), false);
  assert.equal(resolveConfiguredModel(retired), DEFAULT_MODEL_ID);
  assert.equal(findModel(retired).id, DEFAULT_MODEL_ID);
  assert.equal(findModel(DEFAULT_MODEL_ID).provider, "novita");
});

test("default migration preserves custom operator model overrides", () => {
  assert.equal(resolveConfiguredModel(undefined), DEFAULT_MODEL_ID);
  assert.equal(resolveConfiguredModel(""), DEFAULT_MODEL_ID);
  assert.equal(resolveConfiguredModel("custom/provider-model"), "custom/provider-model");
  assert.equal(resolveConfiguredModel("gpt-4o"), "gpt-4o");
});
