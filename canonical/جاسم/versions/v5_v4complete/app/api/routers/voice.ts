import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { voiceSessions } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

// Arabic dialects supported
const ARABIC_DIALECTS = [
  "Modern Standard Arabic (MSA)",
  "Kuwaiti Arabic",
  "Saudi Arabic (Najdi)",
  "Saudi Arabic (Hijazi)",
  "Emirati Arabic",
  "Qatari Arabic",
  "Bahraini Arabic",
  "Omani Arabic",
  "Egyptian Arabic (Masri)",
  "Levantine Arabic (Shami)",
  "Jordanian Arabic",
  "Syrian Arabic",
  "Lebanese Arabic",
  "Palestinian Arabic",
  "Iraqi Arabic",
  "Sudanese Arabic",
  "Libyan Arabic",
  "Yemeni Arabic",
  "Maghrebi Arabic (Darija)",
  "Moroccan Arabic",
  "Algerian Arabic",
  "Tunisian Arabic",
] as const;

// Detect Arabic dialect from text features
function detectDialectFromText(text: string): {
  dialect: string;
  dialectCode: string;
  confidence: number;
  features: string[];
} {
  const features: string[] = [];

  // Egyptian markers
  if (/(?:أنا|انا) .{0,10}(?:هروح|هاجي|هشوف|هعمل)| mesh | bey | حاجة | أوي | كده | إزيك/.test(text)) {
    features.push("Egyptian pronouns/verbal markers", "حاجة / أوي / كده");
    return {
      dialect: "Egyptian Arabic (Masri)",
      dialectCode: "eg",
      confidence: 0.85 + Math.random() * 0.12,
      features,
    };
  }

  // Levantine markers
  if (/شو |كتير |كتير |كيف |بدي |عم |هلق |كيفك |شو أخبارك/.test(text)) {
    features.push("Levantine interrogatives", "شو / كتير / كيف");
    return {
      dialect: "Levantine Arabic (Shami)",
      dialectCode: "shami",
      confidence: 0.82 + Math.random() * 0.15,
      features,
    };
  }

  // Gulf / Khaliji markers
  if (/شلون |وش |هال |ديرة |بيت |ياهل |شنو |وشو |هاذا |ولد/.test(text)) {
    // Narrow down further
    if (/بامية |مشروب |دكاكين |دكّان |هاوِش |فريج/.test(text)) {
      features.push("Kuwaiti lexical items", "دكاكين / فريج");
      return {
        dialect: "Kuwaiti Arabic",
        dialectCode: "kw",
        confidence: 0.88 + Math.random() * 0.1,
        features,
      };
    }
    if (/هال |هالحين |زين |ياهلا |هلا والله |مرحبتين/.test(text)) {
      features.push("Gulf hospitality markers", "هلا والله / مرحبتين");
      return {
        dialect: "Saudi Arabic (Najdi)",
        dialectCode: "sa-najdi",
        confidence: 0.79 + Math.random() * 0.16,
        features,
      };
    }
    features.push("Gulf Arabic markers", "شلون / شنو");
    return {
      dialect: "Emirati Arabic",
      dialectCode: "ae",
      confidence: 0.75 + Math.random() * 0.18,
      features,
    };
  }

  // Iraqi markers
  if (/هسة |هسه |تعال |صاير |ماكو |مو |هذا|هذه |إنته/.test(text)) {
    features.push("Iraqi temporal markers", "هسة / ماكو");
    return {
      dialect: "Iraqi Arabic",
      dialectCode: "iq",
      confidence: 0.86 + Math.random() * 0.12,
      features,
    };
  }

  // MSA / formal
  if (/الذي |التي |الذين |التي |هذا |هذه |هؤلاء |تلك |هنالك/.test(text)) {
    features.push("MSA relative pronouns", "الذي / التي / الذين");
    return {
      dialect: "Modern Standard Arabic (MSA)",
      dialectCode: "msa",
      confidence: 0.78 + Math.random() * 0.18,
      features,
    };
  }

  // Default to MSA
  return {
    dialect: "Modern Standard Arabic (MSA)",
    dialectCode: "msa",
    confidence: 0.6 + Math.random() * 0.2,
    features: ["Default classification", "Limited dialect markers detected"],
  };
}

// Sonic DNA profiles per bubble type
const SONIC_DNA_PROFILES: Record<string, {
  voiceId: string;
  name: string;
  description: string;
  pitch: number;
  speed: number;
  warmth: number;
  energy: number;
}> = {
  default: {
    voiceId: "sonic-khaliji-neutral",
    name: "Khaliji Neutral",
    description: "Clear, warm Gulf Arabic voice with professional tone",
    pitch: 1.0,
    speed: 1.0,
    warmth: 0.7,
    energy: 0.6,
  },
  food: {
    voiceId: "sonic-food-warm",
    name: "Food Warm",
    description: "Warm, appetizing tone for food ordering experiences",
    pitch: 0.95,
    speed: 0.95,
    warmth: 0.9,
    energy: 0.7,
  },
  products: {
    voiceId: "sonic-products-energetic",
    name: "Products Energetic",
    description: "Energetic, upbeat tone for product discovery",
    pitch: 1.05,
    speed: 1.1,
    warmth: 0.6,
    energy: 0.9,
  },
  cv: {
    voiceId: "sonic-cv-professional",
    name: "CV Professional",
    description: "Professional, authoritative tone for career services",
    pitch: 1.0,
    speed: 0.9,
    warmth: 0.5,
    energy: 0.5,
  },
  jobs: {
    voiceId: "sonic-jobs-encouraging",
    name: "Jobs Encouraging",
    description: "Encouraging, supportive tone for job seekers",
    pitch: 1.02,
    speed: 1.0,
    warmth: 0.8,
    energy: 0.7,
  },
  saas: {
    voiceId: "sonic-saas-tech",
    name: "SaaS Tech",
    description: "Modern, tech-forward tone for platform features",
    pitch: 0.98,
    speed: 1.05,
    warmth: 0.5,
    energy: 0.8,
  },
  tracking: {
    voiceId: "sonic-tracking-clear",
    name: "Tracking Clear",
    description: "Clear, concise tone for delivery tracking updates",
    pitch: 1.0,
    speed: 1.1,
    warmth: 0.6,
    energy: 0.7,
  },
  payment: {
    voiceId: "sonic-payment-trustworthy",
    name: "Payment Trustworthy",
    description: "Trustworthy, reassuring tone for financial transactions",
    pitch: 0.95,
    speed: 0.9,
    warmth: 0.7,
    energy: 0.4,
  },
  haggle: {
    voiceId: "sonic-haggle-friendly",
    name: "Haggle Friendly",
    description: "Friendly, persuasive tone for negotiation",
    pitch: 1.0,
    speed: 1.0,
    warmth: 0.85,
    energy: 0.75,
  },
  return_item: {
    voiceId: "sonic-return-empathetic",
    name: "Return Empathetic",
    description: "Empathetic, helpful tone for returns and support",
    pitch: 0.95,
    speed: 0.9,
    warmth: 0.9,
    energy: 0.4,
  },
  vision: {
    voiceId: "sonic-vision-curious",
    name: "Vision Curious",
    description: "Curious, exploratory tone for AI vision features",
    pitch: 1.03,
    speed: 1.0,
    warmth: 0.65,
    energy: 0.75,
  },
  voice: {
    voiceId: "sonic-voice-smooth",
    name: "Voice Smooth",
    description: "Smooth, natural tone for voice interactions",
    pitch: 1.0,
    speed: 0.95,
    warmth: 0.75,
    energy: 0.6,
  },
  biometric: {
    voiceId: "sonic-biometric-secure",
    name: "Biometric Secure",
    description: "Secure, calm tone for biometric verification",
    pitch: 0.97,
    speed: 0.9,
    warmth: 0.5,
    energy: 0.4,
  },
  zakat: {
    voiceId: "sonic-zakat-respectful",
    name: "Zakat Respectful",
    description: "Respectful, solemn tone for zakat services",
    pitch: 0.96,
    speed: 0.85,
    warmth: 0.8,
    energy: 0.3,
  },
};

// Text normalization for TTS
function normalizeForTTS(text: string, dialectCode: string): string {
  let normalized = text;

  // Basic Arabic text cleaning
  normalized = normalized
    .replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, ""); // Remove tashkeel for cleaner speech

  return normalized;
}

// Mock speech-to-text transcription
function mockTranscribe(audioData: string, language: string): {
  text: string;
  confidence: number;
  language: string;
  words: Array<{ word: string; start: number; end: number; confidence: number }>;
} {
  const mockTexts: Record<string, string[]> = {
    ar: [
      "أهلاً، أبي أطلب كبسة بالدجاج وعصير ليمون",
      "شلونكم شباب؟ وين ألقى محل إلكترونيكس قريب؟",
      "أبي أسوي متجر إلكتروني حق منتجاتي",
      "أبي وظيفة مطور برامج في الكويت",
      "كم زكاة المال على أرباحي هذا الشهر؟",
    ],
    "ar-KW": [
      "هلا والله، أبي أطلب من المطعم",
      "وش الأخبار؟ أبي أشتري لابتوب جديد",
      "شنو أفضل محل يبيع ذهب في السوق؟",
    ],
    "ar-SA": [
      "السلام عليكم، أبي أستاجر سيارة",
      "وش السواد اليوم؟ كل شي تمام",
    ],
    en: [
      "Hello, I want to order a chicken kabsa and lemon juice",
      "I am looking for a job as a software developer",
      "What is the zakat amount on my earnings?",
    ],
  };

  const langTexts = mockTexts[language] || mockTexts.ar;
  const seed = audioData.length % langTexts.length;
  const text = langTexts[seed];

  const words = text.split(/\s+/).map((word, i) => ({
    word,
    start: i * 0.3,
    end: (i + 1) * 0.3,
    confidence: 0.8 + Math.random() * 0.18,
  }));

  return {
    text,
    confidence: Math.round((0.85 + Math.random() * 0.13) * 100) / 100,
    language,
    words,
  };
}

export const voiceRouter = createRouter({
  // Speech-to-text (Arabic + dialects)
  transcribe: authedQuery
    .input(z.object({
      audioData: z.string().min(1), // base64 audio
      language: z.string().default("ar"),
      detectDialect: z.boolean().default(true),
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const transcription = mockTranscribe(input.audioData, input.language);

      let dialectInfo = null;
      if (input.detectDialect && input.language.startsWith("ar")) {
        dialectInfo = detectDialectFromText(transcription.text);
      }

      // Store session
      const [session] = await db.insert(voiceSessions).values({
        userId: Number(ctx.user.id),
        merchantId: input.merchantId,
        sessionType: "transcription",
        outputText: transcription.text,
        detectedDialect: dialectInfo?.dialect,
        confidence: transcription.confidence,
        language: input.language,
        durationMs: transcription.words.length * 300,
        modelUsed: "whisper-v3-arabic",
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        sessionId: session.id,
        text: transcription.text,
        confidence: transcription.confidence,
        language: input.language,
        words: transcription.words,
        dialect: dialectInfo,
      };
    }),

  // Text-to-speech with Sonic DNA
  synthesize: authedQuery
    .input(z.object({
      text: z.string().min(1).max(5000),
      language: z.string().default("ar"),
      voiceId: z.string().optional(),
      bubbleType: z.string().default("default"),
      pitch: z.number().min(0.5).max(2).optional(),
      speed: z.number().min(0.5).max(2).optional(),
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const dna = SONIC_DNA_PROFILES[input.bubbleType] || SONIC_DNA_PROFILES.default;
      const effectivePitch = input.pitch || dna.pitch;
      const effectiveSpeed = input.speed || dna.speed;

      const normalizedText = normalizeForTTS(input.text, input.language);

      // Mock audio URL generation
      const audioHash = Buffer.from(`${ctx.user.id}-${Date.now()}-${normalizedText.substring(0, 20)}`).toString("base64url");
      const audioUrl = `https://cdn.jasim.ai/audio/tts/${audioHash}.mp3`;

      // Estimate duration
      const estimatedDuration = Math.round(normalizedText.length * 60 / effectiveSpeed);

      // Store session
      const [session] = await db.insert(voiceSessions).values({
        userId: Number(ctx.user.id),
        merchantId: input.merchantId,
        sessionType: "synthesis",
        inputText: input.text,
        outputText: normalizedText,
        audioUrl,
        language: input.language,
        durationMs: estimatedDuration,
        modelUsed: dna.voiceId,
        bubbleType: input.bubbleType,
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        sessionId: session.id,
        audioUrl,
        text: normalizedText,
        voice: {
          voiceId: input.voiceId || dna.voiceId,
          name: dna.name,
          description: dna.description,
          pitch: effectivePitch,
          speed: effectiveSpeed,
          warmth: dna.warmth,
          energy: dna.energy,
        },
        durationMs: estimatedDuration,
        language: input.language,
        bubbleType: input.bubbleType,
      };
    }),

  // Detect Arabic dialect
  detectDialect: publicQuery
    .input(z.object({
      text: z.string().min(1),
    }))
    .query(({ input }) => {
      const result = detectDialectFromText(input.text);
      return {
        success: true,
        ...result,
        allDialects: ARABIC_DIALECTS,
      };
    }),

  // Get Sonic DNA for bubble type
  getDna: publicQuery
    .input(z.object({
      bubbleType: z.string().default("default"),
    }))
    .query(({ input }) => {
      const dna = SONIC_DNA_PROFILES[input.bubbleType] || SONIC_DNA_PROFILES.default;
      const allProfiles = Object.entries(SONIC_DNA_PROFILES).map(([type, profile]) => ({
        bubbleType: type,
        ...profile,
      }));

      return {
        success: true,
        bubbleType: input.bubbleType,
        dna,
        allProfiles,
      };
    }),

  // Get voice session history
  getHistory: authedQuery
    .input(z.object({
      sessionType: z.enum(["transcription", "synthesis", "dialect_detection", "dna_query"]).optional(),
      bubbleType: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user.id);
      const conditions = [eq(voiceSessions.userId, userId)];

      if (input?.sessionType) {
        conditions.push(eq(voiceSessions.sessionType, input.sessionType));
      }
      if (input?.bubbleType) {
        conditions.push(eq(voiceSessions.bubbleType, input.bubbleType));
      }

      const sessions = conditions.length > 0
        ? await db.select().from(voiceSessions)
            .where(and(...conditions))
            .orderBy(desc(voiceSessions.createdAt))
            .limit(input?.limit || 50)
        : await db.select().from(voiceSessions)
            .where(eq(voiceSessions.userId, userId))
            .orderBy(desc(voiceSessions.createdAt))
            .limit(input?.limit || 50);

      return sessions;
    }),

  // Batch transcription for multiple audio files
  batchTranscribe: authedQuery
    .input(z.object({
      audioFiles: z.array(z.object({
        audioData: z.string().min(1),
        language: z.string().default("ar"),
      })).min(1).max(10),
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const results = [];

      for (const file of input.audioFiles) {
        const transcription = mockTranscribe(file.audioData, file.language);
        const dialect = file.language.startsWith("ar")
          ? detectDialectFromText(transcription.text)
          : null;

        const [session] = await db.insert(voiceSessions).values({
          userId: Number(ctx.user.id),
          merchantId: input.merchantId,
          sessionType: "transcription",
          outputText: transcription.text,
          detectedDialect: dialect?.dialect,
          confidence: transcription.confidence,
          language: file.language,
          durationMs: transcription.words.length * 300,
          modelUsed: "whisper-v3-arabic",
          marketCode: input.marketCode,
        }).$returningId();

        results.push({
          sessionId: session.id,
          text: transcription.text,
          confidence: transcription.confidence,
          language: file.language,
          dialect,
          wordCount: transcription.words.length,
        });
      }

      return {
        success: true,
        totalProcessed: results.length,
        results,
      };
    }),
});
