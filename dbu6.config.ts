import { defineConfig, type Dbu6App, type LoadCategorizer } from "@dbu6/app/server";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Register Windows ESM path normalization hook if present
try {
  const hookPath = pathToFileURL(join(import.meta.dirname, "scripts", "esm-loader.mjs")).href;
  register(hookPath, import.meta.url);
} catch {
  // Ignore if already registered
}

/**
 * Read an environment variable from process.env or fallback to .env.development / .env files.
 */
function readEnvVar(keys: string[]): string | null {
  for (const key of keys) {
    if (process.env[key]) return process.env[key]!;
  }

  for (const envFile of [".env.development", ".env"]) {
    try {
      const p = join(import.meta.dirname, envFile);
      if (existsSync(p)) {
        const text = readFileSync(p, "utf-8");
        for (const rawLine of text.split("\n")) {
          const line = rawLine.trim();
          if (line.startsWith("#") || !line.includes("=")) continue;
          for (const key of keys) {
            const prefix = `${key}=`;
            if (line.startsWith(prefix)) {
              let val = line.slice(prefix.length).trim();
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1).trim();
              }
              if (val) return val;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Retrieve Gemini API key from process environment or local env files.
 */
export function getGeminiApiKey(): string | null {
  return readEnvVar(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
}

/**
 * Dynamically resolve the Gemini model for a given task:
 * - categorization: GEMINI_CATEGORIZATION_MODEL or GEMINI_MODEL (defaults to "gemini-3.8-flash")
 * - session: GEMINI_SESSION_MODEL or GEMINI_MODEL (defaults to "gemini-3.1-pro-preview")
 */
export function getGeminiModel(task: "categorization" | "session" = "categorization"): string {
  if (task === "categorization") {
    return readEnvVar(["GEMINI_CATEGORIZATION_MODEL", "GEMINI_MODEL"]) || "gemini-3.8-flash";
  }
  return readEnvVar(["GEMINI_SESSION_MODEL", "GEMINI_MODEL"]) || "gemini-3.1-pro-preview";
}

/**
 * Call Google Gemini API with structured JSON output for categorizing transactions.
 */
async function callGeminiList<Name extends string>(
  request: {
    prompt: string;
    rows: readonly { id: string; text: string }[];
    output: { name: Name };
  }
): Promise<{ ok: true; rows: ({ id: string | number } & Record<Name, string>)[] } | { ok: false; error: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: "Google Gemini API key not found. Please set GEMINI_API_KEY in environment or .env.development.",
    };
  }

  const configuredModel = getGeminiModel("categorization");
  const fallbackModels = ["gemini-flash-lite-latest", "gemini-3.1-flash-lite"];
  const modelsToTry = [configuredModel, ...fallbackModels.filter((m) => m !== configuredModel)];
  const outputField = request.output.name;
  const userContent = `${request.prompt}\n\nPlease categorize each transaction below and return a JSON array of objects where each object has:\n- "id": string (the transaction ID)\n- "${outputField}": string (the exact matched account name from the accounts list, or empty string if uncertain/uncategorized)\n\nTransactions to categorize:\n${JSON.stringify(request.rows, null, 2)}`;

  let lastError = "";

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: userContent }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING" },
                [outputField]: { type: "STRING" },
              },
              required: ["id", outputField],
            },
          },
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        lastError = `Gemini API error (${response.status} ${response.statusText}): ${errText.slice(0, 300)}`;
        if (response.status === 429 || response.status === 404) {
          console.warn(`[dbu6-gemini] Model ${model} returned ${response.status}, attempting fallback model...`);
          continue;
        }
        return {
          ok: false,
          error: lastError,
        };
      }

      const data = (await response.json()) as any;
      const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        lastError = "Gemini API returned an empty response or unexpected structure.";
        continue;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(candidateText);
      } catch (parseErr) {
        return {
          ok: false,
          error: `Failed to parse Gemini response as JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        };
      }

      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: "Gemini API response is not a JSON array as required.",
        };
      }

      const rows = parsed.map((item: any) => ({
        id: item.id,
        [outputField]: typeof item[outputField] === "string" ? item[outputField].trim() : "",
      })) as ({ id: string | number } & Record<Name, string>)[];

      return {
        ok: true,
        rows,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: false,
    error: lastError,
  };
}

/** Normalize narrations before matching */
function normalizeNarration(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

const VPA_REGEX = /^[^\s@]+@[^\s@]+$/;
const VPA_CHAR = /[A-Z0-9.]/;

function containsVpa(narration: string, vpa: string): boolean {
  let from = 0;
  for (;;) {
    const at = narration.indexOf(vpa, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : narration[at - 1];
    const after = narration[at + vpa.length] ?? "";
    if (!VPA_CHAR.test(before) && !VPA_CHAR.test(after)) return true;
    from = at + 1;
  }
}

/** Load and compile user-config/transaction_mappings.mjs rules */
async function loadClassifier() {
  const mappingsFile = join(import.meta.dirname, "user-config", "transaction_mappings.mjs");
  if (!existsSync(mappingsFile)) {
    return (_tx: any) => null;
  }

  const url = pathToFileURL(mappingsFile).href;
  const mod = await import(url);
  const rules = mod.mappings as {
    exact?: Record<string, string>;
    includes?: Array<{
      account: string;
      direction?: "withdrawal" | "deposit";
      amount?: { min?: number; max?: number };
      values: string[];
    }>;
  };

  const exactMap = new Map<string, string>();
  const vpaMap = new Map<string, string>();
  if (rules?.exact) {
    for (const [narration, account] of Object.entries(rules.exact)) {
      const norm = normalizeNarration(narration);
      exactMap.set(norm, account);
      if (VPA_REGEX.test(norm)) {
        vpaMap.set(norm, account);
      }
    }
  }

  const flattenedIncludes: Array<{
    account: string;
    direction?: "withdrawal" | "deposit";
    amount?: { min?: number; max?: number };
    value: string;
  }> = [];

  if (Array.isArray(rules?.includes)) {
    for (const rule of rules.includes) {
      if (Array.isArray(rule.values)) {
        for (const val of rule.values) {
          flattenedIncludes.push({
            account: rule.account,
            direction: rule.direction,
            amount: rule.amount,
            value: normalizeNarration(val),
          });
        }
      }
    }
  }

  return (tx: { narration: string; deposit?: number; withdrawal?: number }): any => {
    const narration = normalizeNarration(tx.narration || "");
    const exact = exactMap.get(narration);
    if (exact) return exact;

    for (const [vpa, account] of vpaMap) {
      if (containsVpa(narration, vpa)) return account;
    }

    const dep = typeof tx.deposit === "number" ? tx.deposit : 0;
    const withdr = typeof tx.withdrawal === "number" ? tx.withdrawal : 0;
    const dir: "withdrawal" | "deposit" = dep > 0 ? "deposit" : "withdrawal";
    const moved = dep > 0 ? dep : withdr;

    for (const inc of flattenedIncludes) {
      if (inc.direction && inc.direction !== dir) continue;
      if (inc.amount) {
        if (inc.amount.min !== undefined && moved < inc.amount.min) continue;
        if (inc.amount.max !== undefined && moved > inc.amount.max) continue;
      }
      if (narration.includes(inc.value)) {
        return inc.account;
      }
    }

    return null;
  };
}

/** Load account instruction prompt files */
function loadCustomMappings(customMappingsFilenames: readonly string[]): string {
  const userConfig = join(import.meta.dirname, "user-config");
  const pieces: string[] = [];
  for (const filename of customMappingsFilenames) {
    const fullPath = join(userConfig, filename);
    if (existsSync(fullPath)) {
      try {
        pieces.push(readFileSync(fullPath, "utf-8"));
      } catch {
        // ignore unreadable
      }
    }
  }
  return pieces.join("\n\n");
}

const categorizerLoader: LoadCategorizer = async (settings) => {
  const model = getGeminiModel("categorization");
  let classifierFn: (tx: any) => any;
  try {
    classifierFn = await loadClassifier();
  } catch (err) {
    return {
      classify: { ok: false, error: err },
      customMappings: { ok: false, error: err },
      llm: {
        agent: null,
        name: `Google Gemini (${model})`,
        caller: {
          ready: false,
          reason: "Failed to load transaction mappings",
        },
      },
    };
  }

  const customMappingsText = loadCustomMappings(settings.customMappingsFilenames);

  return {
    classify: { ok: true, value: classifierFn },
    customMappings: { ok: true, value: customMappingsText },
    llm: {
      agent: null,
      name: `Google Gemini (${model})`,
      caller: {
        ready: true,
        maxRowsPerCall: 50,
        async confirmUnavailable() {
          const apiKey = getGeminiApiKey();
          if (!apiKey) return "GEMINI_API_KEY is not configured";
          return null;
        },
        async pauseBetweenCalls() {
          await new Promise((resolve) => setTimeout(resolve, 500));
        },
        client: {
          list: callGeminiList,
        },
      },
    },
  };
};

export default defineConfig({
  loadCategorizer: categorizerLoader,
  extend(app: Dbu6App) {
    const userConfigDir = join(import.meta.dirname, "user-config");

    // Helper to get all prompt files from user-config/
    const getPromptFiles = () => {
      if (!existsSync(userConfigDir)) return [];
      const files = readdirSync(userConfigDir);
      return files
        .filter((f) => f.endsWith(".prompt") || f.endsWith(".txt"))
        .map((f) => {
          const fullPath = join(userConfigDir, f);
          const stat = statSync(fullPath);
          const content = readFileSync(fullPath, "utf-8");
          const isSystem = f.toLowerCase() === "custom_mappings_default.prompt" || f.toLowerCase().startsWith("system_");
          return {
            filename: f,
            name: f.replace(/\.(prompt|txt)$/, "").replace(/[_-]/g, " "),
            content,
            isSystem,
            updatedAt: stat.mtime.toISOString(),
          };
        });
    };

    // GET /api/custom-prompts - List all prompts or get a specific one
    app.hono.get("/api/custom-prompts", async (c) => {
      try {
        const requestedFile = c.req.query("file");
        const prompts = getPromptFiles();

        if (requestedFile) {
          const found = prompts.find((p) => p.filename.toLowerCase() === requestedFile.toLowerCase());
          if (!found) {
            return c.json({ ok: false, error: `Prompt file '${requestedFile}' not found.` }, 404);
          }
          return c.json({ ok: true, prompt: found });
        }

        return c.json({
          ok: true,
          prompts,
        });
      } catch (err) {
        return c.json({
          ok: false,
          error: `Failed to retrieve custom prompts: ${err instanceof Error ? err.message : String(err)}`,
        }, 500);
      }
    });

    // POST /api/custom-prompts - Save new or edited custom prompt to user-config/
    app.hono.post("/api/custom-prompts", async (c) => {
      try {
        const body = (await c.req.json()) as { filename?: string; content?: string };
        const rawFilename = (body.filename || "").trim();
        const content = typeof body.content === "string" ? body.content : "";

        if (!rawFilename) {
          return c.json({ ok: false, error: "Filename is required." }, 400);
        }

        // Auto-append .prompt extension if missing
        let safeFilename = rawFilename;
        if (!safeFilename.endsWith(".prompt") && !safeFilename.endsWith(".txt")) {
          safeFilename = `${safeFilename}.prompt`;
        }

        // Strict sanitization: alphanumeric, hyphens, underscores, dots only; prevent path traversal
        if (safeFilename.includes("..") || safeFilename.includes("/") || safeFilename.includes("\\") || !/^[a-zA-Z0-9_\-.]+\.(prompt|txt)$/.test(safeFilename)) {
          return c.json({
            ok: false,
            error: "Invalid filename. Only alphanumeric characters, dashes, underscores, and dots are permitted.",
          }, 400);
        }

        // Critical defense-in-depth: Protect core system prompt from direct overwrite
        const normalized = safeFilename.toLowerCase();
        if (normalized === "custom_mappings_default.prompt" || normalized.startsWith("system")) {
          return c.json({
            ok: false,
            error: "Built-in system prompt cannot be directly modified. Please use a unique custom filename.",
          }, 400);
        }

        const targetPath = join(userConfigDir, safeFilename);
        writeFileSync(targetPath, content, "utf-8");

        return c.json({
          ok: true,
          filename: safeFilename,
          message: `Custom prompt '${safeFilename}' saved successfully.`,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        return c.json({
          ok: false,
          error: `Failed to save custom prompt: ${err instanceof Error ? err.message : String(err)}`,
        }, 500);
      }
    });

    // CORS preflight handler
    app.hono.options("/api/custom-prompts", (c) => {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      return c.body(null, 204);
    });
  },
});
