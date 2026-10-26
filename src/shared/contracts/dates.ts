import { z } from "zod";

/*
 * The dates a request names. A date is a real calendar day as `YYYY-MM-DD`,
 * and a period runs forwards. The SQL compares dates as text, so anything
 * else would be misread rather than refused: every report contract, ours and
 * a project's (`@dbu6/app/server`), takes its dates from here, and the
 * frontend reads a date in the URL by the same rule.
 */

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD")
  .refine((value) => {
    // Date rolls 30 February over into March; a real date survives the trip.
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  }, "Not a date on the calendar");

const inOrder = (dates: { from_date?: string; to_date?: string }) =>
  dates.from_date === undefined ||
  dates.to_date === undefined ||
  dates.from_date <= dates.to_date;

const OUT_OF_ORDER = {
  message: "from_date must not be after to_date",
  path: ["from_date"],
};

/**
 * A report's period, either end of which may be left open: without both it
 * covers all time. A report adds its other parameters with `.extend`, which
 * keeps the order check.
 */
export const reportDateRange = z
  .object({ from_date: isoDate.optional(), to_date: isoDate.optional() })
  .refine(inOrder, OUT_OF_ORDER);

/** A report's period with both ends, for a report that always names them. */
export const requiredReportDateRange = z
  .object({ from_date: isoDate, to_date: isoDate })
  .refine(inOrder, OUT_OF_ORDER);

/** The day a balance report stands on. */
export const asOfDateQuery = z.object({ as_of_date: isoDate });
