import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  toast
} from "@chronus/ui";

interface CancelBookingDialogProps {
  bookingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CancelBookingDialog({ bookingId, open, onOpenChange, onSuccess }: CancelBookingDialogProps) {
  const [isCancelling, setIsCancelling] = useState(false);
  const idempotencyKeyRef = useRef<string>();

  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = crypto.randomUUID();
    } else {
      idempotencyKeyRef.current = undefined;
    }
  }, [open]);

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!bookingId || isCancelling) return;

    setIsCancelling(true);
    api.post(`/bookings/${bookingId}/cancel`, undefined, {
      headers: {
        "Idempotency-Key": idempotencyKeyRef.current,
      },
    })
      .then(() => {
        toast.success("Booking cancelled successfully");
        onOpenChange(false);
        onSuccess();
      })
      .catch(() => {
        toast.error("Failed to cancel booking");
      })
      .finally(() => setIsCancelling(false));
  };

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && !isCancelling && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Booking</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel this booking? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>No, keep it</AlertDialogCancel>
          <AlertDialogAction
            className="bg-background border text-destructive border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
            disabled={isCancelling}
            onClick={handleCancel}
          >
            {isCancelling ? "Cancelling..." : "Yes, cancel"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
