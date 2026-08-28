import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chronus/ui";
import { ChevronDown, User, LogIn, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: Index,
});

interface Organization {
  id: string;
  name: string;
}

interface UserData {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  timezone: string;
  isMentor: boolean;
  organization: Organization;
  createdAt: string;
  updatedAt: string;
}

interface HomeCardProps {
  users: UserData[];
  selectedUser: UserData | null;
  onSelectUser: (user: UserData) => void;
  onLogin: () => void;
  loading: boolean;
  error: string | null;
}

export function HomeCard({
  users,
  selectedUser,
  onSelectUser,
  onLogin,
  loading,
  error,
}: HomeCardProps) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="flex flex-col gap-2 pt-8 pb-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
            <User className="h-7 w-7" />
          </div>
          <div className="flex flex-col gap-2 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              Choose an Account
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground max-w-[280px] mx-auto">
              Select a user profile from the list below to continue to the system.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 px-8 pb-8">
          {error && (
            <div className="flex items-center gap-2 p-3.5 text-sm rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
              <AlertCircle className="h-4.5 w-4.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Select Profile
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={loading}
                  className="w-full flex items-center justify-between px-4 py-4 bg-muted hover:bg-muted/80 border border-border rounded-xl transition-all duration-200 text-foreground text-left text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring/25 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2.5">
                    {loading ? (
                      <Loader2 className="h-4.5 w-4.5 text-primary/70 animate-spin" />
                    ) : (
                      <User className="h-4.5 w-4.5 text-primary/70" />
                    )}
                    {loading
                      ? "Loading profiles..."
                      : selectedUser
                        ? selectedUser.name
                        : "Select a user..."}
                  </span>
                  {!loading && (
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[240px] rounded-xl border border-border bg-popover p-1.5 shadow-xl text-popover-foreground">
                {users.map((user) => (
                  <DropdownMenuItem
                    key={user.membershipId}
                    onClick={() => onSelectUser(user)}
                    className="flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg text-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer transition-colors"
                  >
                    <span className="font-medium text-sm flex items-center gap-1.5 w-full">
                      {user.name}
                      {user.isMentor && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider">
                          Mentor
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground font-normal">
                      {user.email} • {user.organization.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button onClick={onLogin} disabled={!selectedUser || loading}>
            <LogIn className="h-4 w-4" />
            Log In
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Index() {
  const { user, login, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserData[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<UserData[]>("/users")
      .then((res) => {
        if (active) {
          setUsers(res.data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          console.error("Error fetching users:", err);
          setError(err.message || "Failed to load profiles");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async () => {
    if (selectedUser) {
      try {
        setError(null);
        await login(selectedUser.userId, selectedUser.organization.id);
        navigate({ to: "/dashboard" });
      } catch (err: any) {
        console.error("Login request failed:", err);
        setError(err.message || "Login failed. Please try again.");
      }
    }
  };

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <HomeCard
      users={users}
      selectedUser={selectedUser}
      onSelectUser={setSelectedUser}
      onLogin={handleLogin}
      loading={loading || authLoading}
      error={error}
    />
  );
}
