# 视网膜裂孔定位器 (Retinal Break Locator)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

基于 Optos 200° SLO 眼底图像的视网膜裂孔定位系统，通过黄斑-视盘校准计算裂孔到角膜缘的弧长距离，为视网膜手术提供定位参考。

## ✨ 功能特点

- 🖼️ **图像上传** — 支持拖拽上传 Optos SLO 眼底图像
- 🎯 **手动标记** — 标记黄斑中心、视盘中心、视网膜裂孔位置
- 📐 **自动校准** — 利用视盘-黄斑距离进行尺寸校准
- 📏 **距离测量** — 计算裂孔到黄斑的距离、角膜缘弧长
- 🕐 **时钟位定位** — 输出裂孔子午线方向（时钟位），用于手术定位
- 🌐 **3D 可视化** — Three.js 实时渲染眼底球面模型

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/fundus-sphere-map.git
cd fundus-sphere-map

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 `http://localhost:5173` 查看应用。

### 构建

```bash
# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 📖 使用指南

### 基本流程

1. **上传图像** — 点击上传区域或拖拽 Optos SLO 眼底图像
2. **设置参数** — 调整眼轴长度（默认 24mm）和视场角（默认 200°）
3. **标记位置** — 选择标记类型，在预览图上点击设置：
   - 🔴 **黄斑中心** — 视觉轴中心参考点
   - 🔵 **视盘中心** — 用于距离校准
   - 🟡 **视网膜裂孔** — 待测量的目标位置
4. **处理图像** — 点击"处理图像"按钮进行 3D 映射
5. **查看结果** — 在 3D 视图中旋转、缩放查看映射结果

### 测量输出

标记裂孔后，系统自动计算并显示：

| 参数 | 说明 |
|------|------|
| 距黄斑中心 | 裂孔到黄斑的弧长距离 (mm) |
| 角膜缘距离 | 角膜缘到裂孔的弧长距离 (mm) |
| 时钟位 | 裂孔的时钟方向（用于手术定位） |

## 🧮 核心算法

### 映射原理

采用**方位角等距投影** (Azimuthal Equidistant Projection)：

```
输入: 图像归一化坐标 (x, y), 黄斑位置 (maculaX, maculaY)

步骤 1: 以黄斑为中心偏移
  dx = x - maculaX
  dy = y - maculaY

步骤 2: 极坐标转换
  r = sqrt(dx² + dy²) × 2
  θ = r × (FOV/2) × (π/180)
  φ = atan2(-dy, dx)

步骤 3: 球面 → 笛卡尔
  R = axialLength / 2
  X = R × sin(θ) × cos(φ)
  Y = R × sin(θ) × sin(φ)
  Z = R × cos(θ)
```

### 解剖学参考

```javascript
// 标准眼模型
const STANDARD_EYE = {
  axialLength: 24,      // 眼轴长度 (mm)
  retinalRadius: 12,    // 视网膜半径 (mm)
  fov: 200              // Optos 视场角 (度)
};

// 解剖学数据
const ANATOMY = {
  discToMaculaAngle: 17,      // 视盘位于黄斑鼻侧约 17°
  discToMaculaDistance: 4.5,  // 视盘到黄斑距离 (mm)
  limbusToMaculaArc: 30.5,    // 角膜缘到黄斑弧长 (mm)
};
```

## 📁 项目结构

```
fundus-sphere-map/
├── index.html          # 主页面入口
├── src/
│   ├── main.js         # 应用入口、UI 交互
│   ├── mapper.js       # 3D 球面映射算法
│   └── visualize.js    # Three.js 可视化模块
├── docs/
│   └── 方案.md         # 技术方案文档
└── public/
    └── models/         # YOLO 模型文件 (待实现)
```

## 🛠️ 技术栈

- **构建工具**: Vite 5.x
- **3D 渲染**: Three.js
- **前端**: 原生 HTML/JavaScript (ES Modules)
- **测试**: Vitest

## 📋 开发命令

```bash
npm run dev      # 启动开发服务器
npm run build    # 构建生产版本
npm run preview  # 预览生产版本
npm test         # 运行测试套件
```

## 🗺️ 路线图

- [x] 2D→3D 球面映射
- [x] Three.js 可视化
- [x] 黄斑/视盘手动标记
- [x] 距离校准计算
- [x] 裂孔标记与测量
- [ ] YOLO 目标检测自动标记
- [ ] 眼轴长度自动识别
- [ ] 导出测量报告 (PDF/DOCX)

## 📄 许可证

本项目采用 [MIT 许可证](./LICENSE)。

## 🙏 致谢

- [Three.js](https://threejs.org/) — 3D 渲染引擎
- [Vite](https://vitejs.dev/) — 前端构建工具
- [Optos](https://www.optos.com/) — 超广角眼底成像技术参考
