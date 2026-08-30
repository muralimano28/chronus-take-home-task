import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  Button, Avatar, AvatarImage, AvatarFallback,
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose, toast,
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue
} from "@chronus/ui";
import { Loader2, AlertCircle, Calendar } from "lucide-react";
import { Mentor } from "./mentors-list";
import { Slot } from "./book-session-sheet";
import { formatDateInTimezone, formatTimeInTimezone } from "@chronus/utils";

// Need to refactor these

export function RescheduleSessionSheet({
  bookingId,
  open,
  onOpenChange,
  onSuccess
}: {
  bookingId: string,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSuccess?: () => void
}) {
  const { user } = useAuth();
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [mentorsLoading, setMentorsLoading] = useState(false);

  const [selectedMentorId, setSelectedMentorId] = useState<string | null>(null);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setMentorsLoading(true);
      // TODO: We will allow searching for mentors in future iterations
      api.get<{ data: Mentor[] }>("/mentors?limit=100")
        .then(res => {
          const availableMentors = user
            ? res.data.data.filter(m => m.userId !== user.userId && m.membershipId !== user.membershipId)
            : res.data.data;
          setMentors(availableMentors);
        })
        .catch(err => {
          console.error("Failed to fetch mentors:", err);
          setError(err.message || "Failed to load mentors.");
        })
        .finally(() => setMentorsLoading(false));
    } else {
      setMentors([]);
      setSlots([]);
      setSelectedMentorId(null);
      setSelectedSlotId(null);
      setError(null);
      setIsRescheduling(false);
      idempotencyKeyRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (selectedMentorId) {
      setSlotsLoading(true);
      setError(null);
      setSelectedSlotId(null);
      api.get<Slot[]>(`/mentors/${selectedMentorId}/slots`)
        .then(res => setSlots(res.data))
        .catch(err => {
          console.error("Failed to fetch slots:", err);
          setError(err.message || "Failed to load slots.");
        })
        .finally(() => setSlotsLoading(false));
    }
  }, [selectedMentorId]);

  const handleConfirmReschedule = () => {
    if (!selectedSlotId) return;
    setIsRescheduling(true);

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    api.post(`/bookings/${bookingId}/reschedule`, { newSlotId: selectedSlotId }, {
      headers: {
        "Idempotency-Key": idempotencyKeyRef.current,
      },
    })
      .then(() => {
        toast.success("Booking Rescheduled", {
          description: "Your session has been successfully rescheduled.",
        });
        onOpenChange(false);
        onSuccess?.();
      })
      .catch(err => {
        console.error("Reschedule error:", err);
        toast.error("Reschedule Failed", {
          description: err.message || "Failed to reschedule your booking. Please try again.",
        });
      })
      .finally(() => {
        setIsRescheduling(false);
      });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md border-border bg-card flex flex-col">
        <SheetHeader className="text-left">
          <SheetTitle className="text-xl text-foreground">Reschedule Session</SheetTitle>
          <SheetDescription className="text-muted-foreground">
            Select a mentor and pick a new time slot to reschedule your session.
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex flex-col gap-2 shrink-0">
            <h5 className="font-medium text-sm text-foreground">1. Select a Mentor</h5>
            {mentorsLoading ? (
              <div className="flex justify-center items-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              <Select value={selectedMentorId || undefined} onValueChange={setSelectedMentorId}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Choose a mentor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {mentors.map(mentor => (
                      <SelectItem key={mentor.membershipId} value={mentor.membershipId}>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${mentor.name}`} />
                            <AvatarFallback>{mentor.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          {mentor.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0 pt-4 border-t border-border/50">
            <h5 className="font-medium text-sm text-foreground mb-3 shrink-0">
              2. Select Available Slot
            </h5>

            {!selectedMentorId ? (
              <div className="p-10 text-center border border-dashed border-border/60 rounded-xl bg-background text-muted-foreground text-sm flex-1 flex items-center justify-center">
                Select a mentor first to see available slots.
              </div>
            ) : slotsLoading ? (
              <div className="flex-1 flex justify-center items-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 p-4 text-sm rounded-xl border border-destructive/20 bg-destructive/5 text-destructive shrink-0">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : slots.length === 0 ? (
              <div className="p-10 text-center border border-dashed border-border/60 rounded-xl bg-background text-muted-foreground text-sm flex-1 flex items-center justify-center">
                No slots available for this mentor.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 overflow-y-auto pr-2 pb-2">
                {slots.map((slot) => {
                  const start = new Date(slot.startTime);
                  const end = new Date(slot.endTime);

                  const isSelected = selectedSlotId === slot.id;
                  return (
                    <div
                      key={slot.id}
                      onClick={() => setSelectedSlotId(slot.id)}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all duration-200 ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/40 hover:bg-muted/30 bg-card"}`}
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between">
                          <div className="flex flex-col gap-0.5">
                            <span className={`font-semibold text-sm ${isSelected ? "text-primary" : "text-foreground"}`}>
                              {formatTimeInTimezone(start, userTimezone)} - {formatTimeInTimezone(end, userTimezone)} ({userTimezone})
                            </span>
                            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDateInTimezone(start, userTimezone)}
                            </span>
                          </div>
                        </div>
                        {user?.timezone && (
                          <div className={`flex items-start justify-between pt-2.5 border-t ${isSelected ? "border-primary/15" : "border-border/60"}`}>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs font-medium text-foreground/80">
                                {formatTimeInTimezone(start, user.timezone)} - {formatTimeInTimezone(end, user.timezone)} ({user.timezone})
                              </span>
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDateInTimezone(start, user.timezone)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="mt-auto flex flex-col gap-2 sm:flex-col sm:space-x-0 pt-4 border-t border-border/50 shrink-0">
          <Button
            className="w-full"
            disabled={!selectedSlotId || isRescheduling}
            onClick={handleConfirmReschedule}
          >
            {isRescheduling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Rescheduling...
              </>
            ) : (
              "Confirm Reschedule"
            )}
          </Button>
          <SheetClose asChild>
            <Button variant="outline" className="w-full" disabled={isRescheduling}>Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
