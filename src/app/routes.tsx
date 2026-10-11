import { createBrowserRouter } from "react-router"
import RootLayout from "./components/RootLayout"
import AdminPage from "./views/AdminPage"
import DashboardPage from "./views/DashboardPage"
import EventPage from "./views/EventPage"
import HomePage from "./views/HomePage"
import PortalPage from "./views/PortalPage"

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [
      { index: true, Component: HomePage },
      { path: "events/:slug", Component: EventPage },
      { path: "login", Component: PortalPage },
      { path: "signup", Component: PortalPage },
      { path: "dashboard", Component: DashboardPage },
      { path: "admin", Component: AdminPage },
      { path: "*", Component: HomePage },
    ],
  },
], { basename: import.meta.env.BASE_URL })
