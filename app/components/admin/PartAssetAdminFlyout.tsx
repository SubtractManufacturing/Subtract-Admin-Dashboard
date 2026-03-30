import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useFetcher, useMatches, useRevalidator } from "@remix-run/react";
import { PART_ASSET_ADMIN_INTENT } from "~/lib/part-asset-admin.shared";

const CONVERSION_SUPPORTED_EXTENSIONS = ["step", "stp", "iges", "igs", "brep"];

function cadExtensionHint(cadFileUrl: string | null | undefined): string | null {
  if (!cadFileUrl) return null;
  const clean = cadFileUrl.split("?")[0];
  const fn = clean.split("/").pop() || "";
  return fn.split(".").pop()?.toLowerCase() || null;
}

function isFormatConversionSupported(ext: string | null): boolean {
  if (!ext) return true;
  return CONVERSION_SUPPORTED_EXTENSIONS.includes(ext);
}

export type Cad3dAdminContext = {
  surface: "cad3d";
  entity: "quote_part" | "part";
  id: string;
  partName?: string;
  conversionStatus?: string | null;
  meshConversionError?: string | null;
  cadFileUrl?: string | null;
  /** Opens the main 3D viewer modal (same as normal thumbnail click). */
  onOpen3DViewer?: () => void;
};

export type DrawingAdminContext = {
  surface: "drawing";
  entity: "quote_part" | "part";
  parentPartId: string;
  drawingId: string;
  fileName?: string;
};

export type PartAssetAdminContext = Cad3dAdminContext | DrawingAdminContext;

type CadVersionRow = {
  id: string;
  version: number;
  isCurrentVersion: boolean;
  fileName: string;
  fileSize: number | null;
};

export function usePartAssetAdminAccess(): boolean {
  const matches = useMatches();
  const data = matches.find((m) => m.id === "routes/_protected")?.data as
    | { canUsePartAssetAdmin?: boolean }
    | undefined;
  return data?.canUsePartAssetAdmin === true;
}

function PartAssetAdminPanel({
  open,
  onClose,
  action,
  context,
}: {
  open: boolean;
  onClose: () => void;
  action: string;
  context: PartAssetAdminContext;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [versions, setVersions] = useState<CadVersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const submit = useCallback(
    (operation: string, fields: Record<string, string> = {}) => {
      const fd = new FormData();
      fd.append("intent", PART_ASSET_ADMIN_INTENT);
      fd.append("operation", operation);
      for (const [k, v] of Object.entries(fields)) {
        fd.append(k, v);
      }
      fetcher.submit(fd, { method: "post", action });
    },
    [action, fetcher]
  );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const cadEntityForVersions =
    context.surface === "cad3d" ? context.entity : null;
  const cadIdForVersions =
    context.surface === "cad3d" ? context.id : null;

  useEffect(() => {
    if (!open || !cadEntityForVersions || !cadIdForVersions) {
      if (!open) {
        setVersions([]);
        setVersionsError(null);
        setVersionsLoading(false);
      }
      return;
    }

    const prefix =
      cadEntityForVersions === "quote_part" ? "quote-parts" : "parts";
    const url = `/${prefix}/${cadIdForVersions}/versions`;
    let cancelled = false;
    setVersions([]);
    setVersionsLoading(true);
    setVersionsError(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load versions");
        const data = (await res.json()) as { versions?: CadVersionRow[] };
        if (!cancelled) setVersions(data.versions || []);
      })
      .catch(() => {
        if (!cancelled) setVersionsError("Could not load CAD versions");
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, cadEntityForVersions, cadIdForVersions]);

  if (!open) return null;

  const busy = fetcher.state !== "idle";
  const err = fetcher.data?.error;

  const ext =
    context.surface === "cad3d"
      ? cadExtensionHint(context.cadFileUrl)
      : null;
  const formatOk = isFormatConversionSupported(ext);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full min-w-[20rem] border border-gray-200 dark:border-gray-700 p-4 text-left"
        role="dialog"
        aria-labelledby="part-asset-admin-title"
      >
        <h2
          id="part-asset-admin-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          Part asset admin
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Ctrl+Shift+click (or right-click) on thumbnails. Admin/Dev only.
        </p>

        {context.surface === "cad3d" && (
          <div className="mt-3 text-sm space-y-1 text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-800 rounded p-2 bg-gray-50 dark:bg-gray-800/50">
            <div>
              <span className="font-medium">Part:</span>{" "}
              {context.partName || context.id}
            </div>
            <div>
              <span className="font-medium">Conversion:</span>{" "}
              {context.conversionStatus || "—"}
            </div>
            {context.meshConversionError && (
              <div className="text-red-600 dark:text-red-400 text-xs break-words">
                {context.meshConversionError}
              </div>
            )}
            {ext && !formatOk && (
              <div className="text-amber-700 dark:text-amber-300 text-xs">
                Extension `.${ext}` may not be supported for mesh conversion
                (expected: {CONVERSION_SUPPORTED_EXTENSIONS.join(", ")}).
              </div>
            )}
          </div>
        )}

        {context.surface === "drawing" && (
          <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            <div className="font-medium">Drawing</div>
            <div className="truncate text-xs">{context.fileName}</div>
          </div>
        )}

        {err && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{err}</p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {context.surface === "cad3d" && (
            <>
              {context.onOpen3DViewer && (
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
                  onClick={() => {
                    const openViewer = context.onOpen3DViewer;
                    onClose();
                    openViewer?.();
                  }}
                >
                  Open 3D viewer
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                className="px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                onClick={() =>
                  submit("regenerateMesh", {
                    ...(context.entity === "quote_part"
                      ? { quotePartId: context.id }
                      : { partId: context.id }),
                  })
                }
              >
                Regenerate mesh
              </button>
              <button
                type="button"
                disabled={busy}
                className="px-3 py-2 text-sm rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                onClick={() => {
                  if (
                    !confirm(
                      "Clear mesh and thumbnail from storage? You can regenerate after."
                    )
                  )
                    return;
                  submit("clearMeshAndThumbnail", {
                    ...(context.entity === "quote_part"
                      ? { quotePartId: context.id }
                      : { partId: context.id }),
                  });
                }}
              >
                Clear mesh & thumbnail
              </button>
            </>
          )}

          {context.surface === "drawing" && (
            <button
              type="button"
              disabled={busy}
              className="px-3 py-2 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              onClick={() => {
                if (!confirm("Delete this technical drawing?")) return;
                submit("deleteTechnicalDrawing", {
                  drawingId: context.drawingId,
                  ...(context.entity === "quote_part"
                    ? { quotePartId: context.parentPartId }
                    : { partId: context.parentPartId }),
                });
              }}
            >
              Delete drawing
            </button>
          )}

          {context.surface === "cad3d" && (
            <div className="mt-2 min-h-[9rem] flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  CAD revisions (delete non-current only)
                </span>
                {versionsLoading && (
                  <span
                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-gray-300 dark:border-gray-600 border-t-blue-600 dark:border-t-blue-400 animate-spin"
                    aria-label="Loading versions"
                  />
                )}
              </div>
              <div className="flex-1 min-h-[7.5rem] rounded border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 px-2 py-1.5">
                {versionsError && (
                  <p className="text-xs text-red-500">{versionsError}</p>
                )}
                {!versionsLoading &&
                  !versionsError &&
                  versions.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      No version history
                    </p>
                  )}
                {!versionsError && versions.length > 0 && (
                  <ul className="max-h-36 overflow-y-auto space-y-1 text-xs">
                    {versions.map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                      >
                        <span>
                          v{v.version}
                          {v.isCurrentVersion ? " (current)" : ""} —{" "}
                          {v.fileName}
                        </span>
                        {!v.isCurrentVersion && (
                          <button
                            type="button"
                            disabled={busy}
                            className="shrink-0 text-red-600 hover:underline disabled:opacity-50"
                            onClick={() => {
                              if (
                                !confirm(`Delete CAD version v${v.version}?`)
                              )
                                return;
                              submit("deleteCadVersion", { versionId: v.id });
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="mt-4 w-full py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export function PartAssetAdminTrigger({
  action,
  context,
  children,
}: {
  action: string;
  context: PartAssetAdminContext;
  children: ReactNode;
}) {
  const can = usePartAssetAdminAccess();
  const [panelOpen, setPanelOpen] = useState(false);

  if (!can) return <>{children}</>;

  return (
    <>
      <div
        className="contents"
        onMouseDownCapture={(e: React.MouseEvent) => {
          if (!e.ctrlKey || !e.shiftKey) return;
          if (e.button !== 0 && e.button !== 2) return;
          e.preventDefault();
          e.stopPropagation();
          setPanelOpen(true);
        }}
        onContextMenuCapture={(e: React.MouseEvent) => {
          if (e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            setPanelOpen(true);
          }
        }}
      >
        {children}
      </div>
      <PartAssetAdminPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        action={action}
        context={context}
      />
    </>
  );
}
