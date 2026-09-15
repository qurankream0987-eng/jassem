import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Scale,
  Landmark,
  Calendar,
  TrendingUp,
  Shield,
  CheckCircle2,
  FileText,
  Moon,
  Info,
  Printer,
  Download,
  ChevronLeft,
} from "lucide-react";

interface PaymentScheduleItem {
  month: number;
  installment: number;
  principal: number;
  markup: number;
  remainingBalance: number;
  date: string;
}

interface MurabahaDisplayProps {
  costPrice?: number;
  markupPercent?: number;
  sellingPrice?: number;
  installmentCount?: number;
  currency?: string;
}

export default function MurabahaDisplay({
  costPrice = 5000,
  markupPercent = 10,
  sellingPrice,
  installmentCount = 12,
  currency = "KWD",
}: MurabahaDisplayProps) {
  const actualSellingPrice = sellingPrice || Math.round(costPrice * (1 + markupPercent / 100) * 1000) / 1000;
  const totalMarkup = Math.round((actualSellingPrice - costPrice) * 1000) / 1000;
  const monthlyInstallment = Math.round((actualSellingPrice / installmentCount) * 1000) / 1000;
  const monthlyPrincipal = Math.round((costPrice / installmentCount) * 1000) / 1000;
  const monthlyMarkup = Math.round((totalMarkup / installmentCount) * 1000) / 1000;

  // Generate payment schedule
  const schedule: PaymentScheduleItem[] = [];
  const startDate = new Date();
  let remaining = actualSellingPrice;
  
  for (let i = 1; i <= installmentCount; i++) {
    const paymentDate = new Date(startDate);
    paymentDate.setMonth(paymentDate.getMonth() + i);
    
    remaining = Math.round((remaining - monthlyInstallment) * 1000) / 1000;
    
    schedule.push({
      month: i,
      installment: monthlyInstallment,
      principal: monthlyPrincipal,
      markup: monthlyMarkup,
      remainingBalance: Math.max(0, remaining),
      date: paymentDate.toLocaleDateString("ar-KW", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    });
  }

  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const visibleSchedule = showAll ? schedule : schedule.slice(0, 6);

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="border-2 border-emerald-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-100 rounded-xl">
                <Scale className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-lg">عقد المرابحة الإسلامية</CardTitle>
                <CardDescription>تمويل إسلامي متوافق مع الشريعة الإسلامية</CardDescription>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
              <Shield className="h-3 w-3 ml-1" />
              مرابحة شرعية
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Core Terms */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-blue-600 font-medium mb-1">سعر التكلفة</p>
                <p className="text-2xl font-bold text-blue-800">{costPrice.toFixed(3)}</p>
                <p className="text-xs text-blue-500">{currency}</p>
              </CardContent>
            </Card>
            <Card className="bg-emerald-50 border-emerald-200">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-emerald-600 font-medium mb-1">نسبة الربح</p>
                <p className="text-2xl font-bold text-emerald-800">{markupPercent}%</p>
                <p className="text-xs text-emerald-500">
                  +{(actualSellingPrice - costPrice).toFixed(3)} {currency}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-violet-50 border-violet-200">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-violet-600 font-medium mb-1">سعر البيع</p>
                <p className="text-2xl font-bold text-violet-800">{actualSellingPrice.toFixed(3)}</p>
                <p className="text-xs text-violet-500">{currency}</p>
              </CardContent>
            </Card>
          </div>

          {/* Sharia Compliance Info */}
          <Card className="bg-emerald-50/50 border-emerald-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-bold text-emerald-800 text-sm">متوافق مع الشريعة الإسلامية</p>
                  <ul className="space-y-1">
                    {[
                      "لا يوجد فائدة ربوية ( riba )",
                      "الربح محدد مسبقاً وثابت",
                      "لا رسوم تأخير إضافية",
                      "السلعة مملوكة قبل البيع",
                      "عقد بيع أصلي وليس قرض",
                    ].map((item, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                جدول الأقساط
                <Badge variant="outline" className="text-xs">{installmentCount} قسط</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Summary Row */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">القسط الشهري</p>
                  <p className="font-bold text-lg">{monthlyInstallment.toFixed(3)}</p>
                  <p className="text-xs text-gray-400">{currency}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">الأصل</p>
                  <p className="font-bold text-sm">{monthlyPrincipal.toFixed(3)}</p>
                  <p className="text-xs text-gray-400">{currency}/شهر</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">الربح</p>
                  <p className="font-bold text-sm">{monthlyMarkup.toFixed(3)}</p>
                  <p className="text-xs text-gray-400">{currency}/شهر</p>
                </div>
              </div>

              {/* Schedule */}
              <div className="border rounded-xl overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-5 gap-2 p-3 bg-gray-50 text-xs font-medium text-gray-500 border-b">
                  <div>الشهر</div>
                  <div>القسط</div>
                  <div>الأصل</div>
                  <div>الربح</div>
                  <div>المتبقي</div>
                </div>

                {/* Rows */}
                <div className="max-h-64 overflow-y-auto">
                  {visibleSchedule.map((item) => (
                    <button
                      key={item.month}
                      className={cn(
                        "w-full grid grid-cols-5 gap-2 p-3 text-sm transition-all text-right hover:bg-gray-50 border-b last:border-b-0",
                        expandedMonth === item.month ? "bg-emerald-50/50" : "",
                      )}
                      onClick={() => setExpandedMonth(expandedMonth === item.month ? null : item.month)}
                    >
                      <div className="font-medium">{item.month}</div>
                      <div className="font-bold text-emerald-700">{item.installment.toFixed(2)}</div>
                      <div className="text-gray-600">{item.principal.toFixed(2)}</div>
                      <div className="text-amber-600">{item.markup.toFixed(2)}</div>
                      <div className="text-gray-500 font-mono text-xs">
                        {item.remainingBalance.toFixed(2)}
                      </div>

                      {expandedMonth === item.month && (
                        <div className="col-span-5 mt-2 pt-2 border-t text-xs text-gray-500">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            تاريخ الاستحقاق: {item.date}
                          </div>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {!showAll && schedule.length > 6 && (
                <Button
                  variant="outline"
                  className="w-full text-sm"
                  onClick={() => setShowAll(true)}
                >
                  عرض الكل ({schedule.length} قسط)
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Islamic Calendar Note */}
          <Card className="bg-amber-50/50 border-amber-200">
            <CardContent className="p-3 flex items-center gap-2">
              <Moon className="h-4 w-4 text-amber-600" />
              <p className="text-xs text-amber-700">
                جدول الأقساط يستند إلى التقويم الميلادي. التواريخ الهجرية تتغير سنوياً.
              </p>
            </CardContent>
          </Card>

          {/* Late Payment Policy */}
          <Card className="bg-gray-50 border-gray-200">
            <CardContent className="p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-gray-600 space-y-1">
                <p className="font-bold">سياسة السداد المتأخر:</p>
                <p>لا توجد رسوم فائدة على التأخير وفقاً لمبادئ المرابحة الإسلامية.</p>
                <p>في حالة التأخر، يتم تقديم مهلة سماح 15 يوماً بدون أي رسوم إضافية.</p>
              </div>
            </CardContent>
          </Card>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => window.print()}>
            <Printer className="h-4 w-4 ml-2" />
            طباعة
          </Button>
          <Button variant="outline" className="flex-1">
            <FileText className="h-4 w-4 ml-2" />
            عرض العقد
          </Button>
          <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
            <Download className="h-4 w-4 ml-2" />
            تحميل PDF
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
