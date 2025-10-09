import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

import tailwindStyles from "./tailwind.css?url";
import { ThemeProvider, themeInitScript } from "./contexts/ThemeContext";

export const links = () => [
  { rel: "stylesheet", href: tailwindStyles },
  // Favicon configuration - comprehensive browser support
  { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
  { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors duration-150">
        <ThemeProvider>
          <Outlet />
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
