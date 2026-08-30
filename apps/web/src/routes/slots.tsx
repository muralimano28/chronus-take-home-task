import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { AuthenticatedLayout } from "@/components/authenticated-layout";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, Avatar, AvatarImage, AvatarFallback } from "@chronus/ui";
import { formatDateInTimezone, formatTimeInTimezone } from "@chronus/utils";
import { Clock, Calendar, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/slots")({
  component: SlotsPage,
});

interface MentorSlot {
  id: string;
  mentorId: string;
  startTime: string;
  endTime: string;
  status: "AVAILABLE" | "BOOKED";
  createdAt: string;
  booking?: {
    id: string;
    status: string;
    member: {
      userId: string;
      name: string;
      email: string;
      timezone: string;
    };
  } | null;
}

function SlotsPage() {
  const { user } = useAuth();
  const [slots, setSlots] = useState<MentorSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (!user || !user.isMentor) return;

    let active = true;
    api
      .get<MentorSlot[]>("/mentors/me/slots")
      .then((res) => {
        if (active) {
          setSlots(res.data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          console.error("Failed to fetch slots:", err);
          setError(err.message || "Failed to load slots.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  if (!user) {
    return <Navigate to="/" replace />;
  }

  // Only mentors can access /slots
  if (!user.isMentor) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AuthenticatedLayout
      title="My Availability Slots"
      description="Manage and review your published schedule and upcoming booked sessions"
    >
      <div className="max-w-4xl mx-auto w-full">
        {/* Header Stats / Overview */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Your Schedule</h2>
            <p className="text-muted-foreground mt-1">
              Slots are shown in your current location's timezone (
              <span className="font-semibold text-foreground">{userTimezone}</span>).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {slots.length} Total Slot(s)
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : slots.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">No Availability Slots</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-6">
              You haven't scheduled any open mentorship slots yet.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {slots.map((slot) => {
              const isBooked = slot.status === "BOOKED";
              return (
                <Card
                  key={slot.id}
                  className={`p-5 transition-all flex flex-col justify-between ${isBooked
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card hover:bg-muted/30"
                    }`}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${isBooked
                          ? "bg-primary/20 text-primary font-semibold"
                          : "bg-secondary text-secondary-foreground"
                          }`}
                      >
                        <Clock className="h-3 w-3" />
                        {isBooked ? "Booked" : "Available"}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateInTimezone(slot.startTime, userTimezone)}
                      </span>
                    </div>

                    <div className="mt-1">
                      <div className="text-base font-semibold text-foreground">
                        {formatTimeInTimezone(slot.startTime, userTimezone)} –{" "}
                        {formatTimeInTimezone(slot.endTime, userTimezone)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {user.timezone || "UTC"}: {formatTimeInTimezone(slot.startTime, user.timezone || "UTC")} –{" "}
                        {formatTimeInTimezone(slot.endTime, user.timezone || "UTC")}
                      </p>
                    </div>

                    {isBooked && slot.booking?.member && (
                      <div className="mt-3 pt-3 border-t border-primary/20 flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage
                            src={`https://api.dicebear.com/7.x/initials/svg?seed=${slot.booking.member.name}`}
                            alt={slot.booking.member.name}
                          />
                          <AvatarFallback>
                            {slot.booking.member.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="overflow-hidden">
                          <p className="text-xs font-semibold text-foreground truncate">
                            {slot.booking.member.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {slot.booking.member.email}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
