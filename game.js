const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function loadImage(src, onLoad) {
  const img = new Image();
  if (onLoad) {
    img.onload = () => onLoad(img);
  }
  img.src = src;
  return img;
}

// Remove a flat background color (sampled from 0,0) by making near-matching pixels transparent
function chromaKeyImage(img, tolerance = 60) {
  const off = document.createElement('canvas');
  off.width = img.width;
  off.height = img.height;
  const offCtx = off.getContext('2d');
  offCtx.drawImage(img, 0, 0);
  const imageData = offCtx.getImageData(0, 0, off.width, off.height);
  const data = imageData.data;
  const [r0, g0, b0] = [data[0], data[1], data[2]];

  for (let i = 0; i < data.length; i += 4) {
    const dr = Math.abs(data[i] - r0);
    const dg = Math.abs(data[i + 1] - g0);
    const db = Math.abs(data[i + 2] - b0);
    if (dr < tolerance && dg < tolerance && db < tolerance) {
      data[i + 3] = 0; // make transparent
    }
  }
  offCtx.putImageData(imageData, 0, 0);
  return off;
}

const assets = {
  player: loadImage('player.png'),
  platform: loadImage('platform.png'),
  coin: loadImage('coin.png'),
  enemy: loadImage('enemy.png'),
  playerFaces: null,
  powerup: loadImage('ecar.png'),
  background: loadImage('background.png'),
};

// Player sprite sheet animation data
const PLAYER_TARGET_HEIGHT = 600 // desired on-canvas height for player sprite (4x original, 2x current)
const playerAnim = {
  sheet: null,
  frameWidth: 0,
  frameHeight: 0,
  scale: 1,
  baseScale: 1,
  frameIndex: 0,
  frameRate: 8, // frames per second
  timer: 0,
  currentAction: 'idleFront',
  ready: false,
};

const player = {
  x: 500,
  y: 400,
  width: 100,
  height: 70,
  speed: 1,
  yVelocity: 2,
  isGrounded: false,
  jumpForce: -15,
  gravity: 0.6,
};

// Load the player-faces sheet and set frame sizing
assets.playerFaces = loadImage('player-faces.png', (img) => {
  const keyed = chromaKeyImage(img);
  playerAnim.sheet = keyed;
  playerAnim.frameWidth = img.width / 5;
  playerAnim.frameHeight = img.height / 3;
  // Scale to a reasonable on-canvas height
  playerAnim.baseScale = PLAYER_TARGET_HEIGHT / playerAnim.frameHeight;
  playerAnim.scale = playerAnim.baseScale;
  player.width = playerAnim.frameWidth * playerAnim.scale;
  player.height = playerAnim.frameHeight * playerAnim.scale;
  playerAnim.ready = true;
});

// Define the platforms in the level
const platforms = [
  { x: 0, y: canvas.height - 20, width: canvas.width, height: 20, color: '#222', isGround: true },
  { x: 100, y: 350, width: 150, height: 20, color: 'brown', speed: 0.8, direction: 1, patrolMin: 60, patrolMax: 360 },
  { x: 350, y: 250, width: 100, height: 20, color: 'brown', speed: 1, direction: -1, patrolMin: 260, patrolMax: 520 },
  { x: 520, y: 320, width: 140, height: 20, color: 'brown', speed: 0.6, direction: 1, patrolMin: 440, patrolMax: 760 },
  { x: 650, y: 200, width: 120, height: 20, color: 'brown', speed: 0.7, direction: -1, patrolMin: 520, patrolMax: 820 },
  // Stair platforms going up
  { x: 200, y: 180, width: 80, height: 20, color: 'brown' },
  { x: 300, y: 120, width: 80, height: 20, color: 'brown' },
  { x: 390, y: 45, width: 80, height: 20, color: 'brown' },
];

// Coins and enemies (visual only for now)
const COIN_COUNT = 6;
function randomCoin() {
  const size = 32; // 2x previous
  const marginX = 150;
  const marginY = 160;
  const x = Math.random() * (canvas.width - 2 * marginX - size) + marginX;
  const y = Math.random() * (canvas.height - 2 * marginY - size) + marginY;
  return {
    x,
    y,
    size,
    visible: true,
    nextToggle: 0,
    blinkInterval: 1.5 + Math.random(), // vary blink slightly
  };
}

function generateCoins() {
  return Array.from({ length: COIN_COUNT }, () => randomCoin());
}

let coins = generateCoins();

const powerups = [
  { x: 500, y: 20, size: 48, collected: false }, // doubled base size; draw uses size * 2
];

const initialEnemies = [
  {
    id: 1,
    x: 250,
    y: canvas.height - 20 - 56,
    width: 56,
    height: 56,
    speed: 2,
    direction: 1,
    patrolMin: 200,
    patrolMax: 500,
  },
  {
    id: 2,
    x: 50,
    y: canvas.height - 20 - 56,
    width: 56,
    height: 56,
    speed: 1.5,
    direction: 1,
    patrolMin: 20,
    patrolMax: 180,
  },
  {
    id: 3,
    x: 420,
    y: 320 - 56,
    width: 56,
    height: 56,
    speed: 1.2,
    direction: -1,
    patrolMin: 350,
    patrolMax: 520,
  },
  {
    id: 4,
    x: 650,
    y: 200 - 56,
    width: 56,
    height: 56,
    speed: 1.0,
    direction: 1,
    patrolMin: 620,
    patrolMax: 750,
  },
];

let enemies = initialEnemies.map((e) => ({ ...e }));
let deadEnemies = [];

const WIN_SCORE = 15;
let score = 0;
let winnerShown = false;
let loserShown = false;
let lastHitTime = 0;
const HIT_COOLDOWN = 0.5; // seconds

// Track which movement keys are pressed
const keys = {
  left: false,
  right: false,
  up: false,
};

// Key down events
window.addEventListener('keydown', (event) => {
  switch (event.key) {
    case 'ArrowLeft':
    case 'a':
      keys.left = true;
      break;
    case 'ArrowRight':
    case 'd':
      keys.right = true;
      break;
    case ' ':
    case 'ArrowUp':
    case 'w':
      keys.up = true;
      break;
    case 'r':
    case 'R':
      resetGame();
      break;
    default:
      break;
  }
});

// Key up events
window.addEventListener('keyup', (event) => {
  switch (event.key) {
    case 'ArrowLeft':
    case 'a':
      keys.left = false;
      break;
    case 'ArrowRight':
    case 'd':
      keys.right = false;
      break;
    case ' ':
    case 'ArrowUp':
    case 'w':
      keys.up = false;
      break;
    default:
      break;
  }
});

// Mobile touch controls
function setupMobileControls() {
  const btnLeft = document.getElementById('btnLeft');
  const btnRight = document.getElementById('btnRight');
  const btnJump = document.getElementById('btnJump');

  if (!btnLeft || !btnRight || !btnJump) return;

  // Left button
  btnLeft.addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.left = true;
  });
  btnLeft.addEventListener('touchend', (e) => {
    e.preventDefault();
    keys.left = false;
  });
  btnLeft.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    keys.left = false;
  });

  // Right button
  btnRight.addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.right = true;
  });
  btnRight.addEventListener('touchend', (e) => {
    e.preventDefault();
    keys.right = false;
  });
  btnRight.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    keys.right = false;
  });

  // Jump button
  btnJump.addEventListener('touchstart', (e) => {
    e.preventDefault();
    keys.up = true;
  });
  btnJump.addEventListener('touchend', (e) => {
    e.preventDefault();
    keys.up = false;
  });
  btnJump.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    keys.up = false;
  });
}

// Initialize mobile controls when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupMobileControls);
} else {
  setupMobileControls();
}

// Prevent default touch behaviors on canvas
canvas.addEventListener('touchstart', (e) => e.preventDefault());
canvas.addEventListener('touchmove', (e) => e.preventDefault());
canvas.addEventListener('touchend', (e) => e.preventDefault());

/**
 * Axis-Aligned Bounding Box collision detection
 */
function checkCollision(rect1, rect2) {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

function getPlayerAction() {
  if (!player.isGrounded) return 'jump';
  if (keys.left || keys.right) return 'run';
  return 'idleFront';
}

const playerActions = {
  idleFront: { row: 0, frames: [0, 1, 2, 3, 4] },
  run: { row: 1, frames: [0, 1, 2, 3, 4] },
  jump: { row: 2, frames: [2] },
};

function updatePlayerAnimation(delta) {
  if (!playerAnim.ready) return;
  const action = getPlayerAction();
  const def = playerActions[action];
  if (!def) return;
  if (playerAnim.currentAction !== action) {
    playerAnim.currentAction = action;
    playerAnim.frameIndex = 0;
    playerAnim.timer = 0;
  }
  if (def.frames.length > 1) {
    const frameDuration = 1 / playerAnim.frameRate;
    playerAnim.timer += delta;
    while (playerAnim.timer >= frameDuration) {
      playerAnim.timer -= frameDuration;
      playerAnim.frameIndex = (playerAnim.frameIndex + 1) % def.frames.length;
    }
  } else {
    playerAnim.frameIndex = 0;
    playerAnim.timer = 0;
  }
}

function resetGame() {
  score = 0;
  winnerShown = false;
  loserShown = false;
  lastHitTime = 0;
  playerAnim.baseScale = playerAnim.baseScale || (playerAnim.frameHeight ? PLAYER_TARGET_HEIGHT / playerAnim.frameHeight : 1);
  playerAnim.scale = playerAnim.baseScale || playerAnim.scale || 1;
  player.width = playerAnim.frameWidth * playerAnim.scale;
  player.height = playerAnim.frameHeight * playerAnim.scale;
  platforms[0].width = canvas.width;
  platforms[0].y = canvas.height - platforms[0].height;
  coins = generateCoins();
  enemies = initialEnemies.map((e) => ({ ...e }));
  deadEnemies = [];
  powerups.forEach((p) => {
    p.collected = false;
  });
}

function update(delta = 0, now = 0) {
  const prevY = player.y;
  // Horizontal movement
  if (keys.left) {
    player.x -= player.speed;
  }
  if (keys.right) {
    player.x += player.speed;
  }

  // Apply gravity
  player.yVelocity += player.gravity;

  // Apply velocity to position
  player.y += player.yVelocity;

  // Assume airborne until a platform says otherwise
  player.isGrounded = false;

  // Platform collisions (vertical resolution)
  platforms.forEach((platform) => {
    if (checkCollision(player, platform)) {
      if (player.yVelocity > 0) {
        // Landing on top
        player.y = platform.y - player.height;
        player.yVelocity = 0;
        player.isGrounded = true;
      } else if (player.yVelocity < 0) {
        // Hitting head from below
        player.y = platform.y + platform.height;
        player.yVelocity = 0;
      }
    }
  });

  // Jumping
  if (keys.up && player.isGrounded) {
    player.yVelocity = player.jumpForce;
    player.isGrounded = false;
  }

  // Coin collection
  for (let i = coins.length - 1; i >= 0; i -= 1) {
    const coin = coins[i];
    // Blink visibility
    if (now >= coin.nextToggle) {
      coin.visible = !coin.visible;
      coin.nextToggle = now + (coin.blinkInterval || 2);
    }
    if (!coin.visible) continue;
    const coinRect = { x: coin.x, y: coin.y, width: coin.size, height: coin.size };
    if (checkCollision(player, coinRect)) {
      // Relocate coin for fresh position
      const newCoin = randomCoin();
      newCoin.nextToggle = now + (newCoin.blinkInterval || 2);
      coins[i] = newCoin;
      score += 1;
    }
  }

  // Powerup collection
  powerups.forEach((p) => {
    if (!p.collected) {
      const hitSize = p.size * 2;
      const rect = { x: p.x, y: p.y, width: hitSize, height: hitSize };
      if (checkCollision(player, rect)) {
        p.collected = true;
        const oldBottom = player.y + player.height;

        // Only scale if sprite sheet is ready; else keep current size
        if (playerAnim.ready && playerAnim.frameWidth > 0 && playerAnim.frameHeight > 0) {
          const base = playerAnim.baseScale || (PLAYER_TARGET_HEIGHT / playerAnim.frameHeight) || 1;
          const newScale = base * 1.5;
          playerAnim.baseScale = base;
          playerAnim.scale = newScale;
          player.width = playerAnim.frameWidth * newScale;
          player.height = playerAnim.frameHeight * newScale;
        }

        // Keep feet planted and inside canvas
        player.y = oldBottom - player.height;
        if (player.y + player.height > canvas.height) {
          player.y = canvas.height - player.height;
        }
        player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
      }
    }
  });

  // Keep player within canvas bounds horizontally
  player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));

  // Enemy movement (simple horizontal patrol)
  enemies.forEach((enemy) => {
    enemy.x += enemy.speed * enemy.direction;
    if (enemy.x < enemy.patrolMin) {
      enemy.x = enemy.patrolMin;
      enemy.direction = 1;
    } else if (enemy.x + enemy.width > enemy.patrolMax) {
      enemy.x = enemy.patrolMax - enemy.width;
      enemy.direction = -1;
    }
  });

  // Enemy collision: stomp to kill or take damage
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    if (checkCollision(player, enemy)) {
      const playerBottomPrev = prevY + player.height;
      const enemyTop = enemy.y;
      const stomping = player.yVelocity > 0 && playerBottomPrev <= enemyTop + 4;
      if (stomping) {
        const dead = enemies.splice(i, 1)[0];
        deadEnemies.push({
          id: dead.id,
          respawnAt: now + 30,
        });
        score += 1;
        player.y = enemyTop - player.height;
        player.yVelocity = player.jumpForce * 0.6; // small bounce
        player.isGrounded = false;
      } else if (now - lastHitTime > HIT_COOLDOWN) {
        score -= 1;
        lastHitTime = now;
      }
    }
  }

  // Enemy respawns
  for (let i = deadEnemies.length - 1; i >= 0; i -= 1) {
    if (now >= deadEnemies[i].respawnAt) {
      const template = initialEnemies.find((e) => e.id === deadEnemies[i].id);
      if (template) {
        enemies.push({ ...template });
      }
      deadEnemies.splice(i, 1);
    }
  }

  // Win/Lose checks
  if (score >= WIN_SCORE && !winnerShown && !loserShown) {
    winnerShown = true;
  }
  if (score <= -3 && !loserShown) {
    loserShown = true;
  }

  updatePlayerAnimation(delta);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (assets.background.complete) {
    ctx.drawImage(assets.background, 0, 0, canvas.width, canvas.height);
  } else {
    // Solid fallback background to match page and mask any transparent edges
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Draw platforms
  platforms.forEach((platform) => {
    if (platform.speed) {
      platform.x += platform.speed * platform.direction;
      if (platform.x < platform.patrolMin) {
        platform.x = platform.patrolMin;
        platform.direction = 1;
      } else if (platform.x + platform.width > platform.patrolMax) {
        platform.x = platform.patrolMax - platform.width;
        platform.direction = -1;
      }
    }

    if (!platform.isGround && assets.platform.complete) {
      ctx.drawImage(
        assets.platform,
        platform.x,
        platform.y,
        platform.width,
        platform.height
      );
    } else {
      ctx.fillStyle = platform.color;
      ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    }
  });

  // Draw coins
  coins.forEach((coin) => {
    if (!coin.visible) return;
    const r = coin.size / 2;
    const cx = coin.x + r;
    const cy = coin.y + r;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (assets.coin.complete) {
      ctx.drawImage(assets.coin, coin.x, coin.y, coin.size, coin.size);
    } else {
      ctx.fillStyle = 'gold';
      ctx.fill();
    }
    ctx.restore();
    if (!assets.coin.complete) {
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // Draw powerups
  powerups.forEach((p) => {
    if (p.collected) return;
    const drawSize = p.size * 2;
    const r = drawSize / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x + r, p.y + r, r, 0, Math.PI * 2);
    ctx.clip();
    if (assets.powerup.complete) {
      ctx.drawImage(assets.powerup, p.x, p.y, drawSize, drawSize);
    } else {
      ctx.fillStyle = '#00c8ff';
      ctx.fill();
    }
    ctx.restore();
  });

  // Draw enemies
  enemies.forEach((enemy) => {
    const size = Math.min(enemy.width, enemy.height);
    const r = size / 2;
    const cx = enemy.x + enemy.width / 2;
    const cy = enemy.y + enemy.height / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (assets.enemy.complete) {
      ctx.drawImage(assets.enemy, enemy.x, enemy.y, enemy.width, enemy.height);
    } else {
      ctx.fillStyle = 'red';
      ctx.fill();
    }
    ctx.restore();
    if (!assets.enemy.complete) {
      ctx.strokeStyle = '#880000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // Draw player
  // Draw player (animated sprite sheet)
  if (playerAnim.ready && playerAnim.sheet) {
    const def = playerActions[playerAnim.currentAction];
    const col = def.frames[playerAnim.frameIndex];
    const sx = col * playerAnim.frameWidth;
    const sy = def.row * playerAnim.frameHeight;
    const sw = playerAnim.frameWidth;
    const sh = playerAnim.frameHeight;
    const dw = playerAnim.frameWidth * playerAnim.scale;
    const dh = playerAnim.frameHeight * playerAnim.scale;
    ctx.drawImage(playerAnim.sheet, sx, sy, sw, sh, player.x, player.y, dw, dh);
  } else if (assets.player.complete) {
    ctx.drawImage(assets.player, player.x, player.y, player.width, player.height);
  } else {
    ctx.fillStyle = 'blue';
    ctx.fillRect(player.x, player.y, player.width, player.height);
  }

  // HUD: score centered at top
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Score: ${score}`, canvas.width / 2, 30);
  ctx.textAlign = 'left';

  if (loserShown && score <= -3) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('You lose!', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '18px Arial';
    ctx.fillText('Press R to try again', canvas.width / 2, canvas.height / 2 + 20);
    ctx.textAlign = 'left';
  } else if (winnerShown && score >= WIN_SCORE) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('You win!', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '18px Arial';
    ctx.fillText('Press R to play again', canvas.width / 2, canvas.height / 2 + 20);
    ctx.textAlign = 'left';
  }
}

let lastTime = 0;
function gameLoop(timestamp = 0) {
  const delta = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  update(delta, timestamp / 1000);
  draw();
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

