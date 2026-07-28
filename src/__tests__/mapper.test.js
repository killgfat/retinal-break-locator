import { describe, it, expect } from 'vitest';
import {
  ANATOMY,
  PROJECTION_LAWS,
  calculateRetinalParameters,
  calculateEyeGeometry,
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
    // 标定点处反算出的弧长必须等于 4.5mm
    const arc = model.R * model.retinalAngleAt(0.1);
    expect(arc).toBeCloseTo(ANATOMY.discToMaculaDistance, 9);
  });

  it('disc-anchored retinal angle is ~22.5° for a standard eye, not 18.7°', () => {
    const model = createProjectionModel({ maculaX: 0.5, maculaY: 0.5, discX: 0.6, discY: 0.5 });
    const deg = model.calibration.discRetinalAngleDeg;
    expect(deg).toBeGreaterThan(21);
    expect(deg).toBeLessThan(24);
    // 该球心角对应的视角明显更小
    expect(model.calibration.discFieldAngleDeg).toBeLessThan(deg);
  });

  it('falls back to nominal FOV without a disc, with field edge at dist=0.5', () => {
    const model = createProjectionModel({ fov: 200 });
    expect(model.calibration.method).toBe('fov');
    expect(model.maxDist).toBeCloseTo(0.5, 9);
    expect(model.fieldAngleAt(0.5) * RAD).toBeCloseTo(100, 9);
  });

  it('a 200° field covers ~78% of the retina (matches Optos ~82% claim far better than 59%)', () => {
    const model = createProjectionModel({ fov: 200 });
    expect(model.maxRetinalAngle * RAD).toBeGreaterThan(115);
    expect(model.retinalCoverage).toBeGreaterThan(0.7);
    expect(model.retinalCoverage).toBeLessThan(0.85);
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

describe('calculateRetinalParameters', () => {
  it('should return correct parameters for standard eye', () => {
    const params = calculateRetinalParameters(24, 200, 2000);
    const expectedR = calculateEyeGeometry(24).retinalRadius;

    expect(params.axialLength).toBe(24);
    expect(params.retinalRadius).toBeCloseTo(expectedR, 5);
    expect(params.fov).toBe(200);
    expect(params.degPerPixel).toBe(0.1);
  });

  it('reports a retinal arc based on the central angle, exceeding R·fov', () => {
    const params = calculateRetinalParameters(24, 200, 2000);
    const R = params.retinalRadius;
    // 旧模型: R * 200° ; 新模型经结点转换后更大
    expect(params.retinalArc).toBeGreaterThan(R * 200 * DEG);
  });

  it('a central pixel covers more retina than the whole-field average (periphery is magnified)', () => {
    // Croft 2014: 未校正图像中后极像素代表的面积比周边大 ~79%
    const params = calculateRetinalParameters(24, 200, 2000);
    expect(params.mmPerPixelCenter).toBeGreaterThan(params.mmPerPixel);
  });

  it('radial scale falls monotonically from centre to field edge', () => {
    const model = createProjectionModel({ fov: 200 });
    const h = 1e-6;
    const scaleAt = (dist) =>
      model.R * (model.retinalAngleAt(dist + h) - model.retinalAngleAt(dist - h)) / (2 * h);

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

  it('reuses a supplied model', () => {
    const model = createProjectionModel({ maculaX: 0.5, maculaY: 0.5, discX: 0.6, discY: 0.5 });
    const viaModel = imageToSphere(0.6, 0.5, 24, 200, { model });
    expect(viaModel.arcFromMaculaMm).toBeCloseTo(ANATOMY.discToMaculaDistance, 9);
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
  it('derives theta from the 4.5mm physical distance', () => {
    const disc = getTheoreticalDiscPosition(24);
    const R = calculateEyeGeometry(24).retinalRadius;

    expect(R * disc.theta).toBeCloseTo(ANATOMY.discToMaculaDistance, 9);
    expect(disc.angleFromMacula).toBeGreaterThan(21);
    expect(disc.angleFromMacula).toBeLessThan(24);
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

  it('field angle is linear in image distance, but central angle is sub-linear', () => {
    const macula = { x: 0.5, y: 0.5 };
    const disc = { x: 0.6, y: 0.5 };
    const near = calculateBreakToMacula(0.6, 0.5, macula, disc);
    const far = calculateBreakToMacula(0.7, 0.5, macula, disc);

    // 等距律 ⇒ 视角严格线性
    expect(far.fieldAngleDeg).toBeCloseTo(near.fieldAngleDeg * 2, 6);
    // 球心角 sub-linear: θr/θv 随角度增大而下降
    expect(far.angleDeg).toBeLessThan(near.angleDeg * 2);
    expect(far.angleDeg).toBeGreaterThan(near.angleDeg);
  });

  it('the disc anchor yields a central angle ~20% larger than the 18.7° field angle', () => {
    // 这正是旧模型(把 18.7° 当球心角)所缺的那 20% 系统偏差
    const model = createProjectionModel({ maculaX: 0.5, maculaY: 0.5, discX: 0.6, discY: 0.5 });
    const ratio = model.calibration.discRetinalAngleDeg / ANATOMY.combinedDiscMaculaAngle;
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.25);
  });

  it('flags points beyond the nominal field', () => {
    const macula = { x: 0.5, y: 0.5 };
    expect(calculateBreakToMacula(0.95, 0.9, macula).isBeyondNominalField).toBe(true);
    expect(calculateBreakToMacula(0.7, 0.5, macula).isBeyondNominalField).toBe(false);
  });

  it('should handle custom axial length', () => {
    const base = { x: 0.5, y: 0.5 };
    const longer = calculateBreakToMacula(0.6, 0.5, base, undefined, { axialLength: 26, fov: 200 });
    const standard = calculateBreakToMacula(0.6, 0.5, base, undefined, { axialLength: 24, fov: 200 });

    expect(longer.distanceMm).toBeGreaterThan(0);
    expect(longer.distanceMm).toBeGreaterThan(standard.distanceMm);
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

  it('subtracts the break arc along the meridian', () => {
    const result = calculateLimbusDistance(90);
    const eyeGeometry = calculateEyeGeometry(24);
    const R = eyeGeometry.retinalRadius;

    expect(result.arcToMaculaMm).toBeCloseTo(R * 90 * DEG, 9);
    expect(result.limbusToBreakMm).toBeCloseTo(eyeGeometry.limbusToPoleArc - R * 90 * DEG, 9);
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

  it('should use custom axial length', () => {
    const resultStandard = calculateLimbusDistance(30, 24);
    const resultLonger = calculateLimbusDistance(30, 26);

    expect(resultLonger.arcToMaculaMm).toBeGreaterThan(resultStandard.arcToMaculaMm);
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
