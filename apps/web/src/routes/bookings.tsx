import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  Button, Avatar, AvatarImage, AvatarFallback,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  Card
} from "@chronus/ui";
import { RescheduleSessionSheet } from "@/components/reschedule-session-sheet";
import { CancelBookingDialog } from "@/components/cancel-booking-dialog";
import { LogOut, MoreHorizontal, Globe, ArrowLeft, Loader2, AlertCircle, Calendar } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateInTimezone, formatTimeInTimezone } from "@/lib/date-utils";

export const Route = createFileRoute("/bookings")({
  component: BookingsPage,
});

interface Booking {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  slot: {
    id: string;
    startTime: string;
    endTime: string;
    mentor: {
      membershipId: string;
      userId: string;
      name: string;
      email: string;
      timezone: string;
    }
  }
}


function BookingsPage() {
  const { user, logout } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reschedulingBookingId, setReschedulingBookingId] = useState<string | null>(null);
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleLogout = async () => {
    await logout();
  };

  useEffect(() => {
    let active = true;
    api.get<Booking[]>("/bookings")
      .then(res => {
        if (active) {
          setBookings(res.data);
          setError(null);
        }
      })
      .catch(err => {
        if (active) {
          console.error("Failed to fetch bookings:", err);
          setError(err.message || "Failed to load bookings.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            My Bookings
          </h1>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <Link to="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors hidden sm:flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Back to Mentors
          </Link>
        </div>
        <div className="flex items-center gap-4">
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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Your Sessions</h2>
            <p className="text-muted-foreground mt-1">Manage your upcoming and past mentorship sessions.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-4 text-sm rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-20 rounded-xl border border-dashed border-border/60 bg-card/30">
            <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No bookings found</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6">You haven't scheduled any mentorship sessions yet.</p>
            <Link to="/dashboard">
              <Button>Find a Mentor</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {bookings.map((booking) => {
              const start = new Date(booking.slot.startTime);
              const end = new Date(booking.slot.endTime);
              const mentor = booking.slot.mentor;

              return (
                <Card key={booking.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 hover:bg-muted/40">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-12 w-12 border border-border/50">
                      <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${mentor.name}`} alt={mentor.name} />
                      <AvatarFallback>{mentor.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-base text-foreground">{mentor.name}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${booking.status === "ACTIVE"
                          ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "border border-destructive/30 bg-destructive/10 text-destructive"
                          }`}>
                          {booking.status}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1 mt-1">
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDateInTimezone(start, userTimezone)} | {formatTimeInTimezone(start, userTimezone)} - {formatTimeInTimezone(end, userTimezone)} (Local)
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Globe className="h-3 w-3" />
                          {formatDateInTimezone(start, mentor.timezone)} | {formatTimeInTimezone(start, mentor.timezone)} - {formatTimeInTimezone(end, mentor.timezone)} ({mentor.timezone})
                        </span>
                      </div>
                    </div>
                  </div>

                  {booking.status === "ACTIVE" && (
                    <div className="mt-4 sm:mt-0 flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onSelect={() => setReschedulingBookingId(booking.id)}
                          >
                            Reschedule session
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                            onSelect={() => setCancellingBookingId(booking.id)}
                          >
                            Cancel booking
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {reschedulingBookingId && (
        <RescheduleSessionSheet
          bookingId={reschedulingBookingId}
          open={!!reschedulingBookingId}
          onOpenChange={(isOpen) => !isOpen && setReschedulingBookingId(null)}
          onSuccess={() => {
            setLoading(true);
            api.get<Booking[]>("/bookings")
              .then(res => {
                setBookings(res.data);
                setError(null);
              })
              .finally(() => setLoading(false));
          }}
        />
      )}

      <CancelBookingDialog
        bookingId={cancellingBookingId}
        open={!!cancellingBookingId}
        onOpenChange={(isOpen) => !isOpen && setCancellingBookingId(null)}
        onSuccess={() => {
          setLoading(true);
          api.get<Booking[]>("/bookings")
            .then(res => {
              setBookings(res.data);
              setError(null);
            })
            .finally(() => setLoading(false));
        }}
      />
    </div>
  );
}
