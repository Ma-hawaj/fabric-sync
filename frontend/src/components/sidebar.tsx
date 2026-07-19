import { Link, useLocation } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import {
  HomeIcon,
  UsersIcon,
  Grid,
  ShoppingCart,
  ReceiptText,
  PackageIcon,
  ScissorsIcon,
  ContactIcon,
} from 'lucide-react'

const navItems = [
  { to: '/', label: 'Home', icon: HomeIcon, exact: true },
  { to: '/dashboard', label: 'Dashboard', icon: Grid, exact: true },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/customers', label: 'Customers', icon: ContactIcon },
  { to: '/inventory', label: 'Inventory', icon: PackageIcon },
  { to: '/invoices', label: 'Invoices', icon: ReceiptText },
  { to: '/users', label: 'Users', icon: UsersIcon },
] as const

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
    </Sidebar>
  )
}

export default AppSidebar
