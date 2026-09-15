import { useForm } from "react-hook-form";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  getListRuntimeConversationsQueryKey,
  useGetRuntimeOverview,
  useCreateRuntimeConversation,
  useDecideRuntimeExecutionProposalApproval,
  useListRuntimeConversations,
  useRouteRuntimeConversationTurn,
  getGetRuntimeOverviewQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Activity, Clock, CheckCircle2, AlertTriangle, ArrowRight, Terminal, MessageCircle, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { formatDate } from "@/lib/format";
import { formatStatus, getStatusVariant } from "@/lib/status";

const taskSchema = z.object({
  goal: z.string().min(3, "Goal must be at least 3 characters").max(4000),
});

export default function Home() {
  const queryClient = useQueryClient();
  const { data: overview, isLoading: overviewLoading } = useGetRuntimeOverview();
  const { data: conversationList, isLoading: conversationsLoading } =
    useListRuntimeConversations({
      query: {
        queryKey: getListRuntimeConversationsQueryKey(),
        refetchInterval: 10_000,
      },
    });
  const createConversation = useCreateRuntimeConversation();
  const routeTurn = useRouteRuntimeConversationTurn();
  const decideProposalApproval = useDecideRuntimeExecutionProposalApproval();
  const activeConversation = conversationList?.conversations[0];
  const [intentNotice, setIntentNotice] = useState<{
    label: string;
    status: string;
    missingInputs: string[];
    requiredCapabilities: string[];
    proposals: Array<{
      id: string;
      capabilityId: string | null;
      status: string;
      approvalStatus: string | null;
    }>;
    dag: Array<{ nodeKey: string; status: string }>;
  } | null>(null);

  const form = useForm<z.infer<typeof taskSchema>>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      goal: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof taskSchema>) => {
    try {
      const conversation =
        activeConversation ??
        (await createConversation.mutateAsync({
          data: { title: values.goal.slice(0, 80) },
        }));
      const turn = await routeTurn.mutateAsync({
        conversationId: conversation.id,
        data: { content: values.goal },
      });
      if ("intent" in turn.output) {
        setIntentNotice({
          label: turn.output.label,
          status: turn.output.run?.status ?? "not_persisted",
          missingInputs: turn.output.intent.missingInputs,
          requiredCapabilities: turn.output.intent.requiredCapabilities,
          proposals: turn.output.proposals.map((proposal) => ({
            id: proposal.id,
            capabilityId: proposal.capabilityId,
            status: proposal.status,
            approvalStatus: proposal.approval?.status ?? null,
          })),
          dag: (turn.output.run?.dag ?? []).map((node) => ({
            nodeKey: node.nodeKey,
            status: node.status,
          })),
        });
      } else {
        setIntentNotice(null);
      }
      queryClient.invalidateQueries({ queryKey: getGetRuntimeOverviewQueryKey() });
      queryClient.invalidateQueries({
        queryKey: getListRuntimeConversationsQueryKey(),
      });
      form.reset();
    } catch (error) {
      form.setError("goal", {
        message:
          error instanceof Error
            ? error.message
            : "تعذر حفظ رسالتك في المحادثة.",
      });
    }
  };

  const decideProposal = async (proposalId: string, decision: "approve" | "reject") => {
    try {
      const proposal = await decideProposalApproval.mutateAsync({
        proposalId,
        data: { decision },
      });
      setIntentNotice((current) =>
        current
          ? {
              ...current,
              proposals: current.proposals.map((item) =>
                item.id === proposal.id
                  ? {
                      ...item,
                      status: proposal.status,
                      approvalStatus: proposal.approval?.status ?? null,
                    }
                  : item,
              ),
            }
          : current,
      );
    } catch (error) {
      form.setError("goal", {
        message: error instanceof Error ? error.message : "تعذر تسجيل قرار الموافقة.",
      });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Left Column: Command Entry */}
      <div className="lg:col-span-1 space-y-6">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="font-mono text-sm uppercase tracking-widest text-primary flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              New Objective
            </CardTitle>
            <CardDescription>
              Initialize a new runtime task with a natural language goal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="goal" className="sr-only">Goal</Label>
                <Textarea
                  id="goal"
                  placeholder="Define the objective sequence..."
                  className="min-h-[160px] font-mono text-sm resize-none border-primary/20 focus-visible:ring-primary"
                  data-testid="input-goal"
                  {...form.register("goal")}
                />
                {form.formState.errors.goal && (
                  <p className="text-sm font-medium text-destructive" data-testid="text-error-goal">
                    {form.formState.errors.goal.message}
                  </p>
                )}
              </div>
              <Button 
                type="submit" 
                className="w-full font-mono uppercase tracking-widest"
                disabled={routeTurn.isPending || createConversation.isPending}
                data-testid="button-submit-task"
              >
                {routeTurn.isPending || createConversation.isPending ? (
                  <span className="flex items-center gap-2">
                    <Activity className="h-4 w-4 animate-spin" />
                    جاري المعالجة...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Play className="h-4 w-4" />
                    أرسل إلى جاسم
                  </span>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Right Column: Telemetry & Recent Tasks */}
      <div className="lg:col-span-2 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            title="Total Sequences" 
            value={overview?.total} 
            loading={overviewLoading} 
            icon={<Activity className="h-4 w-4 text-primary" />} 
          />
          <StatCard 
            title="Awaiting Input" 
            value={overview?.awaitingInput} 
            loading={overviewLoading}
            icon={<Clock className="h-4 w-4 text-warning" />} 
          />
          <StatCard 
            title="Needs Approval" 
            value={overview?.awaitingApproval} 
            loading={overviewLoading}
            icon={<AlertTriangle className="h-4 w-4 text-destructive" />} 
          />
          <StatCard 
            title="Completed" 
            value={overview?.completed} 
            loading={overviewLoading}
            icon={<CheckCircle2 className="h-4 w-4 text-success" />} 
          />
        </div>

        <Card>
          <CardHeader className="border-b border-border pb-4 mb-4">
            <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center justify-between">
              <span>Active Runtime Telemetry</span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overviewLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : overview?.recent && overview.recent.length > 0 ? (
              <div className="space-y-3">
                {overview.recent.map((task) => (
                  <Link 
                    key={task.id} 
                    href={`/tasks/${task.id}`}
                    className="block group"
                    data-testid={`link-task-${task.id}`}
                  >
                    <div className="border border-border p-4 transition-colors hover:border-primary/50 hover:bg-primary/5 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/20 group-hover:bg-primary transition-colors" />
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs text-muted-foreground truncate max-w-[120px]">
                              {task.id}
                            </span>
                            <Badge variant={getStatusVariant(task.status)}>
                              {formatStatus(task.status)}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">
                            {task.goal}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground shrink-0">
                          <span>{formatDate(task.updatedAt)}</span>
                          <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all translate-x-[-10px] group-hover:translate-x-0" />
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border border-dashed border-border bg-muted/50">
                <Terminal className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground font-mono uppercase tracking-wider">
                  No active sequences found
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-primary/15 bg-card/70">
          <CardHeader className="border-b border-border pb-4 mb-4">
            <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              Main Conversation
            </CardTitle>
            <CardDescription>
              المحادثة محفوظة على الخادم وتُستأنف عبر العملاء المصرح لهم.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {conversationsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !activeConversation ? (
              <div className="text-center py-8 border border-dashed border-border bg-muted/30">
                <MessageCircle className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">ابدأ محادثة جديدة من حقل الهدف.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium truncate">{activeConversation.title || "محادثة جاسم"}</p>
                  <Badge variant="secondary">{activeConversation.messages.length} رسائل</Badge>
                </div>
                {activeConversation.messages.slice(-3).map((message) => (
                  <div
                    key={message.id}
                    className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {message.role}
                    </span>
                    <p className="mt-1 line-clamp-2">{message.content}</p>
                  </div>
                ))}
                {activeConversation.bubbles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {activeConversation.bubbles.map((bubble) => (
                      <Badge key={bubble.id} variant="outline" className="gap-1">
                        <Sparkles className="h-3 w-3 text-primary" />
                        {bubble.title}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
        {intentNotice ? (
          <Card className="border-warning/30 bg-warning/5" data-testid="runtime-intent-notice">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                نية تنفيذ محفوظة — {formatStatus(intentNotice.status)}
              </CardTitle>
              <CardDescription>{intentNotice.label}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>لم يُنفذ جاسم أي أثر خارجي.</p>
              {intentNotice.missingInputs.length > 0 ? (
                <p>المعلومات المطلوبة: {intentNotice.missingInputs.join("، ")}</p>
              ) : null}
              {intentNotice.requiredCapabilities.length > 0 ? (
                <p>القدرات المقترحة: {intentNotice.requiredCapabilities.join("، ")}</p>
              ) : null}
              {intentNotice.dag.length > 0 ? (
                <div className="rounded-md border border-border/70 bg-background/40 p-3 space-y-2">
                  <p className="font-medium">حالة خطوات العمل</p>
                  {intentNotice.dag.map((node) => (
                    <div key={node.nodeKey} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono">{node.nodeKey}</span>
                      <Badge variant="outline">
                        {node.status === "PENDING"
                          ? "قيد الانتظار"
                          : node.status === "READY"
                            ? "جاهزة للتنفيذ"
                            : node.status === "CLAIMED" || node.status === "RUNNING"
                              ? "قيد التنفيذ"
                              : node.status === "WAITING"
                                ? "بانتظار معلومات أو موافقة"
                                : node.status === "RETRY_SCHEDULED"
                                  ? "ستتم إعادة المحاولة"
                                  : node.status === "COMPLETED"
                                    ? "مكتملة محليًا"
                                    : node.status === "FAILED"
                                      ? "فشلت"
                                      : node.status === "BLOCKED"
                                        ? "متوقفة"
                                        : "ملغاة"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : null}
              {intentNotice.proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-md border border-border/70 bg-background/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      اقتراح تنفيذ: {proposal.capabilityId ?? "قدرة غير محددة"}
                    </span>
                    <Badge variant={proposal.status === "blocked" ? "destructive" : "secondary"}>
                      {proposal.status === "awaiting_approval"
                        ? "بانتظار الموافقة"
                        : proposal.status === "authorized"
                          ? "مصرّح، غير منفّذ"
                          : proposal.status === "awaiting_input"
                            ? "بانتظار معلومات"
                            : proposal.status === "blocked"
                              ? "محجوب"
                              : proposal.status}
                    </Badge>
                  </div>
                  {proposal.approvalStatus === "pending" ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => decideProposal(proposal.id, "approve")}
                        disabled={decideProposalApproval.isPending}
                      >
                        موافقة
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decideProposal(proposal.id, "reject")}
                        disabled={decideProposalApproval.isPending}
                      >
                        رفض
                      </Button>
                    </div>
                  ) : null}
                  {proposal.status === "authorized" ? (
                    <p>تمت الموافقة على التفاصيل الحالية فقط؛ لا يوجد تنفيذ فعلي في هذه المرحلة.</p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function StatCard({ title, value, loading, icon }: { title: string, value?: number, loading: boolean, icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col justify-between h-full gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase text-muted-foreground tracking-wider">{title}</span>
          {icon}
        </div>
        <div>
          {loading ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <span className="text-2xl font-bold font-mono tracking-tighter" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
              {value ?? 0}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

