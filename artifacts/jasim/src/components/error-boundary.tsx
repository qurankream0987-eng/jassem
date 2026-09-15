import React from "react";
import { Button } from "./ui/button";
import { Terminal } from "lucide-react";

interface Props {
  children: React.ReactNode;
  resetKey?: any;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-center border border-destructive bg-destructive/5 space-y-4">
          <Terminal className="w-10 h-10 text-destructive" />
          <h2 className="text-xl font-bold text-destructive font-mono uppercase tracking-widest">
            Runtime Error
          </h2>
          <pre className="text-sm font-mono bg-background p-4 border border-border text-left max-w-2xl overflow-auto max-h-[300px]">
            {this.state.error?.message}
          </pre>
          <Button 
            variant="outline" 
            onClick={() => this.setState({ hasError: false })}
            className="font-mono uppercase tracking-wider"
          >
            Attempt Recovery
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
