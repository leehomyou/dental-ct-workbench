import { useEffect } from "react";
import { HardDrive, ShieldCheck, X } from "lucide-react";

export default function AboutDialog({ open, onClose, appInfo }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const version = appInfo?.version || "开发预览";

  return (
    <div
      className="about-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        data-about-dialog
      >
        <button
          className="icon-button about-close"
          type="button"
          title="关闭"
          onClick={onClose}
        >
          <X size={17} />
        </button>

        <header className="about-heading">
          <span className="about-mark">CT</span>
          <div>
            <p>ABOUT APPLICATION</p>
            <h2 id="about-dialog-title">牙科 CT 影像工作台</h2>
            <span>版本 {version}</span>
          </div>
        </header>

        <div className="about-facts">
          <div>
            <HardDrive size={18} />
            <span>本机离线运行</span>
            <small>病例和影像不上传云端</small>
          </div>
          <div>
            <ShieldCheck size={18} />
            <span>本地病例库</span>
            <small>{appInfo?.packaged ? "桌面安装版" : "开发预览"}</small>
          </div>
        </div>

        <section className="about-section">
          <h3>应用用途</h3>
          <p>
            用于 DICOM / CBCT 影像查看、医患沟通、术前初步测量和病例展示。
          </p>
        </section>

        <section className="about-section">
          <h3>本地数据位置</h3>
          <code>{appInfo?.libraryRoot || "桌面应用运行时显示病例库路径"}</code>
        </section>

        <div className="about-disclaimer">
          当前版本未完成医疗器械注册，不替代医生诊断结论。导入的患者影像仅保存在本机。
        </div>

        <footer className="about-footer">
          <span>Electron · React · DICOM Parser · VTK.js</span>
          <button className="button primary" type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
