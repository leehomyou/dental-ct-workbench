import test from "node:test";
import assert from "node:assert/strict";

import {
  angleBetweenThreePoints,
  distance2D,
  polylineLength,
} from "../src/measurements/geometry.js";
import {
  calculateEllipseStatistics,
  calculateRectangleStatistics,
} from "../src/measurements/statistics.js";
import {
  createMeasurementId,
  createMeasurementStore,
  normalizeMeasurement,
} from "../src/measurements/measurement-store.js";

const SPACING = { x: 0.4, y: 0.8 };

function measurement(overrides = {}) {
  return {
    studyId: "study-1",
    seriesId: "series-1",
    plane: "axial",
    sliceIndex: 12,
    tool: "distance",
    points: [
      { x: 10, y: 20 },
      { x: 20, y: 20 },
    ],
    value: 4,
    unit: "mm",
    style: { color: "#ffcc00", lineWidth: 2 },
    ...overrides,
  };
}

test("distance reports pixel and physical lengths using x/y spacing", () => {
  const result = distance2D({ x: 1, y: 2 }, { x: 4, y: 6 }, SPACING);

  assert.equal(result.pixels, 5);
  assert.ok(Math.abs(result.mm - Math.hypot(3 * 0.4, 4 * 0.8)) < 1e-12);
  assert.throws(() => distance2D(undefined, { x: 0, y: 0 }), TypeError);
});

test("three-point angle and polyline length use image coordinates", () => {
  assert.equal(
    angleBetweenThreePoints(
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ),
    90,
  );
  assert.ok(
    Math.abs(
      angleBetweenThreePoints(
        { x: 1, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: -1 },
        { spacing: { x: 2, y: 1 } },
      ) -
        (Math.atan2(1, 2) * 2 * 180) / Math.PI,
    ) < 1e-12,
  );

  const result = polylineLength(
    [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ],
    { x: 1, y: 2 },
  );
  assert.equal(result.pixels, 7);
  assert.equal(result.mm, 11);
  assert.deepEqual(result.segmentPixels, [3, 4]);
  assert.deepEqual(result.segmentMm, [3, 8]);
  assert.deepEqual(polylineLength([]), {
    pixels: 0,
    mm: 0,
    segmentPixels: [],
    segmentMm: [],
  });
  assert.throws(
    () =>
      angleBetweenThreePoints(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ),
    RangeError,
  );
});

test("rectangle ROI computes pixel count, area, moments, and HU", () => {
  const pixels = Float32Array.from({ length: 9 }, (_, index) => index + 1);
  const raw = calculateRectangleStatistics({
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ],
    width: 3,
    height: 3,
    pixelData: pixels,
    spacing: { x: 0.5, y: 1 },
    valueType: "raw",
  });

  assert.equal(raw.pixelCount, 9);
  assert.equal(raw.areaMm2, 4.5);
  assert.equal(raw.mean, 5);
  assert.equal(raw.min, 1);
  assert.equal(raw.max, 9);
  assert.ok(Math.abs(raw.stdDev - Math.sqrt(20 / 3)) < 1e-12);

  const hu = calculateRectangleStatistics({
    points: [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ],
    width: 3,
    height: 3,
    pixelData: pixels,
    spacing: { x: 0.5, y: 1 },
    valueType: "HU",
    rescaleSlope: 2,
    rescaleIntercept: -1000,
  });
  assert.equal(hu.valueType, "HU");
  assert.equal(hu.mean, -990);
  assert.equal(hu.min, -998);
  assert.equal(hu.max, -982);
});

test("ellipse ROI clips to image and handles an empty sample", () => {
  const ellipse = calculateEllipseStatistics({
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
    ],
    width: 5,
    height: 5,
    getPixelValue: () => 42,
    spacing: 1,
  });
  assert.equal(ellipse.pixelCount, 13);
  assert.equal(ellipse.areaMm2, 13);
  assert.equal(ellipse.mean, 42);

  const empty = calculateRectangleStatistics({
    points: [
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ],
    width: 5,
    height: 5,
    getPixelValue: () => {
      throw new Error("out-of-image pixels must not be sampled");
    },
    spacing: 1,
  });
  assert.equal(empty.pixelCount, 0);
  assert.equal(empty.areaMm2, 0);
  assert.equal(empty.mean, null);
  assert.equal(empty.stdDev, null);
  assert.throws(
    () =>
      calculateRectangleStatistics({
        bounds: { x: 20, y: 20, width: 0, height: 10 },
        width: 5,
        height: 5,
        getPixelValue: () => 1,
        valueType: "HU",
        rescaleSlope: 0,
      }),
    RangeError,
  );
});

test("measurement model supports text, arrows, and unique persistent ids", () => {
  const fixedNow = () => "2026-10-23T10:00:00.000Z";
  const text = normalizeMeasurement(
    measurement({
      tool: "text",
      points: [{ x: 5, y: 6 }],
      value: "Follow-up",
      unit: "text",
    }),
    { now: fixedNow, idGenerator: () => "measurement-text" },
  );
  const arrow = normalizeMeasurement(
    measurement({
      tool: "arrow",
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    }),
    { now: fixedNow, idGenerator: () => "measurement-arrow" },
  );

  assert.equal(text.value, "Follow-up");
  assert.equal(text.unit, "text");
  assert.equal(text.createdAt, fixedNow());
  assert.equal(arrow.tool, "arrow");
  assert.equal(arrow.unit, "mm");

  const ids = new Set(
    Array.from({ length: 40 }, (_, index) =>
      createMeasurementId(`test-${index}`),
    ),
  );
  assert.equal(ids.size, 40);
});

test("store isolates internal state, filters by plane and slice, and supports selection", () => {
  const times = [
    "2026-10-23T10:00:00.000Z",
    "2026-10-23T10:00:01.000Z",
    "2026-10-23T10:00:02.000Z",
    "2026-10-23T10:00:03.000Z",
  ];
  let nowIndex = 0;
  let idIndex = 0;
  const store = createMeasurementStore({
    now: () => times[Math.min(nowIndex++, times.length - 1)],
    idGenerator: () => `measurement-${++idIndex}`,
  });

  const first = store.add(measurement());
  store.add(
    measurement({
      plane: "coronal",
      sliceIndex: 12,
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    }),
  );
  store.add(
    measurement({
      plane: "axial",
      sliceIndex: 13,
      points: [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
      ],
    }),
  );

  const exposed = store.list({ plane: "axial", sliceIndex: 12 });
  exposed[0].points[0].x = 999;
  exposed[0].style.color = "#000000";
  exposed.push(measurement({ id: "external" }));
  assert.deepEqual(store.get(first.id).points[0], { x: 10, y: 20 });
  assert.equal(store.get(first.id).style.color, "#ffcc00");
  assert.equal(store.count, 3);
  assert.equal(store.list({ sliceIndex: 12 }).length, 2);

  assert.equal(store.select(first.id).id, first.id);
  assert.equal(store.getSelected().id, first.id);
  assert.equal(store.remove(first.id), true);
  assert.equal(store.getSelected(), null);
});

test("store update, single removal, layer clearing, undo, and redo are immutable", () => {
  let timestamp = 0;
  let id = 0;
  const store = createMeasurementStore({
    now: () => `2026-10-23T11:00:0${timestamp++}.000Z`,
    idGenerator: () => `measurement-${++id}`,
  });

  const first = store.add(measurement());
  const second = store.add(
    measurement({
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    }),
  );
  const third = store.add(
    measurement({
      plane: "coronal",
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
    }),
  );

  const updated = store.update(first.id, {
    value: 8,
    style: { color: "#00ffff", lineWidth: 3 },
  });
  assert.equal(updated.value, 8);
  assert.notEqual(updated.updatedAt, updated.createdAt);
  assert.equal(store.canUndo, true);

  assert.equal(store.remove(second.id), true);
  assert.equal(store.remove(second.id), false);
  assert.equal(store.clearLayer("axial", 12), 1);
  assert.deepEqual(store.list().map((entry) => entry.id), [third.id]);

  assert.equal(store.undo(), true);
  assert.deepEqual(
    store.list().map((entry) => entry.id).sort(),
    [first.id, third.id].sort(),
  );
  assert.equal(store.undo(), true);
  assert.deepEqual(
    store.list().map((entry) => entry.id).sort(),
    [first.id, second.id, third.id].sort(),
  );
  assert.equal(store.redo(), true);
  assert.equal(store.list().length, 2);

  assert.equal(store.clear(), 2);
  assert.equal(store.count, 0);
  assert.equal(store.undo(), true);
  assert.equal(store.count, 2);
});

test("serialization round-trip restores fields, selection, and isolation", () => {
  let id = 0;
  const source = createMeasurementStore({
    now: () => "2026-10-23T12:00:00.000Z",
    idGenerator: () => `measurement-${++id}`,
  });
  const arrow = source.add(
    measurement({
      tool: "arrow",
      points: [
        { x: 3, y: 4 },
        { x: 7, y: 9 },
      ],
      value: Math.hypot(4 * 0.4, 5 * 0.8),
      style: { color: "#00ff00", arrowSize: 12 },
    }),
  );
  source.select(arrow.id);

  const serialized = source.toJSON();
  serialized.measurements[0].points[0].x = -1;
  assert.equal(source.get(arrow.id).points[0].x, 3);

  const restored = createMeasurementStore();
  assert.equal(restored.load(JSON.stringify(source.toJSON())), 1);
  assert.deepEqual(restored.get(arrow.id), source.get(arrow.id));
  assert.equal(restored.selectedId, arrow.id);
  assert.equal(restored.canUndo, false);
  assert.equal(restored.canRedo, false);
});
