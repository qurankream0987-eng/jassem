import { useState, useMemo, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Globe,
  Calculator,
  Ship,
  Shield,
  Receipt,
  ArrowRightLeft,
  TrendingUp,
  Package,
  Landmark,
  ChevronDown,
  Info,
  CheckCircle2,
} from "lucide-react";
import { trpc } from "@/providers/trpc";

const CURRENCIES = [
  { code: "KWD", name: "دينار كويتي", symbol: "د.ك", rate: 1 },
  { code: "SAR", name: "ريال سعودي", symbol: "ر.س", rate: 12.25 },
  { code: "AED", name: "درهم إماراتي", symbol: "د.إ", rate: 11.95 },
  { code: "QAR", name: "ريال قطري", symbol: "ر.ق", rate: 11.85 },
  { code: "BHD", name: "دينار بحريني", symbol: "د.ب", rate: 1.23 },
  { code: "OMR", name: "ريال عماني", symbol: "ر.ع", rate: 1.58 },
  { code: "EGP", name: "جنيه مصري", symbol: "ج.م", rate: 157.5 },
  { code: "USD", name: "دولار أمريكي", symbol: "$", rate: 3.25 },
];

const COUNTRIES = [
  { code: "KW", name: "الكويت", currency: "KWD" },
  { code: "SA", name: "السعودية", currency: "SAR" },
  { code: "AE", name: "الإمارات", currency: "AED" },
  { code: "QA", name: "قطر", currency: "QAR" },
  { code: "BH", name: "البحرين", currency: "BHD" },
  { code: "OM", name: "عمان", currency: "OMR" },
  { code: "EG", name: "مصر", currency: "EGP" },
  { code: "TR", name: "تركيا", currency: "USD" },
  { code: "MY", name: "ماليزيا", currency: "USD" },
  { code: "ID", name: "إندونيسيا", currency: "USD" },
];

interface CalculationResult {
  subtotal: number;
  customsRate: number;
  customsFees: number;
  shippingRate: number;
  shippingFees: number;
  insuranceRate: number;
  insuranceFees: number;
  murabahaRate: number;
  murabahaAmount: number;
  totalCost: number;
  installmentAmount: number;
  currency: string;
}

export default function CrossBorderCalculator() {
  const [productValue, setProductValue] = useState(1000);
  const [quantity, setQuantity] = useState(1);
  const [fromCountry, setFromCountry] = useState("SA");
  const [toCountry, setToCountry] = useState("KW");
  const [murabahaMonths, setMurabahaMonths] = useState(12);
  const [murabahaRate, setMurabahaRate] = useState(8);
  const [currency, setCurrency] = useState("KWD");
  const [showDetails, setShowDetails] = useState(true);

  const feesQuery = trpc.crossborder.calculateFees.useQuery(
    { amount: productValue * quantity, murabahaRate },
    { enabled: productValue > 0 },
  );

  // Manual calculation for more detailed breakdown
  const result = useMemo<CalculationResult>(() => {
    const subtotal = productValue * quantity;
    const customsRate = 0.05;
    const shippingRate = 0.03;
    const insuranceRate = 0.01;

    const customsFees = Math.round(subtotal * customsRate * 1000) / 1000;
    const shippingFees = Math.round(subtotal * shippingRate * 1000) / 1000;
    const insuranceFees = Math.round(subtotal * insuranceRate * 1000) / 1000;
    const murabahaAmount = Math.round(subtotal * (murabahaRate / 100) * 1000) / 1000;

    const totalCost = Math.round((subtotal + customsFees + shippingFees + insuranceFees + murabahaAmount) * 1000) / 1000;
    const installmentAmount = Math.round((totalCost / murabahaMonths) * 1000) / 1000;

    return {
      subtotal,
      customsRate,
      customsFees,
      shippingRate,
      shippingFees,
      insuranceRate,
      insuranceFees,
      murabahaRate,
      murabahaAmount,
      totalCost,
      installmentAmount,
      currency,
    };
  }, [productValue, quantity, murabahaRate, murabahaMonths, currency]);

  const currencyRate = CURRENCIES.find((c) => c.code === currency)?.rate || 1;
  const fromCountryName = COUNTRIES.find((c) => c.code === fromCountry)?.name || "";
  const toCountryName = COUNTRIES.find((c) => c.code === toCountry)?.name || "";

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Globe className="h-5 w-5 text-blue-600" />
            حاسبة التكاليف الدولية
          </CardTitle>
          <CardDescription>
            احسب تكاليف الاستيراد الجمركية والشحن والتأمين والمرابحة
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Product Value */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">قيمة المنتج</label>
              <div className="flex">
                <input
                  type="number"
                  min={1}
                  className="flex-1 px-3 py-2 border border-r-0 rounded-r-lg text-sm"
                  value={productValue}
                  onChange={(e) => setProductValue(Number(e.target.value))}
                />
                <select
                  className="px-3 py-2 border rounded-l-lg text-sm bg-gray-50"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">الكمية</label>
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Route */}
          <div className="grid grid-cols-5 gap-2 items-end">
            <div className="col-span-2 space-y-2">
              <label className="text-sm font-medium">بلد المصدر</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm"
                value={fromCountry}
                onChange={(e) => setFromCountry(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-center pb-2">
              <ArrowRightLeft className="h-5 w-5 text-gray-400" />
            </div>
            <div className="col-span-2 space-y-2">
              <label className="text-sm font-medium">بلد الوجهة</label>
              <select
                className="w-full px-3 py-2 border rounded-lg text-sm"
                value={toCountry}
                onChange={(e) => setToCountry(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Murabaha Settings */}
          <Card className="bg-emerald-50/30 border-emerald-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Landmark className="h-4 w-4 text-emerald-600" />
                إعدادات المرابحة الإسلامية
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium">نسبة الربح (%)</label>
                  <input
                    type="range"
                    min={0}
                    max={25}
                    step={0.5}
                    value={murabahaRate}
                    onChange={(e) => setMurabahaRate(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                  <div className="text-center text-sm font-bold text-emerald-700">
                    {murabahaRate}%
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium">مدة التقسيط (شهر)</label>
                  <select
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    value={murabahaMonths}
                    onChange={(e) => setMurabahaMonths(Number(e.target.value))}
                  >
                    <option value={3}>3 أشهر</option>
                    <option value={6}>6 أشهر</option>
                    <option value={9}>9 أشهر</option>
                    <option value={12}>12 شهر</option>
                    <option value={18}>18 شهر</option>
                    <option value={24}>24 شهر</option>
                    <option value={36}>36 شهر</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <Card className="border-2 border-blue-200 bg-blue-50/20">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-blue-600" />
                  تفصيل التكاليف
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowDetails(!showDetails)}>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showDetails ? "" : "rotate-180")} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Subtotal */}
              <div className="flex items-center justify-between p-3 bg-white rounded-lg">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-gray-500" />
                  <span className="text-sm">قيمة المنتجات</span>
                </div>
                <span className="font-bold">{result.subtotal.toFixed(3)} {currency}</span>
              </div>

              {/* Customs */}
              <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100">
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-red-500" />
                  <div>
                    <span className="text-sm">الجمارك</span>
                    <Badge variant="outline" className="mr-2 text-xs">{result.customsRate * 100}%</Badge>
                  </div>
                </div>
                <span className="font-bold text-red-700">+ {result.customsFees.toFixed(3)} {currency}</span>
              </div>

              {/* Shipping */}
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-center gap-2">
                  <Ship className="h-4 w-4 text-blue-500" />
                  <div>
                    <span className="text-sm">الشحن</span>
                    <Badge variant="outline" className="mr-2 text-xs">{result.shippingRate * 100}%</Badge>
                  </div>
                </div>
                <span className="font-bold text-blue-700">+ {result.shippingFees.toFixed(3)} {currency}</span>
              </div>

              {/* Insurance */}
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-500" />
                  <div>
                    <span className="text-sm">التأمين</span>
                    <Badge variant="outline" className="mr-2 text-xs">{result.insuranceRate * 100}%</Badge>
                  </div>
                </div>
                <span className="font-bold text-amber-700">+ {result.insuranceFees.toFixed(3)} {currency}</span>
              </div>

              {/* Murabaha */}
              <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  <div>
                    <span className="text-sm">مرابحة إسلامية</span>
                    <Badge variant="outline" className="mr-2 text-xs bg-emerald-100">{result.murabahaRate}%</Badge>
                  </div>
                </div>
                <span className="font-bold text-emerald-700">+ {result.murabahaAmount.toFixed(3)} {currency}</span>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between p-4 bg-blue-100 rounded-xl border-2 border-blue-300 mt-4">
                <div className="flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-blue-700" />
                  <span className="font-bold text-blue-900">الإجمالي الكلي</span>
                </div>
                <div className="text-left">
                  <p className="text-2xl font-bold text-blue-900">
                    {result.totalCost.toFixed(3)} {currency}
                  </p>
                  <p className="text-xs text-blue-600">
                    شاملاً جميع الرسوم والمرابحة
                  </p>
                </div>
              </div>

              {/* Installment Summary */}
              {murabahaRate > 0 && (
                <Card className="bg-emerald-50/50 border-emerald-200">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Info className="h-4 w-4 text-emerald-600" />
                        <span className="text-sm font-medium">القسط الشهري</span>
                        <Badge className="bg-emerald-100 text-emerald-700 text-xs">
                          {murabahaMonths} شهر
                        </Badge>
                      </div>
                      <p className="text-xl font-bold text-emerald-700">
                        {result.installmentAmount.toFixed(3)} {currency}
                      </p>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>مرابحة إسلامية متوافقة مع الشريعة — لا فائدة ربوية</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Currency Conversion */}
              {showDetails && (
                <div className="mt-4 pt-4 border-t">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4 text-gray-500" />
                    تحويل العملات
                  </h4>
                  <div className="grid grid-cols-4 gap-2">
                    {CURRENCIES.filter((c) => c.code !== currency).slice(0, 4).map((c) => {
                      const converted = result.totalCost * (c.rate / currencyRate);
                      return (
                        <div key={c.code} className="text-center p-2 bg-white rounded-lg border">
                          <p className="text-xs text-gray-500">{c.name}</p>
                          <p className="text-sm font-bold">{converted.toFixed(2)} {c.symbol}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Route Summary */}
          <div className="flex items-center justify-center gap-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
            <span className="font-medium">{fromCountryName}</span>
            <ArrowRightLeft className="h-4 w-4 text-gray-400" />
            <span className="font-medium">{toCountryName}</span>
            <Badge variant="outline" className="text-xs">
              {result.subtotal.toFixed(0)} {currency}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
