// main.js - 優化版疊疊樂遊戲
import * as THREE from './libs/three.module.min.js';
import * as CANNON from './libs/cannon-es.js';

// 遊戲配置
const CONFIG = {
  BLOCK_SIZE: { x: 0.9, y: 0.3, z: 0.3 },
  BLOCK_GAP: 0.05,
  // 垂直層與層之間的間距，設為 0 讓積木貼合
  LAYER_GAP: 0,
  LAYERS: 18,
  BLOCKS_PER_LAYER: 3,
  // 物理地面厚度為0.2，中心位於Y=0，
  // 因此塔底中心需在地面頂部(0.1)再加半塊積木(0.15)的高度
  // 否則塔會在建立時直接落下導致積木散落
  TOWER_BASE_Y: 0.25,
  PHYSICS: {
    GRAVITY: -12,
    TIME_STEP: 1 / 60,
    ITERATIONS: 10
  },
  CAMERA: {
    FOV: 45,
    NEAR: 0.1,
    FAR: 100,
    POSITION: new THREE.Vector3(3, 6, 10),
    TARGET: new THREE.Vector3(0, 3, 0)
  },
  COLORS: {
    BACKGROUND: 0x312012,
    GROUND: 0x6c4c1b,
    HIGHLIGHT: 0xffff00,
    VALID_PLACEMENT: 0x00ff00,
    INVALID_PLACEMENT: 0xff0000
  }
};

// 遊戲狀態
class GameState {
  constructor() {
    this.isGameOver = false;
    this.selectedBlock = null;
    this.isDragging = false;
    this.dragPlane = null;
    this.score = 0;
    this.moves = 0;
    this.topLayer = CONFIG.LAYERS - 1;
  }

  reset() {
    this.isGameOver = false;
    this.selectedBlock = null;
    this.isDragging = false;
    this.score = 0;
    this.moves = 0;
    this.topLayer = CONFIG.LAYERS - 1;
  }
}

// 主遊戲類
class JengaGame {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.world = null;
    this.blocks = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.gameState = new GameState();
    this.materials = {};
    this.outlineMaterial = null;
    this.placementIndicator = null;
    
    this.init();
  }

  async init() {
    this.setupScene();
    this.setupPhysics();
    this.setupLights();
    this.setupGround();
    this.setupMaterials();
    await this.loadTextures();
    this.buildTower();
    await this.setupControls();
    this.setupEventListeners();
    this.setupUI();
    this.animate();
  }

  setupScene() {
    // 場景設置
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.COLORS.BACKGROUND);
    this.scene.fog = new THREE.Fog(CONFIG.COLORS.BACKGROUND, 10, 50);

    // 相機設置
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA.FOV,
      window.innerWidth / window.innerHeight,
      CONFIG.CAMERA.NEAR,
      CONFIG.CAMERA.FAR
    );
    this.camera.position.copy(CONFIG.CAMERA.POSITION);
    this.camera.lookAt(CONFIG.CAMERA.TARGET);

    // 渲染器設置
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-container').appendChild(this.renderer.domElement);
  }

  setupPhysics() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, CONFIG.PHYSICS.GRAVITY, 0),
      broadphase: new CANNON.SAPBroadphase(),
      allowSleep: true
    });
    
    // 設置物理材質
    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(
      defaultMaterial,
      defaultMaterial,
      {
        friction: 0.4,
        restitution: 0.2
      }
    );
    this.world.addContactMaterial(defaultContactMaterial);
    this.world.defaultContactMaterial = defaultContactMaterial;
  }

  setupLights() {
    // 環境光
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // 主方向光
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 8);
    dirLight.castShadow = true;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 20;
    dirLight.shadow.camera.left = -5;
    dirLight.shadow.camera.right = 5;
    dirLight.shadow.camera.top = 5;
    dirLight.shadow.camera.bottom = -5;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.scene.add(dirLight);

    // 補光
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-3, 5, -5);
    this.scene.add(fillLight);
  }

  setupGround() {
    // 物理地面
    const groundShape = new CANNON.Box(new CANNON.Vec3(5, 0.1, 5));
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: groundShape,
      type: CANNON.Body.STATIC
    });
    this.world.addBody(groundBody);

    // 視覺地面
    const groundGeo = new THREE.BoxGeometry(10, 0.2, 10);
    const groundMat = new THREE.MeshStandardMaterial({ 
      color: CONFIG.COLORS.GROUND,
      roughness: 0.8,
      metalness: 0.2
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = true;
    // 與物理地面一致，使塔底部不會嵌入地面
    groundMesh.position.y = 0;
    this.scene.add(groundMesh);
  }

  setupMaterials() {
    // 外框材質
    this.outlineMaterial = new THREE.MeshBasicMaterial({
      color: CONFIG.COLORS.HIGHLIGHT,
      side: THREE.BackSide
    });

    // 放置指示器
    const indicatorGeo = new THREE.BoxGeometry(
      CONFIG.BLOCK_SIZE.x * 1.02,
      CONFIG.BLOCK_SIZE.y * 1.02,
      CONFIG.BLOCK_SIZE.z * 1.02
    );
    const indicatorMat = new THREE.MeshBasicMaterial({
      color: CONFIG.COLORS.VALID_PLACEMENT,
      transparent: true,
      opacity: 0.3,
      depthWrite: false
    });
    this.placementIndicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    this.placementIndicator.visible = false;
    this.scene.add(this.placementIndicator);
  }

  async loadTextures() {
    const textureLoader = new THREE.TextureLoader();
    
    try {
      const woodTexture = await textureLoader.loadAsync('./assets/wood.jpg');
      woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
      
      this.materials.wood = new THREE.MeshStandardMaterial({
        map: woodTexture,
        roughness: 0.7,
        metalness: 0.1
      });
    } catch (error) {
      console.warn('無法載入木材紋理，使用預設材質');
      this.materials.wood = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.7,
        metalness: 0.1
      });
    }
  }

  buildTower() {
    let y = CONFIG.TOWER_BASE_Y;
    
    for (let layer = 0; layer < CONFIG.LAYERS; layer++) {
      const isEvenLayer = layer % 2 === 0;
      
      for (let i = 0; i < CONFIG.BLOCKS_PER_LAYER; i++) {
        const position = this.calculateBlockPosition(layer, i, y);
        const rotation = isEvenLayer ? 0 : Math.PI / 2;
        
        this.createBlock(position, rotation, layer, i);
      }
      
      y += CONFIG.BLOCK_SIZE.y + CONFIG.LAYER_GAP;
    }

    // 生成後啟用動態物理並讓積木保持休眠狀態
    this.blocks.forEach(block => {
      block.body.mass = 1;
      block.body.type = CANNON.Body.DYNAMIC;
      block.body.updateMassProperties();
      block.body.sleep();
    });
  }

  calculateBlockPosition(layer, index, y) {
    const isEvenLayer = layer % 2 === 0;
    const offset = (index - 1) * (CONFIG.BLOCK_SIZE.z + CONFIG.BLOCK_GAP);

    // 偶數層的積木長邊朝 X 軸，需沿著 Z 軸排列
    // 奇數層的積木長邊朝 Z 軸，需沿著 X 軸排列
    return new THREE.Vector3(
      isEvenLayer ? 0 : offset,
      y,
      isEvenLayer ? offset : 0
    );
  }

  createBlock(position, rotation, layer, index) {
    // Three.js 網格
    const geometry = new THREE.BoxGeometry(
      CONFIG.BLOCK_SIZE.x,
      CONFIG.BLOCK_SIZE.y,
      CONFIG.BLOCK_SIZE.z
    );
    
    const mesh = new THREE.Mesh(geometry, this.materials.wood.clone());
    mesh.position.copy(position);
    mesh.rotation.y = rotation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // 添加外框網格（用於高亮）
    const outlineGeo = new THREE.BoxGeometry(
      CONFIG.BLOCK_SIZE.x * 1.05,
      CONFIG.BLOCK_SIZE.y * 1.05,
      CONFIG.BLOCK_SIZE.z * 1.05
    );
    const outlineMesh = new THREE.Mesh(outlineGeo, this.outlineMaterial);
    outlineMesh.visible = false;
    mesh.add(outlineMesh);
    
    this.scene.add(mesh);

    // Cannon-es 物理體
    const shape = new CANNON.Box(new CANNON.Vec3(
      CONFIG.BLOCK_SIZE.x / 2,
      CONFIG.BLOCK_SIZE.y / 2,
      CONFIG.BLOCK_SIZE.z / 2
    ));
    
    const body = new CANNON.Body({
      mass: 0,
      shape: shape,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      sleepSpeedLimit: 0.1,
      sleepTimeLimit: 1
    });
    
    body.quaternion.setFromEuler(0, rotation, 0);
    this.world.addBody(body);

    // 儲存區塊資料
    const block = {
      mesh,
      body,
      outlineMesh,
      layer,
      index,
      isMoving: false,
      removed: false,
      originalPosition: position.clone(),
      originalRotation: rotation
    };
    
    this.blocks.push(block);
    mesh.userData.block = block;
  }

  async setupControls() {
    try {
      const { OrbitControls } = await import('./libs/OrbitControls.js');
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.copy(CONFIG.CAMERA.TARGET);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
      this.controls.minDistance = 5;
      this.controls.maxDistance = 20;
      this.controls.update();
    } catch (error) {
      console.error('無法載入 OrbitControls:', error);
    }
  }

  setupEventListeners() {
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // 添加鍵盤控制
    window.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  setupUI() {
    const info = document.getElementById('info');
    info.innerHTML = `
      <div style="padding: 10px; background: rgba(0,0,0,0.7); border-radius: 5px;">
        <h3 style="margin: 0 0 10px 0;">疊疊樂</h3>
        <p>移動次數: <span id="moves">0</span></p>
        <p>提示: 只能移動最上三層以外的積木</p>
        <button id="restart" style="margin-top: 10px;">重新開始</button>
      </div>
    `;
    
    document.getElementById('restart').addEventListener('click', () => this.restart());
  }

  updateUI() {
    document.getElementById('moves').textContent = this.gameState.moves;
  }

  onPointerDown(event) {
    if (this.gameState.isGameOver || this.gameState.isDragging) return;

    this.updateMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const selectableBlocks = this.getSelectableBlocks();
    const intersects = this.raycaster.intersectObjects(
      selectableBlocks.map(b => b.mesh)
    );

    if (intersects.length > 0) {
      const block = intersects[0].object.userData.block;
      if (this.canRemoveBlock(block)) {
        this.startDragging(block, intersects[0].point);
      }
    }
  }

  onPointerMove(event) {
    this.updateMousePosition(event);

    if (!this.gameState.isDragging) {
      this.updateHover();
      return;
    }

    if (this.gameState.selectedBlock) {
      this.updateDragPosition();
    }
  }

  onPointerUp() {
    if (!this.gameState.isDragging || !this.gameState.selectedBlock) return;

    this.placeBlock();
  }

  onKeyDown(event) {
    if (this.gameState.isDragging && event.key === 'Escape') {
      this.cancelDragging();
    }
  }

  updateMousePosition(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  getSelectableBlocks() {
    return this.blocks.filter(block => {
      if (block.removed) return false;
      const topThreeLayers = this.getTopThreeLayers();
      return !topThreeLayers.includes(block.layer);
    });
  }

  getTopThreeLayers() {
    const activeLayers = [...new Set(
      this.blocks
        .filter(b => !b.removed)
        .map(b => b.layer)
    )].sort((a, b) => b - a);
    
    return activeLayers.slice(0, 3);
  }

  canRemoveBlock(block) {
    // 檢查移除此積木是否會導致塔不穩定
    const layerBlocks = this.blocks.filter(
      b => b.layer === block.layer && !b.removed
    );
    
    return layerBlocks.length > 1;
  }

  updateHover() {
    // 清除所有高亮
    this.blocks.forEach(block => {
      if (block.outlineMesh) {
        block.outlineMesh.visible = false;
      }
    });

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const selectableBlocks = this.getSelectableBlocks();
    const intersects = this.raycaster.intersectObjects(
      selectableBlocks.map(b => b.mesh)
    );

    if (intersects.length > 0) {
      const block = intersects[0].object.userData.block;
      if (this.canRemoveBlock(block) && block.outlineMesh) {
        block.outlineMesh.visible = true;
        this.renderer.domElement.style.cursor = 'pointer';
      }
    } else {
      this.renderer.domElement.style.cursor = 'default';
    }
  }

  startDragging(block, point) {
    this.gameState.selectedBlock = block;
    this.gameState.isDragging = true;
    block.isMoving = true;

    // 創建拖曳平面
    const normal = new THREE.Vector3(0, 0, 1);
    this.gameState.dragPlane = new THREE.Plane(normal, -point.z);

    // 設為運動學物體
    block.body.type = CANNON.Body.KINEMATIC;
    block.body.velocity.setZero();
    block.body.angularVelocity.setZero();

    // 視覺反饋
    block.mesh.material.emissive = new THREE.Color(0x333333);
    if (block.outlineMesh) {
      block.outlineMesh.visible = false;
    }

    // 禁用控制器
    if (this.controls) {
      this.controls.enabled = false;
    }
  }

  updateDragPosition() {
    const block = this.gameState.selectedBlock;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const intersection = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.gameState.dragPlane, intersection);

    // 更新位置
    block.mesh.position.x = intersection.x;
    block.mesh.position.z = intersection.z;
    
    // 保持高度在塔頂
    const topY = this.getTopPosition();
    block.mesh.position.y = Math.max(block.mesh.position.y, topY);

    // 更新物理體位置
    block.body.position.copy(block.mesh.position);

    // 更新放置指示器
    this.updatePlacementIndicator(block);
  }

  updatePlacementIndicator(block) {
    const topY = this.getTopPosition();
    
    if (Math.abs(block.mesh.position.y - topY) < 0.5) {
      this.placementIndicator.visible = true;
      this.placementIndicator.position.copy(block.mesh.position);
      this.placementIndicator.position.y = topY;
      this.placementIndicator.rotation.copy(block.mesh.rotation);
      
      // 檢查放置是否有效
      const isValidPlacement = this.isValidPlacement(block);
      this.placementIndicator.material.color.setHex(
        isValidPlacement ? CONFIG.COLORS.VALID_PLACEMENT : CONFIG.COLORS.INVALID_PLACEMENT
      );
    } else {
      this.placementIndicator.visible = false;
    }
  }

  isValidPlacement(block) {
    // 簡單的放置驗證：檢查是否在合理範圍內
    const topY = this.getTopPosition();
    return Math.abs(block.mesh.position.y - topY) < 0.5 &&
           Math.abs(block.mesh.position.x) < 2 &&
           Math.abs(block.mesh.position.z) < 2;
  }

  getTopPosition() {
    const topBlocks = this.blocks
      .filter(b => !b.removed && !b.isMoving)
      .sort((a, b) => b.mesh.position.y - a.mesh.position.y);
    
    if (topBlocks.length === 0) return CONFIG.TOWER_BASE_Y;
    
    return topBlocks[0].mesh.position.y + CONFIG.BLOCK_SIZE.y + CONFIG.LAYER_GAP;
  }

  placeBlock() {
    const block = this.gameState.selectedBlock;
    
    if (this.isValidPlacement(block)) {
      // 放置在頂層
      const topY = this.getTopPosition();
      block.mesh.position.y = topY;
      block.body.position.copy(block.mesh.position);
      
      // 標記為已移除（從原始位置）
      block.removed = true;
      
      // 更新層數
      block.layer = Math.floor((topY - CONFIG.TOWER_BASE_Y) / (CONFIG.BLOCK_SIZE.y + CONFIG.LAYER_GAP));
      
      // 增加移動次數
      this.gameState.moves++;
      this.updateUI();
    } else {
      // 返回原位
      this.returnBlockToOriginalPosition(block);
    }

    this.finishDragging(block);
  }

  returnBlockToOriginalPosition(block) {
    block.mesh.position.copy(block.originalPosition);
    block.mesh.rotation.y = block.originalRotation;
    block.body.position.copy(block.originalPosition);
    block.body.quaternion.setFromEuler(0, block.originalRotation, 0);
    block.removed = false;
  }

  cancelDragging() {
    if (!this.gameState.selectedBlock) return;
    
    this.returnBlockToOriginalPosition(this.gameState.selectedBlock);
    this.finishDragging(this.gameState.selectedBlock);
  }

  finishDragging(block) {
    // 恢復物理
    block.body.type = CANNON.Body.DYNAMIC;
    block.body.velocity.setZero();
    block.body.angularVelocity.setZero();
    block.isMoving = false;

    // 恢復視覺
    block.mesh.material.emissive = new THREE.Color(0x000000);
    this.placementIndicator.visible = false;

    // 清除狀態
    this.gameState.selectedBlock = null;
    this.gameState.isDragging = false;
    this.gameState.dragPlane = null;

    // 重新啟用控制器
    if (this.controls) {
      this.controls.enabled = true;
    }

    // 檢查塔是否倒塌
    setTimeout(() => this.checkTowerStability(), 100);
  }

  checkTowerStability() {
    const fallen = this.blocks.some(block => 
      !block.removed && block.mesh.position.y < 0.05
    );

    if (fallen) {
      this.gameState.isGameOver = true;
      const info = document.getElementById('info');
      info.innerHTML += '<p style="color: red; font-weight: bold;">塔倒了！遊戲結束。</p>';
      this.renderer.domElement.style.pointerEvents = 'none';
    }
  }

  restart() {
    // 清理現有物體
    this.blocks.forEach(block => {
      this.scene.remove(block.mesh);
      this.world.removeBody(block.body);
    });
    this.blocks = [];

    // 重置狀態
    this.gameState.reset();
    
    // 重建塔
    this.buildTower();
    
    // 重置 UI
    this.setupUI();
    this.renderer.domElement.style.pointerEvents = 'auto';
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // 更新物理
    if (this.world) {
      this.world.step(CONFIG.PHYSICS.TIME_STEP, CONFIG.PHYSICS.TIME_STEP, CONFIG.PHYSICS.ITERATIONS);
    }

    // 同步物理和視覺
    this.blocks.forEach(block => {
      if (!block.isMoving && !block.removed) {
        block.mesh.position.copy(block.body.position);
        block.mesh.quaternion.copy(block.body.quaternion);
      }
    });

    // 更新控制器
    if (this.controls) {
      this.controls.update();
    }

    // 渲染
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// 啟動遊戲
window.addEventListener('DOMContentLoaded', () => {
  const game = new JengaGame();
});

// 導出類供其他模組使用
export { JengaGame };