export const PLANE_LABELS = Object.freeze({
  axial: "轴位",
  coronal: "冠状位",
  sagittal: "矢状位",
});

export function getPlaneSize(volume, plane) {
  if (plane === "axial") {
    return { width: volume.columns, height: volume.rows, slices: volume.slices };
  }
  if (plane === "coronal") {
    return { width: volume.columns, height: volume.slices, slices: volume.rows };
  }
  return { width: volume.rows, height: volume.slices, slices: volume.columns };
}

export function getPlaneAspectRatio(volume, plane) {
  if (plane === "axial") {
    return (volume.columns * volume.spacing.x) / (volume.rows * volume.spacing.y);
  }
  if (plane === "coronal") {
    return (volume.columns * volume.spacing.x) / (volume.slices * volume.spacing.z);
  }
  return (volume.rows * volume.spacing.y) / (volume.slices * volume.spacing.z);
}

export function getPlaneSpacing(volume, plane) {
  if (plane === "axial") return { x: volume.spacing.x, y: volume.spacing.y };
  if (plane === "coronal") return { x: volume.spacing.x, y: volume.spacing.z };
  return { x: volume.spacing.y, y: volume.spacing.z };
}

const INITIAL_BASES = Object.freeze({
  axial: {
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  },
  coronal: {
    u: [1, 0, 0],
    v: [0, 0, -1],
    normal: [0, 1, 0],
  },
  sagittal: {
    u: [0, 1, 0],
    v: [0, 0, -1],
    normal: [1, 0, 0],
  },
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function vectorLength(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector) {
  const length = vectorLength(vector);
  if (length < 1e-9) return [0, 0, 0];
  return vector.map((value) => value / length);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function rotateAroundAxis(vector, axis, radians) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const axisProjection = dot(axis, vector);
  const axisCross = cross(axis, vector);
  return normalize([
    vector[0] * cosine +
      axisCross[0] * sine +
      axis[0] * axisProjection * (1 - cosine),
    vector[1] * cosine +
      axisCross[1] * sine +
      axis[1] * axisProjection * (1 - cosine),
    vector[2] * cosine +
      axisCross[2] * sine +
      axis[2] * axisProjection * (1 - cosine),
  ]);
}

export function getInitialBasis(plane) {
  const basis = INITIAL_BASES[plane] || INITIAL_BASES.axial;
  return {
    u: [...basis.u],
    v: [...basis.v],
    normal: [...basis.normal],
  };
}

export function rotateBasis(basis, deltaX, deltaY) {
  const yaw = (deltaX * Math.PI) / 320;
  const pitch = (deltaY * Math.PI) / 320;
  const verticalAxis = basis.v;
  let u = rotateAroundAxis(basis.u, verticalAxis, yaw);
  let normal = rotateAroundAxis(basis.normal, verticalAxis, yaw);
  const horizontalAxis = u;
  let v = rotateAroundAxis(basis.v, horizontalAxis, pitch);
  normal = rotateAroundAxis(normal, horizontalAxis, pitch);
  u = normalize(cross(v, normal));
  v = normalize(cross(normal, u));
  return { u, v, normal: normalize(normal) };
}

export function hasObliqueRotation(basis, plane, tolerance = 1e-4) {
  const initial = INITIAL_BASES[plane] || INITIAL_BASES.axial;
  return (
    Math.abs(dot(basis.normal, initial.normal) - 1) > tolerance ||
    Math.abs(dot(basis.u, initial.u) - 1) > tolerance
  );
}

function sampleVolumeTrilinear(volume, x, y, z) {
  if (
    x < 0 ||
    y < 0 ||
    z < 0 ||
    x > volume.columns - 1 ||
    y > volume.rows - 1 ||
    z > volume.slices - 1
  ) {
    return null;
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(volume.columns - 1, x0 + 1);
  const y1 = Math.min(volume.rows - 1, y0 + 1);
  const z1 = Math.min(volume.slices - 1, z0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const values = volume.volume;
  const planeSize = volume.rows * volume.columns;
  const at = (sampleX, sampleY, sampleZ) =>
    values[sampleZ * planeSize + sampleY * volume.columns + sampleX];
  const c00 = at(x0, y0, z0) * (1 - tx) + at(x1, y0, z0) * tx;
  const c10 = at(x0, y1, z0) * (1 - tx) + at(x1, y1, z0) * tx;
  const c01 = at(x0, y0, z1) * (1 - tx) + at(x1, y0, z1) * tx;
  const c11 = at(x0, y1, z1) * (1 - tx) + at(x1, y1, z1) * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

function samplePlanePoint(volume, plane, coordinates, basis, x, y) {
  const size = getPlaneSize(volume, plane);
  const spacing = getPlaneSpacing(volume, plane);
  const centerWorld = [
    coordinates.x * volume.spacing.x,
    coordinates.y * volume.spacing.y,
    coordinates.z * volume.spacing.z,
  ];
  const offsetU = (x - (size.width - 1) / 2) * spacing.x;
  const offsetV = (y - (size.height - 1) / 2) * spacing.y;
  const world = [
    centerWorld[0] + basis.u[0] * offsetU + basis.v[0] * offsetV,
    centerWorld[1] + basis.u[1] * offsetU + basis.v[1] * offsetV,
    centerWorld[2] + basis.u[2] * offsetU + basis.v[2] * offsetV,
  ];
  return sampleVolumeTrilinear(
    volume,
    world[0] / volume.spacing.x,
    world[1] / volume.spacing.y,
    world[2] / volume.spacing.z,
  );
}

export function mapPlanePointToVoxel(
  volume,
  plane,
  coordinates,
  basis,
  x,
  y,
) {
  const size = getPlaneSize(volume, plane);
  const spacing = getPlaneSpacing(volume, plane);
  const centerWorld = [
    coordinates.x * volume.spacing.x,
    coordinates.y * volume.spacing.y,
    coordinates.z * volume.spacing.z,
  ];
  const offsetU = (x - (size.width - 1) / 2) * spacing.x;
  const offsetV = (y - (size.height - 1) / 2) * spacing.y;
  const world = [
    centerWorld[0] + basis.u[0] * offsetU + basis.v[0] * offsetV,
    centerWorld[1] + basis.u[1] * offsetU + basis.v[1] * offsetV,
    centerWorld[2] + basis.u[2] * offsetU + basis.v[2] * offsetV,
  ];
  return {
    x: world[0] / volume.spacing.x,
    y: world[1] / volume.spacing.y,
    z: world[2] / volume.spacing.z,
  };
}

export function sampleObliqueValue(
  volume,
  plane,
  coordinates,
  basis,
  x,
  y,
) {
  const raw = samplePlanePoint(volume, plane, coordinates, basis, x, y);
  return raw === null ? null : raw * volume.slope + volume.intercept;
}

export function renderObliquePlane(
  canvas,
  volume,
  plane,
  coordinates,
  basis,
  windowCenter,
  windowWidth,
  invert = false,
  sampleStep = 1,
) {
  const { width, height } = getPlaneSize(volume, plane);
  const step = Math.max(1, Math.round(sampleStep));
  const outputWidth = Math.ceil(width / step);
  const outputHeight = Math.ceil(height / step);
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d", { alpha: false });
  const imageData = context.createImageData(outputWidth, outputHeight);
  const output = imageData.data;
  const lower = windowCenter - windowWidth / 2;
  const scale = 255 / Math.max(1, windowWidth);
  let outputIndex = 0;

  for (let outputY = 0; outputY < outputHeight; outputY += 1) {
    const y = Math.min(height - 1, outputY * step);
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const x = Math.min(width - 1, outputX * step);
      const raw = samplePlanePoint(volume, plane, coordinates, basis, x, y);
      let gray = 0;
      if (raw !== null) {
        const hu = raw * volume.slope + volume.intercept;
        gray = clamp(Math.round((hu - lower) * scale), 0, 255);
      }
      if (invert && raw !== null) gray = 255 - gray;
      output[outputIndex] = gray;
      output[outputIndex + 1] = gray;
      output[outputIndex + 2] = gray;
      output[outputIndex + 3] = 255;
      outputIndex += 4;
    }
  }
  context.putImageData(imageData, 0, 0);
  return { width, height, sampleStep: step };
}

export function getPixelValue(volume, plane, sliceIndex, x, y) {
  const { width, height } = getPlaneSize(volume, plane);
  const column = Math.max(0, Math.min(width - 1, Math.round(x)));
  const row = Math.max(0, Math.min(height - 1, Math.round(y)));
  const sourceRow = plane === "axial" ? row : height - 1 - row;
  let voxelIndex;

  if (plane === "axial") {
    voxelIndex =
      sliceIndex * volume.rows * volume.columns + row * volume.columns + column;
  } else if (plane === "coronal") {
    voxelIndex =
      sourceRow * volume.rows * volume.columns + sliceIndex * volume.columns + column;
  } else {
    voxelIndex =
      sourceRow * volume.rows * volume.columns + column * volume.columns + sliceIndex;
  }

  return volume.volume[voxelIndex] * volume.slope + volume.intercept;
}

export function renderPlane(
  canvas,
  volume,
  plane,
  sliceIndex,
  windowCenter,
  windowWidth,
  invert = false,
) {
  const { width, height, slices } = getPlaneSize(volume, plane);
  const safeSlice = Math.max(0, Math.min(slices - 1, sliceIndex));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  const imageData = context.createImageData(width, height);
  const output = imageData.data;
  const lower = windowCenter - windowWidth / 2;
  const scale = 255 / Math.max(1, windowWidth);
  const slope = volume.slope;
  const intercept = volume.intercept;
  let outputIndex = 0;

  const writeValue = (rawValue) => {
    const hu = rawValue * slope + intercept;
    let gray = Math.max(0, Math.min(255, Math.round((hu - lower) * scale)));
    if (invert) gray = 255 - gray;
    output[outputIndex] = gray;
    output[outputIndex + 1] = gray;
    output[outputIndex + 2] = gray;
    output[outputIndex + 3] = 255;
    outputIndex += 4;
  };

  if (plane === "axial") {
    const start = safeSlice * volume.rows * volume.columns;
    for (let y = 0; y < height; y += 1) {
      const rowStart = start + y * volume.columns;
      for (let x = 0; x < width; x += 1) {
        writeValue(volume.volume[rowStart + x]);
      }
    }
  } else if (plane === "coronal") {
    for (let z = 0; z < height; z += 1) {
      const sourceZ = height - 1 - z;
      const rowStart =
        sourceZ * volume.rows * volume.columns + safeSlice * volume.columns;
      for (let x = 0; x < width; x += 1) {
        writeValue(volume.volume[rowStart + x]);
      }
    }
  } else {
    for (let z = 0; z < height; z += 1) {
      const sourceZ = height - 1 - z;
      const rowStart = sourceZ * volume.rows * volume.columns + safeSlice;
      for (let y = 0; y < width; y += 1) {
        writeValue(volume.volume[rowStart + y * volume.columns]);
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return { width, height, sliceIndex: safeSlice };
}

export function crosshairCoordinates(volume, plane, coordinates) {
  const { width, height } = getPlaneSize(volume, plane);
  if (plane === "axial") {
    return {
      x: (coordinates.x / Math.max(1, width - 1)) * 100,
      y: (coordinates.y / Math.max(1, height - 1)) * 100,
    };
  }
  if (plane === "coronal") {
    return {
      x: (coordinates.x / Math.max(1, width - 1)) * 100,
      y: (1 - coordinates.z / Math.max(1, height - 1)) * 100,
    };
  }
  return {
    x: (coordinates.y / Math.max(1, width - 1)) * 100,
    y: (1 - coordinates.z / Math.max(1, height - 1)) * 100,
  };
}
