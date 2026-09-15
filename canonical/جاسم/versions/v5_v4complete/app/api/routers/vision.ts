import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { visionScans, products } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

// Mock AI product scanning - detects products from image
function mockScanProduct(imageData: string): {
  product: {
    name: string;
    brand: string;
    category: string;
    barcode: string;
    price: number;
    currency: string;
    description: string;
    isHalal: boolean;
  };
  confidence: number;
} {
  // In production, this would call a real CV model (YOLO, ResNet, etc.)
  const mockProducts = [
    {
      name: "Olive Oil Extra Virgin",
      brand: "Al Jazira",
      category: "grocery",
      barcode: "6281234567890",
      price: 2.5,
      currency: "KWD",
      description: "Premium extra virgin olive oil, 500ml",
      isHalal: true,
    },
    {
      name: "Basmati Rice",
      brand: "India Gate",
      category: "grocery",
      barcode: "8901234567890",
      price: 1.8,
      currency: "KWD",
      description: "Long grain basmati rice, 5kg bag",
      isHalal: true,
    },
    {
      name: "Dates Medjool",
      brand: "Al Madina",
      category: "grocery",
      barcode: "6289876543210",
      price: 3.5,
      currency: "KWD",
      description: "Premium Medjool dates, 1kg box",
      isHalal: true,
    },
    {
      name: "Arabic Coffee",
      brand: "Al Ameed",
      category: "grocery",
      barcode: "6281122334455",
      price: 2.2,
      currency: "KWD",
      description: "Traditional Arabic coffee with cardamom, 250g",
      isHalal: true,
    },
    {
      name: "Tahini Paste",
      brand: "Al Arz",
      category: "grocery",
      barcode: "6285566778899",
      price: 1.5,
      currency: "KWD",
      description: "100% pure sesame tahini, 400g jar",
      isHalal: true,
    },
  ];

  // Seed-based selection from image data length
  const seed = imageData.length % mockProducts.length;
  return {
    product: mockProducts[seed],
    confidence: 0.85 + (Math.random() * 0.13),
  };
}

// Mock KYC document verification (OCR)
function mockVerifyDocument(documentType: string, imageData: string): {
  documentType: string;
  extractedData: Record<string, string>;
  verificationScore: number;
  isAuthentic: boolean;
  warnings: string[];
} {
  const docs: Record<string, Record<string, string>> = {
    passport: {
      fullName: "Ahmad Khalid Al-Farsi",
      nationality: "Kuwaiti",
      passportNumber: "KWT-" + Math.floor(100000 + Math.random() * 900000),
      dateOfBirth: "1990-05-15",
      expiryDate: "2028-03-20",
      issuingAuthority: "Ministry of Interior - Kuwait",
    },
    civil_id: {
      fullName: "Mohammed Abdullah Al-Sabah",
      civilId: "2" + Math.floor(10000000000 + Math.random() * 90000000000),
      nationality: "Kuwaiti",
      dateOfBirth: "1985-11-22",
      expiryDate: "2027-08-10",
      bloodType: "O+",
    },
    residency: {
      fullName: "Omar Hassan El-Sayed",
      residencyNumber: "" + Math.floor(1000000000 + Math.random() * 9000000000),
      nationality: "Egyptian",
      employer: "Sample Company W.L.L.",
      expiryDate: "2025-12-31",
    },
    driving_license: {
      fullName: "Khaled Nasser Al-Ahmad",
      licenseNumber: "DL-" + Math.floor(100000 + Math.random() * 900000),
      vehicleClass: "Light Vehicle (Category 3)",
      issueDate: "2020-01-15",
      expiryDate: "2030-01-14",
    },
  };

  const data = docs[documentType] || docs.passport;
  const verificationScore = 0.82 + (Math.random() * 0.16);
  const warnings = verificationScore > 0.9 ? [] : ["Image quality could be improved"];

  return {
    documentType,
    extractedData: data,
    verificationScore: Math.round(verificationScore * 100) / 100,
    isAuthentic: verificationScore >= 0.8,
    warnings,
  };
}

// Mock receipt OCR
function mockReadReceipt(imageData: string): {
  merchant: string;
  date: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
} {
  const items = [
    { name: "Kabsa Chicken", quantity: 1, unitPrice: 4.5 },
    { name: "Lentil Soup", quantity: 2, unitPrice: 1.2 },
    { name: "Arabic Bread", quantity: 1, unitPrice: 0.3 },
    { name: "Laban Up", quantity: 2, unitPrice: 0.5 },
    { name: "Kunafa", quantity: 1, unitPrice: 2.5 },
  ];

  const itemsWithTotal = items.map(item => ({
    ...item,
    total: Math.round(item.quantity * item.unitPrice * 100) / 100,
  }));

  const subtotal = itemsWithTotal.reduce((sum, item) => sum + item.total, 0);
  const tax = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return {
    merchant: "Al-Kabsa Restaurant",
    date: new Date().toISOString().split("T")[0],
    items: itemsWithTotal,
    subtotal,
    tax,
    total,
    currency: "KWD",
  };
}

// Mock object detection
function mockDetectObjects(imageData: string): Array<{
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
}> {
  const objects = [
    { label: "person", confidence: 0.95 },
    { label: "car", confidence: 0.88 },
    { label: "bottle", confidence: 0.76 },
    { label: "chair", confidence: 0.82 },
    { label: "table", confidence: 0.79 },
    { label: "phone", confidence: 0.91 },
    { label: "book", confidence: 0.72 },
    { label: "laptop", confidence: 0.87 },
  ];

  const seed = imageData.length % 5 + 2;
  return objects.slice(0, seed).map((obj, i) => ({
    label: obj.label,
    confidence: Math.round(obj.confidence * 100) / 100,
    bbox: [10 + i * 15, 20 + i * 10, 30 + i * 15, 40 + i * 10] as [number, number, number, number],
  }));
}

export const visionRouter = createRouter({
  // Scan product with camera
  scanProduct: authedQuery
    .input(z.object({
      imageData: z.string().min(1), // base64 image
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = mockScanProduct(input.imageData);

      // Store scan log
      const [scan] = await db.insert(visionScans).values({
        userId: Number(ctx.user.id),
        merchantId: input.merchantId,
        scanType: "product_scan",
        imageUrl: input.imageData.substring(0, 200), // Truncate for storage
        result: result as unknown as Record<string, unknown>,
        confidence: result.confidence,
        status: "completed",
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        scanId: scan.id,
        ...result,
      };
    }),

  // KYC document verification (OCR)
  verifyDocument: authedQuery
    .input(z.object({
      documentType: z.enum(["passport", "civil_id", "residency", "driving_license"]),
      imageData: z.string().min(1),
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = mockVerifyDocument(input.documentType, input.imageData);

      // Store scan log
      const [scan] = await db.insert(visionScans).values({
        userId: Number(ctx.user.id),
        merchantId: input.merchantId,
        scanType: "document_verification",
        imageUrl: input.imageData.substring(0, 200),
        result: result as unknown as Record<string, unknown>,
        confidence: result.verificationScore,
        status: "completed",
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        scanId: scan.id,
        ...result,
      };
    }),

  // Search products by image
  searchByImage: authedQuery
    .input(z.object({
      imageData: z.string().min(1),
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
      limit: z.number().min(1).max(20).default(5),
    }))
    .mutation(async ({ input, ctx }) => {
      const detected = mockScanProduct(input.imageData);

      // Search for similar products in database
      const dbProducts = await db.select()
        .from(products)
        .limit(input.limit * 2);

      // Score products by similarity to detected product
      const scored = dbProducts.map(p => {
        let score = 0;
        if (detected.product.category && p.category?.toLowerCase().includes(detected.product.category.toLowerCase())) score += 30;
        if (detected.product.name && p.name.toLowerCase().includes(detected.product.name.toLowerCase().split(" ")[0])) score += 40;
        if (p.isHalal === detected.product.isHalal) score += 10;
        return { ...p, relevanceScore: Math.min(score + Math.floor(Math.random() * 20), 100) };
      }).sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, input.limit);

      // Store scan log
      const [scan] = await db.insert(visionScans).values({
        userId: Number(ctx.user.id),
        merchantId: input.merchantId,
        scanType: "image_search",
        imageUrl: input.imageData.substring(0, 200),
        result: { detected: detected.product, matches: scored.length },
        confidence: detected.confidence,
        detectedObjects: [{ label: detected.product.name, confidence: detected.confidence, bbox: [0, 0, 100, 100] }],
        status: "completed",
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        scanId: scan.id,
        detectedProduct: detected.product,
        confidence: detected.confidence,
        matches: scored,
      };
    }),

  // Read receipt OCR
  readReceipt: authedQuery
    .input(z.object({
      imageData: z.string().min(1),
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = mockReadReceipt(input.imageData);

      // Store scan log
      const [scan] = await db.insert(visionScans).values({
        userId: Number(ctx.user.id),
        merchantId: input.merchantId,
        scanType: "receipt_ocr",
        imageUrl: input.imageData.substring(0, 200),
        result: result as unknown as Record<string, unknown>,
        ocrText: `Receipt from ${result.merchant} - Total: ${result.total} ${result.currency}`,
        status: "completed",
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        scanId: scan.id,
        ...result,
      };
    }),

  // General object detection
  detectObject: authedQuery
    .input(z.object({
      imageData: z.string().min(1),
      merchantId: z.number().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input, ctx }) => {
      const objects = mockDetectObjects(input.imageData);

      // Store scan log
      const [scan] = await db.insert(visionScans).values({
        userId: Number(ctx.user.id),
        merchantId: input.merchantId,
        scanType: "object_detection",
        imageUrl: input.imageData.substring(0, 200),
        result: { objectsDetected: objects.length },
        detectedObjects: objects,
        confidence: objects.length > 0 ? Math.max(...objects.map(o => o.confidence)) : 0,
        status: "completed",
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        scanId: scan.id,
        objectsDetected: objects.length,
        objects,
      };
    }),

  // Get scan history for user
  getHistory: authedQuery
    .input(z.object({
      scanType: z.enum(["product_scan", "document_verification", "image_search", "receipt_ocr", "object_detection", "barcode_scan"]).optional(),
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user.id);
      const conditions = [eq(visionScans.userId, userId)];

      if (input?.scanType) {
        conditions.push(eq(visionScans.scanType, input.scanType));
      }

      const scans = conditions.length > 0
        ? await db.select().from(visionScans)
            .where(and(...conditions))
            .orderBy(desc(visionScans.createdAt))
            .limit(input?.limit || 50)
        : await db.select().from(visionScans)
            .where(eq(visionScans.userId, userId))
            .orderBy(desc(visionScans.createdAt))
            .limit(input?.limit || 50);

      return scans;
    }),
});
