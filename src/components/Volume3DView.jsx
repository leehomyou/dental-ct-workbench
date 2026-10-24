import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Rotate3D } from "lucide-react";
import "@kitware/vtk.js/Rendering/Profiles/Volume";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkPiecewiseFunction from "@kitware/vtk.js/Common/DataModel/PiecewiseFunction";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkVolume from "@kitware/vtk.js/Rendering/Core/Volume";
import vtkVolumeMapper from "@kitware/vtk.js/Rendering/Core/VolumeMapper";
import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkInteractorStyleTrackballCamera from "@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera";

const DEFAULT_DOWNSAMPLE_STEP = 3;
const HIGH_QUALITY_DOWNSAMPLE_STEP = 2;

function downsampleVolume(volume, step) {
  const width = Math.ceil(volume.columns / step);
  const height = Math.ceil(volume.rows / step);
  const depth = Math.ceil(volume.slices / step);
  const values = new Int16Array(width * height * depth);
  let outputIndex = 0;

  for (let z = 0; z < volume.slices; z += step) {
    const zOffset = z * volume.rows * volume.columns;
    for (let y = 0; y < volume.rows; y += step) {
      const rowOffset = zOffset + y * volume.columns;
      for (let x = 0; x < volume.columns; x += step) {
        values[outputIndex] = volume.volume[rowOffset + x];
        outputIndex += 1;
      }
    }
  }

  return {
    values,
    width,
    height,
    depth,
    spacing: {
      x: volume.spacing.x * step,
      y: volume.spacing.y * step,
      z: volume.spacing.z * step,
    },
  };
}

function createBoneTransferFunctions() {
  const color = vtkColorTransferFunction.newInstance();
  color.addRGBPoint(-1000, 0, 0, 0);
  color.addRGBPoint(120, 0.18, 0.16, 0.13);
  color.addRGBPoint(300, 0.52, 0.45, 0.34);
  color.addRGBPoint(650, 0.8, 0.73, 0.58);
  color.addRGBPoint(1200, 0.94, 0.9, 0.8);
  color.addRGBPoint(2600, 1, 0.98, 0.9);

  const opacity = vtkPiecewiseFunction.newInstance();
  opacity.addPoint(-1000, 0);
  opacity.addPoint(110, 0);
  opacity.addPoint(240, 0.015);
  opacity.addPoint(380, 0.09);
  opacity.addPoint(650, 0.28);
  opacity.addPoint(1100, 0.58);
  opacity.addPoint(2200, 0.86);
  opacity.addPoint(4096, 1);

  return { color, opacity };
}

export default function Volume3DView({ volume, highQuality = false }) {
  const containerRef = useRef(null);
  const renderWindowRef = useRef(null);
  const rendererRef = useRef(null);
  const [status, setStatus] = useState("building");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!containerRef.current || !volume) return undefined;
    let disposed = false;
    let resizeObserver = null;
    let timer = null;
    setStatus("building");
    setError("");

    timer = setTimeout(() => {
      try {
        const reduced = downsampleVolume(
          volume,
          highQuality ? HIGH_QUALITY_DOWNSAMPLE_STEP : DEFAULT_DOWNSAMPLE_STEP,
        );
        const imageData = vtkImageData.newInstance();
        imageData.setDimensions(reduced.width, reduced.height, reduced.depth);
        imageData.setSpacing(
          reduced.spacing.x,
          reduced.spacing.y,
          reduced.spacing.z,
        );
        imageData.setOrigin(
          (-reduced.width * reduced.spacing.x) / 2,
          (-reduced.height * reduced.spacing.y) / 2,
          (-reduced.depth * reduced.spacing.z) / 2,
        );
        imageData.getPointData().setScalars(
          vtkDataArray.newInstance({
            name: "CT",
            values: reduced.values,
            numberOfComponents: 1,
          }),
        );

        const mapper = vtkVolumeMapper.newInstance();
        mapper.setInputData(imageData);
        mapper.setSampleDistance(
          Math.max(
            0.35,
            Math.min(
              reduced.spacing.x,
              reduced.spacing.y,
              reduced.spacing.z,
            ) * (highQuality ? 0.8 : 1.15),
          ),
        );
        const actor = vtkVolume.newInstance();
        actor.setMapper(mapper);
        const property = actor.getProperty();
        const transfer = createBoneTransferFunctions();
        property.setRGBTransferFunction(0, transfer.color);
        property.setScalarOpacity(0, transfer.opacity);
        property.setInterpolationTypeToLinear();
        property.setShade(true);
        property.setAmbient(0.08);
        property.setDiffuse(0.92);
        property.setSpecular(0.46);
        property.setSpecularPower(34);
        property.setScalarOpacityUnitDistance(0, 1);
        property.setUseGradientOpacity(0, true);
        property.setGradientOpacityMinimumValue(0, 20);
        property.setGradientOpacityMinimumOpacity(0, 0.03);
        property.setGradientOpacityMaximumValue(0, 180);
        property.setGradientOpacityMaximumOpacity(0, 1);

        const renderWindow = vtkGenericRenderWindow.newInstance({
          background: [0.015, 0.019, 0.02],
          listenWindowResize: false,
        });
        renderWindow.setContainer(containerRef.current);
        const renderer = renderWindow.getRenderer();
        renderer.setBackground(0.015, 0.019, 0.02);
        renderer.addVolume(actor);
        renderer.resetCamera();
        const camera = renderer.getActiveCamera();
        camera.azimuth(25);
        camera.elevation(18);
        camera.zoom(1.35);
        renderer.resetCameraClippingRange();

        const interactor = renderWindow.getInteractor();
        interactor.setInteractorStyle(
          vtkInteractorStyleTrackballCamera.newInstance(),
        );
        const cameraSnapshot = () => {
          const activeCamera = renderer.getActiveCamera();
          containerRef.current?.setAttribute(
            "data-camera-position",
            activeCamera.getPosition().map((value) => value.toFixed(3)).join(","),
          );
        };
        interactor.onEndInteraction(cameraSnapshot);
        interactor.initialize();
        renderWindow.resize();
        renderWindow.getRenderWindow().render();
        cameraSnapshot();

        resizeObserver = new ResizeObserver(() => {
          if (!disposed) {
            renderWindow.resize();
            renderWindow.getRenderWindow().render();
          }
        });
        resizeObserver.observe(containerRef.current);
        renderWindowRef.current = renderWindow;
        rendererRef.current = renderer;
        if (!disposed) setStatus("ready");
      } catch (renderError) {
        if (!disposed) {
          setStatus("error");
          setError(
            renderError instanceof Error ? renderError.message : String(renderError),
          );
        }
      }
    }, 30);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      resizeObserver?.disconnect();
      if (renderWindowRef.current) {
        try {
          renderWindowRef.current.delete();
        } catch {
          // The WebGL context may already be gone during window shutdown.
        }
        renderWindowRef.current = null;
        rendererRef.current = null;
      }
    };
  }, [highQuality, volume]);

  function resetCamera() {
    const renderer = rendererRef.current;
    const renderWindow = renderWindowRef.current;
    if (!renderer || !renderWindow) return;
    const camera = renderer.getActiveCamera();
    camera.setPosition(0, -1, 0);
    camera.setFocalPoint(0, 0, 0);
    camera.setViewUp(0, 0, 1);
    camera.azimuth(25);
    camera.elevation(18);
    camera.zoom(1.35);
    renderer.resetCameraClippingRange();
    renderWindow.getRenderWindow().render();
  }

  return (
    <div
      className="volume-3d-stage"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div ref={containerRef} className="volume-3d-canvas" />
      <button
        type="button"
        className="volume-reset-button"
        title="重置三维视角"
        onClick={resetCamera}
      >
        <Rotate3D size={15} />
      </button>
      {status === "building" && (
        <div className="volume-3d-overlay">
          <LoaderCircle className="spin" size={20} />
          <span>
            正在构建骨骼三维模型{highQuality ? "（高清）" : ""}
          </span>
        </div>
      )}
      {status === "error" && (
        <div className="volume-3d-overlay error">
          <span>三维视图创建失败</span>
          <small>{error}</small>
        </div>
      )}
    </div>
  );
}
