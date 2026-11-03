import { describe, it, expect } from 'vitest';
import {
  ANATOMY,
  PROJECTION_LAWS,
  calculateRetinalParameters,
  calculateEyeGeometry,
  meridianArcLength,
  meridianThetaFromArc,
  retinalSemiAxes,
  createProjectionModel,
  fieldToRetinalAngle,
  retinalToFieldAngle,
  imageToSphere,
  calculateMaculaFromDisc,
  angularDistance,
  findPointAtAngle,
  getAnatomyReference,
  getTheoreticalDiscPosition,
  calculateBreakToMacula,
  calculateLimbusDistance,
  getClockHourPosition,
  detectEyeSide
} from '../mapper.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

describe('fieldToRetinalAngle / retinalToFieldAngle', () => {
  const R = 11.5;
  const d = 5.2;

  it('maps 0 to 0', () => {
    expect(fieldToRetinalAngle(0, R, d)).toBe(0);
    expect(retinalToFieldAngle(0, R, d)).toBe(0);
  });

  it('satisfies the defining relation tan(θv) = R·sinθr / (d + R·cosθr)', () => {
    for (const thetaRDeg of [10, 30, 60, 90, 120]) {
      const thetaR = thetaRDeg * DEG;
      const thetaV = retinalToFieldAngle(thetaR, R, d);
      const expected = (R * Math.sin(thetaR)) / (d + R * Math.cos(thetaR));
      expect(Math.tan(thetaV)).toBeCloseTo(expected, 9);
    }
  });

  it('is a true inverse pair', () => {
    for (const deg of [5, 25, 50, 100, 124]) {
      const thetaR = deg * DEG;
      const roundTrip = fieldToRetinalAngle(retinalToFieldAngle(thetaR, R, d), R, d);
      expect(roundTrip).toBeCloseTo(thetaR, 9);
    }
  });

  it('retinal angle exceeds field angle (nodal point is inside the globe)', () => {
    const thetaV = 50 * DEG;
    expect(fieldToRetinalAngle(thetaV, R, d)).toBeGreaterThan(thetaV);
  });

  it('small-angle ratio approaches (R+d)/R', () => {
    const tiny = 0.001;
    const ratio = fieldToRetinalAngle(tiny, R, d) / tiny;
    expect(ratio).toBeCloseTo((R + d) / R, 4);
  });

  it('degenerates to identity when the nodal point sits at the centre', () => {
    expect(fieldToRetinalAngle(0.7, R, 0)).toBeCloseTo(0.7, 12);
  });
});

describe('calculateEyeGeometry', () => {
  it('keeps the nodal offset strictly inside the globe', () => {
    for (const al of [20, 22, 24, 26, 30]) {
      const g = calculateEyeGeometry(al);
      expect(g.nodalOffset).toBeGreaterThanOrEqual(0);
      expect(g.nodalOffset).toBeLessThan(g.retinalRadius);
    }
  });

  it('places the limbus anterior to the equator (polar angle > 90°)', () => {
    const g = calculateEyeGeometry(24);
    expect(g.limbusPolarAngle * RAD).toBeGreaterThan(90);
  });

  it('grows the retinal radius with axial length', () => {
    expect(calculateEyeGeometry(26).retinalRadius).toBeGreaterThan(
      calculateEyeGeometry(24).retinalRadius
    );
  });

  it('reproduces the axial length from radius and corneal sag', () => {
    const g = calculateEyeGeometry(24);
    // 球心在角膜后 sphereCenterFromCornea, 后极再往后 R
    expect(g.sphereCenterFromCornea + g.retinalRadius).toBeCloseTo(24, 9);
  });
});

describe('PROJECTION_LAWS', () => {
  it('each law is invertible across the whole UWF range (up to a 100° half-field)', () => {
    for (const [name, law] of Object.entries(PROJECTION_LAWS)) {
      for (const deg of [1, 20, 60, 100]) {
        const t = deg * DEG;
        expect(law.angle(law.radius(t))).toBeCloseTo(t, 9);
      }
      expect(law.radius(0)).toBeCloseTo(0, 12);
      expect(name).toBeTruthy();
    }
  });
});

describe('createProjectionModel', () => {
  it('anchors on the 4.5mm disc-macula physical distance when disc is given', () => {
    const model = createProjectionModel({
      maculaX: 0.5, maculaY: 0.5, discX: 0.6, discY: 0.5
    });

    expect(model.calibration.method).toBe('disc');
    // 标定点处沿盘-斑子午线的椭球弧长必须等于 4.5mm
    const theta = model.retinalAngleAt(0.1);
    const arc = meridianArcLength(theta, model.semiAxes, model.calibration.anchorMeridianDeg);
    expect(arc).toBeCloseTo(ANATOMY.discToMaculaDistance, 6);
  });

  it('disc-anchored retinal angle is ~20.3° for a standard eye, not 18.7°', () => {
    // 椭球后极曲率半径 12.9mm > 等效球半径 11.48mm, 因此同样 4.5mm 对应的
    // 球心角比球模型 (22.5°) 小; 但仍明显大于 18.7° 这个**视角**值。
    const model = createProjectionModel({ maculaX: 0.5, maculaY: 0.5, discX: 0.6, discY: 0.5 });
    const deg = model.calibration.discRetinalAngleDeg;
    expect(deg).toBeGreaterThan(19.5);
    expect(deg).toBeLessThan(21);
    // 该球心角对应的视角明显更小
    expect(model.calibration.discFieldAngleDeg).toBeLessThan(deg);
  });

  it('falls back to nominal FOV without a disc, with field edge at dist=0.5 (θ_r = fov/2)', () => {
    const model = createProjectionModel({ fov: 200 });
    expect(model.calibration.method).toBe('fov');
    expect(model.maxDist).toBeCloseTo(0.5, 9);
    // P1: fov 按球心角解释 —— 视场边缘的球心角恰为 fov/2
    expect(model.retinalAngleAt(0.5) * RAD).toBeCloseTo(100, 9);
    expect(model.maxRetinalAngle * RAD).toBeCloseTo(100, 9);
    // 结点视角仅为回算值, 应明显小于球心角
    expect(model.fieldAngleAt(0.5) * RAD).toBeLessThan(100);
  });

  it('a 200° field covers ~80.7% of the retina (matches Optos ~82% claim)', () => {
    const model = createProjectionModel({ fov: 200 });
    // P1: 球心角口径 —— 半场 100°;视网膜以锯齿缘 (≈117° 球心角) 为界
    expect(model.maxRetinalAngle * RAD).toBeCloseTo(100, 9);
    expect(model.retinalCoverage).toBeGreaterThan(0.78);
    expect(model.retinalCoverage).toBeLessThan(0.83);
  });

  it('anchors the disc-macula geodesic at 4.5mm even with an eccentric macula', () => {
    const model = createProjectionModel({
      maculaX: 0.45, maculaY: 0.45, discX: 0.6, discY: 0.55
    });
    expect(model.calibration.method).toBe('disc');

    // P0/P2: 尺度求根使盘-斑沿其子午线的**椭球弧长** = 4.5mm
    const uM = model.unproject(0.45, 0.45).u;
    const uD = model.unproject(0.6, 0.55).u;
    const cosD = uM.x * uD.x + uM.y * uD.y + uM.z * uD.z;
    const theta = Math.acos(Math.min(1, Math.max(-1, cosD)));
    const arc = meridianArcLength(theta, model.semiAxes, model.calibration.anchorMeridianDeg);
    expect(arc).toBeCloseTo(ANATOMY.discToMaculaDistance, 6);
  });

  it('retinalAngleAt is monotonic increasing', () => {
    const model = createProjectionModel({ fov: 200 });
    let prev = -1;
    for (let dist = 0; dist <= 0.5; dist += 0.05) {
      const t = model.retinalAngleAt(dist);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('ignores a disc marked on top of the macula and falls back to FOV', () => {
    const model = createProjectionModel({
      maculaX: 0.5, maculaY: 0.5, discX: 0.5, discY: 0.5
    });
    expect(model.calibration.method).toBe('fov');
  });

  it('honours the requested projection law and rejects unknown names', () => {
    expect(createProjectionModel({ projection: 'stereographic' }).projection).toBe('stereographic');
    expect(createProjectionModel({ projection: 'nope' }).projection).toBe('equidistant');
  });
});

describe('retinal ellipsoid (Atchison 2005)', () => {
  it('places the emmetropic semi-axes at the published MRI values', () => {
    const g = calculateEyeGeometry(24);
    // 24mm 眼对应约 +0.3D, 半轴应在正视值附近
    expect(g.equatorialRadius.horizontal).toBeCloseTo(11.46, 1);
    expect(g.equatorialRadius.vertical).toBeCloseTo(11.39, 1);
    expect(g.semiAxes.axial).toBeCloseTo(10.19, 1);
    // 扁椭球: 赤道 > 前后
    expect(g.equatorialRadius.horizontal).toBeGreaterThan(g.semiAxes.axial);
  });

  it('keeps the equator nearly fixed while the axial semi-axis grows', () => {
    // Atchison 回归: 赤道 +0.043mm/D, 前后 +0.163mm/D —— 差约 3.8 倍
    const a = retinalSemiAxes(24);
    const b = retinalSemiAxes(28);
    const dEq = b.horizontal - a.horizontal;
    const dAx = b.axial - a.axial;
    expect(dAx / dEq).toBeGreaterThan(2.5);
    expect(dAx / dEq).toBeLessThan(5);
    // 单球模型会让二者同比例增长, 这正是要修的
    const g24 = calculateEyeGeometry(24);
    const g28 = calculateEyeGeometry(28);
    const sphereGrowth = (g28.retinalRadius - g24.retinalRadius) /
      (g28.equatorialRadius.horizontal - g24.equatorialRadius.horizontal);
    expect(sphereGrowth).toBeGreaterThan(3);
  });

  it('accepts an explicit refraction and flags out-of-range extrapolation', () => {
    const a = retinalSemiAxes(24, 0);
    expect(a.source).toBe('refraction');
    expect(a.sphericalEquivalent).toBe(0);
    expect(a.extrapolated).toBe(false);

    const b = retinalSemiAxes(30, 16);
    expect(b.extrapolated).toBe(true);
    // 高度近视外推下椭球趋于长椭球 (前后 > 赤道)
    expect(b.axial).toBeGreaterThan(b.horizontal);
  });

  it('meridian arc length is a closed-form elliptic integral', () => {
    const g = calculateEyeGeometry(24);
    const a = g.equatorialRadius.horizontal;
    const c = g.semiAxes.axial;
    const m = 1 - (c / a) ** 2;

    // 与数值积分对照 (Simpson, 10000 段)
    const numeric = (theta) => {
      const t = Math.atan2(a * Math.sin(theta), c * Math.cos(theta));
      const n = 10000, h = t / n;
      let sum = 0;
      for (let i = 0; i <= n; i++) {
        const u = i * h;
        const f = Math.sqrt(1 - m * Math.sin(u) ** 2);
        sum += i === 0 || i === n ? f : (i % 2 ? 4 * f : 2 * f);
      }
      return a * (sum * h) / 3;
    };

    for (const deg of [10, 45, 90, 117]) {
      expect(meridianArcLength(deg * DEG, g.semiAxes, 0))
        .toBeCloseTo(numeric(deg * DEG), 5);
    }
  });

  it('local curvature at the apex is a²/c and at the equator is c²/a', () => {
    const g = calculateEyeGeometry(24);
    const h = 1e-6;
    const slope = (deg) => {
      const t = deg * DEG;
      return (meridianArcLength(t + h, g.semiAxes, 0) -
              meridianArcLength(t - h, g.semiAxes, 0)) / (2 * h);
    };
    expect(slope(0)).toBeCloseTo(g.apexRadius, 4);
    expect(slope(90)).toBeCloseTo(g.equatorRadius, 4);
    // 后极到赤道每度长度差约 1.45 倍
    expect(slope(0) / slope(90)).toBeGreaterThan(1.35);
  });

  it('arc length ↔ central angle round-trips across the posterior retina', () => {
    const g = calculateEyeGeometry(26);
    for (const deg of [1, 5, 20, 60, 90, 110]) {
      for (const mer of [0, 45, 90, 180, 270]) {
        const arc = meridianArcLength(deg * DEG, g.semiAxes, mer);
        expect(meridianThetaFromArc(arc, g.semiAxes, mer) * RAD)
          .toBeCloseTo(deg, 6);
      }
    }
  });

  it('matches textbook whole-globe dimensions', () => {
    const g = calculateEyeGeometry(24);
    // 赤道周长 (视网膜面) 71-75mm; 角膜缘→后极 (外表面) 29-32mm;
    // 角膜缘→赤道 ~9-12mm
    expect(2 * Math.PI * g.equatorialRadius.horizontal).toBeGreaterThan(70);
    expect(2 * Math.PI * g.equatorialRadius.horizontal).toBeLessThan(76);
    expect(g.limbusToPoleArc + g.scleraThickness).toBeGreaterThan(28);
    expect(g.limbusToPoleArc + g.scleraThickness).toBeLessThan(33);
    expect(g.limbusToEquatorArc).toBeGreaterThan(9);
    expect(g.limbusToEquatorArc).toBeLessThan(13);
  });
});

describe('calculateRetinalParameters', () => {
  it('should return correct parameters for standard eye', () => {
    const params = calculateRetinalParameters(24, 200, 2000);
    const expectedR = calculateEyeGeometry(24).retinalRadius;

    expect(params.axialLength).toBe(24);
    expect(params.retinalRadius).toBeCloseTo(expectedR, 5);
    expect(params.fov).toBe(200);
    expect(params.degPerPixel).toBe(0.1);
  });

  it('reports a retinal arc equal to the ellipsoid meridian arc over ±fov/2', () => {
    const params = calculateRetinalParameters(24, 200, 2000);
    const g = calculateEyeGeometry(24);
    const expected = 2 * meridianArcLength(100 * DEG, g.semiAxes, 0);
    expect(params.retinalArc).toBeCloseTo(expected, 9);
    // 明显短于单球口径 R·fov (单球会高估周边弧长)
    expect(params.retinalArc).toBeLessThan(params.retinalRadius * 200 * DEG * 0.96);
  });

  it('central scale is the apex curvature radius, not the sphere radius (P2)', () => {
    // 椭球每度长度沿子午线变化: 后极 ds/dθ = a²/c ≈ 12.9mm, 赤道 = c²/a ≈ 9.0mm。
    // 平均 mm/px 因此必然小于中心值, 单球模型的「中心=平均」不再成立。
    const params = calculateRetinalParameters(24, 200, 2000);
    const g = calculateEyeGeometry(24);

    expect(params.mmPerPixelCenter).toBeGreaterThan(params.mmPerPixel);
    // mmPerPixelCenter ÷ (每像素对应的球心角) = 该点的局部曲率半径
    const radPerPixel = ((100 * DEG) / 0.5) / params.imageWidth;
    expect(params.mmPerPixelCenter / radPerPixel).toBeCloseTo(g.apexRadius, 6);
  });

  it('stereographic (sensitivity analysis) magnifies the centre relative to the average', () => {
    const params = calculateRetinalParameters(24, 200, 2000, { projection: 'stereographic' });
    expect(params.mmPerPixelCenter).toBeGreaterThan(params.mmPerPixel);
  });

  it('angular scale is constant under the default equidistant law', () => {
    const model = createProjectionModel({ fov: 200 });
    const h = 1e-6;
    const scaleAt = (dist) =>
      (model.retinalAngleAt(dist + h) - model.retinalAngleAt(dist - h)) / (2 * h);

    // θ_r = k·dist ⇒ dθ/ddist = k; 中央差分有 ~1e-9 量级浮点噪声
    for (const dist of [0.05, 0.15, 0.25, 0.35, 0.45]) {
      expect(scaleAt(dist)).toBeCloseTo(model.scale, 6);
    }
  });

  it('metric scale falls from apex to equator under the standard ellipsoid', () => {
    // 沿子午线的 mm/rad = 局部曲率半径: 后极 a²/c ≈ 12.9mm → 赤道 c²/a ≈ 9.0mm
    const model = createProjectionModel({ fov: 200 });
    const g = model.eyeGeometry;
    expect(g.apexRadius).toBeGreaterThan(g.equatorRadius);
    expect(g.apexRadius / g.equatorRadius).toBeGreaterThan(1.35);
    expect(g.apexRadius / g.equatorRadius).toBeLessThan(1.55);
  });

  it('radial scale falls monotonically under stereographic (sensitivity analysis)', () => {
    const model = createProjectionModel({ fov: 200, projection: 'stereographic' });
    const h = 1e-6;
    const scaleAt = (dist) =>
      (model.retinalAngleAt(dist + h) - model.retinalAngleAt(dist - h)) / (2 * h);

    let prev = Infinity;
    for (const dist of [0.05, 0.15, 0.25, 0.35, 0.45]) {
      const s = scaleAt(dist);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
  });
});

describe('imageToSphere', () => {
  it('should map macula to posterior pole', () => {
    const result = imageToSphere(0.5, 0.5, 24, 200, { maculaX: 0.5, maculaY: 0.5 });
    const expectedR = calculateEyeGeometry(24).retinalRadius;

    expect(result.theta).toBe(0);
    expect(result.z).toBeCloseTo(expectedR, 5);
  });

  it('should calculate correct angle for offset point', () => {
    const result = imageToSphere(0.6, 0.5, 24, 200, { maculaX: 0.5, maculaY: 0.5 });

    expect(result.isValid).toBe(true);
    expect(result.angleDeg).toBeGreaterThan(0);
    // 球心角 > 视角
    expect(result.angleDeg).toBeGreaterThan(result.fieldAngleDeg);
  });

  it('marks points beyond the nominal field as invalid', () => {
    // FOV 标定下视场边缘 dist = 0.5, 故须取角点才会越界
    const inside = imageToSphere(0.9, 0.5, 24, 200, { maculaX: 0.5, maculaY: 0.5 });
    const outside = imageToSphere(0.95, 0.9, 24, 200, { maculaX: 0.5, maculaY: 0.5 });
    expect(inside.dist).toBeLessThan(0.5);
    expect(outside.dist).toBeGreaterThan(0.5);
    expect(inside.isValid).toBe(true);
    expect(outside.isValid).toBe(false);
  });

  it('phi is +90° for a point directly above the macula', () => {
    const up = imageToSphere(0.5, 0.4, 24, 200, { maculaX: 0.5, maculaY: 0.5 });
    expect(up.phi * RAD).toBeCloseTo(90, 6);
  });

  it('with an eccentric macula, the image centre is no longer at theta=0 (P0)', () => {
    const model = createProjectionModel({ maculaX: 0.6, maculaY: 0.5 });
    const centre = imageToSphere(0.5, 0.5, 24, 200, { model });
    // 图像中心 = 投影极点; 其距黄斑的角 = 黄斑自身的极点系角
    expect(centre.theta).toBeGreaterThan(0);
    expect(centre.theta).toBeCloseTo(model.maculaTheta, 12);
    expect(centre.arcFromMaculaMm).toBeCloseTo(
      meridianArcLength(model.maculaTheta, model.semiAxes, centre.phi * RAD), 9
    );
  });

  it('with an eccentric macula, phi is still measured in the macula tangent plane (P0)', () => {
    // 黄斑在极点正上方: 黄斑正上方的点 (沿子午线远离极点) 方位角仍为 +90°,
    // 黄斑与极点之间的点 (朝极点方向) 为 -90°。
    const above = imageToSphere(0.5, 0.35, 24, 200, { maculaX: 0.5, maculaY: 0.45 });
    const below = imageToSphere(0.5, 0.49, 24, 200, { maculaX: 0.5, maculaY: 0.45 });
    expect(above.phi * RAD).toBeCloseTo(90, 6);
    expect(below.phi * RAD).toBeCloseTo(-90, 6);
  });

  it('reuses a supplied model', () => {
    const model = createProjectionModel({ maculaX: 0.5, maculaY: 0.5, discX: 0.6, discY: 0.5 });
    const viaModel = imageToSphere(0.6, 0.5, 24, 200, { model });
    expect(viaModel.arcFromMaculaMm).toBeCloseTo(ANATOMY.discToMaculaDistance, 6);
  });
});

describe('calculateMaculaFromDisc', () => {
  it('puts the macula temporal to the disc — image LEFT for a right eye', () => {
    const result = calculateMaculaFromDisc(0.5, 0.5, 200, 2000, 2000, 'right');
    expect(result.maculaX).toBeLessThan(0.5);
    expect(result.maculaY).toBeGreaterThan(0.5); // 黄斑在视盘下方
  });

  it('puts the macula temporal to the disc — image RIGHT for a left eye', () => {
    const result = calculateMaculaFromDisc(0.5, 0.5, 200, 2000, 2000, 'left');
    expect(result.maculaX).toBeGreaterThan(0.5);
    expect(result.maculaY).toBeGreaterThan(0.5);
  });

  it('is horizontally mirrored between the two eyes', () => {
    const od = calculateMaculaFromDisc(0.5, 0.5, 200, 2000, 2000, 'right');
    const os = calculateMaculaFromDisc(0.5, 0.5, 200, 2000, 2000, 'left');
    expect(od.maculaX - 0.5).toBeCloseTo(-(os.maculaX - 0.5), 9);
    expect(od.maculaY).toBeCloseTo(os.maculaY, 9);
  });

  it('round-trips: the derived macula reproduces ~18.7° of field angle', () => {
    const result = calculateMaculaFromDisc(0.5, 0.5, 200, 2000, 2000, 'right');
    const exact = Math.hypot(ANATOMY.discToMaculaAngle, ANATOMY.discToMaculaVertical);
    expect(result.angleOffset.total).toBeCloseTo(exact, 9);
    expect(exact).toBeCloseTo(ANATOMY.combinedDiscMaculaAngle, 1);

    const sphere = imageToSphere(0.5, 0.5, 24, 200, {
      maculaX: result.maculaX, maculaY: result.maculaY
    });
    expect(sphere.fieldAngleDeg).toBeCloseTo(exact, 6);
  });
});

describe('detectEyeSide', () => {
  it('disc right of macula means right eye (nasal is image-right)', () => {
    expect(detectEyeSide({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 })).toBe('right');
  });

  it('disc left of macula means left eye', () => {
    expect(detectEyeSide({ x: 0.6, y: 0.5 }, { x: 0.4, y: 0.5 })).toBe('left');
  });

  it('returns null when horizontally too close to call', () => {
    expect(detectEyeSide({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 })).toBeNull();
    expect(detectEyeSide(null, { x: 0.6, y: 0.5 })).toBeNull();
  });

  it('agrees with calculateMaculaFromDisc (no self-contradiction)', () => {
    // 用 OD 推算黄斑, 再反过来判断眼别, 必须还是 OD
    for (const side of ['right', 'left']) {
      const m = calculateMaculaFromDisc(0.5, 0.5, 200, 2000, 2000, side);
      expect(detectEyeSide({ x: m.maculaX, y: m.maculaY }, { x: 0.5, y: 0.5 })).toBe(side);
    }
  });
});

describe('angularDistance', () => {
  it('should return 0 for same point', () => {
    const p1 = { theta: 0.1, phi: 0.2 };
    const p2 = { theta: 0.1, phi: 0.2 };

    expect(angularDistance(p1, p2)).toBeCloseTo(0, 5);
  });

  it('should calculate correct distance between points', () => {
    const p1 = { theta: 0, phi: 0 };
    const p2 = { theta: Math.PI / 2, phi: 0 };

    expect(angularDistance(p1, p2)).toBeCloseTo(90, 5);
  });
});

describe('findPointAtAngle', () => {
  it('should find point within tolerance', () => {
    const points = [
      { theta: 0.1, phi: 0.1, data: 'a' },
      { theta: 0.5, phi: 0.5, data: 'b' }
    ];

    const result = findPointAtAngle(points, 0.1, 0.1, 5);
    expect(result).not.toBeNull();
    expect(result.data).toBe('a');
  });

  it('should return null when no point within tolerance', () => {
    const points = [
      { theta: 0.5, phi: 0.5 }
    ];

    const result = findPointAtAngle(points, 0.1, 0.1, 1);
    expect(result).toBeNull();
  });
});

describe('getAnatomyReference', () => {
  it('should return anatomy data', () => {
    const anatomy = getAnatomyReference();

    expect(anatomy.discToMaculaAngle).toBe(17);
    expect(anatomy.discToMaculaDistance).toBe(4.5);
  });

  it('returns a copy, not the live object', () => {
    const a = getAnatomyReference();
    a.discToMaculaDistance = 99;
    expect(ANATOMY.discToMaculaDistance).toBe(4.5);
  });
});

describe('getTheoreticalDiscPosition', () => {
  it('derives theta from the 4.5mm physical distance along its meridian', () => {
    const disc = getTheoreticalDiscPosition(24);
    const g = calculateEyeGeometry(24);

    const arc = meridianArcLength(disc.theta, g.semiAxes, disc.phi * RAD);
    expect(arc).toBeCloseTo(ANATOMY.discToMaculaDistance, 6);
    // 椭球后极曲率半径大于等效球半径 ⇒ 角度落在 20° 左右
    expect(disc.angleFromMacula).toBeGreaterThan(19.5);
    expect(disc.angleFromMacula).toBeLessThan(21);
  });

  it('places the disc nasally, not almost straight up', () => {
    // 旧版本用 (90 + 7.76)° = 97.76°, 把视盘放到了近乎正上方
    const od = getTheoreticalDiscPosition(24, 'right');
    expect(od.phi * RAD).toBeCloseTo(Math.atan2(7.76, 17) * RAD, 6);
    expect(od.phi * RAD).toBeLessThan(30);
    // 右眼鼻侧 = 图像右 ⇒ x > 0
    expect(od.x).toBeGreaterThan(0);
    expect(od.y).toBeGreaterThan(0); // 视盘略高于黄斑
  });

  it('mirrors horizontally for the left eye', () => {
    const od = getTheoreticalDiscPosition(24, 'right');
    const os = getTheoreticalDiscPosition(24, 'left');
    expect(os.x).toBeCloseTo(-od.x, 9);
    expect(os.y).toBeCloseTo(od.y, 9);
    expect(os.theta).toBeCloseTo(od.theta, 9);
  });
});

describe('calculateBreakToMacula', () => {
  it('should return 0 for break at macula position', () => {
    const result = calculateBreakToMacula(0.5, 0.5, { x: 0.5, y: 0.5 });

    expect(result.distanceMm).toBeCloseTo(0, 5);
    expect(result.angleDeg).toBeCloseTo(0, 5);
    expect(result.theta).toBeCloseTo(0, 5);
  });

  it('should calculate distance without disc calibration', () => {
    const result = calculateBreakToMacula(0.6, 0.5, { x: 0.5, y: 0.5 });

    expect(result.distanceMm).toBeGreaterThan(0);
    expect(result.angleDeg).toBeGreaterThan(0);
    expect(result.phi).toBeDefined();
    expect(result.calibration.method).toBe('fov');
  });

  it('returns exactly 4.5mm when the break is placed on the disc', () => {
    const result = calculateBreakToMacula(
      0.6, 0.5, { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }
    );
    expect(result.distanceMm).toBeCloseTo(ANATOMY.discToMaculaDistance, 9);
    expect(result.calibration.method).toBe('disc');
  });

  it('returns 4.5mm for a break on the disc with an eccentric macula (P0)', () => {
    // 旧模型把盘-斑当作黄斑系径向距离, 黄斑偏心时标定即错;
    // 新模型对测地距离求根, 任意偏心下都应精确锚定。
    const macula = { x: 0.45, y: 0.45 };
    const disc = { x: 0.6, y: 0.55 };
    const result = calculateBreakToMacula(disc.x, disc.y, macula, disc);
    expect(result.distanceMm).toBeCloseTo(ANATOMY.discToMaculaDistance, 9);
    expect(result.calibration.method).toBe('disc');
  });

  it('central angle is exactly linear in image distance; field angle is super-linear', () => {
    const macula = { x: 0.5, y: 0.5 };
    const disc = { x: 0.6, y: 0.5 };
    const near = calculateBreakToMacula(0.6, 0.5, macula, disc);
    const far = calculateBreakToMacula(0.7, 0.5, macula, disc);

    // 等距律 (ρ ∝ θ_r) ⇒ 球心角随图像距离严格线性 (0.2 = 2 × 0.1)
    expect(far.angleDeg).toBeCloseTo(near.angleDeg * 2, 6);
    // 结点视角为回算值, 对球心角超线性 (θv/θr 随角度增大趋近 1)
    expect(far.fieldAngleDeg).toBeGreaterThan(near.fieldAngleDeg * 2);
    // 视角恒小于对应球心角
    expect(far.fieldAngleDeg).toBeLessThan(far.angleDeg);
    expect(near.fieldAngleDeg).toBeLessThan(near.angleDeg);
  });

  it('an eccentric macula breaks the false symmetry between its two sides (P0 regression)', () => {
    // 旧模型以黄斑为极点, 黄斑两侧等图像距离的两点被强制给出相同距离;
    // 新模型绕图像中心解投影, 非线性律下两侧测地距离按真实几何区分。
    // (stereographic 为凹函数: 越过极点一侧的测地距离严格大于远侧)
    const macula = { x: 0.55, y: 0.5 };
    const disc = { x: 0.65, y: 0.5 };
    const farSide = calculateBreakToMacula(0.65, 0.5, macula, disc, { projection: 'stereographic' });
    const acrossPole = calculateBreakToMacula(0.45, 0.5, macula, disc, { projection: 'stereographic' });

    expect(farSide.distanceMm).toBeCloseTo(ANATOMY.discToMaculaDistance, 9);
    expect(acrossPole.distanceMm).not.toBeCloseTo(farSide.distanceMm, 6);
    expect(acrossPole.distanceMm).toBeGreaterThan(farSide.distanceMm);
  });

  it('collinear configurations remain self-consistent under the linear default law', () => {
    // 等距律线性 ⇒ 共线配置仍满足可加性: 越过极点、与黄斑关于极点对称的点,
    // 其测地距离 = 2 × 黄斑自身的极点系角 × R。
    const macula = { x: 0.55, y: 0.5 };
    const disc = { x: 0.65, y: 0.5 };
    const acrossPole = calculateBreakToMacula(0.45, 0.5, macula, disc);
    const model = acrossPole.model;
    // 测地角仍是 2×黄斑极点角 (球面几何不变), 弧长按椭球换算
    const expected = meridianArcLength(
      2 * model.maculaTheta, model.semiAxes, model.calibration.anchorMeridianDeg
    );
    expect(acrossPole.angleDeg).toBeCloseTo(2 * model.maculaTheta * RAD, 9);
    expect(acrossPole.distanceMm).toBeCloseTo(expected, 9);
  });

  it('the disc anchor yields a central angle larger than the 18.7° field angle', () => {
    // 18.7° 是**视角**, 球心角必然更大。椭球后极曲率半径 12.9mm 下比值约 1.09;
    // 旧球模型给 22.5°/18.7° ≈ 1.20 —— 差异来自形状, 不是锚点。
    const model = createProjectionModel({ maculaX: 0.5, maculaY: 0.5, discX: 0.6, discY: 0.5 });
    const ratio = model.calibration.discRetinalAngleDeg / ANATOMY.combinedDiscMaculaAngle;
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.15);
  });

  it('flags points beyond the nominal field', () => {
    const macula = { x: 0.5, y: 0.5 };
    expect(calculateBreakToMacula(0.95, 0.9, macula).isBeyondNominalField).toBe(true);
    expect(calculateBreakToMacula(0.7, 0.5, macula).isBeyondNominalField).toBe(false);
  });

  it('uses the ellipsoid semi-axes of the requested axial length', () => {
    const base = { x: 0.5, y: 0.5 };
    const longer = calculateBreakToMacula(0.6, 0.5, base, undefined, { axialLength: 26, fov: 200 });
    const standard = calculateBreakToMacula(0.6, 0.5, base, undefined, { axialLength: 24, fov: 200 });

    expect(longer.distanceMm).toBeGreaterThan(0);
    // 近视加深时椭球变「圆」(前后半轴涨得比赤道快), 后极曲率半径反而减小,
    // 因此小角度处的弧长小于正视眼。赤道附近的结论相反 —— 见 calculateLimbusDistance。
    expect(longer.model.eyeGeometry.apexRadius)
      .toBeLessThan(standard.model.eyeGeometry.apexRadius);
    expect(longer.distanceMm).toBeLessThan(standard.distanceMm);
  });

  it('stereographic projection compresses the periphery differently from equidistant', () => {
    const macula = { x: 0.5, y: 0.5 };
    const eq = calculateBreakToMacula(0.9, 0.5, macula, undefined, { projection: 'equidistant' });
    const st = calculateBreakToMacula(0.9, 0.5, macula, undefined, { projection: 'stereographic' });
    expect(st.distanceMm).not.toBeCloseTo(eq.distanceMm, 2);
  });

  it('disc mode reports a population-range uncertainty bracketing the central value', () => {
    const macula = { x: 0.5, y: 0.5 };
    const disc = { x: 0.6, y: 0.5 };
    const r = calculateBreakToMacula(0.7, 0.5, macula, disc);

    expect(r.calibration.method).toBe('disc');
    expect(r.distanceMmLow).toBeLessThan(r.distanceMm);
    expect(r.distanceMmHigh).toBeGreaterThan(r.distanceMm);
    expect(r.distanceMmUncertainty).toBeCloseTo((r.distanceMmHigh - r.distanceMmLow) / 2, 9);
    // ±10% 锚点变异 ⇒ 距离变异同量级 (~10%, 允许结点转换带来的轻微非线性)
    const rel = r.distanceMmUncertainty / r.distanceMm;
    expect(rel).toBeGreaterThan(0.08);
    expect(rel).toBeLessThan(0.13);
  });

  it('fov mode flags uncertainty as unbounded with zero half-width', () => {
    const r = calculateBreakToMacula(0.6, 0.5, { x: 0.5, y: 0.5 });
    expect(r.calibration.method).toBe('fov');
    expect(r.uncertaintySource).toMatch(/unbounded/);
    expect(r.distanceMmUncertainty).toBe(0);
  });
});

describe('calculateLimbusDistance', () => {
  it('returns the full limbus-to-pole arc for theta=0 without alpha correction', () => {
    const result = calculateLimbusDistance(0);
    const eyeGeometry = calculateEyeGeometry(24);

    expect(result.arcToMaculaMm).toBe(0);
    expect(result.limbusToBreakMm).toBeCloseTo(eyeGeometry.limbusToPoleArc, 9);
    expect(result.alphaApplied).toBe(0);
  });

  it('subtracts the break arc along the meridian (ellipsoid segment)', () => {
    const result = calculateLimbusDistance(90);
    const eyeGeometry = calculateEyeGeometry(24);
    const equatorArc = meridianArcLength(Math.PI / 2, eyeGeometry.semiAxes, 0);

    expect(result.arcToMaculaMm).toBeCloseTo(equatorArc, 9);
    expect(result.limbusToBreakMm).toBeCloseTo(eyeGeometry.limbusToPoleArc - equatorArc, 9);
    // 赤道处 -> 只剩前段球 (角膜缘 → 赤道)
    expect(result.limbusToBreakMm).toBeCloseTo(eyeGeometry.limbusToEquatorArc, 9);
  });

  it('scales the anterior segment by the same radius ratio on both surfaces', () => {
    // θ=90° 时只剩前段 (角膜缘→赤道)。外表面必须由内表面按同一半径比例放大,
    // 不能另用 (R+t)·(limbusPolarAngle−90°): 后者与解剖常数不是同一个几何,
    // 会凭空多出约 1mm (曾导致 θ=0 处内外差 1.96mm)。
    const g = calculateEyeGeometry(24);
    const atEquator = calculateLimbusDistance(90);
    const expectedRatio = (g.anteriorRadius + g.scleraThickness) / g.anteriorRadius;

    expect(atEquator.limbusToBreakMm).toBeCloseTo(g.limbusToEquatorArc, 9);
    expect(atEquator.limbusToBreakExternalMm / atEquator.limbusToBreakMm)
      .toBeCloseTo(expectedRatio, 9);
    // 差值应约为 厚度×弧长/半径 ≈ 0.6mm, 而不是 1.6mm
    expect(atEquator.limbusToBreakExternalMm - atEquator.limbusToBreakMm)
      .toBeLessThan(0.8);
  });

  it('keeps the internal/external ratio near t/R across the whole posterior retina', () => {
    const g = calculateEyeGeometry(24);
    const ratio = 1 + g.scleraThickness / g.anteriorRadius;   // ≈ 1.052

    for (const t of [0, 30, 60, 90, 117]) {
      const r = calculateLimbusDistance(t);
      expect(r.limbusToBreakExternalMm / r.limbusToBreakMm)
        .toBeCloseTo(ratio, 1);
    }
    // 差值随剩余弧长单调下降 (θ 越大, 还剩越短的一段)
    const far = calculateLimbusDistance(0);
    const near = calculateLimbusDistance(117);
    expect(far.limbusToBreakExternalMm - far.limbusToBreakMm)
      .toBeGreaterThan(near.limbusToBreakExternalMm - near.limbusToBreakMm);
  });

  it('external (scleral) arc always exceeds the internal (retinal) arc', () => {
    for (const t of [0, 30, 60, 90]) {
      const r = calculateLimbusDistance(t);
      expect(r.limbusToBreakExternalMm).toBeGreaterThan(r.limbusToBreakMm);
    }
    // 量级检查: 约 5% 左右
    const r = calculateLimbusDistance(60);
    const ratio = r.limbusToBreakExternalMm / r.limbusToBreakMm;
    expect(ratio).toBeGreaterThan(1.02);
    expect(ratio).toBeLessThan(1.10);
  });

  it('applies angle alpha: nasal and temporal breaks differ', () => {
    const nasal = calculateLimbusDistance(60, 24, null, null, { phiDeg: 0, eyeSide: 'right' });
    const temporal = calculateLimbusDistance(60, 24, null, null, { phiDeg: 180, eyeSide: 'right' });

    expect(nasal.alphaApplied).toBe(ANATOMY.angleAlpha);
    // 中心凹在光轴颞侧 ⇒ 光轴极点在中心凹鼻侧 ⇒ 同等黄斑偏心的鼻侧裂孔
    // 角度上更靠近光轴极点 ⇒ 离角膜缘更远
    expect(nasal.thetaFromOpticalAxisDeg).toBeLessThan(temporal.thetaFromOpticalAxisDeg);
    expect(nasal.limbusToBreakMm).toBeGreaterThan(temporal.limbusToBreakMm);
    // 两侧相对无修正值对称偏移
    const plain = calculateLimbusDistance(60, 24);
    expect(nasal.thetaFromOpticalAxisDeg).toBeCloseTo(60 - ANATOMY.angleAlpha, 9);
    expect(temporal.thetaFromOpticalAxisDeg).toBeCloseTo(60 + ANATOMY.angleAlpha, 9);
    expect(plain.thetaFromOpticalAxisDeg).toBeCloseTo(60, 9);
  });

  it('alpha correction spans ~2mm between nasal and temporal meridians', () => {
    const nasal = calculateLimbusDistance(60, 24, null, null, { phiDeg: 0, eyeSide: 'right' });
    const temporal = calculateLimbusDistance(60, 24, null, null, { phiDeg: 180, eyeSide: 'right' });
    const spread = nasal.limbusToBreakMm - temporal.limbusToBreakMm;
    expect(spread).toBeGreaterThan(1);
    expect(spread).toBeLessThan(3);
  });

  it('matches the spherical law of cosines off the meridian (vector form is equivalent)', () => {
    // P0 向量化后, 离子午线方向必须与旧球面余弦定理公式一致
    for (const phiDeg of [30, 75, 130, 200, 310]) {
      const r = calculateLimbusDistance(60, 24, null, null, { phiDeg, eyeSide: 'right' });
      const alpha = ANATOMY.angleAlpha * DEG;
      const theta = 60 * DEG;
      const phi = phiDeg * DEG;
      const expected = Math.acos(
        Math.cos(alpha) * Math.cos(theta) +
          Math.sin(alpha) * Math.sin(theta) * Math.cos(phi)
      ) * RAD;
      expect(r.thetaFromOpticalAxisDeg).toBeCloseTo(expected, 9);
    }
  });

  it('mirrors the alpha correction between eyes', () => {
    const od = calculateLimbusDistance(60, 24, null, null, { phiDeg: 0, eyeSide: 'right' });
    const os = calculateLimbusDistance(60, 24, null, null, { phiDeg: 180, eyeSide: 'left' });
    // 两者都是「鼻侧」裂孔, 结果应相同
    expect(od.limbusToBreakMm).toBeCloseTo(os.limbusToBreakMm, 9);
  });

  it('vertical meridians are unaffected in sign by alpha (superior == inferior)', () => {
    const sup = calculateLimbusDistance(60, 24, null, null, { phiDeg: 90, eyeSide: 'right' });
    const inf = calculateLimbusDistance(60, 24, null, null, { phiDeg: -90, eyeSide: 'right' });
    expect(sup.limbusToBreakMm).toBeCloseTo(inf.limbusToBreakMm, 9);
  });

  it('is continuous across the equator seam', () => {
    // 90° 两侧用不同模型 (前段球 / 后段椭球), 但接缝处必须给出同一个值
    const below = calculateLimbusDistance(89.9999);
    const above = calculateLimbusDistance(90.0001);
    const at = calculateLimbusDistance(90);
    expect(below.limbusToBreakMm).toBeCloseTo(at.limbusToBreakMm, 3);
    expect(above.limbusToBreakMm).toBeCloseTo(at.limbusToBreakMm, 3);
    expect(Math.abs(above.limbusToBreakMm - below.limbusToBreakMm)).toBeLessThan(0.01);
  });

  it('covers the equator → ora serrata band with the ellipsoid', () => {
    // 锯齿缘 117° 仍属视网膜, 必须走椭球 (不能退回前段球)
    const g = calculateEyeGeometry(24);
    const ora = calculateLimbusDistance(ANATOMY.serrataPolarAngleDeg);
    const expected = g.limbusToEquatorArc + g.equatorArc -
      meridianArcLength(ANATOMY.serrataPolarAngleDeg * DEG, g.semiAxes, 0);

    expect(ora.limbusToBreakMm).toBeCloseTo(expected, 9);
    // 角膜缘 → 锯齿缘: 鼻侧 5mm, 颞侧 7mm (教科书) —— 落在同一量级
    expect(ora.limbusToBreakMm).toBeGreaterThan(4);
    expect(ora.limbusToBreakMm).toBeLessThan(9);
    expect(ora.equatorToBreakMm).toBeLessThan(0);
  });

  it('reports a larger limbus-to-break arc for a longer eye (equatorial growth)', () => {
    const resultStandard = calculateLimbusDistance(30, 24);
    const resultLonger = calculateLimbusDistance(30, 26);

    // 30° 处后极曲率半径随近视减小, 该点自身的弧长反而略小;
    // 但「角膜缘 → 裂孔」整段 (含更大的前段球与前移的赤道) 必须更长。
    expect(resultLonger.arcToMaculaMm).toBeLessThan(resultStandard.arcToMaculaMm);
    expect(resultLonger.limbusToBreakMm).toBeGreaterThan(resultStandard.limbusToBreakMm);
  });
});

describe('getClockHourPosition', () => {
  it('returns 12:00 for phi = π/2 (superior), both eyes', () => {
    expect(getClockHourPosition(Math.PI / 2)).toBe('12:00');
    expect(getClockHourPosition(Math.PI / 2, 'left')).toBe('12:00');
  });

  it('returns 6:00 for phi = -π/2 (inferior), both eyes', () => {
    expect(getClockHourPosition(-Math.PI / 2)).toBe('6:00');
    expect(getClockHourPosition(-Math.PI / 2, 'left')).toBe('6:00');
  });

  it('returns 3:00 for image-right regardless of eye', () => {
    // 图像右 = 3 点, 对两眼都成立;眼别只改变「鼻/颞」的叫法
    expect(getClockHourPosition(0, 'right')).toBe('3:00');
    expect(getClockHourPosition(0, 'left')).toBe('3:00');
  });

  it('returns 9:00 for image-left regardless of eye', () => {
    expect(getClockHourPosition(Math.PI, 'right')).toBe('9:00');
    expect(getClockHourPosition(Math.PI, 'left')).toBe('9:00');
    expect(getClockHourPosition(-Math.PI, 'right')).toBe('9:00');
  });

  it('is independent of the eyeSide argument (kept only for API compatibility)', () => {
    for (let deg = -180; deg <= 180; deg += 7) {
      const phi = deg * DEG;
      expect(getClockHourPosition(phi, 'right')).toBe(getClockHourPosition(phi, 'left'));
    }
  });

  it('handles intermediate angles', () => {
    // 图像右上 45° ⇒ 12 点与 3 点之间 ⇒ 1:30
    expect(getClockHourPosition(Math.PI / 4)).toBe('1:30');
    // 图像右下 45° ⇒ 4:30
    expect(getClockHourPosition(-Math.PI / 4)).toBe('4:30');
    // 图像左上 135° ⇒ 10:30
    expect(getClockHourPosition((3 * Math.PI) / 4)).toBe('10:30');
  });

  it('advances clockwise as phi decreases', () => {
    const hours = [90, 60, 30, 0, -30, -60, -90].map(d => getClockHourPosition(d * DEG));
    expect(hours).toEqual(['12:00', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00']);
  });
});
