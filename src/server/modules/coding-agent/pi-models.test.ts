import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configuredPiModels,
  parsePiListModels,
  piDefaultModel,
  piModelOrder,
} from "./pi-models.js";

const DEEPSEEK = { model: "~deepseek/deepseek-flash-latest", label: "DeepSeek Flash" };
const GLM = { model: "~z-ai/glm-latest", label: "GLM" };
const KIMI = { model: "~moonshotai/kimi-latest", label: "Kimi" };
const SOL = { model: "openai-codex/gpt-5.6-sol", label: "GPT-5.6 Sol" };
const TERRA = { model: "openai-codex/gpt-5.6-terra", label: "GPT-5.6 Terra" };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dbu6-pi-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("piModelOrder", () => {
  it("puts Pi's default first, then the preferred models, then the fallbacks", () => {
    const custom = { model: "openrouter/sample-model", label: "Sample" };

    expect(piModelOrder(custom)).toEqual([
      custom,
      DEEPSEEK,
      GLM,
      KIMI,
      SOL,
      TERRA,
    ]);
  });

  it("keeps one entry when the default is already preferred", () => {
    expect(piModelOrder(DEEPSEEK)).toEqual([
      DEEPSEEK,
      GLM,
      KIMI,
      SOL,
      TERRA,
    ]);
  });

  it("falls back to the preferred models and the ChatGPT ones with no default", () => {
    expect(piModelOrder(null)).toEqual([DEEPSEEK, GLM, KIMI, SOL, TERRA]);
  });
});

describe("parsePiListModels", () => {
  it("reads the provider/model pairs from Pi's table", () => {
    const stdout = [
      "provider      model                      context  max-out  thinking  images",
      "openai-codex  gpt-5.6-terra              272K     128K     yes       yes",
      "openrouter    ~deepseek/deepseek-flash-latest  1.0M  943.7K  yes      yes",
      "",
    ].join("\n");

    const configured = parsePiListModels(stdout);

    expect(configured.has("gpt-5.6-terra")).toBe(true);
    expect(configured.has("openai-codex/gpt-5.6-terra")).toBe(true);
    expect(configured.has("~deepseek/deepseek-flash-latest")).toBe(true);
    expect(configured.has("openrouter/~deepseek/deepseek-flash-latest")).toBe(
      true,
    );
    expect(configured.has("provider")).toBe(false);
    expect(configured.has("model")).toBe(false);
  });
});

describe("configuredPiModels", () => {
  const candidates = [DEEPSEEK, GLM, KIMI, SOL, TERRA];

  it("keeps only the models whose provider has credentials in Pi", () => {
    const configured = parsePiListModels(
      "openrouter  ~z-ai/glm-latest  1.0M  131.1K  yes  no\n",
    );

    expect(configuredPiModels(candidates, configured)).toEqual([GLM]);
  });

  it("keeps every candidate when none of them are configured", () => {
    expect(configuredPiModels(candidates, new Set())).toEqual(candidates);
  });
});

describe("piDefaultModel", () => {
  async function writeSettings(settings: unknown) {
    await writeFile(join(dir, "settings.json"), JSON.stringify(settings));
  }

  it("reads Pi's default model and names it", async () => {
    await writeSettings({
      defaultProvider: "openrouter",
      defaultModel: "~deepseek/deepseek-flash-latest",
    });

    expect(await piDefaultModel()).toEqual(DEEPSEEK);
  });

  it("qualifies a bare model id with Pi's default provider", async () => {
    await writeSettings({
      defaultProvider: "openrouter",
      defaultModel: "sample-model",
    });

    expect(await piDefaultModel()).toEqual({
      model: "openrouter/sample-model",
      label: "openrouter/sample-model",
    });
  });

  it("is null with no settings, no default, or malformed JSON", async () => {
    expect(await piDefaultModel()).toBeNull();

    await writeSettings({ defaultProvider: "openrouter" });
    expect(await piDefaultModel()).toBeNull();

    await writeFile(join(dir, "settings.json"), "not json");
    expect(await piDefaultModel()).toBeNull();
  });
});
