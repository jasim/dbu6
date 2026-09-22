// What a report's `contract.ts` is written with. The file is read on both
// sides (the route registers it, the screen's client calls it), so this is
// all `dbu6/server` holds in a browser: package.json's `browser` condition
// points that specifier here, and the frontend host's source mode does the
// same by alias. `dbu6/server` re-exports every name below, so the types a
// project sees are the same on both sides.
//
// Keep it free of anything that needs Node.
export { z } from "zod";
export { initContract } from "@sapporta/rest-core";
export { errorBodySchema } from "@sapporta/shared/contracts";
export {
  gridDatasetSchema,
  type GridDataset,
  type GridDatasetColumn,
  type GridDatasetFooterRow,
  type GridDatasetLevel,
  type GridDatasetNode,
} from "@sapporta/shared/grid-dataset";
export type { NavLink } from "@sapporta/shared/contracts";
