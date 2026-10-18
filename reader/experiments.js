// Immutable JSON only. The reader owns persistence; models own schema and validation.
import { experimentValue } from "./experiment-data.js";
export { experimentValue };

export function createExperiments({
  read = () => null,
  write = () => {},
  chapterId,
  signal,
  delay = 180,
}) {
  const dirty = new Map(),
    active = new Map();
  let timer,
    closed = false;
  function saved() {
    try {
      const value = experimentValue(read() ?? {}, 131072);
      return value.version === 1 &&
        value.values &&
        typeof value.values === "object" &&
        !Array.isArray(value.values)
        ? value.values
        : {};
    } catch {
      return {};
    }
  }
  function flush() {
    clearTimeout(timer);
    if (!dirty.size) return;
    const values = { ...saved() };
    for (const [key, value] of dirty) {
      delete values[key];
      values[key] = value;
    }
    const keys = Object.keys(values);
    while (keys.length > 128 || JSON.stringify(values).length * 2 > 131000)
      delete values[keys.shift()];
    try {
      write({ version: 1, values }, Object.fromEntries(dirty));
    } catch {
      /* Storage is optional, including opaque origins. */
    }
    dirty.clear();
  }
  function session(component, occurrence, container) {
    const key = JSON.stringify([chapterId, component, occurrence]);
    let describe, lastSaved;
    const result = {
      load() {
        const value = dirty.has(key) ? dirty.get(key) : saved()[key];
        return value === undefined ? undefined : experimentValue(value);
      },
      save(value) {
        if (closed || signal?.aborted) return;
        const copy = experimentValue(value);
        const encoded = JSON.stringify(copy);
        if (encoded === lastSaved) return;
        lastSaved = encoded;
        dirty.delete(key);
        dirty.set(key, copy);
        clearTimeout(timer);
        timer = setTimeout(flush, delay);
      },
      describe(capture) {
        if (!closed) describe = capture;
      },
    };
    active.set(key, {
      container,
      capture: () => {
        if (!describe || closed) return null;
        try {
          return {
            ...experimentValue(describe(), 16384),
            component,
            instance: occurrence,
          };
        } catch {
          return null;
        }
      },
    });
    return result;
  }
  function snapshots(container) {
    if (closed) return [];
    return [...active.values()]
      .filter((entry) => {
        if (container) return entry.container === container;
        const rect = entry.container.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      })
      .map((entry) => entry.capture())
      .filter(Boolean);
  }
  signal?.addEventListener(
    "abort",
    () => {
      flush();
      closed = true;
      active.clear();
    },
    { once: true },
  );
  return { session, snapshots, flush };
}
