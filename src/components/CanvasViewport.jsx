import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Expand, ScanLine } from "lucide-react";
import {
  getPlaneAspectRatio,
  getPlaneSize,
  getPlaneSpacing,
  getPixelValue,
  PLANE_LABELS,
  renderPlane,
} from "../viewer/mpr-renderer.js";
import { computeRoiStatistics } from "../measurements/statistics.js";

const MEASUREMENT_POINTS = Object.freeze({
  distance: 2,
  angle: 3,
  rectangle: 2,
  ellipse: 2,
  arrow: 2,
  probe: 1,
  text: 1,
});

function fitSurface(stage, aspectRatio) {
  if (!stage) return { width: 0, height: 0 };
  const availableWidth = Math.max(1, stage.clientWidth * 0.94);
  const availableHeight = Math.max(1, stage.clientHeight * 0.94);
  let width = availableWidth;
  let height = width / aspectRatio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * aspectRatio;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function pointToSvg(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function formatValue(measurement) {
  if (measurement.value === null || measurement.value === undefined) return "";
  if (typeof measurement.value === "string") return measurement.value;
  const digits = measurement.unit === "HU" ? 0 : measurement.unit === "deg" ? 1 : 2;
  return `${Number(measurement.value).toFixed(digits)} ${measurement.unit}`;
}

function planeCenterKey(center) {
  return [center?.x, center?.y, center?.z]
    .map((value) => Math.round(Number(value) || 0))
    .join(",");
}

function renderMeasurement(measurement, index) {
  const { tool, points, id } = measurement;
  const label = formatValue(measurement);
  const first = points[0];
  const last = points.at(-1);
  const labelX = last?.x ?? first?.x ?? 0;
  const labelY = last?.y ?? first?.y ?? 0;
  const common = {
    className: `measurement-shape measurement-${tool}`,
    key: id || `${tool}-${index}`,
  };

  if (tool === "rectangle") {
    const left = Math.min(first.x, last.x);
    const top = Math.min(first.y, last.y);
    return (
      <g {...common}>
        <rect
          x={left}
          y={top}
          width={Math.abs(last.x - first.x)}
          height={Math.abs(last.y - first.y)}
        />
        <text x={left} y={Math.max(14, top - 6)}>{label}</text>
      </g>
    );
  }

  if (tool === "ellipse") {
    const left = Math.min(first.x, last.x);
    const top = Math.min(first.y, last.y);
    return (
      <g {...common}>
        <ellipse
          cx={(first.x + last.x) / 2}
          cy={(first.y + last.y) / 2}
          rx={Math.abs(last.x - first.x) / 2}
          ry={Math.abs(last.y - first.y) / 2}
        />
        <text x={left} y={Math.max(14, top - 6)}>{label}</text>
      </g>
    );
  }

  if (tool === "probe") {
    return (
      <g {...common}>
        <circle cx={first.x} cy={first.y} r="5" />
        <path d={`M ${first.x - 9} ${first.y} H ${first.x + 9} M ${first.x} ${first.y - 9} V ${first.y + 9}`} />
        <text x={first.x + 10} y={first.y - 8}>{label}</text>
      </g>
    );
  }

  if (tool === "text") {
    return (
      <g {...common}>
        <text x={first.x} y={first.y} className="free-text">
          {measurement.value}
        </text>
      </g>
    );
  }

  if (tool === "arrow") {
    return (
      <g {...common}>
        <line
          x1={first.x}
          y1={first.y}
          x2={last.x}
          y2={last.y}
          markerEnd="url(#measurement-arrow)"
        />
        <text x={last.x + 7} y={last.y - 7}>{label}</text>
      </g>
    );
  }

  return (
    <g {...common}>
      <polyline points={pointToSvg(points)} />
      {points.map((point, pointIndex) => (
        <circle key={pointIndex} cx={point.x} cy={point.y} r="3.5" />
      ))}
      <text x={labelX + 7} y={labelY - 8}>{label}</text>
    </g>
  );
}

const CanvasViewport = forwardRef(function CanvasViewport(
  {
    plane,
    volume,
    sliceIndex,
    onSliceChange,
    coordinates,
    onCoordinatesChange,
    active,
    onActivate,
    expanded,
    onExpand,
    activeTool,
    windowCenter,
    windowWidth,
    invert,
    measurements,
    onCompleteMeasurement,
    onWindowLevelChange,
    renderEnabled = true,
  },
  ref,
) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const surfaceRef = useRef(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [rotation, setRotation] = useState(0);
  const [draft, setDraft] = useState([]);
  const [hoverPoint, setHoverPoint] = useState(null);
  const [hoverValue, setHoverValue] = useState(null);
  const dragRef = useRef(null);
  const planeSize = getPlaneSize(volume, plane);
  const aspectRatio = getPlaneAspectRatio(volume, plane);
  const requiredPoints = MEASUREMENT_POINTS[activeTool] || 0;

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      setTransform((current) => ({ ...current, scale: Math.min(5, current.scale + 0.2) }));
    },
    zoomOut: () => {
      setTransform((current) => ({ ...current, scale: Math.max(0.5, current.scale - 0.2) }));
    },
    fit: () =>
      setTransform((current) => ({ ...current, scale: 1, x: 0, y: 0 })),
    reset: () => {
      setTransform({ scale: 1, x: 0, y: 0 });
      setRotation(0);
    },
    getCanvas: () => canvasRef.current,
  }));

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(() => {
      setSurfaceSize(fitSurface(stage, aspectRatio));
    });
    observer.observe(stage);
    setSurfaceSize(fitSurface(stage, aspectRatio));
    return () => observer.disconnect();
  }, [aspectRatio]);

  useEffect(() => {
    if (!canvasRef.current || !volume || !renderEnabled) return;
    renderPlane(
      canvasRef.current,
      volume,
      plane,
      sliceIndex,
      windowCenter,
      windowWidth,
      invert,
    );
  }, [
    volume,
    plane,
    sliceIndex,
    windowCenter,
    windowWidth,
    invert,
    renderEnabled,
  ]);

  useEffect(() => {
    setDraft([]);
    setHoverPoint(null);
    setHoverValue(null);
  }, [plane, activeTool, rotation, coordinates]);

  const planeSpacing = getPlaneSpacing(volume, plane);
  const visibleMeasurements = useMemo(
    () => {
      return measurements.filter(
        (measurement) => {
          if (
            measurement.plane !== plane ||
            measurement.sliceIndex !== sliceIndex ||
            measurement.style?.obliquePlane
          ) {
            return false;
          }
          if (
            measurement.style?.planeCenter &&
            planeCenterKey(measurement.style.planeCenter) !==
              planeCenterKey(coordinates)
          ) {
            return false;
          }
          return true;
        },
      );
    },
    [coordinates, measurements, plane, sliceIndex],
  );

  function screenToImage(event) {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface || !surface.offsetWidth || !surface.offsetHeight) {
      return null;
    }
    const stageRect = stage.getBoundingClientRect();
    const layoutCenterX =
      stageRect.left + surface.offsetLeft + surface.offsetWidth / 2;
    const layoutCenterY =
      stageRect.top + surface.offsetTop + surface.offsetHeight / 2;
    const cssTransform = getComputedStyle(surface).transform;
    const matrix =
      cssTransform && cssTransform !== "none"
        ? new DOMMatrixReadOnly(cssTransform)
        : new DOMMatrixReadOnly();
    const local = matrix
      .inverse()
      .transformPoint(
        new DOMPoint(
          event.clientX - layoutCenterX,
          event.clientY - layoutCenterY,
        ),
      );
    return {
      x: ((local.x + surface.offsetWidth / 2) / surface.offsetWidth) * planeSize.width,
      y: ((local.y + surface.offsetHeight / 2) / surface.offsetHeight) * planeSize.height,
    };
  }

  function updateCoordinatesFromPoint(point) {
    const next = { ...coordinates };
    if (plane === "axial") {
      next.x = point.x;
      next.y = point.y;
    } else if (plane === "coronal") {
      next.x = point.x;
      next.z = planeSize.height - 1 - point.y;
    } else {
      next.y = point.x;
      next.z = planeSize.height - 1 - point.y;
    }
    onCoordinatesChange({
      x: Math.max(0, Math.min(volume.columns - 1, Math.round(next.x))),
      y: Math.max(0, Math.min(volume.rows - 1, Math.round(next.y))),
      z: Math.max(0, Math.min(volume.slices - 1, Math.round(next.z))),
    });
  }

  function currentPlaneStyle() {
    return {
      obliquePlane: false,
      planeCenter: { ...coordinates },
    };
  }

  function completeIfReady(points, textValue = null) {
    if (!requiredPoints || points.length < requiredPoints) return false;
    const extra = {
      textValue,
      style: currentPlaneStyle(),
    };
    if (activeTool === "probe") {
      extra.value = getPixelValue(
        volume,
        plane,
        sliceIndex,
        points[0].x,
        points[0].y,
      );
      extra.unit = "HU";
      extra.style = currentPlaneStyle();
    }
    if (activeTool === "rectangle" || activeTool === "ellipse") {
      const statistics = computeRoiStatistics({
        shape: activeTool,
        points,
        spacing: planeSpacing,
        width: planeSize.width,
        height: planeSize.height,
        valueType: "raw",
        getPixelValue: (x, y) =>
          getPixelValue(volume, plane, sliceIndex, x, y),
      });
      extra.value = statistics.mean;
      extra.unit = "HU";
      extra.style = {
        ...currentPlaneStyle(),
        areaMm2: statistics.areaMm2,
        min: statistics.min,
        max: statistics.max,
        stdDev: statistics.stdDev,
      };
    }
    onCompleteMeasurement(plane, activeTool, points, extra);
    setDraft([]);
    return true;
  }

  function capturePointer(event) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic smoke-test events do not own a native pointer to capture.
    }
  }

  function pointerAngle(event) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.atan2(
      event.clientY - (rect.top + rect.height / 2) - transform.y,
      event.clientX - (rect.left + rect.width / 2) - transform.x,
    );
  }

  function handlePointerDown(event) {
    onActivate();
    if (event.button !== 0) return;

    if (activeTool === "rotate" || event.shiftKey) {
      dragRef.current = {
        type: "rotate",
        lastAngle: pointerAngle(event),
        rotation,
      };
      setHoverPoint(null);
      setHoverValue(null);
      capturePointer(event);
      return;
    }

    if (activeTool === "pan") {
      const point = screenToImage(event);
      if (!point) return;
      updateCoordinatesFromPoint(point);
      dragRef.current = {
        type: "pan",
        pointerX: event.clientX,
        pointerY: event.clientY,
        x: transform.x,
        y: transform.y,
      };
      capturePointer(event);
      return;
    }

    if (activeTool === "windowLevel") {
      dragRef.current = {
        type: "windowLevel",
        pointerX: event.clientX,
        pointerY: event.clientY,
      };
      capturePointer(event);
      return;
    }

    const point = screenToImage(event);
    if (!point) return;
    if (!requiredPoints) return;
    if (activeTool === "text") {
      const text = window.prompt("输入文字标注", "标注");
      if (text?.trim()) {
        onCompleteMeasurement(plane, "text", [point], {
          textValue: text.trim(),
          style: currentPlaneStyle(),
        });
      }
      return;
    }
    const nextDraft = [...draft, point];
    setDraft(nextDraft);
    completeIfReady(nextDraft);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (drag?.type === "rotate") {
      const angle = pointerAngle(event);
      let delta = angle - drag.lastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      drag.lastAngle = angle;
      drag.rotation += (delta * 180) / Math.PI;
      if (delta) {
        setRotation(((drag.rotation % 360) + 360) % 360);
      }
      return;
    }

    const point = screenToImage(event);
    if (!point) return;
    const insideImage =
      point.x >= 0 &&
      point.x <= planeSize.width - 1 &&
      point.y >= 0 &&
      point.y <= planeSize.height - 1;
    setHoverPoint(insideImage ? point : null);
    setHoverValue(
      insideImage
        ? getPixelValue(volume, plane, sliceIndex, point.x, point.y)
        : null,
    );

    if (!insideImage && !drag) return;
    if (!drag) return;
    if (drag.type === "pan") {
      setTransform((current) => ({
        ...current,
        x: drag.x + event.clientX - drag.pointerX,
        y: drag.y + event.clientY - drag.pointerY,
      }));
    }
    if (drag.type === "windowLevel") {
      const deltaX = event.clientX - drag.pointerX;
      const deltaY = event.clientY - drag.pointerY;
      onWindowLevelChange({
        center: -deltaY * 4,
        width: deltaX * 8,
      });
      drag.pointerX = event.clientX;
      drag.pointerY = event.clientY;
    }
  }

  function handlePointerUp(event) {
    dragRef.current = null;
    try {
      if (
        event?.pointerId !== undefined &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may already have released the pointer.
    }
  }

  function handleWheel(event) {
    onActivate();
    event.preventDefault();
    if (event.ctrlKey || event.shiftKey) {
      const delta = event.deltaY > 0 ? -0.12 : 0.12;
      setTransform((current) => ({
        ...current,
        scale: Math.max(0.5, Math.min(5, current.scale + delta)),
      }));
      return;
    }
    onSliceChange(event.deltaY > 0 ? 1 : -1);
  }

  const previewPoint = draft.at(-1);
  return (
    <article
      className={`viewport-panel ${active ? "active" : ""} ${expanded ? "expanded" : ""}`}
      data-plane={plane}
    >
      <header className="viewport-header">
        <div>
          <strong>{PLANE_LABELS[plane]}</strong>
          <span>{plane.toUpperCase()}</span>
        </div>
        <div className="viewport-tools">
          <output>{sliceIndex + 1} / {planeSize.slices}</output>
          <button
            type="button"
            className="icon-button"
            title="单独放大"
            data-expand-viewport={plane}
            onClick={onExpand}
          >
            <Expand size={15} />
          </button>
        </div>
      </header>
      <div
          ref={stageRef}
          className={`image-stage tool-${activeTool}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          onPointerLeave={() => {
            setHoverPoint(null);
            setHoverValue(null);
          }}
          onWheel={handleWheel}
        >
          <div
            ref={surfaceRef}
            className="image-surface"
            style={{
              width: surfaceSize.width,
              height: surfaceSize.height,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${rotation}deg)`,
            }}
          >
            <canvas ref={canvasRef} />
            <svg
              className="measurement-layer"
              viewBox={`0 0 ${planeSize.width} ${planeSize.height}`}
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  id="measurement-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" />
                </marker>
              </defs>
              {visibleMeasurements.map(renderMeasurement)}
              {previewPoint && hoverPoint && (
                <line
                  className="measurement-preview"
                  x1={previewPoint.x}
                  y1={previewPoint.y}
                  x2={hoverPoint.x}
                  y2={hoverPoint.y}
                />
              )}
              {draft.map((point, index) => (
                <circle
                  key={index}
                  className="measurement-handle"
                  cx={point.x}
                  cy={point.y}
                  r="4"
                />
              ))}
            </svg>
            <div className="crosshair" style={{ "--x": "50%", "--y": "50%" }}>
              <span className="crosshair-x" />
              <span className="crosshair-y" />
              <i />
            </div>
          </div>
          <span className="orientation-marker marker-top">A</span>
          <span className="orientation-marker marker-left">R</span>
          {hoverValue !== null && (
            <span className="pixel-probe-readout">
              <ScanLine size={13} />
              {Math.round(hoverValue)} HU
            </span>
          )}
      </div>
      <footer className="viewport-footer">
        <span>W {Math.round(windowWidth)}</span>
        <span>L {Math.round(windowCenter)}</span>
        <span>Z {transform.scale.toFixed(2)}×</span>
        <span>R {Math.round(rotation)}°</span>
      </footer>
    </article>
  );
});

export default CanvasViewport;
