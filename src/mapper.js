/**
 * 眼底球面映射算法
 * 将 2D SLO 图像映射到 3D 球面
 *
 * ============================================================================
 * 角度术语 —— 本文件中最容易出错的地方,请先读这里
 * ============================================================================
 *
 * 三种角度必须严格区分:
 *
 *   θ_v  视场角 / 视角 (field angle)
 *        在眼球结点(≈扫描枢轴)处张开的角。SLO 的"200° FOV"、
 *        "视盘位于黄斑鼻侧 17°" 这类文献数字都是这一种。
 *
 *   θ_r  视网膜球心角 (retinal central angle)
 *        在眼球球心处张开的角。弧长 = R·θ_r,所以只有这个角能换算成 mm。
 *
 *   ρ    图像上的归一化半径。ρ 与 θ_v 的关系由设备投影律决定(见 PROJECTION_LAWS)。
 *
 * 二者的关系(结点位于球心前方 d):
 *
 *        tan θ_v = R·sin θ_r / (d + R·cos θ_r)
 *
 * 可化简为闭式解(推导见 fieldToRetinalAngle):
 *
 *        θ_r = θ_v + arcsin(d·sin θ_v / R)
 *        θ_v = atan2(R·sin θ_r,  d + R·cos θ_r)
 *
 * 小角度下 θ_r ≈ θ_v·(R+d)/R ≈ 1.46·θ_v —— 对应临床常识
 * "1mm 视网膜 ≈ 3.45° 视角",而球心角是 4.77°。
 *
 * ============================================================================
 * 标定锚点
 * ============================================================================
 *
 * 标定使用盘-斑的**物理距离** 4.5mm(→ θ_r = 4.5/R),而不是角度。
 * 文献里的 17°/7.76°/18.7° 都是视角,直接当球心角用会带来约 20% 的系统偏差。
 *
 * ============================================================================
 * 坐标约定
 * ============================================================================
 *
 * - dist: 图像归一化距离,以黄斑为原点。标称视场边缘 dist = 0.5。
 *         (历史版本中 mapper 用 dist×2、visualize 用 dist,导致两者差 2 倍;
 *          现统一为 dist,并由 createProjectionModel 单一来源提供换算。)
 * - phi:  方位角,从图像右方起逆时针为正,图像上方 = +90°。
 * - 本模块笛卡尔约定:黄斑位于 z = +R。visualize.js 使用 z = -R(渲染朝向需要),
 *   两者仅差一个 z 轴翻转,角度量 (θ, φ) 完全一致。
 */

// 解剖学参考数据
export const ANATOMY = {
  // --- 标定锚点(唯一用于换算的量,单位 mm)---
  discToMaculaDistance: 4.5,  // 视盘到黄斑的视网膜面距离 (mm), 范围 4.0-5.0

  // --- 以下角度均为「视角 (field angle)」,仅供参考与方位推算,不可当球心角用 ---
  discToMaculaAngle: 17,         // 视盘位于黄斑鼻侧约 17° (视角)
  discToMaculaVertical: 7.76,    // 视盘位于黄斑上方约 7.76° (视角, disc-fovea angle)
  combinedDiscMaculaAngle: 18.7, // = √(17² + 7.76²), 视角

  // --- 眼球光学几何 ---
  nodalPointFromCornea: 7.2,  // 第二结点距角膜顶点 (mm)。前节在近视中基本不延长,
                              // 故按定值处理;眼轴变化只改变球心位置。
  angleAlpha: 5,              // 中心凹位于光轴颞侧约 5° (angle alpha, 球心角近似)

  // --- 角膜参数 ---
  corneaDiameter: 11.7,       // 角膜直径 WTW (mm), 水平11.7mm, 垂直10.6mm, 范围 10.5-12.5mm
  corneaRadius: 7.8,          // 角膜曲率半径 K值 (mm), 范围 7.0-8.5mm
  corneaThickness: 0.5,       // 角膜中央厚度 (mm), 约 0.5mm

  // --- 巩膜 ---
  scleraThickness: 0.6,       // 巩膜代表厚度 (mm)。赤道 ~0.6, 肌止端后最薄 ~0.4, 后极 ~1.0。
                              // 用于把视网膜内表面弧长换算为术中卡尺测量的外表面弧长。

  // 视盘大小 (变异大，仅供参考)
  discHorizontalDiameter: 1.79, // mm, 范围 0.91-2.76
  discVerticalDiameter: 1.97    // mm, 范围 1.08-2.76
};

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 设备投影律: 图像归一化半径 ρ ↔ 视场角 θ_v
 *
 * ⚠️ 重要: Optos 原始图像的投影律**没有公开的闭式表达**。
 * 文献中的 "stereographic projection" 指的是 Optos 校正后**输出**的格式,
 * 而不是原始图像的规律。不同候选律给出的中心/周边面积比差异很大:
 *
 *   equidistant (视角)    ≈ 2.4×    ← 默认。扫描振镜按角度匀速扫描,物理上最合理
 *   stereographic (视角)  ≈ 4.3×
 *   equidistant (球心角)  ≈ 1.8×    ← 旧版本的隐含假设 (legacyRetinal)
 *
 * Croft 2014 (PMID 25037013) 实测未校正图像中心/周边面积比约 1.79×。
 *
 * 因此这里把投影律做成**可切换参数**。要得到真正可靠的结果,应当用模型眼
 * 标定 ρ↔θ_r 的经验曲线来替换本表(见 README「标定」一节)。
 *
 * radius(θ_v) → 约化半径;  angle(ρ) → θ_v。二者互为反函数。
 */
export const PROJECTION_LAWS = {
  equidistant: {
    label: '等距 (ρ ∝ θ)',
    radius: (t) => t,
    angle: (r) => r
  },
  stereographic: {
    label: '立体投影 (ρ ∝ tan(θ/2))',
    radius: (t) => 2 * Math.tan(t / 2),
    angle: (r) => 2 * Math.atan(r / 2)
  },
  equisolid: {
    label: '等立体角 (ρ ∝ sin(θ/2))',
    radius: (t) => 2 * Math.sin(t / 2),
    angle: (r) => 2 * Math.asin(clamp(r / 2, -1, 1))
  }
  // 注: 正交投影 (ρ ∝ sinθ) 未列入 —— 它在 θ>90° 处不可逆(sin 折返),
  // 无法表达 200° 视场, 用于 UWF 会把最周边一圈错误地折回中心侧。
};

export const DEFAULT_PROJECTION = 'equidistant';

function getLaw(name) {
  return PROJECTION_LAWS[name] || PROJECTION_LAWS[DEFAULT_PROJECTION];
}

/**
 * 视场角 → 视网膜球心角
 *
 * 推导: 设球心为原点, 结点在 z = +d, 视网膜点 P 在球心角 θ_r 处。
 *   tan θ_v = R·sin θ_r / (d + R·cos θ_r)
 * 两边乘分母并利用 R·sinθ_r - tanθ_v·R·cosθ_r = (R/cosθ_v)·sin(θ_r - θ_v):
 *   d·tan θ_v = (R/cos θ_v)·sin(θ_r - θ_v)
 *   sin(θ_r - θ_v) = d·sin θ_v / R
 * 因 d < R, 反正弦恒有解。
 *
 * @param {number} thetaV - 视场角 (弧度)
 * @param {number} R - 视网膜半径 (mm)
 * @param {number} d - 结点到球心的距离 (mm), 结点在球心前方为正
 * @returns {number} 视网膜球心角 (弧度)
 */
export function fieldToRetinalAngle(thetaV, R, d) {
  return thetaV + Math.asin(clamp((d * Math.sin(thetaV)) / R, -1, 1));
}

/**
 * 视网膜球心角 → 视场角 (fieldToRetinalAngle 的反函数)
 *
 * @param {number} thetaR - 视网膜球心角 (弧度)
 * @param {number} R - 视网膜半径 (mm)
 * @param {number} d - 结点到球心的距离 (mm)
 * @returns {number} 视场角 (弧度)
 */
export function retinalToFieldAngle(thetaR, R, d) {
  return Math.atan2(R * Math.sin(thetaR), d + R * Math.cos(thetaR));
}

/**
 * 计算眼球几何参数
 * 根据眼轴长度、角膜直径和角膜曲率计算眼球形状参数
 *
 * ⚠️ 模型限制: 这里把视网膜当作**正球面**。Atchison 2005 (PMID 16043841) MRI 实测
 * 显示正视眼视网膜实为**扁椭球 (oblate)**,近视加深时逐渐趋于正球(约 -7~-8D 时接近);
 * 且椭球中心相对中心凹鼻侧偏心 0.5mm、绕垂直轴倾斜 11°。
 * 因此本球模型对正视眼会**低估**周边弧长,对高度近视反而更接近。
 *
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} corneaDiameter - 角膜直径 WTW (mm)
 * @param {number} corneaKValue - 角膜曲率半径 K值 (mm), 可选
 * @returns {Object} 眼球几何参数
 */
export function calculateEyeGeometry(axialLength = 24, corneaDiameter = null, corneaKValue = null) {
  const wtw = corneaDiameter ?? ANATOMY.corneaDiameter;
  const kValue = corneaKValue ?? ANATOMY.corneaRadius;

  const corneaSag = calculateCorneaSag(wtw, kValue);

  const halfWtw = wtw / 2;
  const rightSide = axialLength - corneaSag;
  const scleralRadius = (rightSide * rightSide + halfWtw * halfWtw) / (2 * rightSide);

  // 球心到角膜顶点的距离
  const sphereCenterFromCornea = axialLength - scleralRadius;

  // 结点到球心的距离 d。夹到 [0, 0.95R] 以保证 fieldToRetinalAngle 的反正弦有解,
  // 并避免异常生物测量参数(极短眼)导致结点落到球心后方。
  const nodalOffset = clamp(
    sphereCenterFromCornea - ANATOMY.nodalPointFromCornea,
    0,
    scleralRadius * 0.95
  );

  // 角膜缘相对后极(沿光轴)的球心角
  const zAtLimbus = Math.sqrt(Math.max(0, scleralRadius * scleralRadius - halfWtw * halfWtw));
  const limbusPolarAngle = Math.acos(clamp(-zAtLimbus / scleralRadius, -1, 1));

  // 角膜缘到后极(光轴极点)的弧长。注意:中心凹并不在光轴极点上,
  // 相差 angle alpha ≈ 5°,该修正在 calculateLimbusDistance 中处理。
  const limbusToPoleArc = scleralRadius * limbusPolarAngle;

  return {
    axialLength,
    corneaSag,
    retinalRadius: scleralRadius,
    sphereCenterFromCornea,
    nodalOffset,                 // d
    nodalToRetina: scleralRadius + nodalOffset,
    limbusPolarAngle,            // 弧度, 自后极量起
    limbusToPoleArc,
    limbusToMaculaArc: limbusToPoleArc, // 兼容旧名;严格说是「到光轴极点」
    corneaDiameter: wtw,
    corneaRadius: kValue,
    corneaThickness: ANATOMY.corneaThickness,
    scleraThickness: ANATOMY.scleraThickness
  };
}

function calculateCorneaSag(corneaDiameter, corneaRadius) {
  const r = corneaRadius;
  const halfD = corneaDiameter / 2;

  if (halfD >= r) {
    return r;
  }

  return r - Math.sqrt(r * r - halfD * halfD);
}

/**
 * 构建投影模型 —— 图像归一化距离 ↔ 角度 的**唯一换算入口**
 *
 * mapper 与 visualize 都必须经由此函数,以保证两者一致。
 *
 * 尺度 k 的确定:
 *   - 已标注视盘: 用盘-斑物理距离 4.5mm 反推其视角,锚定 k(推荐)
 *   - 未标注视盘: 用标称 FOV,令 dist = 0.5 处 θ_v = fov/2
 *
 * @param {Object} options
 * @param {number} options.axialLength - 眼轴长度 (mm)
 * @param {number} options.fov - 标称视场角 (度, 视角)
 * @param {number} options.corneaDiameter - 角膜直径 (mm)
 * @param {number} options.corneaKValue - 角膜曲率半径 (mm)
 * @param {string} options.projection - 投影律名, 见 PROJECTION_LAWS
 * @param {number} options.maculaX/maculaY - 黄斑归一化位置
 * @param {number} options.discX/discY - 视盘归一化位置 (可选, 用于标定)
 * @param {number} options.imageAspect - 图像宽高比
 * @returns {Object} 模型对象
 */
export function createProjectionModel(options = {}) {
  const {
    axialLength = 24,
    fov = 200,
    corneaDiameter = null,
    corneaKValue = null,
    projection = DEFAULT_PROJECTION,
    maculaX = 0.5,
    maculaY = 0.5,
    discX = null,
    discY = null,
    imageAspect = 1
  } = options;

  const eyeGeometry = calculateEyeGeometry(axialLength, corneaDiameter, corneaKValue);
  const R = eyeGeometry.retinalRadius;
  const d = eyeGeometry.nodalOffset;
  const law = getLaw(projection);

  const maxFieldAngle = (fov / 2) * DEG;

  // 尺度 k: 约化半径 ρ = k · dist
  let k;
  let calibration;

  const hasDisc = discX !== null && discX !== undefined && discY !== null && discY !== undefined;
  let discDist = 0;
  if (hasDisc) {
    const ddx = (discX - maculaX) * imageAspect;
    const ddy = discY - maculaY;
    discDist = Math.sqrt(ddx * ddx + ddy * ddy);
  }

  if (hasDisc && discDist > 1e-6) {
    // 物理锚点: 盘-斑 4.5mm → 球心角 → 视角
    const discRetinalAngle = ANATOMY.discToMaculaDistance / R;
    const discFieldAngle = retinalToFieldAngle(discRetinalAngle, R, d);
    k = law.radius(discFieldAngle) / discDist;
    calibration = {
      method: 'disc',
      discDist,
      discRetinalAngleDeg: discRetinalAngle * RAD,
      discFieldAngleDeg: discFieldAngle * RAD
    };
  } else {
    // 退化: 用标称 FOV, dist = 0.5 处为视场边缘
    k = law.radius(maxFieldAngle) / 0.5;
    calibration = { method: 'fov', discDist: 0 };
  }

  /** 归一化图像距离 → 视场角 (弧度) */
  function fieldAngleAt(dist) {
    return law.angle(k * dist);
  }

  /** 归一化图像距离 → 视网膜球心角 (弧度) */
  function retinalAngleAt(dist) {
    return fieldToRetinalAngle(fieldAngleAt(dist), R, d);
  }

  /** 视网膜球心角 → 归一化图像距离 */
  function distAtRetinalAngle(thetaR) {
    return law.radius(retinalToFieldAngle(thetaR, R, d)) / k;
  }

  // 标称视场边缘对应的图像距离与球心角
  const maxDist = law.radius(maxFieldAngle) / k;
  const maxRetinalAngle = fieldToRetinalAngle(maxFieldAngle, R, d);

  return {
    eyeGeometry,
    R,
    nodalOffset: d,
    projection: PROJECTION_LAWS[projection] ? projection : DEFAULT_PROJECTION,
    law,
    scale: k,
    calibration,
    maxFieldAngle,
    maxRetinalAngle,
    maxDist,
    imageAspect,
    maculaX,
    maculaY,
    fieldAngleAt,
    retinalAngleAt,
    distAtRetinalAngle,
    /** 视网膜覆盖比例 (0-1), 用于判断模型是否合理 */
    retinalCoverage: (1 - Math.cos(Math.min(Math.PI, maxRetinalAngle))) / 2
  };
}

/**
 * 计算视网膜参数
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} fov - 视场角 (度, 视角)
 * @param {number} imageWidth - 图像宽度 (像素), 用于计算分辨率
 * @returns {Object} 视网膜参数
 */
export function calculateRetinalParameters(axialLength = 24, fov = 200, imageWidth = 2000, options = {}) {
  const model = createProjectionModel({ axialLength, fov, ...options });
  const retinalRadius = model.R;

  // 全视场对应的视网膜弧长(经结点角转换,不再直接用 R·fovRad)
  const retinalArc = retinalRadius * model.maxRetinalAngle * 2;

  const degPerPixel = fov / imageWidth;           // 视场度/像素
  const mmPerPixel = retinalArc / imageWidth;     // mm/像素 (全场平均值)

  // 中心处的局部尺度 —— 比全场平均值更有意义。
  // 注意方向: 中心像素代表的视网膜面积**大于**周边像素(周边在图像上被放大),
  // 与 Croft 2014 "后极像素面积比周边大 79%" 一致。故 mmPerPixelCenter > mmPerPixel。
  const probe = 1e-4;
  const mmPerNormalizedUnit = (retinalRadius * model.retinalAngleAt(probe)) / probe;
  const mmPerPixelCenter = mmPerNormalizedUnit / imageWidth;

  return {
    axialLength,
    retinalRadius,
    fov,
    imageWidth,
    degPerPixel,
    mmPerPixel,
    mmPerPixelCenter,
    retinalArc,
    maxRetinalAngleDeg: model.maxRetinalAngle * RAD,
    retinalCoverage: model.retinalCoverage,
    degPerMm: RAD / retinalRadius
  };
}

/**
 * 将图像坐标转换为球面坐标
 *
 * @param {number} x - 图像 x 坐标 (0-1 归一化)
 * @param {number} y - 图像 y 坐标 (0-1 归一化)
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} fov - 视场角 (度)
 * @param {Object} options - 见 createProjectionModel;也可直接传入 options.model 复用模型
 * @returns {Object} 球面坐标 {theta, phi, x, y, z}
 */
export function imageToSphere(x, y, axialLength = 24, fov = 200, options = {}) {
  const model = options.model || createProjectionModel({ axialLength, fov, ...options });
  const { maculaX, maculaY, imageAspect } = model;

  const dx = (x - maculaX) * imageAspect;
  const dy = y - maculaY;

  // 归一化距离: 标称视场边缘为 model.maxDist (FOV 标定时 = 0.5)
  const dist = Math.sqrt(dx * dx + dy * dy);

  const theta = model.retinalAngleAt(dist);
  const fieldAngle = model.fieldAngleAt(dist);

  // 方位角: 图像 y 轴向下, 取负号使上方为正
  const phi = Math.atan2(-dy, dx);

  const R = model.R;

  // 黄斑在 z = +R
  const sphereX = R * Math.sin(theta) * Math.cos(phi);
  const sphereY = R * Math.sin(theta) * Math.sin(phi);
  const sphereZ = R * Math.cos(theta);

  return {
    theta,                      // 视网膜球心角 (弧度)
    phi,                        // 方位角 (弧度)
    fieldAngle,                 // 视场角 (弧度)
    x: sphereX,
    y: sphereY,
    z: sphereZ,
    dist,                       // 归一化图像距离
    r: model.maxDist > 0 ? dist / model.maxDist : 0, // 相对视场边缘的比例
    angleDeg: theta * RAD,      // 球心角 (度)
    fieldAngleDeg: fieldAngle * RAD,
    arcFromMaculaMm: R * theta,
    isValid: dist <= model.maxDist + 1e-9
  };
}

/**
 * 从视盘位置计算黄斑位置
 *
 * 解剖学关系(视角): 黄斑位于视盘颞侧约 17°、下方约 7.76°。
 *
 * ⚠️ 眼别决定颞侧在图像的哪一边:
 *   - 右眼 (OD): 视盘在鼻侧 = 图像右 ⇒ 黄斑在视盘**左**方
 *   - 左眼 (OS): 视盘在鼻侧 = 图像左 ⇒ 黄斑在视盘**右**方
 *
 * @param {number} discX - 视盘在图像中的 x 位置 (0-1)
 * @param {number} discY - 视盘在图像中的 y 位置 (0-1)
 * @param {number} fov - 视场角 (度)
 * @param {number} imageWidth - 图像宽度 (像素)
 * @param {number} imageHeight - 图像高度 (像素)
 * @param {string} eyeSide - 'right' (OD) 或 'left' (OS)
 * @returns {Object} 黄斑位置 {maculaX, maculaY}
 */
export function calculateMaculaFromDisc(
  discX,
  discY,
  fov = 200,
  imageWidth = 2000,
  imageHeight = 2000,
  eyeSide = 'right',
  options = {}
) {
  const imageAspect = imageWidth / imageHeight;
  const model = createProjectionModel({ fov, imageAspect, ...options });

  const horizontalAngle = ANATOMY.discToMaculaAngle;   // 视角, 颞侧
  const verticalAngle = ANATOMY.discToMaculaVertical;  // 视角, 下方
  const totalFieldAngle = Math.sqrt(horizontalAngle * horizontalAngle + verticalAngle * verticalAngle) * DEG;

  // 该视角对应的归一化图像距离
  const dist = model.law.radius(totalFieldAngle) / model.scale;

  // 方向单位向量 (图像坐标系, y 向下)
  const len = Math.sqrt(horizontalAngle * horizontalAngle + verticalAngle * verticalAngle);
  const temporalSign = eyeSide === 'right' ? -1 : 1; // 右眼颞侧 = 图像左
  const ux = (temporalSign * horizontalAngle) / len;
  const uy = verticalAngle / len; // 黄斑在视盘下方 = 图像 y 增大

  // dx 在球面计算中乘过 imageAspect, 这里反向除回图像坐标
  const offsetX = (dist * ux) / imageAspect;
  const offsetY = dist * uy;

  const maculaX = discX + offsetX;
  const maculaY = discY + offsetY;

  return {
    maculaX: clamp(maculaX, 0, 1),
    maculaY: clamp(maculaY, 0, 1),
    eyeSide,
    normalizedOffset: { x: offsetX, y: offsetY },
    angleOffset: { horizontal: horizontalAngle, vertical: verticalAngle, total: totalFieldAngle * RAD }
  };
}

/**
 * 将 2D 图像映射到 3D 球面数据
 * @param {HTMLImageElement} image - 输入图像
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} fov - 视场角 (度)
 * @param {Object} options - 可选参数, 见 createProjectionModel
 * @returns {Object} 3D 球面数据
 */
export function mapToSphere(image, axialLength = 24, fov = 200, options = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

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

  let { maculaX = 0.5, maculaY = 0.5, discX, discY, eyeSide = 'right' } = options;

  // 提供了视盘但未提供黄斑 → 由视盘推算黄斑
  if (discX !== undefined && discY !== undefined && maculaX === 0.5 && maculaY === 0.5) {
    const calculated = calculateMaculaFromDisc(discX, discY, fov, width, height, eyeSide);
    maculaX = calculated.maculaX;
    maculaY = calculated.maculaY;
  }

  const imageAspect = image.width / image.height;

  // 整图共用一个模型
  const model = createProjectionModel({
    ...options,
    axialLength,
    fov,
    maculaX,
    maculaY,
    discX: discX ?? null,
    discY: discY ?? null,
    imageAspect
  });

  const spherePoints = [];
  const step = 4;

  for (let py = 0; py < height; py += step) {
    for (let px = 0; px < width; px += step) {
      const x = px / width;
      const y = py / height;

      const idx = (py * width + px) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      if (a < 128) continue;
      if (r < 20 && g < 20 && b < 20) continue;

      const sphereCoord = imageToSphere(x, y, axialLength, fov, { model });

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
    model,
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
  const cosDist =
    Math.sin(p1.theta) * Math.sin(p2.theta) * Math.cos(p1.phi - p2.phi) +
    Math.cos(p1.theta) * Math.cos(p2.theta);
  const clampedCos = clamp(cosDist, -1, 1);
  return Math.acos(clampedCos) * RAD;
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
 *
 * θ 由物理距离 4.5mm 得出(球心角), φ 由 17°/7.76° 两个视角分量的方向得出。
 * 右眼鼻侧 = 图像右 (φ≈+24.5°); 左眼鼻侧 = 图像左 (φ≈+155.5°)。
 *
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {string} eyeSide - 'right' 或 'left'
 * @returns {Object} 视盘球面坐标 {theta, phi, x, y, z}
 */
export function getTheoreticalDiscPosition(axialLength = 24, eyeSide = 'right') {
  const geometry = calculateEyeGeometry(axialLength);
  const R = geometry.retinalRadius;

  // 球心角由物理距离决定
  const theta = ANATOMY.discToMaculaDistance / R;

  // 方位: 鼻侧水平分量 + 上方垂直分量
  const nasalSign = eyeSide === 'right' ? 1 : -1; // 右眼鼻侧 = 图像右 = φ 0°
  const phi = Math.atan2(ANATOMY.discToMaculaVertical, nasalSign * ANATOMY.discToMaculaAngle);

  return {
    theta,
    phi,
    x: R * Math.sin(theta) * Math.cos(phi),
    y: R * Math.sin(theta) * Math.sin(phi),
    z: R * Math.cos(theta),
    eyeSide,
    angleFromMacula: theta * RAD,
    fieldAngleFromMacula: retinalToFieldAngle(theta, R, geometry.nodalOffset) * RAD,
    distanceFromMacula: ANATOMY.discToMaculaDistance
  };
}

/**
 * 计算裂孔到黄斑的距离
 *
 * @param {number} imageX - 裂孔在图像中的 x 位置 (0-1)
 * @param {number} imageY - 裂孔在图像中的 y 位置 (0-1)
 * @param {Object} macula - 黄斑位置 {x, y} (0-1)
 * @param {Object} disc - 视盘位置 {x, y} (可选, 0-1), 用于标定
 * @param {Object} options - 见 createProjectionModel
 * @returns {Object} {distanceMm, angleDeg, theta, phi, ...}
 */
export function calculateBreakToMacula(imageX, imageY, macula, disc, options = {}) {
  const {
    axialLength = 24,
    fov = 200,
    imageAspect = 1,
    corneaDiameter = null,
    corneaKValue = null,
    projection = DEFAULT_PROJECTION
  } = options;

  const maculaX = macula?.x ?? 0.5;
  const maculaY = macula?.y ?? 0.5;

  const hasDisc = disc && disc.x !== undefined && disc.y !== undefined;

  const model = createProjectionModel({
    axialLength,
    fov,
    corneaDiameter,
    corneaKValue,
    projection,
    maculaX,
    maculaY,
    discX: hasDisc ? disc.x : null,
    discY: hasDisc ? disc.y : null,
    imageAspect
  });

  const dx = (imageX - maculaX) * imageAspect;
  const dy = imageY - maculaY;

  const dist = Math.sqrt(dx * dx + dy * dy);
  const phi = Math.atan2(-dy, dx);

  const theta = model.retinalAngleAt(dist);       // 球心角 (弧度)
  const fieldAngle = model.fieldAngleAt(dist);    // 视场角 (弧度)
  const angleDeg = theta * RAD;

  const distanceMm = model.R * theta;

  return {
    distanceMm,
    angleDeg,                          // 球心角 (度) —— 传给 calculateLimbusDistance 的就是它
    theta,
    fieldAngle,
    fieldAngleDeg: fieldAngle * RAD,
    phi,
    phiDeg: phi * RAD,
    dist,
    isBeyondNominalField: dist > model.maxDist,
    calibration: model.calibration,
    projection: model.projection,
    model
  };
}

/**
 * 计算角膜缘到裂孔的弧长距离
 *
 * 两项修正(相对早期版本):
 *
 * 1. angle alpha —— 中心凹并不在角膜缘圆的极点上,而在光轴颞侧约 5°。
 *    角膜缘圆是绕**光轴**的等纬圆,所以必须先把裂孔的角度换算到以光轴极点为基准:
 *      cos θ_opt = cos α·cos θ + sin α·sin θ·cos(φ - φ_nasal)
 *    (球面余弦定理; φ_nasal 为从黄斑指向光轴极点的方位, 即鼻侧方向)
 *    未提供 phiDeg 时退化为 α = 0(旧行为)。
 *
 * 2. 内/外表面 —— 术中卡尺沿**巩膜外表面**测量,半径为 R + 巩膜厚度。
 *    在 20mm 弧长上两者相差约 1mm 以上,故两个数都输出。
 *
 * ⚠️ 仍未建模: 角膜与前部巩膜并不落在同一球面上,因此靠近角膜缘处仍有高估。
 *
 * @param {number} thetaDeg - 裂孔到黄斑的**球心角** (度)
 * @param {number} axialLength - 眼轴长度 (mm)
 * @param {number} corneaDiameter - 角膜直径 WTW (mm), 可选
 * @param {number} corneaKValue - 角膜曲率半径 (mm), 可选
 * @param {Object} options - {phiDeg, eyeSide, angleAlpha}
 * @returns {Object}
 */
export function calculateLimbusDistance(
  thetaDeg,
  axialLength = 24,
  corneaDiameter = null,
  corneaKValue = null,
  options = {}
) {
  const { phiDeg = null, eyeSide = 'right', angleAlpha = ANATOMY.angleAlpha } = options;

  const eyeGeometry = calculateEyeGeometry(axialLength, corneaDiameter, corneaKValue);

  const R = eyeGeometry.retinalRadius;
  const theta = thetaDeg * DEG;
  const arcToMaculaMm = R * theta;

  // --- angle alpha 子午线修正 ---
  let thetaFromOpticalAxis = theta;
  let alphaApplied = 0;

  if (phiDeg !== null && phiDeg !== undefined && angleAlpha) {
    const alpha = angleAlpha * DEG;
    // 中心凹在光轴颞侧 ⇒ 从黄斑看,光轴极点在**鼻侧**方向
    // 右眼鼻侧 = 图像右 = φ 0°; 左眼鼻侧 = 图像左 = φ 180°
    const phiNasal = eyeSide === 'right' ? 0 : Math.PI;
    const phi = phiDeg * DEG;

    const cosThetaOpt =
      Math.cos(alpha) * Math.cos(theta) +
      Math.sin(alpha) * Math.sin(theta) * Math.cos(phi - phiNasal);

    thetaFromOpticalAxis = Math.acos(clamp(cosThetaOpt, -1, 1));
    alphaApplied = angleAlpha;
  }

  // 角膜缘位于绕光轴的等纬圆上, 球心角为 limbusPolarAngle
  const deltaTheta = eyeGeometry.limbusPolarAngle - thetaFromOpticalAxis;

  const limbusToBreakMm = R * deltaTheta;
  const limbusToBreakExternalMm = (R + eyeGeometry.scleraThickness) * deltaTheta;

  return {
    arcToMaculaMm,
    limbusToBreakMm,               // 视网膜内表面弧长
    limbusToBreakExternalMm,       // 巩膜外表面弧长 (术中卡尺对应值)
    thetaFromOpticalAxisDeg: thetaFromOpticalAxis * RAD,
    alphaApplied,
    eyeGeometry
  };
}

/**
 * 将方位角转换为时钟位置
 *
 * ⚠️ 眼别**不影响**钟点。
 * 标准方位的眼底图像本身已经是「从正面看眼球」的方向:图像上方 = 上方视网膜 = 12 点,
 * 图像右方 = 3 点。这对左右眼都成立 ——
 *   右眼: 视盘(鼻侧)在图像右,而右眼鼻侧正是 3 点  ✓
 *   左眼: 视盘(鼻侧)在图像左,而左眼鼻侧正是 9 点  ✓
 * 眼别只影响「鼻侧/颞侧」的**命名**,不影响钟点数值。
 *
 * 因此钟点角(自 12 点顺时针) = 90° - φ,两眼统一。
 * (早期版本对右眼额外做了一次镜像,导致右眼钟点全部报到对侧子午线。)
 *
 * @param {number} phi - 方位角 (弧度), φ=0 为图像右方, φ=π/2 为图像上方
 * @param {string} eyeSide - 保留参数,仅为 API 兼容;不影响返回值
 * @returns {string} 时钟位置, 如 "12:00", "3:00", "2:30"
 */
export function getClockHourPosition(phi, eyeSide = 'right') {
  const degrees = phi * RAD;

  let clockAngle = ((90 - degrees) % 360 + 360) % 360;

  if (clockAngle < 0.5 || clockAngle > 359.5) {
    clockAngle = 0;
  }

  const hourFloat = clockAngle / 30;
  let hour = hourFloat === 0 ? 12 : Math.floor(hourFloat) % 12;
  if (hour === 0) hour = 12;

  const minutes = Math.floor(((clockAngle % 30) / 30) * 60);

  return `${hour}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * 判断眼别: 视盘位于黄斑鼻侧
 * @param {Object} macula - {x, y}
 * @param {Object} disc - {x, y}
 * @returns {string|null} 'right' | 'left' | null(无法判断)
 */
export function detectEyeSide(macula, disc) {
  if (!macula || !disc) return null;
  const dx = disc.x - macula.x;
  if (Math.abs(dx) < 0.05) return null;
  // 视盘在黄斑右侧 ⇒ 鼻侧在图像右 ⇒ 右眼
  return dx > 0 ? 'right' : 'left';
}
