# 测量模型与计算接口

本模块只处理图像空间中的测量数据和统计计算，不依赖 DOM、Electron 或具体阅片 UI。

## 坐标约定

- 测量点始终使用图像原始像素坐标，不使用 CSS 像素、画布像素或屏幕坐标。
- `x` 对应图像列（column），`y` 对应图像行（row）。
- `spacing.x` 对应列间距，`spacing.y` 对应行间距；两者单位均为毫米。
- 旋转、缩放、平移和窗口尺寸变化只能影响显示，不能在保存前改写测量点。

## 测量对象

每条测量固定包含以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 持久化唯一标识；创建后不可修改 |
| `studyId` | string | 检查标识 |
| `seriesId` | string | 序列标识 |
| `plane` | string | `axial`、`coronal`、`sagittal`、`panoramic` 或其他视图名 |
| `sliceIndex` | integer | 非负层索引；非断层视图固定为 `0` |
| `tool` | string | `distance`、`angle`、`polyline`、`rectangle`、`ellipse`、`arrow`、`text` |
| `points` | Point[] | 图像像素坐标点 |
| `value` | number/string/null | 计算结果或文字内容 |
| `unit` | string | `mm`、`deg`、`mm2`、`HU`、`text` 等 |
| `style` | object | 颜色、线宽、箭头大小、字号等显示参数 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 最后更新时间 |

点数量约束：

- 距离、箭头、矩形和椭圆：2 个对点。
- 角度：3 个点，第 2 个点为顶点。
- 折线：至少 2 个点。
- 文字：1 个锚点；文字内容保存在 `value`，`unit` 使用 `text`。

矩形和椭圆的两个点分别表示包围框的一组对角点。ROI 统计接口也接受
`bounds: { x, y, width, height }`。

## 几何接口

`src/measurements/geometry.js` 导出：

- `distance2D(pointA, pointB, spacing)`：返回 `{ pixels, mm }`。
- `pixelDistance(pointA, pointB)`：返回像素距离。
- `physicalDistance(pointA, pointB, spacing)`：返回毫米距离。
- `angleBetweenThreePoints(pointA, vertex, pointB, { degrees })`：默认返回角度。
- `polylineLength(points, spacing)`：返回总长度及各段长度。
- `normalizeSpacing(spacing)`：支持数字、`{ x, y }`、`{ column, row }`
  和 `{ xSpacing, ySpacing }`。

## ROI 统计

`src/measurements/statistics.js` 导出 `computeRoiStatistics(options)`，以及
`calculateRectangleStatistics` 和 `calculateEllipseStatistics` 两个包装函数。

输入可提供以下任一像素来源：

```js
{
  points: [{ x: 10, y: 20 }, { x: 40, y: 50 }],
  width: 512,
  height: 512,
  pixelData: rowMajorFloatArray,
  spacing: { x: 0.3, y: 0.3 },
  valueType: "HU",
  rescaleSlope: 1,
  rescaleIntercept: -1024
}
```

也可提供 `getPixelValue(x, y)` 代替 `pixelData`。像素数组必须按行优先存放：

```js
value = pixelData[y * width + x]
```

返回字段：

- `areaMm2`：实际采样像素数 × 单像素面积。
- `pixelAreaMm2`：单像素面积。
- `pixelCount`：参与统计的像素数。
- `skippedPixelCount`：图像范围外或像素值为非有限数的数量。
- `mean`、`min`、`max`、`stdDev`：总体统计量。
- `valueType`：`HU` 或 `raw`。

空 ROI 的统计量返回 `null`，而不是伪造为 `0`。HU 模式按
`raw * rescaleSlope + rescaleIntercept` 转换后再计算。

## 测量存储

`createMeasurementStore(options)` 返回：

- `add(measurement)`
- `update(id, patch)`
- `remove(id)`
- `clear()` 或 `clear({ plane, sliceIndex })`
- `clearLayer(plane, sliceIndex)`
- `list({ plane, sliceIndex })`
- `select(id)`、`getSelected()`、`get(id)`
- `undo()`、`redo()`
- `toJSON()`、`load(serialized)`
- `count`、`canUndo`、`canRedo`、`selectedId`

`options` 可注入 `now`、`idGenerator` 和 `historyLimit`，便于确定性测试。

所有读取接口返回深拷贝，修改 `list()`、`get()` 或 `toJSON()` 的结果都不会
改变存储内部数据。每次新增、更新、单条删除或清除都会形成撤销快照。

序列化格式：

```json
{
  "version": 1,
  "measurements": [],
  "selectedId": null
}
```

`load()` 会校验字段、点数、时间和重复 ID，并清空已有撤销/重做历史。
