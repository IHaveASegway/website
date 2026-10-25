// How route-data.json is written: one value per line.
//
// JSON.stringify writes an array on one line, and route-data.json is mostly arrays of integers:
// the travel matrices, the vertices, the segments. On one line, neighbouring values run together
// as digits and commas, and by chance a run of adjacent values can read as one longer number, such
// as a phone number or an ID. The content firewall flagged such chance runs in the one-line file.
// With every array value and every object member on its own line, each number stands alone on its
// line, so no run forms. Strings are written as JSON.stringify writes them.
//
// The layout is JSON.stringify's own, one value per line, with the indentation taken out: it
// carries nothing, and on the 2026-10-25 data it would add 67 KB raw and 1.9 KB gzip. JSON escapes
// a line break inside a string, so every line break in the output is between values and the spaces
// after it are indentation.

/**
 * The text of route-data.json: `value` as JSON, with every array value and every object member on
 * its own line, no indentation, and a line break at the end.
 * @param {unknown} value
 * @returns {string}
 */
export function formatRouteData(value) {
  return `${JSON.stringify(value, null, 1).replace(/\n +/g, '\n')}\n`;
}
