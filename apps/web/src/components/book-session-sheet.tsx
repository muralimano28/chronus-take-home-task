import { useState, useRef } from "react";
import { api } from "@/lib/api";
import {
  Button, Avatar, AvatarImage, AvatarFallback,
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter, SheetClose, toast
} from "@chronus/ui";
import { Loader2, AlertCircle, Calendar, Globe } from "lucide-react";
import { Mentor } from "./mentors-list";
import { formatDateInTimezone, formatTimeInTimezone } from "@chronus/utils";

export interface Slot {
  id: string;
  organizationId: string;
  mentorId: string;
  startTime: string;
  endTime: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}


export function BookSessionSheet({ mentor }: { mentor: Mentor }) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const idempotencyKeyRef = useRef<string | null>(null);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setLoading(true);
      api.get<Slot[]>(`/mentors/${mentor.membershipId}/slots`)
        .then(res => setSlots(res.data))
        .catch(err => {
          console.error("Failed to fetch slots:", err);
          setError(err.message || "Failed to load slots.");
        })
        .finally(() => setLoading(false));
    } else {
      setSlots([]);
      setError(null);
      setSelectedSlotId(null);
      setIsBooking(false);
      idempotencyKeyRef.current = null;
    }
  };

  const handleConfirmBooking = () => {
    if (!selectedSlotId) return;
    setIsBooking(true);

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    api.post("/bookings", { slotId: selectedSlotId }, {
      headers: {
        "Idempotency-Key": idempotencyKeyRef.current,
      },
    })
      .then(() => {
        toast.success("Booking Confirmed", {
          description: `Your session with ${mentor.name} has been successfully scheduled.`,
        });
        handleOpenChange(false);
      })
      .catch(err => {
        console.error("Booking error:", err);
        toast.error("Booking Failed", {
          description: err.message || "Failed to confirm your booking. Please try again.",
        });
      })
      .finally(() => {
        setIsBooking(false);
      });
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" >
          Book a session
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md border-border bg-card flex flex-col">
        <SheetHeader className="text-left">
          <SheetTitle className="text-xl text-foreground">Book a Session with {mentor.name}</SheetTitle>
          <SheetDescription className="text-muted-foreground">
            Select an available time slot below to schedule your mentorship session.
          </SheetDescription>
        </SheetHeader>
        <div className="py-6 flex flex-col gap-4 flex-1 overflow-hidden">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50 border border-border shrink-0">
            <Avatar className="h-14 w-14 border border-border/50 shadow-sm">
              <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${mentor.name}`} alt={mentor.name} />
              <AvatarFallback>{mentor.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <h4 className="font-semibold text-foreground text-base">{mentor.name}</h4>
              <p className="text-sm text-muted-foreground">{mentor.email}</p>
              <p className="text-xs text-muted-foreground mt-1 font-medium bg-background border border-border inline-flex px-2 py-0.5 rounded-md">{mentor.timezone}</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <h5 className="font-medium text-sm text-foreground mb-3 shrink-0">Available Slots</h5>
            {loading ? (
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
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all duration-200 ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border hover:border-primary/40 hover:bg-muted/30 bg-card"}`}
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between">
                          <div className="flex flex-col gap-0.5">
                            <span className={`font-semibold text-sm ${isSelected ? "text-primary" : "text-foreground"}`}>
                              {formatTimeInTimezone(start, userTimezone)} - {formatTimeInTimezone(end, userTimezone)}
                            </span>
                            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDateInTimezone(start, userTimezone)} (Your time)
                            </span>
                          </div>
                        </div>
                        <div className={`flex items-start justify-between pt-2.5 border-t ${isSelected ? "border-primary/15" : "border-border/60"}`}>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-foreground/80">
                              {formatTimeInTimezone(start, mentor.timezone)} - {formatTimeInTimezone(end, mentor.timezone)}
                            </span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Globe className="h-2.5 w-2.5" />
                              {formatDateInTimezone(start, mentor.timezone)} ({mentor.timezone})
                            </span>
                          </div>
                        </div>
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
            disabled={!selectedSlotId || isBooking}
            onClick={handleConfirmBooking}
          >
            {isBooking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              "Confirm Booking"
            )}
          </Button>
          <SheetClose asChild>
            <Button variant="outline" className="w-full" disabled={isBooking}>Cancel</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
