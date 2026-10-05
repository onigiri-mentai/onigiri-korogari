// Game script for ころがりおにぎり
// This file implements a simple side‑scrolling game where an onigiri
// automatically rolls forward collecting ingredients while avoiding pits.
// Collecting ingredients displays icons in the ingredient area; falling into a pit
// resets collected ingredients with a flying away animation. The game ends
// after a short 20 second run and displays a fortune-like result screen.
// A double jump mechanic allows the onigiri to reach higher ingredients.

(() => {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  // 計測モードは ?performance=1 のときだけ表示する。
  const performanceMode = new URLSearchParams(window.location.search).get('performance') === '1';
  const frameMetrics = { frames: 0, start: 0, last: 0, cpu: 0, maxGap: 0 };
  let performanceHud = null;
  if (performanceMode) {
    performanceHud = document.createElement('div');
    performanceHud.id = 'performanceHud';
    performanceHud.setAttribute('role', 'status');
    document.getElementById('game-container').appendChild(performanceHud);
  }
  const gameContainer = document.getElementById('game-container');
  const gameStage = document.getElementById('game-stage');
  const gameFrame = document.getElementById('game-frame');
  const FRAME_WIDTH = 800;
  const FRAME_HEIGHT = 426;
  const portraitQuery = window.matchMedia('(orientation: portrait) and (any-pointer: coarse), (orientation: portrait) and (max-width: 600px)');
  const mobileQuery = window.matchMedia('(any-pointer: coarse), (max-width: 900px)');
  function syncVisibleViewport() {
    const viewport = window.visualViewport;
    // ピンチ拡大率を除いた表示領域を使い、縦横切替後の古い高さを残さない。
    const viewportScale = viewport ? viewport.scale : 1;
    const width = viewport ? viewport.width * viewportScale : window.innerWidth;
    const height = viewport ? viewport.height * viewportScale : window.innerHeight;
    for (const [property, value] of [['--viewport-width', width], ['--viewport-height', height]]) {
      const pixels = `${Math.round(value)}px`;
      if (document.body.style.getPropertyValue(property) !== pixels) {
        document.body.style.setProperty(property, pixels);
      }
    }
    fitGameToScreen();
  }

  function fitGameToScreen() {
    const rotated = portraitQuery.matches;
    const room = mobileQuery.matches ? 0.92 : 1;
    const displayedWidth = rotated ? FRAME_HEIGHT : FRAME_WIDTH;
    const displayedHeight = rotated ? FRAME_WIDTH : FRAME_HEIGHT;
    const scale = Math.min(1, gameStage.clientWidth * room / displayedWidth, gameStage.clientHeight * room / displayedHeight);
    document.body.classList.toggle('mobile', mobileQuery.matches);
    gameFrame.style.setProperty('--game-rotation', rotated ? '90deg' : '0deg');
    gameFrame.style.setProperty('--game-scale', String(scale));
  }
  new ResizeObserver(fitGameToScreen).observe(gameStage);
  window.visualViewport?.addEventListener('resize', syncVisibleViewport);
  window.addEventListener('resize', syncVisibleViewport);
  window.addEventListener('orientationchange', () => {
    syncVisibleViewport();
    requestAnimationFrame(syncVisibleViewport);
    setTimeout(syncVisibleViewport, 250);
  });
  portraitQuery.addEventListener('change', syncVisibleViewport);
  mobileQuery.addEventListener('change', syncVisibleViewport);
  syncVisibleViewport();
  ctx.imageSmoothingEnabled = false;

  const PERF = {
  drawMountains: true,   // ← 山レイヤーを描くか
  drawGroundStripe: false, // ← 既存の緑の塗りつぶし地面を描くか
  rareGlow: false        // ← レアアイテムの光エフェクト
  };

  const startScreen = document.getElementById('startScreen');
  const startButton = document.getElementById('startButton');
  const bgmToggle = document.getElementById('bgmToggle');
  const bgmToggleLabel = document.getElementById('bgmToggleLabel');
  const soundPrompt = document.getElementById('soundPrompt');
  const soundOkButton = document.getElementById('soundOkButton');
  const soundMuteButton = document.getElementById('soundMuteButton');
  const resultScreen = document.getElementById('resultScreen');
  const resultTeaser = document.getElementById('resultTeaser');
  const resultLayout = resultScreen.querySelector('.result-layout');
  const resultScore = document.getElementById('resultScore');
  const resultRank = document.getElementById('resultRank');
  const resultBonus = document.getElementById('resultBonus');
  const resultSpecial = document.getElementById('resultSpecial');
  const resultFortune = document.getElementById('resultFortune');
  const resultList = document.getElementById('resultList');
  const resultOnigiri = document.getElementById('resultOnigiri');
  const resultIngredients = document.getElementById('resultIngredients');
  const ingredientMsg = document.getElementById('ingredientMsg');
  const congrats = document.getElementById('congrats');
  const restartButton = document.getElementById('restartButton');
  const saveImageButton = document.getElementById('saveImageButton');
  const saveStatus = document.getElementById('saveStatus');
  const savePreview = document.getElementById('savePreview');
  const savePreviewImage = document.getElementById('savePreviewImage');
  const saveDownloadLink = document.getElementById('saveDownloadLink');
  let resultFile = null;
  let resultImageUrl = null;
  let resultExportVersion = 0;
  const jumpButton = document.getElementById('jumpButton');
  const timerElem = document.getElementById('timer');
  const ingredientHud = document.getElementById('ingredientHud');

  const CANVAS_WIDTH = canvas.width;
  const CANVAS_HEIGHT = canvas.height;
  const GROUND_Y = 260;
  const GRAVITY = 0.6;
  const SCROLL_SPEED = 4;
  const ITEM_SPAWN_INTERVAL = 1500;
  const PIT_START_DELAY = 1800;
  const PIT_MIN_SPAWN_INTERVAL = 3600;
  const PIT_RANDOM_DELAY = 2200;
  const PIT_MIN_GAP = 360;
  const PIT_WIDTH = 80;
  const PIT_HIT_RATIO = 0.25;
  const STUN_DURATION = 2000;
  const MAX_DURATION = 20000;
  // コンボ演出のしきい値
  const COMBO_STAGE1 = 3; // 3連以上でキラキラ
  const COMBO_STAGE2 = 6; // 6連以上でメラメラ

  // ゴールを「何秒前から」出現させるか（ミリ秒）
  const GOAL_EARLY_MS = 4500;   // ← 例: 4.5秒前に右から出す
  // 「もうちょいでゴール！」のHUDを出す閾値（ミリ秒）
  const PREGOAL_HINT_MS = 7000;  // 例: 7秒前から表示

  let preGoalAlpha = 0; // HUDのフェード用

  let state = 'start';
  let gameReady = false;
  let revealTimer = null;
  let lastTime = 0;
  const PHYSICS_STEP = 1000 / 60;
  let physicsRemainder = 0;
  let startTime = 0;
  let nextItemSpawn = 0;
  let nextPitSpawn = 0;
  let timeLeft = MAX_DURATION;
  let scrollSpeed = SCROLL_SPEED;
  let stunEndTime = 0;
  let isStunned = false;
  let combo = 0;
  let totalCollected = 0;
  let maxCombo = 0;
  let comboBroken = false;
  let comboStage = 0;    // 0:なし,1:キラキラ,2:メラメラ
  let animTime = 0;      // アニメ用の時間(ms)
  let goal = null;        // {x,y,width,height,reached}
  let goalMode = false; // ゴール演出中フラグ（出現後はアイテム/穴の出現を止める）
  let lastDisplayedSecond = null;
  
  const GOAL_HOUSE_WIDTH = 118;
  const GOAL_HOUSE_HEIGHT = 126;

  const player = { x: 100, y: GROUND_Y, vy: 0, width: 80, height: 80, rotation: 0, jumpCount: 0, image: null };

  const items = [];
  const pits = [];
  const flyingIcons = [];
  let collected = {}; // ← 具材ごとの個数管理
  let scrollX = 0;
  let previousScrollX = 0;
  let previousPlayerY = GROUND_Y;
  let previousPlayerRotation = 0;

  const ingredients = [
  { type: 'おかか', itemSrc: 'assets/optimized/item_おかか.png', iconSrc: 'assets/optimized/icon_おかか.png', rarity: 'normal', itemScale: 0.82, resultScale: 0.78 },
  { type: 'わかめ', itemSrc: 'assets/optimized/item_わかめ.png', iconSrc: 'assets/optimized/icon_わかめ.png', rarity: 'normal' },
  { type: 'しゃけ', itemSrc: 'assets/optimized/item_しゃけ.png', iconSrc: 'assets/optimized/icon_しゃけ.png', rarity: 'normal' },
  { type: '明太子', itemSrc: 'assets/optimized/item_明太子.png', iconSrc: 'assets/optimized/icon_明太子.png', rarity: 'normal' },
  { type: 'えび天', itemSrc: 'assets/optimized/item_えび天.png', iconSrc: 'assets/optimized/icon_えび天.png', rarity: 'normal' },
  { type: 'ケーキ', itemSrc: 'assets/optimized/item_ケーキ.png', iconSrc: 'assets/optimized/icon_ケーキ.png', rarity: 'rare' }
];
  const ingredientByType = new Map(ingredients.map((ing) => [ing.type, ing]));
  const normalIngredients = ingredients.filter((ing) => ing.rarity === 'normal');
  const rareIngredients = ingredients.filter((ing) => ing.rarity === 'rare');

  const fortunesByRank = {
    SS: [
      '今日は奇跡が、ちゃんと米粒についてくる。',
      '願いごとは少し大きめに握ってよし。',
      '主役の日。お茶も拍手している。',
      '思ったより遠くまでころがれる日。'
    ],
    S: [
      'いい流れが来てる。海苔を信じて進もう。',
      '今日はちょっと贅沢しても包み込める。',
      '小さな勝ちが重なって、大きな満腹になる。',
      'ひらめきが具だくさんの日。'
    ],
    A: [
      '思ったより今日いける。',
      '今日は小さなラッキーを拾える。',
      'ほどよい勢いでころがると吉。',
      'お茶を飲むとだいたい解決する。'
    ],
    B: [
      '完璧じゃなくても、おにぎりはおにぎり。',
      '今日は急がない方がいいかも。',
      '海苔のように、だいたい包み込める日。',
      'まあまあの日ほど、あとから味が出る。'
    ],
    C: [
      '具が少ない日は、心を多めに入れておこう。',
      '今日は省エネでいこう。塩だけでもえらい。',
      '転がりすぎ注意。ゆっくり握り直せばOK。',
      '余白のあるおにぎりには、夢が入る。'
    ]
  };

  const jumpSound1 = document.getElementById('jumpSound1');
  const jumpSound2 = document.getElementById('jumpSound2');
  const getItemSound = document.getElementById('getItemSound');
  const titleBgm = document.getElementById('titleBgm');
  const gameBgm = document.getElementById('gameBgm');
  let titleBgmEnabled = false;
  const effectsEnabled = new URLSearchParams(window.location.search).get('nosfx') !== '1';
  let effectsContext = null;
  const effectBuffers = new Map();

  async function preloadEffects() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !effectsEnabled) return;
    try {
      effectsContext = new AudioContextClass({ latencyHint: 'interactive' });
      await Promise.all([jumpSound1, jumpSound2, getItemSound].map(async sound => {
        const response = await fetch(sound.src);
        if (!response.ok) throw new Error('効果音を読み込めませんでした');
        const buffer = await effectsContext.decodeAudioData(await response.arrayBuffer());
        effectBuffers.set(sound.id, buffer);
      }));
    } catch (error) {
      // 非対応環境や読み込み失敗時は従来の再生方法を使う。
    }
  }

  function unlockEffects() {
    if (effectsContext?.state === 'suspended') effectsContext.resume().catch(() => {});
  }

  function playEffect(sound) {
    if (!effectsEnabled) return;
    const buffer = effectBuffers.get(sound.id);
    if (buffer && effectsContext) {
      const source = effectsContext.createBufferSource();
      source.buffer = buffer;
      source.connect(effectsContext.destination);
      source.onended = () => source.disconnect();
      source.start();
    } else {
      sound.currentTime = 0;
      sound.play()?.catch(() => {});
    }
  }

  const imageCache = {};
  const spriteCache = {};

  function makeComboGlow(stage) {
    const glow = document.createElement('canvas');
    glow.width = glow.height = 100;
    const glowCtx = glow.getContext('2d');
    const radius = stage === 1 ? 42 : 50;
    const grad = glowCtx.createRadialGradient(50, 50, stage === 1 ? 4 : 8, 50, 50, radius);
    grad.addColorStop(0, stage === 1 ? 'rgba(255,255,220,0.34)' : 'rgba(255,225,130,0.46)');
    grad.addColorStop(stage === 1 ? 0.35 : 0.38, stage === 1 ? 'rgba(255,215,80,0.12)' : 'rgba(255,120,30,0.20)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    glowCtx.fillStyle = grad;
    glowCtx.fillRect(0, 0, 100, 100);
    return glow;
  }

  function makeSprite(image, width, height) {
    const sprite = document.createElement('canvas');
    sprite.width = width;
    sprite.height = height;
    const spriteCtx = sprite.getContext('2d');
    spriteCtx.imageSmoothingEnabled = false;
    spriteCtx.drawImage(image, 0, 0, width, height);
    return sprite;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`画像を読み込めませんでした: ${src}`));
      img.src = src;
    });
  }

  async function preloadImages() {
    const sources = ['assets/optimized/player_onigiri.png', 'assets/background_sky.png', 'assets/background_mountain.png', 'assets/background_ground.png', ...ingredients.flatMap(ing => [ing.itemSrc, ing.iconSrc])];
    await Promise.all(sources.map(async src => { imageCache[src] = await loadImage(src); }));
    player.image = imageCache[sources[0]];
    imageCache.sky = imageCache[sources[1]];
    imageCache.mountain = imageCache[sources[2]];
    imageCache.ground = imageCache[sources[3]];
    // スマホでは空と山を一枚に合成して背景描画を軽くする。
    spriteCache.mobileBackground = document.createElement('canvas');
    spriteCache.mobileBackground.width = CANVAS_WIDTH;
    spriteCache.mobileBackground.height = CANVAS_HEIGHT;
    const backgroundCtx = spriteCache.mobileBackground.getContext('2d');
    backgroundCtx.drawImage(imageCache.sky, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    backgroundCtx.drawImage(imageCache.mountain, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const ing of ingredients) {
      const itemSize = Math.round(60 * (ing.itemScale || 1));
      spriteCache[`item:${ing.type}`] = makeSprite(imageCache[ing.itemSrc], itemSize, itemSize);
      spriteCache[`fly:${ing.type}`] = makeSprite(imageCache[ing.iconSrc], 24, 24);
    }
    spriteCache.player = makeSprite(player.image, player.width, player.height);
    spriteCache.glow1 = makeComboGlow(1);
    spriteCache.glow2 = makeComboGlow(2);
  }

  function playTitleBgm() {
    if (!titleBgm || !titleBgmEnabled || state !== 'start') return;
    titleBgm.volume = 0.32;
    const playPromise = titleBgm.play();
    if (playPromise) playPromise.catch(() => {});
  }

  function stopTitleBgm() {
    if (!titleBgm) return;
    titleBgm.pause();
    titleBgm.currentTime = 0;
  }

  function playGameBgm() {
    if (!gameBgm || !titleBgmEnabled) return;
    gameBgm.volume = 0.26;
    gameBgm.currentTime = 0;
    const playPromise = gameBgm.play();
    if (playPromise) playPromise.catch(() => {});
  }

  function stopGameBgm() {
    if (!gameBgm) return;
    gameBgm.pause();
    gameBgm.currentTime = 0;
  }

  function setBgmEnabled(enabled) {
    titleBgmEnabled = enabled;
    bgmToggle.setAttribute('aria-pressed', String(enabled));
    bgmToggleLabel.textContent = enabled ? 'BGM ON' : 'BGM OFF';
    if (enabled) {
      playTitleBgm();
    } else {
      stopTitleBgm();
      stopGameBgm();
    }
  }

  function jump() {
    if (state !== 'running' || isStunned) return;

    if (player.jumpCount < 2) {
      player.vy = -10;
      player.jumpCount++;

      playEffect(player.jumpCount === 1 ? jumpSound1 : jumpSound2);
    }
  }

  function updateScoreDisplay() {
    let html = `<div style="margin-bottom:6px;">
      <span style="font-size:16px;font-weight:bold;">具材：</span>${totalCollected}個
      <span style="margin-left:10px;">Combo：</span>${combo > 1 ? combo + 'x' : '-' }
    </div>`;

    if (Object.keys(collected).length > 0) {
      for (const [name, count] of Object.entries(collected)) {
        const ing = ingredientByType.get(name);
        if (ing) {
          html += `<div style="display:flex;align-items:center;margin-bottom:4px;">
                    <img src="${ing.iconSrc}" width="24" height="24" style="margin-right:4px;" />
                    ${name} ×${count}
                  </div>`;
        }
      }
    }
    ingredientHud.innerHTML = html;
  }

  function getCollectedTotal(source = collected) {
    return Object.values(source).reduce((sum, count) => sum + count, 0);
  }

  function resetGame() {
    previousScrollX = 0;
    previousPlayerY = GROUND_Y;
    previousPlayerRotation = 0;
    frameMetrics.frames = frameMetrics.start = frameMetrics.last = frameMetrics.cpu = frameMetrics.maxGap = 0;
    resultExportVersion++;
    resultFile = null;
    if (resultImageUrl) URL.revokeObjectURL(resultImageUrl);
    resultImageUrl = null;
    savePreview.style.display = 'none';
    saveImageButton.disabled = true;
    saveImageButton.textContent = '画像を準備中…';
    saveStatus.textContent = '';
    physicsRemainder = 0;
    combo = 0;
    totalCollected = 0;
    maxCombo = 0;
    comboBroken = false;
    comboStage = 0;
    animTime = 0;
    goal = null; 
    
    // ついでに動作が気持ちよくなる軽い初期化（任意だけどおすすめ）
    scrollX = 0;
    player.rotation = 0;
    isStunned = false;

    items.length = 0;
    pits.length = 0;
    flyingIcons.length = 0;
    collected = {}; // 初期化
    
    updateScoreDisplay();
    player.x = 100;
    player.y = GROUND_Y;
    player.vy = 0;
    player.rotation = 0;
    player.jumpCount = 0;
    scrollSpeed = SCROLL_SPEED;
    isStunned = false;
    stunEndTime = 0;
    nextItemSpawn = 0;
    nextPitSpawn = 0;
    timeLeft = MAX_DURATION;
    lastDisplayedSecond = Math.ceil(MAX_DURATION / 1000);
    timerElem.textContent = `あと${lastDisplayedSecond}秒`;
    resultIngredients.style.display = 'none';
    resultIngredients.innerHTML = '';
    resultList.innerHTML = '';
    resultScore.textContent = '最高コンボ：0　具材：0個';
    resultRank.innerHTML = '<span>RANK -</span><strong></strong>';
    resultRank.classList.remove('is-long');
    resultBonus.textContent = '種類：0種';
    resultSpecial.innerHTML = '';
    resultSpecial.classList.remove('show');
    resultFortune.textContent = '';
    ingredientMsg.textContent = '';
  }

  function startGame() {
    if (state === 'running' || !gameReady) return;
    unlockEffects();
    clearTimeout(revealTimer);
    revealTimer = null;
    resultTeaser.style.display = 'none';
    resultLayout.classList.remove('revealing');
    stopTitleBgm();
    stopGameBgm();
    resetGame();
    startScreen.style.display = 'none';
    resultScreen.style.display = 'none';
    jumpButton.style.display = 'block';
    state = 'running';
    startTime = performance.now();
    lastTime = startTime;
    nextPitSpawn = startTime + PIT_START_DELAY + Math.random() * 1200;
    playGameBgm();
    requestAnimationFrame(gameLoop);
  }

function getCollectedEntries() {
  return Object.entries(collected).sort((a, b) => b[1] - a[1]);
}

function countOf(name) {
  return collected[name] || 0;
}

function getOnigiriName() {
  const entries = getCollectedEntries();
  if (entries.length === 0) return '塩むすび';

  const kinds = entries.length;
  const [topName, topCount] = entries[0];
  const allSingles = totalCollected === kinds;

  if (countOf('ケーキ') >= 2) return '禁断のケーキ城';
  if (countOf('ケーキ') >= 1) return '幻のケーキおにぎり';
  if (allSingles && kinds >= 4) return '優柔不断';
  if (kinds >= 6) return '全部のせ欲張りむすび';
  if (countOf('えび天') >= 2 && countOf('しゃけ') >= 1) return '朝から贅沢';
  if (countOf('しゃけ') >= 1 && countOf('明太子') >= 1 && countOf('おかか') >= 1) return 'ごはんのおとも三銃士';
  if (countOf('明太子') >= 2 && countOf('えび天') >= 1) return 'ピリ辛ぜいたく';
  if (countOf('わかめ') >= 1 && countOf('しゃけ') >= 1) return '海辺の朝ごはん';
  if (countOf('わかめ') >= 1 && countOf('おかか') >= 1) return '海の記憶';

  if (topCount >= 5) return `${topName}王`;
  if (topCount >= 3) {
    const names = {
      'わかめ': 'ワカメ王',
      'えび天': '天むす親方',
      'しゃけ': '鮭ざんまい',
      '明太子': 'ピリ辛番長',
      'おかか': 'おかかの古参'
    };
    return names[topName] || `${topName}ましまし`;
  }

  if (kinds >= 4) return 'にぎやか三角地帯';
  if (kinds === 1) return `${topName}ひとすじ`;
  return `${entries.map(([name]) => name).join('・')}おにぎり`;
}

function makeResultTitle() {
  const name = getOnigiriName();
  const displayName = /(?:おにぎり|むすび)$/.test(name) ? name : `${name}おにぎり`;
  return `<span class="result-onigiri-name">『${displayName}』</span><span class="result-made-text">ができた〜！</span>`;
}

function isFullCombo() {
  return totalCollected > 0 && !comboBroken;
}

function getRank(currentCollected, fullCombo) {
  const kinds = Object.keys(currentCollected).length;
  const rareCount = countOf('ケーキ');
  const finalCount = getCollectedTotal(currentCollected);
  const maxSame = Math.max(0, ...Object.values(currentCollected));
  if (finalCount === 0) return { grade: 'C', name: '塩だけ勝負' };

  const completion =
    finalCount * 4 +
    maxCombo * 5 +
    kinds * 7 +
    rareCount * 22 +
    (fullCombo ? 18 : 0) +
    (maxSame >= 3 ? 6 : 0) +
    (maxSame >= 5 ? 6 : 0);

  if (completion >= 150) return { grade: 'SS', name: '奇跡の完成度' };
  if (completion >= 112) return { grade: 'S', name: 'かなり仕上がり' };
  if (completion >= 74) return { grade: 'A', name: '大満足' };
  if (completion >= 38) return { grade: 'B', name: 'いいにぎり' };
  return { grade: 'C', name: '素朴' };
}

function getFortune(rankGrade) {
  const fortunes = fortunesByRank[rankGrade] || fortunesByRank.B;
  return fortunes[Math.floor(Math.random() * fortunes.length)];
}

function buildResultList() {
  resultList.innerHTML = '';

  const entries = Object.entries(collected);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'result-chip';
    empty.textContent = '具材なし ×0';
    resultList.appendChild(empty);
    return;
  }

  entries
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      const ing = ingredientByType.get(name);
      const chip = document.createElement('div');
      chip.className = 'result-chip';

      if (ing) {
        const icon = document.createElement('img');
        icon.src = ing.iconSrc;
        icon.alt = '';
        chip.appendChild(icon);
      }

      const label = document.createElement('span');
      label.textContent = `${name} ×${count}`;
      chip.appendChild(label);
      resultList.appendChild(chip);
    });
}

function endGame() {
  if (state !== 'running') return;
  state = 'over';
  jumpButton.style.display = 'none';
  stopGameBgm();
  const fullCombo = isFullCombo();
  const hasCake = collected['ケーキ'] > 0;
  const kindCount = Object.keys(collected).length;
  totalCollected = getCollectedTotal();
  const rank = getRank(collected, fullCombo);
  resultScore.textContent = `最高コンボ：${maxCombo}　具材：${totalCollected}個`;
  resultRank.innerHTML = `<span>RANK ${rank.grade}</span><strong>${rank.name}</strong>`;
  resultRank.classList.toggle('is-long', rank.name.length >= 6);
  resultBonus.textContent = `種類：${kindCount}種`;
  resultSpecial.innerHTML = hasCake ? 'レア具材<br>ゲット!!' : (fullCombo ? 'フルコンボ<br>達成!!' : '');
  resultSpecial.classList.toggle('show', hasCake || fullCombo);
  resultFortune.textContent = `今日の一言：${getFortune(rank.grade)}`;
  resultOnigiri.src = 'assets/optimized/player_onigiri.png';
  ingredientMsg.innerHTML = makeResultTitle();
  buildResultList();

  // トッピングリセット
  resultIngredients.innerHTML = '';
  resultIngredients.style.display = 'block';

  // 通常とレアを分ける配列
  const normalIcons = [];
  const rareIcons = [];
  let toppingIndex = 0;

  // 具材を振り分け
  for (const [name, count] of Object.entries(collected)) {
    const ing = ingredientByType.get(name);
    if (ing) {
      for (let i = 0; i < count; i++) {
        const icon = document.createElement('img');
        icon.src = ing.iconSrc;
        const isRare = ing.rarity === 'rare';
        const baseSize = isRare ? 70 : 54;
        const size = Math.round(baseSize * (ing.resultScale || 1));
        const spreadX = 36 + Math.min(62, toppingIndex * 6);
        const spreadY = 18 + Math.min(74, toppingIndex * 4);
        const centerX = 123 + (Math.random() - 0.5) * spreadX * 2;
        const centerY = 30 + Math.random() * spreadY;
        icon.style.width = `${size}px`;
        icon.style.height = `${size}px`;
        icon.style.top = `${Math.max(-8, Math.min(126, centerY - size / 2))}px`;
        icon.style.left = `${Math.max(4, Math.min(242 - size, centerX - size / 2))}px`;
        icon.style.transform = `rotate(${Math.random() * 42 - 21}deg)`;
        toppingIndex++;

        if (isRare) {
          icon.style.filter = 'drop-shadow(0 0 8px gold)';
          icon.style.transform += ' scale(1.16)';
          icon.style.animation = 'shine 1s infinite alternate';
          rareIcons.push(icon); // レアは後で追加
        } else {
          normalIcons.push(icon);
        }
      }
    }
  }

  // 先に通常具材、あとでレア具材を追加
  normalIcons.forEach(icon => resultIngredients.appendChild(icon));
  rareIcons.forEach(icon => resultIngredients.appendChild(icon));

  resultTeaser.style.display = 'flex';
  revealTimer = setTimeout(showResult, 1700);
}

function showResult() {
  if (resultTeaser.style.display === 'none') return;
  clearTimeout(revealTimer);
  revealTimer = null;
  resultTeaser.style.display = 'none';

  // Show the finished onigiri before its details arrive.
  const onigiriWrapper = document.getElementById('onigiriWrapper');
  onigiriWrapper.style.animation = 'none';
  congrats.style.animation = 'none';
  void onigiriWrapper.offsetWidth;
  onigiriWrapper.style.animation = 'resultPop 0.6s ease-out forwards';
  congrats.style.animation = 'pop 0.6s ease-out forwards';
  resultLayout.classList.remove('revealing');
  void resultLayout.offsetWidth;
  resultLayout.classList.add('revealing');
  prepareResultImage();
  resultScreen.style.display = 'flex';
}


  function spawnItem() {
  const isRare = Math.random() < 0.08; // 8%でレア
  const pool = isRare ? rareIngredients : normalIngredients;
  const ing = pool[Math.floor(Math.random() * pool.length)];

  const minOffset = 40;
  const maxOffset = 180;
  const y = GROUND_Y - minOffset - Math.random() * (maxOffset - minOffset);
  const size = Math.round(60 * (ing.itemScale || 1));
  items.push({ x: CANVAS_WIDTH + 50, y, width: size, height: size, type: ing.type, image: spriteCache[`item:${ing.type}`] || imageCache[ing.itemSrc] });
}

  function spawnPit() {
    pits.push({ x: CANVAS_WIDTH + 50, width: PIT_WIDTH, triggered: false });
  }

  function canSpawnPit() {
    const spawnX = CANVAS_WIDTH + 50;
    return pits.every((pit) => Math.abs(spawnX - pit.x) >= PIT_MIN_GAP);
  }

  function scheduleNextPit(now) {
    nextPitSpawn = now + PIT_MIN_SPAWN_INTERVAL + Math.random() * PIT_RANDOM_DELAY;
  }

  function triggerPit(pit) {
    pit.triggered = true;
    isStunned = true;
    stunEndTime = performance.now() + STUN_DURATION;
    scrollSpeed = 0;

    // コンボは切れて、具材は今日のおにぎりからこぼれる。
    combo = 0;
    totalCollected = 0;
    comboBroken = true;
    comboStage = 0;
    updateScoreDisplay();

    if (Object.keys(collected).length > 0) {
      const baseX = player.x;
      const baseY = player.y;
      for (const [name] of Object.entries(collected)) {
        const ing = ingredientByType.get(name);
        if (ing) {
          flyingIcons.push({
            x: baseX,
            y: baseY,
            vx: (Math.random() - 0.5) * 4,
            vy: -(Math.random() * 3 + 2),
            alpha: 1,
            img: spriteCache[`fly:${ing.type}`] || imageCache[ing.iconSrc],
            lifetime: 60
          });
        }
      }
      collected = {};
      updateScoreDisplay();
    }
  }

  function updateFlyingIcons(f = 1) {
    for (let i = flyingIcons.length - 1; i >= 0; i--) {
      const icon = flyingIcons[i];
      icon.x += icon.vx * f;
      icon.y += icon.vy * f;
      icon.vy += GRAVITY * 0.2 * f;
      icon.alpha -= f / icon.lifetime;
      if (icon.alpha <= 0) flyingIcons.splice(i, 1);
    }
  }

  function drawFlyingIcons() {
    flyingIcons.forEach((icon) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, icon.alpha);
      ctx.drawImage(icon.img, Math.round(icon.x - 12), Math.round(icon.y - 12), 24, 24);
      ctx.restore();
    });
  }

  // ゴール
 function spawnGoalArrivingIn(ms) {
  const w = GOAL_HOUSE_WIDTH;
  const h = GOAL_HOUSE_HEIGHT;
  const yBottom = GROUND_Y + player.height - 20;

  const pxPerMs = scrollSpeed * (60 / 1000);
  const dx = Math.max(0, pxPerMs * ms) + (player.width * 0.5);

  let startX = player.x + dx;
  // 画面の右外から必ず入ってくるように最低位置を保証
  startX = Math.max(startX, CANVAS_WIDTH + 30);
  goal = { x: startX, y: yBottom - h, width: w, height: h, reached: false };

  goalMode = true;
}

function drawPixelHouseGoal(goalObj) {
  const x = Math.round(goalObj.x);
  const y = Math.round(goalObj.y);
  const s = Math.max(2, Math.round(goalObj.width / 59));
  const px = (gx, gy, gw, gh, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + gx * s, y + gy * s, gw * s, gh * s);
  };

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.shadowColor = 'rgba(72, 47, 23, 0.22)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 5;

  // ドット絵の家。ゴール旗ではなく「ただいま」の目的地にする。
  px(8, 33, 42, 23, '#f8e2a1');
  px(11, 36, 36, 20, '#fff0bc');
  px(4, 29, 50, 6, '#8b4a24');
  px(8, 24, 42, 5, '#a95628');
  px(12, 19, 34, 5, '#c3652e');
  px(17, 14, 24, 5, '#de7b35');
  px(23, 9, 12, 5, '#f08a3a');
  px(42, 12, 6, 12, '#9a5130');
  px(40, 10, 10, 4, '#70402b');

  px(24, 40, 11, 16, '#4b2d22');
  px(26, 42, 7, 14, '#2b1b16');
  px(14, 38, 8, 8, '#82c6de');
  px(38, 38, 8, 8, '#82c6de');
  px(15, 39, 6, 6, '#d9fbff');
  px(39, 39, 6, 6, '#d9fbff');

  px(8, 54, 42, 4, '#6f4c2b');
  px(1, 58, 56, 5, 'rgba(69, 52, 32, 0.22)');

  // ちいさな湯気/きらめき
  px(50, 23, 2, 2, '#fff6bd');
  px(53, 20, 2, 2, '#fff6bd');
  px(49, 17, 2, 2, '#fff6bd');
  px(5, 40, 2, 2, '#ffe482');
  px(3, 43, 2, 2, '#ffe482');

  ctx.restore();
}


  function update(now) {
    // 描画速度が違ってもジャンプ軌道と当たり判定は60Hzで揃える。
    physicsRemainder += Math.min(100, Math.max(0, now - lastTime));
    lastTime = now;
    let stepped = false;
    while (physicsRemainder + 0.000001 >= PHYSICS_STEP && state === 'running') {
      const stepTime = now - physicsRemainder + PHYSICS_STEP;
      physicsRemainder = Math.max(0, physicsRemainder - PHYSICS_STEP);
      updateStep(stepTime);
      stepped = true;
    }
    return stepped;
  }

  function updateStep(now) {
    previousScrollX = scrollX;
    previousPlayerY = player.y;
    previousPlayerRotation = player.rotation;
    for (const object of items) object.previousX = object.x;
    for (const object of pits) object.previousX = object.x;
    if (goal) goal.previousX = goal.x;
    for (const icon of flyingIcons) { icon.previousX = icon.x; icon.previousY = icon.y; }
    const delta = PHYSICS_STEP;
    const f = 1;
    animTime += delta;

    if (state !== 'running') return;

    const elapsed = now - startTime;
    timeLeft = Math.max(0, MAX_DURATION - elapsed);
    const seconds = Math.ceil(timeLeft / 1000);
    if (seconds !== lastDisplayedSecond) {
      lastDisplayedSecond = seconds;
      timerElem.textContent = `あと${Math.max(0, seconds)}秒`;
    }

    // 残りが少なくなったら、残り時間に合わせて到達位置にゴールを出す
    // 例：残り 1.2 秒以内で未出現なら出す（値はお好みで）
     if (!goal && !goalMode && timeLeft <= GOAL_EARLY_MS) {
      spawnGoalArrivingIn(timeLeft); // ← timeLeft ms 後にプレイヤーへ到達
    }
    // 0mになっても、ゴール到達まではゲーム継続（endGameはゴール接触時に行う）

    if (isStunned && now >= stunEndTime) {
      isStunned = false;
      scrollSpeed = SCROLL_SPEED;
    }

    if (!isStunned) {
      if (!goalMode) { // ← ゴール出現後は止める
        if (now >= nextItemSpawn) {
          spawnItem();
          nextItemSpawn = now + ITEM_SPAWN_INTERVAL * (0.5 + Math.random());
        }
        if (now >= nextPitSpawn) {
          if (canSpawnPit()) {
            spawnPit();
            scheduleNextPit(now);
          } else {
            nextPitSpawn = now + 600;
          }
        }
      }
      if (!isStunned) scrollX += scrollSpeed * f;
    }

    // アイテムの移動＆取り逃し判定
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    item.x -= scrollSpeed * f;

    // ★取り逃し検出
    // プレイヤーの左側に完全に抜けたら（右端 < プレイヤー左端）
    if (!item._passed && (item.x + item.width < player.x)) {
      comboBroken = true;
      combo = 0; 
      comboStage = 0;                // コンボ切れ
      updateScoreDisplay();      // 表示更新
      item._passed = true;       // 二重リセット防止
    }

    // 画面外に消えたら削除
    if (item.x + item.width < 0) {
      items.splice(i, 1);
    }
  }

  // 穴の移動
  for (let i = pits.length - 1; i >= 0; i--) {
    const pit = pits[i];
    pit.x -= scrollSpeed * f;
    if (pit.x + pit.width < 0) pits.splice(i, 1);
  }

  // --- Goal update ---
  if (goal) {
    goal.x -= scrollSpeed * f;

    // 画面外に行ったら一応消す（距離連動出現なら不要）
    if (goal.x + goal.width < 0) {
      goal = null;
    }

    // プレイヤーと接触＝ゴール！
    if (!goal.reached &&
        player.x < goal.x + goal.width &&
        player.x + player.width > goal.x &&
        player.y < goal.y + goal.height &&
        player.y + player.height > goal.y) {
      goal.reached = true;

    // 「もうちょいでゴール！」HUDのフェード
    if (timeLeft <= PREGOAL_HINT_MS) {
      preGoalAlpha = Math.min(1, preGoalAlpha + (delta / 300));   // ふわっと出す
    } else {
      preGoalAlpha = Math.max(0, preGoalAlpha - (delta / 300));   // ふわっと消す
    }

      // クリアに遷移（既存の勝利演出やリザルト表示を呼ぶ）
      // 例: endGame();  // 使ってる関数名に合わせてね
      endGame();   // ★あなたのクリア処理へ
      goalMode = false; // お好み（次ラウンドは resetGame() で初期化される想定）
    }
  }

  updateFlyingIcons(f);

  player.vy += GRAVITY * f;
  player.y += player.vy * f;
  if (player.y >= GROUND_Y) {
    player.y = GROUND_Y;
    player.vy = 0;
    player.jumpCount = 0;
  }


    player.rotation += scrollSpeed * 0.05 * f;

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
 // ヒット（取得）処理
if (
  player.x < item.x + item.width &&
  player.x + player.width > item.x &&
  player.y < item.y + item.height &&
  player.y + player.height > item.y
) {
    // 収集カウント
    if (!collected[item.type]) collected[item.type] = 0;
    collected[item.type]++;
    totalCollected++;

    // ★コンボ：取り逃しがなければ連続。ミス時にどこかで0になってる前提
    combo = (combo > 0 ? combo + 1 : 1);
    maxCombo = Math.max(maxCombo, combo);
    comboStage = (combo >= COMBO_STAGE2) ? 2 : (combo >= COMBO_STAGE1 ? 1 : 0);

    updateScoreDisplay();

    // 効果音
    playEffect(getItemSound);

    // 取得アイテム消去
    items.splice(i, 1);
  }
    }

    if (!isStunned) {
      for (const pit of pits) {
        if (!pit.triggered) {
          const pitStart = pit.x + (PIT_WIDTH * (1 - PIT_HIT_RATIO)) / 2;
          const pitEnd = pit.x + PIT_WIDTH - (PIT_WIDTH * (1 - PIT_HIT_RATIO)) / 2;
          const playerCenterX = player.x + player.width / 2;
          if (playerCenterX >= pitStart && playerCenterX <= pitEnd) {
            if (player.y + player.height >= GROUND_Y - 5) {
              triggerPit(pit);
              break;
            }
          }
        }
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // 空（固定）
    if (mobileQuery.matches && spriteCache.mobileBackground) {
      ctx.drawImage(spriteCache.mobileBackground, 0, 0);
    } else if (imageCache.sky) {
      ctx.drawImage(imageCache.sky, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // 山（ゆっくり＝0.5倍速）。小数を使わず整数に丸めるのがポイント！
    if (!mobileQuery.matches && PERF.drawMountains && imageCache.mountain) {
      const mx = - (Math.floor((scrollX * 0.5)) % CANVAS_WIDTH);
      ctx.drawImage(imageCache.mountain, mx, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.drawImage(imageCache.mountain, mx + CANVAS_WIDTH, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // 地面（等速）。こちらも整数に丸める
    if (imageCache.ground) {
      const gx = - (Math.floor(scrollX) % CANVAS_WIDTH);
      ctx.drawImage(imageCache.ground, gx, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.drawImage(imageCache.ground, gx + CANVAS_WIDTH, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    // 地面の塗りつぶし（不要なら切る）
    if (PERF.drawGroundStripe) {
      ctx.fillStyle = '#8bc34a';
      ctx.fillRect(0, GROUND_Y + player.height - 20, CANVAS_WIDTH, 20);
    }

    pits.forEach((pit) => drawPit(pit));
    items.forEach((item) => ctx.drawImage(item.image, Math.round(item.x), Math.round(item.y)));
 
    // --- Goal draw ---
    if (goal) {
      drawPixelHouseGoal(goal);
    }

      
    // ★コンボに応じた発光・キラキラ・メラメラ込みで描画
    drawPlayerWithEffects();

    drawFlyingIcons();
    drawComboBanner();
  }

function drawPit(pit) {
  const groundTop = GROUND_Y + player.height - 20;
  const x = Math.round(pit.x);
  const y = Math.round(groundTop - 7);
  const block = 6;
  const drawBlock = (bx, by, bw, bh, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + bx), Math.round(y + by), bw, bh);
  };

  ctx.save();

  // ドット絵の土盛り。四角の段差で、地面と馴染む穴にする。
  drawBlock(-8, 22, 96, 14, 'rgba(55, 34, 18, 0.18)');

  const backDirt = [
    [8, 4, 12, 6], [20, -2, 12, 12], [32, 0, 18, 10],
    [50, -4, 12, 14], [62, 4, 12, 8]
  ];
  backDirt.forEach(([bx, by, bw, bh]) => drawBlock(bx, by, bw, bh, '#c5853f'));

  const midDirt = [
    [0, 10, 12, 12], [12, 4, 12, 18], [24, 0, 12, 20],
    [36, 2, 12, 18], [48, 0, 12, 20], [60, 6, 12, 16],
    [72, 12, 10, 10]
  ];
  midDirt.forEach(([bx, by, bw, bh]) => drawBlock(bx, by, bw, bh, '#9b642e'));

  const darkDirt = [
    [-2, 22, 12, 8], [10, 24, 12, 8], [22, 26, 12, 8],
    [34, 27, 12, 9], [46, 26, 12, 8], [58, 24, 12, 8],
    [70, 22, 12, 8]
  ];
  darkDirt.forEach(([bx, by, bw, bh]) => drawBlock(bx, by, bw, bh, '#5c371d'));

  // 穴の中。段々に暗くして、丸ではなくドットのくぼみに見せる。
  drawBlock(18, 11, 44, 6, '#2b1a10');
  drawBlock(12, 17, 56, 6, '#1a100b');
  drawBlock(16, 23, 48, 6, '#070504');
  drawBlock(24, 29, 32, 5, '#010101');

  // ハイライトと小石。きれいな線より、ガタガタした粒に寄せる。
  drawBlock(14, 4, block, block, '#e1a75a');
  drawBlock(30, -4, block, block, '#f0bf71');
  drawBlock(54, 0, block, block, '#e1a75a');
  drawBlock(66, 8, block, block, '#d8994d');
  drawBlock(2, 18, block, block, '#7b4b26');
  drawBlock(76, 18, block, block, '#7b4b26');

  drawBlock(-10, 13, 5, 4, '#8a5529');
  drawBlock(88, 18, 6, 4, '#8a5529');
  drawBlock(5, 36, 6, 4, '#6c4324');
  drawBlock(72, 35, 5, 4, '#c5853f');

  ctx.restore();
}

function drawSparkStar(x, y, size, alpha, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff7a8';
  ctx.strokeStyle = 'rgba(255, 189, 42, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? size : size * 0.34;
    const a = -Math.PI / 2 + i * Math.PI / 4;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

  function drawPlayerWithEffects() {
  // 中心へ移動（ゆさぶり対応）
  let jitterX = 0, jitterY = 0;
  if (isStunned) {
    jitterX = (Math.random() - 0.5) * 4;
    jitterY = (Math.random() - 0.5) * 4;
  }

// --- 背面の発光（ステージに応じて色） ---
if (comboStage > 0) {
  const cx = player.x + player.width / 2 + jitterX;
  const cy = player.y + player.height / 2 + jitterY;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = comboStage === 1 ? spriteCache.glow1 : spriteCache.glow2;
  if (glow) ctx.drawImage(glow, cx - 50, cy - 50);
  ctx.restore();
}

  // --- 本体 ---
  ctx.save();
  ctx.translate(player.x + player.width / 2 + jitterX, player.y + player.height / 2 + jitterY);
  ctx.rotate(player.rotation);
  ctx.drawImage(spriteCache.player || player.image, -player.width / 2, -player.height / 2);
  ctx.restore();

  // --- ランダムきらめき（stage1のみ） ---
if (comboStage === 1) {
  const cx0 = player.x + player.width / 2;
  const cy0 = player.y + player.height / 2;

  const SPARKS = mobileQuery.matches ? 4 : 10;
  const t = animTime * 0.006;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let k = 0; k < SPARKS; k++) {
    // 「ランダムっぽいけどフレームごとに消えない」ように、k由来の擬似乱数＋時間ゆらぎ
    const ang = (k * (Math.PI * 2 / SPARKS)) + Math.sin(t * 0.9 + k * 1.7) * 0.9;
    const rBase = 35 + ((k * 37) % 20);
    const r = rBase + Math.sin(t * 1.3 + k * 2.1) * 7;

    const sx = cx0 + Math.cos(ang) * r;
    const sy = cy0 + Math.sin(ang) * r;

    const pulse = 0.5 + 0.5 * Math.sin(t * 2.0 + k * 1.3);
    const s = 3 + pulse * 5;
    const tail = 7 + pulse * 8;

    ctx.globalAlpha = 0.28 + 0.42 * pulse;
    ctx.strokeStyle = 'rgba(255, 238, 142, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(ang) * tail, sy - Math.sin(ang) * tail);
    ctx.lineTo(sx + Math.cos(ang) * 3, sy + Math.sin(ang) * 3);
    ctx.stroke();

    drawSparkStar(sx, sy, s, 0.55 + 0.45 * pulse, t + k);
  }

  ctx.restore();
}

  // --- メラメラ（stage2） ---
if (comboStage >= 2) {
  const t = animTime; // ms
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // おにぎり上側の基準点（包み込むように）
  const baseX = player.x + player.width  / 2;
  const baseY = player.y + player.height * 0.32;

  // ── 火花。三角形の炎ではなく、粒と光跡でスーパー感を出す ──
  for (let s=0; s<(mobileQuery.matches ? 8 : 22); s++){
    const seed = s * 2.37;
    const drift = (t * 0.018 + seed) % (Math.PI * 2);
    const ang = -Math.PI / 2 + Math.sin(drift) * 1.4;
    const dist = 26 + ((s * 13) % 42) + Math.sin(t * 0.009 + s) * 10;
    const px = baseX + Math.cos(ang) * dist + Math.sin(seed) * 16;
    const py = baseY + Math.sin(ang) * dist - 8 + Math.cos(seed) * 8;
    const len = 6 + ((s * 5) % 12);
    const a  = 0.42 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.02 + s));

    ctx.globalAlpha = a;
    ctx.strokeStyle = s % 3 === 0 ? 'rgba(255,245,190,0.95)' : 'rgba(255,128,34,0.9)';
    ctx.lineWidth = s % 3 === 0 ? 1.8 : 1.2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - Math.cos(ang) * len, py - Math.sin(ang) * len);
    ctx.stroke();

    ctx.fillStyle = s % 3 === 0 ? '#fff6b8' : '#ff7a1f';
    ctx.fillRect(px - 1, py - 1, 2, 2);
  }

  ctx.restore();
}
}

function drawComboBanner() {
  if (comboStage === 0 || state !== 'running') return;

  const isSuper = comboStage >= 2;
  const text = isSuper ? 'スーパーコンボ中！' : 'コンボ中！';
  const t = animTime * 0.006;
  const x = CANVAS_WIDTH / 2;
  const y = 54 + Math.sin(t * 2.2) * 2;
  const paddingX = isSuper ? 26 : 22;
  const width = isSuper ? 250 : 150;
  const height = 38;

  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = isSuper ? '#ff7a1f' : '#ffcc33';
  ctx.strokeStyle = isSuper ? '#7a2e0d' : '#8a4e22';
  ctx.lineWidth = 3;
  ctx.beginPath();
  drawRoundedRectPath(x - width / 2, y - height / 2, width, height, 8);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = isSuper ? '#7a2e0d' : '#fff7d6';
  ctx.fillStyle = isSuper ? '#fff7d6' : '#3d3024';
  ctx.strokeText(text, x, y + 1);
  ctx.fillText(text, x, y + 1);

  const sparkleY = y - height / 2 + 2;
  drawSparkStar(x - width / 2 + paddingX, sparkleY, 5, 0.75, t);
  drawSparkStar(x + width / 2 - paddingX, sparkleY + 4, 5, 0.75, -t);
  ctx.restore();
}

function drawRoundedRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

  

  function gameLoop(now) {
    if (state === 'running') {
      const cpuStart = performanceMode ? performance.now() : 0;
      update(now);
      drawInterpolatedFrame();
      if (performanceMode) {
        if (!frameMetrics.start) frameMetrics.start = now;
        if (frameMetrics.last) frameMetrics.maxGap = Math.max(frameMetrics.maxGap, now - frameMetrics.last);
        frameMetrics.last = now;
        frameMetrics.frames++;
        frameMetrics.cpu += performance.now() - cpuStart;
        const elapsed = now - frameMetrics.start;
        if (elapsed >= 1000) {
          performanceHud.textContent = `FPS ${Math.round(frameMetrics.frames * 1000 / elapsed)} / 処理 ${(frameMetrics.cpu / frameMetrics.frames).toFixed(1)}ms / 最大間隔 ${Math.round(frameMetrics.maxGap)}ms`;
          frameMetrics.frames = frameMetrics.cpu = frameMetrics.maxGap = 0;
          frameMetrics.start = now;
        }
      }
      requestAnimationFrame(gameLoop);
    } else if (state === 'over') {
      updateFlyingIcons();
      draw();
    }
  }

  function moveForDrawing(object, alpha) {
    object.actualX = object.x;
    object.actualY = object.y;
    if (object.previousX !== undefined) object.x = object.previousX + (object.x - object.previousX) * alpha;
    if (object.previousY !== undefined) object.y = object.previousY + (object.y - object.previousY) * alpha;
  }

  function restoreDrawingPosition(object) {
    object.x = object.actualX;
    object.y = object.actualY;
  }

  function drawInterpolatedFrame() {
    // 物理計算がないフレームも前後の位置の間を描く。描画を飛ばすとSafariで移動が途切れる。
    const alpha = Math.min(1, physicsRemainder / PHYSICS_STEP);
    const actualScrollX = scrollX;
    const actualY = player.y;
    const actualRotation = player.rotation;
    scrollX = previousScrollX + (scrollX - previousScrollX) * alpha;
    player.y = previousPlayerY + (player.y - previousPlayerY) * alpha;
    player.rotation = previousPlayerRotation + (player.rotation - previousPlayerRotation) * alpha;
    for (const item of items) moveForDrawing(item, alpha);
    for (const pit of pits) moveForDrawing(pit, alpha);
    for (const icon of flyingIcons) moveForDrawing(icon, alpha);
    if (goal) moveForDrawing(goal, alpha);
    try {
      draw();
    } finally {
      scrollX = actualScrollX;
      player.y = actualY;
      player.rotation = actualRotation;
      for (const item of items) restoreDrawingPosition(item);
      for (const pit of pits) restoreDrawingPosition(pit);
      for (const icon of flyingIcons) restoreDrawingPosition(icon);
      if (goal) restoreDrawingPosition(goal);
    }
  }

  function wrapResultText(exportCtx, text, x, y, maxWidth, lineHeight) {
    let line = '';
    for (const character of text) {
      if (line && exportCtx.measureText(line + character).width > maxWidth) {
        exportCtx.fillText(line, x, y);
        y += lineHeight;
        line = '';
      }
      line += character;
    }
    exportCtx.fillText(line, x, y);
  }

  async function prepareResultImage() {
    const version = ++resultExportVersion;
    saveImageButton.disabled = true;
    saveImageButton.textContent = '画像を準備中…';
    try {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = 1600;
      exportCanvas.height = 800;
      const exportCtx = exportCanvas.getContext('2d');
      exportCtx.scale(2, 2);
      exportCtx.imageSmoothingEnabled = false;
      const sources = ['assets/result_bg.png', 'assets/title_logo.png'];
      const pictures = Array.from(resultIngredients.querySelectorAll('img'));
      const assets = await Promise.all([...sources, ...pictures.map(img => img.src)].map(src => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('画像を読み込めませんでした'));
        img.src = src;
      })));
      if (version !== resultExportVersion) return;
      exportCtx.drawImage(assets[0], 0, 0, 800, 400);
      exportCtx.drawImage(assets[1], 10, 18, 185, 185 * assets[1].height / assets[1].width);
      exportCtx.fillStyle = '#3d3024';
      exportCtx.textAlign = 'center';
      exportCtx.font = '900 24px sans-serif';
      const titleLines = Array.from(ingredientMsg.children).map(node => node.textContent);
      titleLines.forEach((line, index) => exportCtx.fillText(line, 400, 70 + index * 28, 440));
      exportCtx.drawImage(player.image, 305, 124, 190, 190);
      pictures.forEach((img, index) => {
        const size = parseFloat(img.style.width);
        const rotation = /rotate\(([-\d.]+)deg\)/.exec(img.style.transform);
        const scaleMatch = /scale\(([-\d.]+)\)/.exec(img.style.transform);
        exportCtx.save();
        exportCtx.translate(277 + parseFloat(img.style.left) + size / 2, 110 + parseFloat(img.style.top) + size / 2);
        exportCtx.rotate(Number(rotation?.[1] || 0) * Math.PI / 180);
        const sizeScale = Number(scaleMatch?.[1] || 1);
        exportCtx.scale(sizeScale, sizeScale);
        exportCtx.drawImage(assets[index + 2], -size / 2, -size / 2, size, size);
        exportCtx.restore();
      });
      exportCtx.fillStyle = '#fff3b6';
      exportCtx.beginPath();
      exportCtx.ellipse(123, 180, 80, 54, -0.12, 0, Math.PI * 2);
      exportCtx.fill();
      exportCtx.fillStyle = '#6f3f1f';
      exportCtx.font = '900 21px sans-serif';
      exportCtx.fillText(resultRank.querySelector('span').textContent, 123, 176);
      exportCtx.font = '900 15px sans-serif';
      exportCtx.fillText(resultRank.querySelector('strong').textContent, 123, 200, 140);
      exportCtx.fillStyle = 'rgba(255,253,243,0.95)';
      exportCtx.fillRect(222, 315, 358, 58);
      exportCtx.fillStyle = '#6f3f1f';
      exportCtx.font = 'bold 15px sans-serif';
      wrapResultText(exportCtx, resultFortune.textContent, 400, 338, 326, 21);
      exportCtx.textAlign = 'left';
      exportCtx.font = 'bold 11px sans-serif';
      exportCtx.fillText(resultScore.textContent, 30, 303);
      exportCtx.fillText(resultBonus.textContent, 30, 321);
      exportCtx.font = '11px sans-serif';
      const entries = getCollectedEntries().map(([name, count]) => `${name} ×${count}`).join('　') || '具材なし';
      wrapResultText(exportCtx, entries, 30, 339, 180, 16);
      if (resultSpecial.classList.contains('show')) {
        exportCtx.textAlign = 'center';
        exportCtx.font = '900 17px sans-serif';
        exportCtx.fillText(resultSpecial.innerText.replace(/\n/g, ' '), 700, 85, 170);
      }
      exportCtx.textAlign = 'right';
      exportCtx.font = '10px sans-serif';
      exportCtx.fillText('ころがりおにぎり', 780, 372);
      exportCtx.fillText('BGM：OtoLogic（CC BY 4.0）', 780, 390);
      const blob = await new Promise((resolve, reject) => exportCanvas.toBlob(value => value ? resolve(value) : reject(new Error('画像を作成できませんでした')), 'image/png'));
      if (version !== resultExportVersion) return;
      if (resultImageUrl) URL.revokeObjectURL(resultImageUrl);
      resultImageUrl = URL.createObjectURL(blob);
      resultFile = new File([blob], 'onigiri-result.png', { type: 'image/png' });
      saveImageButton.textContent = '画像を保存';
      saveImageButton.disabled = false;
    } catch (error) {
      if (version !== resultExportVersion) return;
      saveImageButton.textContent = '画像を再準備';
      saveImageButton.disabled = false;
      saveStatus.textContent = '画像の準備に失敗しました。もう一度押してね。';
    }
  }

  saveImageButton.addEventListener('click', async () => {
    if (!resultFile) { prepareResultImage(); return; }
    saveStatus.textContent = '';
    if (navigator.share && navigator.canShare?.({ files: [resultFile] })) {
      try {
        // 作成済みのFileを渡し、Safariのユーザー操作の有効期間内に共有する。
        await navigator.share({ files: [resultFile] });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    savePreviewImage.src = resultImageUrl;
    saveDownloadLink.href = resultImageUrl;
    savePreview.style.display = 'flex';
  });
  document.getElementById('closeSavePreview').addEventListener('click', () => {
    savePreview.style.display = 'none';
  });

  startButton.addEventListener('click', () => {
    if (state === 'start' || state === 'over') startGame();
  });
  function acceptSoundPrompt() {
    unlockEffects();
    soundPrompt.style.display = 'none';
    setBgmEnabled(true);
  }

  function dismissSoundPromptMuted() {
    unlockEffects();
    soundPrompt.style.display = 'none';
    setBgmEnabled(false);
  }

  soundOkButton.addEventListener('click', acceptSoundPrompt);
  soundMuteButton.addEventListener('click', dismissSoundPromptMuted);
  bgmToggle.addEventListener('click', () => setBgmEnabled(!titleBgmEnabled));
  restartButton.addEventListener('click', () => startGame());
  resultTeaser.addEventListener('click', showResult);
  jumpButton.addEventListener('click', jump);
  gameContainer.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0 || state !== 'running') return;
    if (e.target.closest('button, a, .overlay')) return;
    e.preventDefault();
    jump();
  });
  // Safariでも連続タップをズームやページ移動として扱わせない。
  for (const eventName of ['touchmove', 'gesturestart', 'gesturechange', 'dblclick']) {
    gameContainer.addEventListener(eventName, (e) => e.preventDefault(), { passive: false });
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      if (e.target === bgmToggle || e.target === soundMuteButton) return;
      e.preventDefault();
      if (soundPrompt.style.display !== 'none') {
        acceptSoundPrompt();
        return;
      }
      if (state === 'start') {
        startGame();
        return;
      }
      if (resultTeaser.style.display !== 'none') {
        showResult();
        return;
      }
      jump();
      return;
    }
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      jump();
    }
  });

  startButton.disabled = true;
  Promise.all([preloadImages(), preloadEffects()]).then(() => {
    gameReady = true;
    startButton.disabled = false;
    document.getElementById('loadingStatus').textContent = '';
  }).catch(() => {
    document.getElementById('loadingStatus').textContent = '読み込みに失敗しました。ページを再読み込みしてね。';
  });

  window.addEventListener('resize', () => {
  // キャンバスをリサイズするあなたの既存処理がある想定
  // その直後にゴールのサイズを再計算
  if (goal) {
    const w = GOAL_HOUSE_WIDTH;
    const h = GOAL_HOUSE_HEIGHT;
    // 座標は「下端合わせ」継続（x は現状維持 / y は高さに合わせ直す）
    const yBottom = GROUND_Y + player.height - 20;
    goal.width = w;
    goal.height = h;
    goal.y = yBottom - h;
  }
});

})();
