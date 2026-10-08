import { createBrowserRouter } from "react-router"
import EventPage from "./views/EventPage"
import HomePage from "./views/HomePage"
import PortalPage from "./views/PortalPage"

export const router = createBrowserRouter([
  { path: "/", Component: HomePage },
  { path: "/events/:slug", Component: EventPage },
  { path: "/login", Component: PortalPage },
  { path: "/signup", Component: PortalPage },
  { path: "*", Component: HomePage },
])
