import { useState, useCallback, useRef } from "react";

/** حالة المصادقة البيومترية */
export type BiometricStatus =
  | "idle"       // في الانتظار
  | "prompting"  // عرض الطلب
  | "scanning"   // جاري المسح
  | "verifying"  // جاري التحقق
  | "success"    // نجاح
  | "error";     // فشل

/** نوع المصادقة المطلوبة */
export type BiometricType = "face" | "fingerprint" | "webauthn";

/** نتيجة المصادقة */
export interface BiometricResult {
  success: boolean;
  credential?: Credential;
  error?: string;
}

/** خيارات المصادقة */
export interface BiometricOptions {
  /** نوع المصادقة المفضل */
  preferredType?: BiometricType;
  /** رسالة مخصصة */
  challengeMessage?: string;
  /** المدة المسموحة */
  timeout?: number;
}

/**
 * هوك المصادقة البيومترية — WebAuthn API
 * يدعم Face ID و Touch ID و WebAuthn
 */
export function useBiometric() {
  const [status, setStatus] = useState<BiometricStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<BiometricResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** التحقق من توفر المصادقة البيومترية */
  const isAvailable = useCallback((): boolean => {
    return (
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined" &&
      typeof navigator.credentials !== "undefined"
    );
  }, []);

  /** التحقق من دعم نوع المصادقة */
  const supportsType = useCallback(
    async (type: BiometricType): Promise<boolean> => {
      if (!isAvailable()) return false;

      try {
        if (type === "webauthn") return true;

        const pubKeyCred =
          await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        return pubKeyCred;
      } catch {
        return false;
      }
    },
    [isAvailable]
  );

  /** إنشاء تحدي عشوائي */
  const generateChallenge = useCallback((): Uint8Array => {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    return challenge;
  }, []);

  /** تحويل سلسلة إلى ArrayBuffer */
  const strToBuffer = useCallback((str: string): ArrayBuffer => {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }, []);

  /**
   * بدء المصادقة البيومترية
   * يستخدم Web Authentication API
   */
  const authenticate = useCallback(
    async (options: BiometricOptions = {}): Promise<BiometricResult> => {
      if (!isAvailable()) {
        const result: BiometricResult = {
          success: false,
          error: "المصادقة البيومترية غير متوفرة في هذا المتصفح",
        };
        setStatus("error");
        setError(result.error);
        return result;
      }

      setStatus("prompting");
      setError(null);

      try {
        // إلغاء أي عملية سابقة
        if (abortRef.current) {
          abortRef.current.abort();
        }
        abortRef.current = new AbortController();

        const challenge = generateChallenge();
        const rpId = window.location.hostname;

        // إنشاء credential جديد
        const credentialOptions: PublicKeyCredentialCreationOptions = {
          challenge,
          rp: {
            name: "JASIM V4",
            id: rpId,
          },
          user: {
            id: strToBuffer("jasim-user"),
            name: "jasim-user",
            displayName: "مستخدم جاسم",
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },   // ES256
            { type: "public-key", alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: options.timeout ?? 60000,
          attestation: "none",
        };

        setStatus("scanning");

        const credential = (await navigator.credentials.create({
          publicKey: credentialOptions,
          signal: abortRef.current.signal,
        })) as PublicKeyCredential | null;

        if (!credential) {
          throw new Error("تم إلغاء المصادقة");
        }

        setStatus("verifying");

        // محاكاة التحقق (في الإنتاج: إرسال إلى الخادم)
        await new Promise((resolve) => setTimeout(resolve, 500));

        setStatus("success");

        const result: BiometricResult = {
          success: true,
          credential,
        };
        setLastResult(result);
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message === "AbortError" || err.name === "AbortError"
              ? "تم إلغاء المصادقة"
              : err.message
            : "خطأ غير معروف";

        const result: BiometricResult = {
          success: false,
          error: message,
        };
        setStatus("error");
        setError(message);
        setLastResult(result);
        return result;
      }
    },
    [isAvailable, generateChallenge, strToBuffer]
  );

  /**
   * بدء مصادقة (get) — للتحقق من وجود credential
   */
  const verify = useCallback(
    async (options: BiometricOptions = {}): Promise<BiometricResult> => {
      if (!isAvailable()) {
        const result: BiometricResult = {
          success: false,
          error: "المصادقة البيومترية غير متوفرة",
        };
        setStatus("error");
        setError(result.error);
        return result;
      }

      setStatus("prompting");
      setError(null);

      try {
        if (abortRef.current) {
          abortRef.current.abort();
        }
        abortRef.current = new AbortController();

        const challenge = generateChallenge();

        const assertionOptions: PublicKeyCredentialRequestOptions = {
          challenge,
          timeout: options.timeout ?? 60000,
          userVerification: "required",
          rpId: window.location.hostname,
          allowCredentials: [],
        };

        setStatus("scanning");

        const assertion = (await navigator.credentials.get({
          publicKey: assertionOptions,
          signal: abortRef.current.signal,
        })) as PublicKeyCredential | null;

        if (!assertion) {
          throw new Error("فشل التحقق");
        }

        setStatus("verifying");
        await new Promise((resolve) => setTimeout(resolve, 500));

        setStatus("success");

        const result: BiometricResult = {
          success: true,
          credential: assertion,
        };
        setLastResult(result);
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message === "AbortError" || err.name === "AbortError"
              ? "تم إلغاء التحقق"
              : err.message
            : "خطأ غير معروف";

        const result: BiometricResult = {
          success: false,
          error: message,
        };
        setStatus("error");
        setError(message);
        setLastResult(result);
        return result;
      }
    },
    [isAvailable, generateChallenge]
  );

  /** إلغاء العملية الحالية */
  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus("idle");
    setError(null);
  }, []);

  /** إعادة ضبط الحالة */
  const reset = useCallback(() => {
    cancel();
    setLastResult(null);
    setStatus("idle");
    setError(null);
  }, [cancel]);

  return {
    status,
    error,
    lastResult,
    isAvailable: isAvailable(),
    supportsType,
    authenticate,
    verify,
    cancel,
    reset,
  };
}

/** نوع إرجاع الـ Hook */
export type UseBiometricReturn = ReturnType<typeof useBiometric>;
