import { Link, useLocation } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeMenuItems } from '@/components/theme-menu-items'
import { useAuth } from '@/lib/auth'
import {
  HomeIcon,
  UsersIcon,
  Grid,
  ShoppingCart,
  ReceiptText,
  PackageIcon,
  ScissorsIcon,
  ContactIcon,
  ChevronsUpDownIcon,
  LogInIcon,
  LogOutIcon,
  SunIcon,
} from 'lucide-react'

type NavItem = {
  to:
    | '/'
    | '/dashboard'
    | '/orders'
    | '/customers'
    | '/inventory'
    | '/invoices'
    | '/users'
  label: string
  icon: typeof HomeIcon
  exact?: boolean
}

const navItems: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon, exact: true },
  { to: '/dashboard', label: 'Dashboard', icon: Grid, exact: true },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/customers', label: 'Customers', icon: ContactIcon },
  { to: '/inventory', label: 'Inventory', icon: PackageIcon },
  { to: '/invoices', label: 'Invoices', icon: ReceiptText },
  { to: '/users', label: 'Users', icon: UsersIcon },
]

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  const initials =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return initials.map((part) => part[0].toUpperCase()).join('')
}

function UserMenu() {
  const { isAuthenticated, user, signOut } = useAuth()

  if (!isAuthenticated || !user) {
    return (
      <SidebarMenuButton
        render={<Link to="/" search={{ redirect: '/dashboard' }} />}
      >
        <LogInIcon />
        <span>Sign in</span>
      </SidebarMenuButton>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
        <Avatar className="size-8 rounded-xl">
          <AvatarImage src={user.avatarUrl} alt={user.name} />
          <AvatarFallback className="rounded-xl">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs text-sidebar-foreground/60">
            {user.email}
          </span>
        </div>
        <ChevronsUpDownIcon className="ms-auto group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64">
        <div className="flex items-center gap-2 px-2 py-1.5 text-start text-sm">
          <Avatar className="size-8 rounded-xl">
            <AvatarImage src={user.avatarUrl} alt={user.name} />
            <AvatarFallback className="rounded-xl">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 leading-tight">
            <span className="truncate font-medium">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SunIcon />
            Appearance
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeMenuItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={signOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppSidebar() {
  const { pathname } = useLocation()

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarHeader className="px-2">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-xl px-1 py-1.5 group-data-[collapsible=icon]:justify-center"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ScissorsIcon className="size-4" />
            </span>
            <span className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
              <span className="font-heading text-sm font-semibold tracking-normal">
                Fabric Sync
              </span>
              <span className="text-xs text-sidebar-foreground/60">
                Tailoring workspace
              </span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarMenu>
          {navItems.map(({ to, label, icon: Icon, exact }) => {
            const isActive = exact
              ? pathname === to
              : pathname === to || pathname.startsWith(`${to}/`)

            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  isActive={isActive}
                  render={<Link to={to} />}
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
