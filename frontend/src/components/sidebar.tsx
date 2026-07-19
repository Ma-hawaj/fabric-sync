import { Link } from '@tanstack/react-router'
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
} from 'lucide-react'

export function AppSidebar() {
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
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/" />}>
              <HomeIcon />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/dashboard" />}>
              <Grid />
              <span>Dashboard</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/dashboard/orders" />}>
              <ShoppingCart />
              <span>Orders</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/customers" />}>
              <UsersIcon />
              <span>Customers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/inventory" />}>
              <PackageIcon />
              <span>Inventory</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/invoices" />}>
              <ReceiptText />
              <span>Invoices</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/users" />}>
              <UsersIcon />
              <span>Users</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  )
}

export default AppSidebar
