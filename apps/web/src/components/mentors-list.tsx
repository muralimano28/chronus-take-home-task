import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Avatar, AvatarImage, AvatarFallback, Button } from "@chronus/ui";
import { Users, Loader2, AlertCircle, Globe, ChevronLeft, ChevronRight } from "lucide-react";
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

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PaginatedMentorsResponse {
  data: Mentor[];
  pagination: PaginationMeta;
}

export function MentorsList() {
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    total: 0,
    page: 1,
    limit: 6,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get<PaginatedMentorsResponse>(`/mentors?page=${page}&limit=6`)
      .then((res) => {
        if (active) {
          setMentors(res.data.data);
          setPagination(res.data.pagination);
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
  }, [page]);

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Available Mentors</h3>
        </div>
        {pagination.total > 0 && (
          <span className="text-xs text-muted-foreground">
            Showing {mentors.length} of {pagination.total} mentors
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 p-4 text-sm rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : mentors.length === 0 ? (
        <div className="text-center py-12 rounded-xl border border-border bg-card/50 text-muted-foreground text-sm">
          No mentors available in your organization yet.
        </div>
      ) : (
        <>
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

          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-border/60">
              <span className="text-xs text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1 || loading}
                  className="flex items-center gap-1 h-8 px-3 text-xs"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages || loading}
                  className="flex items-center gap-1 h-8 px-3 text-xs"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
