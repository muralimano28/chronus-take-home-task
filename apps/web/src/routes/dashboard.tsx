import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@chronus/ui";
import { LogOut } from "lucide-react";
import { MentorsList } from "@/components/mentors-list";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between shadow-sm">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <div className="flex items-center gap-4">
          <Link to="/bookings" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
            My Bookings
          </Link>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <span className="text-sm font-medium text-muted-foreground">
            Welcome, <span className="text-foreground font-semibold">{user.name}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="flex items-center gap-2 text-destructive border-destructive/20 hover:bg-destructive/5 hover:text-destructive cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </Button>
        </div>
      </header>
      <main className="flex-1 p-8 max-w-4xl mx-auto w-full">
        <MentorsList />
      </main>
    </div>
  );
}
