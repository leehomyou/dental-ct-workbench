# 牙科 CT 影像工作台

通用、单机离线的牙科 CT/CBCT 阅片与测量应用。

## 当前能力

- 导入 DICOM 文件夹、ZIP 和单个 DICOM 文件。
- 自动识别患者、检查和 CT 序列，建立本地病例库。
- 动态读取 DICOM 并重建轴位、冠状位和矢状位。
- 同时导入同目录中的全景片和二维截图，并在序列概览中切换查看。
- 使用 VTK.js 生成可通过鼠标旋转、缩放的三维骨骼容积视图。
- 四窗布局、单窗放大；单窗时左右工具和参数栏保持可见。
- 窗宽窗位、骨窗/软组织预设、缩放、平移、反色和复位。
- 距离、角度、HU 探针、矩形 ROI、椭圆 ROI、箭头和文字测量。
- 测量保存、撤销、重做、按层清理和当前视图截图。
- 临床模式显示患者身份；展示模式使用本地匿名显示信息。

## 数据位置

病例库保存在 Electron 用户数据目录的 `ct-library` 中。原始导入目录不会被删除或修改。

仓库和发布包不包含任何患者 DICOM、全景片、病例库或测量记录。

## 开发和构建

```powershell
npm install
npm run build:web
npm test
npm run smoke
npm run build:portable
```

便携版输出到：

`release/`

## 边界

当前定位为本地影像查看与基础测量工具，使用 Electron、React、Vite、dicom-parser 等开源或开放源码组件。软件尚未完成医疗器械注册和正式临床验证，不应宣称已合规用于正式诊断。第三方许可证和发布前缺口见 `THIRD_PARTY_NOTICES.md` 与 `docs/commercial-readiness.md`。
