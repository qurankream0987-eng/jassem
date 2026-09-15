/**
 * ═══════════════════════════════════════════════════════════
 * محرك الصوت التوليدي — Sonic DNA
 * كل الأصوات تُصنَّع برمجياً باستخدام Web Audio API
 * لا ملفات صوتية — ١٠٠٪ توليدي
 * ═══════════════════════════════════════════════════════════
 */

// ─── Context مشترك ───
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// ─── أنواع الموجات ───
type Waveform = "sine" | "square" | "sawtooth" | "triangle";

/** إعدادات المذبذب */
interface OscillatorConfig {
  frequency: number;
  type: Waveform;
  duration: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  volume: number;
  detune?: number;
}

/** إعدادات الحلقة */
interface LoopConfig {
  baseFreq: number;
  type: Waveform;
  interval: number;
  volume: number;
}

/** إعدادات الانفجار الصوتي */
interface BurstConfig {
  frequencies: number[];
  type: Waveform;
  duration: number;
  spread: number;
  volume: number;
}

/** إعدادات التأثير */
interface EffectConfig {
  frequency: number;
  type: Waveform;
  duration: number;
  sweep?: boolean;
  volume: number;
}

/** Sonic DNA — الحمض النووي الصوتي */
export interface SonicDNA {
  birth: OscillatorConfig;
  life: LoopConfig;
  death: BurstConfig;
  interact: EffectConfig;
}

// ═══════════════════════════════════════════
// مولدات ADSR
// ═════════════════━━━━━━━━━━━━━━━━━━━━━━━━━

/** تطبيق غلاف ADSR على عقدة كسب */
function applyADSR(
  gainNode: GainNode,
  ctx: AudioContext,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  volume: number
) {
  const now = ctx.currentTime;
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + attack);
  gainNode.gain.linearRampToValueAtTime(volume * sustain, now + attack + decay);
  gainNode.gain.setValueAtTime(volume * sustain, now + attack + decay + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + attack + decay + release);
}

/** تأثير الصدى (Reverb) */
function createReverb(ctx: AudioContext, duration: number = 1.5): ConvolverNode {
  const convolver = ctx.createConvolver();
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
  }

  convolver.buffer = impulse;
  return convolver;
}

/** تأثير التأخير (Delay) */
function createDelay(ctx: AudioContext, delayTime: number = 0.3): DelayNode {
  const delay = ctx.createDelay();
  delay.delayTime.value = delayTime;
  return delay;
}

/** مرشح التردد */
function createFilter(
  ctx: AudioContext,
  type: BiquadFilterType,
  freq: number,
  Q: number = 1
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = Q;
  return filter;
}

// ═══════════════════════════════════════════
// محفزات الصوت الأساسية
// ═════════════════━━━━━━━━━━━━━━━━━━━━━━━━━

/** تشغيل مذبذب منفرد مع ADSR */
function playOscillator(config: OscillatorConfig) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = config.type;
  osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
  if (config.detune) {
    osc.detune.setValueAtTime(config.detune, ctx.currentTime);
  }

  applyADSR(gain, ctx, config.attack, config.decay, config.sustain, config.release, config.volume);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + config.duration);

  // تنظيف بعد الانتهاء
  setTimeout(() => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // تجاهل أخطاء الفصل
    }
  }, config.duration * 1000 + 100);
}

/** تشغيل انفجار ترددي (burst) */
function playBurst(config: BurstConfig) {
  const ctx = getAudioContext();

  config.frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = config.type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * config.spread);

    const now = ctx.currentTime + i * config.spread;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(config.volume * 0.5, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + config.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + config.duration);

    setTimeout(() => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // تجاهل
      }
    }, (config.duration + i * config.spread) * 1000 + 100);
  });
}

/** تشغيل تأثير تفاعلي */
function playEffect(config: EffectConfig) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = config.type;

  if (config.sweep) {
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(config.frequency * 0.5, ctx.currentTime + config.duration);
  } else {
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
  }

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(config.volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + config.duration);

  // إضافة مرشح
  const filter = createFilter(ctx, "lowpass", config.frequency * 4, 2);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + config.duration);

  setTimeout(() => {
    try {
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    } catch {
      // تجاهل
    }
  }, config.duration * 1000 + 100);
}

/** تشغيل حلقة صوتية */
function playLoop(config: LoopConfig): () => void {
  const ctx = getAudioContext();
  let running = true;
  let nextTime = ctx.currentTime;

  const schedule = () => {
    if (!running) return;
    const now = ctx.currentTime;

    while (nextTime < now + 0.1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = config.type;
      osc.frequency.setValueAtTime(config.baseFreq, nextTime);

      // تردد متذبذب قليلاً
      osc.frequency.linearRampToValueAtTime(
        config.baseFreq * (1 + Math.random() * 0.05),
        nextTime + config.interval * 0.8
      );

      gain.gain.setValueAtTime(0, nextTime);
      gain.gain.linearRampToValueAtTime(config.volume * 0.3, nextTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, nextTime + config.interval * 0.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(nextTime);
      osc.stop(nextTime + config.interval);

      nextTime += config.interval;
    }

    requestAnimationFrame(schedule);
  };

  schedule();

  // إيقاف
  return () => {
    running = false;
  };
}

// ═══════════════════════════════════════════
//_presets مسبقة — Sonic DNA لكل نوع فقاعة
// ═════════════════━━━━━━━━━━━━━━━━━━━━━━━━━

const SONIC_PRESETS: Record<string, SonicDNA> = {
  /** فقاعة المنتج — صوت "بلوب" مائي */
  product: {
    birth: {
      frequency: 800,
      type: "sine",
      duration: 0.3,
      attack: 0.01,
      decay: 0.1,
      sustain: 0.3,
      release: 0.2,
      volume: 0.4,
      detune: 20,
    },
    life: { baseFreq: 200, type: "sine", interval: 2.0, volume: 0.08 },
    death: {
      frequencies: [600, 400, 200],
      type: "sine",
      duration: 0.3,
      spread: 0.08,
      volume: 0.3,
    },
    interact: {
      frequency: 520,
      type: "sine",
      duration: 0.15,
      volume: 0.25,
    },
  },

  /** فقاعة التتبع — حلقة موجات مائية */
  tracking: {
    birth: {
      frequency: 440,
      type: "triangle",
      duration: 0.25,
      attack: 0.02,
      decay: 0.08,
      sustain: 0.4,
      release: 0.15,
      volume: 0.3,
    },
    life: { baseFreq: 150, type: "sine", interval: 3.0, volume: 0.06 },
    death: {
      frequencies: [300, 200, 100],
      type: "triangle",
      duration: 0.4,
      spread: 0.1,
      volume: 0.25,
    },
    interact: {
      frequency: 660,
      type: "sine",
      duration: 0.2,
      sweep: true,
      volume: 0.2,
    },
  },

  /** فقاعة التقييم — نغمة نجوم (C-E-G-C) */
  rating: {
    birth: {
      frequency: 523.25,
      type: "sine",
      duration: 0.5,
      attack: 0.01,
      decay: 0.05,
      sustain: 0.6,
      release: 0.35,
      volume: 0.35,
    },
    life: { baseFreq: 330, type: "sine", interval: 1.5, volume: 0.05 },
    death: {
      frequencies: [523, 659, 784, 1047],
      type: "sine",
      duration: 0.5,
      spread: 0.06,
      volume: 0.3,
    },
    interact: {
      frequency: 784,
      type: "sine",
      duration: 0.12,
      volume: 0.3,
    },
  },

  /** فقاعة الدفع — صوت قطعة نقدية */
  payment: {
    birth: {
      frequency: 1200,
      type: "sine",
      duration: 0.2,
      attack: 0.005,
      decay: 0.03,
      sustain: 0.2,
      release: 0.15,
      volume: 0.35,
    },
    life: { baseFreq: 250, type: "sine", interval: 2.5, volume: 0.04 },
    death: {
      frequencies: [1000, 800, 600, 400],
      type: "sine",
      duration: 0.3,
      spread: 0.05,
      volume: 0.25,
    },
    interact: {
      frequency: 1500,
      type: "sine",
      duration: 0.08,
      volume: 0.3,
    },
  },

  /** فقاعة المساومة — صوت تكوين فقاعة */
  haggle: {
    birth: {
      frequency: 350,
      type: "sine",
      duration: 0.6,
      attack: 0.05,
      decay: 0.1,
      sustain: 0.5,
      release: 0.3,
      volume: 0.3,
      detune: -50,
    },
    life: { baseFreq: 180, type: "triangle", interval: 1.8, volume: 0.06 },
    death: {
      frequencies: [400, 300, 200, 100],
      type: "sine",
      duration: 0.4,
      spread: 0.07,
      volume: 0.25,
    },
    interact: {
      frequency: 440,
      type: "triangle",
      duration: 0.15,
      sweep: true,
      volume: 0.2,
    },
  },

  /** فقاعة التحقق KYC — نبض مسح */
  kycverify: {
    birth: {
      frequency: 880,
      type: "square",
      duration: 0.15,
      attack: 0.005,
      decay: 0.02,
      sustain: 0.1,
      release: 0.1,
      volume: 0.15,
    },
    life: { baseFreq: 440, type: "square", interval: 1.0, volume: 0.04 },
    death: {
      frequencies: [660, 440, 220],
      type: "square",
      duration: 0.25,
      spread: 0.06,
      volume: 0.12,
    },
    interact: {
      frequency: 1100,
      type: "square",
      duration: 0.06,
      volume: 0.15,
    },
  },

  /** فقاعة التنبيه — نبذ تنبيه */
  alert: {
    birth: {
      frequency: 440,
      type: "sawtooth",
      duration: 0.3,
      attack: 0.01,
      decay: 0.05,
      sustain: 0.4,
      release: 0.2,
      volume: 0.25,
    },
    life: { baseFreq: 220, type: "sawtooth", interval: 0.5, volume: 0.05 },
    death: {
      frequencies: [330, 220, 110],
      type: "sawtooth",
      duration: 0.35,
      spread: 0.08,
      volume: 0.2,
    },
    interact: {
      frequency: 880,
      type: "sawtooth",
      duration: 0.2,
      sweep: true,
      volume: 0.2,
    },
  },

  /** فقاعة الباقة — نغمة نجاح */
  bundle: {
    birth: {
      frequency: 660,
      type: "sine",
      duration: 0.5,
      attack: 0.01,
      decay: 0.08,
      sustain: 0.5,
      release: 0.3,
      volume: 0.4,
    },
    life: { baseFreq: 440, type: "sine", interval: 2.0, volume: 0.06 },
    death: {
      frequencies: [880, 660, 440, 220],
      type: "sine",
      duration: 0.5,
      spread: 0.07,
      volume: 0.3,
    },
    interact: {
      frequency: 1047,
      type: "sine",
      duration: 0.2,
      volume: 0.35,
    },
  },

  /** الإعداد الافتراضي */
  default: {
    birth: {
      frequency: 600,
      type: "sine",
      duration: 0.3,
      attack: 0.02,
      decay: 0.08,
      sustain: 0.3,
      release: 0.15,
      volume: 0.3,
    },
    life: { baseFreq: 200, type: "sine", interval: 3.0, volume: 0.05 },
    death: {
      frequencies: [500, 300, 100],
      type: "sine",
      duration: 0.3,
      spread: 0.08,
      volume: 0.25,
    },
    interact: {
      frequency: 550,
      type: "sine",
      duration: 0.12,
      volume: 0.2,
    },
  },
};

// ═══════════════════════════════════════════
// واجهات تشغيل مبسطة
// ═════════════════━━━━━━━━━━━━━━━━━━━━━━━━━

/** تشغيل صوت ظهور الفقاعة */
export function playBubbleBirth(bubbleType: string) {
  const dna = SONIC_PRESETS[bubbleType] || SONIC_PRESETS.default;
  playOscillator(dna.birth);
}

/** تشغيل صوت حياة الفقاعة */
export function playBubbleLife(bubbleType: string): () => void {
  const dna = SONIC_PRESETS[bubbleType] || SONIC_PRESETS.default;
  return playLoop(dna.life);
}

/** تشغيل صوت اختفاء الفقاعة */
export function playBubbleDeath(bubbleType: string) {
  const dna = SONIC_PRESETS[bubbleType] || SONIC_PRESETS.default;
  playBurst(dna.death);
}

/** تشغيل صوت تفاعل الفقاعة */
export function playBubbleInteract(bubbleType: string) {
  const dna = SONIC_PRESETS[bubbleType] || SONIC_PRESETS.default;
  playEffect(dna.interact);
}

/** الحصول على Sonic DNA لنوع فقاعة */
export function getSonicDNA(bubbleType: string): SonicDNA {
  return SONIC_PRESETS[bubbleType] || SONIC_PRESETS.default;
}

/** إنشاء Sonic DNA مخصص */
export function createSonicDNA(preset: Partial<SonicDNA> & { bubbleType: string }): SonicDNA {
  const base = SONIC_PRESETS[preset.bubbleType] || SONIC_PRESETS.default;
  return {
    birth: { ...base.birth, ...preset.birth },
    life: { ...base.life, ...preset.life },
    death: { ...base.death, ...preset.death },
    interact: { ...base.interact, ...preset.interact },
  };
}

/** تشغيل أيقونة صوتية مخصصة */
export function playTone(
  frequency: number,
  type: OscillatorType = "sine",
  duration: number = 0.2,
  volume: number = 0.3
) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration);

  setTimeout(() => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // تجاهل
    }
  }, duration * 1000 + 100);
}

/** تشغيل سلسلة نغمات (arpeggio) */
export function playArpeggio(
  frequencies: number[],
  type: OscillatorType = "sine",
  noteDuration: number = 0.1,
  volume: number = 0.25
) {
  frequencies.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, type, noteDuration, volume);
    }, i * noteDuration * 1000);
  });
}
