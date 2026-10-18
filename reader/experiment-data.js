export function experimentValue(value, limit = 8192) {
  const seen = new Set();
  function check(v, depth = 0) {
    if (depth > 12) throw new Error("Experiment state is too deep");
    if (v === null || typeof v === "boolean" || typeof v === "string") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (!v || typeof v !== "object" || seen.has(v))
      throw new Error("Experiment state must be finite JSON");
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error("Experiment state must use plain objects");
    seen.add(v);
    const entries = Object.entries(v);
    if (entries.length > 512)
      throw new Error("Experiment state has too many fields");
    for (const [key, item] of entries) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("Invalid experiment field");
      check(item, depth + 1);
    }
    seen.delete(v);
  }
  check(value);
  const text = JSON.stringify(value);
  if (text.length * 2 > limit)
    throw new Error("Experiment state exceeds its size limit");
  return JSON.parse(text);
}
