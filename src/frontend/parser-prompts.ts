// The parts of a coding-agent prompt about parsers and the import presets,
// the same wherever the app asks for one: /import when it can't read a file,
// and /add's Teach card. Each screen writes its own task around them. How a
// parser is written, fixed or parted from another is in the playbooks
// (`unrecognized-statement`, `ambiguous-parsers`) and the parser guides; how
// the presets change is in the books guide.

/** Which saved parsers turned a file down, as a fact line. */
export function triedParsers(candidateParserPaths: readonly string[]): string {
  return candidateParserPaths.length === 0
    ? "Parsers tried: none for this file type"
    : `Parsers that rejected it: ${candidateParserPaths.join(", ")}`;
}
