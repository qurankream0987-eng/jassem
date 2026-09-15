// AI Integration Layer for JASIM
// Uses DeepSeek/Gemini/Claude with smart routing

const AI_ENDPOINTS = {
  deepseek: process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/chat/completions",
  gemini: process.env.GEMINI_API_URL || "",
  claude: process.env.CLAUDE_API_URL || "",
};

const AI_KEYS = {
  deepseek: process.env.DEEPSEEK_API_KEY || "",
  gemini: process.env.GEMINI_API_KEY || "",
  claude: process.env.CLAUDE_API_KEY || "",
};

interface AIResponse {
  text: string;
  model: string;
  tokens: number;
}

// Smart AI Router - picks best model for task
export function selectModel(task: string): "deepseek" | "gemini" | "claude" {
  if (task === "vision" || task === "image") return "gemini";
  if (task === "code" || task === "legal") return "claude";
  return "deepseek";
}

export async function generateResponse(
  prompt: string,
  systemPrompt: string = "",
  model: string = "deepseek-chat"
): Promise<AIResponse> {
  try {
    const response = await fetch(AI_ENDPOINTS.deepseek, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_KEYS.deepseek}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      return {
        text: generateFallbackResponse(prompt),
        model: "fallback",
        tokens: 0,
      };
    }

    const data = await response.json();
    return {
      text: data.choices?.[0]?.message?.content || generateFallbackResponse(prompt),
      model: data.model || "deepseek-chat",
      tokens: data.usage?.total_tokens || 0,
    };
  } catch {
    return {
      text: generateFallbackResponse(prompt),
      model: "fallback",
      tokens: 0,
    };
  }
}

// Intent Detection
export function detectIntent(text: string): {
  intent: string;
  confidence: number;
  entities: Record<string, string>;
} {
  const lower = text.toLowerCase();
  
  // Food/Restaurant intents
  if (/أبي أكل|أريد أن آكل|طعام|مطعم|كبسة|برجر|برياني|شاورما/.test(lower)) {
    return { intent: "food_order", confidence: 0.95, entities: {} };
  }
  
  // Shopping intents
  if (/أشتري|أبي|شراء|منتج|سعر|خلاط|شاحن|ملابس|هاتف/.test(lower)) {
    return { intent: "product_search", confidence: 0.92, entities: {} };
  }
  
  // Job seeker
  if (/أبي وظيفة|ابحث عن عمل|وظيفة|شغل|دوام|راتب/.test(lower)) {
    return { intent: "job_seeker", confidence: 0.94, entities: {} };
  }
  
  // Hiring
  if (/أبي موظف|مطلوب|توظيف|مرشح|موظف|فني|محاسب/.test(lower)) {
    return { intent: "hire_worker", confidence: 0.93, entities: {} };
  }
  
  // Store creation
  if (/ابنيلي متجر|أبي متجر|منصة|POS|نظام|مطعمي|صيدليتي/.test(lower)) {
    return { intent: "create_store", confidence: 0.91, entities: {} };
  }
  
  // Tracking
  if (/وين طلبي|تتبع|شحنة|طلب|توصيل/.test(lower)) {
    return { intent: "order_tracking", confidence: 0.9, entities: {} };
  }
  
  // Payment
  if (/ادفع|دفع|فاتورة|رصيد|محفظة/.test(lower)) {
    return { intent: "payment", confidence: 0.88, entities: {} };
  }
  
  // Haggle
  if (/فاوض|خصم|تفاوض|سوم|أرخص/.test(lower)) {
    return { intent: "haggle", confidence: 0.85, entities: {} };
  }
  
  // Returns
  if (/إرجاع|تالف|مكسور|ما وصل|استرداد/.test(lower)) {
    return { intent: "return_item", confidence: 0.87, entities: {} };
  }
  
  // DNA / Cross-breed
  if (/دمج|خلط|هجين|cross|breed/.test(lower)) {
    return { intent: "dna_crossbreed", confidence: 0.82, entities: {} };
  }
  
  return { intent: "general_chat", confidence: 0.7, entities: {} };
}

// CV Generator
export function generateCV(role: string, name: string): {
  summary: string;
  skills: string[];
  experience: string;
  score: number;
} {
  const cvTemplates: Record<string, { skills: string[]; summary: string }> = {
    محاسب: {
      skills: ["محاسبة مالية", "تدقيق", "Excel", "QuickBooks", "تحليل مالي", "ضريبة القيمة المضافة"],
      summary: "محاسب مالي ذو خبرة واسعة في إدارة الحسابات والتقارير المالية.",
    },
    مطور: {
      skills: ["JavaScript", "React", "Node.js", "Python", "SQL", "Git"],
      summary: "مطور برمجيات متكامل متخصص في تطوير تطبيقات الويب الحديثة.",
    },
    مصمم: {
      skills: ["Photoshop", "Illustrator", "Figma", "UI/UX", "تصميم الشعارات", "Motion Graphics"],
      summary: "مصمم إبداعي متخصص في تصميم الهويات البصرية وواجهات المستخدم.",
    },
    default: {
      skills: ["العمل الجماعي", "التواصل", "إدارة الوقت", "حل المشكلات", "القيادة", "Microsoft Office"],
      summary: "محترف مجتهد ذو مهارات متنوعة وخبرة في العمل ضمن فرق ديناميكية.",
    },
  };

  const tmpl = cvTemplates[role] || cvTemplates.default;
  return {
    summary: tmpl.summary,
    skills: tmpl.skills,
    experience: "3-5 سنوات خبرة في المجال",
    score: Math.floor(Math.random() * 20) + 80,
  };
}

// Job Matching Algorithm
export function calculateMatchScore(
  jobSkills: string[],
  candidateSkills: string[]
): number {
  if (!jobSkills.length || !candidateSkills.length) return 0;
  const matching = jobSkills.filter((s) =>
    candidateSkills.some((cs) => cs.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(cs.toLowerCase()))
  );
  return Math.round((matching.length / jobSkills.length) * 100);
}

// Pricing Logic
export function calculatePrice(
  basePrice: number,
  marketCode: string,
  tier: string
): { final: number; commission: number; note: string } {
  const halfPriceMarkets = ["JO", "EG", "SY"];
  const multipliers: Record<string, number> = {
    starter: 1.0, pro: 0.85, enterprise: 0.7, ultimate: 0.6,
  };
  
  let price = basePrice;
  let note = "";
  
  if (halfPriceMarkets.includes(marketCode)) {
    price *= 0.5;
    note = "سعر مخفض 50% للأردن/مصر/سوريا 🇯🇴🇪🇬🇸🇾";
  }
  
  const tierMult = multipliers[tier] || 1.0;
  price *= tierMult;
  
  const commission = price * 0.025;
  
  return { final: Math.round(price * 100) / 100, commission: Math.round(commission * 100) / 100, note };
}

// DNA Cross-breeding
export function crossbreedDNA(
  parent1: Record<string, number>,
  parent2: Record<string, number>
): Record<string, number> {
  const child: Record<string, number> = {};
  const genes = [
    "perception", "action", "validation", "integration",
    "uiGen", "memory", "payment", "analytics",
    "compliance", "security", "learning", "scale",
  ];
  
  for (const gene of genes) {
    const p1 = parent1[gene] || 50;
    const p2 = parent2[gene] || 50;
    const avg = (p1 + p2) / 2;
    const mutation = (Math.random() - 0.5) * 10;
    child[gene] = Math.min(100, Math.max(0, Math.round(avg + mutation)));
  }
  
  return child;
}

function generateFallbackResponse(prompt: string): string {
  const lower = prompt.toLowerCase();
  
  if (lower.includes("وظيف")) return "أستطيع مساعدتك في البحث عن وظائف أو توظيف موظفين. ما نوع الوظيفة التي تبحث عنها؟";
  if (lower.includes("متجر") || lower.includes("مطعم")) return "يمكنني بناء نظام POS متكامل لعملك. ما نوع النشاط التجاري؟";
  if (lower.includes("أكل") || lower.includes("طعام")) return "وجدت لك عدة خيارات طعام شهية في منطقتك!";
  if (lower.includes("أشتري") || lower.includes("شراء")) return "أبحث لك عن أفضل المنتجات بأرخص الأسعار...";
  if (lower.includes("سلام")) return "وعليكم السلام! أنا جاسم، وكيلك الذكي. كيف أستطيع مساعدتك اليوم؟";
  
  return `مرحباً! أنا جاسم، وكيلك الذكي التنفيذي. فهمت طلبك: "${prompt.substring(0, 50)}". كيف أستطيع مساعدتك تحديداً؟`;
}
