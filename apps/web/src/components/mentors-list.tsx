import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Avatar, AvatarImage, AvatarFallback } from "@chronus/ui";
import { Users, Loader2, AlertCircle, Globe } from "lucide-react";
import { BookSessionSheet } from "./book-session-sheet";

export interface Mentor {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export function MentorsList() {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<Mentor[]>("/mentors")
      .then((res) => {
        if (active) {
          setMentors(res.data);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          console.error("Failed to fetch mentors:", err);
          setError(err.message || "Failed to load mentors.");
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

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12 mt-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm rounded-xl border border-destructive/20 bg-destructive/5 text-destructive mt-8">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center gap-2 pb-4 border-b border-border">
        <Users className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Available Mentors</h3>
      </div>

      {mentors.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-border bg-card/50 text-muted-foreground text-sm">
          No mentors available in your organization yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mentors.map((mentor) => (
            <div
              key={mentor.membershipId}
              className="flex flex-col gap-3 p-5 rounded-xl border border-border bg-card hover:bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${mentor.name}`} alt={mentor.name} />
                  <AvatarFallback>{mentor.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <div>
                  <h4 className="font-semibold text-foreground">{mentor.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{mentor.email}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 pt-3 border-t border-border/60">
                <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase text-secondary-foreground">
                  <Globe className="h-3 w-3" />
                  {mentor.timezone}
                </span>
                <BookSessionSheet mentor={mentor} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
