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
  SidebarGroup,
  SidebarGroupLabel,
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
        <SidebarHeader className="px-2 pb-5 pt-4">
          <Link
            to={homePath(user)}
            aria-label="THOBX home"
            className="flex flex-col items-center gap-2 rounded-xl px-1 py-1.5"
          >
            <img
              src="/brand/thobx-logo-white.webp"
              alt="THOBX — ثوبكس"
              width={826}
              height={346}
              className="h-auto w-44 max-w-full group-data-[collapsible=icon]:hidden"
            />
            <img
              src="/favicon.svg"
              alt=""
              width={32}
              height={32}
              className="hidden size-8 shrink-0 group-data-[collapsible=icon]:block"
            />
            <span className="text-[10px] leading-none tracking-widest text-sidebar-foreground/60 uppercase group-data-[collapsible=icon]:hidden">
              Atelier workspace
            </span>
          </Link>
        </SidebarHeader>
        <SidebarSeparator />
        {[
          {
            label: 'Workspace',
            paths: ['/invoices', '/orders', '/repairs', '/customers'],
          },
          {
            label: 'Catalog',
            paths: ['/inventory', '/products', '/gift-cards'],
          },
          {
            label: 'Administration',
            paths: ['/locations', '/order-stages', '/design-options', '/users'],
          },
        ].map((group) => {
          const items = navItems.filter(
            ({ to }) => group.paths.includes(to) && canVisit(user, to),
          )
          if (!items.length) return null
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>
                <span className="text-[10px] tracking-widest uppercase">
                  {group.label}
                </span>
              </SidebarGroupLabel>
              <SidebarMenu>
                {items.map(({ to, label, icon: Icon }) => {
                  const isActive =
                    pathname === to || pathname.startsWith(`${to}/`)

                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={label}
                        className="h-9 border-s-2 border-transparent px-2.5 text-[13px] text-sidebar-foreground/75 data-active:border-sidebar-primary data-active:text-sidebar-foreground"
                        render={<Link to={to} />}
                      >
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
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
