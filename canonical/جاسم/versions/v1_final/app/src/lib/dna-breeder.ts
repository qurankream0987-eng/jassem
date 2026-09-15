/**
 * ═══════════════════════════════════════════════════════════
 * محرك التكاثر الوراثي — DNA Breeding Engine
 * نظام جيني للفقاعات: تزاوج + تحور + تكيف
 * ═══════════════════════════════════════════════════════════
 */

/** الجينات الأساسية للفقاعة */
export interface BubbleGenes {
  /** لون الفقاعة (hex) */
  color: string;
  /** الحجم النسبي ٠-١٠٠ */
  size: number;
  /** نوع الحركة: عائمة، نابضة، مدارية، طائشة */
  animation: "float" | "pulse" | "orbit" | "drift" | "bounce";
  /** اسم الإعداد الصوتي */
  sound: string;
  /** الشفافية ٠.١-١.٠ */
  opacity: number;
  /** سمك الحد ١-١٠ */
  borderWidth: number;
  /** شدة التوهج ٠-١٠٠ */
  glowIntensity: number;
  /** عدد الجسيمات ٠-٥٠ */
  particleCount: number;
  /** سرعة العوم ٠.١-٥.٠ */
  floatSpeed: number;
  /** نوع التفاعل */
  interaction: "click" | "longpress" | "swipe" | "hover" | "doubletap";
  /** المظهر البصري */
  theme: string;
  /** العمر (٠ = لانهائي) */
  lifespan: number;
}

/** الحمض النووي الكامل للفقاعة */
export interface BubbleDNA {
  genes: BubbleGenes;
  /** جيل التطور */
  generation: number;
  /** نقاط التكيف */
  fitness: number;
  /** معرف فريد */
  id: string;
  /** الآباء (لتتبع النسب) */
  parents?: [string, string];
  /** طفرة حدثت */
  mutated: boolean;
  /** سجل الطفرات */
  mutationLog: string[];
}

/** خيارات التكاثر */
export interface BreedOptions {
  /** معدل الطفرة (٠-١) */
  mutationRate?: number;
  /** شدة الطفرة */
  mutationStrength?: number;
  /** السماح بالتهجين */
  allowCrossover?: boolean;
}

// ─── القيم الافتراضية ───

const DEFAULT_GENES: BubbleGenes = {
  color: "#00d4ff",
  size: 50,
  animation: "float",
  sound: "default",
  opacity: 0.85,
  borderWidth: 2,
  glowIntensity: 50,
  particleCount: 10,
  floatSpeed: 1.5,
  interaction: "click",
  theme: "default",
  lifespan: 0,
};

const VALID_ANIMATIONS: BubbleGenes["animation"][] = [
  "float", "pulse", "orbit", "drift", "bounce",
];
const VALID_INTERACTIONS: BubbleGenes["interaction"][] = [
  "click", "longpress", "swipe", "hover", "doubletap",
];

// ─── أدوات مساعدة ───

/** توليد معرف فريد */
function generateId(): string {
  return `dna-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** رقم عشوائي بين حدين */
function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** رقم صحيح عشوائي */
function randInt(min: number, max: number): number {
  return Math.floor(randBetween(min, max + 1));
}

/** خلط لونين بشكل عشوائي */
function blendColors(c1: string, c2: string, ratio: number = 0.5): string {
  const hex = (hexStr: string) => {
    const h = hexStr.replace("#", "");
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  };

  const a = hex(c1);
  const b = hex(c2);
  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bl = Math.round(a.b + (b.b - a.b) * ratio);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** تدوير لون عشوائي */
function randomColor(): string {
  const hue = randInt(0, 360);
  const sat = randInt(60, 100);
  const light = randInt(40, 70);
  // HSL to RGB conversion
  const s = sat / 100;
  const l = light / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** طفرة قيمة رقمية */
function mutateValue(
  value: number,
  strength: number,
  min: number,
  max: number
): number {
  const delta = (Math.random() - 0.5) * 2 * strength * (max - min);
  return Math.max(min, Math.min(max, value + delta));
}

/** اختيار عشوائي من مصفوفتين */
function pickRandom<T>(a: T, b: T): T {
  return Math.random() < 0.5 ? a : b;
}

// ═══════════════════════════════════════════
// أنظمة التكاثر
// ═════════════════━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * تهجين جيني: دمج أب + أم → طفل
 * ٥٠٪ جينات من كل أصل + احتمال طفرة
 */
export function breed(
  parent1: BubbleDNA,
  parent2: BubbleDNA,
  options: BreedOptions = {}
): BubbleDNA {
  const {
    mutationRate = 0.15,
    mutationStrength = 0.2,
    allowCrossover = true,
  } = options;

  const g1 = parent1.genes;
  const g2 = parent2.genes;
  const mutated = false;
  const mutationLog: string[] = [];

  // تهجين الألوان
  let color = blendColors(g1.color, g2.color, Math.random());

  // تهجين القيم الرقمية (متوسط)
  let size = Math.round((g1.size + g2.size) / 2);
  let opacity = (g1.opacity + g2.opacity) / 2;
  let borderWidth = Math.round((g1.borderWidth + g2.borderWidth) / 2);
  let glowIntensity = Math.round((g1.glowIntensity + g2.glowIntensity) / 2);
  let particleCount = Math.round((g1.particleCount + g2.particleCount) / 2);
  let floatSpeed = (g1.floatSpeed + g2.floatSpeed) / 2;
  let lifespan = Math.round((g1.lifespan + g2.lifespan) / 2);

  // تهجين الصفات التصنيفية
  let animation = allowCrossover ? pickRandom(g1.animation, g2.animation) : g1.animation;
  let sound = allowCrossover ? pickRandom(g1.sound, g2.sound) : g1.sound;
  let interaction = allowCrossover ? pickRandom(g1.interaction, g2.interaction) : g1.interaction;
  let theme = allowCrossover ? pickRandom(g1.theme, g2.theme) : g1.theme;

  // ─── الطفرات ───

  // طفرة لون
  if (Math.random() < mutationRate) {
    color = randomColor();
    mutationLog.push("لون طافر");
  }

  // طفرة حجم
  if (Math.random() < mutationRate) {
    size = Math.round(mutateValue(size, mutationStrength, 10, 100));
    mutationLog.push(`حجم: ${size}`);
  }

  // طفرة شفافية
  if (Math.random() < mutationRate) {
    opacity = mutateValue(opacity, mutationStrength, 0.1, 1.0);
    mutationLog.push(`شفافية: ${opacity.toFixed(2)}`);
  }

  // طفرة سماكة حد
  if (Math.random() < mutationRate) {
    borderWidth = Math.round(mutateValue(borderWidth, mutationStrength, 1, 10));
    mutationLog.push(`حد: ${borderWidth}`);
  }

  // طفرة توهج
  if (Math.random() < mutationRate) {
    glowIntensity = Math.round(
      mutateValue(glowIntensity, mutationStrength, 0, 100)
    );
    mutationLog.push(`توهج: ${glowIntensity}`);
  }

  // طفرة جسيمات
  if (Math.random() < mutationRate) {
    particleCount = Math.round(
      mutateValue(particleCount, mutationStrength, 0, 50)
    );
    mutationLog.push(`جسيمات: ${particleCount}`);
  }

  // طفرة سرعة عوم
  if (Math.random() < mutationRate) {
    floatSpeed = mutateValue(floatSpeed, mutationStrength, 0.1, 5.0);
    mutationLog.push(`سرعة: ${floatSpeed.toFixed(2)}`);
  }

  // طفرة نوع حركة
  if (Math.random() < mutationRate * 0.5) {
    animation = VALID_ANIMATIONS[randInt(0, VALID_ANIMATIONS.length - 1)];
    mutationLog.push(`حركة: ${animation}`);
  }

  // طفرة تفاعل
  if (Math.random() < mutationRate * 0.5) {
    interaction = VALID_INTERACTIONS[randInt(0, VALID_INTERACTIONS.length - 1)];
    mutationLog.push(`تفاعل: ${interaction}`);
  }

  // طفرة عمر
  if (Math.random() < mutationRate * 0.3) {
    lifespan = randInt(0, 300);
    mutationLog.push(`عمر: ${lifespan}`);
  }

  // حساب اللياقة (fitness)
  const fitness = calculateFitness({
    color,
    size,
    animation,
    sound,
    opacity,
    borderWidth,
    glowIntensity,
    particleCount,
    floatSpeed,
    interaction,
    theme,
    lifespan,
  });

  return {
    genes: {
      color,
      size,
      animation,
      sound,
      opacity,
      borderWidth,
      glowIntensity,
      particleCount,
      floatSpeed,
      interaction,
      theme,
      lifespan,
    },
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    fitness,
    id: generateId(),
    parents: [parent1.id, parent2.id],
    mutated: mutationLog.length > 0,
    mutationLog,
  };
}

/**
 * حساب لياقة الفقاعة (fitness score)
 * كلما كانت القيم متوازنة كلما زادت اللياقة
 */
export function calculateFitness(genes: BubbleGenes): number {
  let score = 50;

  // مكافأة على التنوع
  if (genes.animation !== "float") score += 10;
  if (genes.interaction !== "click") score += 10;

  // توازن الحجم
  if (genes.size >= 30 && genes.size <= 70) score += 15;
  else score -= 10;

  // توازن الشفافية
  if (genes.opacity >= 0.5 && genes.opacity <= 0.95) score += 10;

  // توازن السرعة
  if (genes.floatSpeed >= 0.5 && genes.floatSpeed <= 3) score += 10;

  // توازن التوهج
  if (genes.glowIntensity >= 20 && genes.glowIntensity <= 80) score += 10;

  // مكافأة على الجسيمات المناسبة
  if (genes.particleCount >= 5 && genes.particleCount <= 30) score += 10;

  // عمر لانهائي مكافأة
  if (genes.lifespan === 0) score += 5;

  // خصم على القيم المتطرفة
  if (genes.size > 90 || genes.size < 15) score -= 15;
  if (genes.opacity < 0.2) score -= 10;
  if (genes.floatSpeed > 4) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/** إنشاء DNA عشوائي */
export function randomDNA(theme?: string): BubbleDNA {
  const genes: BubbleGenes = {
    color: randomColor(),
    size: randInt(20, 90),
    animation: VALID_ANIMATIONS[randInt(0, VALID_ANIMATIONS.length - 1)],
    sound: ["default", "product", "payment", "rating", "tracking"][randInt(0, 4)],
    opacity: randBetween(0.3, 1.0),
    borderWidth: randInt(1, 8),
    glowIntensity: randInt(10, 90),
    particleCount: randInt(0, 40),
    floatSpeed: randBetween(0.3, 4.0),
    interaction: VALID_INTERACTIONS[randInt(0, VALID_INTERACTIONS.length - 1)],
    theme: theme || "default",
    lifespan: Math.random() < 0.3 ? randInt(30, 300) : 0,
  };

  return {
    genes,
    generation: 0,
    fitness: calculateFitness(genes),
    id: generateId(),
    mutated: false,
    mutationLog: [],
  };
}

/** إنشاء DNA افتراضي */
export function defaultDNA(overrides?: Partial<BubbleGenes>): BubbleDNA {
  const genes = { ...DEFAULT_GENES, ...overrides };
  return {
    genes,
    generation: 0,
    fitness: calculateFitness(genes),
    id: generateId(),
    mutated: false,
    mutationLog: [],
  };
}

/** طفرة مباشرة على DNA موجود */
export function mutate(dna: BubbleDNA, strength: number = 0.3): BubbleDNA {
  const child = breed(dna, dna, {
    mutationRate: 0.5,
    mutationStrength: strength,
    allowCrossover: false,
  });
  return {
    ...child,
    parents: [dna.id, dna.id],
    generation: dna.generation + 1,
  };
}

/** إنتاج جيل كامل من السكان */
export function evolvePopulation(
  population: BubbleDNA[],
  count: number,
  options?: BreedOptions
): BubbleDNA[] {
  const offspring: BubbleDNA[] = [];

  // فرز حسب اللياقة
  const sorted = [...population].sort((a, b) => b.fitness - a.fitness);

  for (let i = 0; i < count; i++) {
    if (sorted.length >= 2) {
      // اختيار أبوين بشكل مائل نحو الأفضل
      const p1 = sorted[randInt(0, Math.floor(sorted.length * 0.5))];
      const p2 = sorted[randInt(0, Math.floor(sorted.length * 0.5))];
      offspring.push(breed(p1, p2, options));
    } else if (sorted.length === 1) {
      // طفرة إذا كان فرد واحد
      offspring.push(mutate(sorted[0]));
    } else {
      // عشوائي إذا لم يوجد أحد
      offspring.push(randomDNA());
    }
  }

  return offspring;
}

/** اختيار الأفضل من السكان */
export function selectFittest(
  population: BubbleDNA[],
  count: number
): BubbleDNA[] {
  return [...population]
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, count);
}

/** تحويل DNA إلى أنماط CSS */
export function dnaToStyles(dna: BubbleDNA): React.CSSProperties {
  const g = dna.genes;
  return {
    backgroundColor: g.color,
    opacity: g.opacity,
    borderWidth: `${g.borderWidth}px`,
    borderColor: g.color,
    borderStyle: "solid",
    boxShadow: `0 0 ${g.glowIntensity}px ${g.color}80`,
    width: `${g.size * 2}px`,
    height: `${g.size * 2}px`,
  };
}

/** تطبيق CSS animation حسب نوع الحركة */
export function getAnimationClass(
  animation: BubbleGenes["animation"]
): string {
  switch (animation) {
    case "float":
      return "bubbleFloat1";
    case "pulse":
      return "pulse-dot";
    case "orbit":
      return "borderRotate";
    case "drift":
      return "bubbleFloat3";
    case "bounce":
      return "typingBounce";
    default:
      return "bubbleFloat1";
  }
}
