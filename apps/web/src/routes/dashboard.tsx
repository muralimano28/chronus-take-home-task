import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { MentorsList } from "@/components/mentors-list";
import { AuthenticatedLayout } from "@/components/authenticated-layout";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthenticatedLayout
      title="Find a Mentor"
      description={`Welcome back, ${user.name}`}
    >
      <div className="max-w-4xl mx-auto w-full">
        <MentorsList />
      </div>
    </AuthenticatedLayout>
  );
}
