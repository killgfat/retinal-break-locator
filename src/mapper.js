/**
 * 眼底球面映射算法
 * 将 2D SLO 图像映射到 3D 球面
 * 
 * 关键概念:
 * - 黄斑 (Macula/Fovea): 视觉轴中心，应为映射参考点 (theta=0)
 * - 视盘 (Optic Disc): 位于黄斑鼻侧约17°，上方约7.76°，用于校准
 * - Optos 200° SLO: 图像中心是相机光轴，不一定是黄斑位置
 */

// 标准眼参数
const STANDARD_EYE = {
  axialLength: 24,      // 眼轴长度 (mm)
  retinalRadius: 12,    // 视网膜半径 (mm) = 眼轴/2 (简化模型)
  fov: 200              // Optos 视场角 (度)
};

// 解剖学参考数据
const ANATOMY = {
  // 视盘相对于黄斑的位置 (从黄斑看向视盘)
  discToMaculaAngle: 17,      // 视盘位于黄斑鼻侧约17°
  discToMaculaVertical: 7.76, // 视盘位于黄斑上方约7.76° (disc-fovea angle)
  discToMaculaDistance: 4.5,  // 视盘到黄斑距离 (mm), 范围 4.0-5.0mm
  combinedDiscMaculaAngle: 18.7, // 视盘到黄斑的综合角度 (°)
  
  // 角膜参数
  corneaDiameter: 11.7,       // 角膜直径 WTW (mm), 水平11.7mm, 垂直10.6mm, 范围 10.5-12.5mm
  corneaRadius: 7.8,          // 角膜前表面曲率半径 (mm), 范围 7.0-8.5mm
  corneaThickness: 0.5,       // 角膜中央厚度 (mm), 约 0.5mm
  
  // 前房参数
  anteriorChamberDepth: 3.0,  // 前房深度 (mm), 从角膜内皮到晶状体前表面, 范围 2.5-3.5mm
  
  // 角膜缘位置 (角膜与巩膜交界处)
  // 角膜缘到黄斑的弧长距离 (mm)
  limbusToMaculaArc: 30.5,    // 角膜缘到黄斑的弧长 (24mm眼轴, 3mm前房深度)
  
  // 视盘大小 (变异大，仅供参考)
  discHorizontalDiameter: 1.79, // mm, 范围 0.91-2.76
  discVerticalDiameter: 1.97    // mm, 范围 1.08-2.76
};

/**
 * 计算眼球几何参数
 * 根据眼轴长度、前房深度和角膜直径计算更准确的眼球形状参数
 * 
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} anteriorChamberDepth - 前房深度 (mm), 可选
 * @param {number} corneaDiameter - 角膜直径 WTW (mm), 可选
 * @returns {Object} 眼球几何参数
 */
export function calculateEyeGeometry(axialLength = 24, anteriorChamberDepth = null, corneaDiameter = null) {
  const acd = anteriorChamberDepth ?? ANATOMY.anteriorChamberDepth;
  const wtw = corneaDiameter ?? ANATOMY.corneaDiameter;
  
  const corneaProtrusion = calculateCorneaProtrusion(wtw);
  
  const vitreousLength = axialLength - acd - ANATOMY.corneaThickness - corneaProtrusion;
  
  const retinalRadius = vitreousLength / 2 + corneaProtrusion / 2;
  
  const limbusToMaculaArc = calculateLimbusToMaculaArc(retinalRadius, acd, axialLength, wtw);
  
  return {
    axialLength,
    anteriorChamberDepth: acd,
    corneaProtrusion,
    retinalRadius,
    limbusToMaculaArc,
    corneaDiameter: wtw,
    corneaRadius: ANATOMY.corneaRadius,
    corneaThickness: ANATOMY.corneaThickness
  };
}

function calculateCorneaProtrusion(corneaDiameter) {
  const r = ANATOMY.corneaRadius;
  const d = corneaDiameter;
  const halfD = d / 2;
  
  if (halfD >= r) {
    return r;
  }
  
  const h = r - Math.sqrt(r * r - halfD * halfD);
  
  return h + ANATOMY.corneaThickness;
}

function calculateLimbusToMaculaArc(retinalRadius, anteriorChamberDepth, axialLength, corneaDiameter) {
  const halfWtw = corneaDiameter / 2;
  const standardWtw = ANATOMY.corneaDiameter / 2;
  
  const standardRatio = ANATOMY.limbusToMaculaArc / (STANDARD_EYE.axialLength / 2);
  
  const wtwAdjustment = halfWtw / standardWtw;
  
  return retinalRadius * standardRatio * (axialLength / STANDARD_EYE.axialLength) * wtwAdjustment;
}

/**
 * 计算视网膜参数
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} fov - 视场角 (度)
 * @param {number} imageWidth - 图像宽度 (像素), 用于计算分辨率
 * @returns {Object} 视网膜参数
 */
export function calculateRetinalParameters(axialLength = 24, fov = 200, imageWidth = 2000) {
  const retinalRadius = axialLength / 2;
  
  // 弧长 = R × θ (弧度)
  // 200° FOV 对应的视网膜弧长
  const fovRad = fov * (Math.PI / 180);
  const retinalArc = retinalRadius * fovRad;
  
  // 像素分辨率
  const degPerPixel = fov / imageWidth;           // 度/像素
  const mmPerPixel = retinalArc / imageWidth;     // mm/像素
  
  return {
    axialLength,
    retinalRadius,
    fov,
    imageWidth,
    degPerPixel,          // 度/像素
    mmPerPixel,           // mm/像素
    retinalArc,           // 视网膜弧长 (mm)
    degPerMm: 180 / (Math.PI * retinalRadius)  // 每 mm 对应的角度
  };
}

/**
 * 将图像坐标转换为球面坐标
 * 
 * 核心逻辑:
 * 1. 黄斑应为映射中心 (theta=0)
 * 2. 图像坐标先根据黄斑位置偏移，再转换为球面坐标
 * 
 * @param {number} x - 图像 x 坐标 (0-1 归一化)
 * @param {number} y - 图像 y 坐标 (0-1 归一化)
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} fov - 视场角 (度)
 * @param {Object} options - 可选参数
 * @param {number} options.maculaX - 黄斑在图像中的 x 位置 (0-1), 默认 0.5
 * @param {number} options.maculaY - 黄斑在图像中的 y 位置 (0-1), 默认 0.5
 * @returns {Object} 球面坐标 {theta, phi, x, y, z}
 */
export function imageToSphere(x, y, axialLength = 24, fov = 200, options = {}) {
  const { maculaX = 0.5, maculaY = 0.5, imageAspect = 1 } = options;
  
  // 以黄斑为原点进行偏移
  // 黄斑位置映射到球体的后极 (theta=0)
  const dx = (x - maculaX) * imageAspect;
  const dy = (y - maculaY);
  
  // 最大角度 (从中心到边缘)
  // 200° FOV 意味着从中心到边缘是 100°
  const maxAngle = (fov / 2) * (Math.PI / 180); // 弧度
  
  // 计算到黄斑的距离 (归一化)
  // 假设图像是圆形视场，最大半径 = 0.5 (从中心到边缘)
  const r = Math.sqrt(dx * dx + dy * dy) * 2; // 归一化距离 [0, 1]
  
  // 极角 (theta): 距离黄斑的角度
  // theta = 0 在黄斑位置，theta = maxAngle 在图像边缘
  const theta = r * maxAngle;
  
  // 方位角 (phi): 相对于黄斑的方向
  // 注意: 图像坐标系 y 轴向下，需要翻转以匹配解剖学坐标系
  const phi = Math.atan2(-dy, dx); // 负号使上方为正
  
  // 视网膜半径
  const R = axialLength / 2;
  
  // 球面坐标转笛卡尔坐标
  // 黄斑在后极，所以 theta=0 时 z=R (朝向观察者)
  // 使用标准的球面坐标转换，但调整方向使黄斑位于 (0, 0, R)
  const sphereX = R * Math.sin(theta) * Math.cos(phi);
  const sphereY = R * Math.sin(theta) * Math.sin(phi);
  const sphereZ = R * Math.cos(theta); // theta=0 时 z 最大
  
  return {
    theta,           // 极角 (弧度), 距离黄斑的角度
    phi,             // 方位角 (弧度), 相对于黄斑的方向
    x: sphereX,      // 笛卡尔 x
    y: sphereY,      // 笛卡尔 y  
    z: sphereZ,      // 笛卡尔 z (黄斑处 z=R)
    r,               // 归一化半径 (0-1)
    angleDeg: theta * (180 / Math.PI), // 距离黄斑的角度 (度)
    isValid: r <= 1  // 是否在有效视场内
  };
}

/**
 * 从视盘位置计算黄斑位置
 * 
 * 解剖学关系:
 * - 黄斑位于视盘颞侧约17°
 * - 黄斑位于视盘下方约7.76° (disc-fovea angle 的反向)
 * 
 * @param {number} discX - 视盘在图像中的 x 位置 (0-1)
 * @param {number} discY - 视盘在图像中的 y 位置 (0-1)
 * @param {number} fov - 视场角 (度)
 * @param {number} imageWidth - 图像宽度 (像素)
 * @param {number} imageHeight - 图像高度 (像素)
 * @returns {Object} 黄斑位置 {maculaX, maculaY}
 */
export function calculateMaculaFromDisc(discX, discY, fov = 200, imageWidth = 2000, imageHeight = 2000) {
  // 每像素对应的角度
  const degPerPixel = fov / Math.max(imageWidth, imageHeight);
  
  // 视盘到黄斑的角度 (度)
  const horizontalAngle = ANATOMY.discToMaculaAngle;      // 黄斑在视盘颞侧
  const verticalAngle = ANATOMY.discToMaculaVertical;     // 黄斑在视盘下方
  
  // 转换为像素偏移
  const pixelOffsetX = horizontalAngle / degPerPixel;  // 颞侧 = 图像右侧 = x 增加
  const pixelOffsetY = verticalAngle / degPerPixel;    // 下方 = 图像下方 = y 增加
  
  // 归一化偏移
  const offsetX = pixelOffsetX / imageWidth;
  const offsetY = pixelOffsetY / imageHeight;
  
  // 计算黄斑位置
  const maculaX = discX + offsetX;
  const maculaY = discY + offsetY;
  
  return {
    maculaX: Math.max(0, Math.min(1, maculaX)),
    maculaY: Math.max(0, Math.min(1, maculaY)),
    pixelOffset: { x: pixelOffsetX, y: pixelOffsetY },
    angleOffset: { horizontal: horizontalAngle, vertical: verticalAngle }
  };
}

/**
 * 将 2D 图像映射到 3D 球面数据
 * @param {HTMLImageElement} image - 输入图像
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} fov - 视场角 (度)
 * @param {Object} options - 可选参数
 * @param {number} options.maculaX - 黄斑 x 位置 (0-1)
 * @param {number} options.maculaY - 黄斑 y 位置 (0-1)
 * @param {number} options.discX - 视盘 x 位置 (0-1), 用于校准
 * @param {number} options.discY - 视盘 y 位置 (0-1), 用于校准
 * @returns {Object} 3D 球面数据
 */
export function mapToSphere(image, axialLength = 24, fov = 200, options = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // 调整图像大小以提高性能
  const maxSize = 1024;
  let width = image.width;
  let height = image.height;
  
  if (width > maxSize || height > maxSize) {
    const scale = maxSize / Math.max(width, height);
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
  }
  
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);
  
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  
  // 确定黄斑位置
  let { maculaX = 0.5, maculaY = 0.5, discX, discY } = options;
  
  // 如果提供了视盘位置但未提供黄斑位置，则从视盘推算黄斑
  if (discX !== undefined && discY !== undefined && maculaX === 0.5 && maculaY === 0.5) {
    const calculated = calculateMaculaFromDisc(discX, discY, fov, width, height);
    maculaX = calculated.maculaX;
    maculaY = calculated.maculaY;
  }
  
  // 存储球面点数据
  const spherePoints = [];
  const imageAspect = image.width / image.height;
  
  // 采样步长
  const step = 4;
  
  for (let py = 0; py < height; py += step) {
    for (let px = 0; px < width; px += step) {
      const x = px / width;
      const y = py / height;
      
      // 获取像素颜色
      const idx = (py * width + px) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];
      
      // 跳过透明像素
      if (a < 128) continue;
      
      // 跳过黑色背景（视网膜图像通常有黑色背景）
      if (r < 20 && g < 20 && b < 20) continue;
      
      // 转换为球面坐标
      const sphereCoord = imageToSphere(x, y, axialLength, fov, { maculaX, maculaY, imageAspect });
      
      // 只保留有效视场内的点
      if (!sphereCoord.isValid) continue;
      
      spherePoints.push({
        x: sphereCoord.x,
        y: sphereCoord.y,
        z: sphereCoord.z,
        theta: sphereCoord.theta,
        phi: sphereCoord.phi,
        color: { r, g, b, a },
        imageX: x,
        imageY: y
      });
    }
  }
  
  const params = calculateRetinalParameters(axialLength, fov, width);
  
  return {
    points: spherePoints,
    width,
    height,
    params,
    maculaPosition: { x: maculaX, y: maculaY },
    discPosition: discX !== undefined ? { x: discX, y: discY } : null,
    pointCount: spherePoints.length
  };
}

/**
 * 计算两个球面点之间的角度距离
 * @param {Object} p1 - 点1 {theta, phi}
 * @param {Object} p2 - 点2 {theta, phi}
 * @returns {number} 角度距离 (度)
 */
export function angularDistance(p1, p2) {
  // 使用球面余弦定理
  const cosDist = Math.sin(p1.theta) * Math.sin(p2.theta) * 
                  Math.cos(p1.phi - p2.phi) + 
                  Math.cos(p1.theta) * Math.cos(p2.theta);
  // 处理数值精度问题
  const clampedCos = Math.max(-1, Math.min(1, cosDist));
  return Math.acos(clampedCos) * (180 / Math.PI);
}

/**
 * 在球面上查找指定角度位置的点
 * @param {Array} points - 球面点数组
 * @param {number} targetTheta - 目标极角 (弧度)
 * @param {number} targetPhi - 目标方位角 (弧度)
 * @param {number} tolerance - 容差 (度)
 * @returns {Object|null} 最近的点或 null
 */
export function findPointAtAngle(points, targetTheta, targetPhi, tolerance = 5) {
  let closest = null;
  let minDist = Infinity;
  
  for (const point of points) {
    const dist = angularDistance(
      { theta: targetTheta, phi: targetPhi },
      { theta: point.theta, phi: point.phi }
    );
    
    if (dist < minDist && dist < tolerance) {
      minDist = dist;
      closest = point;
    }
  }
  
  return closest;
}

/**
 * 获取解剖学参考数据
 * @returns {Object} 解剖学参数
 */
export function getAnatomyReference() {
  return { ...ANATOMY };
}

/**
 * 计算视盘在球面上的理论位置
 * 基于标准解剖学数据
 * 
 * @param {number} axialLength - 眼轴长度 (mm)
 * @returns {Object} 视盘球面坐标 {theta, phi, x, y, z}
 */
export function getTheoreticalDiscPosition(axialLength = 24) {
  const R = axialLength / 2;
  
  // 视盘相对于黄斑的角度
  const theta = ANATOMY.discToMaculaAngle * (Math.PI / 180);
  const phi = (90 + ANATOMY.discToMaculaVertical) * (Math.PI / 180); // 上方为正
  
  return {
    theta,
    phi,
    x: R * Math.sin(theta) * Math.cos(phi),
    y: R * Math.sin(theta) * Math.sin(phi),
    z: R * Math.cos(theta),
    angleFromMacula: ANATOMY.discToMaculaAngle,
    distanceFromMacula: ANATOMY.discToMaculaDistance
  };
}

/**
 * 计算裂孔到黄斑的距离
 * 
 * @param {number} imageX - 裂孔在图像中的 x 位置 (0-1)
 * @param {number} imageY - 裂孔在图像中的 y 位置 (0-1)
 * @param {Object} macula - 黄斑位置 {x, y} (0-1)
 * @param {Object} disc - 视盘位置 {x, y} (可选, 0-1), 用于校准
 * @param {Object} options - 可选参数
 * @param {number} options.axialLength - 眼轴长度 (mm), 默认 24
 * @param {number} options.fov - 视场角 (度), 默认 200
 * @param {number} options.imageAspect - 图像宽高比, 默认 1
 * @returns {Object} {distanceMm, angleDeg, theta, phi}
 */
export function calculateBreakToMacula(imageX, imageY, macula, disc, options = {}) {
  const { axialLength = 24, fov = 200, imageAspect = 1 } = options;
  
  const maculaX = macula?.x ?? 0.5;
  const maculaY = macula?.y ?? 0.5;
  
  // 计算裂孔到黄斑的图像坐标偏移
  const dx = (imageX - maculaX) * imageAspect;
  const dy = imageY - maculaY;
  
  // 归一化距离 (0-1)
  const r = Math.sqrt(dx * dx + dy * dy) * 2;
  
  // 方位角 (phi)
  const phi = Math.atan2(-dy, dx);
  
  // 视场角参数
  const maxAngle = fov / 2;
  
  let calibratedMaxAngle = maxAngle;
  
  // 如果提供了视盘位置，使用视盘-黄斑角度进行校准
  if (disc && disc.x !== undefined && disc.y !== undefined) {
    const discDx = (disc.x - maculaX) * imageAspect;
    const discDy = disc.y - maculaY;
    const discR = Math.sqrt(discDx * discDx + discDy * discDy) * 2;
    
    // 理论视盘-黄斑角度
    const theoreticalDiscAngle = ANATOMY.combinedDiscMaculaAngle;
    
    // 从图像中计算实际视盘-黄斑角度
    const actualDiscAngle = discR * maxAngle;
    
    // 校准因子
    if (actualDiscAngle > 0) {
      calibratedMaxAngle = (theoreticalDiscAngle / actualDiscAngle) * maxAngle;
    }
  }
  
  // 角度 theta (弧度)
  const angleDeg = r * calibratedMaxAngle;
  const theta = angleDeg * (Math.PI / 180);
  
  // 视网膜半径
  const R = axialLength / 2;
  
  // 弧长距离 (mm) = R * theta (弧度)
  const distanceMm = R * theta;
  
  return {
    distanceMm,
    angleDeg,
    theta,
    phi,
    phiDeg: phi * (180 / Math.PI),
    calibratedMaxAngle
  };
}

/**
 * 计算角膜缘到裂孔的弧长距离
 * 
 * @param {number} theta - 裂孔到黄斑的角度 (度)
 * @param {number} axialLength - 眼轴长度 (mm), 默认 24
 * @param {number} anteriorChamberDepth - 前房深度 (mm), 可选
 * @param {number} corneaDiameter - 角膜直径 WTW (mm), 可选
 * @returns {Object} { arcToMaculaMm, limbusToBreakMm, eyeGeometry }
 */
export function calculateLimbusDistance(theta, axialLength = 24, anteriorChamberDepth = null, corneaDiameter = null) {
  const eyeGeometry = calculateEyeGeometry(axialLength, anteriorChamberDepth, corneaDiameter);
  
  const R = eyeGeometry.retinalRadius;
  const arcToMaculaMm = R * theta * (Math.PI / 180);
  
  const limbusToBreakMm = eyeGeometry.limbusToMaculaArc - arcToMaculaMm;
  
  return {
    arcToMaculaMm,
    limbusToBreakMm,
    eyeGeometry
  };
}

/**
 * 将方位角转换为时钟位置
 * 
 * 手术定位用: 将裂孔位置转换为时钟位
 * 
 * @param {number} phi - 方位角 (弧度), φ=π/2 为上方, φ=-π/2 为下方
 * @param {string} eyeSide - 眼睛侧别: 'right' 或 'left'
 * @returns {string} 时钟位置, 如 "12:00", "3:00", "6:00", "9:00", "2:30" 等
 */
export function getClockHourPosition(phi, eyeSide = 'right') {
  let degrees = phi * (180 / Math.PI);
  degrees = ((degrees % 360) + 360) % 360;
  
  let clockAngle;
  if (eyeSide === 'right') {
    // 右眼: 图像右=鼻侧=9:00, 图像上=12:00, 图像左=颞侧=3:00
    // 公式: clockAngle = (270 + degrees) % 360
    clockAngle = (270 + degrees + 360) % 360;
  } else {
    // 左眼: 图像右=颞侧=3:00, 图像上=12:00, 图像左=鼻侧=9:00
    // 公式: clockAngle = (90 - degrees) % 360
    clockAngle = (90 - degrees + 360) % 360;
  }
  
  if (clockAngle < 0.5 || clockAngle > 359.5) {
    clockAngle = 0;
  }
  
  let hourFloat = clockAngle / 30;
  let hour = hourFloat === 0 ? 12 : Math.floor(hourFloat) % 12;
  if (hour === 0) hour = 12;
  
  const minutes = Math.floor((clockAngle % 30) / 30 * 60);
  
  return `${hour}:${minutes.toString().padStart(2, '0')}`;
}