/**
 * RunLifecycleCard — Phase 9 / Phase 10
 *
 * Shows the full lifecycle of a durable run:
 *   - Status badge with Phase 9 verification states
 *   - AI completion text (openai-chat output) rendered inline (Task #19)
 *   - Failure details with safe-retry UI (Task #20)
 *   - Approve / Resume / Execute / Reconcile actions
 */
import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRunLifecycle } from "@/hooks/useRunLifecycle";
import { trpc } from "@/providers/trpc";
import { useTrustedActionDispatcher } from "@/hooks/useTrustedActionDispatcher";
import {
  createTrustedActionEnvelope,
  trustedActionFailure,
} from "@/lib/trusted-action-dispatcher";

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  blocked: { label: "متوقف", color: "text-amber-400 border-amber-500/40 bg-amber-500/10", Icon: Clock },
  awaiting_input: { label: "ينتظر تفاصيل", color: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10", Icon: Clock },
  awaiting_approval: { label: "ينتظر موافقة", color: "text-orange-400 border-orange-500/40 bg-orange-500/10", Icon: Clock },
  ready: { label: "جاهز للتنفيذ", color: "text-blue-400 border-blue-500/40 bg-blue-500/10", Icon: Play },
  running: { label: "جارٍ التنفيذ", color: "text-blue-400 border-blue-500/40 bg-blue-500/10", Icon: Loader2 },
  completed: { label: "اكتمل", color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10", Icon: CheckCircle },
  failed: { label: "فشل", color: "text-red-400 border-red-500/40 bg-red-500/10", Icon: XCircle },
  cancelled: { label: "ملغى", color: "text-slate-400 border-slate-500/40 bg-slate-500/10", Icon: XCircle },
};

// Phase 9: Verification status badge
const VERIFICATION_CONFIG: Record<
  string,
  { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  VERIFIED: {
    label: "تم التحقق",
    color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
    Icon: ShieldCheck,
  },
  INCONCLUSIVE: {
    label: "غير حاسم",
    color: "text-yellow-400 border-yellow-500/40 bg-yellow-500/10",
    Icon: HelpCircle,
  },
  FAILED: {
    label: "فشل التحقق",
    color: "text-red-400 border-red-500/40 bg-red-500/10",
    Icon: XCircle,
  },
  PENDING: {
    label: "في الانتظار",
    color: "text-slate-400 border-slate-500/40 bg-slate-500/10",
    Icon: Clock,
  },
};

export interface RunLifecycleCardProps {
  runId: string;
  proposalIds?: string[];
  label?: string;
}

export function RunLifecycleCard({ runId, proposalIds = [], label }: RunLifecycleCardProps) {
  const {
    run,
    receipt,
    isLoading,
    canApprove,
    canResume,
    canExecute,
    canReconcile,
    canRetry,
    approveProposal,
    rejectProposal,
    resumePlan,
    executeRun,
    reconcileRun,
    retryRun,
  } = useRunLifecycle(runId, proposalIds);
  const utils = trpc.useUtils();
  const { dispatch } = useTrustedActionDispatcher();
  const bubblesQuery = trpc.runtime.bubblesList.useQuery(undefined, {
    staleTime: 15_000,
  });
  const [selectedBubbleByArtifact, setSelectedBubbleByArtifact] = useState<Record<string, string>>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachingArtifactId, setAttachingArtifactId] = useState<string | null>(null);

  const attachImageToBubble = async (artifactId: string) => {
    setAttachingArtifactId(artifactId);
    const bubbleId = selectedBubbleByArtifact[artifactId];
    const bubble = (bubblesQuery.data?.bubbles ?? []).find(
      (item) => item.bubbleId === bubbleId,
    );
    if (!bubble) {
      setAttachmentError("اختر Smart Bubble موجودة أولاً.");
      setAttachingArtifactId(null);
      return;
    }
    setAttachmentError(null);
    try {
      const result = await dispatch(
        createTrustedActionEnvelope({
          actionId: `run-artifact:${runId}:${artifactId}:${bubble.presentation.presentationVersion}`,
          actionType: "ATTACH_ARTIFACT",
          intent: "attach_artifact",
          source: "PRESENTATION",
          targetReference: { kind: "smart_bubble", id: bubbleId },
          presentationReference: { kind: "bubble", id: bubbleId },
          expectedPresentationVersion: `presentation:${bubble.presentation.presentationVersion}`,
          idempotencyKey: `run-artifact:${runId}:${artifactId}`,
          payload: {
            sourceRunId: runId,
            artifactId,
            role: "cover",
          },
        }),
      );
      const failure = trustedActionFailure(result);
      if (failure) throw failure;
      await Promise.all([
        utils.runtime.bubblesList.invalidate(),
        utils.runtime.bubblesGet.invalidate({ bubbleId }),
        utils.runtime.bubblesProjection.invalidate({ bubbleId }),
      ]);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "تعذر ربط الصورة بالـBubble.",
      );
    } finally {
      setAttachingArtifactId(null);
    }
  };

  if (!run) {
    return (
      <div className="mt-2 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3 flex items-center gap-2 text-slate-500 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>جارٍ تحميل حالة الخطة…</span>
      </div>
    );
  }

  const status = run.status;
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.blocked;
  const Icon = config.Icon;
  const firstProposalId = proposalIds[0];

  // Phase 9: Extract AI completion from aggregated outputs
  const aiCompletion = extractAiCompletion(receipt?.aggregatedOutput);
  const sources = extractResearchSources(receipt?.aggregatedOutput);
  const images = extractGeneratedImages(receipt?.aggregatedOutput);
  const verificationStatus = receipt?.verificationStatus;
  const verConfig = verificationStatus ? (VERIFICATION_CONFIG[verificationStatus] ?? null) : null;

  return (
    <div className="mt-3 rounded-xl border border-slate-700/50 bg-slate-800/30 overflow-hidden text-sm" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-blue-600/20 flex items-center justify-center">
            <Play className="w-3 h-3 text-blue-400" />
          </div>
          <span className="text-slate-200 font-medium text-xs truncate max-w-[200px]">
            {label ?? run.goal ?? "خطة دائمة"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Verification badge (Phase 9) */}
          {verConfig && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${verConfig.color}`}>
              <verConfig.Icon className="w-2.5 h-2.5" />
              {verConfig.label}
            </span>
          )}
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${config.color}`}>
            <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
            {config.label}
          </span>
        </div>
      </div>

      {/* Phase 9 — AI Completion result (Task #19) */}
      {aiCompletion && (
        <div className="px-4 py-3 border-b border-slate-700/40">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-500 mb-1">نتيجة الـ AI</p>
              <p className="text-slate-200 text-xs leading-relaxed whitespace-pre-wrap">{aiCompletion}</p>
            </div>
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-700/40 space-y-2">
          <p className="text-[10px] text-slate-500">مصادر البحث — محتوى خارجي غير موثوق</p>
          {sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border border-slate-700/50 bg-slate-900/30 px-2.5 py-2 hover:border-blue-500/50 transition-colors"
              dir="auto"
            >
              <span className="flex items-center gap-1.5 text-xs text-blue-300">
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">{source.title}</span>
              </span>
              {source.snippet && <span className="mt-1 block text-[11px] leading-relaxed text-slate-400 line-clamp-2">{source.snippet}</span>}
              <span className="mt-1 block text-[10px] text-slate-600">{source.domain}</span>
            </a>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-700/40">
          <p className="mb-2 flex items-center gap-1.5 text-[10px] text-slate-500">
            <ImageIcon className="w-3 h-3" />
            صور مولدة ومحفوظة
          </p>
          <div className="grid grid-cols-2 gap-2">
            {images.map((image) => (
              <div key={image.id} className="overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/30">
                {image.url ? (
                  <a href={image.url} target="_blank" rel="noreferrer" className="block">
                    <img src={image.url} alt={image.prompt || "صورة مولدة"} className="aspect-square w-full object-cover" loading="lazy" />
                    {image.prompt && <span className="block truncate px-2 py-1.5 text-[10px] text-slate-400" dir="auto">{image.prompt}</span>}
                  </a>
                ) : (
                  <div className="px-2 py-3 text-[10px] text-slate-500">
                    الصورة محفوظة، لكن المعاينة غير متاحة حالياً.
                  </div>
                )}
                {image.sourceCount > 0 && (
                  <p className="border-t border-slate-700/40 px-2 py-1 text-[10px] text-slate-500">
                    استندت إلى {image.sourceCount} مصادر كإلهام، وليست شهادة تحقق للصور.
                  </p>
                )}
                <div className="border-t border-slate-700/50 p-1.5">
                  <select
                    value={selectedBubbleByArtifact[image.id] ?? ""}
                    onChange={(event) =>
                      setSelectedBubbleByArtifact((current) => ({
                        ...current,
                        [image.id]: event.target.value,
                      }))
                    }
                    className="mb-1 h-7 w-full rounded border border-slate-600 bg-slate-900 px-1 text-[10px] text-slate-200"
                    aria-label="اختر Smart Bubble"
                  >
                    <option value="">اختر Smart Bubble…</option>
                    {(bubblesQuery.data?.bubbles ?? [])
                      .filter((bubble) => bubble.status !== "archived")
                      .map((bubble) => (
                        <option key={bubble.bubbleId} value={bubble.bubbleId}>
                          {bubble.title}
                        </option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-full border-teal-700/60 text-[10px] text-teal-200 hover:bg-teal-500/10"
                    disabled={attachingArtifactId === image.id || !selectedBubbleByArtifact[image.id]}
                    onClick={() => void attachImageToBubble(image.id)}
                  >
                    {attachingArtifactId === image.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    استخدم في Bubble
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {attachmentError && <p className="mt-2 text-[10px] text-rose-300">{attachmentError}</p>}
        </div>
      )}

      {/* Approval section */}
      {canApprove && firstProposalId && (
        <div className="px-4 py-3 space-y-2.5">
          <p className="text-slate-300 text-xs leading-relaxed">
            هذه الخطة تتطلب موافقتك قبل التنفيذ. راجع الهدف أعلاه وقرر:
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white border-0 gap-1"
              disabled={isLoading}
              onClick={() => void approveProposal(firstProposalId)}
            >
              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
              موافقة
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-7 text-xs border-slate-600 text-slate-300 hover:bg-slate-700 gap-1"
              disabled={isLoading}
              onClick={() => void rejectProposal(firstProposalId)}
            >
              <ThumbsDown className="w-3 h-3" />
              رفض
            </Button>
          </div>
        </div>
      )}

      {/* Resume section */}
      {canResume && firstProposalId && (
        <div className="px-4 py-3 space-y-2">
          <p className="text-slate-400 text-xs">✅ تمت الموافقة — اضغط لتفعيل الخطة.</p>
          <Button
            size="sm"
            className="w-full h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white border-0 gap-1"
            disabled={isLoading}
            onClick={() => void resumePlan(firstProposalId)}
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            تفعيل الخطة
          </Button>
        </div>
      )}

      {/* Execute section */}
      {canExecute && (
        <div className="px-4 py-3 space-y-2">
          <p className="text-slate-400 text-xs">الخطة جاهزة للتنفيذ المحلي.</p>
          <Button
            size="sm"
            className="w-full h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white border-0 gap-1"
            disabled={isLoading}
            onClick={() => void executeRun()}
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            تنفيذ
          </Button>
        </div>
      )}

      {/* Running state */}
      {status === "running" && (
        <div className="px-4 py-3 flex items-center gap-2 text-slate-400 text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
          <span>جارٍ التنفيذ…</span>
        </div>
      )}

      {/* Phase 10 — Failure/Retry UX (Task #20) */}
      {status === "failed" && (
        <div className="px-4 py-3 space-y-2 border-t border-slate-700/40">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-red-300 text-xs font-medium">فشلت الخطة</p>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                {extractFailureReason(run) ??
                  "حدث خطأ غير متوقع. لم تتأثر أي بيانات خارجية."}
              </p>
              {/* Only show external-effect warning if sideEffects may have occurred */}
              {verificationStatus === "INCONCLUSIVE" && (
                <p className="text-yellow-400 text-[11px]">
                  ⚠️ لا يمكن التأكد من حالة التنفيذ — تحقق يدوياً قبل إعادة المحاولة.
                </p>
              )}
            </div>
          </div>
          {canRetry && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs border-slate-600 text-slate-300 hover:bg-slate-700 gap-1"
              disabled={isLoading}
              onClick={() => void retryRun()}
            >
              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              إعادة المحاولة بأمان
            </Button>
          )}
        </div>
      )}

      {/* Reconcile section */}
      {canReconcile && (
        <div className="px-4 py-3 space-y-2">
          <p className="text-slate-400 text-xs">اكتملت المعالجة — انشر النتائج في المحادثة.</p>
          <Button
            size="sm"
            className="w-full h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white border-0 gap-1"
            disabled={isLoading}
            onClick={() => void reconcileRun()}
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            نشر النتائج
          </Button>
        </div>
      )}

      {/* Receipt summary (after reconciliation) */}
      {receipt && status === "completed" && !aiCompletion && receipt.aggregatedOutput && typeof receipt.aggregatedOutput === "object" && (
        <div className="px-4 py-3 border-t border-slate-700/40">
          <p className="text-slate-400 text-xs mb-1">
            ✅ {receipt.completedNodes}/{receipt.nodeCount} خطوات —{" "}
            {receipt.status === "verified" ? "تم التحقق" : "جزئي"}
          </p>
          {Object.entries(receipt.aggregatedOutput).slice(0, 2).map(([key, val]) => {
            const output = val as Record<string, unknown>;
            return (
              <div key={key} className="text-slate-500 text-[11px]">
                {output.sum !== undefined && (
                  <span>
                    المجموع: <strong className="text-slate-300">{String(output.sum)}</strong>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the AI completion text from the aggregated run output.
 * Returns the first non-empty openai-chat completion found.
 */
function extractAiCompletion(
  aggregatedOutput?: Record<string, unknown>,
): string | null {
  if (!aggregatedOutput) return null;
  for (const val of Object.values(aggregatedOutput)) {
    if (val && typeof val === "object") {
      const node = val as Record<string, unknown>;
      if (node.kind === "openai-chat" && typeof node.completion === "string" && node.completion.length > 0) {
        return node.completion;
      }
      // Also handle nested result objects
      if (node.result && typeof node.result === "object") {
        const nested = node.result as Record<string, unknown>;
        if (nested.kind === "openai-chat" && typeof nested.completion === "string") {
          return nested.completion;
        }
      }
    }
  }
  return null;
}

type ResearchSource = { title: string; url: string; snippet: string; domain: string };
type GeneratedImage = { id: string; url: string | null; prompt: string; sourceCount: number };

function outputValues(aggregatedOutput?: Record<string, unknown>): Record<string, unknown>[] {
  if (!aggregatedOutput) return [];
  const values: Record<string, unknown>[] = [];
  for (const value of Object.values(aggregatedOutput)) {
    if (value && typeof value === "object") {
      values.push(value as Record<string, unknown>);
      const nested = (value as Record<string, unknown>).result;
      if (nested && typeof nested === "object") values.push(nested as Record<string, unknown>);
    }
  }
  return values;
}

function extractResearchSources(aggregatedOutput?: Record<string, unknown>): ResearchSource[] {
  const seen = new Set<string>();
  return outputValues(aggregatedOutput).flatMap((output) => {
    const candidates = Array.isArray(output.sources)
      ? output.sources
      : Array.isArray(output.selectedEvidence)
        ? output.selectedEvidence
        : Array.isArray(output.results)
          ? output.results
          : [];
    return candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const url = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
      if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
      seen.add(url);
      let domain = typeof item.domain === "string" ? item.domain : "web";
      try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* validated above */ }
      return [{
        title: typeof item.title === "string" ? item.title : domain,
        url,
        snippet: typeof item.snippet === "string" ? item.snippet : "",
        domain,
      }];
    });
  }).slice(0, 8);
}

function extractGeneratedImages(aggregatedOutput?: Record<string, unknown>): GeneratedImage[] {
  const seen = new Set<string>();
  return outputValues(aggregatedOutput).flatMap((output) => {
    const candidates = Array.isArray(output.images) ? output.images : [];
    return candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const id = typeof item.artifactId === "string" ? item.artifactId : typeof item.objectPath === "string" ? item.objectPath : "";
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const url =
        typeof item.renderPath === "string" && item.renderPath.startsWith("/api/runtime/generated-image/")
          ? item.renderPath
          : typeof item.renderUrl === "string" && /^https:\/\//i.test(item.renderUrl)
            ? item.renderUrl
            : null;
      const lineage = item.lineage;
      const selectedSources = lineage && typeof lineage === "object"
        ? ((lineage as Record<string, unknown>).research as Record<string, unknown> | undefined)?.selectedSourceReferences
        : undefined;
      return [{
        id,
        url,
        prompt: typeof item.prompt === "string" ? item.prompt : "",
        sourceCount: Array.isArray(selectedSources) ? selectedSources.length : 0,
      }];
    });
  }).slice(0, 4);
}

/**
 * Extract a human-readable failure reason from run events.
 */
function extractFailureReason(
  run: { events?: Array<{ type: string; data?: unknown; payload?: unknown }> } | undefined,
): string | null {
  if (!run?.events) return null;
  const failEvent = [...(run.events ?? [])]
    .reverse()
    .find((e) => e.type === "DAG_NODE_FAILED" || e.type === "RUN_FAILED");
  const eventData = failEvent?.data ?? failEvent?.payload;
  if (!eventData || typeof eventData !== "object") return null;
  const payload = eventData as Record<string, unknown>;
  const summary = payload.summary ?? payload.error ?? payload.message;
  return typeof summary === "string" ? summary.slice(0, 200) : null;
}
