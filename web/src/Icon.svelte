<!-- Draws the shared interface icons. -->

<script module lang="ts">
  const paths = {
    input: "M5 17H3V2h8l4 4v1M11 2v4h4M8 7h9l4 4v11H8V7Zm9 0v4h4",
    grid: "M3 2h7v9H3V2Zm11 0h7v9h-7V2ZM3 14h7v9H3v-9Zm11 0h7v9h-7v-9Z",
    normal: "M3 4h7v16H3ZM14 4h7v16h-7Z",
    compact: "M3 2h7v8H3ZM14 2h7v8h-7ZM3 14h7v8H3ZM14 14h7v8h-7Z",
    page: "M5 2h14v20H5V2Zm4 6h6m-6 4h6m-6 4h4",
    style: "M9 13 18 4a2.12 2.12 0 0 1 3 3l-9 9M9 13l3 3M9 13c-3 0-4 2-4 4 0 2-1 3-3 4 4 1 8 0 10-5Z",
    "style-off": "M9 13 18 4a2.12 2.12 0 0 1 3 3l-9 9M9 13l3 3M9 13c-3 0-4 2-4 4 0 2-1 3-3 4 4 1 8 0 10-5ZM3 3l18 18",
    palette:
      "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1 1 0 0 1 .7-1.6H17a4 4 0 0 0 4-4 9 9 0 0 0-9-9ZM7.5 10h.01M10 6.5h.01M15 6.5h.01M17.5 10h.01",
    width: "m4 15 11-11 5 5-11 11-5-5ZM8 11l2 2m2-6 2 2m2 2 2 2m-6 2 2 2",
    ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM6 6l12 12",
    output: "M20 9v2m0 8v3H4V2h9l7 7h-7V2M9 15h13m-3-3 3 3-3 3",
    add: "M12 5v14M5 12h14",
    remove: "M5 12h14",
    more: "M4 12h.01M12 12h.01M20 12h.01",
    down: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
    print:
      "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6zM18 12h.01",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    "eye-off": "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 3l18 18",
    reset: "M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6",
    fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 7h8v10H8Z",
    compare: "M3 4h18v16H3V4Zm9 0v16M7 9h2M15 15h2",
    original: "M10 3h10v18H10M14 7h3m-3 4h3M11 15H2m4-4-4 4 4 4",
    earlier: "M19 12H5m5-5-5 5 5 5",
    later: "M5 12h14m-5-5 5 5-5 5",
    close: "m6 6 12 12M6 18 18 6",
    select: "M4 4h16v16H4V4Zm4 8 3 3 5-6",
    info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v1m0 3v6",
    help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-3 6a3 3 0 1 1 5 2c-1 1-2 1-2 3m0 3h.01",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
    blank: "M5 3h10l4 4v14H5V3Zm10 0v5h4",
    next: "m9 6 6 6-6 6",
    previous: "m15 6-6 6 6 6",
    reorder: "M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1",
    lock: "M6 11h12v10H6V11Zm2 0V7a4 4 0 0 1 8 0v4",
    settings:
      "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM10 2h4l1 3 2 1 3-1 2 4-2 2v2l2 2-2 4-3-1-2 1-1 3h-4l-1-3-2-1-3 1-2-4 2-2v-2l-2-2 2-4 3 1 2-1 1-3Z",
    github:
      "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22",
  }
  export type Name = keyof typeof paths
</script>

<script lang="ts">
  let { name }: { name: Name } = $props()
</script>

<svg
  class={{ "workspace-icon": name === "input" || name === "output" }}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={name === "more" ? 3 : 1.6}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name]} /></svg
>
