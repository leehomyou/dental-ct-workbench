import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { scanDicomInput } from '../electron/dicom-import.js';
import { createStudyRepository } from '../electron/study-repository.js';

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
  patientName = 'Confidential^Patient',
  patientId = 'SECRET-42',
  studyUid = '1.2.840.777.1',
  seriesUid = '1.2.840.777.1.1',
  modality = 'CT',
  instanceNumber = 1,
  z = 0,
} = {}) {
  const transferSyntax = explicitElement(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  const sopClass = explicitElement(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.2');
  const payload = Buffer.concat([
    explicitElement(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    explicitElement(0x0008, 0x0020, 'DA', '20261023'),
    explicitElement(0x0008, 0x0060, 'CS', modality),
    explicitElement(0x0008, 0x0070, 'LO', 'Fixture Vendor'),
    explicitElement(0x0008, 0x1090, 'LO', 'Fixture Model'),
    explicitElement(0x0010, 0x0010, 'PN', patientName),
    explicitElement(0x0010, 0x0020, 'LO', patientId),
    explicitElement(0x0018, 0x0050, 'DS', '0.3'),
    explicitElement(0x0020, 0x000D, 'UI', studyUid),
    explicitElement(0x0020, 0x000E, 'UI', seriesUid),
    explicitElement(0x0020, 0x0013, 'IS', String(instanceNumber)),
    explicitElement(0x0020, 0x0032, 'DS', `0\\0\\${z}`),
    explicitElement(0x0028, 0x0010, 'US', 320),
    explicitElement(0x0028, 0x0011, 'US', 320),
    explicitElement(0x0028, 0x0030, 'DS', '0.3\\0.3'),
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

async function makeFixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ct-repository-'));
  temporaryDirectories.push(root);
  const input = path.join(root, '输入资料');
  const library = path.join(root, '病例库-中文');
  await fsp.mkdir(input, { recursive: true });

  await fsp.writeFile(path.join(input, 'slice-1.dcm'), makeDicom({ instanceNumber: 1, z: 0 }));
  await fsp.writeFile(path.join(input, 'slice-2.bin'), makeDicom({ instanceNumber: 2, z: 0.3 }));
  await fsp.mkdir(path.join(input, 'PANORAMA'), { recursive: true });
  await fsp.writeFile(
    path.join(input, 'PANORAMA', 'panorama.jpg'),
    Buffer.alloc(21_000, 0xff),
  );

  const scan = await scanDicomInput(input);
  return { root, input, library, scan };
}

test('saves one study atomically and treats duplicate import as idempotent', async () => {
  const fixture = await makeFixture();
  const repository = await createStudyRepository(fixture.library);

  const first = await repository.saveStudy(fixture.scan.importPlan);
  const second = await repository.saveStudy(fixture.scan.importPlan);

  assert.equal(first.created, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.created, false);
  assert.equal(second.duplicate, true);

  const series = first.manifest.series.find((item) => item.isPrimary);
  const copiedFiles = await fsp.readdir(
    path.join(first.directory, 'series', series.seriesKey),
  );
  assert.deepEqual(copiedFiles, ['000001.dcm', '000002.dcm']);
  assert.equal(first.manifest.ancillaryImages.length, 1);
  assert.equal(first.manifest.ancillaryImages[0].kind, 'panorama');
  assert.equal(
    await fsp.readFile(
      path.join(first.directory, first.manifest.ancillaryImages[0].storedPath),
    ).then((buffer) => buffer.length),
    21_000,
  );
  assert.equal(first.manifest.displayPatient.anonymized, true);
  assert.equal(first.manifest.patient.name, 'Confidential^Patient');
  assert.equal(first.manifest.patient.id, 'SECRET-42');
  assert.notEqual(first.manifest.displayPatient.name, first.manifest.patient.name);
  assert.notEqual(first.manifest.displayPatient.id, first.manifest.patient.id);
});

test('lists, reads, and deletes a study manifest', async () => {
  const fixture = await makeFixture();
  const repository = await createStudyRepository(fixture.library);
  const saved = await repository.saveStudy(fixture.scan.importPlan);

  const studies = await repository.listStudies();
  assert.equal(studies.length, 1);
  assert.equal(studies[0].studyKey, saved.studyKey);

  const manifest = await repository.loadManifest(saved.studyKey);
  assert.equal(manifest.studyKey, saved.studyKey);
  assert.equal((await repository.getStudy(saved.studyKey)).studyKey, saved.studyKey);

  assert.equal(await repository.deleteStudy(saved.studyKey), true);
  assert.equal(await repository.getStudy(saved.studyKey), null);
  assert.deepEqual(await repository.listStudies(), []);
  assert.equal(await repository.deleteStudy(saved.studyKey), false);
});
