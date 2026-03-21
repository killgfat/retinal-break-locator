/**
 * 眼底球面映射系统 - Three.js 可视化模块
 * 
 * 关键概念:
 * - 使用方位角等距投影 (Azimuthal Equidistant Projection)
 * - 黄斑位于球体后极 (z = R)
 * - 图像以黄斑为中心，而非相机光轴
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DISC_TO_MACULA_ANGLE = 18.7;

let scene, camera, renderer, controls;
let currentTexture = null;
let sphereMesh = null;
let flatMesh = null;
let displayMode = 'sphere';
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
  
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(0, 0, 1);
  
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);
  
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.5;
  controls.maxDistance = 20;
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(0, 0, 20);
  scene.add(directionalLight);
  
  createReferenceSphere();
  
  window.addEventListener('resize', onWindowResize);
  
  animate();
}

function createReferenceSphere() {
  const referenceGeometry = new THREE.SphereGeometry(12, 32, 32);
  const referenceMaterial = new THREE.MeshBasicMaterial({
    color: 0x333366,
    wireframe: true,
    transparent: true,
    opacity: 0.3
  });
  const referenceSphere = new THREE.Mesh(referenceGeometry, referenceMaterial);
  scene.add(referenceSphere);
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
 * 使用方位角等距投影，黄斑位于后极
 * 
 * @param {number} radius - 视网膜半径 (mm)
 * @param {number} fov - 视场角 (度)
 * @param {number} segments - 球体分段数
 * @param {number} maculaX - 黄斑在图像中的 x 位置 (0-1)
 * @param {number} maculaY - 黄斑在图像中的 y 位置 (0-1)
 * @returns {THREE.BufferGeometry} 自定义几何体
 */
function createRetinalSphereGeometry(radius = 12, fov = 200, segments = 128, maculaX = 0.5, maculaY = 0.5, discX = null, discY = null, imageAspect = 1) {
  const geometry = new THREE.BufferGeometry();
  
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  
  let maxTheta;
  let maxNormalizedRadius;
  
  if (discX !== null && discY !== null) {
    const dx = (discX - maculaX) * imageAspect;
    const dy = (discY - maculaY);
    const discToMaculaImageDist = Math.sqrt(dx * dx + dy * dy);
    maxTheta = DISC_TO_MACULA_ANGLE * (Math.PI / 180) / discToMaculaImageDist;
    maxNormalizedRadius = 1 / discToMaculaImageDist;
  } else {
    maxTheta = (fov / 2) * (Math.PI / 180);
    maxNormalizedRadius = 1;
  }
  
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j <= segments; j++) {
      const u = i / segments;
      const v = j / segments;
      
      // 宽高比修正：对于宽屏图像，水平方向应该覆盖更大角度
      const dx = (u - maculaX) * imageAspect;
      const dy = (v - maculaY);
      
      const r = Math.sqrt(dx * dx + dy * dy);
      const theta = r * maxTheta;
      const phi = Math.atan2(-dy, dx);
      
      const x = radius * Math.sin(theta) * Math.cos(phi);
      const y = radius * Math.sin(theta) * Math.sin(phi);
      const z = -radius * Math.cos(theta);
      
      vertices.push(x, y, z);
      
      if (theta > 0.001) {
        normals.push(
          -Math.sin(theta) * Math.cos(phi),
          -Math.sin(theta) * Math.sin(phi),
          Math.cos(theta)
        );
      } else {
        normals.push(0, 0, 1);
      }
      
      uvs.push(u, 1 - v);
    }
  }
  
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      
      const u_a = (i / segments - maculaX) * imageAspect;
      const v_a = (j / segments - maculaY);
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
  const { fov = 200, axialLength = 24, maculaX = 0.5, maculaY = 0.5, discX = null, discY = null } = options;
  const retinalRadius = axialLength / 2;
  const imageAspect = image.width / image.height;
  
  const texture = new THREE.Texture(image);
  texture.needsUpdate = true;
  currentTexture = { texture, image, fov, axialLength, maculaX, maculaY, discX, discY, imageAspect };
  
  if (sphereMesh) {
    scene.remove(sphereMesh);
    sphereMesh.geometry.dispose();
    sphereMesh.material.dispose();
  }
  
  if (flatMesh) {
    scene.remove(flatMesh);
    flatMesh.geometry.dispose();
    flatMesh.material.dispose();
  }
  
  if (displayMode === 'sphere' || displayMode === 'both') {
    createSphereMesh(texture, image, retinalRadius, fov, maculaX, maculaY, discX, discY, imageAspect);
  }
  
  if (displayMode === 'flat' || displayMode === 'both') {
    createFlatMesh(texture, image);
  }
}

function createSphereMesh(texture, image, radius, fov, maculaX, maculaY, discX, discY, imageAspect) {
  const geometry = createRetinalSphereGeometry(radius, fov, 128, maculaX, maculaY, discX, discY, imageAspect);
  
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

function createFlatMesh(texture, image) {
  const aspect = image.width / image.height;
  const geometry = new THREE.PlaneGeometry(20 * aspect, 20);
  
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide
  });
  
  flatMesh = new THREE.Mesh(geometry, material);
  flatMesh.position.x = 30;
  scene.add(flatMesh);
}

/**
 * 设置显示模式
 * @param {string} mode - 'sphere' | 'flat' | 'both'
 */
export function setDisplayMode(mode) {
  displayMode = mode;
  
  if (currentTexture) {
    const { texture, image, fov, axialLength, maculaX, maculaY, discX, discY, imageAspect } = currentTexture;
    const retinalRadius = axialLength / 2;
    
    if (sphereMesh) {
      scene.remove(sphereMesh);
      sphereMesh.geometry.dispose();
      sphereMesh.material.dispose();
      sphereMesh = null;
    }
    
    if (flatMesh) {
      scene.remove(flatMesh);
      flatMesh.geometry.dispose();
      flatMesh.material.dispose();
      flatMesh = null;
    }
    
    if (mode === 'sphere' || mode === 'both') {
      createSphereMesh(texture, image, retinalRadius, fov, maculaX, maculaY, discX, discY, imageAspect);
    }
    
    if (mode === 'flat' || mode === 'both') {
      createFlatMesh(texture, image);
    }
  }
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
 * @param {Object|null} markers.hole - 黄斑裂孔位置 {x, y} 归一化坐标
 */
export function setMarkers(markers) {
  const previousMacula = currentMarkers.macula;
  const previousDisc = currentMarkers.disc;
  currentMarkers = { ...markers };
  
  if (currentTexture && markers.macula) {
    const { texture, image, fov, axialLength, imageAspect } = currentTexture;
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
      
      const retinalRadius = axialLength / 2;
      createSphereMesh(texture, image, retinalRadius, fov, maculaX, maculaY, discX, discY, imageAspect);
    }
  }
  
  updateMarkerMeshes();
}

function updateMarkerMeshes() {
  if (!currentTexture) return;
  
  const { fov = 200, axialLength = 24, maculaX = 0.5, maculaY = 0.5, discX, discY, imageAspect = 1 } = currentTexture;
  const R = axialLength / 2;
  
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
  
  if (currentMarkers.macula) {
    markerMeshes.macula = createMarkerSphere(
      0, 0, -R,
      0xff6b6b,
      '黄斑'
    );
  }
  
  if (currentMarkers.disc) {
    const discPos = imageToSpherePosition(
      currentMarkers.disc.x, 
      currentMarkers.disc.y, 
      maculaX, maculaY, 
      R, fov, discX, discY, imageAspect
    );
    markerMeshes.disc = createMarkerSphere(
      discPos.x, discPos.y, discPos.z,
      0x4ecdc4,
      '视盘'
    );
  }
  
  if (currentMarkers.hole) {
    const holePos = imageToSpherePosition(
      currentMarkers.hole.x, 
      currentMarkers.hole.y, 
      maculaX, maculaY, 
      R, fov, discX, discY, imageAspect
    );
    markerMeshes.hole = createMarkerSphere(
      holePos.x, holePos.y, holePos.z,
      0xffe66d,
      '裂孔'
    );
  }
}

function imageToSpherePosition(x, y, maculaX, maculaY, R, fov, discX = null, discY = null, imageAspect = 1) {
  const dx = (x - maculaX) * imageAspect;
  const dy = (y - maculaY);
  
  const r = Math.sqrt(dx * dx + dy * dy);
  
  let maxTheta;
  if (discX !== null && discY !== null) {
    const ddx = (discX - maculaX) * imageAspect;
    const ddy = (discY - maculaY);
    const discToMaculaImageDist = Math.sqrt(ddx * ddx + ddy * ddy);
    maxTheta = DISC_TO_MACULA_ANGLE * (Math.PI / 180) / discToMaculaImageDist;
  } else {
    maxTheta = (fov / 2) * (Math.PI / 180);
  }
  
  const theta = r * maxTheta;
  const phi = Math.atan2(-dy, dx);
  
  return {
    x: R * Math.sin(theta) * Math.cos(phi),
    y: R * Math.sin(theta) * Math.sin(phi),
    z: -R * Math.cos(theta)
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

/**
 * 清理资源
 */
export function dispose() {
  if (sphereMesh) {
    scene.remove(sphereMesh);
    sphereMesh.geometry.dispose();
    sphereMesh.material.dispose();
  }
  
  if (flatMesh) {
    scene.remove(flatMesh);
    flatMesh.geometry.dispose();
    flatMesh.material.dispose();
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