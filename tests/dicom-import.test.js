import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import AdmZip from 'adm-zip';

import { scanDicomInput } from '../electron/dicom-import.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fsp.rm(directory, { recursive: true, force: true }),
    ),
  );
});

function explicitElement(group, element, vr, value) {
  const tag = Buffer.alloc(4);
  tag.writeUInt16LE(group, 0);
  tag.writeUInt16LE(element, 2);

  let data;
  if (vr === 'US') {
    data = Buffer.alloc(2);
    data.writeUInt16LE(Number(value), 0);
  } else {
    data = Buffer.from(String(value), 'latin1');
    if (data.length % 2 !== 0) {
      data = Buffer.concat([data, Buffer.from(vr === 'UI' ? '\0' : ' ', 'ascii')]);
    }
  }

  const header = Buffer.alloc(8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(element, 2);
  header.write(vr, 4, 2, 'ascii');
  header.writeUInt16LE(data.length, 6);
  return Buffer.concat([header, data]);
}

function makeDicom({
  patientName = 'Test^Patient',
  patientId = 'P001',
  studyUid = '1.2.3.4.5',
  seriesUid = '1.2.3.4.5.1',
  modality = 'CT',
  instanceNumber = 1,
  rows = 512,
  columns = 512,
  z = 0,
  mediaStorageSopClassUid = '1.2.840.10008.5.1.4.1.1.2',
} = {}) {
  const transferSyntax = explicitElement(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  const sopClass = explicitElement(0x0002, 0x0002, 'UI', mediaStorageSopClassUid);
  const payload = Buffer.concat([
    explicitElement(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    explicitElement(0x0008, 0x0020, 'DA', '20261023'),
    explicitElement(0x0008, 0x0060, 'CS', modality),
    explicitElement(0x0008, 0x0070, 'LO', 'Fixture Vendor'),
    explicitElement(0x0008, 0x1090, 'LO', 'Fixture Model'),
    explicitElement(0x0010, 0x0010, 'PN', patientName),
    explicitElement(0x0010, 0x0020, 'LO', patientId),
    explicitElement(0x0018, 0x0050, 'DS', '0.25'),
    explicitElement(0x0020, 0x000D, 'UI', studyUid),
    explicitElement(0x0020, 0x000E, 'UI', seriesUid),
    explicitElement(0x0020, 0x0013, 'IS', String(instanceNumber)),
    explicitElement(0x0020, 0x0032, 'DS', `0\\0\\${z}`),
    explicitElement(0x0028, 0x0010, 'US', rows),
    explicitElement(0x0028, 0x0011, 'US', columns),
    explicitElement(0x0028, 0x0030, 'DS', '0.25\\0.25'),
  ]);

  const meta = Buffer.concat([sopClass, transferSyntax]);
  const groupLengthValue = Buffer.alloc(4);
  groupLengthValue.writeUInt32LE(meta.length, 0);
  const groupLengthHeader = Buffer.alloc(8);
  groupLengthHeader.writeUInt16LE(0x0002, 0);
  groupLengthHeader.writeUInt16LE(0x0000, 2);
  groupLengthHeader.write('UL', 4, 2, 'ascii');
  groupLengthHeader.writeUInt16LE(4, 6);

  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM', 'ascii'),
    groupLengthHeader,
    groupLengthValue,
    meta,
    payload,
  ]);
}

async function makeTempDirectory(prefix = 'ct-import-') {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

test('groups series by Study and chooses the largest CT series regardless of extension', async () => {
  const root = await makeTempDirectory('ct-import-group-');
  const nested = path.join(root, '中文目录', 'nested');
  await fsp.mkdir(nested, { recursive: true });

  await fsp.writeFile(
    path.join(root, 'first.bin'),
    makeDicom({ instanceNumber: 2, z: 2 }),
  );
  await fsp.writeFile(
    path.join(nested, 'second.DCM'),
    makeDicom({ instanceNumber: 1, z: 1 }),
  );
  await fsp.writeFile(
    path.join(nested, 'third'),
    makeDicom({ instanceNumber: 3, z: 3 }),
  );
  await fsp.writeFile(
    path.join(root, 'panorama.dcm'),
    makeDicom({
      seriesUid: '1.2.3.4.5.2',
      modality: 'OT',
      instanceNumber: 1,
      rows: 1200,
      columns: 2400,
    }),
  );
  await fsp.writeFile(
    path.join(root, 'other-study.dcm'),
    makeDicom({
      studyUid: '9.8.7.6',
      seriesUid: '9.8.7.6.1',
      modality: 'MR',
      instanceNumber: 1,
    }),
  );

  const result = await scanDicomInput(root);

  assert.equal(result.studies.length, 2);
  assert.equal(result.dicomFileCount, 5);
  assert.equal(result.primarySeries.modality, 'CT');
  assert.equal(result.primarySeries.sliceCount, 3);
  assert.equal(result.primarySeries.rows, 512);
  assert.equal(result.importPlan.patient.name, 'Test^Patient');
  assert.deepEqual(
    result.importPlan.series.find((series) => series.isPrimary).files.map(
      (file) => file.instanceNumber,
    ),
    [1, 2, 3],
  );
  assert.ok(result.sourceFiles.some((source) => source.path.endsWith('中文目录\\nested\\third')));
});

test('scans ZIP entries and reports corrupt DICOM files as warnings', async () => {
  const root = await makeTempDirectory('ct-import-zip-');
  const archivePath = path.join(root, '中文扫描包.ZIP');
  const zip = new AdmZip();

  zip.addFile('病例/切片无扩展名', makeDicom({ instanceNumber: 1, z: 1 }));
  zip.addFile('病例/UPPER.DCM', makeDicom({ instanceNumber: 2, z: 2 }));
  zip.addFile('病例/damaged.dcm', Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM', 'ascii'),
    Buffer.from([0xfe, 0xff, 0x00, 0xe0]),
  ]));
  zip.writeZip(archivePath);

  const result = await scanDicomInput(archivePath);

  assert.equal(result.inputType, 'zip');
  assert.equal(result.dicomFileCount, 2);
  assert.equal(result.primarySeries.sliceCount, 2);
  assert.ok(result.warnings.some((warning) => warning.includes('Could not parse DICOM')));
  assert.ok(result.sourceFiles.every((source) => source.kind === 'zip-entry'));
});

test('recognizes DICOMDIR and continues discovering Part 10 images', async () => {
  const root = await makeTempDirectory('ct-import-dicomdir-');
  const nested = path.join(root, 'nested');
  await fsp.mkdir(nested);
  await fsp.writeFile(
    path.join(root, 'DICOMDIR'),
    makeDicom({ mediaStorageSopClassUid: '1.2.840.10008.1.3.10' }),
  );
  await fsp.writeFile(path.join(nested, 'DICOMDIR'), 'not a valid DICOM directory');
  await fsp.writeFile(
    path.join(root, 'image-no-extension'),
    makeDicom({ instanceNumber: 1 }),
  );

  const result = await scanDicomInput(root);

  assert.equal(result.primarySeries.sliceCount, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('DICOMDIR was recognized')));
});
