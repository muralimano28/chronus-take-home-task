import { Link, useRouterState } from "@tanstack/react-router"
import {
  Home,
  CalendarCheck,
  Clock,
  LogOut,
  ChevronsUpDown,
  Sparkles,
  Building2,
  UserCheck,
  User as UserIcon,
  Globe
} from "lucide-react"

import { useAuth } from "@/lib/auth-context"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from "@chronus/ui"

export function AppSidebar() {
  const { user, logout } = useAuth()
  const { isMobile } = useSidebar()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  if (!user) return null

  const handleLogout = async () => {
    await logout()
  }

  return (
    <Sidebar collapsible="icon">
      {/* 1. Header with Organization & App Name */}
      <SidebarHeader className="border-b border-sidebar-border/60">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold tracking-tight">Chronus</span>
                <span className="truncate text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="size-3" />
                  {user.organizationName}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* 2. Navigation Items */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Home */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={currentPath === "/dashboard"}
                  tooltip="Home"
                >
                  <Link to="/dashboard">
                    <Home />
                    <span>Home</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* My Bookings */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={currentPath === "/bookings"}
                  tooltip="My Bookings"
                >
                  <Link to="/bookings">
                    <CalendarCheck />
                    <span>My Bookings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* My Slots (Mentors Only) */}
              {user.isMentor && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={currentPath === "/slots"}
                    tooltip="My Slots"
                  >
                    <Link to="/slots">
                      <Clock />
                      <span>My Slots</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* 3. Footer with User Profile and Logout Submenu */}
      <SidebarFooter className="border-t border-sidebar-border/60">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage
                      src={`https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`}
                      alt={user.name}
                    />
                    <AvatarFallback className="rounded-lg">{user.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold flex items-center gap-1.5">
                      {user.name}
                      {user.isMentor && (
                        <span className="rounded bg-primary/10 px-1 py-0.2 text-[9px] font-medium text-primary">
                          Mentor
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage
                        src={`https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`}
                        alt={user.name}
                      />
                      <AvatarFallback className="rounded-lg">{user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    <Building2 className="mr-2 h-4 w-4" />
                    <span>Org: {user.organizationName}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    <Globe className="mr-2 h-4 w-4" />
                    <span>{user.timezone}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                    {user.isMentor ? <UserCheck className="mr-2 h-4 w-4 text-primary" /> : <UserIcon className="mr-2 h-4 w-4" />}
                    <span>{user.isMentor ? "Role: Mentor" : "Role: Mentee"}</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer font-medium"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
