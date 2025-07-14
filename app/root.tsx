import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

import tailwindStyles from "./tailwind.css?url";
import { ThemeProvider, themeInitScript } from "./contexts/ThemeContext.js";

export const links = () => [
  { rel: "stylesheet", href: tailwindStyles },
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
