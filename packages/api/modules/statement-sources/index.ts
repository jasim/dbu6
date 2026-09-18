// The statement-sources module: the saved parsers that recognize an uploaded
// statement, the import presets, and the plan for an automatic import. Import
// from here rather than from the files.
export {
  recognizeStatementFile,
  savedCustomStatementParserPaths,
} from "./statement-recognition.js";
export { readImportPresets, type ImportPreset } from "./import-presets.js";
export {
  planAutoImport,
  type AutoImportGroup,
  type FileRecognition,
  type PlannedFile,
} from "./auto-import-plan.js";
