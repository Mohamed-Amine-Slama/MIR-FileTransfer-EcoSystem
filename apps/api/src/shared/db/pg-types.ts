import { types } from 'pg';

/**
 * PostgreSQL type-parser configuration. Import this before any query runs.
 *
 * THE BUG THIS EXISTS TO PREVENT:
 *
 * By default `pg` turns a DATE column into a JavaScript `Date` at LOCAL
 * midnight. `date_of_birth` is a calendar date with no time and no timezone —
 * but the moment it becomes a `Date`, it acquires both. Formatting it with
 * `toISOString()` then converts to UTC, and on any server running east of UTC
 * that lands on the PREVIOUS DAY.
 *
 *   stored:     1985-06-15
 *   pg gives:   1985-06-15T00:00:00+02:00   (server in CEST)
 *   toISOString: 1985-06-14T22:00:00Z
 *   displayed:  1985-06-14                  <-- wrong, and silently so
 *
 * This is not cosmetic. P3.3 has the doctor confirm patient identity from name
 * AND date of birth; a DOB that shifts by a day depending on which server
 * answered the request undermines the one check standing between two people
 * being treated as one record. It would also disagree with the DOB printed on
 * the paperwork the patient carries across the border.
 *
 * A calendar date is returned as the string PostgreSQL stored. No conversion,
 * no timezone, no ambiguity.
 *
 * Note this does NOT apply to timestamptz (§6 requires those in UTC) — those
 * genuinely are instants and are left as Date objects.
 */

// DATE (oid 1082) -> keep as 'YYYY-MM-DD'
types.setTypeParser(types.builtins.DATE, (value: string) => value);

// int8/bigint (oid 20) -> keep as string rather than losing precision.
// imaging_instances.size_bytes and imaging_studies.total_bytes are bigint; a
// multi-gigabyte study is well inside Number.MAX_SAFE_INTEGER today, but
// silently truncating a byte count is the kind of thing that surfaces as a
// checksum mismatch nobody can explain.
types.setTypeParser(types.builtins.INT8, (value: string) => value);

export const PG_TYPES_CONFIGURED = true;
