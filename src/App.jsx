import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import AboutDialog from "./components/AboutDialog.jsx";
import StudyLibrary from "./components/StudyLibrary.jsx";
import ViewerWorkspace from "./components/ViewerWorkspace.jsx";

function getApi() {
  return globalThis.window?.ctApi;
}

function normalizeStudyList(result) {
  if (Array.isArray(result)) return result;
  return result?.studies || result?.items || [];
}

export default function App() {
  const [studies, setStudies] = useState([]);
  const [activeStudy, setActiveStudy] = useState(null);
  const [mode, setMode] = useState("clinical");
  const [busy, setBusy] = useState(false);
  const [windowReady, setWindowReady] = useState(false);
  const [error, setError] = useState("");
  const [importProgress, setImportProgress] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const refreshStudies = useCallback(async () => {
    const api = getApi();
    if (!api) {
      setWindowReady(true);
      return [];
    }
    const result = await api.listStudies();
    const nextStudies = normalizeStudyList(result);
    setStudies(nextStudies);
    setWindowReady(true);
    return nextStudies;
  }, []);

  useEffect(() => {
    refreshStudies().catch((loadError) => {
      setError(loadError.message || String(loadError));
      setWindowReady(true);
    });
    const api = getApi();
    if (!api) return undefined;
    api.getAppInfo().then(setAppInfo).catch(() => {});
    return api.onImportProgress(setImportProgress);
  }, [refreshStudies]);

  async function runImport(kind) {
    const api = getApi();
    if (!api) {
      setError("当前是网页开发预览，请从桌面应用中使用 DICOM 导入。");
      return;
    }

    setBusy(true);
    setError("");
    setImportProgress({ stage: "preparing" });
    try {
      const result =
        kind === "archive" ? await api.importArchive() : await api.importFolder();
      if (result?.canceled) return;
      const nextStudies = await refreshStudies();
      const firstImported =
        result?.imported?.[0] ||
        nextStudies.find((study) => study.id === result?.studyId);
      if (firstImported) {
        const fullStudy = await api.getStudy(
          firstImported.id || firstImported.studyId || firstImported.storageKey,
        );
        setActiveStudy(fullStudy);
      }
      if (result?.warnings?.length) {
        setError(result.warnings.join("\n"));
      }
    } catch (importError) {
      setError(importError.message || String(importError));
    } finally {
      setBusy(false);
      setImportProgress(null);
    }
  }

  async function openStudy(studySummary) {
    const api = getApi();
    if (!api) return;
    setBusy(true);
    setError("");
    try {
      const studyId =
        studySummary.id ||
        studySummary.studyId ||
        studySummary.studyKey ||
        studySummary.storageKey;
      const study = await api.getStudy(studyId);
      setActiveStudy(study);
    } catch (openError) {
      setError(openError.message || String(openError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteStudy(studySummary) {
    const api = getApi();
    if (!api) return;
    const id =
      studySummary.id ||
      studySummary.studyId ||
      studySummary.studyKey ||
      studySummary.storageKey;
    const label =
      (mode === "presentation"
        ? studySummary.displayPatient?.name ||
          studySummary.displayPatient?.displayName
        : studySummary.patient?.name || studySummary.patientName) ||
      studySummary.studyDescription ||
      "该检查";
    if (!window.confirm(`确定从本机病例库删除“${label}”吗？原始导入来源不会被删除。`)) {
      return;
    }
    setBusy(true);
    try {
      await api.deleteStudy(id);
      await refreshStudies();
      if (
        activeStudy &&
        (activeStudy.id ||
          activeStudy.studyId ||
          activeStudy.studyKey ||
          activeStudy.storageKey) === id
      ) {
        setActiveStudy(null);
      }
    } catch (deleteError) {
      setError(deleteError.message || String(deleteError));
    } finally {
      setBusy(false);
    }
  }

  const toast = useMemo(() => {
    if (!error) return null;
    return (
      <div className="toast toast-error" role="alert">
        <AlertTriangle size={18} />
        <span>{error}</span>
        <button type="button" onClick={() => setError("")}>
          关闭
        </button>
      </div>
    );
  }, [error]);

  if (!windowReady) {
    return (
      <div className="boot-screen">
        <LoaderCircle className="spin" size={28} />
        <span>正在打开本地病例库</span>
      </div>
    );
  }

  return (
    <div className="app-root">
      {activeStudy ? (
        <ViewerWorkspace
          study={activeStudy}
          mode={mode}
          onModeChange={setMode}
          onBack={() => setActiveStudy(null)}
          appInfo={appInfo}
          onShowAbout={() => setAboutOpen(true)}
        />
      ) : (
        <StudyLibrary
          studies={studies}
          busy={busy}
          importProgress={importProgress}
          onImportFolder={() => runImport("folder")}
          onImportArchive={() => runImport("archive")}
          onOpenStudy={openStudy}
          onDeleteStudy={deleteStudy}
          mode={mode}
          onModeChange={setMode}
          appInfo={appInfo}
          onShowAbout={() => setAboutOpen(true)}
        />
      )}
      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        appInfo={appInfo}
      />
      {toast}
    </div>
  );
}
