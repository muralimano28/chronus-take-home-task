import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "@/lib/theme-context";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "@chronus/ui";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <div className="min-h-screen">
          <Outlet />
          <Toaster />
        </div>
      </ThemeProvider>
    </AuthProvider>
  );
}
