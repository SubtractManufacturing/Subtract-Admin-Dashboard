import { LoaderFunctionArgs } from "@remix-run/node";
import { useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { requireAuth } from "~/lib/auth.server";
import { downloadQuoteFiles } from "~/lib/downloadQuoteFiles";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  const quoteId = params.quoteId;
  if (!quoteId) {
    throw new Response("Quote ID is required", { status: 400 });
  }

  try {
    const { buffer, filename } = await downloadQuoteFiles(parseInt(quoteId));

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("[Download Resource] Error:", error);
    throw new Response("Failed to download files", { status: 500 });
  }
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
            {error.status} {error.statusText}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error.data || "Failed to download quote files."}
          </p>
          <button
            onClick={() => window.history.back()}
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
          Download Error
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {error instanceof Error ? error.message : "Unable to download quote files. Please try again."}
        </p>
        <button
          onClick={() => window.history.back()}
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
