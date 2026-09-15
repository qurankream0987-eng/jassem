import { useState, useRef, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Camera,
  Scan,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Barcode,
  Sparkles,
  RotateCcw,
  Package,
  ShoppingCart,
  AlertTriangle,
} from "lucide-react";
import { trpc } from "@/providers/trpc";

interface ScannedProduct {
  name: string;
  brand: string;
  category: string;
  barcode: string;
  price: number;
  currency: string;
  description: string;
  isHalal: boolean;
}

interface SearchResult {
  id: number;
  name: string;
  price: number;
  category: string | null;
  isHalal: boolean | null;
  imageUrl: string | null;
  relevanceScore: number;
}

type ScanState = "idle" | "requesting" | "scanning" | "detecting" | "results" | "error";

export default function CameraScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [scanState, setScanState] = useState<ScanState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [detectedProduct, setDetectedProduct] = useState<ScannedProduct | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const scanMutation = trpc.vision.scanProduct.useMutation();
  const searchMutation = trpc.vision.searchByImage.useMutation();

  // Request camera access
  const startCamera = useCallback(async () => {
    try {
      setScanState("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanState("scanning");
      }
    } catch {
      setErrorMessage("لا يمكن الوصول إلى الكاميرا. يرجى السماح بالوصول أو اختيار صورة.");
      setScanState("error");
    }
  }, []);

  // Capture frame from camera
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImage(imageData);

    // Stop camera
    const stream = video.srcObject as MediaStream;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    video.srcObject = null;

    processImage(imageData);
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const imageData = ev.target?.result as string;
      setCapturedImage(imageData);
      processImage(imageData);
    };
    reader.readAsDataURL(file);
  }, []);

  // Process image through AI
  const processImage = useCallback(async (imageData: string) => {
    setScanState("detecting");

    try {
      // Try tRPC scan first
      const result = await scanMutation.mutateAsync({
        imageData,
        merchantId: 1,
        marketCode: "KW",
      });

      if (result.success && result.product) {
        setDetectedProduct(result.product as unknown as ScannedProduct);
        setConfidence(result.confidence || 0);
        setScanState("results");

        // Also get search results
        try {
          const searchResult = await searchMutation.mutateAsync({
            imageData,
            merchantId: 1,
            marketCode: "KW",
            limit: 5,
          });
          if (searchResult.matches) {
            setSearchResults(searchResult.matches as unknown as SearchResult[]);
          }
        } catch {
          // Silently fail search
        }
      }
    } catch {
      // Fallback to mock detection
      setTimeout(() => {
        const mockProducts: ScannedProduct[] = [
          { name: "زيت زيتون بكر ممتاز", brand: "الجزيرة", category: "بقالة", barcode: "6281234567890", price: 2.5, currency: "KWD", description: "زيت زيتون بكر ممتاز 500 مل", isHalal: true },
          { name: "أرز بسمتي", brand: "إنديا جيت", category: "بقالة", barcode: "8901234567890", price: 1.8, currency: "KWD", description: "أرز بسمتي طويل الحبة 5 كجم", isHalal: true },
          { name: "تمور مدجول فاخرة", brand: "المدينة", category: "بقالة", barcode: "6289876543210", price: 3.5, currency: "KWD", description: "تمور مدجول فاخرة 1 كجم", isHalal: true },
          { name: "قهوة عربية", brand: "الأمير", category: "بقالة", barcode: "6281122334455", price: 2.2, currency: "KWD", description: "قهوة عربية بالهيل 250 جرام", isHalal: true },
          { name: "طحينة سمسم", brand: "الأرز", category: "بقالة", barcode: "6285566778899", price: 1.5, currency: "KWD", description: "طحينة سمسم نقية 400 جرام", isHalal: true },
        ];
        const randomProduct = mockProducts[Math.floor(Math.random() * mockProducts.length)];
        setDetectedProduct(randomProduct);
        setConfidence(0.85 + Math.random() * 0.13);
        setScanState("results");
      }, 1500);
    }
  }, [scanMutation, searchMutation]);

  // Reset scanner
  const reset = useCallback(() => {
    setScanState("idle");
    setCapturedImage(null);
    setDetectedProduct(null);
    setConfidence(0);
    setErrorMessage("");
    setSearchResults([]);
    if (videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  // Mock barcode scan
  const scanBarcode = useCallback(() => {
    setScanState("detecting");
    setTimeout(() => {
      const barcodes = [
        { name: "حليب طازج كامل الدسم", brand: "المراعي", category: "ألبان", barcode: "6281234500001", price: 0.55, currency: "KWD", description: "حليب طازج كامل الدسم 1 لتر", isHalal: true },
        { name: "خبز توست أبيض", brand: "الأسرة", category: "مخبوزات", barcode: "6281234500002", price: 0.35, currency: "KWD", description: "خبز توست أبيض 400 جرام", isHalal: true },
      ];
      setDetectedProduct(barcodes[Math.floor(Math.random() * barcodes.length)]);
      setConfidence(0.95);
      setScanState("results");
    }, 1200);
  }, []);

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="border-2 border-dashed border-gray-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Camera className="h-5 w-5 text-emerald-600" />
            ماسح المنتجات بالكاميرا
          </CardTitle>
          <CardDescription>
            صور منتجاً للتعرف عليه تلقائياً والبحث عنه في المتجر
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Camera View / Captured Image */}
          <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-video flex items-center justify-center">
            {scanState === "idle" && (
              <div className="text-center text-gray-400 space-y-3">
                <Camera className="h-12 w-12 mx-auto" />
                <p className="text-sm">اضغط "فتح الكاميرا" لبدء المسح</p>
              </div>
            )}

            {scanState === "requesting" && (
              <div className="text-center text-gray-400 space-y-3">
                <Loader2 className="h-10 w-10 mx-auto animate-spin" />
                <p className="text-sm">جاري طلب إذن الكاميرا...</p>
              </div>
            )}

            {(scanState === "scanning") && (
              <>
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                {/* Scan overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-0 bg-black/20" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-48 h-48 border-2 border-white/60 rounded-lg relative">
                      <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-emerald-400" />
                      <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-emerald-400" />
                      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-emerald-400" />
                      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-emerald-400" />
                      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-emerald-400/50 animate-pulse" />
                    </div>
                  </div>
                  <div className="absolute bottom-4 left-0 right-0 text-center">
                    <Badge variant="secondary" className="bg-black/60 text-white">
                      وجه الكاميرا نحو المنتج
                    </Badge>
                  </div>
                </div>
              </>
            )}

            {capturedImage && (
              <img
                src={capturedImage}
                alt="الصورة الملتقطة"
                className="w-full h-full object-cover"
              />
            )}

            {scanState === "detecting" && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="h-10 w-10 text-emerald-400 animate-spin" />
                <p className="text-white text-sm font-medium">جاري تحليل الصورة...</p>
                <div className="w-48 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full animate-pulse" style={{ width: "60%" }} />
                </div>
              </div>
            )}

            {scanState === "error" && (
              <div className="text-center text-red-400 space-y-3">
                <XCircle className="h-10 w-10 mx-auto" />
                <p className="text-sm">{errorMessage}</p>
              </div>
            )}

            {/* Hidden canvas and video elements */}
            <video ref={videoRef} className="hidden" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {scanState === "idle" && (
              <>
                <Button onClick={startCamera} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Camera className="h-4 w-4 ml-2" />
                  فتح الكاميرا
                </Button>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Scan className="h-4 w-4 ml-2" />
                  اختيار صورة
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button variant="outline" onClick={scanBarcode}>
                  <Barcode className="h-4 w-4 ml-2" />
                  مسح الباركود
                </Button>
              </>
            )}

            {scanState === "scanning" && (
              <>
                <Button onClick={captureFrame} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Camera className="h-4 w-4 ml-2" />
                  التقاط صورة
                </Button>
                <Button variant="outline" onClick={reset}>
                  <XCircle className="h-4 w-4 ml-2" />
                  إلغاء
                </Button>
              </>
            )}

            {(scanState === "results" || scanState === "error") && (
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="h-4 w-4 ml-2" />
                مسح جديد
              </Button>
            )}

            {scanState === "detecting" && (
              <Button disabled variant="outline">
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                جاري المعالجة...
              </Button>
            )}
          </div>

          {/* Detection Results */}
          {scanState === "results" && detectedProduct && (
            <div className="space-y-4">
              <Card className={cn(
                "border-2",
                detectedProduct.isHalal ? "border-emerald-200 bg-emerald-50/30" : "border-red-200 bg-red-50/30",
              )}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-white rounded-lg">
                        <Package className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{detectedProduct.name}</CardTitle>
                        <CardDescription>{detectedProduct.brand}</CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={detectedProduct.isHalal ? "default" : "destructive"}
                      className={cn(detectedProduct.isHalal ? "bg-emerald-100 text-emerald-700" : "")}
                    >
                      {detectedProduct.isHalal ? (
                        <><CheckCircle2 className="h-3 w-3 ml-1" />حلال</>
                      ) : (
                        <><AlertTriangle className="h-3 w-3 ml-1" />غير حلال</>
                      )}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">الفئة:</span>{" "}
                      <span className="font-medium">{detectedProduct.category}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">السعر:</span>{" "}
                      <span className="font-bold text-emerald-700">{detectedProduct.price} {detectedProduct.currency}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">الباركود:</span>{" "}
                      <span className="font-mono">{detectedProduct.barcode}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">الدقة:</span>{" "}
                      <span className="font-medium">{Math.round(confidence * 100)}%</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">{detectedProduct.description}</p>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={cn(
                        "h-2 rounded-full transition-all",
                        confidence > 0.9 ? "bg-emerald-500" : confidence > 0.7 ? "bg-amber-500" : "bg-red-500",
                      )}
                      style={{ width: `${confidence * 100}%` }}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-bold text-sm flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    نتائج البحث في المتجر
                  </h4>
                  <div className="space-y-2">
                    {searchResults.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center">
                            <Package className="h-5 w-5 text-gray-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-xs text-gray-500">{item.category}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {item.relevanceScore}%
                          </Badge>
                          <span className="text-sm font-bold text-emerald-600">
                            {item.price} د.ك
                          </span>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <ShoppingCart className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
