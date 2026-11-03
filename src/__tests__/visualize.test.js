import { describe, it, expect } from 'vitest';
import { calculateEyeGeometry, createProjectionModel, meridianSemiAxis } from '../mapper.js';
import { createEyeballGeometry, createRetinalSphereGeometry } from '../visualize.js';

const RAD = 180 / Math.PI;
const segmentsLon = 96;   // 与 createEyeballGeometry 一致

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
    // 参考眼球用旋转对称椭球 (a = aH), 纵向也取 aH —— 三轴 + 圆形角膜缘
    // 无法同时满足, 0.7% 的纵向差异在视觉上不可见。测量链仍用三轴。
    expect(maxX).toBeCloseTo(g.equatorialRadius.horizontal, 2);
    expect(maxY).toBeCloseTo(g.equatorialRadius.horizontal, 2);
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
      // 主体 72×96×2 + 角膜球冠 24×96×2
      expect(geo.index.count / 3).toBe(72 * 96 * 2 + 24 * 96 * 2);
      geo.dispose();
    }
  });

  it('renders the corneal cap as a surface, not a single ring', () => {
    // 回归: 早期实现把「radial ≤ WTW/2 的前段顶点」改成球冠, 但 lat 每段约 2°,
    // 该判据只覆盖最后一圈, 结果只剩一个环 —— 视图上等于角膜消失。
    // 现在球冠是独立网格 (24 段), 顶点附近应有成片的顶点。
    const g = calculateEyeGeometry(24);
    const geo = createEyeballGeometry(g);
    const p = geo.attributes.position.array;

    let maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) maxZ = Math.max(maxZ, p[i + 2]);

    const halfWtw = g.corneaDiameter / 2;
    const apexRing = [];
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 2] > maxZ - 0.2) {
        apexRing.push(Math.hypot(p[i], p[i + 1]));
      }
    }
    // 顶点附近应是半径很小的一圈, 而不是一个孤立点
    expect(apexRing.length).toBeGreaterThan(50);
    expect(Math.max(...apexRing)).toBeLessThan(halfWtw * 0.35);
    geo.dispose();
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

      // 角膜缘那一圈必须存在且径向 ≈ WTW/2
      const halfWtw = g.corneaDiameter / 2;
      let foundLimbus = false;
      for (let i = 0; i < p.length; i += 3) {
        const rad = Math.hypot(p[i], p[i + 1]);
        if (Math.abs(rad - halfWtw) < 0.02 && p[i + 2] > 0) foundLimbus = true;
      }
      expect(foundLimbus).toBe(true);

      // 角膜必须有「面」而不是一个环: 顶点附近需有足够多的顶点
      let apexCount = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 2] > maxZ - 0.05) {
          apexCount++;
          expect(Math.hypot(p[i], p[i + 1])).toBeLessThan(halfWtw);
        }
      }
      expect(apexCount).toBeGreaterThan(20);

      geo.dispose();
    }
  });

  it('the anterior segment meets the cornea without a step at every meridian', () => {
    // 回归: 前段曾用球面 (半径 = 该子午线赤道半轴)。三轴椭球 aV > aH 时
    // (AL=30 纵向 aV=12.89), 球面到角膜缘 radial = 6.19, 而角膜固定 5.85,
    // 纵向出现 0.34mm 径向 + 0.62mm 轴向的台阶。
    // 现在前段是两端锚定的过渡面, 任何子午线都必须精确落在 (WTW/2, zLimbus)。
    for (const al of [20, 24, 26, 28, 30]) {
      const g = calculateEyeGeometry(al);
      const geo = createEyeballGeometry(g);
      const p = geo.attributes.position.array;
      const half = g.corneaDiameter / 2;

      const body = (72 + 1) * (96 + 1);
      let bMinR = Infinity, bMaxR = -Infinity;
      let bMinZ = Infinity, bMaxZ = -Infinity;

      // 主体最后一圈 (lat = latLimbus)
      for (let i = (body - segmentsLon - 1) * 3; i < body * 3; i += 3) {
        const r = Math.hypot(p[i], p[i + 1]);
        bMinR = Math.min(bMinR, r);
        bMaxR = Math.max(bMaxR, r);
        bMinZ = Math.min(bMinZ, p[i + 2]);
        bMaxZ = Math.max(bMaxZ, p[i + 2]);
      }

      expect(bMaxR - bMinR).toBeLessThan(1e-4);
      expect(bMaxZ - bMinZ).toBeLessThan(1e-4);
      expect(bMinR).toBeCloseTo(half, 4);

      geo.dispose();
    }
  });

  it('the whole globe profile is one smooth ellipse (no kinks)', () => {
    // 回归: 前段曾用球 / Hermite / smoothstep 拼接, 都在接缝处或末端留下
    // 折角、锥形或曲率突变。现在轮廓是单一椭圆, 曲率应连续变化。
    for (const al of [24, 30]) {
      const g = calculateEyeGeometry(al);
      const geo = createEyeballGeometry(g);
      const p = geo.attributes.position.array;

      const segLat = 72;
      const segLon = 96;
      const pts = [];
      for (let lat = 0; lat <= segLat; lat++) {
        const i = (lat * (segLon + 1)) * 3;
        pts.push([p[i], p[i + 2]]);
      }

      // 弦长应大致均匀 (参数角均匀采样)
      const lens = [];
      for (let i = 1; i < pts.length; i++) {
        lens.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      }
      const mn = Math.min(...lens);
      const mx = Math.max(...lens);
      expect(mx / mn).toBeLessThan(1.3);

      // 曲率 (二阶差分) 相邻跳变应很小
      const rhos = [];
      for (let i = 1; i < pts.length - 1; i++) {
        const [r0, z0] = pts[i - 1];
        const [r1, z1] = pts[i];
        const [r2, z2] = pts[i + 1];
        const ar = r1 - r0, az = z1 - z0;
        const br = r2 - r1, bz = z2 - z1;
        const cross = Math.abs(ar * bz - az * br);
        const len = Math.pow(ar * ar + az * az, 1.5);
        if (cross > 1e-12) rhos.push(len / cross);
      }
      let maxJump = 0;
      for (let i = 1; i < rhos.length; i++) {
        maxJump = Math.max(maxJump, Math.abs(rhos[i] - rhos[i - 1]) / rhos[i - 1]);
      }
      expect(maxJump).toBeLessThan(0.05);

      geo.dispose();
    }
  });

  it('the corneal cap meets the limbus without a gap', () => {
    // 球冠是独立网格, 边缘必须与主体最后一圈重合 (位置相同)
    for (const al of [20, 24, 30]) {
      const g = calculateEyeGeometry(al);
      const geo = createEyeballGeometry(g);
      const p = geo.attributes.position.array;
      const halfWtw = g.corneaDiameter / 2;

      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        const rad = Math.hypot(p[i], p[i + 1]);
        // 只看前半球: 后段 radial 也会经过 WTW/2, z 为负
        if (Math.abs(rad - halfWtw) < 1e-3 && p[i + 2] > 0) {
          minZ = Math.min(minZ, p[i + 2]);
          maxZ = Math.max(maxZ, p[i + 2]);
        }
      }
      // 主体最后一圈是离散采样, 略偏离 WTW/2; 球冠边缘精确。
      // 两者之差应远小于可见尺度 (<0.01mm)
      expect(maxZ - minZ).toBeLessThan(0.01);
      expect(maxZ).toBeGreaterThan(0);
      geo.dispose();
    }
  });

  it('the corneal apex protrudes by the corneal sagitta', () => {
    for (const al of [20, 24, 30]) {
      const g = calculateEyeGeometry(al);
      const geo = createEyeballGeometry(g);
      const p = geo.attributes.position.array;

      let maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 3) maxZ = Math.max(maxZ, p[i + 2]);

      const halfWtw = g.corneaDiameter / 2;
      const sag = g.corneaRadius -
        Math.sqrt(g.corneaRadius ** 2 - halfWtw ** 2);
      // 角膜顶点距角膜缘平面 = 矢高 (2.6mm 左右)
      const zLimbus = maxZ - sag;
      expect(zLimbus).toBeGreaterThan(0);
      expect(sag).toBeCloseTo(2.63, 1);
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
