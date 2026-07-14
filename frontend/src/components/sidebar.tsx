import { Link } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar'
import { HomeIcon, UsersIcon, Grid, ShoppingCart } from 'lucide-react'

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarHeader className="px-2">
          <div className="text-sm font-semibold">Menu</div>
        </SidebarHeader>
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
