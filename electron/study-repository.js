import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import AdmZip from 'adm-zip';

const STUDY_KEY_PATTERN = /^study-[a-f0-9]{16}$/;
const SERIES_KEY_PATTERN = /^series-[a-f0-9]{16}$/;

function stableKey(prefix, value) {
  const digest = crypto
    .createHash('sha256')
    .update(String(value ?? ''), 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${digest}`;
}

function normalizePlan(importPlan) {
  if (!importPlan || typeof importPlan !== 'object') {
    throw new TypeError('importPlan must be an object produced by scanDicomInput().');
  }

  const plan = importPlan.importPlan ?? importPlan;
  if (!plan || typeof plan !== 'object') {
    throw new TypeError('importPlan is missing a usable import plan.');
  }

  const studyInstanceUid = String(plan.studyInstanceUid ?? '').trim();
  if (!studyInstanceUid) {
    throw new TypeError('importPlan.studyInstanceUid is required.');
  }

  const studyKey = STUDY_KEY_PATTERN.test(String(plan.studyKey ?? ''))
    ? String(plan.studyKey)
    : stableKey('study', studyInstanceUid);
  const series = Array.isArray(plan.series) ? plan.series : [];

  if (series.length === 0) {
    throw new TypeError('importPlan.series must contain at least one series.');
  }

  const normalizedSeries = series.map((item) => ({
    ...item,
    seriesKey: SERIES_KEY_PATTERN.test(String(item.seriesKey ?? ''))
      ? String(item.seriesKey)
      : stableKey('series', item.seriesInstanceUid),
    files: Array.isArray(item.files) ? item.files : [],
  }));
  const explicitPrimary = normalizedSeries.find(
    (item) => item.seriesKey === plan.primarySeriesKey,
  );
  const inferredPrimary =
    explicitPrimary ??
    normalizedSeries.find((item) => item.isPrimary) ??
    [...normalizedSeries]
      .filter((item) => item.modality === 'CT')
      .sort((left, right) => right.files.length - left.files.length)[0] ??
    normalizedSeries[0];

  return {
    ...plan,
    studyKey,
    primarySeriesKey: inferredPrimary.seriesKey,
    series: normalizedSeries,
  };
}

function anonymousIdentity(studyKey) {
  const suffix = studyKey.slice('study-'.length, 'study-'.length + 8).toUpperCase();
  return {
    displayName: `Anonymized study ${suffix}`,
    displayId: `ANON-${suffix}`,
    anonymized: true,
  };
}

function safeArchiveEntryName(entryName) {
  return String(entryName ?? '').replace(/\\/g, '/');
}

function normalizeAncillaryPlan(plan) {
  if (!Array.isArray(plan.ancillaryImages)) return [];

  return plan.ancillaryImages.map((image, index) => {
    const label = String(image.label ?? `image-${index + 1}`).trim();
    const extension = ['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'].includes(
      path.extname(label).toLowerCase(),
    )
      ? path.extname(label).toLowerCase()
      : '.jpg';
    const kind = image.kind === 'panorama' ? 'panorama' : 'image';
    const storedPath = `ancillary/${String(index + 1).padStart(3, '0')}-${kind}${extension}`;
    const mimeType =
      extension === '.png'
        ? 'image/png'
        : extension === '.bmp'
          ? 'image/bmp'
          : extension === '.tif' || extension === '.tiff'
            ? 'image/tiff'
            : 'image/jpeg';

    return {
      id: `ancillary-${crypto.randomUUID()}`,
      kind,
      label,
      size: Number.isFinite(image.size) ? image.size : 0,
      storedPath,
      mimeType,
      source: image.source,
    };
  });
}

async function writeZipEntry(zip, source, destinationPath) {
  const entry = zip.getEntry(safeArchiveEntryName(source.entryName));
  if (!entry || entry.isDirectory) {
    throw new Error(`ZIP entry not found: ${source.entryName}`);
  }

  await fsp.writeFile(destinationPath, entry.getData(), { flag: 'wx' });
}

async function copySource(source, destinationPath, zipCache) {
  if (!source || typeof source !== 'object') {
    throw new TypeError('Each image needs a source object.');
  }

  if (source.kind === 'zip-entry') {
    const archivePath = path.resolve(String(source.archivePath ?? ''));
    if (!source.archivePath) {
      throw new TypeError('ZIP source is missing archivePath.');
    }

    let zip = zipCache.get(archivePath);
    if (!zip) {
      zip = new AdmZip(archivePath);
      zipCache.set(archivePath, zip);
    }

    await writeZipEntry(zip, source, destinationPath);
    return;
  }

  if (source.kind === 'file' || source.path) {
    const sourcePath = path.resolve(String(source.path ?? ''));
    if (!source.path) {
      throw new TypeError('File source is missing path.');
    }
    await fsp.copyFile(sourcePath, destinationPath);
    return;
  }

  throw new TypeError(`Unsupported source kind: ${String(source.kind)}`);
}

function buildManifest(plan, importedAt) {
  const series = plan.series.map((item) => ({
    seriesKey: item.seriesKey,
    seriesInstanceUid: item.seriesInstanceUid ?? null,
    modality: item.modality ?? '',
    description: item.description ?? '',
    manufacturer: item.manufacturer ?? '',
    manufacturerModelName: item.manufacturerModelName ?? '',
    rows: Number.isFinite(item.rows) ? item.rows : null,
    columns: Number.isFinite(item.columns) ? item.columns : null,
    pixelSpacing: Array.isArray(item.pixelSpacing) ? item.pixelSpacing : [],
    sliceThickness: Number.isFinite(item.sliceThickness) ? item.sliceThickness : null,
    sliceCount: Array.isArray(item.files) ? item.files.length : 0,
    isPrimary: Boolean(item.isPrimary || item.seriesKey === plan.primarySeriesKey),
    files: (Array.isArray(item.files) ? item.files : []).map((file, index) => ({
      fileName: `${String(index + 1).padStart(6, '0')}.dcm`,
      instanceNumber: Number.isFinite(file.instanceNumber) ? file.instanceNumber : null,
      imagePositionPatient: Array.isArray(file.imagePositionPatient)
        ? file.imagePositionPatient
        : [],
    })),
  }));
  const ancillaryImages = normalizeAncillaryPlan(plan).map(
    ({ source: _source, ...image }) => image,
  );

  return {
    schemaVersion: 1,
    studyKey: plan.studyKey,
    studyInstanceUid: plan.studyInstanceUid,
    studyDate: plan.studyDate || null,
    patient: {
      name: String(plan.patient?.name ?? plan.patientName ?? '').trim(),
      id: String(plan.patient?.id ?? plan.patientId ?? '').trim(),
      sex: String(plan.patient?.sex ?? plan.sex ?? '').trim(),
      birthDate: String(plan.patient?.birthDate ?? plan.birthDate ?? '').trim(),
    },
    displayPatient: anonymousIdentity(plan.studyKey),
    description:
      series.find((item) => item.isPrimary)?.description ||
      plan.description ||
      '牙科 CT / CBCT',
    modality:
      series.find((item) => item.isPrimary)?.modality ||
      plan.modality ||
      'CT',
    manufacturer:
      series.find((item) => item.isPrimary)?.manufacturer ||
      plan.manufacturer ||
      '',
    ancillaryImages,
    primarySeriesKey:
      series.find((item) => item.isPrimary)?.seriesKey ?? series[0]?.seriesKey ?? null,
    series,
    importedAt,
    updatedAt: importedAt,
    sourceInputType: plan.origin?.inputType ?? plan.sourceKind ?? null,
  };
}

async function writeManifest(directory, manifest) {
  const manifestPath = path.join(directory, 'manifest.json');
  const temporaryPath = path.join(directory, `.manifest-${crypto.randomUUID()}.tmp`);
  await fsp.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fsp.rename(temporaryPath, manifestPath);
}

function isAlreadyExistsError(error) {
  return error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY');
}

export function createStudyRepository(libraryRoot) {
  if (typeof libraryRoot !== 'string' || libraryRoot.trim() === '') {
    throw new TypeError('libraryRoot must be a non-empty string.');
  }

  const rootPath = path.resolve(libraryRoot);
  const studiesPath = path.join(rootPath, 'studies');
  const temporaryPath = path.join(rootPath, '.tmp');

  async function ensureLayout() {
    await fsp.mkdir(studiesPath, { recursive: true });
    await fsp.mkdir(temporaryPath, { recursive: true });
  }

  function resolveStudyDirectory(studyId) {
    const normalized = String(studyId ?? '').trim();
    if (!STUDY_KEY_PATTERN.test(normalized)) {
      throw new TypeError(`Invalid studyId: ${normalized}`);
    }

    const candidate = path.resolve(studiesPath, normalized);
    if (path.dirname(candidate) !== studiesPath) {
      throw new Error('Resolved study path is outside the library studies directory.');
    }
    return candidate;
  }

  async function loadManifest(studyId) {
    await ensureLayout();
    const directory = resolveStudyDirectory(studyId);
    const manifestPath = path.join(directory, 'manifest.json');

    try {
      const text = await fsp.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(text);
      if (!manifest || typeof manifest !== 'object') {
        throw new Error(`Invalid manifest: ${manifestPath}`);
      }
      return manifest;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async function listStudies() {
    await ensureLayout();
    const entries = await fsp.readdir(studiesPath, { withFileTypes: true });
    const manifests = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !STUDY_KEY_PATTERN.test(entry.name)) {
        continue;
      }

      try {
        const manifest = await loadManifest(entry.name);
        if (manifest) {
          manifests.push(manifest);
        }
      } catch {
        // A damaged entry must not hide otherwise valid studies from the library.
      }
    }

    return manifests.sort((left, right) => {
      const leftTime = Date.parse(left.importedAt ?? '') || 0;
      const rightTime = Date.parse(right.importedAt ?? '') || 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return String(left.studyKey).localeCompare(String(right.studyKey), 'en');
    });
  }

  async function saveStudy(importPlan) {
    await ensureLayout();
    const plan = normalizePlan(importPlan);
    const finalDirectory = resolveStudyDirectory(plan.studyKey);

    const existing = await loadManifest(plan.studyKey);
    if (existing) {
      return {
        created: false,
        duplicate: true,
        studyKey: plan.studyKey,
        directory: finalDirectory,
        manifest: existing,
      };
    }

    try {
      const stat = await fsp.stat(finalDirectory);
      if (stat.isDirectory()) {
        throw new Error(
          `Study directory already exists without a readable manifest: ${finalDirectory}`,
        );
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    const stagingDirectory = path.join(
      temporaryPath,
      `${plan.studyKey}-${process.pid}-${crypto.randomUUID()}`,
    );
    const zipCache = new Map();
    let renamed = false;

    try {
      await fsp.mkdir(stagingDirectory, { recursive: true });

      for (const series of plan.series) {
        const seriesDirectory = path.join(stagingDirectory, 'series', series.seriesKey);
        await fsp.mkdir(seriesDirectory, { recursive: true });

        for (const [index, file] of series.files.entries()) {
          const destination = path.join(
            seriesDirectory,
            `${String(index + 1).padStart(6, '0')}.dcm`,
          );
          await copySource(file.source, destination, zipCache);
        }
      }

      for (const image of normalizeAncillaryPlan(plan)) {
        const destination = path.join(stagingDirectory, image.storedPath);
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await copySource(image.source, destination, zipCache);
      }

      const importedAt = new Date().toISOString();
      const manifest = buildManifest(plan, importedAt);
      await writeManifest(stagingDirectory, manifest);

      try {
        await fsp.rename(stagingDirectory, finalDirectory);
        renamed = true;
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          const duplicateManifest = await loadManifest(plan.studyKey);
          if (duplicateManifest) {
            return {
              created: false,
              duplicate: true,
              studyKey: plan.studyKey,
              directory: finalDirectory,
              manifest: duplicateManifest,
            };
          }
        }
        throw error;
      }

      return {
        created: true,
        duplicate: false,
        studyKey: plan.studyKey,
        directory: finalDirectory,
        manifest,
      };
    } finally {
      if (!renamed) {
        await fsp.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async function getStudy(studyId) {
    return loadManifest(studyId);
  }

  async function deleteStudy(studyId) {
    await ensureLayout();
    const directory = resolveStudyDirectory(studyId);

    try {
      await fsp.rm(directory, { recursive: true, force: false });
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  return {
    rootPath,
    studiesPath,
    listStudies,
    saveStudy,
    deleteStudy,
    getStudy,
    loadManifest,
  };
}
