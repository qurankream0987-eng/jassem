import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Terminal } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full text-center space-y-6">
      <div className="bg-muted p-4 border border-border">
        <Terminal className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tighter" data-testid="text-404-title">404</h1>
        <p className="text-muted-foreground font-mono uppercase text-sm tracking-widest" data-testid="text-404-desc">
          Sequence not found
        </p>
      </div>
      <Link href="/" data-testid="link-return-home">
        <Button variant="outline" className="font-mono uppercase tracking-wider">
          Return to Runtime
        </Button>
      </Link>
    </div>
  );
}