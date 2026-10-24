const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ctApi", {
  listStudies: () => ipcRenderer.invoke("library:list"),
  importFolder: () => ipcRenderer.invoke("library:import-folder"),
  importArchive: () => ipcRenderer.invoke("library:import-archive"),
  getStudy: (studyId) => ipcRenderer.invoke("library:get", studyId),
  deleteStudy: (studyId) => ipcRenderer.invoke("library:delete", studyId),
  loadMeasurements: (studyId) => ipcRenderer.invoke("measurements:load", studyId),
  saveMeasurements: (studyId, payload) =>
    ipcRenderer.invoke("measurements:save", { studyId, payload }),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  onImportProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("library:import-progress", handler);
    return () => ipcRenderer.removeListener("library:import-progress", handler);
  },
});
