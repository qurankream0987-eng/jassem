import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import {
  detectIntent,
  generateResponse,
  generateCV,
  calculateMatchScore,
  crossbreedDNA,
} from "../lib/ai";

export const agentsRouter = createRouter({
  // Intent Detection
  detectIntent: publicQuery
    .input(z.object({ text: z.string() }))
    .query(({ input }) => {
      const result = detectIntent(input.text);
      return result;
    }),

  // Process Message (Intent + Response)
  process: publicQuery
    .input(z.object({
      message: z.string(),
      userId: z.string().optional(),
      context: z.record(z.any()).optional(),
    }))
    .query(async ({ input }) => {
      const intent = detectIntent(input.message);
      const response = await generateResponse(
        input.message,
        `You are JASIM (جاسم), an AI executive agent for Arabic commerce. Respond in Arabic. Detected intent: ${intent.intent}`,
      );
      
      return {
        intent,
        response: response.text,
        model: response.model,
        bubbles: generateBubblesForIntent(intent.intent, input.message),
      };
    }),

  // Generate CV
  generateCV: publicQuery
    .input(z.object({
      role: z.string(),
      name: z.string().optional(),
      skills: z.array(z.string()).optional(),
    }))
    .query(({ input }) => {
      const cv = generateCV(input.role, input.name || "unknown");
      return cv;
    }),

  // Calculate Match Score
  matchScore: publicQuery
    .input(z.object({
      jobSkills: z.array(z.string()),
      candidateSkills: z.array(z.string()),
    }))
    .query(({ input }) => {
      return { score: calculateMatchScore(input.jobSkills, input.candidateSkills) };
    }),

  // DNA Crossbreed
  crossbreed: publicQuery
    .input(z.object({
      parent1: z.record(z.number()),
      parent2: z.record(z.number()),
    }))
    .query(({ input }) => {
      return { child: crossbreedDNA(input.parent1, input.parent2) };
    }),
});

function generateBubblesForIntent(intent: string, message: string): Array<{
  id: string;
  type: string;
  label: string;
  color: string;
  color2: string;
  items: Array<{ title: string; val: string; up: boolean }>;
}> {
  const bubbles: Record<string, Array<{ id: string; type: string; label: string; color: string; color2: string; items: Array<{ title: string; val: string; up: boolean }> }>> = {
    food_order: [{
      id: "food", type: "food", label: "طعام", color: "#FF6B00", color2: "#FFD700",
      items: [
        { title: "كبستنا", val: "5.5 د.ك", up: false },
        { title: "برجر كنج", val: "3.2 د.ك", up: false },
        { title: "برياني هندي", val: "4.0 د.ك", up: false },
        { title: "شاورما", val: "1.5 د.ك", up: false },
      ],
    }],
    product_search: [{
      id: "products", type: "products", label: "منتجات", color: "#00d4ff", color2: "#4a9eff",
      items: [
        { title: "خلاط سعة 2لتر", val: "12.5 د.ك", up: false },
        { title: "شاحن سريع 65W", val: "8.0 د.ك", up: false },
        { title: "سماعات بلوتوث", val: "15.0 د.ك", up: true },
      ],
    }],
    job_seeker: [{
      id: "cv", type: "cv", label: "السيرة الذاتية", color: "#00c896", color2: "#00d4ff",
      items: [
        { title: "الدور", val: message.replace(/أبي وظيفة|ابحث عن|وظيفة/g, "").trim() || "عام", up: true },
        { title: "نقاط القوة", val: "الذكاء والخبرة", up: true },
        { title: "التوصية", val: "95%", up: true },
      ],
    }],
    hire_worker: [{
      id: "jobs", type: "jobs", label: "الوظائف", color: "#a855f7", color2: "#ec4899",
      items: [
        { title: "منشور", val: "تم النشر", up: true },
        { title: "مرشحون", val: "3 متاحين", up: true },
        { title: "أفضل تطابق", val: "87%", up: true },
      ],
    }],
    create_store: [{
      id: "saas", type: "saas", label: "منصتي", color: "#ec4899", color2: "#a855f7",
      items: [
        { title: "النوع", val: "POS ذكي", up: true },
        { title: "الحالة", val: "جاهز في 3 دق", up: true },
        { title: "السعر", val: "39 د.ك/شهر", up: false },
      ],
    }],
    order_tracking: [{
      id: "tracking", type: "tracking", label: "التتبع", color: "#00d4ff", color2: "#00c896",
      items: [
        { title: "السائق", val: "سالم - كامري 2024", up: true },
        { title: "الوقت", val: "8 دقائق", up: true },
        { title: "الحالة", val: "في الطريق", up: true },
      ],
    }],
    payment: [{
      id: "payment", type: "payment", label: "الدفع", color: "#00c896", color2: "#FFD700",
      items: [
        { title: "المبلغ", val: "25.5 د.ك", up: false },
        { title: "KNET", val: "متاح", up: true },
        { title: "Apple Pay", val: "متاح", up: true },
      ],
    }],
    haggle: [{
      id: "haggle", type: "haggle", label: "المفاوضة", color: "#FF6B00", color2: "#ec4899",
      items: [
        { title: "العرض", val: "100 كرتون مياه", up: true },
        { title: "سعرك", val: "45 د.ك", up: false },
        { title: "توصية AI", val: "48 د.ك + توصيل مجاني", up: true },
      ],
    }],
    return_item: [{
      id: "return", type: "return", label: "الإرجاع", color: "#ff6b6b", color2: "#FF6B00",
      items: [
        { title: "المنتج", val: "خلاط كهربائي", up: false },
        { title: "الحالة", val: "تالف", up: false },
        { title: "الحل", val: "استبدال خلال 24س", up: true },
      ],
    }],
  };

  return bubbles[intent] || [];
}
