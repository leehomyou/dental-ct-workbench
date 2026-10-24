import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  Circle as CircleIcon,
  Crosshair,
  DraftingCompass,
  Eye,
  Hand,
  Info,
  LoaderCircle,
  Maximize2,
  MoveUpRight,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Settings2,
  Square,
  Stethoscope,
  SunMedium,
  Trash2,
  Type,
  Undo2,
  UserRound,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import CanvasViewport from "./CanvasViewport.jsx";
import SeriesOverview from "./SeriesOverview.jsx";
import { loadDicomVolume } from "../viewer/dicom-volume.js";
import { getPixelValue, getPlaneSize, PLANE_LABELS } from "../viewer/mpr-renderer.js";
import {
  angleBetweenThreePoints,
  physicalDistance,
} from "../measurements/geometry.js";
import { computeRoiStatistics } from "../measurements/statistics.js";
import { createMeasurementStore } from "../measurements/measurement-store.js";

const TOOL_ITEMS = [
  { id: "pan", label: "平移", icon: Hand },
  { id: "windowLevel", label: "窗宽窗位", icon: SunMedium },
  { id: "rotate", label: "旋转", icon: RotateCw },
  { id: "probe", label: "HU 探针", icon: Crosshair },
  { id: "distance", label: "距离", icon: Ruler },
  { id: "angle", label: "角度", icon: DraftingCompass },
  { id: "rectangle", label: "矩形 ROI", icon: Square },
  { id: "ellipse", label: "椭圆 ROI", icon: CircleIcon },
  { id: "arrow", label: "箭头", icon: MoveUpRight },
  { id: "text", label: "文字", icon: Type },
];

const MEASUREMENT_TOOLS = new Set([
  "probe",
  "distance",
  "angle",
  "rectangle",
  "ellipse",
  "arrow",
  "text",
]);

function getStudyKey(study) {
  return (
    study.studyKey ||
    study.storageKey ||
    study.id ||
    study.studyId ||
    study.studyInstanceUid
  );
}

function getPatientIdentity(study, mode) {
  if (mode === "presentation") {
    return {
      name:
        study.displayPatient?.name ||
        study.displayPatient?.displayName ||
        "匿名患者",
      id:
        study.displayPatient?.id ||
        study.displayPatient?.displayId ||
        "ANONYMIZED",
    };
  }
  return {
    name: study.patient?.name || study.patientName || "未命名患者",
    id: study.patient?.id || study.patientId || study.studyInstanceUid || "无患者编号",
  };
}

function formatStudyDate(raw) {
  const text = String(raw || "").replace(/\D/g, "");
  if (text.length >= 8) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return raw || "日期未知";
}

function formatMeasurementValue(measurement) {
  if (measurement.value === null || measurement.value === undefined) return "";
  if (typeof measurement.value === "string") return measurement.value;
  const digits = measurement.unit === "HU" ? 0 : measurement.unit === "deg" ? 1 : 2;
  return `${Number(measurement.value).toFixed(digits)} ${measurement.unit}`;
}

function MeasurementSidebarList({ measurements, onDelete, onClearLayer }) {
  return (
    <section className="panel-section measurement-panel">
      <div className="panel-heading">
        <span>本层测量</span>
        <div>
          <b>{measurements.length}</b>
          <button
            className="text-button"
            type="button"
            disabled={!measurements.length}
            onClick={onClearLayer}
          >
            清除
          </button>
        </div>
      </div>
      {measurements.length ? (
        <div className="measurement-list">
          {measurements.map((measurement) => (
            <div className="measurement-item" key={measurement.id}>
              <span className="measurement-color" />
              <span>
                <b>{measurement.tool === "probe" ? "HU 探针" : measurement.tool}</b>
                <small>{formatMeasurementValue(measurement)}</small>
              </span>
              <button
                className="icon-button"
                type="button"
                title="删除测量"
                onClick={() => onDelete(measurement.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="quiet-empty">当前层面还没有测量或标注。</p>
      )}
    </section>
  );
}

export default function ViewerWorkspace({
  study,
  mode,
  onModeChange,
  onBack,
  appInfo,
  onShowAbout,
}) {
  const studyId = getStudyKey(study);
  const [volume, setVolume] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [activePlane, setActivePlane] = useState("axial");
  const [expandedPlane, setExpandedPlane] = useState(null);
  const [activeTool, setActiveTool] = useState("pan");
  const [coordinates, setCoordinates] = useState({ x: 0, y: 0, z: 0 });
  const [windowCenter, setWindowCenter] = useState(40);
  const [windowWidth, setWindowWidth] = useState(400);
  const [defaultWindow, setDefaultWindow] = useState({ center: 40, width: 400 });
  const [invert, setInvert] = useState(false);
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const viewportRefs = useRef({});
  const measurementStoreRef = useRef(null);
  const patient = getPatientIdentity(study, mode);
  const primarySeries =
    study.series?.find((series) => series.isPrimary) ||
    study.series?.find((series) => series.seriesKey === study.primarySeriesKey) ||
    study.series?.[0];

  if (!measurementStoreRef.current) {
    measurementStoreRef.current = createMeasurementStore();
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setVolume(null);
    loadDicomVolume(study, {
      onProgress: (progress) => {
        if (!cancelled) setLoadProgress(progress);
      },
    })
      .then((loadedVolume) => {
        if (cancelled) return;
        setVolume(loadedVolume);
        const center = {
          x: Math.floor(loadedVolume.columns / 2),
          y: Math.floor(loadedVolume.rows / 2),
          z: Math.floor(loadedVolume.slices / 2),
        };
        setCoordinates(center);
        setWindowCenter(loadedVolume.windowCenter);
        setWindowWidth(loadedVolume.windowWidth);
        setDefaultWindow({
          center: loadedVolume.windowCenter,
          width: loadedVolume.windowWidth,
        });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message || String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [study]);

  useEffect(() => {
    let cancelled = false;
    globalThis.window?.ctApi
      ?.loadMeasurements(studyId)
      .then((payload) => {
        if (cancelled) return;
        measurementStoreRef.current.load(payload);
        setMeasurementRevision((value) => value + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [studyId]);

  const measurements = useMemo(
    () => measurementStoreRef.current.list(),
    [measurementRevision],
  );

  const activeSliceIndex = volume
    ? activePlane === "axial"
      ? coordinates.z
      : activePlane === "coronal"
        ? coordinates.y
        : coordinates.x
    : 0;

  const currentLayerMeasurements = useMemo(
    () =>
      measurements.filter(
        (measurement) =>
          measurement.plane === activePlane &&
          (measurement.style?.obliquePlane ||
            measurement.sliceIndex === activeSliceIndex),
      ),
    [measurements, activePlane, activeSliceIndex],
  );

  const windowRange = useMemo(() => {
    if (!volume) return { min: -1000, max: 3000 };
    return {
      min: Math.floor(volume.range.min),
      max: Math.ceil(volume.range.max),
    };
  }, [volume]);

  function persistMeasurements() {
    const api = globalThis.window?.ctApi;
    if (!api) return;
    api
      .saveMeasurements(studyId, measurementStoreRef.current.toJSON())
      .catch(() => {});
  }

  function refreshMeasurements() {
    setMeasurementRevision((value) => value + 1);
    persistMeasurements();
  }

  function changeSlice(delta, plane = activePlane) {
    if (!volume) return;
    const size = getPlaneSize(volume, plane);
    if (plane === "axial") {
      setCoordinates((current) => ({
        ...current,
        z: Math.max(0, Math.min(size.slices - 1, current.z + delta)),
      }));
    } else if (plane === "coronal") {
      setCoordinates((current) => ({
        ...current,
        y: Math.max(0, Math.min(size.slices - 1, current.y + delta)),
      }));
    } else {
      setCoordinates((current) => ({
        ...current,
        x: Math.max(0, Math.min(size.slices - 1, current.x + delta)),
      }));
    }
  }

  function setPlaneSlice(plane, index) {
    setActivePlane(plane);
    setCoordinates((current) => {
      if (plane === "axial") return { ...current, z: index };
      if (plane === "coronal") return { ...current, y: index };
      return { ...current, x: index };
    });
  }

  function toggleExpanded(plane) {
    setExpandedPlane((current) => (current === plane ? null : plane));
    if (plane !== "overview") setActivePlane(plane);
  }

  function addMeasurement(
    plane,
    tool,
    points,
    {
      textValue = null,
      value: sampledValue,
      unit: sampledUnit,
      style: sampledStyle,
    } = {},
  ) {
    if (!volume || !MEASUREMENT_TOOLS.has(tool)) return;
    const planeCenter = sampledStyle?.planeCenter || coordinates;
    const sliceIndex =
      plane === "axial"
        ? planeCenter.z
        : plane === "coronal"
          ? planeCenter.y
          : planeCenter.x;
    const spacing =
      plane === "axial"
        ? { x: volume.spacing.x, y: volume.spacing.y }
        : plane === "coronal"
          ? { x: volume.spacing.x, y: volume.spacing.z }
          : { x: volume.spacing.y, y: volume.spacing.z };
    let value = null;
    let unit = "";
    let style = sampledStyle || {};

    if (tool === "distance" || tool === "arrow") {
      value = physicalDistance(points[0], points[1], spacing);
      unit = "mm";
    } else if (tool === "angle") {
      value = angleBetweenThreePoints(points[0], points[1], points[2], {
        spacing,
      });
      unit = "deg";
    } else if (tool === "probe") {
      value = Number.isFinite(sampledValue)
        ? sampledValue
        : getPixelValue(volume, plane, sliceIndex, points[0].x, points[0].y);
      unit = "HU";
    } else if (tool === "rectangle" || tool === "ellipse") {
      const stats = Number.isFinite(sampledValue)
        ? null
        : computeRoiStatistics({
            shape: tool,
            points,
            spacing,
            width: getPlaneSize(volume, plane).width,
            height: getPlaneSize(volume, plane).height,
            valueType: "HU",
            rescaleSlope: volume.slope,
            rescaleIntercept: volume.intercept,
            getPixelValue: (x, y) =>
              getPixelValue(volume, plane, sliceIndex, x, y) /
                (volume.slope || 1) -
              volume.intercept / (volume.slope || 1),
          });
      value = Number.isFinite(sampledValue) ? sampledValue : stats.mean;
      unit = "HU";
      style = sampledStyle || {
        areaMm2: stats.areaMm2,
        min: stats.min,
        max: stats.max,
        stdDev: stats.stdDev,
      };
    } else if (tool === "text") {
      value = textValue || "标注";
    }

    try {
      measurementStoreRef.current.add({
        studyId,
        seriesId: primarySeries?.seriesKey || "primary",
        plane,
        sliceIndex,
        tool,
        points,
        value,
        unit,
        style,
      });
      refreshMeasurements();
    } catch (measurementError) {
      console.error("Measurement could not be added.", measurementError);
    }
  }

  function deleteMeasurement(id) {
    if (measurementStoreRef.current.remove(id)) refreshMeasurements();
  }

  function clearCurrentLayer() {
    const count = measurementStoreRef.current.clearLayer(activePlane, activeSliceIndex);
    if (count) refreshMeasurements();
  }

  function undoMeasurement() {
    if (measurementStoreRef.current.undo()) refreshMeasurements();
  }

  function redoMeasurement() {
    if (measurementStoreRef.current.redo()) refreshMeasurements();
  }

  function resetView() {
    if (!volume) return;
    setCoordinates({
      x: Math.floor(volume.columns / 2),
      y: Math.floor(volume.rows / 2),
      z: Math.floor(volume.slices / 2),
    });
    setWindowCenter(defaultWindow.center);
    setWindowWidth(defaultWindow.width);
    setInvert(false);
    Object.values(viewportRefs.current).forEach((viewport) => viewport?.reset?.());
  }

  function zoomView(direction) {
    const viewport = viewportRefs.current[activePlane];
    if (direction > 0) viewport?.zoomIn?.();
    else viewport?.zoomOut?.();
  }

  function exportScreenshot() {
    const canvas = viewportRefs.current[activePlane]?.getCanvas?.();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${patient.name}-${activePlane}-${activeSliceIndex + 1}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape" && expandedPlane) {
        setExpandedPlane(null);
        event.preventDefault();
        return;
      }
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        changeSlice(-1);
        event.preventDefault();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        changeSlice(1);
        event.preventDefault();
      }
      if (event.key.toLowerCase() === "i") setInvert((current) => !current);
      if (event.ctrlKey && event.key.toLowerCase() === "z") undoMeasurement();
      if (event.ctrlKey && event.key.toLowerCase() === "y") redoMeasurement();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (loading) {
    return (
      <div className="viewer-loading">
        <LoaderCircle className="spin" size={30} />
        <h2>正在重建三平面影像</h2>
        <p>
          {loadProgress?.current
            ? `${loadProgress.current} / ${loadProgress.total} 层`
            : "正在读取 DICOM 元数据"}
        </p>
        <div className="progress-track large">
          <i
            style={{
              width: loadProgress?.current
                ? `${(loadProgress.current / loadProgress.total) * 100}%`
                : "8%",
            }}
          />
        </div>
      </div>
    );
  }

  if (loadError || !volume) {
    return (
      <div className="viewer-loading error-state">
        <h2>无法打开该检查</h2>
        <p>{loadError || "没有可读取的 CT 序列。"}</p>
        <button className="button secondary" type="button" onClick={onBack}>
          返回病例库
        </button>
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      <header className="viewer-topbar">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={18} />
          病例库
        </button>
        <div className="viewer-patient">
          <span className="patient-avatar">
            <UserRound size={17} />
          </span>
          <div>
            <strong>{patient.name}</strong>
            <span>{patient.id} · {formatStudyDate(study.studyDate)}</span>
          </div>
        </div>
        <div className="viewer-study-title">
          <b>{study.description || primarySeries?.description || "牙科 CT / CBCT"}</b>
          <span>{study.manufacturer || primarySeries?.manufacturer || "DICOM"}</span>
        </div>
        <div className={`mode-switch compact ${mode}`}>
          <button
            type="button"
            className={mode === "clinical" ? "active" : ""}
            onClick={() => onModeChange("clinical")}
          >
            <Stethoscope size={14} />
            临床
          </button>
          <button
            type="button"
            className={mode === "presentation" ? "active" : ""}
            onClick={() => onModeChange("presentation")}
          >
            <Eye size={14} />
            展示
          </button>
        </div>
        <button
          className="icon-button viewer-about-button"
          type="button"
          title="关于应用"
          onClick={onShowAbout}
          data-action="show-about"
        >
          <Info size={17} />
        </button>
      </header>

      <main className="viewer-body">
        <nav className="viewer-toolrail" aria-label="阅片工具">
          <div className="tool-group">
            {TOOL_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`tool-button ${activeTool === id ? "active" : ""}`}
                title={label}
                onClick={() => setActiveTool(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="tool-group compact-tools">
            <button type="button" className="tool-button" title="放大" onClick={() => zoomView(1)}>
              <ZoomIn size={18} />
            </button>
            <button type="button" className="tool-button" title="缩小" onClick={() => zoomView(-1)}>
              <ZoomOut size={18} />
            </button>
            <button type="button" className="tool-button" title="撤销测量" onClick={undoMeasurement}>
              <Undo2 size={18} />
            </button>
            <button type="button" className="tool-button" title="重做测量" onClick={redoMeasurement}>
              <Redo2 size={18} />
            </button>
            <button type="button" className="tool-button" title="复位视图" onClick={resetView}>
              <RotateCcw size={18} />
            </button>
            <button type="button" className="tool-button" title="导出当前视图" onClick={exportScreenshot}>
              <Camera size={18} />
            </button>
          </div>
        </nav>

        <section
          className={`mpr-grid ${expandedPlane ? "has-expanded" : ""}`}
          aria-label="CT 三平面阅片区"
        >
          <CanvasViewport
            ref={(node) => {
              viewportRefs.current.axial = node;
            }}
            plane="axial"
            volume={volume}
            sliceIndex={coordinates.z}
            onSliceChange={(delta) => {
              setActivePlane("axial");
              changeSlice(delta, "axial");
            }}
            coordinates={coordinates}
            onCoordinatesChange={setCoordinates}
            active={activePlane === "axial"}
            onActivate={() => setActivePlane("axial")}
            expanded={expandedPlane === "axial"}
            onExpand={() => toggleExpanded("axial")}
            activeTool={activeTool}
            windowCenter={windowCenter}
            windowWidth={windowWidth}
            invert={invert}
            measurements={measurements}
            onCompleteMeasurement={addMeasurement}
            renderEnabled={!expandedPlane || expandedPlane === "axial"}
            onWindowLevelChange={({ center, width }) => {
              setWindowCenter((value) => value + center);
              setWindowWidth((value) => Math.max(1, value + width));
            }}
          />
          <CanvasViewport
            ref={(node) => {
              viewportRefs.current.coronal = node;
            }}
            plane="coronal"
            volume={volume}
            sliceIndex={coordinates.y}
            onSliceChange={(delta) => {
              setActivePlane("coronal");
              changeSlice(delta, "coronal");
            }}
            coordinates={coordinates}
            onCoordinatesChange={setCoordinates}
            active={activePlane === "coronal"}
            onActivate={() => setActivePlane("coronal")}
            expanded={expandedPlane === "coronal"}
            onExpand={() => toggleExpanded("coronal")}
            activeTool={activeTool}
            windowCenter={windowCenter}
            windowWidth={windowWidth}
            invert={invert}
            measurements={measurements}
            onCompleteMeasurement={addMeasurement}
            renderEnabled={!expandedPlane || expandedPlane === "coronal"}
            onWindowLevelChange={({ center, width }) => {
              setWindowCenter((value) => value + center);
              setWindowWidth((value) => Math.max(1, value + width));
            }}
          />
          <CanvasViewport
            ref={(node) => {
              viewportRefs.current.sagittal = node;
            }}
            plane="sagittal"
            volume={volume}
            sliceIndex={coordinates.x}
            onSliceChange={(delta) => {
              setActivePlane("sagittal");
              changeSlice(delta, "sagittal");
            }}
            coordinates={coordinates}
            onCoordinatesChange={setCoordinates}
            active={activePlane === "sagittal"}
            onActivate={() => setActivePlane("sagittal")}
            expanded={expandedPlane === "sagittal"}
            onExpand={() => toggleExpanded("sagittal")}
            activeTool={activeTool}
            windowCenter={windowCenter}
            windowWidth={windowWidth}
            invert={invert}
            measurements={measurements}
            onCompleteMeasurement={addMeasurement}
            renderEnabled={!expandedPlane || expandedPlane === "sagittal"}
            onWindowLevelChange={({ center, width }) => {
              setWindowCenter((value) => value + center);
              setWindowWidth((value) => Math.max(1, value + width));
            }}
          />
          <SeriesOverview
            volume={volume}
            currentSlice={coordinates.z}
            onSelectSlice={(index) => setPlaneSlice("axial", index)}
            expanded={expandedPlane === "overview"}
            onExpand={() => toggleExpanded("overview")}
            ancillaryImages={study.ancillaryImages || []}
          />
        </section>

        <aside className="viewer-panel">
          <section className="panel-section">
            <div className="panel-heading">
              <span>显示参数</span>
              <Settings2 size={15} />
            </div>
            <div className="preset-row">
              <button
                type="button"
                onClick={() => {
                  setWindowCenter(1250);
                  setWindowWidth(5000);
                }}
              >
                骨窗
              </button>
              <button
                type="button"
                onClick={() => {
                  setWindowCenter(40);
                  setWindowWidth(400);
                }}
              >
                软组织
              </button>
              <button type="button" onClick={() => setInvert((value) => !value)}>
                {invert ? "恢复灰度" : "反色"}
              </button>
            </div>
            <label className="control-field">
              <span>
                <b>亮度 / 窗位</b>
                <output>{Math.round(windowCenter)}</output>
              </span>
              <input
                type="range"
                min={windowRange.min}
                max={windowRange.max}
                value={windowCenter}
                onChange={(event) => setWindowCenter(Number(event.target.value))}
              />
            </label>
            <label className="control-field">
              <span>
                <b>对比度 / 窗宽</b>
                <output>{Math.round(windowWidth)}</output>
              </span>
              <input
                type="range"
                min="1"
                max={Math.max(1, windowRange.max - windowRange.min)}
                value={windowWidth}
                onChange={(event) => setWindowWidth(Number(event.target.value))}
              />
            </label>
          </section>

          <section className="panel-section">
            <div className="panel-heading">
              <span>检查信息</span>
              <ChevronDown size={15} />
            </div>
            <dl className="study-details">
              <div><dt>检查日期</dt><dd>{formatStudyDate(study.studyDate)}</dd></div>
              <div><dt>模态</dt><dd>{study.modality || primarySeries?.modality || "CT"}</dd></div>
              <div><dt>矩阵</dt><dd>{volume.columns} × {volume.rows}</dd></div>
              <div><dt>层数</dt><dd>{volume.slices}</dd></div>
              <div><dt>像素间距</dt><dd>{volume.spacing.x.toFixed(3)} mm</dd></div>
              <div><dt>层厚</dt><dd>{volume.spacing.z.toFixed(3)} mm</dd></div>
            </dl>
          </section>

          <MeasurementSidebarList
            measurements={currentLayerMeasurements}
            onDelete={deleteMeasurement}
            onClearLayer={clearCurrentLayer}
          />

          <section className="panel-section">
            <div className="panel-heading">
              <span>当前视图</span>
              <span>{PLANE_LABELS[activePlane]}</span>
            </div>
            <button
              className="button secondary full-width"
              type="button"
              onClick={() => toggleExpanded(activePlane)}
            >
              <Maximize2 size={16} />
              {expandedPlane ? "恢复四窗" : "单独放大"}
            </button>
          </section>
        </aside>
      </main>

      <footer className="viewer-statusbar">
        <div className="active-plane-status">
          <i />
          <b>{expandedPlane ? "单窗" : "四窗"}</b>
          <span>{PLANE_LABELS[activePlane]}</span>
        </div>
        <div className="coordinate-strip">
          <span>X <b>{coordinates.x}</b></span>
          <span>Y <b>{coordinates.y}</b></span>
          <span>Z <b>{coordinates.z}</b></span>
        </div>
        <div className="status-hint">
          {activeTool === "pan"
            ? "拖动平移 · 滚轮切层 · Ctrl+滚轮缩放"
            : `${TOOL_ITEMS.find((tool) => tool.id === activeTool)?.label || activeTool}工具已启用`}
        </div>
        <div className="status-security">LOCAL · OFFLINE</div>
      </footer>
    </div>
  );
}
