import { canVisit, homePath } from '@/lib/permissions'
import { PermissionGuard } from '@/components/permission-guard'
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
import { accountSettingsUrl } from '@/lib/account-settings'
import { usePreferences } from '@/features/locations/hooks/use-default-location'
import { DefaultLocationMenu } from '@/features/locations/components/default-location-menu'
import {
  UsersIcon,
  ShoppingCart,
  ReceiptText,
  PackageIcon,
  ScissorsIcon,
  ContactIcon,
  ListChecksIcon,
  MapPinIcon,
  ShoppingBagIcon,
  GiftIcon,
  ChevronsUpDownIcon,
  LogInIcon,
  LogOutIcon,
  SettingsIcon,
  PaletteIcon,
  SunIcon,
  WrenchIcon,
} from 'lucide-react'

const navItems = [
  { to: '/invoices', label: 'Invoices', icon: ReceiptText },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/repairs', label: 'Repairs', icon: WrenchIcon },
  { to: '/customers', label: 'Customers', icon: ContactIcon },
  { to: '/inventory', label: 'Inventory', icon: PackageIcon },
  { to: '/products', label: 'Products', icon: ShoppingBagIcon },
  { to: '/gift-cards', label: 'Gift Cards', icon: GiftIcon },
  { to: '/locations', label: 'Locations', icon: MapPinIcon },
  {
    to: '/order-stages',
    label: 'Order Stages',
    icon: ListChecksIcon,
  },
  {
    to: '/design-options',
    label: 'Design Options',
    icon: PaletteIcon,
  },
  { to: '/users', label: 'Users', icon: UsersIcon },
] as const

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  const initials =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return initials.map((part) => part[0].toUpperCase()).join('')
}

function UserMenu() {
  const { isAuthenticated, user, signOut } = useAuth()
  const { data: preferences } = usePreferences()
  // Identity lives in the IdP (no local user table), so account
  // maintenance — profile, password, MFA — opens the IdP's self-service
  // page in a new tab rather than living in this app.
  const accountUrl = accountSettingsUrl()

  if (!isAuthenticated || !user) {
    return (
      <SidebarMenuButton render={<Link to="/invoices" />}>
        <LogInIcon />
        <span>Sign in</span>
      </SidebarMenuButton>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
        <Avatar>
          <AvatarImage src={user.avatarUrl} alt={user.name} />
          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
        </Avatar>
        <div className="grid flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs text-sidebar-foreground/60">
            {preferences?.defaultLocation?.name ?? user.email}
          </span>
        </div>
        <ChevronsUpDownIcon className="ms-auto group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64">
        <div className="flex items-center gap-2 px-2 py-1.5 text-start text-sm">
          <Avatar>
            <AvatarImage src={user.avatarUrl} alt={user.name} />
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
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
        <PermissionGuard method="GET" path="/locations">
          <DefaultLocationMenu />
        </PermissionGuard>
        {accountUrl && (
          <DropdownMenuItem
            render={
              <a href={accountUrl} target="_blank" rel="noopener noreferrer" />
            }
          >
            <SettingsIcon />
            Account settings
          </DropdownMenuItem>
        )}
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
  const { user } = useAuth()

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarContent>
        <SidebarHeader className="px-2">
          <Link
            to={homePath(user)}
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
          {navItems
            .filter(({ to }) => canVisit(user, to))
            .map(({ to, label, icon: Icon }) => {
              const isActive = pathname === to || pathname.startsWith(`${to}/`)

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
