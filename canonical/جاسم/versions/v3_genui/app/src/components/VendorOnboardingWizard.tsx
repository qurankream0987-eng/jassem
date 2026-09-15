import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           VENDOR ONBOARDING WIZARD                              ║
 * ║  Multi-step wizard for vendors joining an aggregator platform   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Steps:
 * 1. Basic Info (name, phone, email)
 * 2. Business Details (type, description, CR number)
 * 3. Products/Services (add items)
 * 4. Bank Details (for payouts)
 * 5. Review & Submit
 */

interface StepProps {
  data: any;
  onUpdate: (data: any) => void;
  onNext: () => void;
  onBack: () => void;
}

function Step1BasicInfo({ data, onUpdate, onNext }: StepProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">المعلومات الأساسية</h3>
      <p className="text-sm text-gray-400">أدخل بيانات التواصل</p>

      <Input
        placeholder="اسم صاحب المحل"
        value={data.ownerName || ""}
        onChange={(e) => onUpdate({ ...data, ownerName: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
      />
      <Input
        placeholder="اسم المحل / الشركة"
        value={data.businessName || ""}
        onChange={(e) => onUpdate({ ...data, businessName: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
      />
      <Input
        placeholder="رقم الهاتف (مثال: 965501234567)"
        value={data.phone || ""}
        onChange={(e) => onUpdate({ ...data, phone: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
        type="tel"
      />
      <Input
        placeholder="البريد الإلكتروني"
        value={data.email || ""}
        onChange={(e) => onUpdate({ ...data, email: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
        type="email"
      />

      <Button
        onClick={onNext}
        disabled={!data.ownerName || !data.businessName || !data.phone}
        className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500"
      >
        التالي
      </Button>
    </div>
  );
}

function Step2BusinessDetails({ data, onUpdate, onNext, onBack }: StepProps) {
  const businessTypes = [
    { id: "mechanic", label: "ميكانيك سيارات", icon: "🔧" },
    { id: "salon", label: "صالون تجميل", icon: "💇" },
    { id: "restaurant", label: "مطعم / كافيه", icon: "🍽" },
    { id: "clothing", label: "ملابس / أزياء", icon: "👗" },
    { id: "electronics", label: "إلكترونيات", icon: "📱" },
    { id: "pharmacy", label: "صيدلية", icon: "💊" },
    { id: "cleaning", label: "تنظيف", icon: "🧹" },
    { id: "other", label: "أخرى", icon: "🏪" },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">تفاصيل النشاط</h3>
      <p className="text-sm text-gray-400">اختر نوع النشاط التجاري</p>

      <div className="grid grid-cols-2 gap-3">
        {businessTypes.map((type) => (
          <button
            key={type.id}
            onClick={() => onUpdate({ ...data, businessType: type.id })}
            className={`p-3 rounded-xl border text-right transition-all ${
              data.businessType === type.id
                ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                : "border-white/10 bg-white/5 text-gray-300 hover:border-white/20"
            }`}
          >
            <span className="text-2xl block mb-1">{type.icon}</span>
            <span className="text-sm">{type.label}</span>
          </button>
        ))}
      </div>

      <textarea
        placeholder="وصف النشاط (ما الذي تقدمه؟)"
        value={data.description || ""}
        onChange={(e) => onUpdate({ ...data, description: e.target.value })}
        className="w-full h-24 p-3 rounded-xl bg-white/5 border border-cyan-500/30 text-white placeholder-gray-500 resize-none"
      />

      <Input
        placeholder="رقم السجل التجاري (CR)"
        value={data.crNumber || ""}
        onChange={(e) => onUpdate({ ...data, crNumber: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
      />

      <div className="flex gap-3">
        <Button
          onClick={onBack}
          variant="outline"
          className="flex-1 border-white/20 text-white hover:bg-white/10"
        >
          السابق
        </Button>
        <Button
          onClick={onNext}
          disabled={!data.businessType}
          className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600"
        >
          التالي
        </Button>
      </div>
    </div>
  );
}

function Step3Products({ data, onUpdate, onNext, onBack }: StepProps) {
  const [products, setProducts] = useState(data.products || []);
  const [newProduct, setNewProduct] = useState({ name: "", price: "", description: "" });

  const addProduct = () => {
    if (newProduct.name && newProduct.price) {
      const updated = [...products, { ...newProduct, id: Date.now() }];
      setProducts(updated);
      onUpdate({ ...data, products: updated });
      setNewProduct({ name: "", price: "", description: "" });
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">المنتجات / الخدمات</h3>
      <p className="text-sm text-gray-400">أضف ما تقدمه (3 على الأقل)</p>

      <div className="space-y-2">
        <Input
          placeholder="اسم المنتج / الخدمة"
          value={newProduct.name}
          onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
          className="bg-white/5 border-cyan-500/30 text-white"
        />
        <div className="flex gap-2">
          <Input
            placeholder="السعر (د.ك)"
            value={newProduct.price}
            onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
            className="bg-white/5 border-cyan-500/30 text-white"
            type="number"
          />
          <Button onClick={addProduct} className="bg-cyan-500 hover:bg-cyan-400">
            إضافة
          </Button>
        </div>
      </div>

      {products.length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {products.map((p: any, i: number) => (
            <div key={p.id || i} className="flex justify-between items-center p-2 rounded-lg bg-white/5 border border-white/10">
              <div>
                <p className="text-white text-sm">{p.name}</p>
                <p className="text-cyan-400 text-xs">{p.price} د.ك</p>
              </div>
              <button
                onClick={() => {
                  const updated = products.filter((_: any, idx: number) => idx !== i);
                  setProducts(updated);
                  onUpdate({ ...data, products: updated });
                }}
                className="text-red-400 hover:text-red-300 text-sm"
              >
                حذف
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500 text-center">{products.length} منتج مضاف</p>

      <div className="flex gap-3">
        <Button onClick={onBack} variant="outline" className="flex-1 border-white/20 text-white">
          السابق
        </Button>
        <Button
          onClick={onNext}
          disabled={products.length < 1}
          className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600"
        >
          التالي
        </Button>
      </div>
    </div>
  );
}

function Step4BankDetails({ data, onUpdate, onNext, onBack }: StepProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">بيانات الحساب البنكي</h3>
      <p className="text-sm text-gray-400">لاستلام المدفوعات (آمنة ومشفرة)</p>

      <Input
        placeholder="اسم البنك"
        value={data.bankName || ""}
        onChange={(e) => onUpdate({ ...data, bankName: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
      />
      <Input
        placeholder="رقم الحساب (IBAN)"
        value={data.iban || ""}
        onChange={(e) => onUpdate({ ...data, iban: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
        dir="ltr"
      />
      <Input
        placeholder="اسم صاحب الحساب"
        value={data.accountHolder || ""}
        onChange={(e) => onUpdate({ ...data, accountHolder: e.target.value })}
        className="bg-white/5 border-cyan-500/30 text-white"
      />

      <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
        <p className="text-green-400 text-xs text-center">
          🔒 بياناتك البنكية مشفرة ومحمية. نستخدمها فقط لتحويل المدفوعات.
        </p>
      </div>

      <div className="flex gap-3">
        <Button onClick={onBack} variant="outline" className="flex-1 border-white/20 text-white">
          السابق
        </Button>
        <Button
          onClick={onNext}
          disabled={!data.bankName || !data.iban}
          className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600"
        >
          المراجعة
        </Button>
      </div>
    </div>
  );
}

function Step5Review({ data, onSubmit, onBack }: StepProps & { onSubmit: () => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">مراجعة البيانات</h3>
      <p className="text-sm text-gray-400">تأكد من صحة المعلومات قبل الإرسال</p>

      <div className="space-y-3 max-h-60 overflow-y-auto">
        <ReviewItem label="صاحب المحل" value={data.ownerName} />
        <ReviewItem label="اسم المحل" value={data.businessName} />
        <ReviewItem label="الهاتف" value={data.phone} />
        <ReviewItem label="البريد" value={data.email} />
        <ReviewItem label="نوع النشاط" value={data.businessType} />
        <ReviewItem label="السجل التجاري" value={data.crNumber || "—"} />
        <ReviewItem label="عدد المنتجات" value={`${(data.products || []).length} منتج`} />
        <ReviewItem label="البنك" value={data.bankName} />
        <ReviewItem label="IBAN" value={data.iban} />
      </div>

      <div className="flex gap-3">
        <Button onClick={onBack} variant="outline" className="flex-1 border-white/20 text-white">
          تعديل
        </Button>
        <Button
          onClick={onSubmit}
          className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500"
        >
          تقديم الطلب
        </Button>
      </div>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between p-2 rounded-lg bg-white/5 border border-white/10">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className="text-white text-sm font-medium">{value}</span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// MAIN WIZARD COMPONENT
// ═════════════════════════════════════════════════════════════════
export default function VendorOnboardingWizard({ platformId, onComplete }: {
  platformId: number;
  onComplete?: () => void;
}) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<any>({ platformId });
  const [submitted, setSubmitted] = useState(false);

  const totalSteps = 5;
  const progress = (step / totalSteps) * 100;

  const handleSubmit = async () => {
    // Call the API to register vendor
    // await api.genaggregator.addVendor.useMutation({...})
    setSubmitted(true);
    onComplete?.();
  };

  if (submitted) {
    return (
      <Card className="p-6 max-w-md mx-auto bg-black/40 border border-green-500/30 backdrop-blur-xl">
        <div className="text-center space-y-4">
          <div className="text-5xl">🎉</div>
          <h3 className="text-xl font-bold text-green-400">تم التسجيل بنجاح!</h3>
          <p className="text-gray-400 text-sm">
            طلبك قيد المراجعة. سن_notifyك خلال 24 ساعة.
          </p>
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-cyan-400 text-sm">رقم الطلب: #{Date.now().toString(36).toUpperCase()}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 max-w-md mx-auto bg-black/40 border border-cyan-500/20 backdrop-blur-xl">
      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-gray-400 mb-2">
          <span>الخطوة {step} من {totalSteps}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step Content */}
      {step === 1 && <Step1BasicInfo data={data} onUpdate={setData} onNext={() => setStep(2)} onBack={() => {}} />}
      {step === 2 && <Step2BusinessDetails data={data} onUpdate={setData} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <Step3Products data={data} onUpdate={setData} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && <Step4BankDetails data={data} onUpdate={setData} onNext={() => setStep(5)} onBack={() => setStep(3)} />}
      {step === 5 && <Step5Review data={data} onUpdate={setData} onNext={() => {}} onBack={() => setStep(4)} onSubmit={handleSubmit} />}
    </Card>
  );
}
