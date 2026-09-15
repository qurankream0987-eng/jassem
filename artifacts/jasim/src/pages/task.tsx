import { useParams } from "wouter";
import { 
  useGetRuntimeTask,
  useActOnRuntimeTask,
  getGetRuntimeTaskQueryKey,
  RuntimeTaskStatus,
  RuntimeActionStatus,
  RuntimeActionKind
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Activity, 
  Terminal, 
  Check, 
  X, 
  Clock,
  Database,
  ListTree,
  Play
} from "lucide-react";
import { formatDate } from "@/lib/format";
import { formatStatus, getStatusVariant } from "@/lib/status";

export default function TaskDetail() {
  const params = useParams();
  const taskId = params.taskId!;
  const queryClient = useQueryClient();
  const { data: task, isLoading } = useGetRuntimeTask(taskId, {
    query: {
      enabled: !!taskId,
      queryKey: getGetRuntimeTaskQueryKey(taskId),
      refetchInterval: (query) => {
        const currentStatus = query.state.data?.status;
        const isTerminal = currentStatus === RuntimeTaskStatus.completed || 
                          currentStatus === RuntimeTaskStatus.failed || 
                          currentStatus === RuntimeTaskStatus.blocked;
        return isTerminal ? false : 2000;
      }
    }
  });

  const actOnTask = useActOnRuntimeTask();
  const [actionInputMap, setActionInputMap] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Terminal className="h-10 w-10 text-destructive mb-4" />
        <h2 className="text-xl font-bold uppercase tracking-widest font-mono">Task Not Found</h2>
        <p className="text-muted-foreground mt-2">The requested runtime sequence does not exist or has been purged.</p>
      </div>
    );
  }

  const handleAction = (actionId: string, kind: RuntimeActionKind, value?: any) => {
    setActionError(null);
    actOnTask.mutate({
      taskId,
      data: {
        actionId,
        idempotencyKey: crypto.randomUUID(),
        ...(kind === RuntimeActionKind.provide_input ? { input: { value } } : {}),
        ...(kind === RuntimeActionKind.approve ? { approval: value as boolean } : {}),
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRuntimeTaskQueryKey(taskId) });
      },
      onError: (error) => {
        setActionError(error instanceof Error ? error.message : "The action could not be completed.");
      }
    });
  };

  const pendingActions = task.actions.filter(a => a.status === RuntimeActionStatus.pending || a.status === RuntimeActionStatus.ready);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header Profile */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row justify-between md:items-start gap-4">
            <div className="space-y-2 max-w-3xl">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-muted-foreground tracking-wider uppercase">Sequence {task.id.slice(0, 8)}</span>
                <Badge variant={getStatusVariant(task.status)} className="text-sm">
                  {formatStatus(task.status)}
                </Badge>
              </div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-task-goal">
                {task.goal}
              </h1>
              <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Created {formatDate(task.createdAt)}</span>
                <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> Updated {formatDate(task.updatedAt)}</span>
              </div>
            </div>
            {task.conversationId && (
              <Badge variant="outline" className="font-mono">
                Thread: {task.conversationId}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column: World State & Events */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* Action Required Area */}
          {pendingActions.length > 0 && (
            <Card className="border-warning border bg-warning/5">
              <CardHeader className="pb-3 border-b border-warning/10">
                <CardTitle className="text-sm font-mono uppercase tracking-widest text-warning flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Operator Intervention Required
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {actionError && (
                  <p
                    className="border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs text-destructive"
                    data-testid="text-action-error"
                  >
                    {actionError}
                  </p>
                )}
                {pendingActions.map(action => (
                  <div key={action.id} className="bg-background border border-border p-4">
                    <div className="font-medium mb-1">{action.label}</div>
                    <div className="text-sm text-muted-foreground mb-4 font-mono">
                      Type: {action.kind.toUpperCase()} | ID: {action.id}
                    </div>
                    
                    {action.kind === RuntimeActionKind.provide_input && (
                      <div className="space-y-3">
                        <Textarea 
                          placeholder="Provide required input..."
                          className="font-mono text-sm"
                          value={actionInputMap[action.id] || ''}
                          onChange={(e) => setActionInputMap(prev => ({...prev, [action.id]: e.target.value}))}
                          data-testid={`input-action-${action.id}`}
                        />
                        <Button 
                          onClick={() => handleAction(action.id, action.kind, actionInputMap[action.id])}
                          disabled={!actionInputMap[action.id] || actOnTask.isPending}
                          className="font-mono uppercase text-xs tracking-wider"
                          data-testid={`button-submit-${action.id}`}
                        >
                          Submit Input
                        </Button>
                      </div>
                    )}
                    
                    {action.kind === RuntimeActionKind.approve && (
                      <div className="flex gap-3">
                        <Button 
                          variant="default"
                          className="font-mono uppercase text-xs tracking-wider bg-success text-success-foreground hover:bg-success/90"
                          onClick={() => handleAction(action.id, action.kind, true)}
                          disabled={actOnTask.isPending}
                          data-testid={`button-approve-${action.id}`}
                        >
                          <Check className="w-4 h-4 mr-2" />
                          Approve
                        </Button>
                        <Button 
                          variant="destructive"
                          className="font-mono uppercase text-xs tracking-wider"
                          onClick={() => handleAction(action.id, action.kind, false)}
                          disabled={actOnTask.isPending}
                          data-testid={`button-reject-${action.id}`}
                        >
                          <X className="w-4 h-4 mr-2" />
                          Reject
                        </Button>
                      </div>
                    )}

                    {action.kind === RuntimeActionKind.execute && (
                      <Button 
                        variant="default"
                        className="font-mono uppercase text-xs tracking-wider"
                        onClick={() => handleAction(action.id, action.kind)}
                        disabled={actOnTask.isPending}
                        data-testid={`button-execute-${action.id}`}
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Confirm Execution
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* World State Viewer */}
          <Card className="overflow-hidden">
            <CardHeader className="bg-muted/50 border-b border-border pb-4">
              <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                <Database className="w-4 h-4" />
                World State
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                JSON representation of the accumulated task context
              </CardDescription>
            </CardHeader>
            <div className="bg-foreground text-background p-4 overflow-x-auto">
              <pre className="font-mono text-xs leading-relaxed" data-testid="text-world-state">
                {Object.keys(task.world).length === 0 
                  ? "// State uninitialized" 
                  : JSON.stringify(task.world, null, 2)}
              </pre>
            </div>
          </Card>
        </div>

        {/* Right Column: Event Log */}
        <div className="xl:col-span-1 space-y-6">
          <Card className="h-full max-h-[800px] flex flex-col">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
                <ListTree className="w-4 h-4" />
                Event Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto flex-1">
              <div className="relative p-6">
                <div className="absolute left-8 top-6 bottom-6 w-px bg-border"></div>
                <div className="space-y-6">
                  {task.events.map((event, i) => (
                    <div key={event.id} className="relative flex gap-4">
                      <div className="absolute left-[3px] w-2 h-2 rounded-full bg-primary ring-4 ring-background mt-1.5" />
                      <div className="pl-6 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold uppercase tracking-wider text-primary">
                            {formatStatus(event.type)}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatDate(event.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground/80 leading-snug" data-testid={`event-message-${event.id}`}>
                          {event.message}
                        </p>
                      </div>
                    </div>
                  ))}
                  {task.events.length === 0 && (
                    <div className="text-center font-mono text-xs text-muted-foreground">
                      No events recorded.
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
