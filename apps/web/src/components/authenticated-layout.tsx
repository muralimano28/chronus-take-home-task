import React from "react"
import { Navigate } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth-context"
import { ThemeToggle } from "@/lib/theme-context"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  Separator,
} from "@chronus/ui"

interface AuthenticatedLayoutProps {
  title?: string
  description?: string
  children: React.ReactNode
}

export function AuthenticatedLayout({
  title,
  description,
  children,
}: AuthenticatedLayoutProps) {
  const { user } = useAuth()

  if (!user) {
    return <Navigate to="/" replace />
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        {/* Top Header with Sidebar Trigger and Global Controls */}
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 backdrop-blur px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            {title && (
              <div className="flex flex-col">
                <h1 className="text-sm font-semibold tracking-tight text-foreground leading-tight">
                  {title}
                </h1>
                {description && (
                  <p className="text-[11px] text-muted-foreground leading-tight hidden sm:block">
                    {description}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
