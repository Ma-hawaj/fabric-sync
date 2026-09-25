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
import { useAllLocations } from '@/features/locations/hooks/use-locations'
import {
  usePreferences,
  useSetDefaultLocation,
} from '@/features/locations/hooks/use-default-location'
import { toast } from 'sonner'
import {
  HomeIcon,
  UsersIcon,
  Grid,
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
  CheckIcon,
  LogInIcon,
  LogOutIcon,
  SunIcon,
} from 'lucide-react'

const navItems = [
  { to: '/', label: 'Home', icon: HomeIcon, exact: true },
  { to: '/dashboard', label: 'Dashboard', icon: Grid, exact: true },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, exact: false },
  {
    to: '/order-stages',
    label: 'Order Stages',
    icon: ListChecksIcon,
    exact: false,
  },
  { to: '/customers', label: 'Customers', icon: ContactIcon, exact: false },
  { to: '/inventory', label: 'Inventory', icon: PackageIcon, exact: false },
  { to: '/products', label: 'Products', icon: ShoppingBagIcon, exact: false },
  { to: '/gift-cards', label: 'Gift Cards', icon: GiftIcon, exact: false },
  { to: '/invoices', label: 'Invoices', icon: ReceiptText, exact: false },
  { to: '/locations', label: 'Locations', icon: MapPinIcon, exact: false },
  { to: '/users', label: 'Users', icon: UsersIcon, exact: false },
] as const

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  const initials =
    parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return initials.map((part) => part[0].toUpperCase()).join('')
}

function DefaultLocationSubmenu() {
  const { data: preferences } = usePreferences()
  const { data: locations } = useAllLocations()
  const setDefaultLocation = useSetDefaultLocation()

  const active = locations.filter((location) => location.isActive)
  const currentId = preferences?.defaultLocationId ?? null

  const change = (locationId: string | null, label: string) => {
    if (locationId === currentId) {
      return
    }
    const pending = setDefaultLocation.mutateAsync(locationId)
    toast.promise(pending, {
      loading: 'Saving default location...',
      success: () =>
        locationId === null
          ? 'Default location cleared.'
          : `Default location set to ${label}.`,
      error: 'Could not save the default location. Please try again.',
    })
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <MapPinIcon />
        Default location
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => change(null, '')}>
          <span className="flex-1">None</span>
          {currentId === null && <CheckIcon />}
        </DropdownMenuItem>
        {active.map((location) => (
          <DropdownMenuItem
            key={location.id}
            onClick={() => change(location.id, location.name)}
          >
            <span className="flex-1">{location.name}</span>
            {currentId === location.id && <CheckIcon />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function UserMenu() {
  const { isAuthenticated, user, signOut } = useAuth()
  const { data: preferences } = usePreferences()

  if (!isAuthenticated || !user) {
    return (
      <SidebarMenuButton render={<Link to="/dashboard" />}>
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
        <DefaultLocationSubmenu />
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
    <Sidebar collapsible="icon" variant="inset">
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
