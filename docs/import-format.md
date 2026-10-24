# DICOM Import and Local Library Format

This document defines the boundary between the Electron renderer, the DICOM
scanner, and the local study repository. It contains no patient-specific data.

## `scanDicomInput(inputPath, options)`

The scanner accepts:

- a directory, searched recursively;
- a ZIP archive, including archives with `.zip` in any letter case;
- one DICOM Part 10 file.

It also collects common 2D image files found beside the DICOM data
(`.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff`). Images whose path contains
`panorama` are classified as panoramic images; the largest remaining image is
used as a fallback panoramic preview. These files are copied under the study's
`ancillary/` directory and listed in `manifest.json` as `ancillaryImages`.

DICOM detection does not use the filename extension. A file is treated as a
DICOM image when it has the standard 128-byte preamble followed by `DICM`.
Corrupt candidates, unreadable paths, symbolic links, and missing UID metadata
produce warnings instead of aborting the whole import.

The scanner parses:

- PatientName, PatientID, StudyDate;
- StudyInstanceUID, SeriesInstanceUID;
- Modality, Manufacturer, ManufacturerModelName;
- Rows, Columns, InstanceNumber;
- ImagePositionPatient, PixelSpacing, SliceThickness.

Files are grouped by StudyInstanceUID and then SeriesInstanceUID. The primary
series is the CT series with the largest slice count. If a study has no CT
series, the scanner falls back to the image series with the largest slice
count.

A file source is represented as:

```json
{
  "kind": "file",
  "path": "C:\\import\\case\\slice"
}
```

A source inside a ZIP archive is represented without extracting it into the
library:

```json
{
  "kind": "zip-entry",
  "archivePath": "C:\\import\\case.ZIP",
  "entryName": "series/slice"
}
```

`scanDicomInput()` returns the complete scan result. Its `importPlan` property
is the object passed to `saveStudy()`. The selected study's plan has this shape:

```json
{
  "schemaVersion": 1,
  "origin": {
    "inputPath": "C:\\import\\case",
    "inputType": "directory"
  },
  "studyKey": "study-0123456789abcdef",
  "studyInstanceUid": "1.2.3",
  "patient": {
    "name": "Example^Patient",
    "id": "EXAMPLE-001"
  },
  "studyDate": "20261023",
  "primarySeriesKey": "series-fedcba9876543210",
  "series": [],
  "sourceFiles": [],
  "warnings": []
}
```

## DICOMDIR

The scanner recognizes DICOMDIR media directory files and emits an explicit
warning. It does not yet parse the DICOMDIR index. Images are still discovered
by recursively scanning the referenced directory or archive for Part 10 files.

## Local Library

Create a repository with:

```js
const repository = await createStudyRepository(libraryRoot);
const result = await repository.saveStudy(scanResult.importPlan);
```

The layout is:

```text
libraryRoot/
  studies/
    study-0123456789abcdef/
      manifest.json
      ancillary/
        001-panorama.jpg
        002-image.jpg
      series/
        series-fedcba9876543210/
          000001.dcm
          000002.dcm
```

Images are copied into a unique staging directory under `libraryRoot/.tmp`,
the manifest is written there, and the complete study directory is moved into
place with one rename. Source files are never deleted. ZIP entries are read
directly from the archive and copied into the library.

Re-importing the same StudyInstanceUID resolves to the same stable study key.
The second import returns `created: false` and `duplicate: true` rather than
copying or overwriting the existing study.

`manifest.json` stores two identities for the two viewer modes: a local
`patient` record for clinical review, and a deterministic `displayPatient`
record derived from the study key for presentation mode. The local library
therefore contains identifiable health information and must be protected with
operating-system account security, backups, and an appropriate retention
policy. Presentation mode must use `displayPatient`. The repository performs
no network transfer.

## Limits and Errors

Default scan limits are 100,000 files, 50,000 DICOM images, and directory depth
32. They can be changed with `maxFiles`, `maxDicomFiles`, and `maxDepth`.

Unreadable or malformed individual files are skipped with warnings. Invalid
root paths, unsafe study IDs, and inconsistent repository manifests are
reported as errors. A study directory without a readable manifest is never
silently overwritten.
