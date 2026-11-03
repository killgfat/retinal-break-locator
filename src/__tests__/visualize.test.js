import { describe, it, expect } from 'vitest';
import { calculateEyeGeometry, createProjectionModel, meridianSemiAxis } from '../mapper.js';
import { createEyeballGeometry, createRetinalSphereGeometry } from '../visualize.js';

const RAD = 180 / Math.PI;

describe('createEyeballGeometry (三段式轮廓)', () => {
  it('places the posterior pole at (0, 0, -c) and the equator at the semi-axes', () => {
    const g = calculateEyeGeometry(24);
    const geo = createEyeballGeometry(g);
    const p = geo.attributes.position.array;

    // 第一个顶点: lat=0, lon=0 ⇒ 后极
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(0, 9);
    // Float32 顶点缓冲, 精度约 1e-7
    expect(p[2]).toBeCloseTo(-g.semiAxes.axial, 5);

    // 赤道不落在整数格点上 (lat 均匀分布在 0..latLimbus), 故扫描取极值。
    // 横向子午线 (lon=0) 的最大径向 = aH; 纵向 (lon=90°) 的最大 y = aV。
    let maxX = 0;
    let maxY = 0;
    let zAtMaxX = 0;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      if (x > maxX) { maxX = x; zAtMaxX = p[i + 2]; }
      if (y > maxY) maxY = y;
    }
    // 72 段离散化: 赤道落在格点之间, 误差 ~1e-3 mm
    expect(maxX).toBeCloseTo(g.equatorialRadius.horizontal, 2);
    expect(maxY).toBeCloseTo(g.equatorialRadius.vertical, 2);
    // 赤道处前后轴分量接近 0
    expect(Math.abs(zAtMaxX)).toBeLessThan(0.15);

    geo.dispose();
  });

  it('has no NaN and the cornea protrudes in front of the equator', () => {
    for (const al of [22, 24, 28, 30]) {
      const g = calculateEyeGeometry(al);
      const geo = createEyeballGeometry(g);
      const p = geo.attributes.position.array;

      let maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        expect(Number.isFinite(p[i])).toBe(true);
        expect(Number.isFinite(p[i + 1])).toBe(true);
        expect(Number.isFinite(p[i + 2])).toBe(true);
        maxZ = Math.max(maxZ, p[i + 2]);
      }
      // 角膜在前面 (z > 0), 赤道也 > 0, 但角膜顶点更靠前
      expect(maxZ).toBeGreaterThan(g.equatorialRadius.horizontal * 0.8);
      expect(geo.index.count / 3).toBe(72 * 96 * 2);
      geo.dispose();
    }
  });

  it('always includes a corneal cap, for every axial length', () => {
    // 回归: latLimbus 曾用等效球反推, AL≤22 时 radial 6.2 > WTW/2 5.85,
    // 角膜判据整圈落空, 线框上前段直接断开。必须由 WTW 反解。
    for (const al of [20, 21, 22, 23, 24, 26, 28, 30]) {
      const g = calculateEyeGeometry(al);
      const geo = createEyeballGeometry(g);
      const p = geo.attributes.position.array;

      let maxZ = -Infinity;
      let zAtApex = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 2] > maxZ) { maxZ = p[i + 2]; zAtApex = p[i + 2]; }
      }
      // 角膜顶点: 径向≈0, 轴向最前
      expect(zAtApex).toBeGreaterThan(0);

      // 赤道处的前后坐标 (约 0) 与角膜顶点之间应有明显凸出
      const g2 = g.equatorialRadius.horizontal;
      expect(maxZ).toBeGreaterThan(g2 * 0.75);

      // 角膜缘那一圈必须存在且径向 ≤ WTW/2
      const halfWtw = g.corneaDiameter / 2;
      let foundLimbus = false;
      for (let i = 0; i < p.length; i += 3) {
        const rad = Math.hypot(p[i], p[i + 1]);
        if (Math.abs(rad - halfWtw) < 0.02 && p[i + 2] > 0) foundLimbus = true;
      }
      expect(foundLimbus).toBe(true);

      geo.dispose();
    }
  });

  it('the anterior sphere radius is independent of axial length', () => {
    // 赤道直径几乎不随眼轴变化 ⇒ 前段轮廓也必须基本不变
    const a = createEyeballGeometry(calculateEyeGeometry(22));
    const b = createEyeballGeometry(calculateEyeGeometry(30));
    const pa = a.attributes.position.array;
    const pb = b.attributes.position.array;

    // 取赤道列 (lat = 90°) 的径向距离
    const segmentsLon = 96;
    const idx = 72 * (segmentsLon + 1) * 3;
    const ra = Math.hypot(pa[idx], pa[idx + 1]);
    const rb = Math.hypot(pb[idx], pb[idx + 1]);

    expect(rb - ra).toBeLessThan(1.0);   // 22→30mm 只差 <1mm
    a.dispose();
    b.dispose();
  });
});

describe('createRetinalSphereGeometry (纹理面)', () => {
  it('every vertex lies on the ellipsoid', () => {
    const model = createProjectionModel({ axialLength: 24, fov: 200 });
    const geo = createRetinalSphereGeometry(model, 32);
    const p = geo.attributes.position.array;

    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];

      const phi = Math.atan2(y, x);
      const a = meridianSemiAxis(model.semiAxes, phi * RAD);
      const c = model.semiAxes.axial;

      // 椭球方程: (x²+y²)/a² + z²/c² = 1
      const lhs = (x * x + y * y) / (a * a) + (z * z) / (c * c);
      expect(lhs).toBeCloseTo(1, 6);
    }
    geo.dispose();
  });

  it('keeps the macula at (0, 0, -c)', () => {
    const model = createProjectionModel({ axialLength: 24, fov: 200, maculaX: 0.5, maculaY: 0.5 });
    const geo = createRetinalSphereGeometry(model, 16);
    const p = geo.attributes.position.array;

    // 中心格点 (u=v=0.5) 应落在后极
    const mid = Math.floor(16 / 2) * (16 + 1) * 3 + Math.floor(16 / 2) * 3;
    expect(p[mid]).toBeCloseTo(0, 6);
    expect(p[mid + 1]).toBeCloseTo(0, 6);
    expect(p[mid + 2]).toBeCloseTo(-model.semiAxes.axial, 5);

    geo.dispose();
  });
});
