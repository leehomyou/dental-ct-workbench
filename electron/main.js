import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scanDicomInput } from "./dicom-import.js";
import { createStudyRepository } from "./study-repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isSmokeTest = process.argv.includes("--smoke-test");
const libraryRoot = path.join(app.getPath("userData"), "ct-library");
let mainWindow = null;
let repository = null;

app.setName("Dental CT Workbench");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: "ctdata",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      corsEnabled: true,
    },
  },
]);

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function registerDataProtocol() {
  const distRoot = path.resolve(__dirname, "../dist");
  protocol.handle("app", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const relativePath = decodeURIComponent(
        requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, ""),
      );
      const targetPath = path.resolve(distRoot, relativePath);
      if (!isWithin(distRoot, targetPath) && targetPath !== distRoot) {
        return new Response("Forbidden", { status: 403 });
      }
      return net.fetch(pathToFileURL(targetPath).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  protocol.handle("ctdata", async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const studyKey = decodeURIComponent(requestUrl.hostname);
      const relativePath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""));
      const studyRoot = path.join(libraryRoot, "studies", studyKey);
      const targetPath = path.resolve(studyRoot, relativePath);
      if (!isWithin(studyRoot, targetPath)) {
        return new Response("Forbidden", { status: 403 });
      }
      const fileResponse = await net.fetch(pathToFileURL(targetPath).toString());
      const bytes = await fileResponse.arrayBuffer();
      return new Response(bytes, {
        status: fileResponse.status,
        headers: {
          "Content-Type":
            fileResponse.headers.get("Content-Type") || "application/dicom",
          "Access-Control-Allow-Origin": "app://viewer",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function sendImportProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("library:import-progress", payload);
  }
}

async function importSelectedPath(sourcePath, sourceKind) {
  sendImportProgress({ stage: "scanning", sourcePath });
  const scanResult = await scanDicomInput(sourcePath);
  const importPlan = scanResult.importPlan || scanResult.plan;
  if (!importPlan) {
    throw new Error(scanResult.warnings?.[0] || "未在所选文件中找到可识别的 DICOM 检查。");
  }

  sendImportProgress({ stage: "copying", studies: 1 });
  const savedStudy = await repository.saveStudy({
    ...importPlan,
    sourceKind,
  });
  const imported = [
    {
      id: savedStudy.studyKey,
      ...savedStudy.manifest,
    },
  ];
  return { imported, warnings: scanResult.warnings || [] };
}

function registerIpcHandlers() {
  ipcMain.handle("library:list", () => repository.listStudies());
  ipcMain.handle("library:get", (_event, studyId) => repository.getStudy(studyId));
  ipcMain.handle("library:delete", (_event, studyId) => repository.deleteStudy(studyId));

  ipcMain.handle("library:import-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择包含 DICOM 的文件夹",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return importSelectedPath(result.filePaths[0], "folder");
  });

  ipcMain.handle("library:import-archive", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择 DICOM 压缩包",
      properties: ["openFile"],
      filters: [
        { name: "DICOM 压缩包", extensions: ["zip"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return importSelectedPath(result.filePaths[0], "archive");
  });

  ipcMain.handle("measurements:load", async (_event, studyId) => {
    const study = await repository.getStudy(studyId);
    const filePath = path.join(study.storagePath || path.join(libraryRoot, "studies", studyId), "measurements.json");
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      return { measurements: [] };
    }
  });

  ipcMain.handle("measurements:save", async (_event, { studyId, payload }) => {
    const study = await repository.getStudy(studyId);
    const studyRoot = study.storagePath || path.join(libraryRoot, "studies", studyId);
    await fs.mkdir(studyRoot, { recursive: true });
    const filePath = path.join(studyRoot, "measurements.json");
    const temporaryPath = `${filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(temporaryPath, filePath);
    return { ok: true };
  });

  ipcMain.handle("shell:open-path", async (_event, targetPath) => {
    if (typeof targetPath !== "string") return { ok: false };
    const error = await shell.openPath(targetPath);
    return { ok: !error, error };
  });

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    libraryRoot,
    packaged: app.isPackaged,
  }));
}

async function runSmokeTest(window) {
  const timeout = setTimeout(() => {
    console.error("SMOKE_RESULT=" + JSON.stringify({ ok: false, reason: "timeout" }));
    app.exit(1);
  }, 60000);

  try {
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const deadline = Date.now() + 20000;
        while (!document.querySelector("[data-action='import-folder']") && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        let apiProbe = null;
        try {
          apiProbe = await Promise.race([
            window.ctApi?.listStudies?.(),
            new Promise((resolve) => setTimeout(() => resolve("timeout"), 4000)),
          ]);
          if (Array.isArray(apiProbe)) {
            apiProbe = { studyCount: apiProbe.length };
          }
        } catch (error) {
          apiProbe = "error:" + (error?.message || String(error));
        }
        const studyRows = document.querySelectorAll(".study-row").length;
        let viewerReady = false;
        let renderedCanvasCount = 0;
        let expandButtonCount = 0;
        let singleViewSidebarsPersist = null;
        let visibleViewportCount = 0;
        let distanceMeasurementAdded = false;
        let measurementAnchorError = null;
        let measurementDebug = null;
        let presentationHidesPatient = false;
        let hoverCoordinatesStable = false;
        let panClickMovesCoordinates = false;
        let panClickBefore = "";
        let panClickAfter = "";
        let panoramaVisible = true;
        let seriesTabCount = 0;
        let volume3dReady = false;
        let volume3dText = "";
        let volume3dError = "";
        let paneRotationWorks = false;
        let rotationCoordinatesStable = false;
        let otherPanesStable = false;
        let aboutDialogReady = false;
        if (studyRows > 0) {
          document.querySelector(".study-row .open-study")?.click();
          const viewerDeadline = Date.now() + 30000;
          while (Date.now() < viewerDeadline) {
            renderedCanvasCount = [...document.querySelectorAll(".image-surface canvas")]
              .filter((canvas) => canvas.width > 0 && canvas.height > 0).length;
            expandButtonCount = document.querySelectorAll("[data-plane] .icon-button").length;
            if (document.querySelector(".mpr-grid") && renderedCanvasCount >= 3) {
              viewerReady = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          if (viewerReady) {
            document.querySelector('[data-action="show-about"]')?.click();
            await new Promise((resolve) => setTimeout(resolve, 120));
            const aboutDialog = document.querySelector("[data-about-dialog]");
            aboutDialogReady = Boolean(
              aboutDialog &&
              /牙科 CT 影像工作台/.test(aboutDialog.textContent || "") &&
              /版本 2\\.3\\.2/.test(aboutDialog.textContent || "") &&
              /未完成医疗器械注册/.test(aboutDialog.textContent || "")
            );
            aboutDialog?.querySelector(".about-close")?.click();
            await new Promise((resolve) => setTimeout(resolve, 80));
            const volumeDeadline = Date.now() + 20000;
            while (Date.now() < volumeDeadline) {
              const canvas = document.querySelector(".volume-3d-canvas canvas");
              const errorOverlay = document.querySelector(
                ".volume-3d-overlay.error",
              );
              if (canvas && canvas.width > 0 && canvas.height > 0 && !errorOverlay) {
                volume3dReady = true;
                break;
              }
              if (errorOverlay) {
                volume3dError =
                  errorOverlay.querySelector("small")?.textContent || errorOverlay.textContent;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            volume3dText =
              document.querySelector(".overview-panel")?.innerText.slice(0, 300) || "";
            [...document.querySelectorAll(".tool-button")]
              .find((button) => button.title === "旋转")
              ?.click();
            await new Promise((resolve) => setTimeout(resolve, 120));
            const axialPanel = document.querySelector('[data-plane="axial"]');
            const axialSurface = axialPanel?.querySelector(".image-surface");
            const axialRect = axialSurface?.getBoundingClientRect();
            if (axialSurface && axialRect) {
              const axialCanvas = axialPanel.querySelector("canvas");
              const transformBeforeRotation = axialSurface.style.transform;
              const coronalCanvas = document.querySelector(
                '[data-plane="coronal"] canvas',
              );
              const sagittalCanvas = document.querySelector(
                '[data-plane="sagittal"] canvas',
              );
              const coronalImageBeforeRotation = coronalCanvas?.toDataURL();
              const sagittalImageBeforeRotation = sagittalCanvas?.toDataURL();
              const coronalTransformBeforeRotation =
                document.querySelector(
                  '[data-plane="coronal"] .image-surface',
                )?.style.transform;
              const sagittalTransformBeforeRotation =
                document.querySelector(
                  '[data-plane="sagittal"] .image-surface',
                )?.style.transform;
              const coordinatesBeforeRotation =
                document.querySelector(".coordinate-strip")?.textContent || "";
              const centerX = axialRect.left + axialRect.width / 2;
              const centerY = axialRect.top + axialRect.height / 2;
              const pointerId = 19;
              axialSurface.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                pointerId,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: 1,
                clientX: centerX + axialRect.width * 0.25,
                clientY: centerY,
              }));
              await new Promise((resolve) => setTimeout(resolve, 80));
              axialSurface.dispatchEvent(new PointerEvent("pointermove", {
                bubbles: true,
                pointerId,
                pointerType: "mouse",
                isPrimary: true,
                buttons: 1,
                clientX: centerX,
                clientY: centerY + axialRect.height * 0.25,
              }));
              await new Promise((resolve) => setTimeout(resolve, 100));
              axialSurface.dispatchEvent(new PointerEvent("pointerup", {
                bubbles: true,
                pointerId,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: 0,
                clientX: centerX,
                clientY: centerY + axialRect.height * 0.25,
              }));
              await new Promise((resolve) => setTimeout(resolve, 250));
              const rotationDegrees = Number(
                axialSurface.style.transform.match(/rotate\\(([-\\d.]+)deg\\)/)?.[1],
              );
              paneRotationWorks =
                transformBeforeRotation !== axialSurface.style.transform &&
                Number.isFinite(rotationDegrees) &&
                Math.abs(rotationDegrees - 90) < 0.5 &&
                /R 90°/.test(
                  axialPanel.querySelector(".viewport-footer")?.textContent || "",
                );
              rotationCoordinatesStable =
                coordinatesBeforeRotation ===
                (document.querySelector(".coordinate-strip")?.textContent || "");
              otherPanesStable =
                coronalImageBeforeRotation === coronalCanvas?.toDataURL() &&
                sagittalImageBeforeRotation === sagittalCanvas?.toDataURL() &&
                coronalTransformBeforeRotation ===
                  document.querySelector(
                    '[data-plane="coronal"] .image-surface',
                  )?.style.transform &&
                sagittalTransformBeforeRotation ===
                  document.querySelector(
                    '[data-plane="sagittal"] .image-surface',
                  )?.style.transform;
            }
            [...document.querySelectorAll(".tool-button")]
              .find((button) => button.title === "平移")
              ?.click();
            await new Promise((resolve) => setTimeout(resolve, 120));
            const coordinateBeforeHover = [
              document.querySelector("#coordinates-x")?.textContent ||
                document.querySelector(".coordinate-strip")?.textContent,
            ].join("|");
            const coronalSurface = document.querySelector(
              '[data-plane="coronal"] .image-surface',
            );
            const coronalRect = coronalSurface?.getBoundingClientRect();
            if (coronalRect) {
              coronalSurface.dispatchEvent(new PointerEvent("pointermove", {
                bubbles: true,
                clientX: coronalRect.left + coronalRect.width * 0.41,
                clientY: coronalRect.top + coronalRect.height * 0.37,
              }));
              await new Promise((resolve) => setTimeout(resolve, 100));
              const coordinateAfterHover = [
                document.querySelector("#coordinates-x")?.textContent ||
                  document.querySelector(".coordinate-strip")?.textContent,
              ].join("|");
              hoverCoordinatesStable = coordinateAfterHover === coordinateBeforeHover;
              coronalSurface.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                pointerId: 31,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: 1,
                clientX: coronalRect.left + coronalRect.width * 0.41,
                clientY: coronalRect.top + coronalRect.height * 0.37,
              }));
              coronalSurface.dispatchEvent(new PointerEvent("pointerup", {
                bubbles: true,
                pointerId: 31,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
                buttons: 0,
                clientX: coronalRect.left + coronalRect.width * 0.41,
                clientY: coronalRect.top + coronalRect.height * 0.37,
              }));
              await new Promise((resolve) => setTimeout(resolve, 180));
              const coordinateAfterPanClick =
                document.querySelector(".coordinate-strip")?.textContent || "";
              panClickBefore = coordinateAfterHover;
              panClickAfter = coordinateAfterPanClick;
              panClickMovesCoordinates =
                coordinateAfterPanClick !== coordinateAfterHover;
            }
            const seriesTabs = [...document.querySelectorAll(".overview-series-tabs button")];
            seriesTabCount = seriesTabs.length;
            const panoramaButton = seriesTabs.find((button) =>
              button.textContent.includes("全景片"),
            );
            if (panoramaButton) {
              panoramaButton.click();
              const panoramaDeadline = Date.now() + 5000;
              let panoramaImage = null;
              while (Date.now() < panoramaDeadline) {
                panoramaImage = document.querySelector(".overview-image-stage img");
                if (panoramaImage?.complete && panoramaImage.naturalWidth > 0) break;
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              panoramaVisible = Boolean(
                panoramaImage?.complete && panoramaImage.naturalWidth > 0,
              );
            }
            document.querySelector('[data-expand-viewport="axial"]')?.click();
            await new Promise((resolve) => setTimeout(resolve, 250));
            visibleViewportCount = [...document.querySelectorAll(".viewport-panel")]
              .filter((panel) => getComputedStyle(panel).display !== "none").length;
            singleViewSidebarsPersist =
              getComputedStyle(document.querySelector(".viewer-panel")).display !== "none" &&
              getComputedStyle(document.querySelector(".viewer-toolrail")).display !== "none" &&
              document.querySelector(".mpr-grid").classList.contains("has-expanded");
            [...document.querySelectorAll(".tool-button")]
              .find((button) => button.title === "距离")
              ?.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
            const surface = document.querySelector('[data-plane="axial"] .image-surface');
            const rect = surface?.getBoundingClientRect();
            if (rect) {
              const firstClick = {
                x: rect.left + rect.width * 0.43,
                y: rect.top + rect.height * 0.54,
              };
              const dispatchPoint = (fractionX, fractionY) => {
                surface.dispatchEvent(new PointerEvent("pointerdown", {
                  bubbles: true,
                  button: 0,
                  clientX: rect.left + rect.width * fractionX,
                  clientY: rect.top + rect.height * fractionY,
                }));
              };
              dispatchPoint(0.43, 0.54);
              await new Promise((resolve) => setTimeout(resolve, 120));
              const firstHandle = document.querySelector(
                '[data-plane="axial"] .measurement-handle',
              );
              const handleRect = firstHandle?.getBoundingClientRect();
              if (handleRect) {
                measurementAnchorError = Math.hypot(
                  handleRect.left + handleRect.width / 2 - firstClick.x,
                  handleRect.top + handleRect.height / 2 - firstClick.y,
                );
                measurementDebug = {
                  click: firstClick,
                  handleCenter: {
                    x: handleRect.left + handleRect.width / 2,
                    y: handleRect.top + handleRect.height / 2,
                  },
                  handlePoint: {
                    x: Number(firstHandle.getAttribute("cx")),
                    y: Number(firstHandle.getAttribute("cy")),
                  },
                  surfaceRect: {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  },
                  surfaceSize: {
                    width: surface.offsetWidth,
                    height: surface.offsetHeight,
                  },
                  transform: surface.style.transform,
                  viewBox: {
                    width: surface.querySelector("svg")?.viewBox.baseVal.width,
                    height: surface.querySelector("svg")?.viewBox.baseVal.height,
                  },
                };
              }
              dispatchPoint(0.62, 0.54);
              await new Promise((resolve) => setTimeout(resolve, 300));
              const item = document.querySelector(".measurement-item");
              distanceMeasurementAdded = /mm/.test(item?.textContent || "");
              item?.querySelector(".icon-button")?.click();
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            const visiblePatientName =
              document.querySelector(".viewer-patient strong")?.textContent?.trim() || "";
            document.querySelector(".viewer-topbar .mode-switch button:nth-child(2)")?.click();
            await new Promise((resolve) => setTimeout(resolve, 250));
            presentationHidesPatient =
              Boolean(visiblePatientName) &&
              !document.body.innerText.includes(visiblePatientName);
            document.querySelector(".viewer-topbar .mode-switch button:nth-child(1)")?.click();
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        return {
          title: document.title,
          rootReady: Boolean(document.querySelector("#root")?.children.length),
          heading: document.querySelector("h1")?.textContent || "",
          importButton: Boolean(document.querySelector("[data-action='import-folder']")),
          studyRows,
          viewerReady,
          renderedCanvasCount,
          expandButtonCount,
          singleViewSidebarsPersist,
          visibleViewportCount,
          distanceMeasurementAdded,
          measurementAnchorError,
          measurementDebug,
          presentationHidesPatient,
          hoverCoordinatesStable,
          panClickMovesCoordinates,
          panClickBefore,
          panClickAfter,
          panoramaVisible,
          seriesTabCount,
          volume3dReady,
          volume3dText,
          volume3dError,
          paneRotationWorks,
          rotationCoordinatesStable,
          otherPanesStable,
          aboutDialogReady,
          bodyText: document.body.innerText.slice(0, 500),
          rootHtml: document.querySelector("#root")?.innerHTML.slice(0, 500) || "",
          apiAvailable: Boolean(window.ctApi),
          apiProbe,
        };
      })()
    `);
    const ok =
      result.title === "牙科 CT 影像工作台" &&
      result.rootReady &&
      (result.studyRows > 0
        ? result.viewerReady &&
          result.singleViewSidebarsPersist === true &&
          result.visibleViewportCount === 1 &&
          result.distanceMeasurementAdded &&
          result.measurementAnchorError !== null &&
          result.measurementAnchorError < 3 &&
          result.presentationHidesPatient &&
          result.hoverCoordinatesStable &&
          result.panClickMovesCoordinates &&
          result.panoramaVisible &&
          result.seriesTabCount >= 1 &&
          result.volume3dReady &&
          result.paneRotationWorks &&
          result.rotationCoordinatesStable &&
          result.otherPanesStable &&
          result.aboutDialogReady
        : result.importButton);
    if (process.env.CT_SMOKE_SCREENSHOT) {
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 750));
      const image = await window.webContents.capturePage();
      await fs.writeFile(process.env.CT_SMOKE_SCREENSHOT, image.toPNG());
    }
    if (process.env.CT_SMOKE_FOUR_SCREENSHOT) {
      await window.webContents.executeJavaScript(`
        (async () => {
          [...document.querySelectorAll(".viewer-panel .button")]
            .find((button) => button.textContent.includes("恢复四窗"))
            ?.click();
          await new Promise((resolve) => setTimeout(resolve, 500));
        })()
      `);
      window.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 750));
      const image = await window.webContents.capturePage();
      await fs.writeFile(process.env.CT_SMOKE_FOUR_SCREENSHOT, image.toPNG());
    }
    if (process.env.CT_SMOKE_ABOUT_SCREENSHOT) {
      await window.webContents.executeJavaScript(`
        document.querySelector('[data-action="show-about"]')?.click();
      `);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const image = await window.webContents.capturePage();
      await fs.writeFile(process.env.CT_SMOKE_ABOUT_SCREENSHOT, image.toPNG());
      await window.webContents.executeJavaScript(`
        document.querySelector(".about-close")?.click();
      `);
    }
    clearTimeout(timeout);
    console.log("SMOKE_RESULT=" + JSON.stringify({ ok, ...result }));
    app.exit(ok ? 0 : 1);
  } catch (error) {
    clearTimeout(timeout);
    console.error(
      "SMOKE_RESULT=" +
        JSON.stringify({ ok: false, reason: error instanceof Error ? error.message : String(error) }),
    );
    app.exit(1);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 900,
    minHeight: 650,
    show: false,
    backgroundColor: "#0f1314",
    title: "牙科 CT 影像工作台",
    icon: path.resolve(__dirname, "../../../assets/app_icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  if (isSmokeTest) {
    mainWindow.webContents.on("console-message", (event) => {
      console.log(
        `RENDERER_CONSOLE=${event.level}:${event.message}:${event.sourceId}:${event.lineNumber}`,
      );
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.error(`DID_FAIL_LOAD=${code}:${description}:${url}`);
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    return { action: "deny" };
  });

  if (isSmokeTest) {
    mainWindow.webContents.once("did-finish-load", () => runSmokeTest(mainWindow));
  } else {
    mainWindow.once("ready-to-show", () => {
      mainWindow.maximize();
      mainWindow.show();
      mainWindow.focus();
    });
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadURL("app://viewer/index.html");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

if (!isSmokeTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await fs.mkdir(libraryRoot, { recursive: true });
    repository = createStudyRepository(libraryRoot);
    await registerDataProtocol();
    registerIpcHandlers();
    await createWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
