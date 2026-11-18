// @CORE: Identify added or changed lines in the modified side of a text diff.
// @TODO: Test and verify insertions, replacements, repeated lines, and bounded fallback behavior.
export function changedLineNumbers(originalText: string, modifiedText: string): Set<number> {
  const original = originalText.split(/\r\n|\n|\r/);
  const modified = modifiedText.split(/\r\n|\n|\r/);
  let prefix = 0;
  while (prefix < original.length && prefix < modified.length && original[prefix] === modified[prefix]) prefix++;
  let suffix = 0;
  while (suffix < original.length - prefix && suffix < modified.length - prefix &&
         original[original.length - suffix - 1] === modified[modified.length - suffix - 1]) suffix++;

  const oldMiddle = original.slice(prefix, original.length - suffix);
  const newMiddle = modified.slice(prefix, modified.length - suffix);
  if (!newMiddle.length) return new Set();
  if (!oldMiddle.length) return new Set(newMiddle.map((_, index) => prefix + index));
  const rows = oldMiddle.length + 1;
  const columns = newMiddle.length + 1;

  // Bounded exact LCS; on pathological unmatched regions (>1M cells), hide diff matches until input changes.
  if (rows * columns > 1_000_000) return new Set();

  const lcs = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let i = oldMiddle.length - 1; i >= 0; i--) {
    for (let j = newMiddle.length - 1; j >= 0; j--) {
      lcs[i][j] = oldMiddle[i] === newMiddle[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const changed = new Set<number>();
  let i = 0;
  let j = 0;
  while (j < newMiddle.length) {
    if (i < oldMiddle.length && oldMiddle[i] === newMiddle[j]) {
      i++;
      j++;
    } else if (i < oldMiddle.length && lcs[i + 1][j] > lcs[i][j + 1]) {
      i++;
    } else {
      changed.add(prefix + j);
      j++;
    }
  }
  return changed;
}
