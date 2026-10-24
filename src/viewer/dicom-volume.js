import dicomParser from "dicom-parser";

const SUPPORTED_TRANSFER_SYNTAXES = new Set([
  "1.2.840.10008.1.2",
  "1.2.840.10008.1.2.1",
  "1.2.840.10008.1.2.1.99",
  "1.2.840.10008.1.2.2",
]);

function cleanString(value) {
  return String(value ?? "").replace(/\0/g, "").trim();
}

function numberArray(value) {
  const text = cleanString(value);
  if (!text) return [];
  return text
    .split("\\")
    .map((entry) => Number.parseFloat(entry.trim()))
    .filter(Number.isFinite);
}

function numericString(value, fallback = Number.NaN) {
  const parsed = Number.parseFloat(cleanString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
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

function getSeriesFiles(series) {
  const files = series.files || series.instances || series.images || series.sourceFiles || [];
  return files.map((file, index) => {
    if (typeof file === "string" || file.url || file.relativePath) return file;
    const fileName =
      file.fileName || file.name || `${String(index + 1).padStart(6, "0")}.dcm`;
    return {
      ...file,
      relativePath:
        file.relativePath ||
        `series/${series.seriesKey || series.id}/${fileName}`,
    };
  });
}

function getPrimarySeries(study) {
  const series = study.series || [];
  return (
    series.find((entry) => entry.primary || entry.isPrimary) ||
    series
      .filter((entry) => String(entry.modality || "").toUpperCase() === "CT")
      .sort((left, right) => getSeriesFiles(right).length - getSeriesFiles(left).length)[0] ||
    series.sort((left, right) => getSeriesFiles(right).length - getSeriesFiles(left).length)[0]
  );
}

function getStudyKey(study) {
  return (
    study.studyKey ||
    study.storageKey ||
    study.id ||
    study.studyId ||
    study.studyInstanceUid
  );
}

function getRelativePath(file) {
  if (typeof file === "string") return file;
  return (
    file.relativePath ||
    file.relative_path ||
    file.relativeFilePath ||
    file.storedPath ||
    file.path
  );
}

function makeFileUrl(studyKey, file) {
  if (file?.url) return file.url;
  const relativePath = getRelativePath(file);
  if (!relativePath) {
    throw new Error("导入清单缺少 DICOM 文件路径。");
  }
  const encodedPath = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `ctdata://${encodeURIComponent(studyKey)}/${encodedPath}`;
}

function getTransferSyntax(dataset) {
  return cleanString(
    dataset.string("x00020010") ||
      dataset.string("x00020010") ||
      dataset.string("x00020010"),
  );
}

function extractPixelSlice(dataset) {
  const rows = dataset.uint16("x00280010");
  const columns = dataset.uint16("x00280011");
  const samplesPerPixel = dataset.uint16("x00280002") || 1;
  const numberOfFrames = numericString(dataset.string("x00280008"), 1);
  const bitsAllocated = dataset.uint16("x00280100");
  const pixelRepresentation = dataset.uint16("x00280103") || 0;
  const transferSyntax = getTransferSyntax(dataset);
  const isLittleEndian = transferSyntax !== "1.2.840.10008.1.2.2";

  if (!rows || !columns) {
    throw new Error("DICOM 缺少影像矩阵信息。");
  }
  if (samplesPerPixel !== 1) {
    throw new Error("当前版本只支持单通道灰度 CT 影像。");
  }
  if (numberOfFrames > 1) {
    throw new Error("当前版本暂不支持多帧 DICOM；请导入逐层序列。");
  }
  if (![8, 16].includes(bitsAllocated)) {
    throw new Error(`当前版本不支持 ${bitsAllocated}-bit DICOM。`);
  }
  if (transferSyntax && !SUPPORTED_TRANSFER_SYNTAXES.has(transferSyntax)) {
    throw new Error(`当前版本暂不支持压缩 DICOM 传输语法：${transferSyntax}`);
  }

  const pixelElement = dataset.elements.x7fe00010;
  if (!pixelElement || !pixelElement.length) {
    throw new Error("DICOM 缺少像素数据。");
  }

  const pixelCount = rows * columns;
  const pixelData = pixelRepresentation
    ? new Int16Array(pixelCount)
    : new Uint16Array(pixelCount);
  const byteArray = dataset.byteArray;
  const dataOffset = pixelElement.dataOffset;

  if (bitsAllocated === 16) {
    const byteOffset = byteArray.byteOffset + dataOffset;
    if (byteOffset % 2 === 0 && isLittleEndian) {
      const source = pixelRepresentation
        ? new Int16Array(byteArray.buffer, byteOffset, pixelCount)
        : new Uint16Array(byteArray.buffer, byteOffset, pixelCount);
      pixelData.set(source);
    } else {
      const view = new DataView(
        byteArray.buffer,
        byteArray.byteOffset + dataOffset,
        pixelCount * 2,
      );
      for (let index = 0; index < pixelCount; index += 1) {
        pixelData[index] = pixelRepresentation
          ? view.getInt16(index * 2, isLittleEndian)
          : view.getUint16(index * 2, isLittleEndian);
      }
    }
  } else {
    const start = byteArray.byteOffset + dataOffset;
    for (let index = 0; index < pixelCount; index += 1) {
      pixelData[index] = byteArray[start + index];
    }
  }

  const imagePosition = numberArray(dataset.string("x00200032"));
  const imageOrientation = numberArray(dataset.string("x00200037"));
  const pixelSpacing = numberArray(dataset.string("x00280030"));

  return {
    rows,
    columns,
    pixelData,
    instanceNumber: numericString(dataset.string("x00200013")),
    imagePosition,
    imageOrientation,
    pixelSpacing:
      pixelSpacing.length >= 2
        ? { row: pixelSpacing[0], column: pixelSpacing[1] }
        : null,
    sliceThickness: numericString(dataset.string("x00180050")),
    slope: numericString(dataset.string("x00281053"), 1),
    intercept: numericString(dataset.string("x00281052"), 0),
    windowCenter: numberArray(dataset.string("x00281050"))[0],
    windowWidth: numberArray(dataset.string("x00281051"))[0],
  };
}

function sortSlices(slices) {
  const firstWithPosition = slices.find(
    (slice) => slice.imagePosition.length >= 3,
  );
  const firstWithOrientation = slices.find(
    (slice) => slice.imageOrientation.length >= 6,
  );

  if (
    firstWithPosition &&
    firstWithOrientation &&
    slices.some((slice) => {
      const position = slice.imagePosition;
      return position.length >= 3 && dot(position, position) > 0;
    })
  ) {
    const orientation = firstWithOrientation.imageOrientation;
    const normal = cross(orientation.slice(0, 3), orientation.slice(3, 6));
    return [...slices].sort(
      (left, right) =>
        dot(left.imagePosition, normal) - dot(right.imagePosition, normal),
    );
  }

  return [...slices].sort((left, right) => {
    if (Number.isFinite(left.instanceNumber) && Number.isFinite(right.instanceNumber)) {
      return left.instanceNumber - right.instanceNumber;
    }
    return left.fileName.localeCompare(right.fileName, undefined, {
      numeric: true,
    });
  });
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function estimateWindow(volume, slope, intercept) {
  const stride = Math.max(1, Math.floor(volume.length / 100000));
  const samples = [];
  for (let index = 0; index < volume.length; index += stride) {
    samples.push(volume[index] * slope + intercept);
  }
  samples.sort((left, right) => left - right);
  const lower = samples[Math.floor(samples.length * 0.02)] ?? -1000;
  const upper = samples[Math.floor(samples.length * 0.98)] ?? 1000;
  return {
    center: (lower + upper) / 2,
    width: Math.max(1, upper - lower),
    min: samples[0] ?? lower,
    max: samples.at(-1) ?? upper,
  };
}

export async function loadDicomVolume(study, { onProgress = () => {} } = {}) {
  const series = getPrimarySeries(study);
  if (!series) throw new Error("该检查没有可读取的 CT 序列。");
  const files = getSeriesFiles(series);
  if (!files.length) throw new Error("所选序列没有 DICOM 文件。");
  const studyKey = getStudyKey(study);
  const slices = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    onProgress({
      stage: "loading",
      current: index + 1,
      total: files.length,
      fileName: getRelativePath(file),
    });
    const response = await fetch(makeFileUrl(studyKey, file));
    if (!response.ok) {
      throw new Error(`无法读取 DICOM：${getRelativePath(file) || file.url}`);
    }
    const byteArray = new Uint8Array(await response.arrayBuffer());
    const dataset = dicomParser.parseDicom(byteArray);
    const extracted = extractPixelSlice(dataset);
    slices.push({
      ...extracted,
      fileName: getRelativePath(file) || file.url,
    });
  }

  const sorted = sortSlices(slices);
  const rows = sorted[0].rows;
  const columns = sorted[0].columns;
  if (sorted.some((slice) => slice.rows !== rows || slice.columns !== columns)) {
    throw new Error("所选序列中的影像尺寸不一致，无法重建三平面。");
  }

  const first = sorted[0];
  const signed = first.pixelData instanceof Int16Array;
  const PixelArray = signed ? Int16Array : Uint16Array;
  const volume = new PixelArray(rows * columns * sorted.length);
  for (let index = 0; index < sorted.length; index += 1) {
    volume.set(sorted[index].pixelData, index * rows * columns);
  }

  const spacingX = first.pixelSpacing?.column || 1;
  const spacingY = first.pixelSpacing?.row || 1;
  const slicePositions = sorted
    .map((slice) => slice.imagePosition)
    .filter((position) => position.length >= 3);
  let spacingZ = first.sliceThickness;
  if (!Number.isFinite(spacingZ) && slicePositions.length > 1) {
    const normal = first.imageOrientation.length >= 6
      ? cross(first.imageOrientation.slice(0, 3), first.imageOrientation.slice(3, 6))
      : [0, 0, 1];
    spacingZ = median(
      slicePositions.slice(1).map((position, index) =>
        Math.abs(dot(position, normal) - dot(slicePositions[index], normal)),
      ),
    );
  }
  if (!Number.isFinite(spacingZ) || spacingZ <= 0) spacingZ = 1;

  const estimated = estimateWindow(volume, first.slope, first.intercept);
  const windowWidth =
    Number.isFinite(first.windowWidth) && first.windowWidth > 0
      ? first.windowWidth
      : estimated.width;
  const windowCenter = Number.isFinite(first.windowCenter)
    ? first.windowCenter
    : estimated.center;
  onProgress({ stage: "ready", current: files.length, total: files.length });
  return {
    studyId: getStudyKey(study),
    seriesId: series.id || series.seriesId,
    series,
    rows,
    columns,
    slices: sorted.length,
    spacing: { x: spacingX, y: spacingY, z: spacingZ },
    volume,
    signed,
    slope: first.slope,
    intercept: first.intercept,
    windowCenter,
    windowWidth,
    range: { min: estimated.min, max: estimated.max },
    sourceFiles: files,
  };
}

export { getPrimarySeries, getSeriesFiles };
