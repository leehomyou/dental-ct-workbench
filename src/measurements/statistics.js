import { normalizeSpacing } from "./geometry.js";

const VALID_SHAPES = new Set(["rectangle", "ellipse"]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return normalized;
}

function normalizeValueType(options) {
  const requested = String(
    options.valueType ?? options.valueMode ?? "raw",
  ).toLowerCase();

  if (requested === "hu") {
    return "HU";
  }
  if (requested === "raw") {
    return "raw";
  }

  throw new RangeError('valueType must be either "HU" or "raw".');
}

function resolveBounds(options) {
  const points = options.points;

  if (points !== undefined) {
    if (!Array.isArray(points) || points.length !== 2) {
      throw new TypeError("ROI points must contain two opposite corners.");
    }
    points.forEach((point, index) => {
      if (
        !point ||
        !isFiniteNumber(point.x) ||
        !isFiniteNumber(point.y)
      ) {
        throw new TypeError(`ROI points[${index}] must contain finite x and y.`);
      }
    });

    const left = Math.min(points[0].x, points[1].x);
    const right = Math.max(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y);
    const bottom = Math.max(points[0].y, points[1].y);

    return { left, top, right, bottom };
  }

  const bounds = options.bounds ?? options;
  const x = bounds.x;
  const y = bounds.y;
  const width = bounds.width;
  const height = bounds.height;

  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width < 0 ||
    height < 0
  ) {
    throw new TypeError(
      "ROI bounds must contain finite x, y, width, and height.",
    );
  }

  if (width === 0 || height === 0) {
    return {
      left: x,
      top: y,
      right: x - 1,
      bottom: y - 1,
    };
  }

  return {
    left: x,
    top: y,
    right: x + Math.max(0, width - 1),
    bottom: y + Math.max(0, height - 1),
  };
}

function resolveSampler(options) {
  const width = positiveInteger(
    options.width ?? options.imageWidth,
    "width",
  );
  const height = positiveInteger(
    options.height ?? options.imageHeight,
    "height",
  );

  if (typeof options.getPixelValue === "function") {
    return {
      width,
      height,
      getPixelValue: options.getPixelValue,
    };
  }

  const pixelData = options.pixelData ?? options.pixels;
  if (!pixelData || typeof pixelData.length !== "number") {
    throw new TypeError(
      "Provide getPixelValue(x, y) or a row-major pixelData array.",
    );
  }

  if (pixelData.length < width * height) {
    throw new RangeError("pixelData is smaller than width × height.");
  }

  return {
    width,
    height,
    getPixelValue: (x, y) => pixelData[y * width + x],
  };
}

function createValueTransform(options, valueType) {
  if (valueType === "raw") {
    return (rawValue) => rawValue;
  }

  const slope = options.rescaleSlope ?? options.slope ?? 1;
  const intercept = options.rescaleIntercept ?? options.intercept ?? 0;

  if (!isFiniteNumber(slope) || slope === 0 || !isFiniteNumber(intercept)) {
    throw new RangeError(
      "For HU statistics, slope must be finite/non-zero and intercept finite.",
    );
  }

  return (rawValue) => rawValue * slope + intercept;
}

function emptyStatistics(shape, bounds, valueType, spacing) {
  return {
    shape,
    bounds: { ...bounds },
    areaMm2: 0,
    pixelAreaMm2: spacing.x * spacing.y,
    pixelCount: 0,
    skippedPixelCount: 0,
    mean: null,
    min: null,
    max: null,
    stdDev: null,
    valueType,
  };
}

/**
 * Computes discrete ROI statistics from image-space pixel indices.
 * Points are opposite corners and coordinates refer to pixel centres.
 */
export function computeRoiStatistics(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("ROI statistics options are required.");
  }

  const shape = String(options.shape ?? "").toLowerCase();
  if (!VALID_SHAPES.has(shape)) {
    throw new RangeError('shape must be either "rectangle" or "ellipse".');
  }

  const bounds = resolveBounds(options);
  const spacing = normalizeSpacing(options.spacing);
  const valueType = normalizeValueType(options);
  const toStoredValue = createValueTransform(options, valueType);
  const { width, height, getPixelValue } = resolveSampler(options);

  const startX = Math.max(0, Math.ceil(bounds.left));
  const endX = Math.min(width - 1, Math.floor(bounds.right));
  const startY = Math.max(0, Math.ceil(bounds.top));
  const endY = Math.min(height - 1, Math.floor(bounds.bottom));

  if (startX > endX || startY > endY) {
    return emptyStatistics(shape, bounds, valueType, spacing);
  }

  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const radiusX = (bounds.right - bounds.left) / 2;
  const radiusY = (bounds.bottom - bounds.top) / 2;
  const epsilon = 1e-9;

  let pixelCount = 0;
  let skippedPixelCount = 0;
  let sum = 0;
  let sumOfSquares = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (shape === "ellipse") {
        if (radiusX === 0 || radiusY === 0) {
          continue;
        }
        const normalizedX = (x - centerX) / radiusX;
        const normalizedY = (y - centerY) / radiusY;
        if (
          normalizedX * normalizedX + normalizedY * normalizedY >
          1 + epsilon
        ) {
          continue;
        }
      }

      const rawValue = getPixelValue(x, y);
      if (!isFiniteNumber(rawValue)) {
        skippedPixelCount += 1;
        continue;
      }

      const value = toStoredValue(rawValue);
      if (!isFiniteNumber(value)) {
        skippedPixelCount += 1;
        continue;
      }

      pixelCount += 1;
      sum += value;
      sumOfSquares += value * value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  if (pixelCount === 0) {
    return {
      ...emptyStatistics(shape, bounds, valueType, spacing),
      skippedPixelCount,
    };
  }

  const mean = sum / pixelCount;
  const variance = Math.max(0, sumOfSquares / pixelCount - mean * mean);

  return {
    shape,
    bounds: { ...bounds },
    areaMm2: pixelCount * spacing.x * spacing.y,
    pixelAreaMm2: spacing.x * spacing.y,
    pixelCount,
    skippedPixelCount,
    mean,
    min,
    max,
    stdDev: Math.sqrt(variance),
    valueType,
  };
}

export function calculateRectangleStatistics(options) {
  return computeRoiStatistics({ ...options, shape: "rectangle" });
}

export function calculateEllipseStatistics(options) {
  return computeRoiStatistics({ ...options, shape: "ellipse" });
}
