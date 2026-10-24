export const MEASUREMENT_TOOLS = Object.freeze({
  DISTANCE: "distance",
  ANGLE: "angle",
  POLYLINE: "polyline",
  RECTANGLE: "rectangle",
  ELLIPSE: "ellipse",
  ARROW: "arrow",
  TEXT: "text",
});

export const MEASUREMENT_PLANES = Object.freeze({
  AXIAL: "axial",
  CORONAL: "coronal",
  SAGITTAL: "sagittal",
  PANORAMIC: "panoramic",
});

const POINT_COUNTS = Object.freeze({
  distance: { min: 2, max: 2 },
  angle: { min: 3, max: 3 },
  polyline: { min: 2, max: Number.POSITIVE_INFINITY },
  rectangle: { min: 2, max: 2 },
  ellipse: { min: 2, max: 2 },
  arrow: { min: 2, max: 2 },
  text: { min: 1, max: 1 },
});

const DEFAULT_UNITS = Object.freeze({
  distance: "mm",
  angle: "deg",
  polyline: "mm",
  rectangle: "mm2",
  ellipse: "mm2",
  arrow: "mm",
  text: "text",
});

let fallbackIdCounter = 0;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if (Array.isArray(value) || isPlainObject(value)) {
    Object.values(value).forEach((entry) => deepFreeze(entry));
    Object.freeze(value);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function normalizeNow(now) {
  const value = typeof now === "function" ? now() : now;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError("now() returned an invalid Date.");
    }
    return value.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new RangeError("now() returned an invalid timestamp.");
    }
    return date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  throw new TypeError("now() must return an ISO string, number, or Date.");
}

function normalizeTimestamp(value, fallback, label) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError(`${label} must be a valid date.`);
    }
    return value.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new RangeError(`${label} must be a valid date.`);
    }
    return date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  throw new TypeError(`${label} must be a valid timestamp.`);
}

function normalizePoint(point, index) {
  if (
    !point ||
    typeof point !== "object" ||
    typeof point.x !== "number" ||
    !Number.isFinite(point.x) ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.y)
  ) {
    throw new TypeError(
      `points[${index}] must contain finite image-space x and y coordinates.`,
    );
  }
  return { x: point.x, y: point.y };
}

export function createMeasurementId(prefix = "measurement") {
  const normalizedPrefix =
    String(prefix)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-") || "measurement";

  if (globalThis.crypto?.randomUUID) {
    return `${normalizedPrefix}-${globalThis.crypto.randomUUID()}`;
  }

  fallbackIdCounter += 1;
  const randomPart =
    globalThis.crypto?.getRandomValues
      ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")
      : Math.random().toString(36).slice(2);

  return [
    normalizedPrefix,
    Date.now().toString(36),
    fallbackIdCounter.toString(36),
    randomPart,
  ].join("-");
}

export function normalizeMeasurement(
  input,
  { now = () => new Date().toISOString(), idGenerator = createMeasurementId } = {},
) {
  if (!isPlainObject(input)) {
    throw new TypeError("Measurement must be an object.");
  }

  const tool = requireNonEmptyString(input.tool, "tool").toLowerCase();
  const pointRule = POINT_COUNTS[tool] ?? {
    min: 1,
    max: Number.POSITIVE_INFINITY,
  };

  if (!Array.isArray(input.points)) {
    throw new TypeError("points must be an array.");
  }
  if (
    input.points.length < pointRule.min ||
    input.points.length > pointRule.max
  ) {
    throw new RangeError(
      `${tool} requires ${pointRule.min}${
        pointRule.max === Number.POSITIVE_INFINITY
          ? "+"
          : pointRule.max === pointRule.min
            ? ""
            : `-${pointRule.max}`
      } point(s).`,
    );
  }

  const sliceIndex = Number(input.sliceIndex);
  if (!Number.isInteger(sliceIndex) || sliceIndex < 0) {
    throw new RangeError("sliceIndex must be a non-negative integer.");
  }

  if (
    input.style !== undefined &&
    (!isPlainObject(input.style) || Array.isArray(input.style))
  ) {
    throw new TypeError("style must be a plain object.");
  }

  if (
    input.value !== undefined &&
    input.value !== null &&
    typeof input.value !== "number" &&
    typeof input.value !== "string"
  ) {
    throw new TypeError("value must be a number, string, null, or undefined.");
  }
  if (typeof input.value === "number" && !Number.isFinite(input.value)) {
    throw new RangeError("Numeric measurement values must be finite.");
  }

  const generatedAt = normalizeNow(now);
  const createdAt = normalizeTimestamp(input.createdAt, generatedAt, "createdAt");
  const updatedAt = normalizeTimestamp(input.updatedAt, createdAt, "updatedAt");
  const id =
    input.id === undefined || input.id === null || input.id === ""
      ? idGenerator()
      : requireNonEmptyString(input.id, "id");

  return {
    id,
    studyId: requireNonEmptyString(input.studyId, "studyId"),
    seriesId: requireNonEmptyString(input.seriesId, "seriesId"),
    plane: requireNonEmptyString(input.plane, "plane"),
    sliceIndex,
    tool,
    points: input.points.map((point, index) => normalizePoint(point, index)),
    value: input.value ?? null,
    unit:
      input.unit === undefined || input.unit === null
        ? (DEFAULT_UNITS[tool] ?? "")
        : requireNonEmptyString(input.unit, "unit"),
    style: deepClone(input.style ?? {}),
    createdAt,
    updatedAt,
  };
}

function freezeMeasurements(measurements) {
  return deepFreeze(deepClone(measurements));
}

function filterMeasurements(measurements, filter) {
  if (!filter || typeof filter !== "object") {
    return measurements.slice();
  }

  const hasPlane = filter.plane !== undefined && filter.plane !== null;
  const hasSlice =
    filter.sliceIndex !== undefined && filter.sliceIndex !== null;

  if (hasSlice && (!Number.isInteger(filter.sliceIndex) || filter.sliceIndex < 0)) {
    throw new RangeError("sliceIndex filter must be a non-negative integer.");
  }

  return measurements.filter(
    (measurement) =>
      (!hasPlane || measurement.plane === filter.plane) &&
      (!hasSlice || measurement.sliceIndex === filter.sliceIndex),
  );
}

export function createMeasurementStore({
  historyLimit = 100,
  now = () => new Date().toISOString(),
  idGenerator = createMeasurementId,
} = {}) {
  if (!Number.isInteger(historyLimit) || historyLimit < 1) {
    throw new RangeError("historyLimit must be a positive integer.");
  }

  let measurements = deepFreeze([]);
  let undoStack = [];
  let redoStack = [];
  let selectedId = null;

  function findIndex(id) {
    return measurements.findIndex((measurement) => measurement.id === id);
  }

  function ensureSelectionExists() {
    if (selectedId !== null && findIndex(selectedId) === -1) {
      selectedId = null;
    }
  }

  function commit(nextMeasurements) {
    undoStack.push(measurements);
    if (undoStack.length > historyLimit) {
      undoStack.shift();
    }
    measurements = freezeMeasurements(nextMeasurements);
    redoStack = [];
    ensureSelectionExists();
  }

  function add(measurementInput) {
    const measurement = normalizeMeasurement(measurementInput, {
      now,
      idGenerator,
    });

    if (findIndex(measurement.id) !== -1) {
      throw new RangeError(`Measurement id already exists: ${measurement.id}`);
    }

    commit([...measurements, measurement]);
    return deepClone(measurement);
  }

  function update(id, patch) {
    const index = findIndex(id);
    if (index === -1) {
      throw new RangeError(`Measurement not found: ${id}`);
    }
    if (!isPlainObject(patch)) {
      throw new TypeError("Measurement update must be a plain object.");
    }
    if (patch.id !== undefined && patch.id !== id) {
      throw new RangeError("Measurement id cannot be changed.");
    }
    if (
      patch.createdAt !== undefined &&
      patch.createdAt !== measurements[index].createdAt
    ) {
      throw new RangeError("Measurement createdAt cannot be changed.");
    }

    const nextMeasurement = normalizeMeasurement(
      {
        ...measurements[index],
        ...patch,
        id,
        createdAt: measurements[index].createdAt,
        updatedAt: normalizeNow(now),
      },
      { now, idGenerator },
    );
    const nextMeasurements = measurements.slice();
    nextMeasurements[index] = nextMeasurement;
    commit(nextMeasurements);
    return deepClone(nextMeasurement);
  }

  function remove(id) {
    const index = findIndex(id);
    if (index === -1) {
      return false;
    }

    const nextMeasurements = measurements
      .slice(0, index)
      .concat(measurements.slice(index + 1));
    commit(nextMeasurements);
    return true;
  }

  function clear(filter) {
    const hasFilter =
      filter &&
      typeof filter === "object" &&
      Object.keys(filter).length > 0;

    if (!hasFilter) {
      if (measurements.length === 0) {
        return 0;
      }
      const removedCount = measurements.length;
      commit([]);
      return removedCount;
    }

    const hasPlane = filter.plane !== undefined && filter.plane !== null;
    const hasSlice =
      filter.sliceIndex !== undefined && filter.sliceIndex !== null;

    if (!hasPlane && !hasSlice) {
      throw new TypeError("clear filter must include plane or sliceIndex.");
    }

    const removed = filterMeasurements(measurements, filter);
    if (removed.length === 0) {
      return 0;
    }
    const remaining = measurements.filter(
      (measurement) => !removed.some((entry) => entry.id === measurement.id),
    );
    commit(remaining);
    return removed.length;
  }

  function clearLayer(plane, sliceIndex) {
    return clear({ plane, sliceIndex });
  }

  function list(filter) {
    return deepClone(filterMeasurements(measurements, filter));
  }

  function get(id) {
    const index = findIndex(id);
    return index === -1 ? null : deepClone(measurements[index]);
  }

  function select(id) {
    if (id === null || id === undefined) {
      selectedId = null;
      return null;
    }
    if (typeof id !== "string" || id.trim() === "") {
      throw new TypeError("Selected measurement id must be a non-empty string.");
    }
    if (findIndex(id) === -1) {
      throw new RangeError(`Measurement not found: ${id}`);
    }

    selectedId = id;
    return get(id);
  }

  function getSelected() {
    return selectedId === null ? null : get(selectedId);
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) {
      return false;
    }
    redoStack.push(measurements);
    if (redoStack.length > historyLimit) {
      redoStack.shift();
    }
    measurements = previous;
    ensureSelectionExists();
    return true;
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) {
      return false;
    }
    undoStack.push(measurements);
    if (undoStack.length > historyLimit) {
      undoStack.shift();
    }
    measurements = next;
    ensureSelectionExists();
    return true;
  }

  function toJSON() {
    return {
      version: 1,
      measurements: deepClone(measurements),
      selectedId,
    };
  }

  function load(serialized) {
    const parsed =
      typeof serialized === "string" ? JSON.parse(serialized) : serialized;
    const rawMeasurements = Array.isArray(parsed)
      ? parsed
      : parsed?.measurements;

    if (!Array.isArray(rawMeasurements)) {
      throw new TypeError("Serialized measurements must be an array.");
    }

    const ids = new Set();
    measurements = freezeMeasurements(
      rawMeasurements.map((measurement) => {
        const normalized = normalizeMeasurement(measurement, {
          now,
          idGenerator,
        });
        if (ids.has(normalized.id)) {
          throw new RangeError(`Duplicate measurement id: ${normalized.id}`);
        }
        ids.add(normalized.id);
        return normalized;
      }),
    );
    undoStack = [];
    redoStack = [];
    selectedId =
      !Array.isArray(parsed) &&
      typeof parsed?.selectedId === "string" &&
      ids.has(parsed.selectedId)
        ? parsed.selectedId
        : null;
    return measurements.length;
  }

  return {
    add,
    update,
    remove,
    clear,
    clearLayer,
    list,
    select,
    getSelected,
    get,
    undo,
    redo,
    toJSON,
    load,
    get count() {
      return measurements.length;
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    get selectedId() {
      return selectedId;
    },
  };
}
