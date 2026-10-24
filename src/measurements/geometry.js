const DEFAULT_SPACING = Object.freeze({ x: 1, y: 1 });

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertPoint(point, label = "point") {
  if (
    !point ||
    typeof point !== "object" ||
    !isFiniteNumber(point.x) ||
    !isFiniteNumber(point.y)
  ) {
    throw new TypeError(`${label} must contain finite x and y coordinates.`);
  }
}

/**
 * Accepts a uniform number or an object using x/y, column/row, or
 * xSpacing/ySpacing names. Distances are always in millimetres.
 */
export function normalizeSpacing(spacing = DEFAULT_SPACING) {
  if (spacing === undefined || spacing === null) {
    return { ...DEFAULT_SPACING };
  }

  if (isFiniteNumber(spacing)) {
    if (spacing <= 0) {
      throw new RangeError("Spacing must be greater than zero.");
    }
    return { x: spacing, y: spacing };
  }

  if (typeof spacing !== "object" || Array.isArray(spacing)) {
    throw new TypeError("Spacing must be a number or an object.");
  }

  const x =
    spacing.x ?? spacing.column ?? spacing.xSpacing ?? DEFAULT_SPACING.x;
  const y = spacing.y ?? spacing.row ?? spacing.ySpacing ?? DEFAULT_SPACING.y;

  if (!isFiniteNumber(x) || !isFiniteNumber(y) || x <= 0 || y <= 0) {
    throw new RangeError("Spacing x and y values must be finite and positive.");
  }

  return { x, y };
}

export function pixelDistance(pointA, pointB) {
  assertPoint(pointA, "pointA");
  assertPoint(pointB, "pointB");

  return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
}

export function physicalDistance(pointA, pointB, spacing) {
  assertPoint(pointA, "pointA");
  assertPoint(pointB, "pointB");
  const normalizedSpacing = normalizeSpacing(spacing);

  return Math.hypot(
    (pointB.x - pointA.x) * normalizedSpacing.x,
    (pointB.y - pointA.y) * normalizedSpacing.y,
  );
}

export function distance2D(pointA, pointB, spacing) {
  return {
    pixels: pixelDistance(pointA, pointB),
    mm: physicalDistance(pointA, pointB, spacing),
  };
}

export function angleBetweenThreePoints(
  pointA,
  vertex,
  pointB,
  { degrees = true, spacing = DEFAULT_SPACING } = {},
) {
  assertPoint(pointA, "pointA");
  assertPoint(vertex, "vertex");
  assertPoint(pointB, "pointB");

  const normalizedSpacing = normalizeSpacing(spacing);
  const vectorAX = (pointA.x - vertex.x) * normalizedSpacing.x;
  const vectorAY = (pointA.y - vertex.y) * normalizedSpacing.y;
  const vectorBX = (pointB.x - vertex.x) * normalizedSpacing.x;
  const vectorBY = (pointB.y - vertex.y) * normalizedSpacing.y;
  const lengthA = Math.hypot(vectorAX, vectorAY);
  const lengthB = Math.hypot(vectorBX, vectorBY);

  if (lengthA === 0 || lengthB === 0) {
    throw new RangeError(
      "The vertex must not coincide with either adjacent point.",
    );
  }

  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (vectorAX * vectorBX + vectorAY * vectorBY) / (lengthA * lengthB),
    ),
  );
  const radians = Math.acos(cosine);
  return degrees ? (radians * 180) / Math.PI : radians;
}

export const angle3Point = angleBetweenThreePoints;

export function polylineLength(points, spacing) {
  if (!Array.isArray(points)) {
    throw new TypeError("Polyline points must be an array.");
  }
  if (points.length === 0) {
    return {
      pixels: 0,
      mm: 0,
      segmentPixels: [],
      segmentMm: [],
    };
  }

  points.forEach((point, index) => assertPoint(point, `points[${index}]`));
  const normalizedSpacing = normalizeSpacing(spacing);
  const segmentPixels = [];
  const segmentMm = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    segmentPixels.push(pixelDistance(previous, current));
    segmentMm.push(physicalDistance(previous, current, normalizedSpacing));
  }

  return {
    pixels: segmentPixels.reduce((total, value) => total + value, 0),
    mm: segmentMm.reduce((total, value) => total + value, 0),
    segmentPixels,
    segmentMm,
  };
}
