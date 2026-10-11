import './app-menu.css';

export type GameSettings = { sensitivity: number; quality: 'low' | 'standard' | 'high'; courseCamera: boolean; speedLines: boolean; volume: number };
const defaults: GameSettings = { sensitivity: 1, quality: 'standard', courseCamera: true, speedLines: true, volume: .4 };
const key = 'skybreak.settings.v1';
const read = (name: string): unknown => { try { return JSON.parse(localStorage.getItem(name) ?? 'null'); } catch { return null; } };
const save = (name: string, value: unknown): void => { try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* Private storage may be unavailable. */ } };
export const loadSettings = (): GameSettings => {
  const raw = read(key) as Partial<GameSettings> | null;
  const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return { sensitivity: bounded(raw?.sensitivity, 1, .5, 2), quality: ['low', 'standard', 'high'].includes(raw?.quality ?? '') ? raw!.quality! : 'standard', courseCamera: typeof raw?.courseCamera === 'boolean' ? raw.courseCamera : true, speedLines: typeof raw?.speedLines === 'boolean' ? raw.speedLines : true, volume: bounded(raw?.volume, .4, 0, 1) };
};

export function createAppMenu(callbacks: { start: () => void; resetInput: () => void; settings: (settings: GameSettings) => void }) {
  const layer = document.querySelector<HTMLElement>('#app-menu')!;
  const hud = document.querySelector<HTMLElement>('#hud')!;
  const touch = document.querySelector<HTMLElement>('#touch-ui')!;
  const clear = document.querySelector<HTMLElement>('#clear-screen')!;
  let view = 'title';
  let returnView = 'title';
  let activeRun = false;
  let runCleared = false;
  let completed = read('skybreak.stage1.clear') === true;
  let settings = loadSettings();
  let audio: AudioContext | undefined;
  const sound = (kind: 'ui' | 'wire' | 'coin' | 'attack' | 'boost' = 'ui') => {
    if (!settings.volume) return;
    try {
      audio ??= new AudioContext();
      void audio.resume().catch(() => {});
      const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
      const frequency = { ui: 420, wire: 220, coin: 880, attack: 110, boost: 160 }[kind];
      oscillator.type = kind === 'attack' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + .09);
      gain.gain.setValueAtTime(settings.volume * .08, now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .12);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(now); oscillator.stop(now + .13);
    } catch { /* Audio support is optional. */ }
  };
  const button = (action: string, label: string, primary = false) => `<button type="button" data-menu="${action}" class="menu-button${primary ? ' primary' : ''}">${label}</button>`;
  const header = (eyebrow: string, title: string) => `<header class="menu-header"><div><span class="menu-kicker">${eyebrow}</span><h1>${title}</h1></div>${button('back', '← 戻る')}</header>`;
  const render = () => {
    const playing = view === 'playing';
    layer.hidden = playing;
    hud.hidden = !playing; touch.hidden = !playing;
    hud.inert = !playing; touch.inert = !playing;
    clear.inert = !playing;
    if (!playing) clear.classList.add('is-hidden');
    document.querySelector('#game-shell')?.setAttribute('data-screen', view);
    if (playing) { clear.classList.toggle('is-hidden', !runCleared); document.querySelector<HTMLCanvasElement>('#render-canvas')?.focus({ preventScroll: true }); return; }
    let content = '';
    if (view === 'title') content = `<div class="title-layout"><div class="title-copy"><span class="menu-kicker">WIRE ACTION / AIR DISTRICT</span><h1 class="title-logo">SKY<span>BREAK</span></h1><p class="title-tagline">街をつないで、空を飛べ。</p><p class="title-detail">ワイヤーで飛び回り、コインを集めて巨人に挑め。</p><span class="title-stamp">TOUCH TO FLY</span></div><nav class="title-nav" aria-label="メインメニュー">${button('start', (activeRun ? 'ステージ1を最初から' : 'ステージ1をはじめる') + ' <span>↗</span>', true)}${activeRun ? button('resume', 'プレイを続ける') : ''}${button('stages', 'ステージ選択')}${button('options', 'オプション')}${button('help', '遊び方')}<p class="menu-note">スマホ横画面推奨 · イヤホン対応</p></nav></div>`;
    if (view === 'stages') content = `${header('CHOOSE YOUR SKY', 'ステージ選択')}<div class="stage-grid"><button class="stage-card playable" type="button" data-menu="start"><span class="stage-number">01</span><span class="stage-status">${completed ? 'CLEAR ✓' : 'PLAYABLE'}</span><h2>はじめの飛行</h2><p>チュートリアル<br>ワイヤー・コイン回収・巨人戦</p><strong>プレイする ↗</strong></button>${[2, 3].map(n => `<button class="stage-card developing" type="button" data-menu="dev${n}" aria-label="ステージ${n}、開発中"><span class="stage-number">0${n}</span><span class="stage-status">COMING SOON</span><h2>ステージ${n}</h2><p>新しい空への準備中。</p><strong>開発中</strong></button>`).join('')}</div><p class="menu-note">ステージ1から操作を練習できます。2・3は今後追加予定です。</p>`;
    if (view.startsWith('dev')) content = `${header('COMING SOON / STAGE ' + view.slice(3), '開発中')}<div class="coming-soon"><span class="stage-number">0${view.slice(3)}</span><h2>次の空を、準備しています。</h2><p>このステージはまだプレイできません。<br>まずはステージ1でワイヤーアクションを楽しもう。</p>${button('start', 'ステージ1をプレイ', true)}${button('stages', 'ステージ選択へ')}</div>`;
    if (view === 'options') content = `${header('MAKE IT YOURS', 'オプション')}<div class="options-grid"><label class="option-row"><span>カメラ感度 <output id="sensitivity-value">${settings.sensitivity.toFixed(1)}×</output></span><input id="camera-sensitivity" data-setting="sensitivity" type="range" min=".5" max="2" step=".1" value="${settings.sensitivity}" /></label><label class="option-row"><span>効果音の音量 <output id="volume-value">${Math.round(settings.volume * 100)}%</output></span><input id="sound-volume" data-setting="volume" type="range" min="0" max="1" step=".05" value="${settings.volume}" /></label><label class="option-row"><span>描画品質</span><select id="render-quality" data-setting="quality"><option value="low" ${settings.quality === 'low' ? 'selected' : ''}>軽量 · 解像度を抑える</option><option value="standard" ${settings.quality === 'standard' ? 'selected' : ''}>標準</option><option value="high" ${settings.quality === 'high' ? 'selected' : ''}>高画質 · 負荷が高め</option></select></label><label class="option-row toggle-row"><span>チュートリアルのカメラ補助<small>次のポイントを見やすくする</small></span><input data-setting="courseCamera" type="checkbox" ${settings.courseCamera ? 'checked' : ''} /></label><label class="option-row toggle-row"><span>スピード集中線<small>高速飛行時の画面エフェクト</small></span><input data-setting="speedLines" type="checkbox" ${settings.speedLines ? 'checked' : ''} /></label></div><footer class="menu-footer"><p class="menu-note">設定はこのブラウザに自動保存されます。</p>${button('defaults', '標準設定に戻す')}</footer>`;
    if (view === 'help') content = `${header('HOW TO FLY', '遊び方')}<div class="help-grid"><article><h2>01 / 移動・カメラ</h2><p>左のMOVEで移動。右の空いた場所をスワイプしてカメラを動かします。</p></article><article><h2>02 / WIRE → NEXT</h2><p>画面内の最寄りの黄色い球へ接続。接続中はNEXTで次の点へ。RELEASEで勢いを保って解除。</p></article><article><h2>03 / BOOST・復帰</h2><p>BOOSTで加速。地面に落ちたら上を見てWIRE。短時間の巻き取りで上昇できます。</p></article><article><h2>04 / ステージ1の目標</h2><p>3ポイントの下を順番に通過し、コイン8枚と巨人撃破を目指そう。黄色い輪はコインです。</p></article></div><p class="menu-note">PC：WASD 移動 / ドラッグ カメラ / Space 接続 / Q 解除 / Shift 加速 / E 攻撃 / Esc 一時停止</p>`;
    if (view === 'pause') content = `${header('TAKE A BREATH', '一時停止')}<div class="pause-actions">${button('resume', 'プレイを続ける', true)}${button('options', 'オプション')}${button('help', '遊び方')}${button('restart', 'ステージ1をやり直す')}${button('title', 'タイトルへ戻る')}</div>`;
    if (view === 'confirm-restart') content = `${header('RETRY STAGE 01', '最初からやり直す？')}<p>今回のコイン・巨人戦・飛行の進み具合がリセットされます。</p><div class="pause-actions">${button('confirm-restart', 'やり直す', true)}${button('back', 'キャンセル')}</div>`;
    layer.innerHTML = `<div class="menu-panel ${view === 'title' ? 'title-panel' : ''}">${content}</div><div class="menu-version">SKYBREAK / STAGE 01 · DEVELOPMENT BUILD</div>`;
    layer.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true });
  };
  const show = (next: string) => { callbacks.resetInput(); if (next === 'title' || next === 'stages') returnView = 'title'; view = next; render(); };
  const startRun = () => { callbacks.start(); activeRun = true; runCleared = false; show('playing'); };
  const confirmRestart = () => { returnView = view === 'playing' || view === 'pause' ? 'pause' : view; show('confirm-restart'); };
  const apply = () => { save(key, settings); callbacks.settings(settings); };
  layer.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-menu]');
    if (!target) return;
    sound(); const action = target.dataset.menu!;
    if (action === 'start') { if (activeRun) confirmRestart(); else startRun(); }
    else if (action === 'restart') confirmRestart();
    else if (action === 'confirm-restart') startRun();
    else if (action === 'defaults') { settings = { ...defaults }; apply(); render(); }
    else if (action === 'resume') show('playing');
    else if (action === 'back') show(view.startsWith('dev') ? 'stages' : view === 'pause' ? 'playing' : returnView);
    else { if (action === 'options' || action === 'help') returnView = view === 'pause' ? 'pause' : 'title'; show(action); }
  });
  layer.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    const name = input.dataset.setting as keyof GameSettings | undefined;
    if (!name) return;
    if (name === 'sensitivity' || name === 'volume') {
      settings[name] = Number(input.value);
      layer.querySelector('output#' + (name === 'volume' ? 'volume-value' : 'sensitivity-value'))!.textContent = name === 'volume' ? Math.round(settings.volume * 100) + '%' : settings.sensitivity.toFixed(1) + '×';
    } else if (name === 'quality') settings.quality = input.value as GameSettings['quality'];
    else settings[name] = input.checked;
    apply();
  });
  const pause = () => { if (view === 'playing') show('pause'); };
  document.querySelector('#pause-button')!.addEventListener('click', () => { sound(); pause(); });
  document.querySelector('#clear-title')!.addEventListener('click', () => show('title'));
  document.querySelector('#clear-stages')!.addEventListener('click', () => show('stages'));
  callbacks.settings(settings); render();
  return { isPlaying: () => view === 'playing', getSettings: () => settings, pause, restart: startRun, confirmRestart, showTitle: () => show('title'), sound, markClear: () => { completed = true; activeRun = false; runCleared = true; save('skybreak.stage1.clear', true); }, escape: () => { if (view === 'playing') pause(); else if (view === 'pause') show('playing'); else if (activeRun) show('pause'); else show('title'); } };
}
