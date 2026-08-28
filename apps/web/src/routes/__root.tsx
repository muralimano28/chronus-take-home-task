import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider, ThemeToggle } from "@/lib/theme-context";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@chronus/ui";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <div className="relative min-h-screen">
          <header className="absolute top-4 right-4 z-50">
            <ThemeToggle />
          </header>
          <main>
            <Outlet />
          </main>
          <Toaster />
        </div>
      </ThemeProvider>
    </AuthProvider>
  );
}
