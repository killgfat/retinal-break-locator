/**
 * 眼底球面映射系统 - 主入口
 */

import { initVisualization, updateTexture, setDisplayMode, dispose, setMarkers } from './visualize.js';
import { 
  mapToSphere, 
  calculateRetinalParameters, 
  calculateMaculaFromDisc,
  imageToSphere,
  getAnatomyReference,
  calculateBreakToMacula,
  calculateLimbusDistance,
  getClockHourPosition,
  calculateEyeGeometry
} from './mapper.js';

let currentImage = null;
let currentImageData = null;

const markers = {
  macula: { x: 0.5, y: 0.5, set: true },
  disc: { x: null, y: null, set: false },
  hole: { x: null, y: null, set: false }
};
let currentMarkerMode = null;

const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const processBtn = document.getElementById('process-btn');
const loading = document.getElementById('loading');
const infoPanel = document.getElementById('info-panel');
const axialLengthInput = document.getElementById('axial-length');
const anteriorChamberDepthInput = document.getElementById('anterior-chamber-depth');
const corneaDiameterInput = document.getElementById('cornea-diameter');
const fovInput = document.getElementById('fov');
const displayModeSelect = document.getElementById('display-mode');
const imagePreview = document.getElementById('image-preview');
const calcFromDiscBtn = document.getElementById('calc-from-disc-btn');
const clearMarkersBtn = document.getElementById('clear-markers-btn');
const holeInfoPanel = document.getElementById('hole-info');

function init() {
  initVisualization();
  setupEventListeners();
  updateInfo();
}

function getAnteriorChamberDepth() {
  const value = parseFloat(anteriorChamberDepthInput.value);
  return isNaN(value) || value === 0 ? null : value;
}

function getCorneaDiameter() {
  const value = parseFloat(corneaDiameterInput.value);
  return isNaN(value) || value === 0 ? null : value;
}

function setupEventListeners() {
  uploadArea.addEventListener('click', () => fileInput.click());
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#667eea';
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '#444';
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#444';
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });
  
  processBtn.addEventListener('click', processImage);
  
  axialLengthInput.addEventListener('change', updateInfo);
  anteriorChamberDepthInput.addEventListener('change', updateInfo);
  corneaDiameterInput.addEventListener('change', updateInfo);
  fovInput.addEventListener('change', updateInfo);
  
  displayModeSelect.addEventListener('change', (e) => {
    setDisplayMode(e.target.value);
  });
  
  document.querySelectorAll('.marker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const markerType = btn.dataset.marker;
      setMarkerMode(markerType);
    });
  });
  
  imagePreview.addEventListener('click', handleImageClick);
  
  calcFromDiscBtn.addEventListener('click', calculateMaculaFromDiscPosition);
  
  clearMarkersBtn.addEventListener('click', clearAllMarkers);
}

function setMarkerMode(mode) {
  document.querySelectorAll('.marker-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.marker === mode);
  });
  currentMarkerMode = currentMarkerMode === mode ? null : mode;
}

function handleImageClick(e) {
  if (!currentImage || !currentMarkerMode) return;
  
  const rect = imagePreview.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  
  markers[currentMarkerMode] = { 
    x: Math.max(0, Math.min(1, x)), 
    y: Math.max(0, Math.min(1, y)), 
    set: true 
  };
  
  updateMarkerDisplay();
  updatePreviewMarkers();
  updateHoleInfo();
  
  if (currentMarkerMode === 'disc') {
    calcFromDiscBtn.disabled = false;
  }
}

function updateMarkerDisplay() {
  const maculaCoords = document.getElementById('macula-coords');
  const discCoords = document.getElementById('disc-coords');
  const holeCoords = document.getElementById('hole-coords');
  const eyeSideRow = document.getElementById('eye-side-row');
  const eyeSideEl = document.getElementById('eye-side');
  
  maculaCoords.textContent = `(${markers.macula.x.toFixed(3)}, ${markers.macula.y.toFixed(3)})`;
  
  if (markers.disc.set) {
    discCoords.textContent = `(${markers.disc.x.toFixed(3)}, ${markers.disc.y.toFixed(3)})`;
    
    const eyeSide = detectEyeSide(markers.macula, markers.disc);
    eyeSideEl.textContent = eyeSide;
    eyeSideRow.style.display = 'flex';
  } else {
    discCoords.textContent = '未设置';
    eyeSideRow.style.display = 'none';
  }
  
  if (markers.hole.set) {
    holeCoords.textContent = `(${markers.hole.x.toFixed(3)}, ${markers.hole.y.toFixed(3)})`;
  } else {
    holeCoords.textContent = '未设置';
  }
}

function detectEyeSide(macula, disc) {
  const dx = disc.x - macula.x;
  
  if (Math.abs(dx) < 0.05) {
    return '无法判断 (视盘与黄斑水平位置接近)';
  }
  
  // 眼底图像中: 视盘在鼻侧
  // - 右眼: 鼻侧在图像右侧 (disc.x > macula.x)
  // - 左眼: 鼻侧在图像左侧 (disc.x < macula.x)
  if (dx > 0) {
    return '右眼 (OD)';
  } else {
    return '左眼 (OS)';
  }
}

function updatePreviewMarkers() {
  const preview = document.getElementById('image-preview');
  
  document.querySelectorAll('.marker-point, .marker-label').forEach(el => el.remove());
  
  if (markers.macula.set) {
    addMarkerPoint(preview, markers.macula.x, markers.macula.y, 'macula', '黄斑');
  }
  
  if (markers.disc.set) {
    addMarkerPoint(preview, markers.disc.x, markers.disc.y, 'disc', '视盘');
  }
  
  if (markers.hole.set) {
    addMarkerPoint(preview, markers.hole.x, markers.hole.y, 'hole', '裂孔');
  }
  
  if (currentImage) {
    updateVisualizationMarkers();
  }
}

function addMarkerPoint(container, x, y, type, label) {
  const point = document.createElement('div');
  point.className = `marker-point ${type}`;
  point.style.left = `${x * 100}%`;
  point.style.top = `${y * 100}%`;
  container.appendChild(point);
  
  const labelEl = document.createElement('div');
  labelEl.className = 'marker-label';
  labelEl.textContent = label;
  labelEl.style.left = `${(x * 100) + 2}%`;
  labelEl.style.top = `${(y * 100) - 5}%`;
  container.appendChild(labelEl);
}

function updateVisualizationMarkers() {
  const markerData = {
    macula: markers.macula.set ? { x: markers.macula.x, y: markers.macula.y } : null,
    disc: markers.disc.set ? { x: markers.disc.x, y: markers.disc.y } : null,
    hole: markers.hole.set ? { x: markers.hole.x, y: markers.hole.y } : null
  };
  
  setMarkers(markerData);
}

function updateHoleInfo() {
  if (!markers.hole.set) {
    holeInfoPanel.classList.remove('visible');
    return;
  }
  
  const fov = parseFloat(fovInput.value) || 200;
  const axialLength = parseFloat(axialLengthInput.value) || 24;
  const anteriorChamberDepth = getAnteriorChamberDepth();
  const corneaDiameter = getCorneaDiameter();
  const imageAspect = currentImage ? currentImage.width / currentImage.height : 1;
  
  let eyeSide = 'right';
  if (markers.disc.set && markers.macula.set) {
    const dx = markers.disc.x - markers.macula.x;
    if (dx > 0.05) eyeSide = 'right';
    else if (dx < -0.05) eyeSide = 'left';
  }
  
  const macula = { x: markers.macula.x, y: markers.macula.y };
  const disc = markers.disc.set ? { x: markers.disc.x, y: markers.disc.y } : undefined;
  
  const breakResult = calculateBreakToMacula(
    markers.hole.x,
    markers.hole.y,
    macula,
    disc,
    { axialLength, fov, imageAspect }
  );
  
  const limbusResult = calculateLimbusDistance(breakResult.angleDeg, axialLength, anteriorChamberDepth, corneaDiameter);
  
  const clockPosition = getClockHourPosition(breakResult.phi, eyeSide);
  
  const phiDeg = breakResult.phiDeg;
  let direction = '';
  if (Math.abs(phiDeg) < 22.5) direction = '颞侧';
  else if (Math.abs(phiDeg - 90) < 22.5) direction = '上方';
  else if (Math.abs(phiDeg + 90) < 22.5) direction = '下方';
  else if (Math.abs(phiDeg - 180) < 22.5 || Math.abs(phiDeg + 180) < 22.5) direction = '鼻侧';
  else if (phiDeg > 0 && phiDeg < 90) direction = '颞上';
  else if (phiDeg > 90) direction = '鼻上';
  else if (phiDeg < 0 && phiDeg > -90) direction = '颞下';
  else direction = '鼻下';
  
  document.getElementById('hole-distance').textContent = `${breakResult.distanceMm.toFixed(2)} mm (${breakResult.angleDeg.toFixed(1)}°)`;
  document.getElementById('hole-direction').textContent = `黄斑${direction}`;
  document.getElementById('hole-sphere').textContent = `θ=${breakResult.angleDeg.toFixed(1)}°, φ=${phiDeg.toFixed(1)}°`;
  document.getElementById('hole-limbus-distance').textContent = `${limbusResult.limbusToBreakMm.toFixed(2)} mm`;
  document.getElementById('hole-clock-position').textContent = clockPosition;
  
  holeInfoPanel.classList.add('visible');
}

function calculateMaculaFromDiscPosition() {
  if (!markers.disc.set || !currentImage) return;
  
  const fov = parseFloat(fovInput.value) || 200;
  const result = calculateMaculaFromDisc(
    markers.disc.x, 
    markers.disc.y, 
    fov, 
    currentImage.width, 
    currentImage.height
  );
  
  markers.macula = { x: result.maculaX, y: result.maculaY, set: true };
  
  updateMarkerDisplay();
  updatePreviewMarkers();
}

function clearAllMarkers() {
  markers.macula = { x: 0.5, y: 0.5, set: true };
  markers.disc = { x: null, y: null, set: false };
  markers.hole = { x: null, y: null, set: false };
  
  calcFromDiscBtn.disabled = true;
  currentMarkerMode = null;
  
  document.querySelectorAll('.marker-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  updateMarkerDisplay();
  updatePreviewMarkers();
  updateHoleInfo();
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showError('请上传图片文件');
    return;
  }
  
  loading.classList.add('active');
  document.querySelector('.loading p').textContent = '加载图像...';
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      currentImageData = e.target.result;
      finishImageLoad();
    };
    img.onerror = () => {
      loading.classList.remove('active');
      showError('图像加载失败');
    };
    img.src = e.target.result;
  };
  reader.onerror = () => {
    loading.classList.remove('active');
    showError('文件读取失败');
  };
  reader.readAsDataURL(file);
}

function finishImageLoad() {
  document.getElementById('img-size').textContent = `${currentImage.width} × ${currentImage.height}`;
  infoPanel.style.display = 'block';
  
  updateInfo();
  processBtn.disabled = false;
  
  imagePreview.innerHTML = `<img src="${currentImageData}" alt="预览图像">`;
  updatePreviewMarkers();
  
  const axialLength = parseFloat(axialLengthInput.value) || 24;
  const anteriorChamberDepth = getAnteriorChamberDepth();
  const corneaDiameter = getCorneaDiameter();
  const fov = parseFloat(fovInput.value) || 200;
  updateTexture(currentImage, { 
    fov, 
    axialLength,
    anteriorChamberDepth,
    corneaDiameter,
    maculaX: markers.macula.x,
    maculaY: markers.macula.y,
    discX: markers.disc.set ? markers.disc.x : null,
    discY: markers.disc.set ? markers.disc.y : null
  });
  updateVisualizationMarkers();
  
  loading.classList.remove('active');
  document.querySelector('.loading p').textContent = '处理中...';
}

function updateInfo() {
  const axialLength = parseFloat(axialLengthInput.value) || 24;
  const anteriorChamberDepth = getAnteriorChamberDepth();
  const corneaDiameter = getCorneaDiameter();
  const fov = parseFloat(fovInput.value) || 200;
  const imageWidth = currentImage ? currentImage.width : 2000;
  
  const params = calculateRetinalParameters(axialLength, fov, imageWidth);
  const eyeGeometry = calculateEyeGeometry(axialLength, anteriorChamberDepth, corneaDiameter);
  
  document.getElementById('retina-radius').textContent = `${eyeGeometry.retinalRadius.toFixed(2)} mm`;
  document.getElementById('pixel-scale').textContent = `${params.mmPerPixel.toFixed(4)} mm/px`;
  
  if (currentImage) {
    const axialLength = parseFloat(axialLengthInput.value) || 24;
    const anteriorChamberDepth = getAnteriorChamberDepth();
    const corneaDiameter = getCorneaDiameter();
    const fov = parseFloat(fovInput.value) || 200;
    updateTexture(currentImage, { 
      fov, 
      axialLength,
      anteriorChamberDepth,
      corneaDiameter,
      maculaX: markers.macula.x,
      maculaY: markers.macula.y,
      discX: markers.disc.set ? markers.disc.x : null,
      discY: markers.disc.set ? markers.disc.y : null
    });
  }
  
  if (markers.hole.set) {
    updateHoleInfo();
  }
}

function processImage() {
  if (!currentImage) return;
  
  loading.classList.add('active');
  processBtn.disabled = true;
  
  requestAnimationFrame(() => {
    try {
      const axialLength = parseFloat(axialLengthInput.value) || 24;
      const anteriorChamberDepth = getAnteriorChamberDepth();
      const corneaDiameter = getCorneaDiameter();
      const fov = parseFloat(fovInput.value) || 200;
      
      const options = {
        maculaX: markers.macula.x,
        maculaY: markers.macula.y
      };
      
      if (markers.disc.set) {
        options.discX = markers.disc.x;
        options.discY = markers.disc.y;
      }
      
      const sphereData = mapToSphere(currentImage, axialLength, fov, options);
      
      updateTexture(currentImage, { 
        fov, 
        axialLength,
        anteriorChamberDepth,
        corneaDiameter,
        maculaX: markers.macula.x,
        maculaY: markers.macula.y,
        discX: markers.disc.set ? markers.disc.x : null,
        discY: markers.disc.set ? markers.disc.y : null
      });
      updateVisualizationMarkers();
      
    } catch (error) {
      console.error('处理失败:', error);
      showError('图像处理失败: ' + error.message);
    } finally {
      loading.classList.remove('active');
      processBtn.disabled = false;
    }
  });
}

function showError(message) {
  alert(message);
}

window.addEventListener('beforeunload', dispose);

document.addEventListener('DOMContentLoaded', init);