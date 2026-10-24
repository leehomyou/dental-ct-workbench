import { useEffect, useMemo, useRef, useState } from "react";
import { Expand, Images } from "lucide-react";
import { renderPlane } from "../viewer/mpr-renderer.js";
import Volume3DView from "./Volume3DView.jsx";

function ancillaryUrl(studyId, image) {
  const relativePath = image.storedPath || image.relativePath;
  if (!relativePath) return "";
  const encoded = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `ctdata://${encodeURIComponent(studyId)}/${encoded}`;
}

function OverviewThumb({ volume, index, current, onSelect }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    renderPlane(
      canvasRef.current,
      volume,
      "axial",
      index,
      1250,
      5000,
      false,
    );
  }, [volume, index]);

  return (
    <button
      className={`overview-thumb ${current ? "active" : ""}`}
      type="button"
      onClick={() => onSelect(index)}
      title={`轴位 ${index + 1}`}
    >
      <canvas ref={canvasRef} />
      <span>{index + 1}</span>
    </button>
  );
}

export default function SeriesOverview({
  volume,
  currentSlice,
  onSelectSlice,
  expanded,
  onExpand,
  ancillaryImages = [],
}) {
  const [activeSeries, setActiveSeries] = useState("3d");
  const indices = useMemo(() => {
    const count = Math.min(12, volume.slices);
    return Array.from({ length: count }, (_, index) =>
      Math.round((index / Math.max(1, count - 1)) * (volume.slices - 1)),
    );
  }, [volume.slices]);
  const selectedImage = ancillaryImages.find(
    (image) => (image.id || image.storedPath) === activeSeries,
  );

  return (
    <article
      className={`viewport-panel overview-panel ${expanded ? "expanded" : ""}`}
      data-plane="overview"
    >
      <header className="viewport-header">
        <div>
          <strong>序列概览</strong>
          <span>SERIES</span>
        </div>
        <div className="viewport-tools">
          <Images size={15} />
          <button type="button" className="icon-button" title="单独放大" onClick={onExpand}>
            <Expand size={15} />
          </button>
        </div>
      </header>
      <div className="overview-series-tabs">
        <button
          type="button"
          className={activeSeries === "ct" ? "active" : ""}
          onClick={() => setActiveSeries("ct")}
        >
          CT · {volume.slices}
        </button>
        <button
          type="button"
          className={activeSeries === "3d" ? "active" : ""}
          onClick={() => setActiveSeries("3d")}
        >
          3D 骨骼
        </button>
        {ancillaryImages.map((image) => {
          const id = image.id || image.storedPath;
          return (
            <button
              key={id}
              type="button"
              className={activeSeries === id ? "active" : ""}
              onClick={() => setActiveSeries(id)}
              title={image.label || image.kind}
            >
              {image.kind === "panorama" ? "全景片" : image.label || "影像"}
            </button>
          );
        })}
      </div>
      {activeSeries === "3d" ? (
        <Volume3DView volume={volume} highQuality={expanded} />
      ) : selectedImage ? (
        <div className="overview-image-stage">
          <img
            src={ancillaryUrl(volume.studyId, selectedImage)}
            alt={selectedImage.label || selectedImage.kind}
          />
        </div>
      ) : (
        <div className="overview-grid">
          {indices.map((index) => (
            <OverviewThumb
              key={index}
              volume={volume}
              index={index}
              current={Math.abs(index - currentSlice) < 2}
              onSelect={onSelectSlice}
            />
          ))}
        </div>
      )}
      <footer className="viewport-footer">
        <span>
          {activeSeries === "3d"
            ? "VOLUME 3D"
            : selectedImage
            ? selectedImage.kind === "panorama"
              ? "PANORAMA"
              : "2D IMAGE"
            : `${volume.slices} 层`}
        </span>
        <span>
          {activeSeries === "3d"
            ? "BONE RECONSTRUCTION"
            : selectedImage
            ? selectedImage.label
            : volume.series?.description || "CT 序列"}
        </span>
      </footer>
    </article>
  );
}
