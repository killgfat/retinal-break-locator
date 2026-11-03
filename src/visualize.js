/**
 * 眼底球面映射系统 - Three.js 可视化模块
 * 
 * 关键概念:
 * - 使用方位角等距投影 (Azimuthal Equidistant Projection)
 * - **投影极点 = 图像中心 (扫描光轴)**;黄斑只是测量原点,可以偏心
 * - 网格绕图像中心生成后,整体转到「黄斑正对相机」的朝向 (黄斑位于 z = -R)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ANATOMY,
  calculateEyeGeometry,
  createProjectionModel,
  meridianSemiAxis,
  surfacePoint
} from './mapper.js';

const DEG = Math.PI / 180;

// 所有图像距离 ↔ 角度的换算统一经由 mapper.createProjectionModel,
// 以保证 3D 视图与测量面板使用完全相同的几何模型。
let currentModel = null;
let currentEyeSide = 'right';

let scene, camera, renderer, controls;
let currentTexture = null;
let sphereMesh = null;
let corneaMesh = null;
let referenceSphere = null;
let limbusRing = null;
let limbusArcLine = null;
let currentEyeGeometry = null;
let markerMeshes = {
  macula: null,
  disc: null,
  hole: null
};
let currentMarkers = {
  macula: null,
  disc: null,
  hole: null
};

/**
 * 初始化 Three.js 场景
 */
export function initVisualization() {
  const container = document.getElementById('canvas-container');
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0f23);
  
  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(0, 0, 30);
  
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);
  
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 15;
  controls.maxDistance = 50;
  controls.target.set(0, 0, 0);
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(0, 0, 20);
  scene.add(directionalLight);
  
  currentEyeGeometry = calculateEyeGeometry(24, null, null);
  createReferenceSphere(currentEyeGeometry);
  createCornea(currentEyeGeometry);
  
  window.addEventListener('resize', onWindowResize);
  
  animate();
}

function createReferenceSphere(eyeGeometry) {
  if (referenceSphere) {
    scene.remove(referenceSphere);
    referenceSphere.geometry.dispose();
    referenceSphere.material.dispose();
  }
  
  const geometry = createEyeballGeometry(eyeGeometry);
  
  const material = new THREE.MeshBasicMaterial({
    color: 0x333366,
    wireframe: true,
    transparent: true,
    opacity: 0.3
  });
  referenceSphere = new THREE.Mesh(geometry, material);
  scene.add(referenceSphere);
}

/**
 * 眼球轮廓几何 —— 三段式
 *
 *   lat = 0                 后极
 *   lat ≤ 90°               后段: 扁椭球 (赤道半轴 a(λ), 前后半轴 c)
 *   lat = 90°               赤道 (接缝)
 *   90° < lat < latLimbus   前段: 球, 半径 anteriorRadius
 *   最前一圈                角膜球冠
 *
 * 以黄斑为 lat = 0 的极点生成 (与渲染约定一致: 黄斑朝 -z)。
 * 方位方向用该子午线的椭球赤道半轴, 因此横向 ≠ 纵向 (三轴) 能表达。
 *
 * ⚠️ 前段的 lat 跨度由解剖弧长 limbusToEquatorArc / anteriorRadius 决定,
 * 与 mapper 的内表面分段一致 (不用等效球反推的 limbusPolarAngle)。
 */
export function createEyeballGeometry(eyeGeometry) {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const indices = [];

  const segmentsLat = 72;
  const segmentsLon = 96;

  const {
    semiAxes,
    anteriorRadius,
    limbusToEquatorArc,
    corneaRadius,
    corneaDiameter
  } = eyeGeometry;

  const halfCornea = corneaDiameter / 2;
  const latEquator = Math.PI / 2;

  // 前段可视化用等效球极角 (与角膜直径自洽: sin(lat) = WTW/2 / R_ant)
  const latLimbus = eyeGeometry.limbusPolarAngle;
  const limbusRingRadius = anteriorRadius * Math.sin(latLimbus);
  // 角膜缘处的轴向坐标 (黄斑方向为正, 前方为负)
  const axialLimbus = anteriorRadius * Math.cos(latLimbus);
  const corneaSag = corneaRadius - Math.sqrt(Math.max(0,
    corneaRadius * corneaRadius - Math.min(corneaRadius, limbusRingRadius) ** 2));
  // 角膜顶点比角膜缘更靠前 ⇒ 更负
  const corneaApex = axialLimbus - corneaSag;

  for (let lat = 0; lat <= segmentsLat; lat++) {
    const latAngle = (lat / segmentsLat) * latLimbus;

    for (let lon = 0; lon <= segmentsLon; lon++) {
      const lonAngle = (lon / segmentsLon) * 2 * Math.PI;
      const cosLon = Math.cos(lonAngle);
      const sinLon = Math.sin(lonAngle);

      const a = meridianSemiAxis(semiAxes, lonAngle * 180 / Math.PI);
      const c = semiAxes.axial;

      let radial, axial;

      if (latAngle <= latEquator) {
        // 椭圆参数式: tan θ = (c/a)·tan t
        const t = Math.atan2(a * Math.sin(latAngle), c * Math.cos(latAngle));
        radial = a * Math.sin(t);
        axial = c * Math.cos(t);
      } else {
        // 前段用该子午线的赤道半轴, 保证在 lat=90° 处与椭球连续
        // (横向 aH ≠ 纵向 aV, 若统一用 aH 会在纵向产生 0.08mm 跳变)
        radial = a * Math.sin(latAngle);
        axial = a * Math.cos(latAngle);
      }

      // 角膜球冠 (最前一圈): 极径 ≤ 角膜半径的前段顶点改成球冠
      if (latAngle > latEquator && radial <= halfCornea) {
        const localR = radial;
        axial = corneaApex + corneaRadius -
          Math.sqrt(Math.max(0, corneaRadius * corneaRadius - localR * localR));
      }

      vertices.push(radial * cosLon, radial * sinLon, -axial);
    }
  }
  
  for (let lat = 0; lat < segmentsLat; lat++) {
    for (let lon = 0; lon < segmentsLon; lon++) {
      const a = lat * (segmentsLon + 1) + lon;
      const b = a + 1;
      const c = a + segmentsLon + 1;
      const d = c + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  return geometry;
}

function createCornea(eyeGeometry) {
  if (corneaMesh) {
    scene.remove(corneaMesh);
    corneaMesh.geometry.dispose();
    corneaMesh.material.dispose();
    corneaMesh = null;
  }
  
  if (limbusRing) {
    scene.remove(limbusRing);
    limbusRing.geometry.dispose();
    limbusRing.material.dispose();
    limbusRing = null;
  }
  
  const { anteriorRadius, corneaDiameter } = eyeGeometry;
  const halfCorneaDiameter = corneaDiameter / 2;

  // 角膜缘圈: 前段球上极角 limbusPolarAngle 处的纬圈 (与角膜直径自洽)
  const latLimbus = eyeGeometry.limbusPolarAngle;
  const limbusRingRadius = Math.min(halfCorneaDiameter,
    anteriorRadius * Math.sin(latLimbus));
  const zAtLimbus = -anteriorRadius * Math.cos(latLimbus);

  const ringGeometry = new THREE.TorusGeometry(limbusRingRadius, 0.08, 16, 64);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x333366,
    transparent: true,
    opacity: 0.9
  });
  limbusRing = new THREE.Mesh(ringGeometry, ringMaterial);
  limbusRing.position.set(0, 0, zAtLimbus);
  scene.add(limbusRing);
}

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

/**
 * 创建视网膜投影球体几何
 *
 * 极点 = 图像中心 (扫描光轴);角度换算全部委托给 mapper 的投影模型,
 * 再经黄斑测量框架定向, 使黄斑恒位于本模块的后极 (0, 0, -R)。
 * 本函数只负责把 (角度, 方位) 铺成网格。
 *
 * @param {Object} model - mapper.createProjectionModel() 的返回值
 * @param {number} segments - 球体分段数
 * @returns {THREE.BufferGeometry} 自定义几何体
 */
export function createRetinalSphereGeometry(model, segments = 128) {
  const geometry = new THREE.BufferGeometry();

  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const radius = model.R;

  // 只绘制标称视场以内的部分
  const maxNormalizedRadius = model.maxDist;

  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j <= segments; j++) {
      const u = i / segments;
      const v = j / segments;

      // 绕图像中心解投影 → 黄斑基准 (球心角, 方位)
      const p = model.unproject(u, v);
      const m = model.toMaculaFrame(p.u);

      // 球心角 + 方位 → 椭球面点 (黄斑 = 极点)
      const sp = surfacePoint(m.theta, m.phi, model.semiAxes);

      // 渲染约定: 黄斑朝 -z
      const x = sp.radial * Math.cos(m.phi);
      const y = sp.radial * Math.sin(m.phi);
      const z = -sp.axial;

      vertices.push(x, y, z);

      // 内表面法线 = −∇F, F = (x²+y²)/a² + z²/c²。
      // 扁椭球赤道附近 "指向球心" 的近似会偏约 7°, 用梯度才与几何一致。
      const gx = x / (sp.semiAxis * sp.semiAxis);
      const gy = y / (sp.semiAxis * sp.semiAxis);
      const gz = z / (model.semiAxes.axial * model.semiAxes.axial);
      const gLen = Math.hypot(gx, gy, gz) || 1;
      normals.push(-gx / gLen, -gy / gLen, -gz / gLen);

      uvs.push(u, 1 - v);
    }
  }
  
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;

      // 剔除标称视场外的单元 (距离自图像中心量起)
      const u_a = (i / segments - 0.5) * model.imageAspect;
      const v_a = (j / segments - 0.5);
      const r_a = Math.sqrt(u_a * u_a + v_a * v_a);

      if (r_a <= maxNormalizedRadius) {
        indices.push(a, b, d);
        indices.push(a, d, c);
      }
    }
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  
  return geometry;
}

/**
 * 更新纹理图像
 * @param {HTMLImageElement} image - 输入图像
 * @param {Object} options - 可选参数
 * @param {number} options.fov - 视场角 (度)
 * @param {number} options.axialLength - 眼轴长度 (mm)
 * @param {number} options.maculaX - 黄斑 x 位置 (0-1)
 * @param {number} options.maculaY - 黄斑 y 位置 (0-1)
 */
export function updateTexture(image, options = {}) {
  const {
    fov = 200,
    axialLength = 24,
    corneaDiameter = null,
    corneaKValue = null,
    projection,
    equatorialDiameter = null,
    equatorialDiameterSurface,
    sphericalEquivalent = null,
    maculaX = 0.5,
    maculaY = 0.5,
    discX = null,
    discY = null
  } = options;

  const imageAspect = image.width / image.height;

  currentModel = createProjectionModel({
    axialLength, fov, corneaDiameter, corneaKValue, projection,
    equatorialDiameter, equatorialDiameterSurface, sphericalEquivalent,
    maculaX, maculaY, discX, discY, imageAspect
  });
  currentEyeGeometry = currentModel.eyeGeometry;

  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;
  currentTexture = {
    texture,
    image,
    fov,
    axialLength,
    corneaDiameter,
    corneaKValue,
    projection,
    equatorialDiameter,
    equatorialDiameterSurface,
    sphericalEquivalent,
    maculaX,
    maculaY,
    discX,
    discY,
    imageAspect
  };

  if (sphereMesh) {
    scene.remove(sphereMesh);
    sphereMesh.geometry.dispose();
    sphereMesh.material.dispose();
  }
  
  createReferenceSphere(currentEyeGeometry);
  createCornea(currentEyeGeometry);

  createSphereMesh(texture, currentModel);
}

function createSphereMesh(texture, model) {
  const geometry = createRetinalSphereGeometry(model, 128);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.FrontSide,
    roughness: 0.8,
    metalness: 0.1,
    transparent: true
  });
  
  sphereMesh = new THREE.Mesh(geometry, material);
  scene.add(sphereMesh);
}

/**
 * 获取场景对象（用于调试）
 */
export function getScene() {
  return scene;
}

/**
 * 设置标记点位置
 * @param {Object} markers - 标记点数据
 * @param {Object|null} markers.macula - 黄斑位置 {x, y} 归一化坐标
 * @param {Object|null} markers.disc - 视盘位置 {x, y} 归一化坐标
 * @param {Object|null} markers.hole - 视网膜裂孔位置 {x, y} 归一化坐标
 * @param {Object} options - {eyeSide} 用于黄线的 angle alpha 修正
 */
export function setMarkers(markers, options = {}) {
  if (options.eyeSide) currentEyeSide = options.eyeSide;

  const previousMacula = currentMarkers.macula;
  const previousDisc = currentMarkers.disc;
  currentMarkers = { ...markers };
  
  if (currentTexture && markers.macula) {
    const {
      texture, fov, axialLength, corneaDiameter, corneaKValue, projection,
      equatorialDiameter, equatorialDiameterSurface, sphericalEquivalent, imageAspect
    } = currentTexture;
    const { x: maculaX, y: maculaY } = markers.macula;
    const discX = markers.disc ? markers.disc.x : null;
    const discY = markers.disc ? markers.disc.y : null;
    
    const maculaChanged = !previousMacula || 
      previousMacula.x !== markers.macula.x || 
      previousMacula.y !== markers.macula.y;
    
    const discChanged = (markers.disc && !previousDisc) ||
      (!markers.disc && previousDisc) ||
      (markers.disc && previousDisc && 
        (previousDisc.x !== markers.disc.x || previousDisc.y !== markers.disc.y));
    
    if (maculaChanged || discChanged) {
      currentTexture.maculaX = maculaX;
      currentTexture.maculaY = maculaY;
      currentTexture.discX = discX;
      currentTexture.discY = discY;
      
      if (sphereMesh) {
        scene.remove(sphereMesh);
        sphereMesh.geometry.dispose();
        sphereMesh.material.dispose();
        sphereMesh = null;
      }
      
      currentModel = createProjectionModel({
        axialLength, fov, corneaDiameter, corneaKValue, projection,
        equatorialDiameter, equatorialDiameterSurface, sphericalEquivalent,
        maculaX, maculaY, discX, discY, imageAspect
      });
      currentEyeGeometry = currentModel.eyeGeometry;
      createSphereMesh(texture, currentModel);
    }
  }
  
  updateMarkerMeshes();
}

function updateMarkerMeshes() {
  if (!currentTexture || !currentEyeGeometry || !currentModel) return;

  const { semiAxes } = currentModel;

  Object.keys(markerMeshes).forEach(type => {
    if (markerMeshes[type]) {
      scene.remove(markerMeshes[type]);
      markerMeshes[type].traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      markerMeshes[type] = null;
    }
  });
  
  if (limbusArcLine) {
    scene.remove(limbusArcLine);
    limbusArcLine.geometry.dispose();
    limbusArcLine.material.dispose();
    limbusArcLine = null;
  }
  
  if (currentMarkers.macula) {
    // 黄斑基准系的正极 ⇒ 定向后恒在 (0, 0, -c)
    markerMeshes.macula = createMarkerSphere(
      0, 0, -semiAxes.axial,
      0xff6b6b,
      '黄斑'
    );
  }
  
  if (currentMarkers.disc) {
    const discPos = imageToSpherePosition(currentMarkers.disc.x, currentMarkers.disc.y, currentModel);
    markerMeshes.disc = createMarkerSphere(
      discPos.x, discPos.y, discPos.z,
      0x4ecdc4,
      '视盘'
    );
  }
  
  if (currentMarkers.hole) {
    const holePos = imageToSpherePosition(currentMarkers.hole.x, currentMarkers.hole.y, currentModel);
    markerMeshes.hole = createMarkerSphere(
      holePos.x, holePos.y, holePos.z,
      0xffe66d,
      '裂孔'
    );
    
    limbusArcLine = createLimbusArcLine(currentModel, currentEyeSide);
  }
}

/**
 * 图像归一化坐标 → 场景笛卡尔坐标
 * 经黄斑测量框架定向 (黄斑正对相机), 本模块黄斑位于 z = -R;
 * 与 mapper 的黄斑基准笛卡尔 (z = +R) 差一个 z 翻转。
 */
function imageToSpherePosition(x, y, model) {
  const p = model.unproject(x, y);
  const m = model.toMaculaFrame(p.u);

  // 落在椭球面上, 而不是球面
  const sp = surfacePoint(m.theta, m.phi, model.semiAxes);

  return {
    x: sp.radial * Math.cos(m.phi),
    y: sp.radial * Math.sin(m.phi),
    z: -sp.axial
  };
}

function createMarkerSphere(x, y, z, color, label) {
  const geometry = new THREE.SphereGeometry(0.4, 16, 16);
  const material = new THREE.MeshBasicMaterial({ 
    color: color,
    transparent: true,
    opacity: 0.9
  });
  const sphere = new THREE.Mesh(geometry, material);
  sphere.position.set(x, y, z);
  
  const ringGeometry = new THREE.RingGeometry(0.6, 0.8, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({ 
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.set(x, y, z);
  ring.lookAt(0, 0, 0);
  
  const group = new THREE.Group();
  group.add(sphere);
  group.add(ring);
  
  scene.add(group);
  
  return group;
}

function createLimbusArcLine(model, eyeSide) {
  if (!currentMarkers.hole) return null;

  // 裂孔向量 (黄斑基准系: 黄斑 = +z)
  const p = model.unproject(currentMarkers.hole.x, currentMarkers.hole.y);
  const m = model.toMaculaFrame(p.u);
  const uH = { x: m.x / model.R, y: m.y / model.R, z: m.z / model.R };

  // 光轴极点 = 黄斑向鼻侧转 angle alpha; 角膜缘是绕光轴的等纬圆
  const alpha = ANATOMY.angleAlpha * DEG;
  const phiNasal = eyeSide === 'right' ? 0 : Math.PI;
  const uAxis = {
    x: Math.sin(alpha) * Math.cos(phiNasal),
    y: Math.sin(alpha) * Math.sin(phiNasal),
    z: Math.cos(alpha)
  };

  const cosStart = uH.x * uAxis.x + uH.y * uAxis.y + uH.z * uAxis.z;
  const startTheta = Math.acos(Math.max(-1, Math.min(1, cosStart)));
  // 角膜缘: 与 mapper 内表面同几何 (赤道 + 前段弧长/半径), 不用等效球反推
  const endTheta = currentEyeGeometry.limbusAngleAnterior;

  if (!(endTheta > startTheta)) return null;

  // 大圆方向: 裂孔在光轴极点切平面内的分量
  let e1 = {
    x: uH.x - cosStart * uAxis.x,
    y: uH.y - cosStart * uAxis.y,
    z: uH.z - cosStart * uAxis.z
  };
  const e1Len = Math.sqrt(e1.x * e1.x + e1.y * e1.y + e1.z * e1.z);
  if (e1Len < 1e-9) return null; // 裂孔恰在光轴极点上, 方向不定
  e1 = { x: e1.x / e1Len, y: e1.y / e1Len, z: e1.z / e1Len };

  const points = [];
  const segments = 64;

  // 黄斑基准系内的方位: 由切平面基底的 x/y 分量给出
  // (uAxis 与 e1 张成该路径所在的大圆平面, 与 mapper 的分段弧长同一子午线)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const theta = startTheta + t * (endTheta - startTheta);
    const s = Math.sin(theta);
    const c = Math.cos(theta);

    // 该点相对黄斑的方位 (用于查椭球子午线半轴)
    const radialDir = {
      x: s * e1.x + c * uAxis.x,
      y: s * e1.y + c * uAxis.y,
      z: s * e1.z + c * uAxis.z
    };
    const phi = Math.atan2(radialDir.y, radialDir.x);

    // 椭球面上的点 (theta 已含 alpha 修正)
    const sp = surfacePoint(theta, phi, model.semiAxes);

    points.push(new THREE.Vector3(
      sp.radial * Math.cos(phi),
      sp.radial * Math.sin(phi),
      -sp.axial
    ));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0xffe66d,
    linewidth: 1
  });

  const line = new THREE.Line(geometry, material);
  scene.add(line);

  return line;
}

/**
 * 清理资源
 */
export function dispose() {
  if (sphereMesh) {
    scene.remove(sphereMesh);
    sphereMesh.geometry.dispose();
    sphereMesh.material.dispose();
  }
  
  if (corneaMesh) {
    scene.remove(corneaMesh);
    corneaMesh.geometry.dispose();
    corneaMesh.material.dispose();
  }
  
  if (limbusRing) {
    scene.remove(limbusRing);
    limbusRing.geometry.dispose();
    limbusRing.material.dispose();
  }
  
  if (limbusArcLine) {
    scene.remove(limbusArcLine);
    limbusArcLine.geometry.dispose();
    limbusArcLine.material.dispose();
  }
  
  if (referenceSphere) {
    scene.remove(referenceSphere);
    referenceSphere.geometry.dispose();
    referenceSphere.material.dispose();
  }
  
  Object.values(markerMeshes).forEach(mesh => {
    if (mesh) {
      scene.remove(mesh);
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
  });
  
  if (currentTexture && currentTexture.texture) {
    currentTexture.texture.dispose();
  }
  
  renderer.dispose();
}