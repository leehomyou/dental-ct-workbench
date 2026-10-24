import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import AdmZip from 'adm-zip';
import dicomParser from 'dicom-parser';

const DICOM_PREAMBLE_LENGTH = 128;
const DICOM_MAGIC = 'DICM';
const ZIP_SIGNATURES = new Set(['504b0304', '504b0506', '504b0708']);
const MEDIA_STORAGE_DIRECTORY_UID = '1.2.840.10008.1.3.10';
const ANCILLARY_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.tif',
  '.tiff',
]);
const MIN_ANCILLARY_IMAGE_BYTES = 20_000;

const TAGS = Object.freeze({
  mediaStorageSopClassUid: 'x00020002',
  patientName: 'x00100010',
  patientId: 'x00100020',
  studyDate: 'x00080020',
  studyInstanceUid: 'x0020000d',
  seriesInstanceUid: 'x0020000e',
  modality: 'x00080060',
  manufacturer: 'x00080070',
  manufacturerModelName: 'x00081090',
  rows: 'x00280010',
  columns: 'x00280011',
  instanceNumber: 'x00200013',
  imagePositionPatient: 'x00200032',
  pixelSpacing: 'x00280030',
  sliceThickness: 'x00180050',
});

function stableKey(prefix, value) {
  const digest = crypto
    .createHash('sha256')
    .update(String(value ?? ''), 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${digest}`;
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).replace(/\0/g, '').trim();
}

function firstText(value) {
  return cleanText(value).split('\\')[0]?.trim() ?? '';
}

function repairLegacyChineseText(value) {
  const text = cleanText(value);
  if (!/[^\u0000-\u007f]/.test(text)) {
    return text;
  }

  try {
    const bytes = Uint8Array.from(
      [...text].map((character) => character.charCodeAt(0) & 0xff),
    );
    const decoded = new TextDecoder('gb18030').decode(bytes).trim();
    if (/[\u3400-\u9fff]/u.test(decoded)) {
      return decoded;
    }
  } catch {
    // Fall back to the parser's original representation.
  }

  return text;
}

function readText(dataSet, tag) {
  try {
    return cleanText(dataSet.string(tag));
  } catch {
    return '';
  }
}

function readNumber(dataSet, tag) {
  const text = readText(dataSet, tag);
  if (text) {
    const parsed = Number.parseFloat(text.split('\\')[0]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  try {
    return dataSet.uint16(tag);
  } catch {
    return null;
  }
}

function readNumberList(dataSet, tag) {
  const text = readText(dataSet, tag);
  if (!text) {
    return [];
  }

  return text
    .split('\\')
    .map((item) => Number.parseFloat(item))
    .filter((item) => Number.isFinite(item));
}

function hasDicomMagic(buffer) {
  return (
    buffer.length >= DICOM_PREAMBLE_LENGTH + DICOM_MAGIC.length &&
    buffer
      .subarray(DICOM_PREAMBLE_LENGTH, DICOM_PREAMBLE_LENGTH + DICOM_MAGIC.length)
      .toString('ascii') === DICOM_MAGIC
  );
}

function hasZipSignature(buffer) {
  return buffer.length >= 4 && ZIP_SIGNATURES.has(buffer.subarray(0, 4).toString('hex'));
}

function toParserBytes(buffer) {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function normalizeModality(value) {
  return firstText(value).toUpperCase();
}

function extractDicomMetadata(buffer) {
  const dataSet = dicomParser.parseDicom(toParserBytes(buffer));
  const mediaStorageSopClassUid = readText(dataSet, TAGS.mediaStorageSopClassUid);

  if (mediaStorageSopClassUid === MEDIA_STORAGE_DIRECTORY_UID) {
    return {
      isDicom: true,
      isDicomDir: true,
      metadata: null,
    };
  }

  const studyInstanceUid = firstText(readText(dataSet, TAGS.studyInstanceUid));
  const seriesInstanceUid = firstText(readText(dataSet, TAGS.seriesInstanceUid));

  if (!studyInstanceUid || !seriesInstanceUid) {
    return {
      isDicom: true,
      isDicomDir: false,
      metadata: null,
      warning: 'DICOM file is missing StudyInstanceUID or SeriesInstanceUID and was skipped.',
    };
  }

  return {
    isDicom: true,
    isDicomDir: false,
    metadata: {
      patientName: repairLegacyChineseText(
        firstText(readText(dataSet, TAGS.patientName)),
      ),
      patientId: firstText(readText(dataSet, TAGS.patientId)),
      studyDate: firstText(readText(dataSet, TAGS.studyDate)),
      studyInstanceUid,
      seriesInstanceUid,
      modality: normalizeModality(readText(dataSet, TAGS.modality)),
      manufacturer: firstText(readText(dataSet, TAGS.manufacturer)),
      manufacturerModelName: firstText(readText(dataSet, TAGS.manufacturerModelName)),
      rows: readNumber(dataSet, TAGS.rows),
      columns: readNumber(dataSet, TAGS.columns),
      instanceNumber: readNumber(dataSet, TAGS.instanceNumber),
      imagePositionPatient: readNumberList(dataSet, TAGS.imagePositionPatient),
      pixelSpacing: readNumberList(dataSet, TAGS.pixelSpacing),
      sliceThickness: readNumber(dataSet, TAGS.sliceThickness),
    },
  };
}

function sourceLabel(source) {
  if (source.kind === 'zip-entry') {
    return `${source.archivePath}:${source.entryName}`;
  }

  return source.path;
}

function sourceSortValue(source) {
  if (source.kind === 'zip-entry') {
    return source.entryName.toLocaleLowerCase('en-US');
  }

  return source.path.toLocaleLowerCase('en-US');
}

function sourceFromFile(filePath) {
  return {
    kind: 'file',
    path: path.resolve(filePath),
  };
}

function sourceFromZipEntry(archivePath, entryName) {
  return {
    kind: 'zip-entry',
    archivePath: path.resolve(archivePath),
    entryName,
  };
}

function createWarningCollector() {
  const warnings = [];
  const seen = new Set();

  return {
    add(message) {
      if (!seen.has(message)) {
        seen.add(message);
        warnings.push(message);
      }
    },
    warnings,
  };
}

function compareByInstance(left, right) {
  const leftInstance = Number.isFinite(left.instanceNumber)
    ? left.instanceNumber
    : Number.POSITIVE_INFINITY;
  const rightInstance = Number.isFinite(right.instanceNumber)
    ? right.instanceNumber
    : Number.POSITIVE_INFINITY;

  if (leftInstance !== rightInstance) {
    return leftInstance - rightInstance;
  }

  return sourceSortValue(left.source).localeCompare(sourceSortValue(right.source), 'en');
}

function isAncillaryImageName(value) {
  return ANCILLARY_IMAGE_EXTENSIONS.has(path.extname(String(value ?? '')).toLowerCase());
}

function createAncillaryImage(source, label, size) {
  const normalizedLabel = String(label ?? '').replace(/\\/g, '/');
  return {
    kind: /panorama|pano|全景/i.test(normalizedLabel) ? 'panorama' : 'image',
    label: path.basename(normalizedLabel),
    source,
    size: Number.isFinite(size) ? size : 0,
  };
}

function finalizeAncillaryImages(images) {
  const filtered = images
    .filter((image) => image.size >= MIN_ANCILLARY_IMAGE_BYTES)
    .sort((left, right) => {
      if (left.kind === 'panorama' && right.kind !== 'panorama') return -1;
      if (left.kind !== 'panorama' && right.kind === 'panorama') return 1;
      return right.size - left.size;
    });

  if (filtered.length > 0 && !filtered.some((image) => image.kind === 'panorama')) {
    filtered[0] = { ...filtered[0], kind: 'panorama' };
  }

  return filtered;
}

function buildImportPlan(studies, primarySeries, inputPath, inputType, ancillaryImages = []) {
  if (!primarySeries) {
    return null;
  }

  const study = studies.find(
    (candidate) => candidate.studyInstanceUid === primarySeries.studyInstanceUid,
  );

  if (!study) {
    return null;
  }

  const series = study.series.map((item) => ({
    ...item,
    isPrimary: item.seriesKey === primarySeries.seriesKey,
  }));

  return {
    schemaVersion: 1,
    origin: {
      inputPath: path.resolve(inputPath),
      inputType,
    },
    studyKey: study.studyKey,
    studyInstanceUid: study.studyInstanceUid,
    patient: {
      name: study.patientName,
      id: study.patientId,
    },
    studyDate: study.studyDate,
    primarySeriesKey: primarySeries.seriesKey,
    series,
    ancillaryImages: finalizeAncillaryImages(ancillaryImages),
    sourceFiles: series.flatMap((item) => item.files.map((file) => file.source)),
  };
}

function choosePrimarySeries(studies) {
  const allSeries = studies.flatMap((study) => study.series);
  const ctSeries = allSeries.filter((series) => series.modality === 'CT');
  const candidates = ctSeries.length > 0 ? ctSeries : allSeries;

  return [...candidates]
    .filter((series) => series.sliceCount > 0)
    .sort((left, right) => {
      if (left.sliceCount !== right.sliceCount) {
        return right.sliceCount - left.sliceCount;
      }

      return left.seriesInstanceUid.localeCompare(right.seriesInstanceUid, 'en');
    })[0] ?? null;
}

function finalizeSeries(series) {
  series.files.sort(compareByInstance);
  series.sliceCount = series.files.length;

  return series;
}

function finalizeStudies(studyMap) {
  return [...studyMap.values()]
    .map((study) => {
      const series = [...study.seriesMap.values()]
        .map(finalizeSeries)
        .sort((left, right) => {
          if (left.modality === 'CT' && right.modality !== 'CT') {
            return -1;
          }
          if (left.modality !== 'CT' && right.modality === 'CT') {
            return 1;
          }
          if (left.sliceCount !== right.sliceCount) {
            return right.sliceCount - left.sliceCount;
          }
          return left.seriesInstanceUid.localeCompare(right.seriesInstanceUid, 'en');
        })
        .map((item) => ({
          ...item,
          studyInstanceUid: study.studyInstanceUid,
        }));

      return {
        studyKey: study.studyKey,
        studyInstanceUid: study.studyInstanceUid,
        patientName: study.patientName,
        patientId: study.patientId,
        studyDate: study.studyDate,
        series,
      };
    })
    .sort((left, right) => {
      const leftSliceCount = Math.max(...left.series.map((series) => series.sliceCount), 0);
      const rightSliceCount = Math.max(...right.series.map((series) => series.sliceCount), 0);
      if (leftSliceCount !== rightSliceCount) {
        return rightSliceCount - leftSliceCount;
      }
      return left.studyInstanceUid.localeCompare(right.studyInstanceUid, 'en');
    });
}

function addParsedFile(studyMap, metadata, source) {
  let study = studyMap.get(metadata.studyInstanceUid);
  if (!study) {
    study = {
      studyKey: stableKey('study', metadata.studyInstanceUid),
      studyInstanceUid: metadata.studyInstanceUid,
      patientName: metadata.patientName,
      patientId: metadata.patientId,
      studyDate: metadata.studyDate,
      seriesMap: new Map(),
    };
    studyMap.set(metadata.studyInstanceUid, study);
  } else {
    study.patientName ||= metadata.patientName;
    study.patientId ||= metadata.patientId;
    study.studyDate ||= metadata.studyDate;
  }

  let series = study.seriesMap.get(metadata.seriesInstanceUid);
  if (!series) {
    series = {
      seriesKey: stableKey('series', metadata.seriesInstanceUid),
      seriesInstanceUid: metadata.seriesInstanceUid,
      modality: metadata.modality,
      manufacturer: metadata.manufacturer,
      manufacturerModelName: metadata.manufacturerModelName,
      rows: metadata.rows,
      columns: metadata.columns,
      pixelSpacing: metadata.pixelSpacing,
      sliceThickness: metadata.sliceThickness,
      sliceCount: 0,
      files: [],
    };
    study.seriesMap.set(metadata.seriesInstanceUid, series);
  }

  series.files.push({
    source,
    instanceNumber: metadata.instanceNumber,
    imagePositionPatient: metadata.imagePositionPatient,
  });
}

async function parseCandidate(buffer, source, addWarning, addDicomDirWarning) {
  if (!hasDicomMagic(buffer)) {
    return false;
  }

  try {
    const parsed = extractDicomMetadata(buffer);
    if (parsed.isDicomDir) {
      addDicomDirWarning(sourceLabel(source));
    } else if (parsed.warning) {
      addWarning(`${parsed.warning} Source: ${sourceLabel(source)}`);
    }

    return parsed;
  } catch (error) {
    addWarning(
      `Could not parse DICOM "${sourceLabel(source)}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function inspectZipEntry(zip, entry, archivePath, addWarning, addDicomDirWarning) {
  if (entry.isDirectory) {
    return false;
  }

  if (path.posix.basename(entry.entryName.replace(/\\/g, '/')).toUpperCase() === 'DICOMDIR') {
    addDicomDirWarning(`${archivePath}:${entry.entryName}`);
  }

  let buffer;
  try {
    buffer = entry.getData();
  } catch (error) {
    addWarning(
      `Could not read ZIP entry "${entry.entryName}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }

  const source = sourceFromZipEntry(archivePath, entry.entryName);
  return parseCandidate(buffer, source, addWarning, addDicomDirWarning);
}

async function scanZip(zipPath, studyMap, collector, ancillaryImages) {
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .sort((left, right) =>
      left.entryName.localeCompare(right.entryName, 'en', { sensitivity: 'base' }),
    );

  let dicomFileCount = 0;
  for (const entry of entries) {
    if (isAncillaryImageName(entry.entryName)) {
      ancillaryImages.push(
        createAncillaryImage(
          sourceFromZipEntry(zipPath, entry.entryName),
          entry.entryName,
          entry.header?.size ?? 0,
        ),
      );
      continue;
    }
    const parsed = await inspectZipEntry(
      zip,
      entry,
      zipPath,
      collector.add,
      addDicomDirWarning(collector),
    );
    if (parsed?.metadata) {
      addParsedFile(studyMap, parsed.metadata, sourceFromZipEntry(zipPath, entry.entryName));
      dicomFileCount += 1;
    }
  }

  return {
    scannedFileCount: entries.length,
    dicomFileCount,
  };
}

function addDicomDirWarning(collector) {
  return (source) => {
    collector.add(
      `DICOMDIR was recognized but its directory index is not parsed in this version. Images are still discovered by recursive Part 10 scanning. Source: ${source}`,
    );
  };
}

async function inspectFilesystemFile(filePath, studyMap, collector, limits, ancillaryImages) {
  let handle;
  try {
    if (path.basename(filePath).toUpperCase() === 'DICOMDIR') {
      addDicomDirWarning(collector)(filePath);
    }

    handle = await fsp.open(filePath, 'r');
    const header = Buffer.alloc(DICOM_PREAMBLE_LENGTH + DICOM_MAGIC.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const headerBuffer = header.subarray(0, bytesRead);

    if (hasZipSignature(headerBuffer)) {
      await handle.close();
      handle = null;
      const zipResult = await scanZip(filePath, studyMap, collector, ancillaryImages);
      return zipResult;
    }

    if (isAncillaryImageName(filePath)) {
      const stat = await fsp.stat(filePath);
      ancillaryImages.push(
        createAncillaryImage(sourceFromFile(filePath), filePath, stat.size),
      );
      return { scannedFileCount: 1, dicomFileCount: 0 };
    }

    if (!hasDicomMagic(headerBuffer) || limits.dicomFiles >= limits.maxDicomFiles) {
      return { scannedFileCount: 1, dicomFileCount: 0 };
    }

    await handle.close();
    handle = null;
    const buffer = await fsp.readFile(filePath);
    const parsed = await parseCandidate(
      buffer,
      sourceFromFile(filePath),
      collector.add,
      addDicomDirWarning(collector),
    );
    if (!parsed?.metadata) {
      return { scannedFileCount: 1, dicomFileCount: 0 };
    }

    addParsedFile(studyMap, parsed.metadata, sourceFromFile(filePath));
    return { scannedFileCount: 1, dicomFileCount: 1 };
  } catch (error) {
    collector.add(
      `Could not inspect "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return { scannedFileCount: 1, dicomFileCount: 0 };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function scanDirectory(rootPath, studyMap, collector, limits, ancillaryImages) {
  let scannedFileCount = 0;
  let dicomFileCount = 0;
  const pending = [{ directory: rootPath, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current.depth > limits.maxDepth) {
      collector.add(`Skipped directory beyond maxDepth (${limits.maxDepth}): ${current.directory}`);
      continue;
    }

    let entries;
    try {
      entries = await fsp.readdir(current.directory, { withFileTypes: true });
    } catch (error) {
      collector.add(
        `Could not read directory "${current.directory}": ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    entries.sort((left, right) =>
      left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }),
    );

    for (const entry of entries) {
      const entryPath = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) {
        collector.add(`Skipped symbolic link: ${entryPath}`);
        continue;
      }

      if (entry.isDirectory()) {
        pending.push({ directory: entryPath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (scannedFileCount >= limits.maxFiles) {
        throw new Error(`DICOM scan exceeded maxFiles limit (${limits.maxFiles}).`);
      }

      const result = await inspectFilesystemFile(
        entryPath,
        studyMap,
        collector,
        limits,
        ancillaryImages,
      );
      scannedFileCount += result.scannedFileCount;
      dicomFileCount += result.dicomFileCount;
      limits.dicomFiles += result.dicomFileCount;
    }
  }

  return { scannedFileCount, dicomFileCount };
}

async function detectInputKind(inputPath) {
  const stat = await fsp.stat(inputPath);
  if (stat.isDirectory()) {
    return 'directory';
  }
  if (!stat.isFile()) {
    throw new Error(`Input is not a regular file or directory: ${inputPath}`);
  }

  const handle = await fsp.open(inputPath, 'r');
  try {
    const header = Buffer.alloc(132);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return hasZipSignature(header.subarray(0, bytesRead)) ? 'zip' : 'file';
  } finally {
    await handle.close();
  }
}

export async function scanDicomInput(inputPath, options = {}) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new TypeError('inputPath must be a non-empty string.');
  }

  const absolutePath = path.resolve(inputPath);
  const inputType = await detectInputKind(absolutePath);
  const studyMap = new Map();
  const ancillaryImages = [];
  const collector = createWarningCollector();
  const limits = {
    maxDepth: Number.isInteger(options.maxDepth) ? options.maxDepth : 32,
    maxFiles: Number.isInteger(options.maxFiles) ? options.maxFiles : 100_000,
    maxDicomFiles: Number.isInteger(options.maxDicomFiles)
      ? options.maxDicomFiles
      : 50_000,
    dicomFiles: 0,
  };

  let counts;
  if (inputType === 'directory') {
    counts = await scanDirectory(
      absolutePath,
      studyMap,
      collector,
      limits,
      ancillaryImages,
    );
  } else if (inputType === 'zip') {
    counts = await scanZip(absolutePath, studyMap, collector, ancillaryImages);
  } else {
    counts = await inspectFilesystemFile(
      absolutePath,
      studyMap,
      collector,
      limits,
      ancillaryImages,
    );
  }

  if (counts.scannedFileCount === 0) {
    collector.add('No files were found at the selected input.');
  }

  const studies = finalizeStudies(studyMap);
  const primarySeries = choosePrimarySeries(studies);
  if (!primarySeries && studies.length === 0) {
    collector.add('No importable DICOM image series were found.');
  } else if (!primarySeries) {
    collector.add('DICOM studies were found, but no image series contained slices.');
  }

  if (primarySeries) {
    const containingStudy = studies.find(
      (study) => study.studyInstanceUid === primarySeries.studyInstanceUid,
    );
    if (containingStudy) {
      primarySeries.studyKey = containingStudy.studyKey;
    }
  }

  const primarySummary = primarySeries
    ? {
        studyKey: primarySeries.studyKey,
        studyInstanceUid: primarySeries.studyInstanceUid,
        seriesKey: primarySeries.seriesKey,
        seriesInstanceUid: primarySeries.seriesInstanceUid,
        modality: primarySeries.modality,
        sliceCount: primarySeries.sliceCount,
        rows: primarySeries.rows,
        columns: primarySeries.columns,
      }
    : null;

  const sourceFiles = studies.flatMap((study) =>
    study.series.flatMap((series) => series.files.map((file) => file.source)),
  );
  const finalizedAncillaryImages = finalizeAncillaryImages(ancillaryImages);
  const importPlan = buildImportPlan(
    studies,
    primarySeries,
    absolutePath,
    inputType,
    finalizedAncillaryImages,
  );
  if (importPlan) {
    importPlan.warnings = [...collector.warnings];
  }

  return {
    inputPath: absolutePath,
    inputType,
    scannedFileCount: counts.scannedFileCount,
    dicomFileCount: counts.dicomFileCount,
    warnings: collector.warnings,
    studies,
    primarySeries: primarySummary,
    ancillaryImages: finalizedAncillaryImages,
    sourceFiles,
    importPlan,
  };
}

export { stableKey };
