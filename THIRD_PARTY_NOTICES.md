# Third-Party Notices

> Product: Dental CT Workbench  
> Template status: engineering release notice; professional legal review still pending  
> Audit date: 2026-10-24  
> Final release version: `2.3.3`  
> Repository commit: `[FILL 40-CHARACTER COMMIT SHA]`  
> Lockfile: `package-lock.json`, lockfileVersion 3, SHA-256 `1515A41E575351886C530ED8000EFFE1B073583DD6F64B5D0E09FE635DF7E6B4`  
> SBOM: `[ATTACH CycloneDX OR SPDX SBOM AND RECORD SHA-256]`
> First-party license: PolyForm Noncommercial 1.0.0, Copyright (c) 2026 leehomyou

This file records third-party software used by the product. It is an engineering
compliance template, not legal advice. The final notice package must be
generated from the exact dependency graph embedded in the signed installer.

Do not describe this template as a completed legal review. Do not ship it with
placeholder values or without the corresponding full license texts.

## 1. Distribution Rule

For each package included in the installed application, preserve:

1. Package name and exact version.
2. Copyright notice from the package license file.
3. Full license text.
4. Any NOTICE, attribution, patent, or additional-license file.
5. The source URL and license identifier used for audit.

MIT and ISC licenses generally require the copyright and permission notice to
be included in copies or substantial portions of the software. Removing
license files from `node_modules`, `asar`, installers, or source archives can
breach those obligations even when the application itself is proprietary.

## 2. Current Direct Dependencies

The table below was checked against `package.json` and the npm registry on
2026-10-23. Versions marked with a range are not a reproducible final-release
baseline. The final document must be regenerated from `package-lock.json` and
the installed dependency tree.

| Package | Declared version | Resolved version in current lockfile | License identified by registry | Runtime / build | Planned inclusion |
| --- | --- | --- | --- | --- | --- |
| Electron | `45.0.0` | `45.0.0` | MIT | Runtime platform binary | Yes |
| React | `19.3.1` | `19.3.1` | MIT | Runtime, bundled | Yes |
| React DOM | `19.3.1` | `19.3.1` | MIT | Runtime, bundled | Yes |
| Vite | `8.3.5` | `8.3.5` | MIT | Build | Build tool, not intended as application API |
| `@vitejs/plugin-react` | `6.1.2` | `6.1.2` | MIT | Build | Build tool |
| `dicom-parser` | `1.8.21` | `1.8.21` | MIT | Runtime | Yes |
| `adm-zip` | `^0.5.16` | `0.5.18` | MIT | Runtime | Yes |
| `lucide-react` | `1.61.0` | `1.61.0` | ISC | UI assets, bundled | Yes |
| `@kitware/vtk.js` | `37.4.6` | `37.4.6` | BSD-3-Clause | 3D volume rendering, bundled | Yes |
| `electron-builder` | `26.15.3` | `26.15.3` | MIT | Build and packaging | Build tool |

## 3. Planned but Not Yet in `package.json`

These packages must not be listed as shipped until their exact versions and
transitive dependencies are present in the release lockfile.

| Package | Planned version | License identified by registry | Status |
| --- | --- | --- | --- |
| `@cornerstonejs/core` | `[PIN IN LOCKFILE]` | MIT | Planned |
| `@cornerstonejs/tools` | `[PIN IN LOCKFILE]` | MIT | Planned |

## 4. Electron Embedded Components

Electron embeds Chromium and Node.js. An Electron MIT notice alone does not
replace the notices for those embedded components or Chromium third-party
code. The release package must include the notices shipped with the exact
Electron distribution, including, where present:

- Electron license.
- Node.js license.
- Chromium license and third-party notices, commonly distributed as
  `LICENSES.chromium.html`.
- Other native, media, protocol, or platform components included in the
  Electron binary.

Do not hand-copy a short list of Chromium dependencies in place of the
generated upstream notice file. Preserve the complete file for the exact
Electron version.

## 5. Direct Dependency Source Records

| Package | Primary source | License reference |
| --- | --- | --- |
| Electron | <https://github.com/electron/electron> | Upstream `LICENSE` and Electron distribution notices |
| React / React DOM | <https://github.com/facebook/react> | Upstream `LICENSE` |
| Vite | <https://github.com/vitejs/vite> | Upstream `LICENSE` |
| `@vitejs/plugin-react` | <https://github.com/vitejs/vite-plugin-react> | Upstream `LICENSE` |
| `dicom-parser` | <https://github.com/cornerstonejs/dicomParser> | Upstream `LICENSE` |
| `adm-zip` | <https://github.com/cthackers/adm-zip> | Upstream `LICENSE` |
| `lucide-react` | <https://github.com/lucide-icons/lucide> | Upstream `LICENSE` |
| `@kitware/vtk.js` | <https://github.com/Kitware/vtk-js> | Upstream `LICENSE` (BSD-3-Clause) |
| `electron-builder` | <https://github.com/electron-userland/electron-builder> | Upstream `LICENSE` |
| Cornerstone3D, if added | <https://github.com/cornerstonejs/cornerstone3D> | Upstream `LICENSE` |

The source links are audit references. The final notice package must include
the license files from the exact versions that are installed, not only links.

## 6. Transitive Dependency Inventory

> [GENERATED SECTION - DO NOT SHIP EMPTY]

Populate this section from the production dependency closure of the locked
release build. Include bundled renderer dependencies, Electron main-process
dependencies, native modules, fonts, icons, WASM files, data tables, and
generated assets that originate from third parties.

| Package | Exact version | License | Copyright holder / notice | Runtime path | License file |
| --- | --- | --- | --- | --- | --- |
| `[package]` | `[version]` | `[SPDX or text]` | `[notice]` | `[asar/app.asar.unpacked/...]` | `[LICENSES/...]` |

## 7. Build-Only and Development Dependencies

Build-only tools generally do not execute in the shipped application, but they
may still create obligations when source code, source maps, test fixtures, or
build scripts are distributed. Record all such dependencies in the SBOM.

Treat the following as build-only unless the final artifact proves otherwise:

- Vite.
- `@vitejs/plugin-react`.
- `electron-builder`.
- Test frameworks and local development utilities.

Do not remove third-party copyright notices from source files, source maps,
generated CSS, or bundled assets merely because the product itself is
proprietary.

At the audited lockfile state, npm marked most packages as development
dependencies. That classification does not decide distribution obligations:
React, React DOM, Lucide, and other dependencies bundled into the renderer are
still shipped code. Electron is installed as a build dependency but its runtime
binary is distributed with the application. The final notice generator must
follow what is actually present in the installer, not only the top-level
`dependencies` section.

## 8. License Text Templates

### MIT License Template

The final notice must replace the placeholders with the exact text copied from
each installed package.

```text
Copyright (c) [YEAR] [COPYRIGHT HOLDER]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC License Template

The final notice must replace the placeholders with the exact text copied from
each installed package.

```text
Copyright (c) [YEAR] [COPYRIGHT HOLDER]

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

## 9. Release Packaging Layout

Suggested distribution layout:

```text
THIRD_PARTY_NOTICES.md
LICENSES/
  Electron-LICENSE.txt
  Electron-LICENSES.chromium.html
  Node-LICENSE.txt
  react-LICENSE.txt
  react-dom-LICENSE.txt
  vite-LICENSE.txt
  vite-plugin-react-LICENSE.txt
  dicom-parser-LICENSE.txt
  adm-zip-LICENSE.txt
  lucide-LICENSE.txt
  electron-builder-LICENSE.txt
  transitive/
    <one-file-per-package-or-aggregated-complete-text>
SBOM/
  release-sbom.cdx.json
  dependency-lock-sha256.txt
```

The installer and portable build must both expose or contain the notices. If
the installer cannot display the file before installation, provide an
accessible post-install `Third-Party Notices` entry and keep the files in the
application directory.

## 10. Release License Gate

Before signing or publishing:

1. Run `npm ci` from the committed lockfile.
2. Generate an SBOM for the production dependency closure.
3. Run a license inventory over direct and transitive packages.
4. Fail the build for missing or unknown license metadata.
5. Escalate copyleft, dual-license, source-available, non-commercial, font,
   data, binary-blob, and patent-clause licenses for professional review.
6. Collect exact copyright and license files from installed packages.
7. Include Electron/Chromium/Node notices from the exact Electron distribution.
8. Verify that the signed installer contains the notices and excludes
   placeholder text.
9. Compute SHA-256 for the installer, SBOM, notice bundle, and lockfile.
10. Archive the signed artifact, notices, SBOM, dependency report, build log,
    and approval record.

Suggested audit commands, to be adapted to the chosen tooling:

```powershell
npm ci
npm ls --all --json
npx license-checker-rseidelsohn --production --json
npx cyclonedx-npm --output-file release-sbom.cdx.json
Get-FileHash .\release-sbom.cdx.json -Algorithm SHA256
```

The commands above are process suggestions. Their output must be reviewed; a
successful command does not itself prove legal compliance.

## 11. Items Requiring Professional Review

- Whether any dependency is copyleft, source-available, non-commercial, or
  incompatible with the intended distribution model.
- Whether static inclusion of a runtime library creates additional obligations.
- Whether distributing source maps, test fixtures, schemas, icons, fonts, or
  DICOM sample data introduces separate copyright or data rights.
- Whether Electron/Chromium notices for the exact release satisfy all embedded
  component obligations.
- Whether the first-party EULA conflicts with any third-party license.
- Whether a patent, trademark, dataset, model, or standard is licensed
  separately.

## 12. Final Approval Record

```text
Release version: 2.3.3 (noncommercial source-available portable build)
Commit SHA:
Lockfile SHA-256: 1515A41E575351886C530ED8000EFFE1B073583DD6F64B5D0E09FE635DF7E6B4
SBOM SHA-256:
Installer SHA-256: B4D3A544BCA725E907431153D8EB97520C277491AF20B31BD902475DBAC3DFA9
Signer identity: unsigned
License inventory result: not completed
Dependencies requiring escalation: professional review pending
Reviewer:
Review date:
Approved for distribution: NO
```
