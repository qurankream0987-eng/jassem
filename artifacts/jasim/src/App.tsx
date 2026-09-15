import { ErrorBoundary } from "@/components/error-boundary";
import { Link, Route, Switch, useLocation } from "wouter";
import { Activity, Terminal } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHealthCheck } from "@workspace/api-client-react";
import Home from "@/pages/home";
import TaskDetail from "@/pages/task";
import NotFound from "@/pages/not-found";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const queryClient = new QueryClient();

function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: health } = useHealthCheck();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20 selection:text-primary">
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-mono font-bold tracking-tight text-primary transition-colors hover:text-primary/80" data-testid="link-home">
            <Terminal className="h-5 w-5" />
            <span>JASIM.RUNTIME</span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs font-mono font-medium text-muted-foreground">
            {health?.status === 'ok' ? (
              <span className="flex items-center gap-1.5 text-primary" data-testid="status-health-ok">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                SYS.ONLINE
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-destructive" data-testid="status-health-error">
                <Activity className="h-3 w-3" />
                SYS.ERR
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col p-4 md:p-6 max-w-[1400px] w-full mx-auto">
        {children}
      </main>
    </div>
  );
}

function Router() {
  return (
    <AppLayout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/tasks/:taskId" component={TaskDetail} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppLayout>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
