import { useEffect, useState } from "react";

/** Every screen is linkable: the hash is the whole router. */
export const ROUTES = ["/", "/select", "/campaign", "/fight", "/lab"] as const;
export type Route = (typeof ROUTES)[number];

function read(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : "/";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(route: Route) {
  if (read() === route) return;
  location.hash = `#${route}`;
}
