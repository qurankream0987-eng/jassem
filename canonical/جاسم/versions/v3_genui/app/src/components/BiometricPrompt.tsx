import { memo, useEffect, useRef, useState } from "react";
import { useBiometric } from "@/hooks/useBiometric";
import type { BiometricType } from "@/hooks/useBiometric";

interface BiometricPromptProps {
  /** هل النافذة مفتوحة */
  open: boolean;
  /** نوع المصادقة المطلوبة */
  type?: BiometricType;
  /** رسالة مخصصة */
  message?: string;
  /** عنوان الطلب */
  title?: string;
  /** عند النجاح */
  onSuccess?: () => void;
  /** عند الفشل */
  onError?: (error: string) => void;
  /** عند الإلغاء */
  onCancel?: () => void;
  /** عند الإغلاق */
  onClose?: () => void;
}

/** نبضة المسح */
const ScanRing = memo(function ScanRing({
  active,
  color,
}: {
  active: boolean;
  color: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: -8,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        opacity: active ? 0.6 : 0,
        transform: active ? "scale(1.1)" : "scale(0.9)",
        transition: "all 0.6s ease",
        animation: active ? "snapPulse 1.5s ease-in-out infinite" : "none",
      }}
    />
  );
});

/** رسم Face ID متحرك */
const FaceIdIcon = memo(function FaceIdIcon({
  status,
}: {
  status: string;
}) {
  const isSuccess = status === "success";
  const isError = status === "error";
  const isScanning = status === "scanning" || status === "verifying";
  const baseColor = isSuccess
    ? "#00c896"
    : isError
    ? "#ff5050"
    : "#00d4ff";

  return (
    <div
      style={{
        position: "relative",
        width: "80px",
        height: "80px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ScanRing active={isScanning} color={baseColor} />

      {/* دائرة خارجية */}
      <svg
        width="80"
        height="80"
        viewBox="0 0 80 80"
        style={{
          transform: isScanning ? "rotate(360deg)" : "rotate(0deg)",
          transition: "transform 2s linear",
        }}
      >
        {/* قوس علوي */}
        <path
          d="M20 28 A 20 20 0 0 1 60 28"
          fill="none"
          stroke={baseColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity={0.8}
        />
        {/* قوس سفلي */}
        <path
          d="M20 52 A 20 20 0 0 0 60 52"
          fill="none"
          stroke={baseColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity={0.8}
        />
        {/* خط المسح */}
        {isScanning && (
          <line
            x1="20"
            y1="40"
            x2="60"
            y2="40"
            stroke={baseColor}
            strokeWidth="1.5"
            opacity={0.5}
          >
            <animate
              attributeName="y1"
              values="28;52;28"
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="y2"
              values="28;52;28"
              dur="2s"
              repeatCount="indefinite"
            />
          </line>
        )}
      </svg>

      {/* أيقونة الوجه */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          {isSuccess ? (
            // علامة صح
            <>
              <circle cx="12" cy="12" r="10" stroke={baseColor} strokeWidth="1.5" />
              <path
                d="M8 12l2.5 2.5L16 9"
                stroke={baseColor}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : isError ? (
            // علامة خطأ
            <>
              <circle cx="12" cy="12" r="10" stroke={baseColor} strokeWidth="1.5" />
              <line x1="8" y1="8" x2="16" y2="16" stroke={baseColor} strokeWidth="2" strokeLinecap="round" />
              <line x1="16" y1="8" x2="8" y2="16" stroke={baseColor} strokeWidth="2" strokeLinecap="round" />
            </>
          ) : (
            // أيقونة وجه
            <>
              <path
                d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
                stroke={baseColor}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="12" cy="7" r="4" stroke={baseColor} strokeWidth="1.5" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
});

/** رسم بصمة الإصبع */
const FingerprintIcon = memo(function FingerprintIcon({
  status,
}: {
  status: string;
}) {
  const isSuccess = status === "success";
  const isError = status === "error";
  const isScanning = status === "scanning" || status === "verifying";
  const baseColor = isSuccess
    ? "#00c896"
    : isError
    ? "#ff5050"
    : "#00d4ff";

  return (
    <div
      style={{
        position: "relative",
        width: "80px",
        height: "80px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ScanRing active={isScanning} color={baseColor} />

      <svg width="70" height="70" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-2.319 1.989-4.394 3.845-6.006"
          stroke={baseColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
        {isScanning && (
          <>
            <line x1="4" y1="12" x2="20" y2="12" stroke={baseColor} strokeWidth="0.5" opacity={0.3">
              <animate attributeName="y1" values="4;20;4" dur="1.5s" repeatCount="indefinite" />
              <animate attributeName="y2" values="4;20;4" dur="1.5s" repeatCount="indefinite" />
            </line>
          </>
        )}
      </svg>
    </div>
  );
});

/** نافذة المصادقة البيومترية */
function BiometricPrompt({
  open,
  type = "face",
  message = "استخدم بصمتك للمصادقة",
  title = "المصادقة البيومترية",
  onSuccess,
  onError,
  onCancel,
  onClose,
}: BiometricPromptProps) {
  const {
    status,
    error,
    authenticate,
    verify,
    cancel,
    reset,
    isAvailable,
  } = useBiometric();

  const hasRun = useRef(false);
  const [mode, setMode] = useState<"create" | "verify">("verify");

  // بدء المصادقة تلقائياً عند الفتح
  useEffect(() => {
    if (open && !hasRun.current && isAvailable) {
      hasRun.current = true;
      handleAuth();
    }

    if (!open) {
      hasRun.current = false;
      reset();
    }
  }, [open]);

  // إشعارات الحالة
  useEffect(() => {
    if (status === "success") {
      onSuccess?.();
      const t = setTimeout(() => onClose?.(), 1200);
      return () => clearTimeout(t);
    }
    if (status === "error" && error) {
      onError?.(error);
    }
  }, [status, error]);

  const handleAuth = async () => {
    if (mode === "create") {
      await authenticate({ timeout: 60000 });
    } else {
      await verify({ timeout: 60000 });
    }
  };

  const handleCancel = () => {
    cancel();
    onCancel?.();
    onClose?.();
  };

  if (!open) return null;

  const isBusy = status === "scanning" || status === "verifying" || status === "prompting";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation: "fadeUp 0.2s ease forwards",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      {/* بطاقة المصادقة */}
      <div
        style={{
          width: "320px",
          borderRadius: "24px",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "rgba(0, 0, 20, 0.85)",
          border: "1px solid rgba(0, 212, 255, 0.25)",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5), 0 0 24px rgba(0, 212, 255, 0.1)",
          padding: "28px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          animation: "winExpand 0.3s var(--spring) forwards",
          direction: "rtl",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* أيقونة المصادقة */}
        {type === "fingerprint" ? (
          <FingerprintIcon status={status} />
        ) : (
          <FaceIdIcon status={status} />
        )}

        {/* العنوان */}
        <h3
          style={{
            color: "white",
            fontSize: "18px",
            fontWeight: 700,
            margin: 0,
            textAlign: "center",
          }}
        >
          {status === "success"
            ? "تمت المصادقة بنجاح"
            : status === "error"
            ? "فشلت المصادقة"
            : title}
        </h3>

        {/* الرسالة */}
        <p
          style={{
            color:
              status === "error"
                ? "rgba(255, 80, 80, 0.9)"
                : "var(--text2)",
            fontSize: "13px",
            textAlign: "center",
            margin: 0,
            lineHeight: 1.6,
            minHeight: "40px",
          }}
        >
          {status === "success"
            ? "جاري إكمال العملية..."
            : status === "error"
            ? error || "حدث خطأ أثناء المصادقة"
            : message}
        </p>

        {/* شريط التقدم */}
        {isBusy && (
          <div
            style={{
              width: "100%",
              height: "3px",
              background: "rgba(0, 212, 255, 0.1)",
              borderRadius: "3px",
              overflow: "hidden",
              marginTop: "4px",
            }}
          >
            <div
              style={{
                height: "100%",
                width: "40%",
                background: "linear-gradient(90deg, #00d4ff, #4a9eff)",
                borderRadius: "3px",
                animation: "borderRotate 1.5s linear infinite",
                transformOrigin: "left",
              }}
            />
          </div>
        )}

        {/* أزرار التحكم */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            width: "100%",
            marginTop: "8px",
          }}
        >
          {status === "idle" || status === "error" ? (
            <>
              <button
                onClick={handleAuth}
                style={{
                  flex: 1,
                  height: "42px",
                  borderRadius: "12px",
                  border: "none",
                  background: "linear-gradient(135deg, #00d4ff, #4a9eff)",
                  color: "white",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontFamily: "'Noto Sans Arabic', sans-serif",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "scale(1.02)";
                  e.currentTarget.style.boxShadow = "0 0 16px rgba(0, 212, 255, 0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {status === "error" ? "إعادة المحاولة" : "مصادقة"}
              </button>
              <button
                onClick={handleCancel}
                style={{
                  flex: 1,
                  height: "42px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "rgba(255, 255, 255, 0.05)",
                  color: "rgba(255, 255, 255, 0.7)",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontFamily: "'Noto Sans Arabic', sans-serif",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                }}
              >
                إلغاء
              </button>
            </>
          ) : status === "success" ? (
            <div
              style={{
                width: "100%",
                textAlign: "center",
                color: "#00c896",
                fontSize: "13px",
                fontWeight: 500,
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00c896"
                strokeWidth="2.5"
                style={{
                  display: "inline-block",
                  verticalAlign: "middle",
                  marginLeft: "6px",
                }}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              تم التحقق
            </div>
          ) : (
            <button
              onClick={handleCancel}
              style={{
                width: "100%",
                height: "42px",
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                background: "rgba(255, 255, 255, 0.05)",
                color: "rgba(255, 255, 255, 0.7)",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.2s ease",
                fontFamily: "'Noto Sans Arabic', sans-serif",
              }}
            >
              إلغاء
            </button>
          )}
        </div>

        {/* مؤشر توفر البيومترية */}
        {!isAvailable && (
          <div
            style={{
              marginTop: "4px",
              padding: "8px 12px",
              borderRadius: "8px",
              background: "rgba(255, 107, 0, 0.1)",
              border: "1px solid rgba(255, 107, 0, 0.2)",
              color: "rgba(255, 107, 0, 0.9)",
              fontSize: "11px",
              textAlign: "center",
              width: "100%",
            }}
          >
            المتصفح لا يدعم المصادقة البيومترية
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(BiometricPrompt);
