import { useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  ChevronRight,
  Database,
  Eye,
  FolderOpen,
  HardDrive,
  Info,
  LoaderCircle,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserRound,
} from "lucide-react";

function studyId(study) {
  return study.id || study.studyId || study.studyKey || study.storageKey;
}

function patientName(study, mode = "clinical") {
  if (mode === "presentation") {
    return (
      study.displayPatient?.name ||
      study.displayPatient?.displayName ||
      "匿名患者"
    );
  }
  return (
    study.patient?.name ||
    study.patientName ||
    study.patientInfo?.name ||
    "未命名患者"
  );
}

function patientId(study, mode = "clinical") {
  if (mode === "presentation") {
    return (
      study.displayPatient?.id ||
      study.displayPatient?.displayId ||
      "ANONYMIZED"
    );
  }
  return (
    study.patient?.patientId ||
    study.patientId ||
    study.patientInfo?.patientId ||
    study.studyId ||
    "无患者编号"
  );
}

function studyDate(study) {
  const raw =
    study.studyDate ||
    study.date ||
    study.patient?.studyDate ||
    study.createdAt;
  if (!raw) return "日期未知";
  if (/^\d{8}$/.test(String(raw))) {
    const text = String(raw);
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return String(raw).slice(0, 10);
}

function studyDescription(study) {
  return (
    study.description ||
    study.studyDescription ||
    study.series?.[0]?.description ||
    "牙科 CT / CBCT"
  );
}

function seriesCount(study) {
  return study.series?.length || study.seriesCount || 1;
}

export default function StudyLibrary({
  studies,
  busy,
  importProgress,
  onImportFolder,
  onImportArchive,
  onOpenStudy,
  onDeleteStudy,
  mode,
  onModeChange,
  appInfo,
  onShowAbout,
}) {
  const [query, setQuery] = useState("");
  const filteredStudies = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return studies;
    return studies.filter((study) =>
      [patientName(study, mode), patientId(study, mode), studyDescription(study)]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [mode, query, studies]);

  return (
    <div className="library-layout">
      <aside className="library-sidebar">
        <div className="app-brand">
          <span className="brand-symbol">CT</span>
          <div>
            <h1>牙科 CT 影像工作台</h1>
            <p>LOCAL DENTAL IMAGING</p>
          </div>
        </div>

        <nav className="library-nav" aria-label="病例库导航">
          <button className="nav-item active" type="button">
            <Database size={18} />
            <span>病例库</span>
            <b>{studies.length}</b>
          </button>
          <button className="nav-item" type="button" onClick={onImportFolder}>
            <FolderOpen size={18} />
            <span>导入 DICOM</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className={`mode-switch ${mode}`}>
            <button
              type="button"
              className={mode === "clinical" ? "active" : ""}
              onClick={() => onModeChange("clinical")}
            >
              <Stethoscope size={15} />
              临床
            </button>
            <button
              type="button"
              className={mode === "presentation" ? "active" : ""}
              onClick={() => onModeChange("presentation")}
            >
              <Eye size={15} />
              展示
            </button>
          </div>
          <div className="storage-badge">
            <HardDrive size={15} />
            <span>本机离线存储</span>
          </div>
          <button
            className="about-link"
            type="button"
            onClick={onShowAbout}
            data-action="show-about"
          >
            <Info size={15} />
            <span>关于应用</span>
            <small>{appInfo?.version || ""}</small>
          </button>
        </div>
      </aside>

      <main className="library-main">
        <header className="library-header">
          <div>
            <p className="eyebrow">PATIENT LIBRARY</p>
            <h2>患者与检查</h2>
            <p>导入外部 CT/CBCT 后，软件会将检查整理到本机独立病例库。</p>
          </div>
          <div className="import-actions">
            <button
              className="button secondary"
              type="button"
              onClick={onImportArchive}
              disabled={busy}
              data-action="import-archive"
            >
              <Archive size={17} />
              导入 ZIP
            </button>
            <button
              className="button primary"
              type="button"
              onClick={onImportFolder}
              disabled={busy}
              data-action="import-folder"
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />}
              导入 DICOM 文件夹
            </button>
          </div>
        </header>

        {importProgress && (
          <div className="import-progress">
            <LoaderCircle className="spin" size={17} />
            <span>
              {importProgress.stage === "scanning"
                ? "正在识别 DICOM 与患者信息"
                : importProgress.stage === "copying"
                  ? "正在复制影像到本地病例库"
                  : "正在准备导入"}
            </span>
            {importProgress.current && (
              <div className="progress-track">
                <i
                  style={{
                    width: `${(importProgress.current / importProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div className="library-toolbar">
          <label className="search-box">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索患者姓名、编号或检查"
            />
          </label>
          <span className="result-count">{filteredStudies.length} 个检查</span>
        </div>

        {filteredStudies.length ? (
          <div className="study-table" role="table" aria-label="病例列表">
            <div className="study-table-head" role="row">
              <span>患者</span>
              <span>检查</span>
              <span>日期</span>
              <span>序列</span>
              <span />
            </div>
            {filteredStudies.map((study) => (
              <div
                className="study-row"
                key={studyId(study)}
                role="row"
                onDoubleClick={() => onOpenStudy(study)}
              >
                <div className="patient-cell">
                  <span className="patient-avatar">
                    <UserRound size={18} />
                  </span>
                  <span>
                    <b>{patientName(study, mode)}</b>
                    <small>{patientId(study, mode)}</small>
                  </span>
                </div>
                <div className="study-cell">
                  <b>{studyDescription(study)}</b>
                  <small>{study.modality || "CT"} · {study.manufacturer || "DICOM"}</small>
                </div>
                <div className="date-cell">
                  <CalendarDays size={15} />
                  <span>{studyDate(study)}</span>
                </div>
                <div className="series-cell">
                  <ShieldCheck size={15} />
                  <span>{seriesCount(study)} 个序列</span>
                </div>
                <div className="row-actions">
                  <button
                    className="icon-button danger"
                    type="button"
                    title="从病例库删除"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteStudy(study);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    className="open-study"
                    type="button"
                    onClick={() => onOpenStudy(study)}
                  >
                    打开
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <section className="empty-library">
            <span className="empty-icon">
              <Database size={30} />
            </span>
            <h3>{query ? "没有匹配的检查" : "病例库还是空的"}</h3>
            <p>
              {query
                ? "换一个患者姓名或编号试试。"
                : "选择医院光盘中的 DICOM 文件夹，或导入包含 DICOM 的 ZIP 文件。"}
            </p>
            {!query && (
              <button className="button primary" type="button" onClick={onImportFolder}>
                <FolderOpen size={17} />
                开始导入
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
