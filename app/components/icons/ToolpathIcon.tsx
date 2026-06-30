import type { SVGProps } from "react";

export function ToolpathIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 251 250"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect
        x="0"
        y="0"
        width="251"
        height="250"
        rx="34"
        fill="currentColor"
      />
      <path
        d="M35 46c0-7 5-12 12-12h64c7 0 12 5 12 12s-5 12-12 12H59v52c0 7-5 12-12 12s-12-5-12-12V46Z"
        fill="white"
      />
      <path
        d="M140 46c0-7 5-12 12-12h52c7 0 12 5 12 12v52c0 7-5 12-12 12s-12-5-12-12V58h-40c-7 0-12-5-12-12Z"
        fill="white"
      />
      <path
        d="M47 140c7 0 12 5 12 12v40h52c7 0 12 5 12 12s-5 12-12 12H47c-7 0-12-5-12-12v-52c0-7 5-12 12-12Z"
        fill="white"
      />
      <path
        d="M204 140c7 0 12 5 12 12v52c0 7-5 12-12 12h-52c-7 0-12-5-12-12s5-12 12-12h40v-40c0-7 5-12 12-12Z"
        fill="white"
      />
      <path
        d="M91 125c0-20 15-35 35-35s35 15 35 35-15 35-35 35-35-15-35-35Zm24 0c0 7 5 12 11 12s11-5 11-12-5-12-11-12-11 5-11 12Z"
        fill="white"
      />
    </svg>
  );
}
