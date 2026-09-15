export type ProgressState = {
  coinCollected: boolean[];
  collectedCount: number;
  giantHp: number;
  attackCooldown: number;
};

export const createProgressState = (coinTotal: number, giantHp = 3): ProgressState => ({
  coinCollected: Array.from({ length: coinTotal }, () => false),
  collectedCount: 0,
  giantHp,
  attackCooldown: 0,
});

export const collectCoin = (state: ProgressState, index: number): boolean => {
  if (index < 0 || index >= state.coinCollected.length || state.coinCollected[index]) return false;
  state.coinCollected[index] = true;
  state.collectedCount += 1;
  return true;
};

export const tryAttack = (state: ProgressState, inRange: boolean, cooldown = 0.62): "hit" | "cooldown" | "out-of-range" | "defeated" => {
  if (state.giantHp <= 0) return "defeated";
  if (state.attackCooldown > 0) return "cooldown";
  state.attackCooldown = cooldown;
  if (!inRange) return "out-of-range";
  state.giantHp -= 1;
  return "hit";
};

export const tickAttackCooldown = (state: ProgressState, dt: number): void => {
  state.attackCooldown = Math.max(0, state.attackCooldown - dt);
};

export const isStageClear = (state: ProgressState, requiredCoins = 8): boolean => state.collectedCount >= requiredCoins && state.giantHp <= 0;

export const resetProgress = (state: ProgressState): void => {
  state.coinCollected.fill(false);
  state.collectedCount = 0;
  state.giantHp = 3;
  state.attackCooldown = 0;
};

export const wireLaunchVelocity = (grounded: boolean, playerY: number, playerHalfHeight: number, anchorY: number, currentVelocityY: number): number => {
  if (!grounded && playerY > playerHalfHeight + 0.05) return currentVelocityY;
  const towardAnchor = Math.max(0, anchorY - playerY);
  return Math.max(currentVelocityY, 7.5 + Math.min(4, towardAnchor * 0.08));
};

export const airMomentumStep = (velocityX: number, velocityZ: number, inputX: number, inputZ: number, dt: number, boost: boolean): [number, number] => {
  const steering = (boost ? 14 : 9) * dt;
  const drag = Math.pow(0.997, dt * 60);
  return [
    velocityX * drag + inputX * steering,
    velocityZ * drag + inputZ * steering,
  ];
};
