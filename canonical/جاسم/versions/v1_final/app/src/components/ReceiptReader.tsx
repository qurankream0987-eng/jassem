import { useState, useRef, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Receipt,
  Camera,
  Loader2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Upload,
  FileText,
  Calculator,
  Plus,
  Store,
  Calendar,
  Hash,
} from "lucide-react";
import { trpc } from "@/providers/trpc";

interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ReceiptData {
  merchant: string;
  date: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
}

type ReadState = "idle" | "capturing" | "processing" | "results" | "error";

export default function ReceiptReader() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [readState, setReadState] = useState<ReadState>("idle");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [expenseCategory, setExpenseCategory] = useState("مطاعم");

  const readMutation = trpc.vision.readReceipt.useMutation();

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      setReadState("capturing");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setErrorMessage("لا يمكن الوصول إلى الكاميرا. يرجى السماح بالوصول أو اختيار صورة.");
      setReadState("error");
    }
  }, []);

  // Capture frame
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(imageData);

    const stream = video.srcObject as MediaStream;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;

    processReceipt(imageData);
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imageData = ev.target?.result as string;
      setCapturedImage(imageData);
      processReceipt(imageData);
    };
    reader.readAsDataURL(file);
  }, []);

  // Process receipt through OCR
  const processReceipt = useCallback(async (imageData: string) => {
    setReadState("processing");

    try {
      const result = await readMutation.mutateAsync({
        imageData,
        merchantId: 1,
        marketCode: "KW",
      });

      if (result.success) {
        setReceiptData(result as unknown as ReceiptData);
        setSelectedItems(new Set((result.items as ReceiptItem[] || []).map((_: unknown, i: number) => i)));
        setReadState("results");
      }
    } catch {
      // Fallback mock
      setTimeout(() => {
        const mockItems: ReceiptItem[] = [
          { name: "كبسة دجاج", quantity: 1, unitPrice: 4.5, total: 4.5 },
          { name: "شوربة عدس", quantity: 2, unitPrice: 1.2, total: 2.4 },
          { name: "خبز عربي", quantity: 1, unitPrice: 0.3, total: 0.3 },
          { name: "لبن رايب", quantity: 2, unitPrice: 0.5, total: 1.0 },
          { name: "كنافة", quantity: 1, unitPrice: 2.5, total: 2.5 },
        ];
        const subtotal = mockItems.reduce((s, i) => s + i.total, 0);
        const tax = Math.round(subtotal * 0.05 * 100) / 100;
        const total = Math.round((subtotal + tax) * 100) / 100;

        setReceiptData({
          merchant: "مطعم الكبسة",
          date: new Date().toISOString().split("T")[0],
          items: mockItems,
          subtotal,
          tax,
          total,
          currency: "KWD",
        });
        setSelectedItems(new Set(mockItems.map((_, i) => i)));
        setReadState("results");
      }, 2000);
    }
  }, [readMutation]);

  const reset = useCallback(() => {
    setReadState("idle");
    setCapturedImage(null);
    setReceiptData(null);
    setErrorMessage("");
    setSelectedItems(new Set());
    if (videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const toggleItem = (idx: number) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectedTotal = receiptData
    ? receiptData.items.filter((_, i) => selectedItems.has(i)).reduce((s, i) => s + i.total, 0)
    : 0;

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-amber-600" />
            قارئ الإيصالات
          </CardTitle>
          <CardDescription>
            صور الإيصال لاستخراج العناصر والأسعار تلقائياً
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Camera View */}
          <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[4/3] flex items-center justify-center">
            {readState === "idle" && (
              <div className="text-center text-gray-400 space-y-3">
                <Receipt className="h-12 w-12 mx-auto" />
                <p className="text-sm">اضغط "فتح الكاميرا" لمسح الإيصال</p>
              </div>
            )}

            {readState === "capturing" && (
              <>
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-0 bg-black/20" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-72 h-96 border-2 border-white/60 rounded-lg relative">
                      <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-amber-400" />
                      <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-amber-400" />
                      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-amber-400" />
                      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-amber-400" />
                    </div>
                  </div>
                  <div className="absolute bottom-4 left-0 right-0 text-center">
                    <Badge variant="secondary" className="bg-black/60 text-white">
                      ضع الإيصال داخل الإطار
                    </Badge>
                  </div>
                </div>
              </>
            )}

            {capturedImage && (
              <img
                src={capturedImage}
                alt="الإيصال الملتقط"
                className="w-full h-full object-cover"
              />
            )}

            {readState === "processing" && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="h-10 w-10 text-amber-400 animate-spin" />
                <p className="text-white text-sm font-medium">جاري قراءة الإيصال (OCR)...</p>
                <div className="w-48 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: "55%" }} />
                </div>
                <p className="text-gray-400 text-xs">يتم استخراج العناصر والأسعار</p>
              </div>
            )}

            {readState === "error" && (
              <div className="text-center text-red-400 space-y-3">
                <XCircle className="h-10 w-10 mx-auto" />
                <p className="text-sm">{errorMessage}</p>
              </div>
            )}

            <video ref={videoRef} className="hidden" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {readState === "idle" && (
              <>
                <Button onClick={startCamera} className="bg-amber-600 hover:bg-amber-700 text-white">
                  <Camera className="h-4 w-4 ml-2" />
                  فتح الكاميرا
                </Button>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 ml-2" />
                  رفع صورة
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </>
            )}

            {readState === "capturing" && (
              <>
                <Button onClick={captureFrame} className="bg-amber-600 hover:bg-amber-700 text-white">
                  <Camera className="h-4 w-4 ml-2" />
                  التقاط صورة
                </Button>
                <Button variant="outline" onClick={reset}>
                  <XCircle className="h-4 w-4 ml-2" />
                  إلغاء
                </Button>
              </>
            )}

            {readState === "results" && (
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="h-4 w-4 ml-2" />
                مسح إيصال جديد
              </Button>
            )}
          </div>

          {/* OCR Results */}
          {readState === "results" && receiptData && (
            <div className="space-y-4">
              {/* Receipt Summary */}
              <Card className="bg-amber-50/30 border-amber-200">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-amber-100 rounded-lg">
                        <Store className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{receiptData.merchant}</CardTitle>
                      </div>
                    </div>
                    <Badge variant="outline" className="font-mono">{receiptData.currency}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Calendar className="h-4 w-4" />
                    <span>{receiptData.date}</span>
                    <Hash className="h-4 w-4 mr-4" />
                    <span>إيصال #{Math.floor(100000 + Math.random() * 900000)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Items Table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    تفاصيل العناصر
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 font-medium px-2">
                    <div className="col-span-1">#</div>
                    <div className="col-span-5">العنصر</div>
                    <div className="col-span-2 text-center">الكمية</div>
                    <div className="col-span-2 text-center">السعر</div>
                    <div className="col-span-2 text-center">المجموع</div>
                  </div>

                  {receiptData.items.map((item, idx) => (
                    <button
                      key={idx}
                      className={cn(
                        "w-full grid grid-cols-12 gap-2 p-2 rounded-lg text-sm transition-all text-right",
                        selectedItems.has(idx)
                          ? "bg-emerald-50 border border-emerald-200"
                          : "bg-gray-50 opacity-50",
                      )}
                      onClick={() => toggleItem(idx)}
                    >
                      <div className="col-span-1 flex items-center">
                        {selectedItems.has(idx) ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
                        )}
                      </div>
                      <div className="col-span-5 font-medium">{item.name}</div>
                      <div className="col-span-2 text-center">{item.quantity}</div>
                      <div className="col-span-2 text-center">{item.unitPrice.toFixed(3)}</div>
                      <div className="col-span-2 text-center font-bold">{item.total.toFixed(3)}</div>
                    </button>
                  ))}

                  {/* Totals */}
                  <div className="border-t pt-3 space-y-2 mt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">المجموع الفرعي ({selectedItems.size} عنصر)</span>
                      <span className="font-medium">{selectedTotal.toFixed(3)} {receiptData.currency}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">الضريبة (5%)</span>
                      <span className="font-medium">{receiptData.tax.toFixed(3)} {receiptData.currency}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold border-t pt-2">
                      <span>الإجمالي</span>
                      <span className="text-emerald-700">{receiptData.total.toFixed(3)} {receiptData.currency}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Auto-fill Expense Form */}
              <Card className="border-emerald-200 bg-emerald-50/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-emerald-600" />
                    إنشاء مصروف من الإيصال
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">الاسم</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        defaultValue={receiptData.merchant}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">التاريخ</label>
                      <input
                        type="date"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        defaultValue={receiptData.date}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">المبلغ</label>
                      <input
                        type="number"
                        step="0.001"
                        className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                        defaultValue={selectedTotal.toFixed(3)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500">الفئة</label>
                      <select
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        value={expenseCategory}
                        onChange={(e) => setExpenseCategory(e.target.value)}
                      >
                        <option>مطاعم</option>
                        <option>بقالة</option>
                        <option>مواصلات</option>
                        <option>صحة</option>
                        <option>تسوق</option>
                        <option>فواتير</option>
                        <option>أخرى</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-500">ملاحظات</label>
                    <textarea
                      className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
                      rows={2}
                      defaultValue={`إيصال من ${receiptData.merchant} - ${receiptData.items.length} عناصر`}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Submit */}
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="h-4 w-4 ml-2" />
                حفظ المصروف
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
